import { sql, type Migration } from 'kysely';

const SCHEMA = String.raw`
do $guard$
begin
  if to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'MIGRATION_074_PGCRYPTO_DIGEST_UNAVAILABLE';
  end if;
  if not has_schema_privilege('dialektik_corporate_live_writer','extensions','USAGE')
    or not has_function_privilege('dialektik_corporate_live_writer',
      'extensions.digest(bytea,text)','EXECUTE') then
    raise exception 'MIGRATION_074_CORPORATE_WRITER_DIGEST_ACCESS_MISSING';
  end if;
end;
$guard$;

create or replace function public.dialektik_guard_article_ephemeral_text()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if (new.source_id is distinct from old.source_id or new.url_canonical is distinct from old.url_canonical)
    and exists (
      select 1 from public.observed_article_content_versions
      where article_id = old.id
    ) then
    raise exception using errcode = '23514', message = 'observed content Article identity is permanent';
  end if;

  if exists (
    select 1
    from public.observed_article_content_versions v
    join public.content_access_policies p on p.id = v.policy_id
    where v.article_id = new.id
      and p.content_access_mode = 'FULLTEXT_EPHEMERAL'
      and (
        encode(extensions.digest(convert_to(new.text_original, 'UTF8'), 'sha256'), 'hex') = v.normalized_input_hash
        or encode(extensions.digest(convert_to(new.text_normalized, 'UTF8'), 'sha256'), 'hex') = v.normalized_input_hash
      )
  ) then
    raise exception using errcode = '23514', message = 'ephemeral input cannot enter Article text storage';
  end if;
  return new;
end;
$function$;
`;

export const qualifyEphemeralArticleGuardDigestDdl = { schema: SCHEMA } as const;

export const qualifyEphemeralArticleGuardDigestMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(qualifyEphemeralArticleGuardDigestDdl.schema).execute(database);
  },
  async down(): Promise<void> {
    throw new Error('The live Article guard must keep its schema-qualified digest call.');
  },
};
