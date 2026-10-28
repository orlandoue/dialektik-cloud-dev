-- Applied to dialektik-dev on 2026-10-28 UTC. Retained for review and recovery.
-- Restore the original live-provenance and prospective rights-fence guards.
-- Source: migrations 017, 018, 022 and 037 in this repository.
-- Applies only if every listed live function is still the inspected no-op.
-- Existing article/version/policy rows are not changed. The missing technical
-- rights-fence row is added before its original internal-only guard is restored.
-- The broader graph/audit guards need a separate integrity and recovery plan.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.sources in share row exclusive mode;
lock table public.prospective_content_rights_write_guards in share row exclusive mode;

do $$
declare
  name text;
  body text;
begin
  foreach name in array array[
    'dialektik_live_append_only',
    'dialektik_preserve_live_source',
    'dialektik_validate_live_article',
    'dialektik_validate_live_receipt',
    'dialektik_validate_live_version',
    'dialektik_guard_article_ephemeral_text',
    'dialektik_protect_prospective_rights_guard',
    'dialektik_seed_prospective_rights_guard'
  ] loop
    select p.prosrc into body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = name
      and p.pronargs = 0 and p.prorettype = 'pg_catalog.trigger'::regtype;
    if body is null or regexp_replace(lower(body), '[[:space:]]', '', 'g') <> 'beginreturnnew;end;' then
      raise exception 'Cannot restore %: expected inspected no-op definition', name;
    end if;
  end loop;
end
$$;

insert into public.prospective_content_rights_write_guards (source_id)
select s.id from public.sources s
where not exists (
  select 1 from public.prospective_content_rights_write_guards g where g.source_id = s.id
)
on conflict (source_id) do nothing;

-- 017_product_live_shadow.ts
create or replace function public.dialektik_live_append_only() returns trigger language plpgsql as $$
begin
  raise exception using errcode = '23514', message = 'live provenance and exposure are append-only';
end;
$$;

-- 017_product_live_shadow.ts
create or replace function public.dialektik_preserve_live_source() returns trigger language plpgsql as $$
begin
  if old.origin = 'LIVE_REAL' and (new.origin is distinct from old.origin
    or new.id is distinct from old.id or new.canonical_domain is distinct from old.canonical_domain) then
    raise exception using errcode = '23514', message = 'live source origin and identity are permanent';
  end if;
  return new;
end;
$$;

-- 017_product_live_shadow.ts
create or replace function public.dialektik_validate_live_article() returns trigger language plpgsql as $$
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

-- 017_product_live_shadow.ts
create or replace function public.dialektik_validate_live_receipt() returns trigger language plpgsql as $$
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

-- 017_product_live_shadow.ts
create or replace function public.dialektik_validate_live_version() returns trigger language plpgsql as $$
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

-- 018_ephemeral_semantic_pipeline.ts
create or replace function public.dialektik_guard_article_ephemeral_text() returns trigger language plpgsql as $$
begin
  if (new.source_id is distinct from old.source_id or new.url_canonical is distinct from old.url_canonical)
    and exists (select 1 from observed_article_content_versions where article_id = old.id) then
    raise exception using errcode = '23514', message = 'observed content Article identity is permanent';
  end if;
  if exists (select 1 from observed_article_content_versions v join content_access_policies p on p.id = v.policy_id
    where v.article_id = new.id and p.content_access_mode = 'FULLTEXT_EPHEMERAL'
      and (encode(digest(convert_to(new.text_original, 'UTF8'), 'sha256'), 'hex') = v.normalized_input_hash
        or encode(digest(convert_to(new.text_normalized, 'UTF8'), 'sha256'), 'hex') = v.normalized_input_hash)) then
    raise exception using errcode = '23514', message = 'ephemeral input cannot enter Article text storage';
  end if;
  return new;
end;
$$;

-- 022_prospective_multisource_shadow.ts
create or replace function public.dialektik_protect_prospective_rights_guard() returns trigger language plpgsql as $$
begin
  if tg_op in ('DELETE','TRUNCATE') or pg_trigger_depth() < 2 then
    raise exception using errcode='23514',message='prospective rights fence is internal technical state';
  end if;
  if tg_op='UPDATE' and (new.source_id <> old.source_id or new.revision <> old.revision+1) then
    raise exception using errcode='23514',message='prospective rights fence revision must advance exactly once';
  end if;
  return new;
end;
$$;

-- 037_seed_prospective_rights_guard_for_new_sources.ts
create or replace function public.dialektik_seed_prospective_rights_guard()
returns trigger language plpgsql as $$
begin
  insert into prospective_content_rights_write_guards(source_id)
  values (new.id)
  on conflict (source_id) do nothing;
  return new;
end;
$$;

commit;
