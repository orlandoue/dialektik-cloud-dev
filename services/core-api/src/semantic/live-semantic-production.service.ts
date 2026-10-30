import { createHash } from "node:crypto";
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { generateUlid, isUlid, setTransactionAuditContext } from "@dialektik/database";
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
import {
  canAddSemanticPairToClique,
  preclusterLiveSemanticArticles,
} from "./live-semantic-precluster.js";
import {
  LIVE_CLAIM_EXTRACTION_PROMPT,
  LIVE_CLAIM_EXTRACTION_SCHEMA,
  LIVE_PAIR_ASSESSMENT_PROMPT,
  LIVE_PAIR_ASSESSMENT_SCHEMA,
  groundLiveClaim,
  validateLivePairAssessment,
} from "./live-semantic-production.contract.js";

const MODEL = CLOUDFLARE_JSON_MODE_MODEL;
const PROVIDER = "llm_cloudflare_workers_ai";
const EXTRACTION_SCHEMA_VERSION = "live-claim-extraction-v2";
const SEGMENTATION_VERSION = "dialektik-live-excerpt-claim-v2";
const MAX_BATCH = 5;
const MAX_PAIR_ASSESSMENTS = 20;
const THRESHOLD_RULE =
  "review-only:same-event>=70;conflict>0/comparable>=60;divergence>0/comparable>=60";

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
  span: Record<string, unknown> | null;
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
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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

