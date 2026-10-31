import { sql, type Migration } from 'kysely';

const SCHEMA = String.raw`
do $repair$
declare
  candidate_count integer;
  repaired_count integer;
  editor_id dialektik_ulid := '01M4YDQK00ED1T0R0R1AND0VE1';
begin
  if not exists(select 1 from public.users where id=editor_id and role='editor') then
    raise exception 'MIGRATION_071_EDITOR_NOT_ACTIVE';
  end if;

  with candidates as (
    select source.id,source.name,source.canonical_domain,latest_policy.id as policy_id,
      latest_policy.registry_key,latest_policy.rights_class,latest_policy.storage_policy,
      latest_policy.active,latest_policy.rights_evidence_url,latest_policy.rights_verified_at,
      latest_policy.policy,connection.endpoint,decision.id as decision_id,
      decision.rights_evidence_url as decision_rights_evidence_url
    from public.sources source
    join lateral (
      select policy.* from public.live_source_policies policy
      where policy.source_id=source.id
      order by policy.recorded_at desc,policy.id desc limit 1
    ) latest_policy on true
    join lateral (
      select connection.* from public.corporate_live_source_connections connection
      where connection.source_id=source.id
      order by connection.sequence_number desc limit 1
    ) connection on connection.active and connection.approved_by=editor_id
    join public.personal_owner_source_rights_decisions decision
      on decision.id=connection.rights_decision_id
      and decision.source_id=source.id
      and decision.owner_identity='orlandoue'
    where source.origin='LIVE_REAL'
      and source.canonical_domain in (
        'biobiochile.cl','ciperchile.cl','cooperativa.cl',
        'diarioeldia.cl','elmostrador.cl','latercera.com'
      )
      and latest_policy.active
      and latest_policy.rights_class='LIVE_READY'
      and latest_policy.storage_policy='METADATA_AND_FEED_EXCERPT'
      and latest_policy.policy->>'endpoint'=connection.endpoint
      and decision.decision_status='AUTHORIZED'
      and decision.local_processing
      and decision.valid_from<=statement_timestamp()
      and (decision.expires_at is null or decision.expires_at>statement_timestamp())
      and decision.scopes->>'acquisition'='true'
      and decision.scopes->>'metadata_storage'='true'
      and decision.scopes->>'excerpt_storage'='true'
      and decision.scopes->>'fulltext_acquisition'='false'
      and decision.scopes->>'fulltext_persistence'='false'
      and decision.decision_provenance like
        ('EDITOR_APPROVED_CORPORATE_LIVE_ACQUISITION:'||editor_id::text||':%')
      and decision.rights_evidence_url=latest_policy.rights_evidence_url
  )
  select count(*) into candidate_count from candidates;

  if candidate_count<>6 then
    raise exception 'MIGRATION_071_APPROVED_PRESS_SOURCE_COUNT_INVALID: %',candidate_count;
  end if;

  with candidates as (
    select source.id,latest_policy.registry_key,latest_policy.rights_class,
      latest_policy.storage_policy,latest_policy.active,latest_policy.rights_evidence_url,
      latest_policy.rights_verified_at,latest_policy.policy,connection.endpoint,
      decision.id as decision_id,decision.rights_evidence_url as decision_rights_evidence_url
    from public.sources source
    join lateral (
      select policy.* from public.live_source_policies policy
      where policy.source_id=source.id
      order by policy.recorded_at desc,policy.id desc limit 1
    ) latest_policy on true
    join lateral (
      select connection.* from public.corporate_live_source_connections connection
      where connection.source_id=source.id
      order by connection.sequence_number desc limit 1
    ) connection on connection.active and connection.approved_by=editor_id
    join public.personal_owner_source_rights_decisions decision
      on decision.id=connection.rights_decision_id
      and decision.source_id=source.id
      and decision.owner_identity='orlandoue'
    where source.origin='LIVE_REAL'
      and source.canonical_domain in (
        'biobiochile.cl','ciperchile.cl','cooperativa.cl',
        'diarioeldia.cl','elmostrador.cl','latercera.com'
      )
      and latest_policy.active
      and latest_policy.rights_class='LIVE_READY'
      and latest_policy.storage_policy='METADATA_AND_FEED_EXCERPT'
      and latest_policy.policy->>'endpoint'=connection.endpoint
      and decision.decision_status='AUTHORIZED'
      and decision.local_processing
      and decision.valid_from<=statement_timestamp()
      and (decision.expires_at is null or decision.expires_at>statement_timestamp())
      and decision.scopes->>'acquisition'='true'
      and decision.scopes->>'metadata_storage'='true'
      and decision.scopes->>'excerpt_storage'='true'
      and decision.scopes->>'fulltext_acquisition'='false'
      and decision.scopes->>'fulltext_persistence'='false'
      and decision.decision_provenance like
        ('EDITOR_APPROVED_CORPORATE_LIVE_ACQUISITION:'||editor_id::text||':%')
      and decision.rights_evidence_url=latest_policy.rights_evidence_url
  )
  insert into public.live_source_policies
    (id,source_id,registry_key,rights_class,storage_policy,active,rights_evidence_url,
     rights_verified_at,policy,recorded_at)
  select encode(extensions.digest(convert_to(
      'dialektik-corporate-live-approval-policy-v1'||E'\n'||candidate.id::text||E'\n'||
      candidate.decision_id::text||E'\n'||candidate.registry_key,'UTF8'),'sha256'),'hex'),
    candidate.id,candidate.registry_key,candidate.rights_class,candidate.storage_policy,
    candidate.active,candidate.rights_evidence_url,candidate.rights_verified_at,
    candidate.policy||jsonb_build_object(
      'rightsReviewStatus','APPROVED',
      'authorizationReference','EDITOR_SOURCE_RIGHTS_DECISION:'||candidate.decision_id::text,
      'rightsEvidenceUrl',candidate.decision_rights_evidence_url,
      'endpoint',candidate.endpoint
    ),clock_timestamp()
  from candidates candidate
  on conflict(id) do nothing;

  select count(*) into repaired_count
  from public.sources source
  join lateral (
    select policy.* from public.live_source_policies policy
    where policy.source_id=source.id
    order by policy.recorded_at desc,policy.id desc limit 1
  ) latest_policy on true
  where source.origin='LIVE_REAL'
    and source.canonical_domain in (
      'biobiochile.cl','ciperchile.cl','cooperativa.cl',
      'diarioeldia.cl','elmostrador.cl','latercera.com'
    )
    and latest_policy.active
    and latest_policy.rights_class='LIVE_READY'
    and latest_policy.storage_policy='METADATA_AND_FEED_EXCERPT'
    and latest_policy.policy->>'rightsReviewStatus'='APPROVED'
    and nullif(latest_policy.policy->>'authorizationReference','') is not null;

  if repaired_count<>6 then
    raise exception 'MIGRATION_071_PRESS_POLICY_REPAIR_INCOMPLETE: %',repaired_count;
  end if;
end;
$repair$;
`;

export const restoreCorporateLiveApprovalMetadataDdl = { schema: SCHEMA } as const;

export const restoreCorporateLiveApprovalMetadataMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(restoreCorporateLiveApprovalMetadataDdl.schema).execute(database);
  },
  async down(): Promise<void> {
    throw new Error('Corporate live source approval history is append-only and requires explicit review.');
  },
};
