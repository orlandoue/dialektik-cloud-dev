import { sql, type Migration } from "kysely";
import { liveSemanticPromotionFinalizeDdl } from "./062_finalize_live_semantic_promotion.js";

const EVENT_INSERT = `insert into public.events(id,title_descriptive,category_id,window_from,window_to,detected_at,analysis_state)
    values(event_identity,title_value,category_identity,event_date_from,event_date_to,decision_time,'ANALYSIS_PENDING');`;
const EVENT_INSERT_WITH_ORIGIN = `insert into public.events(id,title_descriptive,category_id,window_from,window_to,detected_at,analysis_state,origin)
    values(event_identity,title_value,category_identity,event_date_from,event_date_to,decision_time,'ANALYSIS_PENDING','LIVE_REAL');`;
const PUBLIC_EVENT_INSERT = `insert into public.public_events(id,title_descriptive,category_id,window_from,window_to,detected_at,analysis_state,
    merged_into,merged_by,merged_at)
    select id,title_descriptive,category_id,window_from,window_to,detected_at,analysis_state,merged_into,merged_by,merged_at
    from public.events where id=event_identity
    on conflict(id) where id is not null do update set title_descriptive=excluded.title_descriptive,
      category_id=excluded.category_id,window_from=excluded.window_from,window_to=excluded.window_to,
      detected_at=excluded.detected_at,analysis_state=excluded.analysis_state,
      merged_into=excluded.merged_into,merged_by=excluded.merged_by,merged_at=excluded.merged_at;`;
const PUBLIC_EVENT_INSERT_WITH_ORIGIN = `insert into public.public_events(id,title_descriptive,category_id,window_from,window_to,detected_at,analysis_state,
    merged_into,merged_by,merged_at,origin)
    select id,title_descriptive,category_id,window_from,window_to,detected_at,analysis_state,merged_into,merged_by,merged_at,origin
    from public.events where id=event_identity
    on conflict(id) where id is not null do update set title_descriptive=excluded.title_descriptive,
      category_id=excluded.category_id,window_from=excluded.window_from,window_to=excluded.window_to,
      detected_at=excluded.detected_at,analysis_state=excluded.analysis_state,
      merged_into=excluded.merged_into,merged_by=excluded.merged_by,merged_at=excluded.merged_at,origin=excluded.origin;`;

function replaceOnce(source: string, marker: string, replacement: string): string {
  const first = source.indexOf(marker);
  if (first < 0 || source.indexOf(marker, first + marker.length) >= 0)
    throw new Error("MIGRATION_064_PROMOTION_DDL_MARKER_INVALID");
  return source.replace(marker, () => replacement);
}

export const liveEventOriginPromotionDdl = replaceOnce(
  replaceOnce(liveSemanticPromotionFinalizeDdl, EVENT_INSERT, EVENT_INSERT_WITH_ORIGIN),
  PUBLIC_EVENT_INSERT,
  PUBLIC_EVENT_INSERT_WITH_ORIGIN,
);

const ORIGIN_SCHEMA = String.raw`
alter table public.events add column if not exists origin text;
alter table public.public_events add column if not exists origin text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='events_origin_allowed'
    and conrelid='public.events'::regclass) then
    alter table public.events add constraint events_origin_allowed
      check (origin is null or origin in ('FIXTURE','STRESS_SYNTHETIC','LIVE_REAL'));
  end if;
  if not exists (select 1 from pg_constraint where conname='public_events_origin_allowed'
    and conrelid='public.public_events'::regclass) then
    alter table public.public_events add constraint public_events_origin_allowed
      check (origin is null or origin in ('FIXTURE','STRESS_SYNTHETIC','LIVE_REAL'));
  end if;
end $$;
update public.events event_row set origin='LIVE_REAL'
  from public.live_semantic_editorial_promotions promotion where promotion.event_id=event_row.id;
update public.public_events public_event set origin=event_row.origin
  from public.events event_row where public_event.id=event_row.id
    and exists (select 1 from public.live_semantic_editorial_promotions promotion
      where promotion.event_id=event_row.id);
`;

export const liveEventOriginMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(ORIGIN_SCHEMA).execute(database);
    await sql.raw(liveEventOriginPromotionDdl).execute(database);
  },
  async down(): Promise<void> {
    throw new Error("Canonical event origin metadata is forward-only.");
  },
};
