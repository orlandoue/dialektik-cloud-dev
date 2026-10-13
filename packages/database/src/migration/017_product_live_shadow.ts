import { sql, type Migration } from 'kysely';

const SCHEMA = String.raw`
alter table sources add column origin text not null default 'FIXTURE'
  check (origin in ('FIXTURE', 'STRESS_SYNTHETIC', 'LIVE_REAL'));
alter table articles add column origin text not null default 'FIXTURE'
  check (origin in ('FIXTURE', 'STRESS_SYNTHETIC', 'LIVE_REAL'));
update sources set origin = 'STRESS_SYNTHETIC'
  where canonical_domain like 'stress-%.dialektik.invalid';
update articles set origin = 'STRESS_SYNTHETIC'
  where source_id in (select id from sources where origin = 'STRESS_SYNTHETIC');

create table live_source_policies (
  id text primary key check (id ~ '^[0-9a-f]{64}$'),
  source_id dialektik_ulid not null references sources(id),
  registry_key text not null,
  rights_class text not null check (rights_class in (
    'LIVE_READY', 'DISCOVERY_ONLY', 'LICENSE_REQUIRED', 'PERMISSION_REQUIRED',
    'PROHIBITED_OR_UNSAFE', 'TECHNICALLY_UNRELIABLE')),
  storage_policy text not null check (storage_policy in ('METADATA_ONLY', 'METADATA_AND_FEED_EXCERPT')),
  active boolean not null,
  rights_evidence_url text not null check (rights_evidence_url ~ '^https://'),
  rights_verified_at timestamptz(3) not null,
  policy jsonb not null,
  recorded_at timestamptz(3) not null,
  check (not active or rights_class = 'LIVE_READY'),
  unique (source_id, id)
);

create table live_exposure_exclusions (
  id text primary key check (id ~ '^[0-9a-f]{64}$'),
  registry_key text not null,
  publisher_name text not null,
  canonical_url text,
  source_item_id text,
  published_at timestamptz(3),
  first_seen_at timestamptz(3) not null,
  discovery_url text,
  reason text not null,
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  near_duplicate_signature text,
  exclusion_status text not null default 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2'
    check (exclusion_status = 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2'),
  check (canonical_url is not null or source_item_id is not null)
);
create index live_exclusions_by_canonical on live_exposure_exclusions(canonical_url);

create table live_acquisition_receipts (
  id dialektik_ulid primary key,
  source_id dialektik_ulid not null references sources(id),
  policy_id text not null,
  exclusion_id text not null references live_exposure_exclusions(id),
  discovery_channel text not null check (discovery_channel = 'rss_atom'),
  discovery_url text not null,
  discovered_url text,
  canonical_url text,
  source_item_id text,
  published_at timestamptz(3),
  modified_at timestamptz(3),
  original_published_at text,
  original_modified_at text,
  seen_at timestamptz(3) not null,
  raw_payload_hash text not null check (raw_payload_hash ~ '^[0-9a-f]{64}$'),
  adapter_version text not null,
  disposition text not null check (disposition in ('PERSISTED', 'QUARANTINED')),
  error_code text,
  foreign key (source_id, policy_id) references live_source_policies(source_id, id)
);
create index live_receipts_by_exclusion on live_acquisition_receipts(exclusion_id, seen_at, id);

alter table articles add column live_exposure_id text references live_exposure_exclusions(id);
alter table articles add constraint articles_live_origin_exclusion check (
  (origin = 'LIVE_REAL' and live_exposure_id is not null and event_id is null)
  or (origin <> 'LIVE_REAL' and live_exposure_id is null)
);

create table live_article_versions (
  id dialektik_ulid primary key,
  article_id dialektik_ulid not null references articles(id),
  receipt_id dialektik_ulid not null references live_acquisition_receipts(id),
  version_number integer not null check (version_number > 0),
  metadata_hash text not null check (metadata_hash ~ '^[0-9a-f]{64}$'),
  headline text not null check (btrim(headline) <> ''),
  excerpt text,
  author text,
  published_at timestamptz(3) not null,
  modified_at timestamptz(3),
  declared_upstream text,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  near_duplicate_signature text not null,
  recorded_at timestamptz(3) not null,
  unique (article_id, version_number)
);
create index live_versions_by_article on live_article_versions(article_id, version_number desc);

create function dialektik_live_append_only() returns trigger language plpgsql as $$
begin
  raise exception using errcode = '23514', message = 'live provenance and exposure are append-only';
end;
$$;
create trigger live_policies_immutable before update or delete on live_source_policies
  for each row execute function dialektik_live_append_only();
create trigger live_exclusions_immutable before update or delete on live_exposure_exclusions
  for each row execute function dialektik_live_append_only();
create trigger live_receipts_immutable before update or delete on live_acquisition_receipts
  for each row execute function dialektik_live_append_only();
create trigger live_versions_immutable before update or delete on live_article_versions
  for each row execute function dialektik_live_append_only();
create trigger live_policies_no_truncate before truncate on live_source_policies
  for each statement execute function dialektik_live_append_only();
create trigger live_exclusions_no_truncate before truncate on live_exposure_exclusions
  for each statement execute function dialektik_live_append_only();
create trigger live_receipts_no_truncate before truncate on live_acquisition_receipts
  for each statement execute function dialektik_live_append_only();
create trigger live_versions_no_truncate before truncate on live_article_versions
  for each statement execute function dialektik_live_append_only();

create function dialektik_validate_live_article() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.origin = 'LIVE_REAL' and (
    new.origin is distinct from old.origin or new.live_exposure_id is distinct from old.live_exposure_id
    or new.source_id is distinct from old.source_id or new.url_canonical is distinct from old.url_canonical
  ) then
    raise exception using errcode = '23514', message = 'live article identity and exclusion are permanent';
  end if;
  if new.origin = 'LIVE_REAL' and not exists (
    select 1 from sources s join live_source_policies p on p.source_id = s.id
    join live_exposure_exclusions e on e.id = new.live_exposure_id
    where s.id = new.source_id and s.origin = 'LIVE_REAL'
      and p.active and p.rights_class = 'LIVE_READY'
      and p.registry_key = e.registry_key and e.canonical_url = new.url_canonical
  ) then
    raise exception using errcode = '23514', message = 'live article requires permitted source and matching exclusion';
  end if;
  return new;
end;
$$;
create trigger articles_validate_live before insert or update on articles
  for each row execute function dialektik_validate_live_article();

create function dialektik_preserve_live_source() returns trigger language plpgsql as $$
begin
  if old.origin = 'LIVE_REAL' and (new.origin is distinct from old.origin
    or new.id is distinct from old.id or new.canonical_domain is distinct from old.canonical_domain) then
    raise exception using errcode = '23514', message = 'live source origin and identity are permanent';
  end if;
  return new;
end;
$$;
create trigger sources_preserve_live before update on sources
  for each row execute function dialektik_preserve_live_source();

create function dialektik_validate_live_receipt() returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from live_source_policies p join live_exposure_exclusions e on e.id = new.exclusion_id
      join sources s on s.id = p.source_id
    where p.id = new.policy_id and p.source_id = new.source_id and s.origin = 'LIVE_REAL'
      and e.registry_key = p.registry_key and p.active and p.rights_class = 'LIVE_READY'
  ) then
    raise exception using errcode = '23514', message = 'live receipt requires matching source policy and permanent exclusion';
  end if;
  return new;
end;
$$;
create trigger live_receipts_validate before insert on live_acquisition_receipts
  for each row execute function dialektik_validate_live_receipt();

create function dialektik_validate_live_version() returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from articles a join live_acquisition_receipts r on r.id = new.receipt_id
      join live_source_policies p on p.id = r.policy_id
    where a.id = new.article_id and a.origin = 'LIVE_REAL'
      and a.source_id = r.source_id and a.live_exposure_id = r.exclusion_id
      and r.disposition = 'PERSISTED' and p.active and p.rights_class = 'LIVE_READY'
      and (new.excerpt is null or p.storage_policy = 'METADATA_AND_FEED_EXCERPT')
      and exists (select 1 from live_exposure_exclusions e
        where e.registry_key = p.registry_key and e.canonical_url = r.canonical_url
          and e.content_hash = new.content_hash and e.near_duplicate_signature = new.near_duplicate_signature)
  ) then
    raise exception using errcode = '23514', message = 'live version requires linked permitted acquisition receipt';
  end if;
  return new;
end;
$$;
create trigger live_versions_validate before insert on live_article_versions
  for each row execute function dialektik_validate_live_version();
`;

export const productLiveShadowMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
};
