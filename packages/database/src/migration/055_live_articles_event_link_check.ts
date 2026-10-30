import { sql, type Migration } from 'kysely';

const UP = String.raw`
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.articles'::regclass
      and conname = 'articles_live_origin_exclusion'
  ) then
    alter table public.articles drop constraint articles_live_origin_exclusion;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.articles'::regclass
      and conname = 'articles_live_exposure_presence_check'
  ) then
    alter table public.articles
      add constraint articles_live_exposure_presence_check check (
        (origin = 'LIVE_REAL' and live_exposure_id is not null)
        or (origin <> 'LIVE_REAL' and live_exposure_id is null)
      );
  end if;
end
$$;
`;

export const liveArticlesEventLinkCheckMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(UP).execute(database);
  },
  async down(): Promise<void> {
    throw new Error('Event-linked live articles may exist; this check is not reversible.');
  },
};

