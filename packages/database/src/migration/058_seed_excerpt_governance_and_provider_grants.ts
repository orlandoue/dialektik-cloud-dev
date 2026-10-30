import { createHash } from "node:crypto";
import { sql, type Migration } from "kysely";
import { generateUlid } from "../domain/ids";

const OWNER = "orlandoue";
const PROVIDER = "llm_cloudflare_workers_ai";
const MODEL = "@cf/meta/llama-3.1-8b-instruct";
const LAW_URL = "https://www.bcn.cl/leychile/navegar?idNorma=28933";
const YOUTUBE_TERMS_URL =
  "https://developers.google.com/youtube/terms/api-services-terms-of-service";
const CLOUDFLARE_DATA_URL =
  "https://developers.cloudflare.com/workers-ai/platform/data-usage/";
const CLOUDFLARE_DATA_SHA256 =
  "0fedef1162b8ceebbf18fa32d87f5cf94e1300ddac6422d80b40873f24cbf66b";
const PRESS_DOMAINS = [
  "biobiochile.cl",
  "ciperchile.cl",
  "cooperativa.cl",
  "diarioeldia.cl",
  "elmostrador.cl",
  "latercera.com",
] as const;
const FALSE_SCOPES = {
  acquisition: false,
  metadata_storage: false,
  excerpt_storage: false,
  fulltext_acquisition: false,
  fulltext_persistence: false,
  external_ai_transmission: false,
  derived_semantic_persistence: false,
  redisplay: false,
};

