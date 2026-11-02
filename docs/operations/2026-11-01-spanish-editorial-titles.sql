-- Applied in dialektik-dev on 2026-11-01 after a rolled-back preflight.
-- Retained for audit; do not replay. The full transaction fails if positions were already edited.
begin;
select public.dialektik_set_audit_context('editor','01M4YDQK00ED1T0R0R1AND0VE1'::dialektik_ulid,public.dialektik_generate_ulid(),'metadata_updated','traduccion_editorial_al_espanol');
do $$ declare n integer; begin
  update public.events e set title_descriptive=v.title from (values
    ('01M65Q6M9ZNQEMVE2SM1S3Z3AX','Crecida del río Hurtado'),
    ('01M65Q19G7C4ZWK8V93Z10DVM7','Codelco desvincula a ejecutivos por irregularidades en la producción'),
    ('01M65Q18WS1KNS6A2FFNPN5PGY','Alexander Zverev alcanza el número uno del mundo'),
    ('01M65Q13Q8RNXXHNY73YM1286M','Abogada demanda a ministra de la Corte de Valparaíso por redacción de fallos')
  ) v(id,title) where e.id::text=v.id and e.origin='LIVE_REAL' and e.analysis_state='PUBLISHED';
  get diagnostics n=row_count; if n<>4 then raise exception 'EXPECTED_FOUR_PUBLISHED_EVENTS got %',n; end if;
  update public.public_events pe set title_descriptive=e.title_descriptive from public.events e
    where pe.id=e.id and e.id::text in ('01M65Q6M9ZNQEMVE2SM1S3Z3AX','01M65Q19G7C4ZWK8V93Z10DVM7','01M65Q18WS1KNS6A2FFNPN5PGY','01M65Q13Q8RNXXHNY73YM1286M');
  get diagnostics n=row_count; if n<>4 then raise exception 'EXPECTED_FOUR_PUBLIC_EVENTS got %',n; end if;
  update public.positions p set title_previous=p.title_text,title_edited_by='01M4YDQK00ED1T0R0R1AND0VE1'::dialektik_ulid,title_edited_at=clock_timestamp(),title_text=v.title from (values
    ('01M6AMCQA6ZHA42YVEMY9M3WSM','La propuesta del Gobierno no resuelve la principal preocupación de la CUT: el uso de recursos del Seguro de Cesantía para financiar el beneficio.'),
    ('01M6AM3XB0CKW2HZWG706GFDY0','Fueron detenidas 26 personas.'),
    ('01M6AKX7FHH3ZWS95FS57X458E','Kast removió a Silva.'),
    ('01M6AKX7GYW8EBCCZ5R1D7YVMD','Luis Silva participó en la firma de decretos que permitieron rebajar condenas.'),
    ('01M65Q6MA52V7BK3RM9T5E4PSQ','Senapred advierte del aumento del caudal en Río Hurtado tras una fuerte granizada y pide alejarse de la ribera.'),
    ('01M65Q19G7ZY0MWNDT9SVDRPS8','Codelco desvinculó a ejecutivos por irregularidades en los registros de producción de 2024 y 2025, según auditorías internas y externas.'),
    ('01M65Q18WS92Y5BTHC5G2DHTAB','Alexander Zverev aseguró el número uno del ranking ATP tras vencer a Tallon Griekspoor en el torneo de Viena.'),
    ('01M65Q13QA1W9TK91B2T3C1PGP','Una ministra de la Corte de Valparaíso pagó a una abogada $300.000 mensuales para redactar fallos durante más de diez años.')
  ) v(id,title) where p.id::text=v.id and p.publication_state='published' and p.status='active' and p.title_edited_by is null;
  get diagnostics n=row_count; if n<>8 then raise exception 'EXPECTED_EIGHT_UNEDITED_POSITIONS got %',n; end if;
  set constraints all immediate;
end $$;

commit;
