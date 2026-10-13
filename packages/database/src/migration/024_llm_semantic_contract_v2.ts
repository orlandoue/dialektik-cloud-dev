import { sql, type Kysely } from 'kysely';
import type { Database } from '../database.types';

/** Versioned V2 product configuration only; historical rows and grounding/rights guards unchanged. */
export const llmSemanticContractV2Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
create or replace function dialektik_validate_llm_run_config() returns trigger language plpgsql as $$
declare run semantic_provider_runs; cfg jsonb; entry jsonb;
begin
  select * into strict run from semantic_provider_runs where id=new.provider_run_id;
  cfg:=new.configuration;
  if not (dialektik_llm_closed_object(cfg,array['model','providerVersion','configHash','promptVersion','schemaVersion','retrievalVersion','graphVersion','maxArticles','maxCalls','topK','timeoutMs','maxRetries','concurrency','maxOutputTokens'],array['string','string','string','string','string','string','string','number','number','number','number','number','number','number']) or dialektik_llm_closed_object(cfg,array['model','providerVersion','configHash','promptVersion','schemaVersion','evidenceResolverVersion','retrievalVersion','graphVersion','maxArticles','maxCalls','topK','timeoutMs','maxRetries','concurrency','maxOutputTokens'],array['string','string','string','string','string','string','string','string','number','number','number','number','number','number','number'])) or jsonb_typeof(cfg) is distinct from 'object' or (select count(*) from jsonb_object_keys(cfg))<>(case when cfg->>'schemaVersion'='product-llm-schema-v2' then 15 else 14 end)
    or not (cfg ?& array['model','providerVersion','configHash','promptVersion','schemaVersion','retrievalVersion','graphVersion','maxArticles','maxCalls','topK','timeoutMs','maxRetries','concurrency','maxOutputTokens'])
    or cfg->>'configHash'<>new.config_hash or cfg->>'providerVersion'<>run.provider_version
    or run.candidate_commit is not null or run.runtime_python is not null
    or run.provider_type not in ('llm_gemini','authored_stub')
    or run.run_identity not like 'LLM_SEMANTIC_SHADOW_%'
    or (run.provider_type='authored_stub' and cfg->>'model' not like 'recorded-%')
    or (run.provider_type='llm_gemini' and (cfg->>'model' not like 'gemini-%' or run.input_provenance<>'LIVE_REAL'))
    or (cfg->>'maxArticles')::integer not between 1 and 30 or (cfg->>'maxCalls')::integer not between 1 and 120
    or (cfg->>'topK')::integer not between 1 and 5 or (cfg->>'timeoutMs')::integer not between 1 and 120000
    or cfg->>'maxRetries'<>'0' or cfg->>'concurrency'<>'1'
    or (
      (cfg->>'promptVersion'='product-llm-prompts-v1' and cfg->>'schemaVersion'='product-llm-schema-v1'
        and not(cfg ? 'evidenceResolverVersion') and cfg->>'maxOutputTokens'='4096'
        and run.provider_version='product-llm-v1.'||substr(new.config_hash,1,24))
      or (cfg->>'promptVersion'='product-llm-prompts-v2' and cfg->>'schemaVersion'='product-llm-schema-v2'
        and cfg->>'evidenceResolverVersion'='exact-quote-codepoint-occurrence-v1'
        and cfg->>'maxOutputTokens'='1024'
        and run.provider_version='product-gemini-runtime-v3.'||substr(new.config_hash,1,24))
    ) is distinct from true
    or cfg->>'retrievalVersion'<>'fact-index-topk-v1' or cfg->>'graphVersion'<>'proposal-builder-v1'
    or length(cfg->>'model')>128 or cfg->>'model'!~'^[A-Za-z0-9_.:/-]+$'
    or new.recorded_at<run.created_at then
    raise exception using errcode='23514',message='LLM run requires exact bounded independent provider configuration';
  end if;
  if jsonb_typeof(new.input_manifest) is distinct from 'array' or jsonb_array_length(new.input_manifest) not between 1 and (cfg->>'maxArticles')::integer then
    raise exception using errcode='23514',message='LLM run requires bounded frozen input manifest';
  end if;
  for entry in select value from jsonb_array_elements(new.input_manifest) loop
    if not dialektik_llm_closed_object(entry,array['articleId','versionId','sourceId','policyId','inputHash','titleHash'],array['string','string','string','string','string','string']) or jsonb_typeof(entry) is distinct from 'object' or (select count(*) from jsonb_object_keys(entry))<>6
      or not(entry ?& array['articleId','versionId','sourceId','policyId','inputHash','titleHash'])
      or entry->>'inputHash'!~'^[0-9a-f]{64}$' or entry->>'titleHash'!~'^[0-9a-f]{64}$' or entry->>'policyId'!~'^[0-9a-f]{64}$'
      or entry->>'versionId'!~'^[0-7][0-9A-HJKMNP-TV-Z]{25}$'
      or not exists(select 1 from articles a where a.id::text=entry->>'articleId' and a.source_id::text=entry->>'sourceId' and a.event_id is null
        and exists(select 1 from live_exposure_exclusions e where e.canonical_url=a.url_canonical and e.content_hash=entry->>'inputHash'))
      or (run.provider_type='llm_gemini' and not exists(select 1 from articles a join sources s on s.id=a.source_id
        where a.id::text=entry->>'articleId' and a.origin='LIVE_REAL' and s.origin='LIVE_REAL')) then
      raise exception using errcode='23514',message='LLM manifest contains unsupported identity or nonhash input';
    end if;
  end loop;
  if (select count(distinct x->>'articleId') from jsonb_array_elements(new.input_manifest) x)<>jsonb_array_length(new.input_manifest) then
    raise exception using errcode='23514',message='LLM manifest cannot repeat Article identities';
  end if;
  return new;
end;
$$;
create or replace function dialektik_llm_run_requires_config() returns trigger language plpgsql as $$
begin
  if (new.provider_type='llm_gemini' or (new.provider_version like 'product-llm-v1.%' or new.provider_version like 'product-gemini-runtime-v3.%')) and not exists(select 1 from llm_shadow_run_configurations where provider_run_id=new.id) then
    raise exception using errcode='23514',message='LLM provider run requires independently frozen product configuration';
  end if;
  return new;
end;
$$;
create or replace function dialektik_llm_processed_requires_grounding() returns trigger language plpgsql as $$
declare run semantic_provider_runs;
begin
  select * into strict run from semantic_provider_runs where id=new.provider_run_id;
  if new.processing_state='PROCESSED_SHADOW' and (run.provider_type='llm_gemini' or (run.provider_version like 'product-llm-v1.%' or run.provider_version like 'product-gemini-runtime-v3.%'))
    and not exists(select 1 from semantic_envelopes e join llm_shadow_observations o on o.envelope_id=e.id
      where e.provider_run_id=run.id and e.article_version_id=new.article_version_id) then
    raise exception using errcode='23514',message='LLM processed state requires grounded typed envelope extension';
  end if;
  return new;
end;
$$;
`.execute(db);
  },
};
