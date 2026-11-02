import { createHash } from "node:crypto";
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { generateUlid, setTransactionAuditContext } from "@dialektik/database";
import { sql, type Kysely } from "kysely";
import type { Database } from "@dialektik/database";
import { CloudflareWorkersAITransport } from "../llm-shadow/llm.cloudflare.js";
import {
  CLOUDFLARE_JSON_MODE_MODEL,
  createCloudflareProfile,
} from "../llm-shadow/llm.cloudflare-config.js";
import { HeadlineReviewService } from "../moderation/headline-review.service.js";
import { ModerationHttpError } from "../moderation/moderation-http.error.js";
import { HeadlineSemanticDatabaseService } from "./headline-semantic-database.service.js";
import { ModerationDatabaseService } from "../moderation/moderation-database.service.js";
import { parseLegacyContradictionReview, parseSemanticPromotionDecision, parseSemanticRejection } from "./live-semantic-editorial.contract.js";
import {
  canAddSemanticPairToClique,
  canJoinSemanticEventGroup,
  preclusterLiveSemanticArticles,
} from "./live-semantic-precluster.js";
import {
  LIVE_CLAIM_EXTRACTION_PROMPT,
  LIVE_CLAIM_EXTRACTION_SCHEMA,
  LIVE_PAIR_ASSESSMENT_PROMPT,
  LIVE_PAIR_ASSESSMENT_SCHEMA,
  LIVE_STANCE_PAIR_PROMPT,
  LIVE_STANCE_PAIR_PROMPT_SHA256,
  LIVE_STANCE_PAIR_VERSION,
  LIVE_CASE_PAIR_VERSION,
  groundLiveClaims,
  validateLivePairAssessment,
  validateLiveStancePairAssessment,
} from "./live-semantic-production.contract.js";

import { LIVE_JOINT_SCOPE_PROMPT, LIVE_JOINT_SCOPE_SCHEMA, LIVE_JOINT_SCOPE_VERSION, validateJointScope } from "./live-semantic-scope.contract.js";

const MODEL = CLOUDFLARE_JSON_MODE_MODEL;
const PROVIDER = "llm_cloudflare_workers_ai";
const EXTRACTION_SCHEMA_VERSION = "live-claim-extraction-v3";
const SEGMENTATION_VERSION = "dialektik-live-excerpt-claim-v3";
const MAX_BATCH = 5;
const MAX_PAIR_ASSESSMENTS = 20;
const MAX_CLAIM_PAIR_ASSESSMENTS = 95;
const MAX_STANCE_PAIR_ASSESSMENTS = 8;
const MAX_CASE_PAIR_ASSESSMENTS = 5;
const MAX_ORIGINAL_CLAIM_PAIR_ASSESSMENTS = 12;
const THRESHOLD_RULE =
  "review-only:same-event>=70;conflict>=50/comparable>=60;divergence>=50/comparable>=60";

export interface LiveExcerptInput {
  articleId: string;
  sourceId: string;
  eventId: string | null;
  canonicalUrl: string;
  textOriginal: string;
  publishedAt: Date;
  sourceName: string;
  versionId: string;
  headline: string;
  excerpt: string;
  policyId: string;
  inputSha256: string;
}

interface ExtractedCandidate extends LiveExcerptInput {
  generationId: string;
  eventKey: string;
  eventTitle: string;
  eventSummary: string;
  quotedText: string;
  assertionText: string;
  positionSummary: string;
}

interface ProposalRow {
  articleId: string;
  sourceId: string;
  sourceName: string;
  canonicalUrl: string;
  headline: string;
  publishedAt: Date;
  generationId: string;
  eventId: string | null;
  textOriginal: string;
  span: Record<string, unknown> | null;
}

interface ClaimPairRow {
  articleId: string;
  sourceId: string;
  sourceName: string;
  canonicalUrl: string;
  headline: string;
  publishedAt: Date;
  generationId: string;
  spans: Record<string, unknown>[];
}

interface ReviewGroupRow {
  id: string;
  targetDay: Date;
  proposedEventKey: string;
  proposedTitle: string;
  proposedSummary: string;
  articleCount: number;
  sourceCount: number;
  contradictionCount: number;
  divergentCount: number;
  createdAt: Date;
  editorialDecision: string | null;
  editorialReason: string | null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stanceConfigSha256(extractionConfig: string): string {
  if (sha256(LIVE_STANCE_PAIR_PROMPT) !== LIVE_STANCE_PAIR_PROMPT_SHA256)
    throw new Error("LIVE_SEMANTIC_STANCE_PROMPT_VERSION_MISMATCH");
  return sha256(`${extractionConfig}\n${LIVE_STANCE_PAIR_VERSION}`);
}

function caseConfigSha256(extractionConfig: string): string {
  if (sha256(LIVE_STANCE_PAIR_PROMPT) !== LIVE_STANCE_PAIR_PROMPT_SHA256)
    throw new Error("LIVE_SEMANTIC_STANCE_PROMPT_VERSION_MISMATCH");
  return sha256(`${extractionConfig}\n${LIVE_CASE_PAIR_VERSION}`);
}

function safeDatabaseErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 4 && typeof current === "object" && current !== null;
    depth += 1
  ) {
    const code = "code" in current ? current.code : null;
    if (typeof code === "string" && /^[A-Z0-9_]{1,64}$/u.test(code))
      return code;
    current = "cause" in current ? current.cause : null;
  }
  return null;
}

function semanticPromotionDatabaseError(
  error: unknown,
  failureStage: "transaction" | "audit_context" | "promotion_function",
): ModerationHttpError {
  const databaseCode = safeDatabaseErrorCode(error);
  const diagnostic = {
    failureStage,
    ...(databaseCode && /^[0-9A-Z]{5}$/u.test(databaseCode)
      ? { sqlState: databaseCode }
      : {}),
  };
  if (databaseCode === "42501")
    return new ModerationHttpError(500, "MOD_SEMANTIC_PROMOTION_PERMISSION_DENIED", diagnostic);
  if (["23503", "23505", "23514", "55000"].includes(databaseCode ?? ""))
    return new ModerationHttpError(500, "MOD_SEMANTIC_PROMOTION_CONSTRAINT_REJECTED", diagnostic);
  return new ModerationHttpError(500, "MOD_SEMANTIC_PROMOTION_DATABASE_FAILURE", diagnostic);
}

function exactBody(raw: unknown): { targetDay: string; limit: number } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new ModerationHttpError(400, "MOD_INVALID_REQUEST");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["targetDay", "limit"].includes(key)))
    throw new ModerationHttpError(400, "MOD_INVALID_REQUEST");
  if (
    typeof value.targetDay !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value.targetDay) ||
    !Number.isFinite(Date.parse(`${value.targetDay}T00:00:00.000Z`)) ||
    new Date(`${value.targetDay}T00:00:00.000Z`).toISOString().slice(0, 10) !==
      value.targetDay
  )
    throw new ModerationHttpError(400, "MOD_INVALID_REQUEST");
  const limit = value.limit === undefined ? MAX_BATCH : value.limit;
  if (
    !Number.isInteger(limit) ||
    Number(limit) < 1 ||
    Number(limit) > MAX_BATCH
  )
    throw new ModerationHttpError(400, "MOD_INVALID_REQUEST");
  return { targetDay: value.targetDay, limit: Number(limit) };
}

function proposalSpan(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload))
    return null;
  const spans = (payload as Record<string, unknown>).spans;
  if (!Array.isArray(spans) || spans.length === 0) return null;
  const span = spans[0];
  return typeof span === "object" && span !== null && !Array.isArray(span)
    ? (span as Record<string, unknown>)
    : null;
}

function normalizedEventKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9:._ -]/gu, "")
    .replace(/[ _]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 120);
}

@Injectable()
export class LiveSemanticProductionService {
  constructor(
    @Inject(HeadlineReviewService)
    private readonly reviews: HeadlineReviewService,
    @Inject(HeadlineSemanticDatabaseService)
    private readonly writer: HeadlineSemanticDatabaseService,
    @Inject(ModerationDatabaseService)
    private readonly moderationWriter: ModerationDatabaseService,
  ) {}

  private ensureEnabled(): void {
    if (process.env.DIALEKTIK_LIVE_SEMANTIC_PRODUCTION_ENABLED !== "true")
      throw new NotFoundException();
  }

  private config() {
    return createCloudflareProfile(MODEL, {
      maxArticles: MAX_BATCH,
      maxCalls: MAX_BATCH + MAX_PAIR_ASSESSMENTS + MAX_CLAIM_PAIR_ASSESSMENTS,
      timeoutMs: 30000,
      maxOutputTokens: 1024,
      maxRequestBytes: 16384,
    });
  }

  private configSha256(): string {
    const profile = this.config();
    return sha256(
      JSON.stringify({
        providerConfigHash: profile.config.configHash,
        extractionPrompt: LIVE_CLAIM_EXTRACTION_PROMPT,
        extractionSchema: LIVE_CLAIM_EXTRACTION_SCHEMA,
        pairPrompt: LIVE_PAIR_ASSESSMENT_PROMPT,
        pairSchema: LIVE_PAIR_ASSESSMENT_SCHEMA,
        grounding: "exact-unicode-codepoint-span-multiple-claims-v2",
        publication: "single-editor-multiposition-conflict-promotion-v2",
        precluster: "named-entity-incident-signature-complete-link-48h-v3",
        pairInput: "assertion-first-incident-calibrated-v2",
        groupMembership: "same-event-comparable-pair-only-v1",
        contradictionThreshold: "conflicting-at-least-50-comparable-at-least-60",
        generationLineage: "active-to-superseded-append-only-retry-v1",
      }),
    );
  }

