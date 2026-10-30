import { sql, type Migration } from "kysely";

const DDL = String.raw`
-- Semantic writer may only advance the generation state through the
-- append-only active -> superseded transition enforced by the history trigger.
revoke update on table public.assertion_extraction_generations
  from dialektik_headline_ai_writer;
revoke update(state) on table public.assertion_extraction_generations
  from dialektik_headline_ai_writer;
grant update(state) on table public.assertion_extraction_generations
  to dialektik_headline_ai_writer;

do $$ begin
  if has_table_privilege('dialektik_headline_ai_writer',
      'public.assertion_extraction_generations','UPDATE') then
    raise exception 'semantic writer must not have table-wide generation update';
  end if;
  if not has_column_privilege('dialektik_headline_ai_writer',
      'public.assertion_extraction_generations','state','UPDATE') then
    raise exception 'semantic writer must be able to supersede an active generation';
  end if;
  if has_column_privilege('dialektik_headline_ai_writer',
      'public.assertion_extraction_generations','proposal_payload','UPDATE') then
    raise exception 'semantic writer must not update immutable generation payloads';
  end if;
end $$;
`;

export const liveSemanticGenerationLineageMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(DDL).execute(database);
  },
  async down(): Promise<void> {
    throw new Error(
      "Semantic generation lineage permissions are forward-only.",
    );
  },
};

export const liveSemanticGenerationLineageDdl = DDL;
