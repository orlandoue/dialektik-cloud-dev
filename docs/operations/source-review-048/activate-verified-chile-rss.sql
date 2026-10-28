-- Apply only after deploying the Core reader with quarantinedArticleIds support.
-- These are the owner's metadata-only editorial decisions; they do not permit
-- article-body downloads or external AI processing, or claim a CC licence.
-- Existing articles, receipts, constraints, triggers and policies are preserved.
begin;

do $review_guard$
declare
  decision record;
  latest_id text;
begin
  for decision in select * from (values
    ('01M4YDQK00CH1000C1PERCH11E', 'aafe4625e2af0e1b1b4560de235d3e70bd05ac504f769fc1495293d5aed0a00d'),
    ('01M4YDQK00CH100C00PERAT1VA', '1323709f72fca41493d772cfa0460235dbe5c041bb46b80456d5b1a3cdfc54e8'),
    ('01M4YDQK00CH100001ATERCERA', '5242af5bcf9da29fa605a1dc769962ec42b76d2e0bdd560551cb5a0786cbffcd')
  ) as input(source_id, expected_id)
  loop
    select id into latest_id from live_source_policies
      where source_id = decision.source_id order by recorded_at desc, id desc limit 1;
    if latest_id is distinct from decision.expected_id then
      raise exception 'SOURCE_POLICY_CHANGED_SINCE_REVIEW: %', decision.source_id;
    end if;
    if exists (select 1 from live_source_policies where source_id = decision.source_id
        and policy ? 'quarantinedArticleIds') then
      raise exception 'EXISTING_QUARANTINE_REQUIRES_RECONCILIATION: %', decision.source_id;
    end if;
  end loop;
  if (select count(*) from articles where origin = 'LIVE_REAL' and (
    (source_id = '01M4YDQK00CH1000C1PERCH11E' and id in (
      '01M4YDQK003NT2DH0TSM6HJ773', '01M4YDQK00EME7X6EZXFH7R5ER', '01M4YDQK00GGD1VN9Q89Y90RFZ'))
    or (source_id = '01M4YDQK00CH100C00PERAT1VA' and id in (
      '01M4YDQK000000000000000303', '01M4YDQK000000000000000306'))
    or (source_id = '01M4YDQK00CH100001ATERCERA' and id = '01M4YDQK0056BT1MR8RP62Z33P')
  )) <> 6 then
    raise exception 'REVIEWED_ARTICLE_SET_CHANGED';
  end if;
end
$review_guard$;

with decisions(source_id, prior_id, endpoint, reference, quarantined_ids, reason) as (values
  ('01M4YDQK00CH1000C1PERCH11E', 'aafe4625e2af0e1b1b4560de235d3e70bd05ac504f769fc1495293d5aed0a00d',
   'https://www.ciperchile.cl/feed/', 'CL-LEY-17336-ART71B-METADATA-CIPER-2026',
   '["01M4YDQK003NT2DH0TSM6HJ773","01M4YDQK00EME7X6EZXFH7R5ER","01M4YDQK00GGD1VN9Q89Y90RFZ"]'::jsonb,
   'PUBLISHER_TITLE_OR_DATE_RECONCILIATION_PENDING'),
  ('01M4YDQK00CH100C00PERAT1VA', '1323709f72fca41493d772cfa0460235dbe5c041bb46b80456d5b1a3cdfc54e8',
   'https://www.cooperativa.cl/noticias/site/tax/port/all/rss____1.xml', 'CL-LEY-17336-ART71B-METADATA-COOPERATIVA-2026',
   '["01M4YDQK000000000000000303","01M4YDQK000000000000000306"]'::jsonb,
   'CANONICAL_URL_RETURNED_404_ON_REVIEW'),
  ('01M4YDQK00CH100001ATERCERA', '5242af5bcf9da29fa605a1dc769962ec42b76d2e0bdd560551cb5a0786cbffcd',
   'https://www.latercera.com/arc/outboundfeeds/rss/?outputType=xml', 'CL-LEY-17336-ART71B-METADATA-LATERCERA-2026',
   '["01M4YDQK0056BT1MR8RP62Z33P"]'::jsonb,
   'PUBLISHER_PUBLICATION_DATE_RECONCILIATION_PENDING')
), reviewed as (
  select p.*, d.endpoint, d.reference, d.quarantined_ids, d.reason,
    p.policy || jsonb_build_object(
      'endpoint', d.endpoint,
      'rightsEvidenceUrl', 'https://www.bcn.cl/leychile/navegar?idNorma=28933',
      'rightsVerifiedAt', clock_timestamp(),
      'rightsClass', 'LIVE_READY',
      'storagePolicy', 'METADATA_ONLY',
      'active', true,
      'rightsReviewStatus', 'APPROVED',
      'authorizationReference', d.reference,
      'rightsBasis', 'PUBLIC_RSS_METADATA_ONLY_NO_BILATERAL_CONTRACT',
      'rightsDecisionBasis', 'OWNER_EDITORIAL_ASSESSMENT',
      'bilateralContractRequired', false,
      'reviewedByEditorialUserId', '01M4YDQK00ED1T0R0R1AND0VE1',
      'articleBodyDownloadsAllowed', false,
      'externalAiTransmissionAllowed', false,
      'quarantinedArticleIds', d.quarantined_ids,
      'quarantineReview', jsonb_build_object('reason', d.reason,
        'method', 'PUBLISHER_METADATA_OR_HTTP_STATUS', 'reviewedAt', clock_timestamp())
    ) as reviewed_policy
  from decisions d join live_source_policies p on p.id = d.prior_id and p.source_id = d.source_id
)
insert into live_source_policies (
  id, source_id, registry_key, rights_class, storage_policy, active,
  rights_evidence_url, rights_verified_at, policy, recorded_at
)
select encode(sha256(convert_to('owner-metadata-review-v1:' || id, 'UTF8')), 'hex'),
  source_id, registry_key, 'LIVE_READY', 'METADATA_ONLY', true,
  'https://www.bcn.cl/leychile/navegar?idNorma=28933', clock_timestamp(), reviewed_policy,
  greatest(clock_timestamp(), recorded_at + interval '1 millisecond')
from reviewed;

commit;
