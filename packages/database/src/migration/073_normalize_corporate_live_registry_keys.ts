import { sql, type Migration } from 'kysely';

const SCHEMA = String.raw`
do $normalize$
declare
  candidate_count integer;
  normalized_count integer;
  editor_id dialektik_ulid := '01M4YDQK00ED1T0R0R1AND0VE1';
begin
  with candidates as (
    select source.id,latest_policy.rights_class,latest_policy.storage_policy,
      latest_policy.active,latest_policy.rights_evidence_url,latest_policy.rights_verified_at,
      latest_policy.policy,connection.endpoint,decision.id as decision_id,
      decision.rights_evidence_url as decision_rights_evidence_url,
      regexp_replace(latest_policy.registry_key,'^(corporate-)+','') as base_registry_key
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
      and latest_policy.policy->>'rightsReviewStatus'='APPROVED'
      and nullif(latest_policy.policy->>'authorizationReference','') is not null
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
  select count(*) into candidate_count from candidates
  where base_registry_key in (
    'chile-rss-biobiochile-v1','chile-rss-ciperchile-v1',
    'chile-rss-cooperativa-v1','chile-rss-diarioeldia-v1',
    'chile-rss-elmostrador-v1','chile-rss-latercera-v1'
  );

  if candidate_count<>6 then
    raise exception 'MIGRATION_073_APPROVED_PRESS_SOURCE_COUNT_INVALID: %',candidate_count;
  end if;

  with candidates as (
    select source.id,latest_policy.rights_class,latest_policy.storage_policy,
      latest_policy.active,latest_policy.rights_evidence_url,latest_policy.rights_verified_at,
      latest_policy.policy,connection.endpoint,decision.id as decision_id,
      decision.rights_evidence_url as decision_rights_evidence_url,
      regexp_replace(latest_policy.registry_key,'^(corporate-)+','') as base_registry_key
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
      and latest_policy.policy->>'rightsReviewStatus'='APPROVED'
      and nullif(latest_policy.policy->>'authorizationReference','') is not null
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
  ), registry_keys as (
    select candidate.*,target.registry_key,target.is_canonical
    from candidates candidate
    cross join lateral (values
      (candidate.base_registry_key,true),
      ('corporate-'||candidate.base_registry_key,false),
      ('corporate-corporate-'||candidate.base_registry_key,false),
      ('corporate-corporate-corporate-'||candidate.base_registry_key,false)
    ) target(registry_key,is_canonical)
  )
  insert into public.live_source_policies
    (id,source_id,registry_key,rights_class,storage_policy,active,rights_evidence_url,
     rights_verified_at,policy,recorded_at)
  select encode(extensions.digest(convert_to(
      'dialektik-corporate-live-registry-v1'||E'\n'||keys.id::text||E'\n'||
      keys.decision_id::text||E'\n'||keys.registry_key,'UTF8'),'sha256'),'hex'),
    keys.id,keys.registry_key,keys.rights_class,keys.storage_policy,keys.active,
    keys.rights_evidence_url,keys.rights_verified_at,
    keys.policy||jsonb_build_object(
      'registryKey',keys.registry_key,
      'rightsReviewStatus','APPROVED',
      'authorizationReference','EDITOR_SOURCE_RIGHTS_DECISION:'||keys.decision_id::text,
      'rightsEvidenceUrl',keys.decision_rights_evidence_url,
      'endpoint',keys.endpoint
    ),
    case when keys.is_canonical then statement_timestamp()
      else statement_timestamp()-interval '1 millisecond' end
  from registry_keys keys
  on conflict(id) do nothing;

  select count(*) into normalized_count
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
    and latest_policy.registry_key in (
      'chile-rss-biobiochile-v1','chile-rss-ciperchile-v1',
      'chile-rss-cooperativa-v1','chile-rss-diarioeldia-v1',
      'chile-rss-elmostrador-v1','chile-rss-latercera-v1'
    )
    and latest_policy.policy->>'registryKey'=latest_policy.registry_key
    and latest_policy.policy->>'rightsReviewStatus'='APPROVED'
    and nullif(latest_policy.policy->>'authorizationReference','') is not null;

  if normalized_count<>6 then
    raise exception 'MIGRATION_073_REGISTRY_NORMALIZATION_INCOMPLETE: %',normalized_count;
  end if;
end;
$normalize$;
`;

export const normalizeCorporateLiveRegistryKeysDdl = { schema: SCHEMA } as const;

export const normalizeCorporateLiveRegistryKeysMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(normalizeCorporateLiveRegistryKeysDdl.schema).execute(database);
  },
  async down(): Promise<void> {
    throw new Error('Corporate live registry-key history is append-only and requires explicit review.');
  },
};
