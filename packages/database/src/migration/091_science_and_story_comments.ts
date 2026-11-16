import { sql, type Migration } from 'kysely';

// Science mode and story comments.
//
// - science_studies: bibliographic cache resolved by Core from Crossref and
//   OpenAlex (never by the app), plus fields a moderator completes (design,
//   population, sample, follow-up, conflicts…). Unverified fields stay null
//   and the app reads them as «No informado».
// - story_comments: comments of every story. Normal comments are published at
//   once; comments with a study start in review. One level of replies.
// - story_comment_studies: the study attached to a comment: DOI, the literal
//   claim of the story it answers (with a fixed copy of the quote), the
//   commenter's relation and a literal fragment of the abstract.
// - story_comment_reactions: «Útil» / «Pertinente», one per reader.
//
// Only the Core role has access. The reader identity is set transaction-locally
// after the beta JWT is verified; the moderator flag is set by Core only for
// configured moderator accounts. Idempotent: Core runs it at startup when it
// can, and the owner can apply it in the SQL editor.
export const scienceCommentsSql = String.raw`
create table if not exists public.science_studies (
  doi text primary key check (doi ~ '^10\.[0-9]{4,9}/\S+$' and doi = lower(doi)),
  title text not null check (char_length(btrim(title)) between 1 and 1000),
  review text not null check (review in ('peer_reviewed', 'preprint')),
  authors text check (authors is null or char_length(authors) <= 600),
  institution text check (institution is null or char_length(institution) <= 300),
  journal text check (journal is null or char_length(journal) <= 300),
  published_at date,
  abstract text check (abstract is null or char_length(abstract) <= 12000),
  abstract_language text check (abstract_language is null or abstract_language ~ '^[a-z]{2,3}$'),
  access text check (access is null or char_length(access) <= 120),
  retracted boolean not null default false,
  retracted_at date,
  -- Completed by a moderator; never extracted by an unreviewed model.
  design text check (design is null or char_length(design) <= 120),
  population text check (population is null or char_length(population) <= 160),
  sample_size integer check (sample_size is null or sample_size > 0),
  follow_up text check (follow_up is null or char_length(follow_up) <= 120),
  funding text check (funding is null or char_length(funding) <= 300),
  conflicts text check (conflicts is null or char_length(conflicts) <= 300),
  corrections text check (corrections is null or char_length(corrections) <= 300),
  made_in_chile boolean not null default false,
  resolved_at timestamptz not null default now(),
  moderated_at timestamptz
);
create index if not exists science_studies_published_idx on public.science_studies(published_at desc nulls last);
alter table public.science_studies add column if not exists retracted boolean not null default false;

create table if not exists public.story_comments (
  id uuid primary key default gen_random_uuid(),
  event_id dialektik_ulid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.story_comments(id) on delete cascade,
  kind text not null check (kind in ('normal', 'study')),
  status text not null check (status in ('published', 'in_review', 'rejected')),
  author_alias text not null check (char_length(btrim(author_alias)) between 2 and 40),
  body text not null check (char_length(btrim(body)) between 1 and 600),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  -- Comments with a study always go through review first.
  constraint story_comments_study_reviewed check (kind = 'normal' or status <> 'published' or reviewed_at is not null)
);
create index if not exists story_comments_event_idx on public.story_comments(event_id, created_at desc);
create index if not exists story_comments_review_idx on public.story_comments(status, created_at) where status = 'in_review';

create table if not exists public.story_comment_studies (
  comment_id uuid primary key references public.story_comments(id) on delete cascade,
  event_id dialektik_ulid not null references public.events(id) on delete cascade,
  doi text not null references public.science_studies(doi),
  claim_quote_id dialektik_ulid not null,
  claim_text text not null check (char_length(btrim(claim_text)) between 1 and 2000),
  claim_outlet text not null check (char_length(btrim(claim_outlet)) between 1 and 200),
  relation text not null check (relation in ('respalda', 'contradice', 'matiza', 'contexto')),
  abstract_fragment text not null check (char_length(btrim(abstract_fragment)) between 3 and 1200)
);
create index if not exists story_comment_studies_doi_idx on public.story_comment_studies(doi);
create index if not exists story_comment_studies_claim_idx on public.story_comment_studies(event_id, doi, claim_quote_id);

create table if not exists public.story_comment_reactions (
  comment_id uuid not null references public.story_comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

-- Account age for the three-day rule: only the creation time of the given
-- account, nothing else from auth.users.
create or replace function public.dialektik_account_created_at(p_user uuid)
returns timestamptz
language sql
stable
security definer
set search_path = pg_catalog, auth
as $fn$ select created_at from auth.users where id = p_user $fn$;
revoke all on function public.dialektik_account_created_at(uuid) from public, anon, authenticated;

alter table public.science_studies enable row level security;
alter table public.story_comments enable row level security;
alter table public.story_comment_studies enable row level security;
alter table public.story_comment_reactions enable row level security;
alter table public.science_studies force row level security;
alter table public.story_comments force row level security;
alter table public.story_comment_studies force row level security;
alter table public.story_comment_reactions force row level security;
revoke all on public.science_studies, public.story_comments, public.story_comment_studies, public.story_comment_reactions
  from public, anon, authenticated, service_role;

do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'dialektik_core_app') then
    grant usage on schema public to dialektik_core_app;
    grant select, insert, update on public.science_studies to dialektik_core_app;
    grant select, insert, update on public.story_comments to dialektik_core_app;
    grant select, insert on public.story_comment_studies to dialektik_core_app;
    grant select, insert, delete on public.story_comment_reactions to dialektik_core_app;
    grant execute on function public.dialektik_account_created_at(uuid) to dialektik_core_app;
  end if;
end
$grants$;

drop policy if exists science_studies_read on public.science_studies;
drop policy if exists science_studies_cache on public.science_studies;
drop policy if exists science_studies_refresh on public.science_studies;
create policy science_studies_read on public.science_studies for select to dialektik_core_app using (true);
-- Bibliographic cache written by Core after resolving a DOI.
create policy science_studies_cache on public.science_studies for insert to dialektik_core_app with check (true);
create policy science_studies_refresh on public.science_studies for update to dialektik_core_app using (true) with check (true);

drop policy if exists story_comments_read on public.story_comments;
drop policy if exists story_comments_insert on public.story_comments;
drop policy if exists story_comments_moderate on public.story_comments;
create policy story_comments_read on public.story_comments for select to dialektik_core_app using (true);
create policy story_comments_insert on public.story_comments for insert to dialektik_core_app
  with check (user_id = nullif(current_setting('dialektik.social_user', true), '')::uuid
    and (kind = 'normal' or status = 'in_review'));
create policy story_comments_moderate on public.story_comments for update to dialektik_core_app
  using (current_setting('dialektik.science_moderator', true) = 'on')
  with check (current_setting('dialektik.science_moderator', true) = 'on');

drop policy if exists story_comment_studies_read on public.story_comment_studies;
drop policy if exists story_comment_studies_insert on public.story_comment_studies;
create policy story_comment_studies_read on public.story_comment_studies for select to dialektik_core_app using (true);
create policy story_comment_studies_insert on public.story_comment_studies for insert to dialektik_core_app
  with check (exists (select 1 from public.story_comments c where c.id = comment_id
    and c.user_id = nullif(current_setting('dialektik.social_user', true), '')::uuid and c.kind = 'study'));

drop policy if exists story_comment_reactions_read on public.story_comment_reactions;
drop policy if exists story_comment_reactions_insert on public.story_comment_reactions;
drop policy if exists story_comment_reactions_delete on public.story_comment_reactions;
create policy story_comment_reactions_read on public.story_comment_reactions for select to dialektik_core_app using (true);
create policy story_comment_reactions_insert on public.story_comment_reactions for insert to dialektik_core_app
  with check (user_id = nullif(current_setting('dialektik.social_user', true), '')::uuid);
create policy story_comment_reactions_delete on public.story_comment_reactions for delete to dialektik_core_app
  using (user_id = nullif(current_setting('dialektik.social_user', true), '')::uuid);
`;

export const scienceCommentsMigration: Migration = {
  async up(db) { await sql.raw(scienceCommentsSql).execute(db); },
  async down() { throw new Error('Story comments are forward-only.'); },
};