  async runBatch(authorization: string | undefined, raw: unknown) {
    this.ensureEnabled();
    const identity = await this.reviews.authorizeEditor(authorization);
    const { targetDay, limit } = exactBody(raw);
    const database = this.writer.database;
    const configSha = this.configSha256();
    return database.connection().execute(async (connection) => {
      const leaseName = `dialektik-live-semantic:${targetDay}`;
      const locked = await sql<{
        locked: boolean;
      }>`select pg_try_advisory_lock(hashtextextended(${leaseName},0)) as locked`.execute(
        connection,
      );
      if (locked.rows[0]?.locked !== true)
        throw new ConflictException("SEMANTIC_BATCH_ALREADY_RUNNING");
      try {
        return await this.runLocked(
          connection,
          identity.userId,
          targetDay,
          limit,
          configSha,
        );
      } finally {
        await sql`select pg_advisory_unlock(hashtextextended(${leaseName},0))`.execute(
          connection,
        );
      }
    });
  }

  async runJointClusterOnly(authorization: string | undefined, raw: unknown) {
    this.ensureEnabled();
    const identity = await this.reviews.authorizeEditor(authorization);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ModerationHttpError(400,"MOD_INVALID_REQUEST");
    const value = raw as Record<string, unknown>;
    if (Object.keys(value).some(key => !["targetDay","maxModelCalls"].includes(key))) throw new ModerationHttpError(400,"MOD_INVALID_REQUEST");
    const {targetDay} = exactBody({targetDay:value.targetDay,limit:1});
    const maxModelCalls = value.maxModelCalls ?? 40;
    if (!Number.isInteger(maxModelCalls) || Number(maxModelCalls)<1 || Number(maxModelCalls)>40) throw new ModerationHttpError(400,"MOD_INVALID_REQUEST");
    const configSha=this.configSha256();
    const transport=new CloudflareWorkersAITransport(this.config(),undefined,process.env,LIVE_JOINT_SCOPE_PROMPT);
    return this.writer.database.connection().execute(async connection => {
      const leaseName=`dialektik-live-semantic:${targetDay}`;
      const lock=await sql<{locked:boolean}>`select pg_try_advisory_lock(hashtextextended(${leaseName},0)) as locked`.execute(connection);
      if(!lock.rows[0]?.locked) throw new ConflictException("SEMANTIC_BATCH_ALREADY_RUNNING");
      const runId=generateUlid({now:Date.now});
      try {
        await sql`insert into public.live_semantic_production_runs
          (id,requested_by,target_day,provider_type,model_id,config_sha256,requested_count,processed_count,pair_assessment_count,started_at,completed_at)
          values (${runId},${identity.userId}::dialektik_ulid,${targetDay}::date,${PROVIDER},${MODEL},${configSha},${Number(maxModelCalls)},0,0,${new Date().toISOString()},null)`.execute(connection);
        const results=await this.assessJointScope(connection,runId,identity.userId,targetDay,configSha,transport,Number(maxModelCalls));
        await sql`update public.live_semantic_production_runs set processed_count=${results.validated},pair_assessment_count=${results.attempted},completed_at=${new Date().toISOString()} where id=${runId}`.execute(connection);
        return {status:"COMPLETED_FOR_EDITORIAL_REVIEW",runId,targetDay,jointClusterOnly:true,modelCallsCount:results.modelCalls,maxModelCalls:Number(maxModelCalls),results};
      } finally { await sql`select pg_advisory_unlock(hashtextextended(${leaseName},0))`.execute(connection); }
    });
  }

  private async runLocked(
    connection: Kysely<Database>,
    requestedBy: string,
    targetDay: string,
    limit: number,
    configSha: string,
  ) {
    const pending = await sql<LiveExcerptInput>`
      select i.article_id as "articleId",i.source_id as "sourceId",i.event_id as "eventId",
        i.url_canonical as "canonicalUrl",i.text_original as "textOriginal",i.published_at as "publishedAt",
        i.source_name as "sourceName",i.version_id as "versionId",i.headline,i.excerpt,
        i.policy_id as "policyId",i.input_sha256 as "inputSha256"
      from public.live_semantic_excerpt_inputs i
      where (i.published_at at time zone 'America/Santiago')::date>=${targetDay}::date
        and (i.published_at at time zone 'America/Santiago')::date<${targetDay}::date+2
        and not exists(select 1 from public.assertion_extraction_generations g
          where g.article_id=i.article_id::dialektik_ulid and g.input_hash=i.input_sha256
            and g.provider_id=${PROVIDER} and g.model_id=${MODEL}
            and g.schema_version=${EXTRACTION_SCHEMA_VERSION} and g.config_version=${configSha}
            and g.state='active')
        and not exists(select 1 from public.live_semantic_article_attempts a
          where a.article_id=i.article_id::dialektik_ulid and a.input_sha256=i.input_sha256
            and a.config_sha256=${configSha})
        and not exists(select 1 from public.live_semantic_article_attempts a
          join public.live_semantic_article_outcomes o on o.attempt_id=a.id
          where a.article_id=i.article_id::dialektik_ulid and a.input_sha256=i.input_sha256
            and a.config_sha256=${configSha} and o.outcome='UNKNOWN_SENT')
      order by i.published_at desc,i.article_id desc limit ${limit}
    `.execute(connection);
    const eligible = await sql<{ count: number }>`
      select count(*)::int as count from public.live_semantic_excerpt_inputs i
      where (i.published_at at time zone 'America/Santiago')::date>=${targetDay}::date
        and (i.published_at at time zone 'America/Santiago')::date<${targetDay}::date+2
        and exists(select 1 from public.assertion_extraction_generations g
          where g.article_id=i.article_id::dialektik_ulid and g.input_hash=i.input_sha256
            and g.provider_id=${PROVIDER} and g.model_id=${MODEL} and g.state='active'
            and g.schema_version=${EXTRACTION_SCHEMA_VERSION} and g.config_version=${configSha}
            and g.outcome='proposed')
    `.execute(connection);
    if (pending.rows.length === 0 && eligible.rows[0]?.count === 0)
      return { status: "NO_PENDING_ARTICLES", targetDay, windowDays: 2, processed: 0 };

    const profile = this.config();
    let extractionTransport: CloudflareWorkersAITransport;
    let pairTransport: CloudflareWorkersAITransport;
    let stanceTransport: CloudflareWorkersAITransport;
    try {
      extractionTransport = new CloudflareWorkersAITransport(
        profile,
        undefined,
        process.env,
        LIVE_CLAIM_EXTRACTION_PROMPT,
      );
      pairTransport = new CloudflareWorkersAITransport(
        profile,
        undefined,
        process.env,
        LIVE_PAIR_ASSESSMENT_PROMPT,
      );
      stanceTransport = new CloudflareWorkersAITransport(
        profile,
        undefined,
        process.env,
        LIVE_STANCE_PAIR_PROMPT,
      );
    } catch {
      throw new ServiceUnavailableException(
        "Workers AI is not configured for semantic review.",
      );
    }

    const runId = generateUlid({ now: Date.now });
    const startedAt = new Date().toISOString();
    await sql`insert into public.live_semantic_production_runs
      (id,requested_by,target_day,provider_type,model_id,config_sha256,requested_count,processed_count,
       pair_assessment_count,started_at,completed_at)
      values (${runId},${requestedBy}::dialektik_ulid,${targetDay}::date,${PROVIDER},${MODEL},
        ${configSha},${Math.max(1, pending.rows.length)},0,0,${startedAt},null)`.execute(
      connection,
    );

    const outcomes: Array<{
      articleId: string;
      outcome: string;
      usedFallback?: boolean;
      persistenceErrorCode?: string;
    }> = [];
    let pairAssessmentCount = 0;
    try {
      for (const input of pending.rows) {
        const outcome = await this.analyzeArticle(
          connection,
          runId,
          requestedBy,
          input,
          configSha,
          profile.config.providerVersion,
          extractionTransport,
        );
        outcomes.push(outcome);
      }
      pairAssessmentCount = await this.assessCurrentGroups(
        connection,
        runId,
        requestedBy,
        targetDay,
        configSha,
        stanceTransport,
      );
      const claimPairAssessment = await this.assessGroupClaims(
        connection,
        runId,
        targetDay,
        configSha,
        pairTransport,
      );
      const stanceAssessment = await this.reassessClaimPairs(
        connection, runId, requestedBy, targetDay, configSha, stanceTransport,
      );
      const processed = outcomes.filter((item) =>
        ["VALIDATED", "NO_CLAIM_WORTHY_CONTENT"].includes(item.outcome),
      ).length;
      await sql`update public.live_semantic_production_runs set processed_count=${processed},
        pair_assessment_count=${pairAssessmentCount},completed_at=${new Date().toISOString()}
        where id=${runId}`.execute(connection);
      const reviewCounts = await sql<{
        eventGroups: number;
        conflictCandidates: number;
        divergentCandidates: number;
      }>`
        select count(distinct g.id)::int as "eventGroups",
          count(distinct p.id) filter(where p.relation='CONTRADICTORY'
            and p.ratio_conflicting>=55 and p.ratio_comparable>=60)::int as "conflictCandidates",
          count(distinct p.id) filter(where p.relation='DIVERGENT'
            and p.ratio_conflicting between 35 and 54 and p.ratio_comparable>=60)::int as "divergentCandidates"
        from public.live_semantic_event_group_candidates g
        join public.live_semantic_event_group_members m on m.group_id=g.id
        left join public.live_semantic_claim_pair_assessments p on p.group_id=g.id and p.same_event
          and p.config_sha256=${stanceConfigSha256(configSha)}
        where g.target_day=${targetDay}::date and g.config_sha256=${configSha}
          and not exists(select 1 from public.live_semantic_editorial_decisions decision where decision.group_id=g.id)
      `.execute(connection);
      return {
        status: "COMPLETED_FOR_EDITORIAL_REVIEW",
        runId,
        targetDay,
        attempted: pending.rows.length,
        extracted: outcomes.filter((item) => item.outcome === "VALIDATED")
          .length,
        insufficientEvidence: outcomes.filter(
          (item) => item.outcome === "NO_CLAIM_WORTHY_CONTENT",
        ).length,
        rejectedOrUnavailable: outcomes.filter(
          (item) =>
            !["VALIDATED", "NO_CLAIM_WORTHY_CONTENT"].includes(item.outcome),
        ).length,
        persistenceErrorCodes: Array.from(
          new Set(
            outcomes.flatMap((item) =>
              item.persistenceErrorCode ? [item.persistenceErrorCode] : [],
            ),
          ),
        ),
        literalQuoteFallbacks: outcomes.filter((item) => item.usedFallback)
          .length,
        pairAssessments: pairAssessmentCount,
        claimPairAssessments: claimPairAssessment.count,
        claimPairAssessmentLimitReached: claimPairAssessment.limitReached,
        stanceReassessment: stanceAssessment,
        windowDays: 2,
        eventGroupsForReview: reviewCounts.rows[0]?.eventGroups ?? 0,
        contradictionCandidatesForReview:
          reviewCounts.rows[0]?.conflictCandidates ?? 0,
        divergentCandidatesForReview:
          reviewCounts.rows[0]?.divergentCandidates ?? 0,
        canonicalEventsPublished: 0,
        canonicalAssertionsPublished: 0,
      };
    } finally {
      extractionTransport.dispose?.();
      pairTransport.dispose?.();
      stanceTransport.dispose?.();
    }
  }

