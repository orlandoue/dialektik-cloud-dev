-- Applied in dialektik-dev on 2026-11-01 after a rolled-back preflight.
-- Retained for audit; do not replay. Successors preserve existing anchor and assertion scope.
begin;
select public.dialektik_set_audit_context('editor','01M4YDQK00ED1T0R0R1AND0VE1'::dialektik_ulid,public.dialektik_generate_ulid(),'evidence_published','traduccion_editorial_evidencia');
do $$ declare n integer; begin
 insert into public.evidence(id,anchor_span_id,scope_assertion_id,stance,summary,citable_source_url,citable_source_title,contributed_by,publication_state,approved_by,approved_at,relevance,supersedes_id)
 select public.dialektik_generate_ulid(),e.anchor_span_id,e.scope_assertion_id,e.stance,v.summary,e.citable_source_url,e.citable_source_title,
   '01M4YDQK00ED1T0R0R1AND0VE1'::dialektik_ulid,'published','01M4YDQK00ED1T0R0R1AND0VE1'::dialektik_ulid,clock_timestamp(),e.relevance,e.id
 from public.evidence e join (values
 ('01M65Q13RFQ8K2VP4TYCPS8FBM','Una magistrada depositaba $300.000 mensuales a una profesional por estas labores durante más de una década.'),
 ('01M65Q13RV9340J9FZS4CZKM12','Según la publicación, Rosa Aguirre pagaba a una abogada para redactar fallos durante casi dos décadas.'),
 ('01M65Q18XJ9PYEQ66BYH93H10G','Alexander Zverev alcanzó el número uno del mundo.'),
 ('01M65Q18XN6A78K3VVYN780D6F','El alemán Alexander Zverev se convirtió en el número uno del tenis mundial.'),
 ('01M65Q19GZ13A9JS1X64J3BPJB','Codelco desvinculó a ocho ejecutivos y profesionales tras detectar antecedentes de irregularidades en los registros de producción de 2024 y 2025.'),
 ('01M65Q19H1G2WT5F23M05C8T76','Codelco despidió a ocho ejecutivos por cifras erróneas de producción de cobre en 2024 y 2025.'),
 ('01M65Q6MD34EGCTF92V7ZTZNC8','Senapred pidió evitar acercarse a la ribera del río Hurtado por una alerta de crecida tras una fuerte granizada.'),
 ('01M65Q6MEA3Y46SNVM5JCAPDYD','La crecida del río Hurtado obligó a activar una alerta SAE.'),
 ('01M6AKX7FHD5AJ0EZT34VHEJR1','Kast removió a Silva.'),
 ('01M6AKX7GY2VWS4WX59PZTG19R','Se firmaron decretos que permitieron rebajar condenas.'),
 ('01M6AM3XB0VS08WD0HXBM0ZV84','Fueron detenidas 26 personas.'),
 ('01M6AMCQA6CAH1HHC7V706MGT6','La CUT advirtió que la propuesta del Gobierno no resuelve su preocupación por el uso del Seguro de Cesantía para financiar el beneficio.')
 ) v(id,summary) on e.id::text=v.id
 where e.publication_state='published' and not exists(select 1 from public.evidence successor where successor.supersedes_id=e.id);
 get diagnostics n=row_count; if n<>12 then raise exception 'EXPECTED_TWELVE_CURRENT_EVIDENCE_ROWS got %',n; end if;
 set constraints all immediate;
end $$;

commit;
