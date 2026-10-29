import { sql, type Migration } from 'kysely';

/** Private, provisional cross-source title comparisons. They do not publish Events. */
const HEADLINE_CONTEXT_PAIR_SQL = String.raw`
create table public.headline_context_pair_attempts (
  id dialektik_ulid primary key,
  left_article_id dialektik_ulid not null references public.articles(id),
  left_version_id dialektik_ulid not null references public.live_article_versions(id),
  left_grant_id dialektik_ulid not null references public.headline_ai_source_grants(id),
  left_title_sha256 text not null check (left_title_sha256 ~ '^[0-9a-f]{64}$'),
  right_article_id dialektik_ulid not null references public.articles(id),
  right_version_id dialektik_ulid not null references public.live_article_versions(id),
  right_grant_id dialektik_ulid not null references public.headline_ai_source_grants(id),
  right_title_sha256 text not null check (right_title_sha256 ~ '^[0-9a-f]{64}$'),
  requested_by dialektik_ulid not null references public.users(id),
  model text not null check (length(model) between 1 and 128),
  config_sha256 text not null check (config_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz(3) not null,
  check (left_article_id < right_article_id),
  unique(left_version_id,right_version_id,left_grant_id,right_grant_id,model,config_sha256)
);

create table public.headline_context_pair_outcomes (
  attempt_id dialektik_ulid primary key references public.headline_context_pair_attempts(id),
  outcome text not null check (outcome in ('VALIDATED','REJECTED','UNKNOWN_SENT','RIGHTS_REVOKED')),
  relation text check (relation in ('POSSIBLY_SAME_EVENT','POSSIBLY_SAME_THREAD','UNRELATED','UNCERTAIN')),
  left_start integer, left_end integer, right_start integer, right_end integer,
  recorded_at timestamptz(3) not null,
  check ((outcome='VALIDATED' and relation is not null) or (outcome<>'VALIDATED' and relation is null)),
  check ((relation in ('POSSIBLY_SAME_EVENT','POSSIBLY_SAME_THREAD') and
          left_start is not null and left_end is not null and right_start is not null and right_end is not null)
      or (relation is distinct from 'POSSIBLY_SAME_EVENT' and relation is distinct from 'POSSIBLY_SAME_THREAD'
          and left_start is null and left_end is null and right_start is null and right_end is null))
);

create table public.headline_context_pair_decisions (
  id dialektik_ulid primary key,
  attempt_id dialektik_ulid not null unique references public.headline_context_pair_attempts(id),
  reviewed_by dialektik_ulid not null references public.users(id),
  decision text not null check (decision in ('KEEP_FOR_REVIEW','NEEDS_EVIDENCE','DISMISS')),
  decided_at timestamptz(3) not null
);

create function public.dialektik_context_title_authorized(
  article_key dialektik_ulid, version_key dialektik_ulid, grant_key dialektik_ulid,
  title_digest text, editor_key dialektik_ulid
) returns boolean language sql stable as $$
  select exists (
    select 1 from public.articles a
    join public.sources s on s.id=a.source_id and s.origin='LIVE_REAL'
    join public.live_article_versions v on v.id=version_key and v.article_id=a.id
      and v.id=(select id from public.live_article_versions where article_id=a.id order by version_number desc limit 1)
    join public.live_acquisition_receipts r on r.id=v.receipt_id and r.disposition='PERSISTED'
      and r.source_id=a.source_id and r.exclusion_id=a.live_exposure_id and r.canonical_url=a.url_canonical
    join public.headline_ai_source_grants g on g.id=grant_key and g.source_id=a.source_id
      and g.provider='CLOUDFLARE_WORKERS_AI' and g.scope='HEADLINE_ONLY' and g.derived_scope='EDITORIAL_REVIEW_ONLY'
      and g.revoked_at is null and g.valid_from<=clock_timestamp()
      and (g.expires_at is null or g.expires_at>clock_timestamp())
    join public.live_source_policies p on p.id=g.source_policy_id and p.source_id=a.source_id
      and p.id=(select id from public.live_source_policies where source_id=a.source_id order by recorded_at desc,id desc limit 1)
      and p.active and p.rights_class='LIVE_READY' and p.storage_policy='METADATA_ONLY'
      and p.policy->>'rightsReviewStatus'='APPROVED'
    join public.users approver on approver.id=g.approved_by and approver.role='editor'
    join public.editorial_single_editor_authorizations approval on approval.editor_user_id=approver.id and approval.revoked_at is null
    join public.users u on u.id=editor_key and u.role='editor'
    join public.editorial_single_editor_authorizations e on e.editor_user_id=u.id and e.revoked_at is null
    where a.id=article_key and a.origin='LIVE_REAL'
      and char_length(v.headline) between 1 and 512 and btrim(v.headline)<>'' and v.headline !~ '[[:cntrl:]]'
      and (a.url_canonical like ('https://' || s.canonical_domain || '/%')
        or a.url_canonical like ('https://www.' || s.canonical_domain || '/%'))
      and encode(sha256(convert_to(v.headline,'UTF8')),'hex')=title_digest
      and coalesce((select case when jsonb_typeof(q.policy->'quarantinedArticleIds')='array'
        then not (q.policy->'quarantinedArticleIds' @> jsonb_build_array(a.id::text)) else false end
        from public.live_source_policies q where q.source_id=a.source_id and q.policy ? 'quarantinedArticleIds'
        order by q.recorded_at desc,q.id desc limit 1),true)
  );
$$;

create function public.dialektik_context_pair_attempt_guard() returns trigger language plpgsql as $$
declare left_row public.articles; right_row public.articles; left_v public.live_article_versions; right_v public.live_article_versions;
begin
  if tg_op<>'INSERT' then raise exception 'context pair attempt history is append-only'; end if;
  perform pg_advisory_xact_lock(hashtextextended('headline-context-pair-daily-budget',0));
  if (select count(*) from public.headline_context_pair_attempts where created_at>clock_timestamp()-interval '24 hours')>=30 then
    raise exception 'context pair daily attempt limit reached';
  end if;
  select * into left_row from public.articles where id=new.left_article_id;
  select * into right_row from public.articles where id=new.right_article_id;
  select * into left_v from public.live_article_versions where id=new.left_version_id;
  select * into right_v from public.live_article_versions where id=new.right_version_id;
  if left_row.id is null or right_row.id is null or left_row.source_id=right_row.source_id
    or left_v.published_at is null or right_v.published_at is null
    or abs(extract(epoch from (left_v.published_at-right_v.published_at)))>259200
    or not public.dialektik_context_title_authorized(new.left_article_id,new.left_version_id,new.left_grant_id,new.left_title_sha256,new.requested_by)
    or not public.dialektik_context_title_authorized(new.right_article_id,new.right_version_id,new.right_grant_id,new.right_title_sha256,new.requested_by)
    or new.created_at>clock_timestamp()+interval '1 millisecond' or new.created_at<clock_timestamp()-interval '1 minute'
  then raise exception 'context pair lacks current authorization or provenance'; end if;
  return new;
end $$;
create trigger context_pair_attempt_guard before insert or update or delete on public.headline_context_pair_attempts
  for each row execute function public.dialektik_context_pair_attempt_guard();

create function public.dialektik_context_pair_outcome_guard() returns trigger language plpgsql as $$
declare a public.headline_context_pair_attempts; left_v public.live_article_versions; right_v public.live_article_versions; anchor text;
begin
  if tg_op<>'INSERT' then raise exception 'context pair outcome history is append-only'; end if;
  select * into strict a from public.headline_context_pair_attempts where id=new.attempt_id;
  if new.recorded_at<a.created_at or new.recorded_at>clock_timestamp()+interval '1 millisecond' then raise exception 'context pair outcome time invalid'; end if;
  if new.outcome<>'VALIDATED' then return new; end if;
  if not public.dialektik_context_title_authorized(a.left_article_id,a.left_version_id,a.left_grant_id,a.left_title_sha256,a.requested_by)
    or not public.dialektik_context_title_authorized(a.right_article_id,a.right_version_id,a.right_grant_id,a.right_title_sha256,a.requested_by)
  then raise exception 'context pair authorization is no longer current'; end if;
  if new.relation in ('POSSIBLY_SAME_EVENT','POSSIBLY_SAME_THREAD') then
    select * into strict left_v from public.live_article_versions where id=a.left_version_id;
    select * into strict right_v from public.live_article_versions where id=a.right_version_id;
    if new.left_start<0 or new.right_start<0 or new.left_end<=new.left_start or new.right_end<=new.right_start
      or new.left_end>char_length(left_v.headline) or new.right_end>char_length(right_v.headline)
      or new.left_end-new.left_start not between 4 and 80
      or new.right_end-new.right_start<>new.left_end-new.left_start
    then raise exception 'context pair anchor offsets are invalid'; end if;
    anchor:=substring(left_v.headline from new.left_start+1 for new.left_end-new.left_start);
    if anchor is distinct from substring(right_v.headline from new.right_start+1 for new.right_end-new.right_start)
      or lower(anchor)=any(array['gobierno','presidente','chile','país','nacional','nuevo','nueva','caso','sistema','proyecto','autoridades'])
    then raise exception 'context pair anchor is not shared'; end if;
  end if;
  return new;
end $$;
create trigger context_pair_outcome_guard before insert or update or delete on public.headline_context_pair_outcomes
  for each row execute function public.dialektik_context_pair_outcome_guard();

create function public.dialektik_context_pair_decision_guard() returns trigger language plpgsql as $$
declare a public.headline_context_pair_attempts; o public.headline_context_pair_outcomes;
begin
  if tg_op<>'INSERT' then raise exception 'context pair review history is append-only'; end if;
  select * into strict a from public.headline_context_pair_attempts where id=new.attempt_id;
  select * into strict o from public.headline_context_pair_outcomes where attempt_id=new.attempt_id;
  if o.outcome<>'VALIDATED' or nullif(current_setting('dialektik.actor_id',true),'') is distinct from new.reviewed_by::text
    or current_setting('dialektik.actor_type',true) is distinct from 'editor'
    or not exists(select 1 from public.users u join public.editorial_single_editor_authorizations e
      on e.editor_user_id=u.id where u.id=new.reviewed_by and u.role='editor' and e.revoked_at is null)
    or (new.decision='KEEP_FOR_REVIEW' and o.relation not in ('POSSIBLY_SAME_EVENT','POSSIBLY_SAME_THREAD'))
    or not public.dialektik_context_title_authorized(a.left_article_id,a.left_version_id,a.left_grant_id,a.left_title_sha256,new.reviewed_by)
    or not public.dialektik_context_title_authorized(a.right_article_id,a.right_version_id,a.right_grant_id,a.right_title_sha256,new.reviewed_by)
    or new.decided_at>clock_timestamp()+interval '1 millisecond'
  then raise exception 'context pair decision requires current editor and source rights'; end if;
  return new;
end $$;
create trigger context_pair_decision_guard before insert or update or delete on public.headline_context_pair_decisions
  for each row execute function public.dialektik_context_pair_decision_guard();

revoke all on function public.dialektik_context_title_authorized(dialektik_ulid,dialektik_ulid,dialektik_ulid,text,dialektik_ulid)
  from public,anon,authenticated;
revoke all on function public.dialektik_context_pair_attempt_guard(),public.dialektik_context_pair_outcome_guard(),
  public.dialektik_context_pair_decision_guard() from public,anon,authenticated;
grant execute on function public.dialektik_context_title_authorized(dialektik_ulid,dialektik_ulid,dialektik_ulid,text,dialektik_ulid)
  to dialektik_core_app,dialektik_headline_ai_writer,dialektik_moderation_writer;
grant execute on function public.dialektik_context_pair_attempt_guard(),public.dialektik_context_pair_outcome_guard(),
  public.dialektik_context_pair_decision_guard() to dialektik_headline_ai_writer,dialektik_moderation_writer;

do $$ declare tab text; begin
  foreach tab in array array['headline_context_pair_attempts','headline_context_pair_outcomes','headline_context_pair_decisions'] loop
    execute format('create trigger context_pair_no_truncate before truncate on public.%I for each statement execute function public.dialektik_headline_no_truncate()',tab);
    execute format('alter table public.%I enable row level security',tab);
    execute format('revoke all on public.%I from public, anon, authenticated',tab);
    execute format('grant select on public.%I to dialektik_core_app',tab);
    execute format('create policy context_core_read on public.%I for select to dialektik_core_app using (true)',tab);
  end loop;
end $$;
grant select,insert on public.headline_context_pair_attempts,public.headline_context_pair_outcomes to dialektik_headline_ai_writer;
grant insert on public.headline_context_pair_decisions to dialektik_moderation_writer;
create policy context_ai_read_attempts on public.headline_context_pair_attempts for select to dialektik_headline_ai_writer using (true);
create policy context_ai_insert_attempts on public.headline_context_pair_attempts for insert to dialektik_headline_ai_writer with check (true);
create policy context_ai_read_outcomes on public.headline_context_pair_outcomes for select to dialektik_headline_ai_writer using (true);
create policy context_ai_insert_outcomes on public.headline_context_pair_outcomes for insert to dialektik_headline_ai_writer with check (true);
create policy context_editor_insert_decisions on public.headline_context_pair_decisions for insert to dialektik_moderation_writer with check (true);
`;

export const headlineContextPairReviewMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(HEADLINE_CONTEXT_PAIR_SQL).execute(database);
  },
  async down(): Promise<void> {
    throw new Error('Context review audit history must be preserved.');
  },
};