  private async ensureArticleGrant(
    connection: Kysely<Database>,
    input: LiveExcerptInput,
  ): Promise<boolean> {
    const sourceAllowed = await sql<{ allowed: boolean }>`
      select public.dialektik_live_semantic_source_allowed(${input.sourceId}::dialektik_ulid) as allowed
    `.execute(connection);
    if (sourceAllowed.rows[0]?.allowed !== true) return false;
    const route = await sql<{
      allowed: boolean;
    }>`select public.dialektik_live_semantic_route_allowed(
      ${input.articleId}::dialektik_ulid,${input.inputSha256},${PROVIDER},${MODEL}) as allowed`.execute(
      connection,
    );
    return route.rows[0]?.allowed === true;
  }

  private async analyzeArticle(
    connection: Kysely<Database>,
    runId: string,
    requestedBy: string,
    input: LiveExcerptInput,
    configSha: string,
    modelRevision: string,
    transport: CloudflareWorkersAITransport,
  ): Promise<{
    articleId: string;
    outcome: string;
    usedFallback?: boolean;
    persistenceErrorCode?: string;
  }> {
    if (
      input.textOriginal.length > 1250 ||
      input.excerpt.length > 700 ||
      input.textOriginal !== `${input.headline}. ${input.excerpt}`
    )
      return { articleId: input.articleId, outcome: "INPUT_REJECTED" };
    if (!(await this.ensureArticleGrant(connection, input)))
      return { articleId: input.articleId, outcome: "RIGHTS_REVOKED" };

    const attemptId = generateUlid({ now: Date.now });
    const claim = await sql<{
      id: string;
    }>`insert into public.live_semantic_article_attempts
      (id,run_id,requested_by,article_id,source_id,policy_id,input_sha256,provider_type,model_id,config_sha256,request_started_at)
      values (${attemptId},${runId}::dialektik_ulid,${requestedBy}::dialektik_ulid,
        ${input.articleId}::dialektik_ulid,${input.sourceId}::dialektik_ulid,${input.policyId},
        ${input.inputSha256},${PROVIDER},${MODEL},${configSha},${new Date().toISOString()})
      on conflict(article_id,input_sha256,config_sha256) do nothing returning id::text as id`.execute(
      connection,
    );
    if (!claim.rows[0])
      return { articleId: input.articleId, outcome: "ALREADY_ATTEMPTED" };

    let rawOutput: unknown;
    try {
      rawOutput = (
        await transport.generate(
          "extraction",
          { textOriginal: input.textOriginal },
          LIVE_CLAIM_EXTRACTION_SCHEMA,
          AbortSignal.timeout(32000),
        )
      ).output;
    } catch {
      await this.recordOutcome(
        connection,
        attemptId,
        "UNKNOWN_SENT",
        null,
        "PROVIDER_UNAVAILABLE",
      );
      return { articleId: input.articleId, outcome: "UNKNOWN_SENT" };
    }

    let grounded;
    try {
      grounded = groundLiveClaims(rawOutput, input.textOriginal, input.headline);
    } catch {
      await this.recordOutcome(
        connection,
        attemptId,
        "REJECTED",
        null,
        "MODEL_VALIDATION",
      );
      return { articleId: input.articleId, outcome: "REJECTED" };
    }
    const spans = grounded.claims.flatMap((claim, index) =>
      claim.charStart === null || claim.charEnd === null
        ? []
        : [{
            ordinal: index + 1,
            start: claim.charStart,
            end: claim.charEnd,
            quoted_text: claim.quotedText,
            assertion_text: claim.assertionText,
            position_summary: claim.positionSummary,
            event_key: grounded.eventKey,
            event_title: grounded.eventTitle,
            event_summary: grounded.eventSummary,
            used_literal_fallback: claim.usedFallback,
          }],
    );
    const payload = { schema_version: EXTRACTION_SCHEMA_VERSION, spans };
    const payloadText = JSON.stringify(payload);
    const generationId = generateUlid({ now: Date.now });
    const generatedAt = new Date().toISOString();
    let inserted: { id: string } | undefined;
    try {
      const result = await sql<{
        id: string;
      }>`with prior_active as materialized (
          select id from public.assertion_extraction_generations
          where article_id=${input.articleId}::dialektik_ulid and state='active'
          for update
        ), superseded as (
          update public.assertion_extraction_generations generation
          set state='superseded'
          where generation.id in (select id from prior_active)
            and generation.state='active'
          returning generation.id
        )
        insert into public.assertion_extraction_generations
        (id,article_id,input_hash,text_basis,offset_encoding,segmentation_version,provider_id,model_id,
         model_revision,config_version,schema_version,outcome,failure_category,proposal_payload,
         proposal_hash,state,supersedes_id,created_at,completed_at)
        select ${generationId}::dialektik_ulid,${input.articleId}::dialektik_ulid,${input.inputSha256},
          'article.text_original','unicode_code_point_v1',${SEGMENTATION_VERSION},${PROVIDER},${MODEL},
          ${modelRevision},${configSha},${EXTRACTION_SCHEMA_VERSION},
          ${grounded.status === "EXTRACTED" ? "proposed" : "no_claim_worthy_content"},null,
          ${payloadText}::jsonb,${sha256(payloadText)},'active',
          (select id from superseded),${generatedAt},${generatedAt}
        on conflict do nothing returning id::text as id`.execute(connection);
      inserted = result.rows[0];
      if (!inserted) {
        const prior = await sql<{
          id: string;
        }>`select id::text as id from public.assertion_extraction_generations
          where article_id=${input.articleId}::dialektik_ulid and input_hash=${input.inputSha256}
            and segmentation_version=${SEGMENTATION_VERSION} and provider_id=${PROVIDER}
            and model_id=${MODEL} and model_revision=${modelRevision}
            and config_version=${configSha} and schema_version=${EXTRACTION_SCHEMA_VERSION}
          limit 1`.execute(connection);
        inserted = prior.rows[0];
      }
      if (!inserted) {
        throw Object.assign(
          new Error("LIVE_SEMANTIC_GENERATION_WRITE_FAILED"),
          {
            code: "NO_GENERATION_FOR_CONFLICT",
          },
        );
      }
    } catch (error) {
      const persistenceErrorCode =
        safeDatabaseErrorCode(error) ?? "PERSISTENCE_FAILED";
      await this.recordOutcome(
        connection,
        attemptId,
        "PERSISTENCE_FAILED",
        null,
        persistenceErrorCode,
      );
      return {
        articleId: input.articleId,
        outcome: "PERSISTENCE_FAILED",
        persistenceErrorCode,
      };
    }
    const outcome =
      grounded.status === "EXTRACTED" ? "VALIDATED" : "NO_CLAIM_WORTHY_CONTENT";
    await this.recordOutcome(connection, attemptId, outcome, inserted.id, null);
    return {
      articleId: input.articleId,
      outcome,
      usedFallback: grounded.claims.some((claim) => claim.usedFallback),
    };
  }

  private async recordOutcome(
    connection: Kysely<Database>,
    attemptId: string,
    outcome: string,
    generationId: string | null,
    errorCode: string | null,
  ): Promise<void> {
    await sql`insert into public.live_semantic_article_outcomes
      (attempt_id,outcome,extraction_generation_id,error_code,recorded_at)
      values (${attemptId}::dialektik_ulid,${outcome},${generationId}::dialektik_ulid,
        ${errorCode},${new Date().toISOString()})`.execute(connection);
  }