function exactPromotionBody(raw: unknown): string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new ModerationHttpError(400, "MOD_INVALID_REQUEST");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).length !== 1 || typeof value.groupId !== "string" || !isUlid(value.groupId))
    throw new ModerationHttpError(400, "MOD_INVALID_REQUEST");
  return value.groupId;
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
      maxCalls: MAX_BATCH + MAX_PAIR_ASSESSMENTS,
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
        grounding: "exact-unicode-codepoint-span-v1",
        publication: "single-editor-consistent-group-promotion-v1",
        precluster: "named-entity-incident-signature-complete-link-48h-v3",
        pairInput: "assertion-first-incident-calibrated-v2",
        contradictionThreshold: "conflicting-positive-comparable-60",
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
        targetDay,
        configSha,
        pairTransport,
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
          count(*) filter(where p.relation='CONTRADICTORY'
            and p.ratio_conflicting>0 and p.ratio_comparable>=60)::int as "conflictCandidates",
          count(*) filter(where p.relation='DIVERGENT'
            and p.ratio_conflicting>0 and p.ratio_comparable>=60)::int as "divergentCandidates"
        from public.live_semantic_event_group_candidates g
        left join public.live_semantic_pair_assessments p on p.group_id=g.id
        where g.target_day=${targetDay}::date and g.config_sha256=${configSha}
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
      grounded = groundLiveClaim(rawOutput, input.textOriginal, input.headline);
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
    const spans =
      grounded.status === "EXTRACTED" &&
      grounded.charStart !== null &&
      grounded.charEnd !== null
        ? [
            {
              start: grounded.charStart,
              end: grounded.charEnd,
              quoted_text: grounded.quotedText,
              assertion_text: grounded.assertionText,
              position_summary: grounded.positionSummary,
              event_key: grounded.eventKey,
              event_title: grounded.eventTitle,
              event_summary: grounded.eventSummary,
              used_literal_fallback: grounded.usedFallback,
            },
          ]
        : [];
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
      usedFallback: grounded.usedFallback,
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
    targetDay: string,
    configSha: string,
    transport: CloudflareWorkersAITransport,
  ): Promise<number> {
    const result = await sql<ProposalRow>`
      select i.article_id as "articleId",i.source_id as "sourceId",i.source_name as "sourceName",
        i.url_canonical as "canonicalUrl",i.headline,i.published_at as "publishedAt",
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
    let assessments = 0;
    for (const pair of pairs) {
      if (assessments >= MAX_PAIR_ASSESSMENTS) break;
      const left = proposalById.get(pair.left.articleId);
      const right = proposalById.get(pair.right.articleId);
      if (!left || !right || !left.span || !right.span) continue;
      const existing = await sql<{ exists: boolean }>`select exists(
        select 1 from public.live_semantic_pair_assessments
        where left_article_id=${left.articleId}::dialektik_ulid
          and right_article_id=${right.articleId}::dialektik_ulid
          and config_sha256=${configSha}) as exists`.execute(connection);
      if (existing.rows[0]?.exists) continue;
      const leftSpan = left.span;
      const rightSpan = right.span;
      const groupKey = sha256(`${targetDay}\n${pair.clusterKey}\n${configSha}`);
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
        from public.live_semantic_event_group_candidates where group_key_sha256=${groupKey} limit 1`.execute(connection);
      if (!group.rows[0]) continue;
      const groupId = group.rows[0].id;
      assessments += 1;
      let assessment;
      try {
        const generated = await transport.generate(
          "extraction",
          {
            left: {
              headline: left.headline,
              sourceName: left.sourceName,
              publishedAt: left.publishedAt.toISOString(),
              eventKey: leftSpan.event_key,
              eventSummary: leftSpan.event_summary,
              assertion: leftSpan.assertion_text,
            },
            right: {
              headline: right.headline,
              sourceName: right.sourceName,
              publishedAt: right.publishedAt.toISOString(),
              eventKey: rightSpan.event_key,
              eventSummary: rightSpan.event_summary,
              assertion: rightSpan.assertion_text,
            },
          },
          LIVE_PAIR_ASSESSMENT_SCHEMA,
          AbortSignal.timeout(32000),
        );
        assessment = validateLivePairAssessment(generated.output);
      } catch {
        continue;
      }
      await sql`insert into public.live_semantic_pair_assessments
        (id,run_id,group_id,left_article_id,right_article_id,left_extraction_generation_id,
         right_extraction_generation_id,same_event,relation,ratio_conflicting,ratio_comparable,same_event_confidence,
         threshold_rule,provider_type,model_id,config_sha256,created_at)
        values (${generateUlid({ now: Date.now })},${runId}::dialektik_ulid,
          ${groupId}::dialektik_ulid,${left.articleId}::dialektik_ulid,${right.articleId}::dialektik_ulid,
          ${left.generationId}::dialektik_ulid,${right.generationId}::dialektik_ulid,${assessment.sameEvent},
          ${assessment.relation},${assessment.ratioConflicting},${assessment.ratioComparable},
          ${assessment.sameEventConfidence},${THRESHOLD_RULE},${PROVIDER},${MODEL},${configSha},
          ${new Date().toISOString()}) on conflict(left_article_id,right_article_id,config_sha256) do nothing`.execute(connection);
      if (assessment.sameEvent && assessment.sameEventConfidence >= 70) {
        const existingMembers = await sql<{ articleId: string }>`select article_id::text as "articleId"
          from public.live_semantic_event_group_members where group_id=${groupId}::dialektik_ulid
          order by article_id`.execute(connection);
        const confirmedRows = await sql<{
          leftArticleId: string;
          rightArticleId: string;
        }>`select left_article_id::text as "leftArticleId",right_article_id::text as "rightArticleId"
          from public.live_semantic_pair_assessments where group_id=${groupId}::dialektik_ulid
            and config_sha256=${configSha} and same_event and same_event_confidence>=70`.execute(connection);
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
        count(*) filter(where p.same_event and p.relation='CONTRADICTORY'
          and p.ratio_conflicting>0 and p.ratio_comparable>=60)::int as "contradictionCount",
        count(*) filter(where p.same_event and p.relation='DIVERGENT'
          and p.ratio_conflicting>0 and p.ratio_comparable>=60)::int as "divergentCount",g.created_at as "createdAt"
      from public.live_semantic_event_group_candidates g
      join public.live_semantic_event_group_members m on m.group_id=g.id
      left join public.live_semantic_pair_assessments p on p.group_id=g.id
      where g.target_day=${rawDay}::date and g.config_sha256=${configSha}
      group by g.id order by g.created_at desc,g.id desc limit 50
    `.execute(database);
    const details = [];
    for (const group of groups.rows) {
      const members = await sql<{
        sourceName: string;
        headline: string;
        canonicalUrl: string;
        assertionText: string;
        positionSummary: string;
        quotedText: string;
        charStart: number;
        charEnd: number;
      }>`select i.source_name as "sourceName",i.headline,i.url_canonical as "canonicalUrl",
          g.proposal_payload->'spans'->0->>'assertion_text' as "assertionText",
          g.proposal_payload->'spans'->0->>'position_summary' as "positionSummary",
          g.proposal_payload->'spans'->0->>'quoted_text' as "quotedText",
          (g.proposal_payload->'spans'->0->>'start')::int as "charStart",
          (g.proposal_payload->'spans'->0->>'end')::int as "charEnd"
        from public.live_semantic_event_group_members m
        join public.live_semantic_excerpt_inputs i on i.article_id=m.article_id::text
        join public.assertion_extraction_generations g on g.id=m.extraction_generation_id
        where m.group_id=${group.id}::dialektik_ulid
        order by i.published_at desc,i.article_id`.execute(database);
      const pairs = await sql<{
        sameEvent: boolean;
        relation: string;
        ratioConflicting: number;
        ratioComparable: number;
        sameEventConfidence: number;
      }>`select same_event as "sameEvent",relation,ratio_conflicting as "ratioConflicting",ratio_comparable as "ratioComparable",
          same_event_confidence as "sameEventConfidence"
        from public.live_semantic_pair_assessments where group_id=${group.id}::dialektik_ulid
        order by created_at,id`.execute(database);
      details.push({
        ...group,
        members: members.rows,
        pairAssessments: pairs.rows,
      });
    }
    return {
      targetDay: rawDay,
      windowDays: 2,
      summary: {
        articleProposals: proposals.rows.length,
        claimProposals: proposals.rows.filter(
          (row) => row.outcome === "proposed",
        ).length,
        insufficientEvidence: proposals.rows.filter(
          (row) => row.outcome === "no_claim_worthy_content",
        ).length,
        groups: details.length,
        contradictionCandidates: details.reduce(
          (total, group) => total + group.contradictionCount,
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
    const groupId = exactPromotionBody(raw);
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
}
