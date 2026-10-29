import { sql, type Migration } from 'kysely';

/** Additive, private staging for title-only model proposals and editor decisions. */
const HEADLINE_REVIEW_SQL = String.raw`
do $$ begin
  if not exists (select 1 from pg_roles where rolname='dialektik_headline_ai_writer') then
    create role dialektik_headline_ai_writer
      nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  elsif exists (select 1 from pg_roles where rolname='dialektik_headline_ai_writer'
      and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)) then
    raise exception 'headline AI writer has unexpected privileges';
  end if;
end $$;

create table public.headline_ai_source_grants (
  id dialektik_ulid primary key,
  source_id dialektik_ulid not null references public.sources(id),
  source_policy_id text not null,
  approved_by dialektik_ulid not null references public.users(id),
  authorization_reference text not null check (length(btrim(authorization_reference)) between 1 and 256),
  rights_evidence_url text not null check (rights_evidence_url ~ '^https://' and rights_evidence_url <> 'https://supabase.com'),
  provider text not null check (provider = 'CLOUDFLARE_WORKERS_AI'),
  scope text not null check (scope = 'HEADLINE_ONLY'),
  derived_scope text not null check (derived_scope = 'EDITORIAL_REVIEW_ONLY'),
  valid_from timestamptz(3) not null,
  expires_at timestamptz(3),
  revoked_at timestamptz(3),
  created_at timestamptz(3) not null,
  foreign key (source_id, source_policy_id) references public.live_source_policies(source_id,id),
  check (expires_at is null or expires_at > valid_from),
  check (revoked_at is null or revoked_at >= valid_from)
);
create unique index headline_ai_one_unrevoked_grant
  on public.headline_ai_source_grants(source_id,provider) where revoked_at is null;

create table public.headline_ai_attempts (
  id dialektik_ulid primary key,
  grant_id dialektik_ulid not null references public.headline_ai_source_grants(id),
  source_id dialektik_ulid not null references public.sources(id),
  source_policy_id text not null,
  article_id dialektik_ulid not null references public.articles(id),
  article_version_id dialektik_ulid not null references public.live_article_versions(id),
  requested_by dialektik_ulid not null references public.users(id),
  title_sha256 text not null check (title_sha256 ~ '^[0-9a-f]{64}$'),
  model text not null check (length(model) between 1 and 128),
  config_sha256 text not null check (config_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz(3) not null,
  unique (article_version_id, grant_id, model, config_sha256),
  foreign key (source_id, source_policy_id) references public.live_source_policies(source_id,id)
);

create table public.headline_ai_attempt_outcomes (
  attempt_id dialektik_ulid primary key references public.headline_ai_attempts(id),
  outcome text not null check (outcome in ('VALIDATED','REJECTED','UNKNOWN_SENT','RIGHTS_REVOKED')),
  extraction jsonb,
  recorded_at timestamptz(3) not null,
  check ((outcome='VALIDATED' and extraction is not null) or (outcome<>'VALIDATED' and extraction is null))
);

create table public.headline_ai_review_decisions (
  id dialektik_ulid primary key,
  attempt_id dialektik_ulid not null unique references public.headline_ai_attempts(id),
  reviewed_by dialektik_ulid not null references public.users(id),
  decision text not null check (decision in ('ACCEPT_FOR_GROUPING','NEEDS_EVIDENCE','REJECT')),
  decided_at timestamptz(3) not null
);

create function public.dialektik_headline_grant_guard() returns trigger language plpgsql as $$
declare p public.live_source_policies;
begin
  if tg_op='DELETE' then raise exception 'headline grant history is append-only'; end if;
  perform pg_advisory_xact_lock(hashtextextended('headline-grant:' || new.source_id::text,0));
  if nullif(current_setting('dialektik.actor_id',true),'') is distinct from new.approved_by::text
    or current_setting('dialektik.actor_type',true) is distinct from 'editor'
    or not exists(select 1 from public.users u join public.editorial_single_editor_authorizations e
      on e.editor_user_id=u.id where u.id=new.approved_by and u.role='editor' and e.revoked_at is null)
  then raise exception 'headline source grant requires an authorized editor'; end if;
  if tg_op='UPDATE' then
    if old.revoked_at is not null or new.revoked_at is null or new.revoked_at > clock_timestamp()
      or (to_jsonb(new)-'revoked_at') is distinct from (to_jsonb(old)-'revoked_at') then
      raise exception 'headline grant may only be revoked once';
    end if;
    return new;
  end if;
  select * into p from public.live_source_policies where source_id=new.source_id
    order by recorded_at desc,id desc limit 1;
  if p.id is distinct from new.source_policy_id or not p.active or p.rights_class <> 'LIVE_READY'
    or p.storage_policy <> 'METADATA_ONLY' or p.policy->>'rightsReviewStatus' is distinct from 'APPROVED'
    or nullif(p.policy->>'authorizationReference','') is null
    or nullif(p.policy->>'endpoint','') is null or p.policy->>'endpoint'='https://supabase.com'
    or nullif(p.policy->>'rightsEvidenceUrl','') is null or p.policy->>'rightsEvidenceUrl'='https://supabase.com'
    or not exists (select 1 from public.users u
      join public.editorial_single_editor_authorizations a on a.editor_user_id=u.id
      where u.id=new.approved_by and u.role='editor' and a.revoked_at is null)
    or new.provider <> 'CLOUDFLARE_WORKERS_AI' or new.scope <> 'HEADLINE_ONLY'
    or new.derived_scope <> 'EDITORIAL_REVIEW_ONLY' or new.created_at > clock_timestamp()
  then raise exception 'headline source grant is not authorized'; end if;
  return new;
end $$;
create trigger headline_ai_grant_guard before insert or update or delete on public.headline_ai_source_grants
  for each row execute function public.dialektik_headline_grant_guard();

create function public.dialektik_headline_attempt_guard() returns trigger language plpgsql as $$
declare g public.headline_ai_source_grants; a public.articles; v public.live_article_versions; p public.live_source_policies;
  can_show boolean;
begin
  if tg_op <> 'INSERT' then raise exception 'headline attempt history is append-only'; end if;
  perform pg_advisory_xact_lock(hashtextextended('headline-ai-daily-budget',0));
  if (select count(*) from public.headline_ai_attempts where created_at > clock_timestamp()-interval '24 hours') >= 100 then
    raise exception 'headline daily attempt limit reached';
  end if;
  select * into g from public.headline_ai_source_grants where id=new.grant_id;
  select * into a from public.articles where id=new.article_id;
  select * into v from public.live_article_versions where id=new.article_version_id;
  select * into p from public.live_source_policies where source_id=new.source_id
    order by recorded_at desc,id desc limit 1;
  select coalesce((select case when jsonb_typeof(q.policy->'quarantinedArticleIds')='array'
    then not (q.policy->'quarantinedArticleIds' @> jsonb_build_array(new.article_id::text)) else false end
    from public.live_source_policies q where q.source_id=new.source_id
      and q.policy ? 'quarantinedArticleIds' order by q.recorded_at desc,q.id desc limit 1),true) into can_show;
  if g.id is null or g.source_id is distinct from new.source_id or g.source_policy_id is distinct from new.source_policy_id
    or g.revoked_at is not null or g.valid_from > clock_timestamp()
    or (g.expires_at is not null and g.expires_at <= clock_timestamp())
    or p.id is distinct from g.source_policy_id or not p.active or p.storage_policy <> 'METADATA_ONLY'
    or p.policy->>'rightsReviewStatus' is distinct from 'APPROVED' or not can_show
    or a.id is null or a.origin <> 'LIVE_REAL' or a.source_id is distinct from new.source_id
    or v.article_id is distinct from a.id or v.id is distinct from
      (select id from public.live_article_versions where article_id=a.id order by version_number desc limit 1)
    or new.title_sha256 is distinct from encode(sha256(convert_to(v.headline,'UTF8')),'hex')
    or not exists(select 1 from public.live_acquisition_receipts r
      where r.id=v.receipt_id and r.disposition='PERSISTED' and r.source_id=a.source_id
        and r.exclusion_id=a.live_exposure_id and r.canonical_url=a.url_canonical)
    or not exists(select 1 from public.users u join public.editorial_single_editor_authorizations e
      on e.editor_user_id=u.id where u.id=new.requested_by and u.role='editor' and e.revoked_at is null)
    or new.created_at > clock_timestamp()
  then raise exception 'headline attempt lacks current rights or provenance'; end if;
  return new;
end $$;
create trigger headline_ai_attempt_guard before insert or update or delete on public.headline_ai_attempts
  for each row execute function public.dialektik_headline_attempt_guard();

create function public.dialektik_headline_outcome_guard() returns trigger language plpgsql as $$
declare a public.headline_ai_attempts; g public.headline_ai_source_grants; v public.live_article_versions;
  f jsonb; ev jsonb; first_offset integer; last_offset integer; value_hash text;
begin
  if tg_op <> 'INSERT' then raise exception 'headline outcome history is append-only'; end if;
  select * into strict a from public.headline_ai_attempts where id=new.attempt_id;
  select * into strict g from public.headline_ai_source_grants where id=a.grant_id;
  select * into strict v from public.live_article_versions where id=a.article_version_id;
  if new.recorded_at < a.created_at or new.recorded_at > clock_timestamp() then
    raise exception 'headline outcome time is invalid';
  end if;
  if new.outcome <> 'VALIDATED' then return new; end if;
  if g.revoked_at is not null or g.valid_from>clock_timestamp()
    or (g.expires_at is not null and g.expires_at<=clock_timestamp())
    or g.source_policy_id is distinct from (select id from public.live_source_policies
      where source_id=g.source_id order by recorded_at desc,id desc limit 1)
    or a.article_version_id is distinct from (select id from public.live_article_versions
      where article_id=a.article_id order by version_number desc limit 1)
    or not exists(select 1 from public.users u join public.editorial_single_editor_authorizations e
      on e.editor_user_id=u.id where u.id=a.requested_by and u.role='editor' and e.revoked_at is null)
  then raise exception 'headline grant is no longer current'; end if;
  if jsonb_typeof(new.extraction) <> 'object'
    or (select array_agg(k order by k) from jsonb_object_keys(new.extraction) k)
      <> array['boundedOccurrence','boundedThread','facts','status']
    or jsonb_typeof(new.extraction->'status') is distinct from 'string'
    or new.extraction->>'status' not in ('OBSERVATION_AVAILABLE','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE','AMBIGUOUS')
    or jsonb_typeof(new.extraction->'boundedOccurrence') <> 'boolean'
    or jsonb_typeof(new.extraction->'boundedThread') <> 'boolean'
    or jsonb_typeof(new.extraction->'facts') <> 'array' or jsonb_array_length(new.extraction->'facts')>12
  then raise exception 'headline extraction structure is invalid'; end if;
  if new.extraction->>'status' <> 'OBSERVATION_AVAILABLE'
    and (jsonb_array_length(new.extraction->'facts')<>0
      or (new.extraction->>'boundedOccurrence')::boolean or (new.extraction->>'boundedThread')::boolean)
  then raise exception 'unavailable observations cannot retain facts'; end if;
  if new.extraction->>'status' = 'OBSERVATION_AVAILABLE' and (
    not (new.extraction->>'boundedOccurrence')::boolean
    or not exists(select 1 from jsonb_array_elements(new.extraction->'facts') x where x->>'role'='action')
    or not exists(select 1 from jsonb_array_elements(new.extraction->'facts') x where x->>'role' in ('date','external_id'))
  ) then raise exception 'headline occurrence is not bounded'; end if;
  if (new.extraction->>'boundedThread')::boolean and (
    not (new.extraction->>'boundedOccurrence')::boolean
    or not exists(select 1 from jsonb_array_elements(new.extraction->'facts') x where x->>'role'='process')
    or not exists(select 1 from jsonb_array_elements(new.extraction->'facts') x where x->>'role'='external_id')
  ) then raise exception 'headline thread is not bounded'; end if;
  if (select count(*) from jsonb_array_elements(new.extraction->'facts')) <>
     (select count(distinct x->>'id') from jsonb_array_elements(new.extraction->'facts') x) then
    raise exception 'headline fact ids must be unique';
  end if;
  for f in select value from jsonb_array_elements(new.extraction->'facts') loop
    if jsonb_typeof(f)<>'object' or (select array_agg(k order by k) from jsonb_object_keys(f) k)
      <> array['evidence','id','isoDate','retrievalHash','role','valueHash']
      or jsonb_typeof(f->'id') is distinct from 'string' or jsonb_typeof(f->'role') is distinct from 'string'
      or jsonb_typeof(f->'valueHash') is distinct from 'string' or jsonb_typeof(f->'retrievalHash') is distinct from 'string'
      or f->>'id' !~ '^f[0-9]{1,2}$'
      or f->>'role' not in ('action','participant','date','end_date','location','external_id','process','topic')
      or f->>'valueHash' !~ '^[0-9a-f]{64}$' or f->>'retrievalHash' !~ '^[0-9a-f]{64}$'
    then raise exception 'headline fact structure is invalid'; end if;
    ev := f->'evidence';
    if jsonb_typeof(ev)<>'object' or (select array_agg(k order by k) from jsonb_object_keys(ev) k)
      <> array['end','field','sourceSha256','spanSha256','start']
      or jsonb_typeof(ev->'field') is distinct from 'string'
      or jsonb_typeof(ev->'sourceSha256') is distinct from 'string'
      or jsonb_typeof(ev->'spanSha256') is distinct from 'string'
      or jsonb_typeof(ev->'start') is distinct from 'number' or jsonb_typeof(ev->'end') is distinct from 'number'
      or ev->>'field'<>'title' or ev->>'sourceSha256' is distinct from a.title_sha256
      or ev->>'spanSha256' !~ '^[0-9a-f]{64}$' or (ev->>'start') !~ '^[0-9]{1,4}$'
      or (ev->>'end') !~ '^[0-9]{1,4}$'
    then raise exception 'headline fact evidence is invalid'; end if;
    first_offset := (ev->>'start')::integer; last_offset := (ev->>'end')::integer;
    if last_offset <= first_offset or last_offset > char_length(v.headline) then
      raise exception 'headline fact offsets are invalid';
    end if;
    value_hash := encode(sha256(convert_to(substring(v.headline from first_offset+1 for last_offset-first_offset),'UTF8')),'hex');
    if value_hash is distinct from ev->>'spanSha256' or value_hash is distinct from f->>'valueHash' then
      raise exception 'headline fact does not match the title';
    end if;
    if f->'isoDate' is distinct from 'null'::jsonb and (
      jsonb_typeof(f->'isoDate') is distinct from 'string' or f->>'role' not in ('date','end_date')
      or f->>'isoDate' !~ '^\d{4}-\d{2}-\d{2}$'
      or f->>'isoDate' is distinct from substring(v.headline from first_offset+1 for last_offset-first_offset)
    ) then raise exception 'headline date does not match the title'; end if;
  end loop;
  return new;
end $$;
create trigger headline_ai_outcome_guard before insert or update or delete on public.headline_ai_attempt_outcomes
  for each row execute function public.dialektik_headline_outcome_guard();

create function public.dialektik_headline_review_guard() returns trigger language plpgsql as $$
declare outcome_row public.headline_ai_attempt_outcomes;
begin
  if tg_op <> 'INSERT' then raise exception 'headline review history is append-only'; end if;
  select * into outcome_row from public.headline_ai_attempt_outcomes where attempt_id=new.attempt_id;
  if outcome_row.outcome is distinct from 'VALIDATED'
    or (new.decision='ACCEPT_FOR_GROUPING' and outcome_row.extraction->>'status'<>'OBSERVATION_AVAILABLE')
    or nullif(current_setting('dialektik.actor_id',true),'') is distinct from new.reviewed_by::text
    or current_setting('dialektik.actor_type',true) is distinct from 'editor'
    or not exists(select 1 from public.users u join public.editorial_single_editor_authorizations e
      on e.editor_user_id=u.id where u.id=new.reviewed_by and u.role='editor' and e.revoked_at is null)
    or (new.decision='ACCEPT_FOR_GROUPING' and not exists (
      select 1 from public.headline_ai_attempts a join public.headline_ai_source_grants g on g.id=a.grant_id
      where a.id=new.attempt_id and g.revoked_at is null and g.valid_from<=clock_timestamp()
        and (g.expires_at is null or g.expires_at>clock_timestamp())
        and g.source_policy_id=(select id from public.live_source_policies
          where source_id=g.source_id order by recorded_at desc,id desc limit 1)
        and a.article_version_id=(select id from public.live_article_versions
          where article_id=a.article_id order by version_number desc limit 1)))
    or new.decided_at > clock_timestamp()
  then raise exception 'headline review requires an authorized editor'; end if;
  return new;
end $$;
create trigger headline_ai_review_guard before insert or update or delete on public.headline_ai_review_decisions
  for each row execute function public.dialektik_headline_review_guard();

create function public.dialektik_headline_no_truncate() returns trigger language plpgsql as $$
begin raise exception 'headline review history cannot be truncated'; end $$;
do $$ declare tab text; begin
  foreach tab in array array['headline_ai_source_grants','headline_ai_attempts','headline_ai_attempt_outcomes','headline_ai_review_decisions'] loop
    execute format('create trigger headline_no_truncate before truncate on public.%I for each statement execute function public.dialektik_headline_no_truncate()',tab);
  end loop;
end $$;

do $$ declare tab text; begin
  foreach tab in array array['headline_ai_source_grants','headline_ai_attempts','headline_ai_attempt_outcomes','headline_ai_review_decisions'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('revoke all on public.%I from public, anon, authenticated',tab);
    execute format('grant select on public.%I to dialektik_core_app',tab);
    execute format('create policy headline_core_read on public.%I for select to dialektik_core_app using (true)',tab);
  end loop;
end $$;
grant usage on schema public to dialektik_headline_ai_writer;
grant select on public.headline_ai_source_grants, public.headline_ai_attempts, public.headline_ai_attempt_outcomes
  to dialektik_headline_ai_writer;
grant insert on public.headline_ai_attempts, public.headline_ai_attempt_outcomes to dialektik_headline_ai_writer;
grant insert,update on public.headline_ai_source_grants to dialektik_moderation_writer;
grant insert on public.headline_ai_review_decisions to dialektik_moderation_writer;
create policy headline_ai_read_grants on public.headline_ai_source_grants for select to dialektik_headline_ai_writer using (true);
create policy headline_ai_read_attempts on public.headline_ai_attempts for select to dialektik_headline_ai_writer using (true);
create policy headline_ai_read_outcomes on public.headline_ai_attempt_outcomes for select to dialektik_headline_ai_writer using (true);
create policy headline_ai_insert_attempts on public.headline_ai_attempts for insert to dialektik_headline_ai_writer with check (true);
create policy headline_ai_insert_outcomes on public.headline_ai_attempt_outcomes for insert to dialektik_headline_ai_writer with check (true);
create policy headline_editor_insert_grants on public.headline_ai_source_grants for insert to dialektik_moderation_writer with check (true);
create policy headline_editor_update_grants on public.headline_ai_source_grants for update to dialektik_moderation_writer using (true) with check (true);
create policy headline_editor_insert_reviews on public.headline_ai_review_decisions for insert to dialektik_moderation_writer with check (true);
`;

export const headlineSemanticReviewMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(HEADLINE_REVIEW_SQL).execute(database);
  },
  down(): Promise<void> {
    throw new Error('Headline semantic review history is forward-only.');
  },
};
