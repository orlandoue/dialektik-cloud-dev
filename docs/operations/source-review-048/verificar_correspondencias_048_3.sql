-- Solo lectura: la igualdad de URL o el mismo acontecimiento y rango son
-- correspondencias candidatas, no prueban autoría, derechos ni equivalencia.
-- No consulta ni devuelve cuerpos de artículos ni fragmentos.
begin transaction read only;

with candidate(event_id, rank, proposed_position, proposed_contradiction, proposed_article, url) as (
  values
    ('01M4YDQK008AF3GW7D6FZHYSVH','1','01J11111111111111111111105','01J22222222222222222222203','01M4YDQK00EVART00000000003','https://www.gov.uk/government/news/strong-strategic-leadership-key-to-overcoming-risks-says-rsh'),
    ('01M4YDQK008AF3GW7D6FZHYSVH','2','01J11111111111111111111106','01J22222222222222222222203','01M4YDQK00EVART00000000007','https://www.gov.uk/government/news/major-milestone-reached-in-ending-building-safety-crisis'),
    ('01M4YDQK00AM9JB7KHN6HEA504','1','01J11111111111111111111101','01J22222222222222222222201','01M4YDQK00EVART00000000001','https://www.biobiochile.cl/noticias/economia/actualidad-economica/2026/10/22/gobierno-insta-a-que-los-adultos-mayores-posterguen-su-jubilacion-ante-fallida-apuesta-de-las-afp.shtml'),
    ('01M4YDQK00AM9JB7KHN6HEA504','2','01J11111111111111111111102','01J22222222222222222222201','01M4YDQK00EVART00000000005','https://www.elmostrador.cl/el-semanal/2026/10/22/afp-y-el-fondo-e-la-codicia-le-gano-a-la-responsabilidad/'),
    ('01M4YDQK00K5F56S48P86H8AC6','1','01J11111111111111111111103','01J22222222222222222222202','01M4YDQK00EVART00000000002','https://www.bcentral.cl/areas/politica-monetaria/informe-de-politica-monetaria'),
    ('01M4YDQK00K5F56S48P86H8AC6','2','01J11111111111111111111104','01J22222222222222222222202','01M4YDQK00EVART00000000006','https://www.latercera.com/pulso/noticia/jose-de-gregorio-me-cuesta-explicar-lo-que-esta-pasando-la-desaceleracion-es-sorprendente/'),
    ('01M4YDQK00NMT7J1EESGF3M8N1','1','01J11111111111111111111107','01J22222222222222222222204','01M4YDQK00EVART00000000004','https://www.gob.cl/noticias/enadi-2026-nueva-estrategia-permitira-anticipar-oportunidades-de/'),
    ('01M4YDQK00NMT7J1EESGF3M8N1','2','01J11111111111111111111108','01J22222222222222222222204','01M4YDQK00EVART00000000008','https://www.senapred.gob.cl/regiones/')
)
select
  c.event_id, c.rank::integer as proposed_rank, c.proposed_position, c.proposed_contradiction,
  c.proposed_article, c.url as canonical_url,
  (select count(*) from public.articles a where split_part(a.url_canonical, '#', 1) = c.url) as article_matches,
  article.id as existing_article_id,
  (select count(*) from public.live_acquisition_receipts r
    where r.exclusion_id = article.live_exposure_id and r.disposition = 'PERSISTED') as persisted_receipts,
  (select count(*) from public.positions p
    where p.event_id = c.event_id and p.neutral_rank = c.rank::integer) as position_matches,
  position_row.id as existing_position_id,
  position_row.published_by is not null as position_has_editor,
  (select count(*) from public.position_formed_by f where f.position_id = position_row.id) as formations,
  (select count(*) from public.assertions a where a.position_id = position_row.id) as assertions,
  (select count(*) from public.contradiction_publications cp
    where cp.event_id = c.event_id and cp.publication_state = 'published') as contradiction_matches,
  contradiction.id as existing_contradiction_id,
  contradiction.confirmed_by is not null and contradiction.confirmed_at is not null as contradiction_confirmed,
  policy.policy->>'rightsReviewStatus' as current_review_status,
  policy.policy->>'endpoint' = 'https://supabase.com' as endpoint_is_placeholder
from candidate c
left join lateral (
  select a.id, a.source_id, a.live_exposure_id
  from public.articles a where split_part(a.url_canonical, '#', 1) = c.url
  order by a.id limit 1
) article on true
left join lateral (
  select p.id, p.published_by from public.positions p
  where p.event_id = c.event_id and p.neutral_rank = c.rank::integer
  order by p.id limit 1
) position_row on true
left join lateral (
  select cp.id, cp.confirmed_by, cp.confirmed_at from public.contradiction_publications cp
  where cp.event_id = c.event_id and cp.publication_state = 'published'
  order by cp.id limit 1
) contradiction on true
left join lateral (
  select lp.policy from public.live_source_policies lp
  where lp.source_id = article.source_id order by lp.recorded_at desc, lp.id desc limit 1
) policy on true
order by c.event_id, c.rank::integer;

rollback;
