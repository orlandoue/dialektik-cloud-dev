-- Solo lectura; no imprime ni descarga textos de terceros.
-- Un hash coincidente prueba identidad con el texto guardado, no procedencia
-- externa, derechos de reproducción ni corrección de una postura editorial.
begin transaction read only;

with candidate(article_id, start_index, end_index, expected_sha256) as (
  values
    ('01M4YDQK00ZYZC9SPE54QZF606','99','364','0faf830de3c648cd4920de41c3bf6384775f6f8992dce6249dc8e1e2b021c68d'),
    ('01M4YDQK0035VZ8PY5ZHE7RM94','59','291','d378fc3fbc20284dd60681ae053169e297e54923ddc7557621062454280f0b89'),
    ('01M4YDQK0039BM6KJQMQFTB26N','79','284','68e03c4a10eef19f789de2d0b24a550cc736a671350360a5387b7a6e8a3e98e8'),
    ('01M4YDQK0056BT1MR8RP62Z33P','95','255','c3463d627931729633cc0fcb168637991a2ce5b7436906ef814d3c45374a8ec4'),
    ('01M4YDQK00R5ZBXD9PH19HV3AQ','63','229','b7d5f45cb172fb0d4cfe799dd4eb7ad512904c8ea90fc267a8e2b4fae8c01ae7'),
    ('01M4YDQK00J95DDBZYBPB63TBA','58','208','a197b88ca8a03080ef9e69881fead5d6b488a65d9057619b33073cde779bc403'),
    ('01M4YDQK0018YSVM86HNTKYRP4','89','237','9acaab34dd6ff76cd078f98c1feb6ce6ec689a8cd4d398919d03916cdc90ff81'),
    ('01M4YDQK001XVD71EP1HXDHG4J','98','257','127e4a0a1a8c15b28227292bff8cc0efaae922351e64d46a7b81bd2fc96f9ea5'),
    ('01M4YDQK00EME7X6EZXFH7R5ER','0','299','7fa59458291c1df89f7f49a055190c8f802afc3d4d6aef049d6918b1b6bc0a46'),
    ('01M4YDQK003NT2DH0TSM6HJ773','97','272','0ce0abd36de2e087fd49e9115914b3a337d6934adb0d116d6531446d5ef884a7'),
    ('01M4YDQK00BEJ94D3ZW648WPK6','66','210','5432f90f923cce2775606f581cd5b25c9d3dc7c5383428c6c17f82c5ac13385d'),
    ('01M4YDQK00SWR25SKPVRH6B572','65','206','418eb28b2426e01c4d0d7a33ec0d148bb44707f49f2e015ddf0e443549c141b5')
)
select c.article_id, c.start_index::integer, c.end_index::integer,
  a.id is not null as article_exists,
  case when a.id is null then false else
    encode(sha256(convert_to(substring(a.text_original
      from c.start_index::integer + 1
      for c.end_index::integer - c.start_index::integer), 'UTF8')), 'hex') = c.expected_sha256
  end as stored_substring_matches,
  a.event_id is null as article_is_in_news_stream,
  policy.id is not null as content_access_policy_exists,
  coalesce(policy.minimal_evidence_fragment, false) as permits_minimal_evidence_fragment,
  coalesce(policy.derived_semantic_persistence, false) as permits_semantic_persistence
from candidate c
left join public.articles a on a.id = c.article_id
left join lateral (
  select cp.id, cp.minimal_evidence_fragment, cp.derived_semantic_persistence
  from public.content_access_policies cp
  where cp.source_id = a.source_id
  order by cp.recorded_at desc, cp.id desc limit 1
) policy on true
order by c.article_id;

rollback;
