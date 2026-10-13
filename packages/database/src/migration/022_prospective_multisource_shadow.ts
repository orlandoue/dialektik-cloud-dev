import { sql, type Migration } from 'kysely';

/** Owner-approved exact retention and once-only run; legacy effective bound stays forty. */
const SCHEMA = String.raw`
-- Technical MVCC rights fence: no content, semantic identity or policy mutation.
-- Old REPEATABLE READ snapshots must serialize against every policy append.
create table prospective_content_rights_write_guards (
  source_id dialektik_ulid primary key references sources(id),
  revision bigint not null default 0 check (revision >= 0)
);
insert into prospective_content_rights_write_guards(source_id) select id from sources;
create function dialektik_protect_prospective_rights_guard() returns trigger language plpgsql as $$
begin
  if tg_op in ('DELETE','TRUNCATE') or pg_trigger_depth() < 2 then
    raise exception using errcode='23514',message='prospective rights fence is internal technical state';
  end if;
  if tg_op='UPDATE' and (new.source_id <> old.source_id or new.revision <> old.revision+1) then
    raise exception using errcode='23514',message='prospective rights fence revision must advance exactly once';
  end if;
  return new;
end;
$$;
create trigger prospective_rights_guard_internal before insert or update or delete
  on prospective_content_rights_write_guards for each row execute function dialektik_protect_prospective_rights_guard();
create trigger prospective_rights_guard_no_truncate before truncate
  on prospective_content_rights_write_guards for each statement execute function dialektik_protect_prospective_rights_guard();
create function dialektik_fence_content_policy_append() returns trigger language plpgsql as $$
begin
  insert into prospective_content_rights_write_guards(source_id,revision) values (new.source_id,1)
    on conflict (source_id) do update set revision=prospective_content_rights_write_guards.revision+1;
  return new;
end;
$$;
create trigger content_access_policies_rights_fence after insert on content_access_policies
  for each row execute function dialektik_fence_content_policy_append();
create function dialektik_fence_prospective_rights(versions text[]) returns void language plpgsql as $$
declare identity dialektik_ulid;
begin
  for identity in select distinct v.source_id from unnest(versions) input(version_id)
    join observed_article_content_versions v on v.id=input.version_id order by v.source_id loop
    update prospective_content_rights_write_guards set revision=revision+1 where source_id=identity;
    if not found then
      raise exception using errcode='23514',message='prospective rights fence requires existing registered Source';
    end if;
  end loop;
end;
$$;
-- Output checks read grants only; exact retained bytes are authenticated separately.
create function dialektik_validate_prospective_current_rights(versions text[])
returns void language plpgsql as $$
declare current_time_after_fence timestamptz := clock_timestamp();
begin
  if exists (select 1 from unnest(versions) input(version_id)
    left join observed_article_content_versions v on v.id=input.version_id
    left join content_access_policies p on p.id=v.policy_id
    where v.id is null or p.content_access_mode <> 'FULLTEXT_PERSISTED'
      or not p.metadata_storage or not p.fulltext_acquisition or not p.fulltext_machine_processing
      or not p.fulltext_persistence or not p.derived_semantic_persistence
      or p.id is distinct from (select current_policy.id from content_access_policies current_policy
        where current_policy.source_id=v.source_id and current_policy.recorded_at <= current_time_after_fence
        order by current_policy.recorded_at desc,current_policy.id desc limit 1)) then
    raise exception using errcode='23514',message='prospective output requires current exact independent processing and retention grants';
  end if;
end;
$$;
create table prospective_semantic_experiments (
  run_identity text primary key check (run_identity = 'PROSPECTIVE_MULTISOURCE_V10_11_SHADOW_RUN_V1'),
  corpus_identity text not null check (corpus_identity = 'PROSPECTIVE_MULTISOURCE_SHADOW_CORPUS_V1'),
  corpus_manifest_sha256 text not null check (corpus_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  preregistration_sha256 text not null check (preregistration_sha256 ~ '^[0-9a-f]{64}$'),
  exposure_registry_sha256 text not null check (exposure_registry_sha256 ~ '^[0-9a-f]{64}$'),
  candidate_commit text not null check (candidate_commit = 'ea47eb75e955b9a51d15dc0135c81145130553ca'),
  module_closure_sha256 text not null check (module_closure_sha256 = '0305d1a904782f4f9b4d791c16b05cae6e5936ce225fd45b629bf86b5423aac7'),
  runtime_python text not null check (runtime_python = '3.11.9'),
  runtime_model text not null check (runtime_model = 'none'),
  input_count integer not null check (input_count between 3 and 150),
  input_version_ids text[] not null,
  registered_at timestamptz(3) not null,
  check (cardinality(input_version_ids) = input_count and array_ndims(input_version_ids) = 1
    and array_lower(input_version_ids,1) = 1)
);
create table prospective_semantic_reservations (
  run_identity text primary key references prospective_semantic_experiments(run_identity),
  provider_run_id dialektik_ulid not null unique,
  state text not null check (state = 'STARTED'),
  started_at timestamptz(3) not null
);
create table prospective_semantic_outcomes (
  run_identity text primary key references prospective_semantic_reservations(run_identity),
  state text not null check (state in ('COMPLETED','FAILED','UNCERTAIN')),
  recorded_at timestamptz(3) not null
);
create function dialektik_prospective_append_only() returns trigger language plpgsql as $$
begin
  raise exception using errcode='23514',message='prospective registration reservation and outcome are append-only';
end;
$$;
do $$
declare relation text;
begin
  foreach relation in array array['prospective_semantic_experiments',
    'prospective_semantic_reservations','prospective_semantic_outcomes'] loop
    execute format('create trigger %I before update or delete on %I for each row execute function dialektik_prospective_append_only()',relation || '_immutable',relation);
    execute format('create trigger %I before truncate on %I for each statement execute function dialektik_prospective_append_only()',relation || '_no_truncate',relation);
  end loop;
end;
$$;
create function dialektik_validate_prospective_inputs(versions text[], at_time timestamptz)
returns void language plpgsql as $$
begin
  if (select count(distinct v.source_id) from unnest(versions) input(version_id)
      join observed_article_content_versions v on v.id=input.version_id) < 3
    or exists (select 1 from unnest(versions) input(version_id)
      left join observed_article_content_versions v on v.id=input.version_id
      left join content_access_policies p on p.id=v.policy_id
      left join articles a on a.id=v.article_id
      left join sources s on s.id=v.source_id
      where v.id is null or a.origin <> 'LIVE_REAL' or s.origin <> 'LIVE_REAL'
        or a.event_id is not null or v.recorded_at > at_time
        or p.content_access_mode <> 'FULLTEXT_PERSISTED' or not p.metadata_storage
        or not p.fulltext_acquisition or not p.fulltext_machine_processing
        or not p.fulltext_persistence or not p.derived_semantic_persistence
        or p.id is distinct from (select current_policy.id from content_access_policies current_policy
          where current_policy.source_id=v.source_id and current_policy.recorded_at <= at_time
          order by current_policy.recorded_at desc,current_policy.id desc limit 1)
        or v.original_title is null or v.persisted_body is null
        or v.normalization_version <> 'v10.11-original-fields-identity-v1'
        or char_length(v.original_title) <> v.title_codepoint_length
        or char_length(v.persisted_body) <> v.input_codepoint_length
        or encode(digest(convert_to(v.original_title,'UTF8'),'sha256'),'hex') <> v.title_input_hash
        or encode(digest(convert_to(v.persisted_body,'UTF8'),'sha256'),'hex') <> v.normalized_input_hash
        or not exists (select 1 from live_exposure_exclusions e
          join live_exposure_exclusions identity_exclusion on identity_exclusion.id=a.live_exposure_id
          where e.canonical_url=v.canonical_url and e.content_hash=v.normalized_input_hash
            and e.registry_key=identity_exclusion.registry_key
            and e.exclusion_status='PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2')) then
    raise exception using errcode='23514',message='prospective inputs require three Sources, exact retained fields, current independent grants and permanent exposure';
  end if;
end;
$$;
create function dialektik_validate_prospective_experiment() returns trigger language plpgsql as $$
begin
  if exists (select 1 from semantic_provider_runs where run_identity=new.run_identity)
    or exists (select 1 from unnest(new.input_version_ids) input(version_id) where input.version_id is null or input.version_id !~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$')
    or cardinality(new.input_version_ids) <> (select count(distinct input.version_id) from unnest(new.input_version_ids) input(version_id))
    or cardinality(new.input_version_ids) <> (select count(distinct v.article_id) from unnest(new.input_version_ids) input(version_id)
      join observed_article_content_versions v on v.id=input.version_id)
    or exists (select 1 from unnest(new.input_version_ids) input(version_id) join observed_article_content_versions v on v.id=input.version_id
      where v.recorded_at > new.registered_at or v.normalization_version <> 'v10.11-original-fields-identity-v1') then
    raise exception using errcode='23514',message='prospective registration requires unique exact existing input versions before provider output';
  end if;
  perform dialektik_fence_prospective_rights(new.input_version_ids);
  perform dialektik_validate_prospective_inputs(new.input_version_ids,clock_timestamp());
  return new;
end;
$$;
create trigger prospective_semantic_experiments_validate before insert on prospective_semantic_experiments
  for each row execute function dialektik_validate_prospective_experiment();
create function dialektik_validate_prospective_reservation() returns trigger language plpgsql as $$
declare experiment prospective_semantic_experiments;
begin
  select * into strict experiment from prospective_semantic_experiments where run_identity=new.run_identity;
  if new.started_at < experiment.registered_at
    or exists (select 1 from semantic_provider_runs where run_identity=new.run_identity or id=new.provider_run_id) then
    raise exception using errcode='23514',message='prospective STARTED reservation must precede provider output';
  end if;
  perform dialektik_fence_prospective_rights(experiment.input_version_ids);
  perform dialektik_validate_prospective_inputs(experiment.input_version_ids,clock_timestamp());
  return new;
end;
$$;
create trigger prospective_semantic_reservations_validate before insert on prospective_semantic_reservations
  for each row execute function dialektik_validate_prospective_reservation();
create function dialektik_validate_prospective_provider_run() returns trigger language plpgsql as $$
declare experiment prospective_semantic_experiments;
begin
  if new.run_identity='PROSPECTIVE_MULTISOURCE_V10_11_SHADOW_RUN_V1' and not exists (
    select 1 from prospective_semantic_reservations r
    where r.run_identity=new.run_identity and r.provider_run_id=new.id and r.started_at <= new.created_at
      and new.provider_type='v10_11' and new.input_provenance='LIVE_REAL'
      and not exists (select 1 from prospective_semantic_outcomes o where o.run_identity=r.run_identity)) then
    raise exception using errcode='23514',message='prospective provider output requires prior exact active once-only reservation';
  end if;
  if new.run_identity='PROSPECTIVE_MULTISOURCE_V10_11_SHADOW_RUN_V1' then
    select * into strict experiment from prospective_semantic_experiments where run_identity=new.run_identity;
    perform dialektik_fence_prospective_rights(experiment.input_version_ids);
    perform dialektik_validate_prospective_current_rights(experiment.input_version_ids);
  end if;
  return new;
end;
$$;
create trigger semantic_provider_runs_prospective before insert on semantic_provider_runs
  for each row execute function dialektik_validate_prospective_provider_run();
create function dialektik_validate_prospective_envelope() returns trigger language plpgsql as $$
declare experiment prospective_semantic_experiments;
begin
  if exists (select 1 from semantic_provider_runs r
    where r.id=new.provider_run_id and r.run_identity='PROSPECTIVE_MULTISOURCE_V10_11_SHADOW_RUN_V1') and not exists (
    select 1 from prospective_semantic_experiments e join prospective_semantic_reservations r on r.run_identity=e.run_identity
    where r.provider_run_id=new.provider_run_id and new.article_version_id::text=any(e.input_version_ids)
      and new.reproducibility_class='FULL_REPLAYABLE'
      and not exists (select 1 from prospective_semantic_outcomes o where o.run_identity=e.run_identity)) then
    raise exception using errcode='23514',message='prospective envelope requires exact frozen corpus input';
  end if;
  if exists (select 1 from semantic_provider_runs r
    where r.id=new.provider_run_id and r.run_identity='PROSPECTIVE_MULTISOURCE_V10_11_SHADOW_RUN_V1') then
    select e.* into strict experiment from prospective_semantic_experiments e
      join prospective_semantic_reservations reservation on reservation.run_identity=e.run_identity
      where reservation.provider_run_id=new.provider_run_id;
    perform dialektik_fence_prospective_rights(experiment.input_version_ids);
    perform dialektik_validate_prospective_current_rights(experiment.input_version_ids);
  end if;
  return new;
end;
$$;
create trigger semantic_envelopes_prospective before insert on semantic_envelopes
  for each row execute function dialektik_validate_prospective_envelope();
create function dialektik_validate_prospective_semantic_append() returns trigger language plpgsql as $$
declare run_id dialektik_ulid; experiment prospective_semantic_experiments;
begin
  if tg_table_name='semantic_processing_records' then
    if new.processing_state <> 'PROCESSED_SHADOW' then
      return new; -- Failure/operational transitions remain available for forensic stop.
    end if;
  end if;
  if tg_table_name='derived_semantic_observations' then
    select provider_run_id into strict run_id from semantic_envelopes where id=new.envelope_id;
  elsif tg_table_name in ('semantic_shadow_graph_inputs','semantic_shadow_graph_occurrences',
    'semantic_shadow_graph_threads','semantic_shadow_graph_seals') then
    select provider_run_id into strict run_id from semantic_shadow_graph_snapshots where id=new.snapshot_id;
  else
    run_id := new.provider_run_id;
  end if;
  if not exists (select 1 from semantic_provider_runs where id=run_id
    and run_identity='PROSPECTIVE_MULTISOURCE_V10_11_SHADOW_RUN_V1') then return new; end if;
  select e.* into strict experiment from prospective_semantic_experiments e
    join prospective_semantic_reservations r on r.run_identity=e.run_identity
    where r.provider_run_id=run_id;
  if exists (select 1 from prospective_semantic_outcomes where run_identity=experiment.run_identity) then
    raise exception using errcode='23514',message='prospective semantic output requires active once-only reservation';
  end if;
  perform dialektik_fence_prospective_rights(experiment.input_version_ids);
  perform dialektik_validate_prospective_current_rights(experiment.input_version_ids);
  return new;
end;
$$;
do $$
declare relation text;
begin
  foreach relation in array array['semantic_article_proposals','semantic_candidate_applicability',
    'derived_semantic_observations','evidence_fingerprints','semantic_native_diagnostic_receipts',
    'semantic_shadow_graph_snapshots','semantic_shadow_graph_inputs','semantic_shadow_graph_occurrences',
    'semantic_shadow_graph_threads','semantic_shadow_graph_seals','semantic_processing_records'] loop
    execute format('create trigger aa_prospective_current_rights before insert on %I for each row execute function dialektik_validate_prospective_semantic_append()',relation);
  end loop;
end;
$$;
create function dialektik_validate_prospective_outcome() returns trigger language plpgsql as $$
declare reservation prospective_semantic_reservations;
begin
  select * into strict reservation from prospective_semantic_reservations where run_identity=new.run_identity;
  if new.state='COMPLETED' then
    perform dialektik_fence_prospective_rights((select input_version_ids from prospective_semantic_experiments where run_identity=new.run_identity));
    perform dialektik_validate_prospective_current_rights((select input_version_ids from prospective_semantic_experiments where run_identity=new.run_identity));
  end if;
  if new.recorded_at < reservation.started_at or (new.state='COMPLETED' and not exists (
    select 1 from semantic_shadow_graph_snapshots g join semantic_shadow_graph_seals seal on seal.snapshot_id=g.id
    join prospective_semantic_experiments e on e.run_identity=reservation.run_identity
    where g.provider_run_id=reservation.provider_run_id and seal.sealed_at <= new.recorded_at
      and e.input_count=(select count(*) from semantic_shadow_graph_inputs i where i.snapshot_id=g.id)
      and not exists (select 1 from semantic_shadow_graph_inputs i where i.snapshot_id=g.id
        and not (i.article_version_id::text=any(e.input_version_ids))))) then
    raise exception using errcode='23514',message='prospective completion requires sealed graph and coherent reservation timestamp';
  end if;
  return new;
end;
$$;
create trigger prospective_semantic_outcomes_validate before insert on prospective_semantic_outcomes
  for each row execute function dialektik_validate_prospective_outcome();

  -- Authenticated bound calculation: all non-prospective runs stay at forty.
create function dialektik_graph_article_limit(run_id dialektik_ulid) returns integer language plpgsql as $$
begin
  if exists (select 1 from semantic_provider_runs r
    where r.id=run_id and r.run_identity='PROSPECTIVE_MULTISOURCE_V10_11_SHADOW_RUN_V1') then
    if not exists (select 1 from semantic_provider_runs r
      join prospective_semantic_experiments e on e.run_identity=r.run_identity
      join prospective_semantic_reservations reservation on reservation.run_identity=e.run_identity
      where r.id=run_id and reservation.provider_run_id=r.id and r.provider_type='v10_11'
        and r.input_provenance='LIVE_REAL'
        and not exists (select 1 from prospective_semantic_outcomes o where o.run_identity=e.run_identity)) then
      raise exception using errcode='23514',message='expanded graph bound requires active exact prospective reservation';
    end if;
    return 150;
  end if;
  return 40;
end;
$$;

-- PROPOSAL ONLY. This .sql.txt artifact is never executed.
-- Append inside the new022 SCHEMA only after explicit owner approval of this shape.
-- Kysely forward migration wraps ALL of022 in one PostgreSQL transaction.
-- Existing019 functions below are byte-identical except CREATE OR REPLACE and
-- their one literal40 bound. All identity/processing/membership/seal checks remain.
-- Required existing022 helper: dialektik_graph_article_limit(provider_run_id).
-- It returns150 only for exact active registered/reserved prospective frozen run;
-- every other identity/unknown ID returns40; terminal new identity raises.
create or replace function dialektik_validate_graph_child() returns trigger language plpgsql as $$
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
      or (select count(*) from semantic_shadow_graph_inputs where snapshot_id=snapshot.id) >= dialektik_graph_article_limit(snapshot.provider_run_id)
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
create or replace function dialektik_validate_graph_seal() returns trigger language plpgsql as $$
declare snapshot semantic_shadow_graph_snapshots; input_count integer;
begin
  select * into strict snapshot from semantic_shadow_graph_snapshots where id=new.snapshot_id;
  perform dialektik_reserve_semantic_scope('PROVIDER_RUN',snapshot.provider_run_id,true);
  perform dialektik_reserve_semantic_scope('GRAPH',snapshot.id,true);
  select count(*) into input_count from semantic_shadow_graph_inputs where snapshot_id=snapshot.id;
  if new.sealed_at < snapshot.recorded_at or input_count not between 1 and dialektik_graph_article_limit(snapshot.provider_run_id)
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
-- Independent array bound guards replace historical CHECK40 semantics for every
-- legacy/fixture INSERT. Existing019 immutable/no-truncate guards remain intact.
create function dialektik_validate_graph_membership_bound() returns trigger language plpgsql as $$
declare run_id dialektik_ulid;
begin
  select provider_run_id into strict run_id from semantic_shadow_graph_snapshots where id=new.snapshot_id;
  if cardinality(new.article_ids) > dialektik_graph_article_limit(run_id) then
    raise exception using errcode='23514',message='graph Article memberships exceed the registered run limit';
  end if;
  return new;
end;
$$;
create trigger semantic_graph_occurrences_bound before insert on semantic_shadow_graph_occurrences
  for each row execute function dialektik_validate_graph_membership_bound();
create trigger semantic_graph_threads_bound before insert on semantic_shadow_graph_threads
  for each row execute function dialektik_validate_graph_membership_bound();

-- Global storage ceiling alone grants no run permission: guards above enforce40
-- on all old identities and150 exclusively on the exact prospective reservation.
alter table semantic_shadow_graph_occurrences drop constraint semantic_shadow_graph_occurrences_article_ids_check;
alter table semantic_shadow_graph_occurrences add constraint semantic_shadow_graph_occurrences_article_ids_check
  check (cardinality(article_ids) between 0 and 150);
alter table semantic_shadow_graph_threads drop constraint semantic_shadow_graph_threads_article_ids_check;
alter table semantic_shadow_graph_threads add constraint semantic_shadow_graph_threads_article_ids_check
  check (cardinality(article_ids) between 0 and 150);

-- The new run must seal every exact frozen content version, with no omissions.
create function dialektik_validate_prospective_graph_seal() returns trigger language plpgsql as $$
begin
  if exists (select 1 from semantic_shadow_graph_snapshots g join semantic_provider_runs r on r.id=g.provider_run_id
    where g.id=new.snapshot_id and r.run_identity='PROSPECTIVE_MULTISOURCE_V10_11_SHADOW_RUN_V1') and not exists (
      select 1 from prospective_semantic_experiments e join prospective_semantic_reservations reservation on reservation.run_identity=e.run_identity
      join semantic_shadow_graph_snapshots g on g.provider_run_id=reservation.provider_run_id
      where g.id=new.snapshot_id and e.input_count=(select count(*) from semantic_shadow_graph_inputs i where i.snapshot_id=g.id)
        and not exists (select 1 from semantic_shadow_graph_inputs i where i.snapshot_id=g.id
          and not (i.article_version_id::text=any(e.input_version_ids)))) then
    raise exception using errcode='23514',message='prospective seal requires the complete frozen corpus version set';
  end if;
  return new;
end;
$$;
create trigger semantic_graph_seals_prospective before insert on semantic_shadow_graph_seals
  for each row execute function dialektik_validate_prospective_graph_seal();
`;

export const prospectiveMultisourceShadowMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
};
