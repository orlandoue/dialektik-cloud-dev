import { sql, type Migration } from 'kysely';

/**
 * Refreshes only LIVE_REAL Article text projections from the latest explicitly
 * approved feed excerpt. The immutable source version remains authoritative;
 * claim-bearing Articles stay frozen so prior quote offsets cannot drift.
 */
const LIVE_EXCERPT_TEXT_PROJECTION_SQL = String.raw`
create table public.live_article_text_projection_audit (
  article_id dialektik_ulid not null references public.articles(id),
  article_version_id dialektik_ulid not null references public.live_article_versions(id),
  previous_text_sha256 text not null check (previous_text_sha256 ~ '^[0-9a-f]{64}$'),
  projected_text_sha256 text not null check (projected_text_sha256 ~ '^[0-9a-f]{64}$'),
  reason text not null check (reason in ('approved_feed_excerpt_projection_v1')),
  recorded_at timestamptz(3) not null,
  primary key (article_id, article_version_id),
  check (previous_text_sha256 <> projected_text_sha256)
);
alter table public.live_article_text_projection_audit enable row level security;
revoke all on public.live_article_text_projection_audit from public, anon, authenticated;

create function public.dialektik_preserve_live_article_text_projection_audit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then return new; end if;
  raise exception using errcode = '55000', message = 'live Article text projection audit is immutable';
end;
$$;
create trigger live_article_text_projection_audit_immutable
before update or delete on public.live_article_text_projection_audit
for each row execute function public.dialektik_preserve_live_article_text_projection_audit();

create or replace function public.dialektik_prevent_article_original_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  selected_version_id text;
  version_row public.live_article_versions;
  receipt_row public.live_acquisition_receipts;
  policy_row public.live_source_policies;
  expected_text text;
begin
  if new.text_original is not distinct from old.text_original then
    return new;
  end if;

  if current_setting('dialektik.allow_live_excerpt_projection', true) is distinct from 'on'
    or old.origin is distinct from 'LIVE_REAL'
    or new.origin is distinct from 'LIVE_REAL' then
    raise exception using errcode = '55000', message = 'article original text is immutable';
  end if;

  selected_version_id := nullif(current_setting('dialektik.live_excerpt_version_id', true), '');
  if selected_version_id is null then
    raise exception using errcode = '55000', message = 'approved live excerpt version is required';
  end if;

  if exists (select 1 from public.claim_spans where article_id = old.id)
    or exists (
      select 1 from public.assertion_extraction_generations
      where article_id = old.id and state = 'active'
    ) then
    raise exception using errcode = '55000', message = 'Article text with semantic provenance is immutable';
  end if;

  select v.* into version_row
  from public.live_article_versions v
  where v.id::text = selected_version_id
    and v.article_id = old.id
    and v.id = (
      select current_version.id from public.live_article_versions current_version
      where current_version.article_id = old.id
      order by current_version.version_number desc limit 1
    );
  if not found or version_row.headline is null or nullif(btrim(version_row.excerpt), '') is null
    or char_length(version_row.excerpt) > 700 then
    raise exception using errcode = '23514', message = 'latest approved feed excerpt version is required';
  end if;

  select r.* into receipt_row
  from public.live_acquisition_receipts r
  where r.id = version_row.receipt_id
    and r.source_id = old.source_id
    and r.policy_id = (
      select current_policy.id from public.live_source_policies current_policy
      where current_policy.source_id = old.source_id
      order by current_policy.recorded_at desc, current_policy.id desc limit 1
    )
    and r.disposition = 'PERSISTED'
    and r.exclusion_id = old.live_exposure_id
    and r.canonical_url = old.url_canonical;
  if not found then
    raise exception using errcode = '23514', message = 'live excerpt acquisition receipt is not current';
  end if;

  select p.* into policy_row
  from public.live_source_policies p
  where p.id = receipt_row.policy_id
    and p.source_id = old.source_id
    and p.active
    and p.rights_class = 'LIVE_READY'
    and p.storage_policy = 'METADATA_AND_FEED_EXCERPT'
    and p.policy->>'rightsReviewStatus' = 'APPROVED'
    and nullif(p.policy->>'authorizationReference', '') is not null
    and nullif(p.policy->>'rightsEvidenceUrl', '') is not null
    and p.policy->>'rightsEvidenceUrl' <> 'https://supabase.com'
    and nullif(p.policy->>'endpoint', '') is not null
    and p.policy->>'endpoint' <> 'https://supabase.com';
  if not found then
    raise exception using errcode = '23514', message = 'current source excerpt policy is not approved';
  end if;

  expected_text := version_row.headline || '. ' || version_row.excerpt;
  if new.text_original is distinct from expected_text
    or new.text_normalized is distinct from lower(normalize(expected_text, NFKC)) then
    raise exception using errcode = '23514', message = 'Article projection must match the exact approved feed excerpt';
  end if;

  insert into public.live_article_text_projection_audit (
    article_id, article_version_id, previous_text_sha256, projected_text_sha256,
    reason, recorded_at
  ) values (
    old.id, version_row.id,
    encode(extensions.digest(convert_to(old.text_original, 'UTF8'), 'sha256'), 'hex'),
    encode(extensions.digest(convert_to(new.text_original, 'UTF8'), 'sha256'), 'hex'),
    'approved_feed_excerpt_projection_v1', date_trunc('milliseconds', clock_timestamp())
  );
  return new;
end;
$$;

do $$
declare
  version_row record;
  projection_date date;
  eligible_count integer;
  updated_count integer := 0;
begin
  select max((a.published_at at time zone 'America/Santiago')::date)
    into projection_date
  from public.articles a
  join lateral (
    select v.* from public.live_article_versions v
    where v.article_id = a.id order by v.version_number desc limit 1
  ) v on true
  join public.live_acquisition_receipts r on r.id = v.receipt_id
  join lateral (
    select p.* from public.live_source_policies p
    where p.source_id = a.source_id order by p.recorded_at desc, p.id desc limit 1
  ) p on p.id = r.policy_id
  where a.origin = 'LIVE_REAL'
    and (a.published_at at time zone 'America/Santiago')::date between
      (clock_timestamp() at time zone 'America/Santiago')::date - 3 and
      (clock_timestamp() at time zone 'America/Santiago')::date
    and r.disposition = 'PERSISTED'
    and r.source_id = a.source_id
    and r.exclusion_id = a.live_exposure_id
    and r.canonical_url = a.url_canonical
    and p.active and p.rights_class = 'LIVE_READY'
    and p.storage_policy = 'METADATA_AND_FEED_EXCERPT'
    and p.policy->>'rightsReviewStatus' = 'APPROVED'
    and nullif(p.policy->>'authorizationReference', '') is not null
    and nullif(p.policy->>'rightsEvidenceUrl', '') is not null
    and p.policy->>'rightsEvidenceUrl' <> 'https://supabase.com'
    and nullif(p.policy->>'endpoint', '') is not null
    and p.policy->>'endpoint' <> 'https://supabase.com'
    and v.headline is not null and btrim(v.headline) <> ''
    and nullif(btrim(v.excerpt), '') is not null and char_length(v.excerpt) <= 700;

  if projection_date is null then
    raise exception 'LIVE_EXCERPT_PROJECTION_SCOPE_INVALID: no eligible publication date';
  end if;

  select count(*)::integer into eligible_count
  from public.articles a
  join lateral (
    select v.* from public.live_article_versions v
    where v.article_id = a.id order by v.version_number desc limit 1
  ) v on true
  join public.live_acquisition_receipts r on r.id = v.receipt_id
  join lateral (
    select p.* from public.live_source_policies p
    where p.source_id = a.source_id order by p.recorded_at desc, p.id desc limit 1
  ) p on p.id = r.policy_id
  where a.origin = 'LIVE_REAL'
    and (a.published_at at time zone 'America/Santiago')::date = projection_date
    and r.disposition = 'PERSISTED'
    and r.source_id = a.source_id
    and r.exclusion_id = a.live_exposure_id
    and r.canonical_url = a.url_canonical
    and p.active and p.rights_class = 'LIVE_READY'
    and p.storage_policy = 'METADATA_AND_FEED_EXCERPT'
    and p.policy->>'rightsReviewStatus' = 'APPROVED'
    and nullif(p.policy->>'authorizationReference', '') is not null
    and nullif(p.policy->>'rightsEvidenceUrl', '') is not null
    and p.policy->>'rightsEvidenceUrl' <> 'https://supabase.com'
    and nullif(p.policy->>'endpoint', '') is not null
    and p.policy->>'endpoint' <> 'https://supabase.com'
    and v.headline is not null and btrim(v.headline) <> ''
    and nullif(btrim(v.excerpt), '') is not null and char_length(v.excerpt) <= 700;

  if eligible_count = 0 or eligible_count > 1200 then
    raise exception 'LIVE_EXCERPT_PROJECTION_SCOPE_INVALID: %', eligible_count;
  end if;

  for version_row in
    select a.id as article_id, v.id as version_id, v.headline, v.excerpt,
      a.text_original as previous_text, a.text_normalized as previous_normalized
    from public.articles a
    join lateral (
      select current_version.* from public.live_article_versions current_version
      where current_version.article_id = a.id
      order by current_version.version_number desc limit 1
    ) v on true
    join public.live_acquisition_receipts r on r.id = v.receipt_id
    join lateral (
      select current_policy.* from public.live_source_policies current_policy
      where current_policy.source_id = a.source_id
      order by current_policy.recorded_at desc, current_policy.id desc limit 1
    ) p on p.id = r.policy_id
    where a.origin = 'LIVE_REAL'
      and (a.published_at at time zone 'America/Santiago')::date = projection_date
      and r.disposition = 'PERSISTED'
      and r.source_id = a.source_id
      and r.exclusion_id = a.live_exposure_id
      and r.canonical_url = a.url_canonical
      and p.active and p.rights_class = 'LIVE_READY'
      and p.storage_policy = 'METADATA_AND_FEED_EXCERPT'
      and p.policy->>'rightsReviewStatus' = 'APPROVED'
      and nullif(p.policy->>'authorizationReference', '') is not null
      and nullif(p.policy->>'rightsEvidenceUrl', '') is not null
      and p.policy->>'rightsEvidenceUrl' <> 'https://supabase.com'
      and nullif(p.policy->>'endpoint', '') is not null
      and p.policy->>'endpoint' <> 'https://supabase.com'
      and v.headline is not null and btrim(v.headline) <> ''
      and nullif(btrim(v.excerpt), '') is not null and char_length(v.excerpt) <= 700
    order by a.id
  loop
    if version_row.previous_text is distinct from version_row.headline || '. ' || version_row.excerpt
      or version_row.previous_normalized is distinct from lower(normalize(
        version_row.headline || '. ' || version_row.excerpt, NFKC
      )) then
      perform set_config('dialektik.allow_live_excerpt_projection', 'on', true);
      perform set_config('dialektik.live_excerpt_version_id', version_row.version_id::text, true);
      update public.articles
      set text_original = version_row.headline || '. ' || version_row.excerpt,
        text_normalized = lower(normalize(version_row.headline || '. ' || version_row.excerpt, NFKC))
      where id = version_row.article_id;
      updated_count := updated_count + 1;
    end if;
  end loop;

  if exists (
    select 1
    from public.articles a
    join lateral (
      select v.* from public.live_article_versions v
      where v.article_id = a.id order by v.version_number desc limit 1
    ) v on true
    join public.live_acquisition_receipts r on r.id = v.receipt_id
    join lateral (
      select p.* from public.live_source_policies p
      where p.source_id = a.source_id order by p.recorded_at desc, p.id desc limit 1
    ) p on p.id = r.policy_id
    where a.origin = 'LIVE_REAL'
      and (a.published_at at time zone 'America/Santiago')::date = projection_date
      and r.disposition = 'PERSISTED'
      and r.source_id = a.source_id and r.exclusion_id = a.live_exposure_id
      and r.canonical_url = a.url_canonical
      and p.active and p.rights_class = 'LIVE_READY'
      and p.storage_policy = 'METADATA_AND_FEED_EXCERPT'
      and p.policy->>'rightsReviewStatus' = 'APPROVED'
      and nullif(p.policy->>'authorizationReference', '') is not null
      and nullif(p.policy->>'rightsEvidenceUrl', '') is not null
      and p.policy->>'rightsEvidenceUrl' <> 'https://supabase.com'
      and nullif(p.policy->>'endpoint', '') is not null
      and p.policy->>'endpoint' <> 'https://supabase.com'
      and v.headline is not null and btrim(v.headline) <> ''
      and nullif(btrim(v.excerpt), '') is not null and char_length(v.excerpt) <= 700
      and (a.text_original is distinct from v.headline || '. ' || v.excerpt
        or a.text_normalized is distinct from lower(normalize(v.headline || '. ' || v.excerpt, NFKC)))
  ) then
    raise exception 'LIVE_EXCERPT_PROJECTION_INCOMPLETE';
  end if;

  raise notice 'LIVE_EXCERPT_PROJECTION date=% eligible=% updated=%', projection_date, eligible_count, updated_count;
end;
$$;
`;

export const liveExcerptTextProjectionMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(LIVE_EXCERPT_TEXT_PROJECTION_SQL).execute(database);
  },
  async down(): Promise<void> {
    throw new Error('Live source excerpts may have semantic references; projection is not reversible.');
  },
};
