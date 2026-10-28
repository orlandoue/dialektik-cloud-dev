-- Read-only snapshot for the Chile private beta. This does not approve rights,
-- acquire content, assign articles to events, or change publication states.
-- Counts reflect records and technical fields, not verified legal permission.
with latest_policy as (
  select distinct on (p.source_id) p.*
  from public.live_source_policies p
  join public.sources s on s.id = p.source_id
  where s.origin = 'LIVE_REAL'
  order by p.source_id, p.recorded_at desc, p.id desc
), chile_sources as (
  select s.id, s.canonical_domain, p.active, p.rights_class, p.policy
  from public.sources s
  join latest_policy p on p.source_id = s.id
  where s.origin = 'LIVE_REAL'
    and s.canonical_domain in (
      'bcentral.cl', 'biobiochile.cl', 'sismologia.cl', 'ciperchile.cl',
      'cooperativa.cl', 'diarioeldia.cl', 'www.diarioeldia.cl',
      'elmostrador.cl', 'emol.com', 'gob.cl', 'latercera.com', 'senapred.gob.cl'
    )
), expected_constraints(table_name, constraint_name) as (
  values
    ('articles', 'articles_live_origin_exclusion'),
    ('articles', 'articles_not_syndicated_from_self'),
    ('events', 'events_not_merged_into_self'),
    ('events', 'events_merge_metadata_coherent'),
    ('positions', 'positions_publication_metadata_coherent'),
    ('claim_spans', 'claim_spans_valid_offsets'),
    ('evidence', 'evidence_published_is_approved'),
    ('relationships', 'relationships_published_is_confirmed'),
    ('contradiction_publications', 'contradiction_publications_distinct_positions')
)
select
  (select count(*) from latest_policy where policy->>'rightsReviewStatus' = 'APPROVED')
    as sources_marked_approved,
  (select count(*) from latest_policy where policy->>'endpoint' = 'https://supabase.com')
    as placeholder_endpoints,
  (select count(*) from latest_policy
   where policy->>'rightsEvidenceUrl' ~* '^https?://[^/]+/?$')
    as evidence_urls_pointing_only_to_a_homepage,
  (select count(*) from chile_sources
   where active and rights_class = 'LIVE_READY'
     and policy->>'rightsReviewStatus' = 'APPROVED'
     and nullif(policy->>'authorizationReference', '') is not null
     and nullif(policy->>'rightsEvidenceUrl', '') is not null
     and nullif(policy->>'endpoint', '') is not null
     and policy->>'rightsEvidenceUrl' <> 'https://supabase.com'
     and policy->>'endpoint' <> 'https://supabase.com')
    as chile_sources_passing_core_string_filters,
  (select count(*) from public.articles where origin = 'LIVE_REAL')
    as live_articles,
  (select count(*) from public.events e where e.merged_into is null
   and not exists (select 1 from public.articles a
                   where a.event_id = e.id and a.origin = 'LIVE_REAL'))
    as events_without_a_linked_live_article,
  (select count(*) from public.assertions) as assertions,
  (select count(*) from public.evidence where publication_state = 'published'
   and approved_at is not null) as approved_published_evidence,
  (select count(*) from public.position_formed_by) as position_formation_links,
  (select count(*) from public.positions where publication_state = 'published'
   and (neutral_rank is null or published_at is null or published_by is null))
    as published_positions_missing_publication_metadata,
  (select count(*) from public.contradiction_publications
   where publication_state in ('published', 'requires_review')
   and (confirmed_by is null or confirmed_at is null))
    as contradictions_missing_confirmation_metadata,
  (select count(*) from public.personal_owner_source_rights_decisions)
    as recorded_independent_rights_decisions,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (has_table_privilege('anon', c.oid, 'SELECT')
       or has_any_column_privilege('anon', c.oid, 'SELECT')))
    as public_relations_readable_by_anon,
  pg_has_role('dialektik_core_app', 'dialektik_semantic_writer', 'MEMBER')
    as core_can_assume_semantic_writer,
  has_table_privilege('dialektik_core_app', 'public.events', 'INSERT')
    as core_can_insert_events,
  (select coalesce(jsonb_agg(table_name || '.' || constraint_name order by table_name, constraint_name), '[]'::jsonb)
   from expected_constraints expected
   where not exists (
     select 1 from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = expected.table_name
       and c.conname = expected.constraint_name
   )) as missing_repository_constraints,
  (select coalesce(jsonb_agg(expected.table_name || '.' || expected.constraint_name
                             order by expected.table_name, expected.constraint_name), '[]'::jsonb)
   from expected_constraints expected
   join pg_class t on t.relname = expected.table_name
   join pg_namespace n on n.oid = t.relnamespace and n.nspname = 'public'
   join pg_constraint c on c.conrelid = t.oid and c.conname = expected.constraint_name
   where not c.convalidated) as unvalidated_repository_constraints;
