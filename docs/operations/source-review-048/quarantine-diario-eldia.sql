-- Apply only after deploying the Core reader with quarantinedArticleIds support.
-- This appends a source-policy review. It does not edit the article, provenance,
-- receipts, schema, constraints, triggers, or existing policy history.
begin;

do $review_guard$
begin
  if (select id from live_source_policies
      where source_id = '01M4YDQK00CH100D1AR10E1D1A'
      order by recorded_at desc, id desc limit 1)
      is distinct from '77889900aabbccddeeff00112233445566778899aabbccddeeff001122334455'
  then
    raise exception 'SOURCE_POLICY_CHANGED_SINCE_PROVENANCE_REVIEW';
  end if;
  if exists (select 1 from live_source_policies
      where source_id = '01M4YDQK00CH100D1AR10E1D1A'
        and policy ? 'quarantinedArticleIds')
  then
    raise exception 'EXISTING_QUARANTINE_DECISION_REQUIRES_RECONCILIATION';
  end if;
  if not exists (select 1 from articles
      where id = '01M4YDQK000000000000000305'
        and source_id = '01M4YDQK00CH100D1AR10E1D1A'
        and origin = 'LIVE_REAL'
        and url_canonical = 'https://www.diarioeldia.cl/noticias/2026/10/27/128945-planta-desaladora-coquimbo')
  then
    raise exception 'REVIEWED_ARTICLE_CHANGED';
  end if;
end
$review_guard$;

with prior as (
  select * from live_source_policies
  where id = '77889900aabbccddeeff00112233445566778899aabbccddeeff001122334455'
    and source_id = '01M4YDQK00CH100D1AR10E1D1A'
), reviewed as (
  select prior.*,
    policy || jsonb_build_object(
      'quarantinedArticleIds', jsonb_build_array('01M4YDQK000000000000000305'),
      'quarantineReview', jsonb_build_object(
        'articleId', '01M4YDQK000000000000000305',
        'reason', 'PUBLISHER_CANONICAL_AND_HEADLINE_MISMATCH',
        'observedCanonicalUrl', 'https://www.diarioeldia.cl/noticias/2025/10/11/128945-65-anos-de-historia-en-la-serena-los-motivos-del-cierre-de-la-estrella-alpina',
        'method', 'PUBLISHER_HTML_HEAD_METADATA',
        'reviewedAt', clock_timestamp()
      )
    ) as reviewed_policy
  from prior
)
insert into live_source_policies (
  id, source_id, registry_key, rights_class, storage_policy, active,
  rights_evidence_url, rights_verified_at, policy, recorded_at
)
select encode(sha256(convert_to('provenance-review-v1:' || id || ':01M4YDQK000000000000000305', 'UTF8')), 'hex'),
  source_id, registry_key, rights_class, storage_policy, active,
  rights_evidence_url, rights_verified_at, reviewed_policy,
  greatest(clock_timestamp(), recorded_at + interval '1 millisecond')
from reviewed;

commit;