  private async assessCurrentGroups(
    connection: Kysely<Database>,
    runId: string,
    requestedBy: string,
    targetDay: string,
    configSha: string,
    transport: CloudflareWorkersAITransport,
  ): Promise<number> {
    const result = await sql<ProposalRow>`
      select i.article_id as "articleId",i.source_id as "sourceId",i.source_name as "sourceName",
        i.url_canonical as "canonicalUrl",i.headline,i.published_at as "publishedAt",
        i.event_id as "eventId",i.text_original as "textOriginal",
        g.id::text as "generationId",g.proposal_payload->'spans'->0 as span
      from public.live_semantic_excerpt_inputs i
      join lateral(select generation.* from public.assertion_extraction_generations generation
        where generation.article_id=i.article_id::dialektik_ulid and generation.input_hash=i.input_sha256
          and generation.provider_id=${PROVIDER} and generation.model_id=${MODEL}
          and generation.schema_version=${EXTRACTION_SCHEMA_VERSION}
          and generation.config_version=${configSha}
          and generation.state='active' and generation.outcome='proposed'
        order by generation.created_at desc,generation.id desc limit 1) g on true
      where (i.published_at at time zone 'America/Santiago')::date>=${targetDay}::date
        and (i.published_at at time zone 'America/Santiago')::date<${targetDay}::date+2
      order by i.published_at desc,i.article_id desc
    `.execute(connection);
    const proposals = result.rows.filter((row) => row.span !== null);
    const pairs = preclusterLiveSemanticArticles(
      proposals.map((row) => ({
        articleId: row.articleId,
        sourceId: row.sourceId,
        publishedAt: row.publishedAt,
        headline: row.headline,
        eventKey: String(row.span?.event_key ?? ""),
        eventTitle: String(row.span?.event_title ?? ""),
        eventSummary: String(row.span?.event_summary ?? ""),
      })),
      targetDay,
    );
    const proposalById = new Map(proposals.map((row) => [row.articleId, row]));
    const caseConfig = caseConfigSha256(configSha);
    let assessments = 0;
    for (const pair of pairs) {
      if (assessments >= MAX_CASE_PAIR_ASSESSMENTS) break;
      const left = proposalById.get(pair.left.articleId);
      const right = proposalById.get(pair.right.articleId);
      if (!left || !right || !left.span || !right.span) continue;
      if (left.eventId !== null && left.eventId === right.eventId) continue;
      const existing = await sql<{ exists: boolean }>`select exists(
        select 1 from public.live_semantic_case_pair_attempts
        where left_article_id=${left.articleId}::dialektik_ulid
          and right_article_id=${right.articleId}::dialektik_ulid
          and config_sha256=${caseConfig}) as exists`.execute(connection);
      if (existing.rows[0]?.exists) continue;
      const leftSpan = left.span;
      const rightSpan = right.span;
      const groupKey = sha256(`${targetDay}\n${pair.clusterKey}\n${caseConfig}`);
      const eventKey = normalizedEventKey(String(leftSpan.event_key ?? rightSpan.event_key ?? pair.clusterKey));
      const eventTitle = String(leftSpan.event_title || rightSpan.event_title || left.headline).slice(0, 240);
      const eventSummary = String(leftSpan.event_summary || rightSpan.event_summary || left.headline).slice(0, 500);
      await sql`insert into public.live_semantic_event_group_candidates
        (id,origin_run_id,group_key_sha256,target_day,proposed_event_key,proposed_title,proposed_summary,
         provider_type,model_id,config_sha256,review_state,created_at)
        values (${generateUlid({ now: Date.now })},${runId}::dialektik_ulid,${groupKey},${targetDay}::date,
          ${eventKey},${eventTitle},${eventSummary},${PROVIDER},${MODEL},${configSha},'REVIEW_REQUIRED',${new Date().toISOString()})
        on conflict(group_key_sha256) do nothing`.execute(connection);
      const group = await sql<{ id: string }>`select id::text as id
        from public.live_semantic_event_group_candidates candidate
        where candidate.group_key_sha256=${groupKey}
          and not exists(select 1 from public.live_semantic_editorial_decisions decision
            where decision.group_id=candidate.id)
        limit 1`.execute(connection);
      if (!group.rows[0]) continue;
      const groupId = group.rows[0].id;
      const attemptId = generateUlid({ now: Date.now });
      const attempt = await sql<{ id: string }>`insert into public.live_semantic_case_pair_attempts
        (id,group_id,left_article_id,right_article_id,run_id,config_sha256,requested_by,requested_at)
        values (${attemptId},${groupId}::dialektik_ulid,${left.articleId}::dialektik_ulid,${right.articleId}::dialektik_ulid,
          ${runId}::dialektik_ulid,${caseConfig},${requestedBy}::dialektik_ulid,${new Date().toISOString()})
        on conflict(left_article_id,right_article_id,config_sha256) do nothing returning id::text as id`.execute(connection);
      if (!attempt.rows[0]) continue;
      assessments += 1;
      const recordOutcome = async (outcome: string, assessmentId: string | null = null) => {
        await sql`insert into public.live_semantic_case_pair_outcomes(attempt_id,outcome,assessment_id,recorded_at)
          values (${attemptId}::dialektik_ulid,${outcome},${assessmentId}::dialektik_ulid,${new Date().toISOString()})`.execute(connection);
      };
      const literal = (span: Record<string, unknown>, text: string) =>
        typeof span.quoted_text === "string" && Number.isInteger(span.start) && Number.isInteger(span.end) &&
        Array.from(text).slice(Number(span.start), Number(span.end)).join("") === span.quoted_text;
      if (!literal(leftSpan, left.textOriginal) || !literal(rightSpan, right.textOriginal)) {
        await recordOutcome("INVALID_MODEL_RESPONSE");
        continue;
      }
      let assessment;
      let generated;
      try {
        generated = await transport.generate(
          "extraction",
          {
            left: {
              headline: left.headline,
              sourceName: left.sourceName,
              publishedAt: left.publishedAt.toISOString(),
              eventKey: leftSpan.event_key,
              eventSummary: leftSpan.event_summary,
              assertion: leftSpan.assertion_text,
              quote: leftSpan.quoted_text,
              excerpt: left.textOriginal,
            },
            right: {
              headline: right.headline,
              sourceName: right.sourceName,
              publishedAt: right.publishedAt.toISOString(),
              eventKey: rightSpan.event_key,
              eventSummary: rightSpan.event_summary,
              assertion: rightSpan.assertion_text,
              quote: rightSpan.quoted_text,
              excerpt: right.textOriginal,
            },
          },
          LIVE_PAIR_ASSESSMENT_SCHEMA,
          AbortSignal.timeout(32000),
        );
      } catch {
        await recordOutcome("PROVIDER_UNAVAILABLE");
        continue;
      }
      try {
        assessment = validateLiveStancePairAssessment(generated.output);
      } catch {
        await recordOutcome("INVALID_MODEL_RESPONSE");
        continue;
      }
      const assessmentId = generateUlid({ now: Date.now });
      try {
        await sql`insert into public.live_semantic_pair_assessments
        (id,run_id,group_id,left_article_id,right_article_id,left_extraction_generation_id,
         right_extraction_generation_id,same_event,relation,ratio_conflicting,ratio_comparable,same_event_confidence,
         threshold_rule,provider_type,model_id,config_sha256,created_at)
        values (${assessmentId},${runId}::dialektik_ulid,
          ${groupId}::dialektik_ulid,${left.articleId}::dialektik_ulid,${right.articleId}::dialektik_ulid,
          ${left.generationId}::dialektik_ulid,${right.generationId}::dialektik_ulid,${assessment.sameEvent},
          ${assessment.relation},${assessment.ratioConflicting},${assessment.ratioComparable},
          ${assessment.sameEventConfidence},'case-v1:editorial-review',${PROVIDER},${MODEL},${caseConfig},
          ${new Date().toISOString()})`.execute(connection);
        await recordOutcome("VALIDATED", assessmentId);
      } catch {
        await recordOutcome("PERSISTENCE_FAILED");
        continue;
      }
      if (canJoinSemanticEventGroup(assessment)) {
        const existingMembers = await sql<{ articleId: string }>`select article_id::text as "articleId"
          from public.live_semantic_event_group_members where group_id=${groupId}::dialektik_ulid
          order by article_id`.execute(connection);
        const confirmedRows = await sql<{
          leftArticleId: string;
          rightArticleId: string;
        }>`select left_article_id::text as "leftArticleId",right_article_id::text as "rightArticleId"
          from public.live_semantic_pair_assessments where group_id=${groupId}::dialektik_ulid
            and config_sha256=${caseConfig} and same_event and same_event_confidence>=70`.execute(connection);
        const confirmedPairs = new Set(
          confirmedRows.rows.map((row) => `${row.leftArticleId}\n${row.rightArticleId}`),
        );
        if (
          canAddSemanticPairToClique(
            existingMembers.rows.map((row) => row.articleId),
            left.articleId,
            right.articleId,
            confirmedPairs,
          )
        ) {
          for (const member of [left, right]) {
            await sql`insert into public.live_semantic_event_group_members
              (group_id,article_id,source_id,extraction_generation_id,matched_at)
              values (${groupId}::dialektik_ulid,${member.articleId}::dialektik_ulid,
                ${member.sourceId}::dialektik_ulid,${member.generationId}::dialektik_ulid,${new Date().toISOString()})
              on conflict(group_id,article_id) do nothing`.execute(connection);
          }
        }
      }
    }
    return assessments;
  }

