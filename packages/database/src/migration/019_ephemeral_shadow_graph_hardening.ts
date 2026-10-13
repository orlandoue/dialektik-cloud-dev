import { sql, type Migration } from 'kysely';

const SCHEMA = String.raw`
create or replace function dialektik_validate_semantic_envelope() returns trigger language plpgsql as $$
declare version observed_article_content_versions; policy content_access_policies; run semantic_provider_runs; current_state text;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.article_version_id::text || new.provider_run_id::text, 18));
  select * into strict version from observed_article_content_versions where id = new.article_version_id;
  select * into strict policy from content_access_policies where id = version.policy_id;
  select * into strict run from semantic_provider_runs where id = new.provider_run_id;
  select processing_state into current_state from semantic_processing_records
    where article_version_id = new.article_version_id and provider_run_id = new.provider_run_id
    order by sequence_number desc limit 1;
  if current_state is distinct from 'PROCESSING' or not policy.derived_semantic_persistence
    or new.normalized_input_hash <> version.normalized_input_hash
    or new.normalization_version <> version.normalization_version
    or new.provider_type <> run.provider_type or new.provider_version <> run.provider_version
    or (run.provider_type = 'v10_11' and version.normalization_version <> 'v10.11-original-fields-identity-v1')
    or new.processed_at < version.acquired_at
    or new.processed_at < (select recorded_at from semantic_processing_records
      where article_version_id = new.article_version_id and provider_run_id = new.provider_run_id
      order by sequence_number desc limit 1) then
    raise exception using errcode = '23514', message = 'envelope requires exact input provider and active processing provenance';
  end if;
  if new.reproducibility_class='FULL_REPLAYABLE' and version.original_title is null then
    raise exception using errcode='23514',message='FULL_REPLAYABLE requires exact retained title and body';
  end if;
  if new.reproducibility_class is distinct from (case
    when policy.content_access_mode = 'FULLTEXT_PERSISTED' and policy.fulltext_persistence and version.persisted_body is not null
      and version.original_title is not null then 'FULL_REPLAYABLE' else 'HASH_VERIFIABLE_REFETCH_REQUIRED' end) then
    raise exception using errcode = '23514', message = 'replay class must reflect legitimate exact input retention';
  end if;
  return new;
end;
$$;
-- Frozen replay needs both separate original fields, not merely a retained body.
create function dialektik_require_exact_replay_title() returns trigger language plpgsql as $$
begin
  if new.reproducibility_class='FULL_REPLAYABLE' and not exists (
    select 1 from observed_article_content_versions v where v.id=new.article_version_id
      and v.original_title is not null and v.persisted_body is not null) then
    raise exception using errcode='23514',message='FULL_REPLAYABLE requires exact retained title and body';
  end if;
  return new;
end;
$$;
create trigger semantic_envelopes_z_exact_title before insert on semantic_envelopes
  for each row execute function dialektik_require_exact_replay_title();
create or replace function dialektik_validate_refetch_verification() returns trigger language plpgsql as $$
declare version observed_article_content_versions;
begin
  select * into strict version from observed_article_content_versions where id = new.article_version_id;
  if new.expected_input_hash <> version.normalized_input_hash or new.expected_title_hash <> version.title_input_hash
    or new.normalization_version <> version.normalization_version or new.verified_at < version.acquired_at
    or not exists (select 1 from semantic_envelopes where article_version_id = version.id)
    or (new.source_version_status = 'HASH_MATCH' and (new.refetched_input_hash is distinct from new.expected_input_hash
      or new.refetched_title_hash is distinct from new.expected_title_hash))
    or (new.source_version_status = 'SOURCE_VERSION_CHANGED' and (new.refetched_input_hash is null or new.refetched_title_hash is null
      or (new.refetched_input_hash = new.expected_input_hash and new.refetched_title_hash = new.expected_title_hash)))
    or (new.source_version_status = 'SOURCE_UNAVAILABLE' and (new.refetched_input_hash is not null or new.refetched_title_hash is not null)) then
    raise exception using errcode = '23514', message = 'refetch verification requires exact historical hash and coherent result';
  end if;
  if new.reproducibility_class is distinct from (case
    when version.persisted_body is not null and version.original_title is not null then 'FULL_REPLAYABLE'
    when new.source_version_status = 'HASH_MATCH' then 'HASH_VERIFIABLE_REFETCH_REQUIRED'
    else 'HISTORICAL_INPUT_NOT_RECONSTRUCTABLE' end) then
    raise exception using errcode = '23514', message = 'refetch replay class must reflect retained or unavailable historical input';
  end if;
  return new;
end;
$$;
-- Native output remains a separate immutable proposal snapshot, never canonical Events.
create table semantic_shadow_graph_snapshots (
  id dialektik_ulid primary key,
  provider_run_id dialektik_ulid not null unique references semantic_provider_runs(id),
  authority text not null check (authority = 'SHADOW_NOT_AUTHORITATIVE'),
  article_decisions_hash text not null check (article_decisions_hash ~ '^[0-9a-f]{64}$'),
  occurrence_memberships_hash text not null check (occurrence_memberships_hash ~ '^[0-9a-f]{64}$'),
  thread_memberships_hash text not null check (thread_memberships_hash ~ '^[0-9a-f]{64}$'),
  occurrence_generations_hash text not null check (occurrence_generations_hash ~ '^[0-9a-f]{64}$'),
  thread_generations_hash text not null check (thread_generations_hash ~ '^[0-9a-f]{64}$'),
  candidate_applicability_hash text not null check (candidate_applicability_hash ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz(3) not null
);
create table semantic_shadow_graph_inputs (
  snapshot_id dialektik_ulid not null references semantic_shadow_graph_snapshots(id),
  article_version_id dialektik_ulid not null references observed_article_content_versions(id),
  envelope_id dialektik_ulid not null references semantic_envelopes(id),
  primary key (snapshot_id, article_version_id),
  unique (snapshot_id, envelope_id)
);
create table semantic_shadow_graph_occurrences (
  snapshot_id dialektik_ulid not null references semantic_shadow_graph_snapshots(id),
  occurrence_key text not null check (occurrence_key ~ '^occurrence:[0-9a-f]{24}$'),
  thread_key text check (thread_key is null or thread_key ~ '^thread:[0-9a-f]{24}$'),
  article_ids text[] not null check (cardinality(article_ids) between 0 and 40),
  generation_hash text not null check (generation_hash ~ '^[0-9a-f]{64}$'),
  primary key (snapshot_id, occurrence_key)
);
create table semantic_shadow_graph_threads (
  snapshot_id dialektik_ulid not null references semantic_shadow_graph_snapshots(id),
  thread_key text not null check (thread_key ~ '^thread:[0-9a-f]{24}$'),
  occurrence_keys text[] not null check (cardinality(occurrence_keys) between 0 and 4096),
  article_ids text[] not null check (cardinality(article_ids) between 0 and 40),
  generation_hash text not null check (generation_hash ~ '^[0-9a-f]{64}$'),
  primary key (snapshot_id, thread_key)
);
create table semantic_shadow_graph_seals (
  snapshot_id dialektik_ulid primary key references semantic_shadow_graph_snapshots(id),
  sealed_at timestamptz(3) not null
);

-- This internal row-version mutex carries no source content or semantic output.
-- Writes from triggers conflict with stale REPEATABLE READ snapshots. Advisory locks alone do not.
create table semantic_content_write_guards (
  scope_kind text not null check (scope_kind in ('ENVELOPE', 'PROVIDER_RUN', 'GRAPH')),
  scope_id dialektik_ulid not null,
  write_number bigint not null default 0 check (write_number >= 0),
  sealed boolean not null default false,
  primary key (scope_kind, scope_id)
);
insert into semantic_content_write_guards(scope_kind, scope_id, sealed)
  select 'PROVIDER_RUN', id, false from semantic_provider_runs;
insert into semantic_content_write_guards(scope_kind, scope_id, sealed)
  select 'ENVELOPE', e.id, coalesce((select processing_state = 'PROCESSED_SHADOW'
    from semantic_processing_records where article_version_id=e.article_version_id
      and provider_run_id=e.provider_run_id order by sequence_number desc limit 1), false)
  from semantic_envelopes e;

create function dialektik_protect_semantic_guard() returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() < 2 then
    raise exception using errcode='23514', message='semantic write guards are internal trigger state';
  end if;
  return new;
end;
$$;
create trigger semantic_content_write_guards_internal before insert or update or delete
  on semantic_content_write_guards for each row execute function dialektik_protect_semantic_guard();
create trigger semantic_content_write_guards_no_truncate before truncate on semantic_content_write_guards
  for each statement execute function dialektik_semantic_content_append_only();

create function dialektik_reserve_semantic_scope(kind text, identity dialektik_ulid, close_scope boolean default false)
returns void language plpgsql as $$
begin
  update semantic_content_write_guards set write_number=write_number+1, sealed=close_scope
    where scope_kind=kind and scope_id=identity and not sealed;
  if not found then
    if kind='ENVELOPE' then
      raise exception using errcode='23514', message='completed envelope children are immutable';
    end if;
    raise exception using errcode='23514', message='completed semantic scope rejects additional children';
  end if;
end;
$$;
create function dialektik_initialize_semantic_guard() returns trigger language plpgsql as $$
begin
  insert into semantic_content_write_guards(scope_kind,scope_id)
    values (case tg_table_name when 'semantic_provider_runs' then 'PROVIDER_RUN'
      when 'semantic_envelopes' then 'ENVELOPE' else 'GRAPH' end,new.id);
  return new;
end;
$$;
create trigger semantic_provider_runs_guard after insert on semantic_provider_runs
  for each row execute function dialektik_initialize_semantic_guard();
create trigger semantic_envelopes_guard after insert on semantic_envelopes
  for each row execute function dialektik_initialize_semantic_guard();
create trigger semantic_graph_snapshot_guard after insert on semantic_shadow_graph_snapshots
  for each row execute function dialektik_initialize_semantic_guard();

create function dialektik_reserve_envelope_run() returns trigger language plpgsql as $$
begin
  perform dialektik_reserve_semantic_scope('PROVIDER_RUN',new.provider_run_id);
  return new;
end;
$$;
create trigger semantic_envelopes_run_open before insert on semantic_envelopes
  for each row execute function dialektik_reserve_envelope_run();
create trigger semantic_graph_snapshot_run_open before insert on semantic_shadow_graph_snapshots
  for each row execute function dialektik_reserve_envelope_run();

create or replace function dialektik_require_open_envelope() returns trigger language plpgsql as $$
declare envelope semantic_envelopes; current_state text;
begin
  select * into strict envelope from semantic_envelopes where id=new.envelope_id;
  perform dialektik_reserve_semantic_scope('ENVELOPE',envelope.id);
  select processing_state into current_state from semantic_processing_records
    where article_version_id=envelope.article_version_id and provider_run_id=envelope.provider_run_id
    order by sequence_number desc limit 1;
  if current_state is distinct from 'PROCESSING' then
    raise exception using errcode='23514', message='completed envelope children are immutable';
  end if;
  return new;
end;
$$;
create function dialektik_seal_processed_envelope() returns trigger language plpgsql as $$
declare envelope_id dialektik_ulid;
begin
  if new.processing_state='PROCESSED_SHADOW' then
    select id into strict envelope_id from semantic_envelopes where article_version_id=new.article_version_id
      and provider_run_id=new.provider_run_id;
    perform dialektik_reserve_semantic_scope('ENVELOPE',envelope_id,true);
  end if;
  return new;
end;
$$;
create trigger semantic_processed_envelope_seal after insert on semantic_processing_records
  for each row execute function dialektik_seal_processed_envelope();

create function dialektik_validate_graph_child() returns trigger language plpgsql as $$
declare snapshot semantic_shadow_graph_snapshots; envelope semantic_envelopes;
begin
  select * into strict snapshot from semantic_shadow_graph_snapshots where id=new.snapshot_id;
  perform dialektik_reserve_semantic_scope('GRAPH',snapshot.id);
  if tg_table_name='semantic_shadow_graph_inputs' then
    select * into strict envelope from semantic_envelopes where id=new.envelope_id;
    if envelope.article_version_id <> new.article_version_id or envelope.provider_run_id <> snapshot.provider_run_id
      or snapshot.recorded_at < envelope.processed_at or not exists (
        select 1 from semantic_processing_records where article_version_id=envelope.article_version_id
          and provider_run_id=envelope.provider_run_id and processing_state='PROCESSED_SHADOW')
      or (select count(*) from semantic_shadow_graph_inputs where snapshot_id=snapshot.id) >= 40
      or exists (select 1 from semantic_shadow_graph_inputs prior
        join observed_article_content_versions pv on pv.id=prior.article_version_id
        join observed_article_content_versions nv on nv.id=new.article_version_id
        where prior.snapshot_id=snapshot.id and pv.article_id=nv.article_id) then
      raise exception using errcode='23514', message='graph input requires unique exact processed envelope version and run';
    end if;
  else
    if array_ndims(new.article_ids) > 1 or exists (select 1 from unnest(new.article_ids) value
      where value is null or value !~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$')
      or cardinality(new.article_ids) <> (select count(distinct value) from unnest(new.article_ids) value) then
      raise exception using errcode='23514', message='graph Article memberships must be a flat unique typed identity list';
    end if;
    if tg_table_name='semantic_shadow_graph_threads' then
      if array_ndims(new.occurrence_keys) > 1
        or exists (select 1 from unnest(new.occurrence_keys) value where value is null or value !~ '^occurrence:[0-9a-f]{24}$')
        or cardinality(new.occurrence_keys) <> (select count(distinct value) from unnest(new.occurrence_keys) value) then
        raise exception using errcode='23514', message='graph Occurrence memberships require unique native keys';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger semantic_graph_inputs_open before insert on semantic_shadow_graph_inputs
  for each row execute function dialektik_validate_graph_child();
create trigger semantic_graph_occurrences_open before insert on semantic_shadow_graph_occurrences
  for each row execute function dialektik_validate_graph_child();
create trigger semantic_graph_threads_open before insert on semantic_shadow_graph_threads
  for each row execute function dialektik_validate_graph_child();

create function dialektik_validate_graph_seal() returns trigger language plpgsql as $$
declare snapshot semantic_shadow_graph_snapshots; input_count integer;
begin
  select * into strict snapshot from semantic_shadow_graph_snapshots where id=new.snapshot_id;
  perform dialektik_reserve_semantic_scope('PROVIDER_RUN',snapshot.provider_run_id,true);
  perform dialektik_reserve_semantic_scope('GRAPH',snapshot.id,true);
  select count(*) into input_count from semantic_shadow_graph_inputs where snapshot_id=snapshot.id;
  if new.sealed_at < snapshot.recorded_at or input_count not between 1 and 40
    or input_count <> (select count(*) from semantic_envelopes where provider_run_id=snapshot.provider_run_id)
    or exists (select 1 from semantic_shadow_graph_inputs i where i.snapshot_id=snapshot.id
      and not exists (select 1 from semantic_article_proposals p where p.envelope_id=i.envelope_id))
    or exists (select 1 from semantic_shadow_graph_occurrences o where o.snapshot_id=snapshot.id
      and coalesce((select array_agg(v.article_id::text order by v.article_id) from semantic_shadow_graph_inputs i
        join observed_article_content_versions v on v.id=i.article_version_id
        join semantic_article_proposals p on p.envelope_id=i.envelope_id
        where i.snapshot_id=snapshot.id and p.proposed_occurrence_key=o.occurrence_key),array[]::text[])
      is distinct from coalesce((select array_agg(member order by member) from unnest(o.article_ids) member),array[]::text[]))
    or exists (select 1 from semantic_shadow_graph_threads t where t.snapshot_id=snapshot.id
      and coalesce((select array_agg(v.article_id::text order by v.article_id) from semantic_shadow_graph_inputs i
        join observed_article_content_versions v on v.id=i.article_version_id
        join semantic_article_proposals p on p.envelope_id=i.envelope_id
        where i.snapshot_id=snapshot.id and p.proposed_thread_key=t.thread_key),array[]::text[])
      is distinct from coalesce((select array_agg(member order by member) from unnest(t.article_ids) member),array[]::text[]))
    or exists (
      select 1 from semantic_shadow_graph_occurrences o cross join lateral unnest(o.article_ids) member
      where o.snapshot_id=snapshot.id and not exists (
        select 1 from semantic_shadow_graph_inputs i join observed_article_content_versions v on v.id=i.article_version_id
        where i.snapshot_id=snapshot.id and v.article_id=member))
    or exists (
      select 1 from semantic_shadow_graph_threads t cross join lateral unnest(t.article_ids) member
      where t.snapshot_id=snapshot.id and not exists (
        select 1 from semantic_shadow_graph_inputs i join observed_article_content_versions v on v.id=i.article_version_id
        where i.snapshot_id=snapshot.id and v.article_id=member))
    or exists (
      select 1 from semantic_shadow_graph_threads t cross join lateral unnest(t.occurrence_keys) member
      where t.snapshot_id=snapshot.id and not exists (
        select 1 from semantic_shadow_graph_occurrences o where o.snapshot_id=snapshot.id
          and o.occurrence_key=member and o.thread_key=t.thread_key))
    or exists (
      select 1 from semantic_shadow_graph_occurrences o where o.snapshot_id=snapshot.id and o.thread_key is not null
        and not exists (select 1 from semantic_shadow_graph_threads t where t.snapshot_id=snapshot.id
          and t.thread_key=o.thread_key and o.occurrence_key=any(t.occurrence_keys)))
    or exists (
      select 1 from semantic_shadow_graph_inputs i join semantic_article_proposals p on p.envelope_id=i.envelope_id
      where i.snapshot_id=snapshot.id and (
        (p.proposed_occurrence_key is not null and not exists (select 1 from semantic_shadow_graph_occurrences o
          where o.snapshot_id=snapshot.id and o.occurrence_key=p.proposed_occurrence_key))
        or (p.proposed_thread_key is not null and not exists (select 1 from semantic_shadow_graph_threads t
          where t.snapshot_id=snapshot.id and t.thread_key=p.proposed_thread_key)))) then
    raise exception using errcode='23514', message='graph seal requires complete exact inputs and linked native memberships';
  end if;
  return new;
end;
$$;
create trigger semantic_graph_seals_validate before insert on semantic_shadow_graph_seals
  for each row execute function dialektik_validate_graph_seal();

-- Quote quotas identify one Article/body hash across raw acquisition or policy versions.
-- Immutable unique reservations backstop stale aggregate snapshots across those versions.
create table semantic_evidence_quote_reservations (
  fingerprint_id dialektik_ulid not null unique references evidence_fingerprints(id),
  article_id dialektik_ulid not null references articles(id),
  normalized_input_hash text not null check (normalized_input_hash ~ '^[0-9a-f]{64}$'),
  budget_start integer not null check (budget_start > 0),
  codepoint_length integer not null check (codepoint_length > 0),
  primary key (article_id,normalized_input_hash,budget_start)
);
insert into semantic_evidence_quote_reservations(fingerprint_id,article_id,normalized_input_hash,budget_start,codepoint_length)
  select f.id,v.article_id,f.normalized_input_hash,
    1 + coalesce(sum(char_length(f.retained_quote)) over (partition by v.article_id,f.normalized_input_hash
      order by v.version_number,f.id rows between unbounded preceding and 1 preceding),0)::integer,
    char_length(f.retained_quote)
  from evidence_fingerprints f join observed_article_content_versions v on v.id=f.article_version_id
  where f.retained_quote is not null;
do $$
begin
  if exists (select 1 from semantic_evidence_quote_reservations q
    join observed_article_content_versions v on v.article_id=q.article_id and v.normalized_input_hash=q.normalized_input_hash
    join content_access_policies p on p.id=v.policy_id
    where p.content_access_mode='FULLTEXT_EPHEMERAL'
    group by q.article_id,q.normalized_input_hash,v.id,v.input_codepoint_length
    having sum(q.codepoint_length) >= v.input_codepoint_length or sum(q.codepoint_length) > 512) then
    raise exception using errcode='23514', message='historical Article body quote aggregate violates ephemeral retention';
  end if;
end;
$$;

create or replace function dialektik_validate_evidence_fingerprint() returns trigger language plpgsql as $$
declare envelope semantic_envelopes; version observed_article_content_versions; policy content_access_policies;
  field_length integer; field_text text; quote_total integer;
begin
  select * into strict envelope from semantic_envelopes where id=new.envelope_id;
  select * into strict version from observed_article_content_versions where id=envelope.article_version_id;
  select * into strict policy from content_access_policies where id=version.policy_id;
  if new.article_version_id <> envelope.article_version_id or new.provider_run_id <> envelope.provider_run_id
    or new.input_hash <> version.acquired_content_hash or new.normalized_input_hash <> version.normalized_input_hash
    or new.normalization_version <> version.normalization_version
    or new.field_hash <> (case when new.field='body' then version.normalized_input_hash else version.title_input_hash end) then
    raise exception using errcode='23514', message='evidence locator requires exact envelope field provenance';
  end if;
  field_length := case when new.field='body' then version.input_codepoint_length else version.title_codepoint_length end;
  if new.span_end > field_length then
    raise exception using errcode='23514', message='evidence codepoint offsets must fit exact observed field';
  end if;
  field_text := case when new.field='body' then version.persisted_body else version.original_title end;
  if field_text is not null and encode(digest(convert_to(substring(field_text from new.span_start+1 for new.span_end-new.span_start),'UTF8'),'sha256'),'hex') <> new.span_hash then
    raise exception using errcode='23514', message='evidence span hash must match exact retained field';
  end if;
  if new.retained_quote is not null then
    if not policy.minimal_evidence_fragment or policy.evidence_quote_max_codepoints=0
      or char_length(new.retained_quote) <> new.span_end-new.span_start
      or encode(digest(convert_to(new.retained_quote,'UTF8'),'sha256'),'hex') <> new.span_hash then
      raise exception using errcode='23514', message='evidence quote requires independent explicit rights and exact span hash';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(version.article_id::text || ':' || version.normalized_input_hash || ':quote-budget',19));
    select coalesce(sum(char_length(f.retained_quote)),0)::integer into quote_total from evidence_fingerprints f
      join observed_article_content_versions v on v.id=f.article_version_id
      where v.article_id=version.article_id and v.normalized_input_hash=version.normalized_input_hash;
    if quote_total+char_length(new.retained_quote) > policy.evidence_quote_max_codepoints
      or (new.field='body' and char_length(new.retained_quote) >= version.input_codepoint_length)
      or (policy.content_access_mode='FULLTEXT_EPHEMERAL'
        and quote_total+char_length(new.retained_quote) >= version.input_codepoint_length) then
      raise exception using errcode='23514', message='minimal evidence budget across Article body versions cannot become complete body retention';
    end if;
    new.quote_budget_start := quote_total+1;
  else new.quote_budget_start := null;
  end if;
  return new;
end;
$$;
create function dialektik_reserve_evidence_quote() returns trigger language plpgsql as $$
declare version observed_article_content_versions;
begin
  if new.retained_quote is not null then
    select * into strict version from observed_article_content_versions where id=new.article_version_id;
    insert into semantic_evidence_quote_reservations values (
      new.id,version.article_id,new.normalized_input_hash,new.quote_budget_start,char_length(new.retained_quote));
  end if;
  return new;
end;
$$;
create trigger semantic_evidence_quote_reserve after insert on evidence_fingerprints
  for each row execute function dialektik_reserve_evidence_quote();
create trigger semantic_evidence_quote_reservations_internal before insert on semantic_evidence_quote_reservations
  for each row execute function dialektik_protect_semantic_guard();

do $$
declare relation text;
begin
  foreach relation in array array['semantic_shadow_graph_snapshots','semantic_shadow_graph_inputs',
    'semantic_shadow_graph_occurrences','semantic_shadow_graph_threads','semantic_shadow_graph_seals',
    'semantic_evidence_quote_reservations'] loop
    execute format('create trigger %I before update or delete on %I for each row execute function dialektik_semantic_content_append_only()',relation || '_immutable',relation);
    execute format('create trigger %I before truncate on %I for each statement execute function dialektik_semantic_content_append_only()',relation || '_no_truncate',relation);
  end loop;
end;
$$;
`;

export const ephemeralShadowGraphHardeningMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
};
