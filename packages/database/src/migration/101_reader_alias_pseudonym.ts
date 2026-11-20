import { sql, type Migration } from 'kysely';

// Readers who never chose an alias were signed with the full name of their
// Google account (migration 101). From now on the default is «Lector-NNNN»;
// this migration renames the comments and community entries already
// published under that name. Only rows whose alias equals the author's own
// account name (as it was cleaned for display) change; chosen aliases and
// pseudonyms stay. The temporary policies let the SQL editor role, which
// row security also binds, read and update both tables during this
// transaction only. Idempotent.
export const readerAliasPseudonymSql = String.raw`
create or replace function pg_temp.dialektik_clean_alias(p_raw text)
returns text language plpgsql immutable as $fn$
declare v text;
begin
  if p_raw is null then return null; end if;
  v := regexp_replace(p_raw, '[^[:alnum:] ._-]', '', 'g');
  v := btrim(regexp_replace(v, '\s+', ' ', 'g'));
  v := regexp_replace(v, '^[ ._-]+', '');
  if length(v) > 30 then v := rtrim(left(v, 30)); end if;
  return case when length(v) >= 2 then v else null end;
end
$fn$;

do $retro$
declare
  v_role text := current_user;
begin
  execute format('drop policy if exists reader_alias_retro_read on public.story_comments');
  execute format('drop policy if exists reader_alias_retro_update on public.story_comments');

  execute format('create policy reader_alias_retro_read on public.story_comments for select to %I using (true)', v_role);
  execute format('create policy reader_alias_retro_update on public.story_comments for update to %I using (true) with check (true)', v_role);

  create temporary table reader_alias_retro on commit drop as
    select u.id as user_id,
      coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'), ''), nullif(btrim(u.raw_user_meta_data->>'name'), '')) as account_name,
      coalesce('Lector-' || (select p.reader_number from public.dialektik_reader_profile(u.id) p), 'Lector') as pseudonym
    from auth.users u;
  delete from reader_alias_retro where account_name is null;

  update public.story_comments c set author_alias = r.pseudonym
    from reader_alias_retro r
    where c.user_id = r.user_id
      and c.author_alias in (r.account_name, pg_temp.dialektik_clean_alias(r.account_name));
  -- Community entries of the Arena (migration 085), where it exists.
  if to_regclass('public.social_community_entries') is not null then
    execute 'drop policy if exists reader_alias_retro_read on public.social_community_entries';
    execute 'drop policy if exists reader_alias_retro_update on public.social_community_entries';
    execute format('create policy reader_alias_retro_read on public.social_community_entries for select to %I using (true)', v_role);
    execute format('create policy reader_alias_retro_update on public.social_community_entries for update to %I using (true) with check (true)', v_role);
    execute 'update public.social_community_entries e set author_alias = r.pseudonym
      from reader_alias_retro r
      where e.user_id = r.user_id
        and e.author_alias in (r.account_name, pg_temp.dialektik_clean_alias(r.account_name))';
    execute 'drop policy reader_alias_retro_read on public.social_community_entries';
    execute 'drop policy reader_alias_retro_update on public.social_community_entries';
  end if;

  execute 'drop policy reader_alias_retro_read on public.story_comments';
  execute 'drop policy reader_alias_retro_update on public.story_comments';
end
$retro$;
`;

export const readerAliasPseudonymMigration: Migration = {
  async up(db) { await sql.raw(readerAliasPseudonymSql).execute(db); },
  async down() { throw new Error('Reader alias pseudonyms are forward-only.'); },
};
