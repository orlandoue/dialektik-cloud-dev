import { sql, type Migration } from "kysely";

/**
 * Allows the existing, source-scoped excerpt route to continue after a LIVE_REAL
 * Article is linked to an Event. This does not mint editorial or rights grants:
 * the EXCERPT_EPHEMERAL policy, source rights decision, provider authorization,
 * budget reservation, and per-article route grant remain mandatory.
 */
const UP = String.raw`
do $$
declare target record; original_definition text; updated_definition text; changed_count integer := 0;
begin
  for target in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'dialektik_llm_route_allowed',
        'dialektik_validate_llm_run_config',
        'dialektik_validate_cloudflare_projection_route_grant',
        'dialektik_validate_observed_content_version'
      )
  loop
    original_definition := target.definition;
    updated_definition := original_definition;
    updated_definition := replace(updated_definition, 'a.event_id is null', 'true');
    updated_definition := replace(updated_definition, 'article.event_id is null', 'true');
    updated_definition := replace(updated_definition, 'article_row.event_id is not null', 'false');
    if updated_definition is distinct from original_definition then
      execute updated_definition;
      changed_count := changed_count + 1;
    end if;
  end loop;

  if changed_count = 0 then
    raise exception 'Migration 057 found no event-link guard to update; inspect the deployed function definitions.';
  end if;

  if exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.articles'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~* 'event_id\s+is\s+null'
      and pg_get_constraintdef(c.oid) ~* 'origin\s*=\s*''LIVE_REAL'''
  ) then
    raise exception 'Migration 057 will not drop an unknown articles event constraint; review it explicitly.';
  end if;
end
$$;
`;

export const enableExcerptSemanticGrantsAndLiveEventsMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(UP).execute(database);
  },
  async down(): Promise<void> {
    throw new Error(
      "Semantic records may have been created for Event-linked LIVE_REAL articles.",
    );
  },
};
