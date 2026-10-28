-- Apply after migration 047 as the database administrator. This records the
-- owner's explicit editorial decision, creates two unpublished event drafts,
-- and preserves the original event and its historical records.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  original public.events%rowtype;
  employment_date timestamptz;
  emergency_date timestamptz;
  employment_event dialektik_ulid;
  emergency_event dialektik_ulid;
  editor_id constant dialektik_ulid := '01M4YDQK00ED1T0R0R1AND0VE1';
  original_id constant dialektik_ulid := '01M4YDQK00NMT7J1EESGF3M8N1';
begin
  select * into original from public.events where id = original_id for update;
  if not found or original.title_descriptive <>
    'Estrategia nacional de empleo ENADI 2026 y operativos regionales de preparación sísmica y alerta SAE en Chile'
    or original.merged_into is not null then
    raise exception 'The original ENADI/SAE event no longer matches the reviewed record';
  end if;
  if not exists (select 1 from public.users where id = editor_id and role = 'editor') then
    raise exception 'The requested editorial user is not active as editor';
  end if;

  if exists (select 1 from public.editorial_event_splits where original_event_id = original_id) then
    if not exists (select 1 from public.editorial_event_splits
      where original_event_id = original_id and editor_user_id = editor_id) then
      raise exception 'The original event has a different recorded split';
    end if;
    return;
  end if;

  select published_at into employment_date from public.articles
    where id = '01M4YDQK0018YSVM86HNTKYRP4' and event_id is null;
  select published_at into emergency_date from public.articles
    where id = '01M4YDQK001XVD71EP1HXDHG4J' and event_id is null;
  if employment_date is null or emergency_date is null then
    raise exception 'Expected source records are unavailable or have been reassigned';
  end if;
  if exists (select 1 from public.contradiction_publications
    where event_id = original_id and confirmed_by is not null) then
    raise exception 'The historical contradiction has changed and requires a new review';
  end if;

  employment_event := public.dialektik_generate_ulid();
  emergency_event := public.dialektik_generate_ulid();
  perform public.dialektik_set_audit_context('editor', editor_id,
    public.dialektik_generate_ulid(), 'split', 'owner_separated_enadi_sae');

  insert into public.events
    (id, title_descriptive, category_id, window_from, window_to, detected_at,
     analysis_state, merged_into, merged_by, merged_at)
  values
    (employment_event, 'Estrategia nacional de empleo ENADI 2026: demanda regional y capacitación laboral',
     original.category_id, employment_date, null, clock_timestamp(), 'ANALYSIS_PENDING', null, null, null),
    (emergency_event, 'Preparación regional ante desastres y Sistema de Alerta de Emergencia SAE',
     original.category_id, emergency_date, null, clock_timestamp(), 'ANALYSIS_PENDING', null, null, null);

  insert into public.editorial_event_splits
    (original_event_id, first_successor_id, second_successor_id, editor_user_id, reason)
  values
    (original_id, employment_event, emergency_event, editor_id,
     'Decisión editorial: empleo ENADI y alerta SAE son temas distintos; quedan pendientes de fuentes y análisis propios.');
end
$$;

commit;
