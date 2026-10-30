import { sql, type Migration } from "kysely";
import { liveSemanticEditorialPromotionDdl } from "./060_live_semantic_editorial_promotion.js";

const promotionFinalizeMarker = "  return response_json;\nend;\n$$;";
const finalizedPromotionDdl = liveSemanticEditorialPromotionDdl.replace(
  promotionFinalizeMarker,
  `  set constraints all immediate;\n${promotionFinalizeMarker}`,
);

const sensitiveActorUpdate = String.raw`
create or replace function public.dialektik_validate_sensitive_actors()
returns trigger
language plpgsql
set search_path=pg_catalog,public,extensions
as $$
declare
  row_data jsonb;
  old_row_data jsonb;
begin
  row_data := to_jsonb(new);
  if tg_op='UPDATE' then old_row_data := to_jsonb(old); end if;
  if tg_table_name = 'events' and row_data ->> 'merged_by' is not null then
    perform dialektik_actor_must_be_human((row_data ->> 'merged_by')::dialektik_ulid,'event merge');
  elsif tg_table_name = 'positions' then
    if row_data ->> 'published_by' is not null then
      perform dialektik_actor_must_be_human((row_data ->> 'published_by')::dialektik_ulid,'position publication');
    end if;
    if row_data ->> 'title_edited_by' is not null then
      perform dialektik_actor_must_be_human((row_data ->> 'title_edited_by')::dialektik_ulid,'position title edit');
    end if;
  elsif tg_table_name = 'relationships' then
    if row_data ->> 'rel_type' = 'R01a' then
      perform dialektik_actor_must_be_human((row_data ->> 'declared_by')::dialektik_ulid,'strict equivalence declaration');
    end if;
    if row_data ->> 'confirmed_by' is not null then
      perform dialektik_actor_must_be_human((row_data ->> 'confirmed_by')::dialektik_ulid,'relationship confirmation');
    end if;
  elsif tg_table_name = 'evidence' and row_data ->> 'approved_by' is not null then
    perform dialektik_actor_must_be_human((row_data ->> 'approved_by')::dialektik_ulid,'evidence approval');
  elsif tg_table_name = 'contradiction_publications' then
    if tg_op='INSERT'
      or row_data ->> 'confirmed_by' is distinct from old_row_data ->> 'confirmed_by'
      or (row_data ->> 'publication_state'='published'
        and old_row_data ->> 'publication_state' is distinct from 'published') then
      perform dialektik_actor_must_be_human(
        (row_data ->> 'confirmed_by')::dialektik_ulid,'contradiction publication');
    end if;
    if row_data ->> 'retracted_by' is not null
      and (tg_op='INSERT' or row_data ->> 'retracted_by' is distinct from old_row_data ->> 'retracted_by') then
      perform dialektik_actor_must_be_human(
        (row_data ->> 'retracted_by')::dialektik_ulid,'contradiction retraction');
    end if;
  elsif tg_table_name = 'position_tombstones' then
    perform dialektik_actor_must_be_human((row_data ->> 'actor_id')::dialektik_ulid,'position tombstone');
  end if;
  return new;
end;
$$;
`;

export const finalizeLiveSemanticPromotionMigration: Migration = {
  async up(database): Promise<void> {
    if (finalizedPromotionDdl === liveSemanticEditorialPromotionDdl)
      throw new Error("MIGRATION_062_PROMOTION_FINALIZE_MARKER_MISSING");
    await sql.raw(finalizedPromotionDdl).execute(database);
    await sql.raw(sensitiveActorUpdate).execute(database);
  },
  async down(): Promise<void> {
    throw new Error("Live semantic publication integrity rules are forward-only.");
  },
};

export const liveSemanticPromotionFinalizeDdl = finalizedPromotionDdl;