  private async assessGroupClaims(
    connection: Kysely<Database>,
    runId: string,
    targetDay: string,
    configSha: string,
    transport: CloudflareWorkersAITransport,
  ): Promise<{ count: number; limitReached: boolean }> {
    const rows = await sql<ClaimPairRow & { groupId: string }>`
      select group_row.id::text as "groupId",member.article_id::text as "articleId",
        member.source_id::text as "sourceId",input.source_name as "sourceName",
        input.url_canonical as "canonicalUrl",input.headline,input.published_at as "publishedAt",
        generation.id::text as "generationId",generation.proposal_payload->'spans' as spans
      from public.live_semantic_event_group_candidates group_row
      join public.live_semantic_event_group_members member on member.group_id=group_row.id
      join public.live_semantic_excerpt_inputs input on input.article_id=member.article_id::text
      join public.assertion_extraction_generations generation on generation.id=member.extraction_generation_id
      where group_row.target_day=${targetDay}::date and group_row.config_sha256=${configSha}
        and group_row.review_state='REVIEW_REQUIRED'
        and not exists(select 1 from public.live_semantic_editorial_decisions decision
          where decision.group_id=group_row.id)
        and (select count(distinct source_id) from public.live_semantic_event_group_members
          where group_id=group_row.id)>=2
      order by group_row.id,member.article_id
    `.execute(connection);
    const groups = new Map<string, ClaimPairRow[]>();
    for (const row of rows.rows) {
      const group = groups.get(row.groupId) ?? [];
      group.push(row);
      groups.set(row.groupId, group);
    }
    let count = 0;
    let attempted = 0;
    for (const [groupId, articles] of groups) {
      const claims = articles.flatMap((article) =>
        (Array.isArray(article.spans) ? article.spans : []).flatMap((span, index) =>
          typeof span === "object" && span !== null && !Array.isArray(span)
            ? [{ article, span: span as Record<string, unknown>, ordinal: index + 1 }]
            : [],
        ),
      );
      for (let leftIndex = 0; leftIndex < claims.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < claims.length; rightIndex += 1) {
          const left = claims[leftIndex]!;
          const right = claims[rightIndex]!;
          if (attempted >= MAX_ORIGINAL_CLAIM_PAIR_ASSESSMENTS)
            return { count, limitReached: true };
          const exists = await sql<{ present: boolean }>`select exists(
            select 1 from public.live_semantic_claim_pair_assessments
            where group_id=${groupId}::dialektik_ulid
              and left_article_id=${left.article.articleId}::dialektik_ulid
              and left_claim_ordinal=${left.ordinal}
              and right_article_id=${right.article.articleId}::dialektik_ulid
              and right_claim_ordinal=${right.ordinal}
              and config_sha256=${configSha}) as present`.execute(connection);
          if (exists.rows[0]?.present) continue;
          attempted += 1;
          let assessment;
          try {
            const generated = await transport.generate(
              "extraction",
              {
                left: {
                  headline: left.article.headline,
                  sourceName: left.article.sourceName,
                  publishedAt: left.article.publishedAt.toISOString(),
                  eventKey: left.span.event_key,
                  eventSummary: left.span.event_summary,
                  quote: left.span.quoted_text,
                  assertion: left.span.assertion_text,
                  position: left.span.position_summary,
                },
                right: {
                  headline: right.article.headline,
                  sourceName: right.article.sourceName,
                  publishedAt: right.article.publishedAt.toISOString(),
                  eventKey: right.span.event_key,
                  eventSummary: right.span.event_summary,
                  quote: right.span.quoted_text,
                  assertion: right.span.assertion_text,
                  position: right.span.position_summary,
                },
              },
              LIVE_PAIR_ASSESSMENT_SCHEMA,
              AbortSignal.timeout(32000),
            );
            assessment = validateLivePairAssessment(generated.output);
          } catch {
            continue;
          }
          const first = left.article.articleId < right.article.articleId ||
            left.article.articleId === right.article.articleId && left.ordinal < right.ordinal
            ? left
            : right;
          const second = first === left ? right : left;
          await sql`insert into public.live_semantic_claim_pair_assessments
            (id,run_id,group_id,left_article_id,left_claim_ordinal,right_article_id,right_claim_ordinal,
             left_extraction_generation_id,right_extraction_generation_id,same_event,relation,
             ratio_conflicting,ratio_comparable,same_event_confidence,threshold_rule,provider_type,
             model_id,config_sha256,created_at)
            values (${generateUlid({ now: Date.now })},${runId}::dialektik_ulid,
              ${groupId}::dialektik_ulid,${first.article.articleId}::dialektik_ulid,${first.ordinal},
              ${second.article.articleId}::dialektik_ulid,${second.ordinal},
              ${first.article.generationId}::dialektik_ulid,${second.article.generationId}::dialektik_ulid,
              ${assessment.sameEvent},${assessment.relation},${assessment.ratioConflicting},
              ${assessment.ratioComparable},${assessment.sameEventConfidence},${THRESHOLD_RULE},
              ${PROVIDER},${MODEL},${configSha},${new Date().toISOString()})
            on conflict(group_id,left_article_id,left_claim_ordinal,right_article_id,right_claim_ordinal,config_sha256)
              do nothing`.execute(connection);
          count += 1;
        }
      }
    }
    return { count, limitReached: false };
  }

  private async reassessClaimPairs(
    connection: Kysely<Database>, runId: string, requestedBy: string, targetDay: string,
    configSha: string, transport: CloudflareWorkersAITransport,
  ): Promise<{ attempted: number; validated: number; invalid: number; unavailable: number }> {
    type Input = {
      id: string; groupId: string; leftArticleId: string; rightArticleId: string;
      leftOrdinal: number; rightOrdinal: number; leftGenerationId: string; rightGenerationId: string;
      leftHeadline: string | null; rightHeadline: string | null; leftSource: string | null; rightSource: string | null;
      leftText: string | null; rightText: string | null; leftSpan: Record<string, unknown> | null; rightSpan: Record<string, unknown> | null;
    };
    const stanceConfig = stanceConfigSha256(configSha);
    const rows = await sql<Input>`with pending as materialized (
        select old.* from public.live_semantic_claim_pair_assessments old
        join public.live_semantic_event_group_candidates group_row on group_row.id=old.group_id
        where group_row.target_day=${targetDay}::date and group_row.config_sha256=${configSha}
          and old.config_sha256=${configSha}
          and not exists(select 1 from public.live_semantic_stance_pair_attempts attempt
            where attempt.original_pair_id=old.id and attempt.config_sha256=${stanceConfig})
        order by old.created_at,old.id limit ${MAX_STANCE_PAIR_ASSESSMENTS}
      ) select old.id::text as id,old.group_id::text as "groupId",
        old.left_article_id::text as "leftArticleId",old.right_article_id::text as "rightArticleId",
        old.left_claim_ordinal as "leftOrdinal",old.right_claim_ordinal as "rightOrdinal",
        old.left_extraction_generation_id::text as "leftGenerationId",old.right_extraction_generation_id::text as "rightGenerationId",
        left_input.headline as "leftHeadline",right_input.headline as "rightHeadline",
        left_input.source_name as "leftSource",right_input.source_name as "rightSource",
        left_input.text_original as "leftText",right_input.text_original as "rightText",
        left_generation.proposal_payload->'spans'->(old.left_claim_ordinal-1) as "leftSpan",
        right_generation.proposal_payload->'spans'->(old.right_claim_ordinal-1) as "rightSpan"
      from pending old
      join public.assertion_extraction_generations left_generation on left_generation.id=old.left_extraction_generation_id
      join public.assertion_extraction_generations right_generation on right_generation.id=old.right_extraction_generation_id
      left join lateral (select input.* from public.live_semantic_excerpt_inputs input
        where input.article_id=old.left_article_id::text and input.input_sha256=left_generation.input_hash
          and left_generation.state='active' limit 1) left_input on true
      left join lateral (select input.* from public.live_semantic_excerpt_inputs input
        where input.article_id=old.right_article_id::text and input.input_sha256=right_generation.input_hash
          and right_generation.state='active' limit 1) right_input on true
      order by old.created_at,old.id`.execute(connection);
    const totals = { attempted: 0, validated: 0, invalid: 0, unavailable: 0 };
    for (const row of rows.rows) {
      const attemptId = generateUlid({ now: Date.now });
      const attempt = await sql<{ id: string }>`insert into public.live_semantic_stance_pair_attempts
        (id,original_pair_id,run_id,config_sha256,requested_by,requested_at)
        values (${attemptId},${row.id}::dialektik_ulid,${runId}::dialektik_ulid,${stanceConfig},
          ${requestedBy}::dialektik_ulid,${new Date().toISOString()})
        on conflict(original_pair_id,config_sha256) do nothing returning id::text as id`.execute(connection);
      if (!attempt.rows[0]) continue;
      totals.attempted += 1;
      const recordOutcome = async (outcome: string, assessmentId: string | null = null) => {
        await sql`insert into public.live_semantic_stance_pair_outcomes(attempt_id,outcome,assessment_id,recorded_at)
          values (${attemptId}::dialektik_ulid,${outcome},${assessmentId}::dialektik_ulid,${new Date().toISOString()})`.execute(connection);
      };
      if (row.leftText === null || row.rightText === null || row.leftSpan === null || row.rightSpan === null) {
        totals.unavailable += 1;
        await recordOutcome("INPUT_UNAVAILABLE");
        continue;
      }
      const literal = (span: Record<string, unknown>, text: string) =>
        typeof span.quoted_text === "string" && Number.isInteger(span.start) && Number.isInteger(span.end) &&
        Array.from(text).slice(Number(span.start), Number(span.end)).join("") === span.quoted_text;
      if (!literal(row.leftSpan, row.leftText) || !literal(row.rightSpan, row.rightText)) {
        totals.invalid += 1;
        await recordOutcome("INVALID_MODEL_RESPONSE");
        continue;
      }
      let output: unknown;
      try {
        output = (await transport.generate("extraction", {
          left: { headline: row.leftHeadline, sourceName: row.leftSource, quote: row.leftSpan.quoted_text, excerpt: row.leftText },
          right: { headline: row.rightHeadline, sourceName: row.rightSource, quote: row.rightSpan.quoted_text, excerpt: row.rightText },
        }, LIVE_PAIR_ASSESSMENT_SCHEMA, AbortSignal.timeout(32000))).output;
      } catch {
        totals.unavailable += 1;
        await recordOutcome("PROVIDER_UNAVAILABLE");
        continue;
      }
      let assessment;
      try { assessment = validateLiveStancePairAssessment(output); }
      catch {
        totals.invalid += 1;
        await recordOutcome("INVALID_MODEL_RESPONSE");
        continue;
      }
      const assessmentId = generateUlid({ now: Date.now });
      try {
        await sql`insert into public.live_semantic_claim_pair_assessments
          (id,run_id,group_id,left_article_id,left_claim_ordinal,right_article_id,right_claim_ordinal,
           left_extraction_generation_id,right_extraction_generation_id,same_event,relation,ratio_conflicting,
           ratio_comparable,same_event_confidence,threshold_rule,provider_type,model_id,config_sha256,created_at)
          values (${assessmentId},${runId}::dialektik_ulid,${row.groupId}::dialektik_ulid,
            ${row.leftArticleId}::dialektik_ulid,${row.leftOrdinal},${row.rightArticleId}::dialektik_ulid,${row.rightOrdinal},
            ${row.leftGenerationId}::dialektik_ulid,${row.rightGenerationId}::dialektik_ulid,${assessment.sameEvent},
            ${assessment.relation},${assessment.ratioConflicting},${assessment.ratioComparable},${assessment.sameEventConfidence},
            'stance-v1:contradictory>=55;divergent=35..54;comparable>=60;editor-review',${PROVIDER},${MODEL},${stanceConfig},${new Date().toISOString()})`.execute(connection);
        await recordOutcome("VALIDATED", assessmentId);
        totals.validated += 1;
      } catch {
        await recordOutcome("PERSISTENCE_FAILED");
        totals.invalid += 1;
      }
    }
    return totals;
  }

  private async assessJointScope(
    connection: Kysely<Database>, runId: string, requestedBy: string, targetDay: string,
    extractionConfig: string, transport: CloudflareWorkersAITransport, maxModelCalls = 2,
  ) {
    type Pair = { groupId: string; leftId: string; rightId: string; leftHash: string; rightHash: string;
      leftText: string; rightText: string; leftHeadline: string; rightHeadline: string; leftSource: string; rightSource: string };
    const jointConfig = sha256(`${extractionConfig}\n${LIVE_JOINT_SCOPE_VERSION}\n${sha256(LIVE_JOINT_SCOPE_PROMPT)}`);
    const pairs = await sql<Pair>`select distinct g.id::text as "groupId", l.article_id::text as "leftId",r.article_id::text as "rightId",
      li.input_sha256 as "leftHash",ri.input_sha256 as "rightHash",li.text_original as "leftText",ri.text_original as "rightText",
      li.headline as "leftHeadline",ri.headline as "rightHeadline",li.source_name as "leftSource",ri.source_name as "rightSource",
      case when lower(g.proposed_title) like '%primera b%' then 0
        when exists(select 1 from public.live_semantic_claim_pair_assessments old
          join public.live_semantic_stance_pair_attempts failed on failed.original_pair_id=old.id
          join public.live_semantic_stance_pair_outcomes outcome on outcome.attempt_id=failed.id and outcome.outcome='INVALID_MODEL_RESPONSE'
          where old.group_id=g.id and old.left_article_id=l.article_id and old.right_article_id=r.article_id) then 1 else 2 end as priority
      from public.live_semantic_event_group_candidates g
      join public.live_semantic_event_group_members l on l.group_id=g.id
      join public.live_semantic_event_group_members r on r.group_id=g.id and l.article_id<r.article_id and l.source_id<>r.source_id
      join public.live_semantic_excerpt_inputs li on li.article_id=l.article_id::text
      join public.live_semantic_excerpt_inputs ri on ri.article_id=r.article_id::text
      where g.target_day=${targetDay}::date and g.config_sha256=${extractionConfig}
        and exists(select 1 from public.live_semantic_pair_assessments p where p.group_id=g.id
          and p.left_article_id=l.article_id and p.right_article_id=r.article_id and p.same_event and p.same_event_confidence>=70)
        and not exists(select 1 from public.live_semantic_joint_scope_attempts a where a.group_id=g.id
          and a.left_article_id=l.article_id and a.right_article_id=r.article_id and a.left_input_sha256=li.input_sha256
          and a.right_input_sha256=ri.input_sha256 and a.config_sha256=${jointConfig})
      order by priority,"groupId","leftId","rightId" limit ${maxModelCalls}`.execute(connection);
    const totals = { attempted: 0, modelCalls: 0, validated: 0, invalidSchema: 0, invalidScope: 0, unavailable: 0, aligned: 0 };
    for (const pair of pairs.rows) {
      const attemptId = generateUlid({now:Date.now});
      const inserted = await sql<{id:string}>`insert into public.live_semantic_joint_scope_attempts
        (id,group_id,run_id,requested_by,left_article_id,right_article_id,left_input_sha256,right_input_sha256,config_sha256,requested_at)
        values (${attemptId},${pair.groupId}::dialektik_ulid,${runId}::dialektik_ulid,${requestedBy}::dialektik_ulid,
          ${pair.leftId}::dialektik_ulid,${pair.rightId}::dialektik_ulid,${pair.leftHash},${pair.rightHash},${jointConfig},${new Date().toISOString()})
        on conflict(group_id,left_article_id,right_article_id,left_input_sha256,right_input_sha256,config_sha256) do nothing returning id::text as id`.execute(connection);
      if (!inserted.rows[0]) continue;
      totals.attempted++;
      const outcome = async (status: string, result: unknown = null) => {
        await sql`insert into public.live_semantic_joint_scope_outcomes(attempt_id,outcome,result,recorded_at)
          values(${attemptId}::dialektik_ulid,${status},${result === null ? null : JSON.stringify(result)}::jsonb,${new Date().toISOString()})`.execute(connection);
      };
      const allowed = await sql<{allowed:boolean}>`select public.dialektik_live_semantic_route_allowed(${pair.leftId}::dialektik_ulid,${pair.leftHash},${PROVIDER},${MODEL})
        and public.dialektik_live_semantic_route_allowed(${pair.rightId}::dialektik_ulid,${pair.rightHash},${PROVIDER},${MODEL}) as allowed`.execute(connection);
      if (allowed.rows[0]?.allowed !== true) { totals.unavailable++; await outcome('INPUT_UNAVAILABLE'); continue; }
      let output:unknown;
      try {
        totals.modelCalls++;
        output = (await transport.generate('extraction', {
          left:{headline:pair.leftHeadline,source:pair.leftSource,textOriginal:pair.leftText},
          right:{headline:pair.rightHeadline,source:pair.rightSource,textOriginal:pair.rightText},
        }, LIVE_JOINT_SCOPE_SCHEMA, AbortSignal.timeout(32000))).output;
      } catch { totals.unavailable++; await outcome('PROVIDER_UNAVAILABLE'); break; }
      let result: ReturnType<typeof validateJointScope>;
      try { result=validateJointScope(output,pair.leftText,pair.rightText); }
      catch(error) {
        if(error instanceof Error && (error.message==='JOINT_SCOPE_NOT_GROUNDED' || error.message==='JOINT_RELATION_INVALID')) {
          totals.invalidScope++; await outcome('INVALID_SCOPE');
        } else { totals.invalidSchema++; await outcome('INVALID_SCHEMA'); }
        continue;
      }
      if (result.scopeAligned) {
        const leftId=generateUlid({now:Date.now}),rightId=generateUlid({now:Date.now});
        await connection.transaction().execute(async transaction => {
          await sql`insert into public.live_semantic_joint_scope_outcomes(attempt_id,outcome,result,recorded_at)
            values(${attemptId}::dialektik_ulid,'VALIDATED',${JSON.stringify(result)}::jsonb,${new Date().toISOString()})`.execute(transaction);
          await sql`insert into public.live_semantic_joint_claims
            (id,attempt_id,article_id,side,input_sha256,quoted_text,char_start,char_end,assertion_text,created_at)
            values (${leftId},${attemptId}::dialektik_ulid,${pair.leftId}::dialektik_ulid,'left',${pair.leftHash},${result.left.quotedText},${result.left.charStart},${result.left.charEnd},${result.left.assertionText},${new Date().toISOString()}),
              (${rightId},${attemptId}::dialektik_ulid,${pair.rightId}::dialektik_ulid,'right',${pair.rightHash},${result.right.quotedText},${result.right.charStart},${result.right.charEnd},${result.right.assertionText},${new Date().toISOString()})`.execute(transaction);
        });
        totals.aligned++;
      } else await outcome('VALIDATED',result);
      totals.validated++;
    }
    return totals;
  }

  async listReview(authorization: string | undefined, rawDay: unknown) {
    this.ensureEnabled();
    await this.reviews.authorizeEditor(authorization);
    if (typeof rawDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(rawDay))
      throw new ModerationHttpError(400, "MOD_INVALID_REQUEST");
    const database = this.writer.database;
    const configSha = this.configSha256();
    const proposals = await sql<{
      articleId: string;
      sourceName: string;
      headline: string;
      canonicalUrl: string;
      publishedAt: Date;
      generationId: string;
      outcome: string;
      quotedText: string | null;
      assertionText: string | null;
      positionSummary: string | null;
      charStart: number | null;
      charEnd: number | null;
      eventKey: string | null;
      eventTitle: string | null;
      eventSummary: string | null;
      usedLiteralFallback: boolean | null;
      reviewState: string;
      claims: unknown;
    }>`select i.article_id as "articleId",i.source_name as "sourceName",i.headline,
        i.url_canonical as "canonicalUrl",i.published_at as "publishedAt",g.id::text as "generationId",
        g.outcome::text as outcome,
        g.proposal_payload->'spans'->0->>'quoted_text' as "quotedText",
        g.proposal_payload->'spans'->0->>'assertion_text' as "assertionText",
        g.proposal_payload->'spans'->0->>'position_summary' as "positionSummary",
        nullif(g.proposal_payload->'spans'->0->>'start','')::int as "charStart",
        nullif(g.proposal_payload->'spans'->0->>'end','')::int as "charEnd",
        g.proposal_payload->'spans'->0->>'event_key' as "eventKey",
        g.proposal_payload->'spans'->0->>'event_title' as "eventTitle",
        g.proposal_payload->'spans'->0->>'event_summary' as "eventSummary",
        (g.proposal_payload->'spans'->0->>'used_literal_fallback')::boolean as "usedLiteralFallback",
        g.proposal_payload->'spans' as claims,
        'REVIEW_REQUIRED'::text as "reviewState"
      from public.live_semantic_excerpt_inputs i
      join lateral(select generation.* from public.assertion_extraction_generations generation
        where generation.article_id=i.article_id::dialektik_ulid and generation.input_hash=i.input_sha256
          and generation.provider_id=${PROVIDER} and generation.model_id=${MODEL}
          and generation.schema_version=${EXTRACTION_SCHEMA_VERSION}
          and generation.config_version=${configSha}
          and generation.state='active' and generation.outcome in ('proposed','no_claim_worthy_content')
        order by generation.created_at desc,generation.id desc limit 1) g on true
      where (i.published_at at time zone 'America/Santiago')::date>=${rawDay}::date
        and (i.published_at at time zone 'America/Santiago')::date<${rawDay}::date+2
      order by i.published_at desc,i.article_id`.execute(database);
    const groups = await sql<ReviewGroupRow>`
      select g.id::text as id,g.target_day as "targetDay",g.proposed_event_key as "proposedEventKey",
        g.proposed_title as "proposedTitle",g.proposed_summary as "proposedSummary",
        count(distinct m.article_id)::int as "articleCount",count(distinct m.source_id)::int as "sourceCount",
        count(distinct p.id) filter(where p.same_event and p.relation='CONTRADICTORY'
          and p.ratio_conflicting>=55 and p.ratio_comparable>=60)::int as "contradictionCount",
        count(distinct p.id) filter(where p.same_event and p.relation='DIVERGENT'
          and p.ratio_conflicting between 35 and 54 and p.ratio_comparable>=60)::int as "divergentCount",g.created_at as "createdAt",
        (select decision.decision from public.live_semantic_editorial_decisions decision
          where decision.group_id=g.id) as "editorialDecision",
        (select decision.reason from public.live_semantic_editorial_decisions decision
          where decision.group_id=g.id) as "editorialReason"
      from public.live_semantic_event_group_candidates g
      join public.live_semantic_event_group_members m on m.group_id=g.id
      left join public.live_semantic_claim_pair_assessments p on p.group_id=g.id
        and p.config_sha256=${stanceConfigSha256(configSha)}
      where g.target_day=${rawDay}::date and g.config_sha256=${configSha}
      group by g.id order by g.created_at desc,g.id desc limit 50
    `.execute(database);
    type ReviewMember = {
      groupId: string;
      articleId: string;
      generationId: string;
      sourceName: string;
      headline: string;
      canonicalUrl: string;
      assertionText: string;
      positionSummary: string;
      quotedText: string;
      charStart: number;
      charEnd: number;
      claims: unknown;
    };
    type ReviewPair = {
      groupId: string;
      sameEvent: boolean;
      relation: string;
      ratioConflicting: number;
      ratioComparable: number;
      sameEventConfidence: number;
    };
    type ReviewClaimPair = {
      id: string;
      groupId: string;
      leftArticleId: string;
      leftClaimOrdinal: number;
      leftSourceName: string;
      leftHeadline: string;
      rightArticleId: string;
      rightClaimOrdinal: number;
      rightSourceName: string;
      rightHeadline: string;
      sameEvent: boolean;
      relation: string;
      ratioConflicting: number;
      ratioComparable: number;
      sameEventConfidence: number;
      evaluationVersion: string;
      previousRelation: string | null;
    };
    let memberRows: ReviewMember[] = [];
    let pairRows: ReviewPair[] = [];
    let claimPairRows: ReviewClaimPair[] = [];
    let jointScopeRows: {groupId:string; attemptId:string; leftArticleId:string; rightArticleId:string; outcome:string; result:unknown; claims:unknown}[] = [];
    if (groups.rows.length > 0) {
      const groupIdFilter = sql.join(
        groups.rows.map((group) => sql`${group.id}::dialektik_ulid`),
      );
      const [members, pairs, claimPairs, jointScopes] = await Promise.all([
        sql<ReviewMember>`select m.group_id::text as "groupId",m.article_id::text as "articleId",
            m.extraction_generation_id::text as "generationId",i.source_name as "sourceName",
            i.headline,i.url_canonical as "canonicalUrl",
            g.proposal_payload->'spans'->0->>'assertion_text' as "assertionText",
            g.proposal_payload->'spans'->0->>'position_summary' as "positionSummary",
            g.proposal_payload->'spans'->0->>'quoted_text' as "quotedText",
            (g.proposal_payload->'spans'->0->>'start')::int as "charStart",
            (g.proposal_payload->'spans'->0->>'end')::int as "charEnd",
            g.proposal_payload->'spans' as claims
          from public.live_semantic_event_group_members m
          join public.live_semantic_excerpt_inputs i on i.article_id=m.article_id::text
          join public.assertion_extraction_generations g on g.id=m.extraction_generation_id
          where m.group_id in (${groupIdFilter})
          order by m.group_id,i.published_at desc,i.article_id`.execute(database),
        sql<ReviewPair>`select group_id::text as "groupId",same_event as "sameEvent",relation,
            ratio_conflicting as "ratioConflicting",ratio_comparable as "ratioComparable",
            same_event_confidence as "sameEventConfidence"
          from public.live_semantic_pair_assessments
          where group_id in (${groupIdFilter})
          order by group_id,created_at,id`.execute(database),
        sql<ReviewClaimPair>`select pair.id::text as id,pair.group_id::text as "groupId",
            pair.left_article_id::text as "leftArticleId",pair.left_claim_ordinal as "leftClaimOrdinal",
            left_input.source_name as "leftSourceName",left_input.headline as "leftHeadline",
            pair.right_article_id::text as "rightArticleId",pair.right_claim_ordinal as "rightClaimOrdinal",
            right_input.source_name as "rightSourceName",right_input.headline as "rightHeadline",
            pair.same_event as "sameEvent",pair.relation,
            pair.ratio_conflicting as "ratioConflicting",pair.ratio_comparable as "ratioComparable",
            pair.same_event_confidence as "sameEventConfidence",
            case when pair.config_sha256=${configSha} then 'ORIGINAL' else ${LIVE_STANCE_PAIR_VERSION} end as "evaluationVersion",
            (select original.relation from public.live_semantic_claim_pair_assessments original
              where original.group_id=pair.group_id and original.left_article_id=pair.left_article_id
                and original.right_article_id=pair.right_article_id and original.left_claim_ordinal=pair.left_claim_ordinal
                and original.right_claim_ordinal=pair.right_claim_ordinal and original.config_sha256=${configSha}
              limit 1) as "previousRelation"
          from public.live_semantic_claim_pair_assessments pair
          join public.live_semantic_excerpt_inputs left_input on left_input.article_id=pair.left_article_id::text
          join public.live_semantic_excerpt_inputs right_input on right_input.article_id=pair.right_article_id::text
          where pair.group_id in (${groupIdFilter}) and pair.config_sha256 in (${configSha},${stanceConfigSha256(configSha)})
          order by pair.group_id,pair.left_article_id,pair.left_claim_ordinal,
            pair.right_article_id,pair.right_claim_ordinal`.execute(database),
        sql<{groupId:string; attemptId:string; leftArticleId:string; rightArticleId:string; outcome:string; result:unknown; claims:unknown}>`
          select a.group_id::text as "groupId",a.id::text as "attemptId",a.left_article_id::text as "leftArticleId",
            a.right_article_id::text as "rightArticleId",coalesce(o.outcome,'PENDING') as outcome,o.result,
            coalesce((select jsonb_agg(jsonb_build_object('id',claim.id::text,'articleId',claim.article_id::text,
              'side',claim.side,'quotedText',claim.quoted_text,'charStart',claim.char_start,'charEnd',claim.char_end,
              'assertionText',claim.assertion_text) order by claim.side)
              from public.live_semantic_joint_claims claim where claim.attempt_id=a.id),'[]'::jsonb) as claims
          from public.live_semantic_joint_scope_attempts a
          join public.live_semantic_excerpt_inputs li on li.article_id=a.left_article_id::text and li.input_sha256=a.left_input_sha256
          join public.live_semantic_excerpt_inputs ri on ri.article_id=a.right_article_id::text and ri.input_sha256=a.right_input_sha256
          left join public.live_semantic_joint_scope_outcomes o on o.attempt_id=a.id
          where a.group_id in (${groupIdFilter}) order by a.group_id,a.requested_at,a.id`.execute(database),
      ]);
      memberRows = members.rows;
      pairRows = pairs.rows;
      claimPairRows = claimPairs.rows;
      jointScopeRows = jointScopes.rows;
    }
    const membersByGroup = new Map<string, ReviewMember[]>();
    const pairsByGroup = new Map<string, ReviewPair[]>();
    const claimPairsByGroup = new Map<string, ReviewClaimPair[]>();
    for (const member of memberRows) {
      const groupMembers = membersByGroup.get(member.groupId) ?? [];
      groupMembers.push(member);
      membersByGroup.set(member.groupId, groupMembers);
    }
    for (const pair of pairRows) {
      const groupPairs = pairsByGroup.get(pair.groupId) ?? [];
      groupPairs.push(pair);
      pairsByGroup.set(pair.groupId, groupPairs);
    }
    for (const pair of claimPairRows) {
      const groupPairs = claimPairsByGroup.get(pair.groupId) ?? [];
      groupPairs.push(pair);
      claimPairsByGroup.set(pair.groupId, groupPairs);
    }
    const details = groups.rows.map((group) => ({
      ...group,
      members: membersByGroup.get(group.id) ?? [],
      pairAssessments: pairsByGroup.get(group.id) ?? [],
      claimPairAssessments: (claimPairsByGroup.get(group.id) ?? []).filter((pair) => pair.evaluationVersion === "ORIGINAL"),
      stancePairAssessments: (claimPairsByGroup.get(group.id) ?? []).filter((pair) => pair.evaluationVersion === LIVE_STANCE_PAIR_VERSION),
      jointScopeAssessments: jointScopeRows.filter((row) => row.groupId === group.id),
    }));
    const originalPairs = claimPairRows.filter((pair) => pair.evaluationVersion === "ORIGINAL");
    const stancePairs = claimPairRows.filter((pair) => pair.evaluationVersion === LIVE_STANCE_PAIR_VERSION);
    return {
      targetDay: rawDay,
      windowDays: 2,
      summary: {
        articleProposals: proposals.rows.length,
        articlesWithClaims: proposals.rows.filter(
          (row) => row.outcome === "proposed",
        ).length,
        claimProposals: proposals.rows.reduce(
          (total, row) => total + (Array.isArray(row.claims) ? row.claims.length : 0),
          0,
        ),
        insufficientEvidence: proposals.rows.filter(
          (row) => row.outcome === "no_claim_worthy_content",
        ).length,
        groups: details.length,
        pendingGroups: details.filter((group) => group.editorialDecision === null).length,
        claimPairAssessments: {
          consistent: originalPairs.filter((pair) => pair.relation === "CONSISTENT").length,
          divergent: originalPairs.filter((pair) => pair.relation === "DIVERGENT").length,
          contradictory: originalPairs.filter((pair) => pair.relation === "CONTRADICTORY").length,
          notComparable: originalPairs.filter((pair) => pair.relation === "NOT_COMPARABLE").length,
        },
        stancePairAssessments: {
          consistent: stancePairs.filter((pair) => pair.relation === "CONSISTENT").length,
          divergent: stancePairs.filter((pair) => pair.relation === "DIVERGENT").length,
          contradictory: stancePairs.filter((pair) => pair.relation === "CONTRADICTORY").length,
          notComparable: stancePairs.filter((pair) => pair.relation === "NOT_COMPARABLE").length,
          changedToDivergent: stancePairs.filter((pair) => pair.relation === "DIVERGENT" && ["CONSISTENT", "NOT_COMPARABLE"].includes(pair.previousRelation ?? "")).length,
          changedToContradictory: stancePairs.filter((pair) => pair.relation === "CONTRADICTORY" && ["CONSISTENT", "NOT_COMPARABLE"].includes(pair.previousRelation ?? "")).length,
        },
        contradictionCandidates: details.reduce(
          (total, group) => total + (group.editorialDecision === null ? group.contradictionCount : 0),
          0,
        ),
      },
      articles: proposals.rows,
      groups: details,
    };
  }

  async promote(authorization: string | undefined, raw: unknown) {
    this.ensureEnabled();
    const identity = await this.reviews.authorizeEditor(authorization);
    const decision = parseSemanticPromotionDecision(raw);
    const { groupId } = decision;
    const commandId = generateUlid({ now: Date.now });
    const database = this.moderationWriter.database;
    try {
      return await database.transaction().execute(async (transaction) => {
        let result;
        let failureStage: "audit_context" | "promotion_function" = "audit_context";
        try {
          await setTransactionAuditContext(transaction, {
            action: "moderation_decision",
            actorId: identity.userId,
            actorType: "editor",
            correlationId: commandId,
            reasonCode: "live_semantic_editorial_promotion",
            metadata: { semantic_group_id: groupId },
          });
          failureStage = "promotion_function";
          await sql`select public.dialektik_record_live_semantic_editorial_decision(
              ${groupId}::dialektik_ulid,${identity.userId}::dialektik_ulid,${commandId}::dialektik_ulid,
              'APPROVED',${decision.reason},${decision.title},${JSON.stringify(decision.claims)}::jsonb,
              ${JSON.stringify(decision.approvedConflictPairIds)}::jsonb
            )`.execute(transaction);
          result = await sql<{ result: Record<string, unknown> }>`
            select public.dialektik_promote_live_semantic_event_group(
              ${groupId}::dialektik_ulid,${identity.userId}::dialektik_ulid,${commandId}::dialektik_ulid
            ) as result
          `.execute(transaction);
        } catch (error) {
          throw semanticPromotionDatabaseError(error, failureStage);
        }
        const response = result.rows[0]?.result;
        if (!response || response.status !== "PROMOTED")
          throw new ConflictException("SEMANTIC_GROUP_REQUIRES_FURTHER_EDITORIAL_REVIEW");
        return response;
      });
    } catch (error) {
      if (error instanceof ModerationHttpError || error instanceof ConflictException)
        throw error;
      throw semanticPromotionDatabaseError(error, "transaction");
    }
  }

  async attach(authorization: string | undefined, raw: unknown) {
    this.ensureEnabled();
    const identity = await this.reviews.authorizeEditor(authorization);
    const decision = parseSemanticPromotionDecision(raw);
    const commandId = generateUlid({ now: Date.now });
    try {
      return await this.moderationWriter.database.transaction().execute(async (transaction) => {
        await setTransactionAuditContext(transaction, {
          action: "moderation_decision", actorId: identity.userId, actorType: "editor",
          correlationId: commandId, reasonCode: "live_semantic_editorial_attachment",
          metadata: { semantic_group_id: decision.groupId },
        });
        await sql`select public.dialektik_record_live_semantic_editorial_decision(
          ${decision.groupId}::dialektik_ulid,${identity.userId}::dialektik_ulid,${commandId}::dialektik_ulid,
          'APPROVED',${decision.reason},${decision.title},${JSON.stringify(decision.claims)}::jsonb,
          ${JSON.stringify(decision.approvedConflictPairIds)}::jsonb
        )`.execute(transaction);
        const result = await sql<{ result: Record<string, unknown> }>`
          select public.dialektik_attach_live_semantic_article(
            ${decision.groupId}::dialektik_ulid,${identity.userId}::dialektik_ulid,${commandId}::dialektik_ulid
          ) as result`.execute(transaction);
        if (result.rows[0]?.result?.status !== "ATTACHED")
          throw new ConflictException("SEMANTIC_ATTACHMENT_REQUIRES_FURTHER_EDITORIAL_REVIEW");
        return result.rows[0].result;
      });
    } catch (error) {
      if (error instanceof ModerationHttpError || error instanceof ConflictException) throw error;
      throw semanticPromotionDatabaseError(error, "transaction");
    }
  }

  async reject(authorization: string | undefined, raw: unknown) {
    this.ensureEnabled();
    const identity = await this.reviews.authorizeEditor(authorization);
    const decision = parseSemanticRejection(raw);
    const commandId = generateUlid({ now: Date.now });
    try {
      return await this.moderationWriter.database.transaction().execute(async (transaction) => {
        await setTransactionAuditContext(transaction, {
          action: "moderation_decision",
          actorId: identity.userId,
          actorType: "editor",
          correlationId: commandId,
          reasonCode: "live_semantic_editorial_rejection",
          metadata: { semantic_group_id: decision.groupId },
        });
        const result = await sql<{ result: Record<string, unknown> }>`
          select public.dialektik_record_live_semantic_editorial_decision(
            ${decision.groupId}::dialektik_ulid,${identity.userId}::dialektik_ulid,${commandId}::dialektik_ulid,
            'REJECTED',${decision.reason},null,'[]'::jsonb,'[]'::jsonb
          ) as result`.execute(transaction);
        return result.rows[0]?.result;
      });
    } catch (error) {
      if (error instanceof ModerationHttpError || error instanceof ConflictException) throw error;
      throw semanticPromotionDatabaseError(error, "transaction");
    }
  }

  async quarantineLegacyContradiction(authorization: string | undefined, raw: unknown) {
    this.ensureEnabled();
    const identity = await this.reviews.authorizeEditor(authorization);
    const decision = parseLegacyContradictionReview(raw);
    const commandId = generateUlid({ now: Date.now });
    try {
      return await this.moderationWriter.database.transaction().execute(async (transaction) => {
        await setTransactionAuditContext(transaction, {
          action: "moderation_decision",
          actorId: identity.userId,
          actorType: "editor",
          correlationId: commandId,
          reasonCode: "live_semantic_legacy_contradiction_review",
          metadata: { contradiction_publication_id: decision.publicationId },
        });
        const result = await sql<{ result: Record<string, unknown> }>`
          select public.dialektik_quarantine_legacy_contradiction(
            ${decision.publicationId}::dialektik_ulid,${identity.userId}::dialektik_ulid,
            ${commandId}::dialektik_ulid,${decision.reason}
          ) as result`.execute(transaction);
        return result.rows[0]?.result;
      });
    } catch (error) {
      if (error instanceof ModerationHttpError || error instanceof ConflictException) throw error;
      throw semanticPromotionDatabaseError(error, "transaction");
    }
  }
}
