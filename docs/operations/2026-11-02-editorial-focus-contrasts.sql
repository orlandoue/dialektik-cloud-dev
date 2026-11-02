-- Editorially reviewed contrasts; execute only after the focus-contrast migration is active.
-- Re-execution fails rather than duplicating publications.
begin;
select public.dialektik_set_audit_context('editor','01M4YDQK00ED1T0R0R1AND0VE1'::dialektik_ulid,public.dialektik_generate_ulid(),'published','editorial_focus_contrast');
do $$ declare item record; projection public.position_relation_projections%rowtype; n integer:=0; begin
 for item in select * from (values
   ('01M6AMGM62JX01FT8CNYC6MTQ3','Ultimátum público y negativa a entregar las instalaciones'),
   ('01M6AKZA6P7NM0S6ECRM0QYZG4','Gestiones del Presidente y debate sobre responsabilidades'),
   ('01M6AKYFR7SZN6WSD8F5Y1GSC6','Alerta preventiva y pronóstico meteorológico'),
   ('01M6AKX7BA4KRXMKCJYKPFC1N7','Salida del subsecretario y firma de decretos de rebaja de condenas')
 ) v(event_id,editorial_reason) loop
   select * into strict projection from public.position_relation_projections p
     where p.event_id::text=item.event_id and p.comparable_pairs>0 and p.conflict_pairs=0 and not p.requires_review;
   if exists(select 1 from public.contradiction_publications previous where previous.event_id=projection.event_id and previous.position_a_id=projection.position_a_id and previous.position_b_id=projection.position_b_id and previous.publication_state in ('published','requires_review')) then
     raise exception 'Publication already exists for event %',item.event_id;
   end if;
   perform set_config('dialektik.audit_metadata',jsonb_build_object('tipo','contraste_de_enfoques','motivo',item.editorial_reason)::text,true);
   insert into public.contradiction_publications(id,event_id,position_a_id,position_b_id,projection_hash,
     ratio_conflicting_at_publication,ratio_comparable_at_publication,threshold_rule_at_publication,
     confirmed_by,confirmed_at,publication_state,retracted_by,retracted_at,retraction_reason)
   values(public.dialektik_generate_ulid(),projection.event_id,projection.position_a_id,projection.position_b_id,projection.projection_hash,
     projection.conflict_pairs,projection.comparable_pairs,'v1:editorial_focus_contrast',
     '01M4YDQK00ED1T0R0R1AND0VE1'::dialektik_ulid,clock_timestamp(),'published',null,null,null);
   n:=n+1;
 end loop;
 if n<>4 then raise exception 'Expected four contrasts, got %',n; end if;
 set constraints all immediate;
end $$;

commit;
