import { sql, type Migration } from 'kysely';

const SCHEMA = String.raw`
do $dependencies$
begin
  if not exists(select 1 from pg_roles where rolname='dialektik_corporate_live_writer')
    or not exists(select 1 from pg_namespace where nspname='extensions')
    or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'MIGRATION_069_REQUIRED_HASH_DEPENDENCIES_MISSING';
  end if;
end;
$dependencies$;

-- The acquisition writer needs schema resolution for the already-executable
-- pgcrypto digest function used to deduplicate metadata backfill attempts.
grant usage on schema extensions to dialektik_corporate_live_writer;
`;

export const corporateLiveHashSchemaUsageDdl = { schema: SCHEMA } as const;

export const corporateLiveHashSchemaUsageMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(corporateLiveHashSchemaUsageDdl.schema).execute(database);
  },
  async down(): Promise<void> {
    throw new Error('Corporate acquisition hash checks must retain extension schema usage.');
  },
};