const SCHEMA = String.raw`
create table public.live_semantic_source_route_grants (
  id dialektik_ulid primary key,
  source_id dialektik_ulid not null references public.sources(id),
  policy_id text not null,
  provider_type text not null check(provider_type='llm_cloudflare_workers_ai'),
  processing_route text not null check(processing_route in ('EXTERNAL_LLM_PROCESSING_ALLOWED','NOT_ALLOWED')),
  fulltext_acquisition boolean not null check(fulltext_acquisition=false),
  machine_processing boolean not null,
  derived_persistence boolean not null,
  fulltext_persistence boolean not null check(fulltext_persistence=false),
  evidence_fragments boolean not null,
  rights_receipt_sha256 text not null check(rights_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz(3) not null,
  foreign key(source_id,policy_id) references public.content_access_policies(source_id,id),
  unique(source_id,policy_id,provider_type)
);
create function public.dialektik_live_semantic_route_grant_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode='55000',message='live semantic source route grant history is append-only';
  end if;
  return new;
end;
$$;
create trigger live_semantic_source_route_grants_append_only
 before update or delete on public.live_semantic_source_route_grants
 for each row execute function public.dialektik_live_semantic_route_grant_append_only();
create trigger live_semantic_source_route_grants_no_truncate
 before truncate on public.live_semantic_source_route_grants
 for each statement execute function public.dialektik_live_semantic_route_grant_append_only();
create table public.live_semantic_production_runs (
  id dialektik_ulid primary key,
  requested_by dialektik_ulid not null references public.users(id),
  target_day date not null,
  provider_type text not null check(provider_type='llm_cloudflare_workers_ai'),
  model_id text not null check(model_id='@cf/meta/llama-3.1-8b-instruct'),
  config_sha256 text not null check(config_sha256 ~ '^[0-9a-f]{64}$'),
  requested_count integer not null check(requested_count between 1 and 5),
  processed_count integer not null default 0 check(processed_count between 0 and requested_count),
  pair_assessment_count integer not null default 0 check(pair_assessment_count between 0 and 20),
  started_at timestamptz(3) not null,
  completed_at timestamptz(3),
  check(completed_at is null or completed_at>=started_at)
);
create table public.live_semantic_event_group_candidates (
  id dialektik_ulid primary key,
  origin_run_id dialektik_ulid not null references public.live_semantic_production_runs(id),
  group_key_sha256 text not null unique check(group_key_sha256 ~ '^[0-9a-f]{64}$'),
  target_day date not null,
  proposed_event_key text not null check(length(btrim(proposed_event_key)) between 1 and 120),
  proposed_title text not null check(length(btrim(proposed_title)) between 1 and 240),
  proposed_summary text not null check(length(btrim(proposed_summary)) between 1 and 500),
  provider_type text not null check(provider_type='llm_cloudflare_workers_ai'),
  model_id text not null check(model_id='@cf/meta/llama-3.1-8b-instruct'),
  config_sha256 text not null check(config_sha256 ~ '^[0-9a-f]{64}$'),
  review_state text not null default 'REVIEW_REQUIRED' check(review_state='REVIEW_REQUIRED'),
  created_at timestamptz(3) not null
);
create table public.live_semantic_article_attempts (
  id dialektik_ulid primary key,
  run_id dialektik_ulid not null references public.live_semantic_production_runs(id),
  requested_by dialektik_ulid not null references public.users(id),
  article_id dialektik_ulid not null references public.articles(id),
  source_id dialektik_ulid not null references public.sources(id),
  policy_id text not null references public.content_access_policies(id),
  input_sha256 text not null check(input_sha256 ~ '^[0-9a-f]{64}$'),
  provider_type text not null check(provider_type='llm_cloudflare_workers_ai'),
  model_id text not null check(model_id='@cf/meta/llama-3.1-8b-instruct'),
  config_sha256 text not null check(config_sha256 ~ '^[0-9a-f]{64}$'),
  request_started_at timestamptz(3) not null,
  unique(article_id,input_sha256,config_sha256)
);
create table public.live_semantic_article_outcomes (
  attempt_id dialektik_ulid primary key references public.live_semantic_article_attempts(id),
  outcome text not null check(outcome in ('VALIDATED','NO_CLAIM_WORTHY_CONTENT','REJECTED','UNKNOWN_SENT','PERSISTENCE_FAILED')),
  extraction_generation_id dialektik_ulid references public.assertion_extraction_generations(id),
  error_code text check(error_code is null or error_code ~ '^[A-Z0-9_]{1,64}$'),
  recorded_at timestamptz(3) not null,
  check((outcome in ('VALIDATED','NO_CLAIM_WORTHY_CONTENT'))=(extraction_generation_id is not null))
);
create table public.live_semantic_event_group_members (
  group_id dialektik_ulid not null references public.live_semantic_event_group_candidates(id),
  article_id dialektik_ulid not null references public.articles(id),
  source_id dialektik_ulid not null references public.sources(id),
  extraction_generation_id dialektik_ulid not null references public.assertion_extraction_generations(id),
  matched_at timestamptz(3) not null,
  primary key(group_id,article_id)
);
create table public.live_semantic_pair_assessments (
  id dialektik_ulid primary key,
  run_id dialektik_ulid not null references public.live_semantic_production_runs(id),
  group_id dialektik_ulid not null references public.live_semantic_event_group_candidates(id),
  left_article_id dialektik_ulid not null references public.articles(id),
  right_article_id dialektik_ulid not null references public.articles(id),
  left_extraction_generation_id dialektik_ulid not null references public.assertion_extraction_generations(id),
  right_extraction_generation_id dialektik_ulid not null references public.assertion_extraction_generations(id),
  relation text not null check(relation in ('CONSISTENT','DIVERGENT','CONTRADICTORY','NOT_COMPARABLE')),
  ratio_conflicting smallint not null check(ratio_conflicting between 0 and 100),
  ratio_comparable smallint not null check(ratio_comparable between 0 and 100),
  same_event_confidence smallint not null check(same_event_confidence between 0 and 100),
  threshold_rule text not null check(length(btrim(threshold_rule)) between 1 and 200),
  provider_type text not null check(provider_type='llm_cloudflare_workers_ai'),
  model_id text not null check(model_id='@cf/meta/llama-3.1-8b-instruct'),
  config_sha256 text not null check(config_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz(3) not null,
  check(left_article_id<right_article_id),
  check(ratio_conflicting<=ratio_comparable or ratio_comparable=0),
  check(relation='NOT_COMPARABLE' or ratio_comparable>0),
  unique(left_article_id,right_article_id,config_sha256)
);
create index live_semantic_runs_by_day on public.live_semantic_production_runs(target_day,started_at desc);
create index live_semantic_group_members_by_article on public.live_semantic_event_group_members(article_id);
create index live_semantic_pair_assessments_by_group on public.live_semantic_pair_assessments(group_id,created_at);

create function public.dialektik_live_semantic_source_allowed(source_identity dialektik_ulid)
returns boolean language sql stable security definer
set search_path=pg_catalog,public,extensions as $$
 select exists(
  select 1 from public.sources s
  join lateral(select p.* from public.live_source_policies p where p.source_id=s.id order by p.recorded_at desc,p.id desc limit 1) lp on true
  join lateral(select p.* from public.content_access_policies p where p.source_id=s.id order by p.recorded_at desc,p.id desc limit 1) cp on true
  join lateral(select d.* from public.personal_owner_source_rights_decisions d where d.source_id=s.id and d.owner_identity='orlandoue' order by d.sequence_number desc limit 1) rd on true
  join lateral(select g.* from public.live_semantic_source_route_grants g where g.source_id=s.id and g.provider_type='llm_cloudflare_workers_ai' order by g.recorded_at desc,g.id desc limit 1) rg on true
  join lateral(select a.* from public.personal_owner_provider_authorizations a where a.owner_identity='orlandoue' and a.provider_type='llm_cloudflare_workers_ai' and a.model_id='@cf/meta/llama-3.1-8b-instruct' order by a.recorded_at desc,a.id desc limit 1) pa on true
  where s.id=source_identity and s.origin='LIVE_REAL'
   and s.canonical_domain in ('biobiochile.cl','ciperchile.cl','cooperativa.cl','diarioeldia.cl','latercera.com')
   and lp.active and lp.rights_class='LIVE_READY' and lp.storage_policy='METADATA_AND_FEED_EXCERPT'
   and lp.policy->>'rightsReviewStatus'='APPROVED'
   and nullif(lp.policy->>'endpoint','') is not null and nullif(lp.policy->>'rightsEvidenceUrl','') is not null
   and cp.personal_owner_source_rights_decision_id=rd.id
   and cp.rights_evidence_sha256=rd.rights_evidence_sha256
   and rg.policy_id=cp.id
   and cp.content_access_mode='EXCERPT_EPHEMERAL' and cp.excerpt_storage and cp.external_ai_transmission
   and cp.derived_semantic_persistence and cp.minimal_evidence_fragment
   and cp.evidence_quote_max_codepoints between 1 and 300
   and not cp.fulltext_acquisition and not cp.fulltext_machine_processing and not cp.fulltext_persistence and not cp.redisplay
   and rd.decision_status='AUTHORIZED' and (rd.expires_at is null or rd.expires_at>statement_timestamp())
   and rd.scopes->>'excerpt_storage'='true'
   and rd.scopes->>'external_ai_transmission'='true' and rd.scopes->>'derived_semantic_persistence'='true'
   and rd.scopes->>'fulltext_acquisition'='false' and rd.scopes->>'fulltext_persistence'='false'
   and rg.processing_route='EXTERNAL_LLM_PROCESSING_ALLOWED' and not rg.fulltext_acquisition
   and rg.machine_processing and rg.derived_persistence and not rg.fulltext_persistence and rg.evidence_fragments
   and pa.decision_status='AUTHORIZED' and pa.valid_from<=statement_timestamp()
   and (pa.expires_at is null or pa.expires_at>statement_timestamp())
 )
$$;

create function public.dialektik_live_semantic_article_read_allowed(article_identity dialektik_ulid)
returns boolean language sql stable security definer
set search_path=pg_catalog,public,extensions as $$
 select exists(
  select 1 from public.articles a
  join public.sources s on s.id=a.source_id
  join lateral(select v.* from public.live_article_versions v where v.article_id=a.id order by v.version_number desc limit 1) v on true
  join public.live_acquisition_receipts r on r.id=v.receipt_id and r.disposition='PERSISTED'
   and r.source_id=a.source_id and r.exclusion_id=a.live_exposure_id and r.canonical_url=a.url_canonical
  join public.live_exposure_exclusions x on x.id=a.live_exposure_id
   and x.exclusion_status='PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2'
  where a.id=article_identity and a.origin='LIVE_REAL' and s.origin='LIVE_REAL'
   and public.dialektik_live_semantic_source_allowed(s.id)
   and v.excerpt is not null and btrim(v.excerpt)<>'' and char_length(v.excerpt)<=700
   and char_length(a.text_original)<=1250
   and a.text_original=v.headline||'. '||v.excerpt
   and public.dialektik_live_semantic_source_allowed(a.source_id)
 )
$$;

create function public.dialektik_live_semantic_route_allowed(
 article_identity dialektik_ulid,expected_input_hash text,provider_identity text,model_identity text
) returns boolean language sql stable security definer
set search_path=pg_catalog,public,extensions as $$
 select provider_identity='llm_cloudflare_workers_ai' and model_identity='@cf/meta/llama-3.1-8b-instruct'
  and exists(
   select 1 from public.articles a
   join public.sources s on s.id=a.source_id
   join lateral(select cp.* from public.content_access_policies cp where cp.source_id=s.id order by cp.recorded_at desc,cp.id desc limit 1) cp on true
   join lateral(select g.* from public.live_semantic_source_route_grants g where g.source_id=s.id and g.provider_type=provider_identity order by g.recorded_at desc,g.id desc limit 1) sg on true
   where a.id=article_identity and public.dialektik_live_semantic_article_read_allowed(a.id)
    and encode(extensions.digest(convert_to(a.text_original,'UTF8'),'sha256'),'hex')=expected_input_hash
    and cp.content_access_mode='EXCERPT_EPHEMERAL' and cp.excerpt_storage
    and cp.external_ai_transmission and cp.derived_semantic_persistence
    and sg.policy_id=cp.id and sg.processing_route='EXTERNAL_LLM_PROCESSING_ALLOWED'
    and not sg.fulltext_acquisition and sg.machine_processing and sg.derived_persistence
    and not sg.fulltext_persistence and sg.evidence_fragments
    and public.dialektik_live_semantic_source_allowed(s.id)
  )
$$;
revoke all on function public.dialektik_live_semantic_source_allowed(dialektik_ulid) from public,anon,authenticated;
revoke all on function public.dialektik_live_semantic_article_read_allowed(dialektik_ulid) from public,anon,authenticated;
revoke all on function public.dialektik_live_semantic_route_allowed(dialektik_ulid,text,text,text) from public,anon,authenticated;
grant execute on function public.dialektik_live_semantic_source_allowed(dialektik_ulid) to dialektik_headline_ai_writer;
grant execute on function public.dialektik_live_semantic_article_read_allowed(dialektik_ulid) to dialektik_headline_ai_writer;
grant execute on function public.dialektik_live_semantic_route_allowed(dialektik_ulid,text,text,text) to dialektik_headline_ai_writer;
create policy live_semantic_ai_article_read on public.articles for select to dialektik_headline_ai_writer
 using(public.dialektik_live_semantic_article_read_allowed(id));
create view public.live_semantic_excerpt_inputs as
 select a.id::text as article_id,a.source_id::text as source_id,a.event_id::text as event_id,a.url_canonical,
  a.text_original,a.published_at,s.name as source_name,v.id::text as version_id,v.headline,v.excerpt,
  v.published_at as version_published_at,cp.id as policy_id,
  encode(extensions.digest(convert_to(a.text_original,'UTF8'),'sha256'),'hex') as input_sha256
 from public.articles a join public.sources s on s.id=a.source_id
 join lateral(select v.* from public.live_article_versions v where v.article_id=a.id order by v.version_number desc limit 1) v on true
 join lateral(select cp.* from public.content_access_policies cp where cp.source_id=a.source_id order by cp.recorded_at desc,cp.id desc limit 1) cp on true
 where public.dialektik_live_semantic_article_read_allowed(a.id)
  and public.dialektik_live_semantic_route_allowed(a.id,
    encode(extensions.digest(convert_to(a.text_original,'UTF8'),'sha256'),'hex'),
    'llm_cloudflare_workers_ai','@cf/meta/llama-3.1-8b-instruct');
revoke all on public.live_semantic_excerpt_inputs from public,anon,authenticated;
grant select on public.live_semantic_excerpt_inputs to dialektik_headline_ai_writer;

do $$ declare tab text;
begin
 foreach tab in array array['live_semantic_production_runs','live_semantic_article_attempts','live_semantic_article_outcomes','live_semantic_event_group_candidates','live_semantic_event_group_members','live_semantic_pair_assessments'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant select on public.%I to dialektik_core_app',tab);
  execute format('create policy %I on public.%I for select to dialektik_core_app using (true)',tab||'_core_read',tab);
  execute format('grant select,insert on public.%I to dialektik_headline_ai_writer',tab);
  execute format('create policy %I on public.%I for select to dialektik_headline_ai_writer using (true)',tab||'_ai_read',tab);
  execute format('create policy %I on public.%I for insert to dialektik_headline_ai_writer with check (true)',tab||'_ai_insert',tab);
 end loop;
end $$;
alter table public.live_semantic_source_route_grants enable row level security;
revoke all on public.live_semantic_source_route_grants from public,anon,authenticated;
grant select on public.live_semantic_source_route_grants to dialektik_core_app,dialektik_headline_ai_writer;
create policy live_semantic_source_route_grants_core_read on public.live_semantic_source_route_grants
 for select to dialektik_core_app using(true);
create policy live_semantic_source_route_grants_ai_read on public.live_semantic_source_route_grants
 for select to dialektik_headline_ai_writer using(true);
grant update(processed_count,pair_assessment_count,completed_at)
  on public.live_semantic_production_runs to dialektik_headline_ai_writer;
create policy live_semantic_runs_ai_update on public.live_semantic_production_runs
  for update to dialektik_headline_ai_writer using(true) with check(true);
grant usage on schema public to dialektik_headline_ai_writer;
grant select on public.sources,public.live_article_versions,public.live_acquisition_receipts,public.live_exposure_exclusions,
 public.live_source_policies,public.content_access_policies,public.personal_owner_source_rights_decisions,
 public.personal_owner_provider_authorizations to dialektik_headline_ai_writer;
grant select(id,source_id,event_id,url_canonical,text_original,published_at,origin,live_exposure_id)
 on public.articles to dialektik_headline_ai_writer;
grant select,insert on public.assertion_extraction_generations to dialektik_headline_ai_writer;
grant select on public.live_semantic_source_route_grants to dialektik_headline_ai_writer;
do $$ begin
 if exists(select 1 from pg_roles where rolname='service_role') then
  revoke all on public.live_semantic_source_route_grants,public.live_semantic_production_runs,public.live_semantic_event_group_candidates,
   public.live_semantic_article_attempts,public.live_semantic_article_outcomes,
   public.live_semantic_event_group_members,public.live_semantic_pair_assessments from service_role;
 end if;
end $$;
`;

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function quote(value: string): string {
  return "'" + value.replace(/'/gu, "''") + "'";
}
type SourceRow = {
  id: string;
  name: string;
  canonical_domain: string;
  origin: string;
  live_policy_id: string;
  registry_key: string;
  rights_class: string;
  storage_policy: string;
  active: boolean;
  endpoint: string | null;
  rights_evidence_url: string | null;
  rights_review_status: string | null;
};

export const excerptGovernanceAndProviderGrantsMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
    const result = await sql<SourceRow>`
      select s.id::text as id,s.name,s.canonical_domain,s.origin,lp.id as live_policy_id,
        lp.registry_key,lp.rights_class,lp.storage_policy,lp.active,
        lp.policy->>'endpoint' as endpoint,lp.policy->>'rightsEvidenceUrl' as rights_evidence_url,
        lp.policy->>'rightsReviewStatus' as rights_review_status
      from public.sources s join lateral(
        select p.* from public.live_source_policies p where p.source_id=s.id
        order by p.recorded_at desc,p.id desc limit 1) lp on true
      where s.canonical_domain in ('biobiochile.cl','ciperchile.cl','cooperativa.cl','diarioeldia.cl','elmostrador.cl','latercera.com')
        or s.canonical_domain='youtube.com'
      order by s.canonical_domain,s.id
    `.execute(database);
    const rows = result.rows;
    const press = rows.filter((s) =>
      (PRESS_DOMAINS as readonly string[]).includes(s.canonical_domain),
    );
    const youtube = rows.filter((s) => s.canonical_domain === "youtube.com");
    if (press.length !== 6 || youtube.length !== 32)
      throw new Error("MIGRATION_058_SOURCE_CATALOG_INCOMPLETE");
    for (const source of rows) {
      if (
        source.origin !== "LIVE_REAL" ||
        !source.active ||
        source.rights_class !== "LIVE_READY" ||
        source.rights_review_status !== "APPROVED" ||
        !source.endpoint?.startsWith("https://") ||
        !source.rights_evidence_url?.startsWith("https://")
      ) {
        throw new Error("MIGRATION_058_SOURCE_POLICY_NOT_APPROVED");
      }
    }

    const timestamp = Date.now();
    const providerHash = CLOUDFLARE_DATA_SHA256;
    const providerExists = await sql
      .raw(
        "select id from public.personal_owner_provider_authorizations where owner_identity=" +
          quote(OWNER) +
          " and provider_type=" +
          quote(PROVIDER) +
          " and model_id=" +
          quote(MODEL) +
          " and decision_status='AUTHORIZED' and evidence_sha256=" +
          quote(providerHash) +
          " limit 1",
      )
      .execute(database);
    if (providerExists.rows.length === 0) {
      const id = generateUlid({ now: () => timestamp });
      const at = new Date(timestamp).toISOString();
      const expires = new Date(timestamp + 90 * 86400000).toISOString();
      await sql
        .raw(
          "insert into public.personal_owner_provider_authorizations " +
            "(id,owner_identity,provider_type,model_id,decision_status,evidence_url,evidence_sha256,valid_from,expires_at,recorded_at) values (" +
            [
              quote(id),
              quote(OWNER),
              quote(PROVIDER),
              quote(MODEL),
              quote("AUTHORIZED"),
              quote(CLOUDFLARE_DATA_URL),
              quote(providerHash),
              quote(at),
              quote(expires),
              quote(at),
            ].join(",") +
            ")",
        )
        .execute(database);
    }

    for (const [i, source] of rows.entries()) {
      const youtubeSource = source.canonical_domain === "youtube.com";
      const excerptAllowed =
        !youtubeSource && source.storage_policy === "METADATA_AND_FEED_EXCERPT";
      const scopes = excerptAllowed
        ? {
            acquisition: true,
            metadata_storage: true,
            excerpt_storage: true,
            fulltext_acquisition: false,
            fulltext_persistence: false,
            external_ai_transmission: true,
            derived_semantic_persistence: true,
            redisplay: false,
          }
        : youtubeSource
          ? FALSE_SCOPES
          : {
              acquisition: true,
              metadata_storage: true,
              excerpt_storage: false,
              fulltext_acquisition: false,
              fulltext_persistence: false,
              external_ai_transmission: false,
              derived_semantic_persistence: false,
              redisplay: false,
            };
      const lawUrl = youtubeSource ? YOUTUBE_TERMS_URL : LAW_URL;
      const rightsReceipt = JSON.stringify({
        sourceId: source.id,
        name: source.name,
        evidenceUrl: lawUrl,
        scopes,
        model: MODEL,
        decision: youtubeSource
          ? "UNVERIFIED_NO_EXTERNAL_AI_GRANT"
          : "OWNER_APPROVED_EXCERPT_SCOPE",
        approvedBy: OWNER,
        reference: "CL-LEY-17336-ART71B-METADATA-EXCERPT-2026",
      });
      const rightsHash = hash(rightsReceipt);
      const provenance = youtubeSource
        ? "YouTube API data remains denied for semantic processing pending a source-specific API-terms review."
        : excerptAllowed
          ? "Project editor authorization for source-provided RSS excerpts capped at 700 characters, stateless Workers AI processing, minimal evidence quotations capped at 300 code points, and derived proposals held for editorial review under the Chilean Art. 71 B reference supplied by the project editor."
          : "Metadata-only source. No publisher-provided excerpt is stored, so external semantic processing is denied.";
      const status = youtubeSource ? "UNVERIFIED" : "AUTHORIZED";
      const prior = await sql<{
        id: string;
        sequence_number: number;
        recorded_at: Date;
      }>`
        select id::text as id,sequence_number,recorded_at
        from public.personal_owner_source_rights_decisions
        where source_id=${source.id}::dialektik_ulid and owner_identity=${OWNER}
          and decision_provenance=${provenance}
        order by sequence_number desc limit 1
      `.execute(database);
      const decisionId =
        prior.rows[0]?.id ?? generateUlid({ now: () => timestamp });
      const rightsAt =
        prior.rows[0]?.recorded_at.toISOString() ??
        new Date(timestamp).toISOString();
      if (!prior.rows[0]) {
        const sequence = await sql<{ next: number }>`
          select coalesce(max(sequence_number),0)::int+1 as next
          from public.personal_owner_source_rights_decisions where source_id=${source.id}::dialektik_ulid
        `.execute(database);
        const nextSequence = sequence.rows[0]?.next;
        if (nextSequence === undefined)
          throw new Error("MIGRATION_058_RIGHTS_SEQUENCE_UNAVAILABLE");
        const restrictions = {
          maximum_excerpt_characters: excerptAllowed ? 700 : 0,
          maximum_quote_codepoints: excerptAllowed ? 300 : 0,
          cloudflare_stateless_inference: excerptAllowed,
          no_raw_prompt_or_response_retention: true,
          youtube_semantic_use_denied: youtubeSource,
        };
        const attribution =
          source.name +
          "; source title, declared author, publication date, publisher-provided excerpt, canonical source link.";
        await sql
          .raw(
            "insert into public.personal_owner_source_rights_decisions " +
              "(id,owner_identity,source_id,sequence_number,publisher_identity,acquisition_method,rights_evidence_url," +
              "rights_evidence_sha256,scopes,attribution,restrictions,decision_status,decision_provenance,valid_from," +
              "expires_at,recorded_at,local_processing) values (" +
              [
                quote(decisionId),
                quote(OWNER),
                quote(source.id) + "::dialektik_ulid",
                String(nextSequence),
                quote(source.name),
                quote(youtubeSource ? "OFFICIAL_API" : "RSS_ATOM"),
                youtubeSource ? "null" : quote(lawUrl),
                youtubeSource ? "null" : quote(rightsHash),
                quote(JSON.stringify(scopes)) + "::jsonb",
                youtubeSource ? "null" : quote(attribution),
                quote(JSON.stringify(restrictions)) + "::jsonb",
                quote(status),
                quote(provenance),
                quote(rightsAt),
                youtubeSource
                  ? "null"
                  : quote(new Date(timestamp + 90 * 86400000).toISOString()),
                quote(rightsAt),
                "false",
              ].join(",") +
              ")",
          )
          .execute(database);
      }

      const policyId = hash(
        "dialektik-live-semantic-excerpt-policy-v1\n" +
          source.id +
          "\n" +
          decisionId +
          "\n" +
          rightsHash,
      );
      const mode = excerptAllowed ? "EXCERPT_EPHEMERAL" : "METADATA_ONLY";
      const policyAt = new Date(
        Math.max(timestamp, Date.parse(rightsAt)),
      ).toISOString();
      const existsPolicy = await sql
        .raw(
          "select id from public.content_access_policies where id=" +
            quote(policyId) +
            " limit 1",
        )
        .execute(database);
      if (existsPolicy.rows.length === 0) {
        await sql
          .raw(
            "insert into public.content_access_policies " +
              "(id,source_id,content_access_mode,metadata_storage,excerpt_storage,fulltext_acquisition," +
              "fulltext_machine_processing,fulltext_persistence,derived_semantic_persistence,minimal_evidence_fragment," +
              "redisplay,external_source_link,evidence_quote_max_codepoints,rights_evidence_url,rights_verified_at," +
              "recorded_at,local_processing,external_ai_transmission,rights_evidence_sha256," +
              "personal_owner_source_rights_decision_id) values (" +
              [
                quote(policyId),
                quote(source.id) + "::dialektik_ulid",
                quote(mode),
                String(!youtubeSource),
                String(excerptAllowed),
                "false",
                "false",
                "false",
                String(excerptAllowed),
                String(excerptAllowed),
                "false",
                "true",
                String(excerptAllowed ? 300 : 0),
                quote(lawUrl),
                quote(rightsAt),
                quote(policyAt),
                "false",
                String(excerptAllowed),
                youtubeSource ? "null" : quote(rightsHash),
                quote(decisionId) + "::dialektik_ulid",
              ].join(",") +
              ")",
          )
          .execute(database);
      }

      const route = excerptAllowed
        ? "EXTERNAL_LLM_PROCESSING_ALLOWED"
        : "NOT_ALLOWED";
      const routeHash = hash(
        rightsHash + "\n" + providerHash + "\n" + policyId + "\n" + route,
      );
      const grant = await sql
        .raw(
          "select id from public.live_semantic_source_route_grants where source_id=" +
            quote(source.id) +
            "::dialektik_ulid and policy_id=" +
            quote(policyId) +
            " and provider_type=" +
            quote(PROVIDER) +
            " and processing_route=" +
            quote(route) +
            " limit 1",
        )
        .execute(database);
      if (grant.rows.length === 0) {
        const routeAt = new Date(timestamp).toISOString();
        await sql
          .raw(
            "insert into public.live_semantic_source_route_grants " +
              "(id,source_id,policy_id,provider_type,processing_route,fulltext_acquisition," +
              "machine_processing,derived_persistence,fulltext_persistence,evidence_fragments,rights_receipt_sha256,recorded_at) values (" +
              [
                quote(generateUlid({ now: () => Date.now() })),
                quote(source.id) + "::dialektik_ulid",
                quote(policyId),
                quote(PROVIDER),
                quote(route),
                "false",
                String(excerptAllowed),
                String(excerptAllowed),
                "false",
                String(excerptAllowed),
                quote(routeHash),
                quote(routeAt),
              ].join(",") +
              ")",
          )
          .execute(database);
      }
    }

    const verified = await sql<{
      press: number;
      excerpts: number;
      youtubeDenied: number;
    }>`
      select count(*) filter(where s.canonical_domain<>'youtube.com')::int as press,
        count(*) filter(where s.canonical_domain<>'youtube.com' and g.processing_route='EXTERNAL_LLM_PROCESSING_ALLOWED')::int as excerpts,
        count(*) filter(where s.canonical_domain='youtube.com' and g.processing_route='NOT_ALLOWED')::int as "youtubeDenied"
      from public.sources s join lateral(
        select g.* from public.live_semantic_source_route_grants g where g.source_id=s.id
          and g.provider_type=${PROVIDER} order by g.recorded_at desc,g.id desc limit 1
      )g on true
      where s.canonical_domain=any(${[...PRESS_DOMAINS]}) or s.canonical_domain='youtube.com'
    `.execute(database);
    if (
      verified.rows[0]?.press !== 6 ||
      verified.rows[0]?.excerpts !== 5 ||
      verified.rows[0]?.youtubeDenied !== 32
    ) {
      throw new Error("MIGRATION_058_GOVERNANCE_SEED_VERIFICATION_FAILED");
    }
  },
  async down(): Promise<void> {
    throw new Error(
      "Excerpt rights and semantic processing history are append-only.",
    );
  },
};
