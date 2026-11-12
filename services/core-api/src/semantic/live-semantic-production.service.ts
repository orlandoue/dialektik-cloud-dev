import { createHash } from "node:crypto";
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { generateUlid, parseUlid, setTransactionAuditContext } from "@dialektik/database";
import { sql, type Kysely } from "kysely";
import type { Database } from "@dialektik/database";
import { LiveSemanticCallBudget } from "./live-semantic-call-budget.js";
import { controversyScore, hasSpecificHeadlineOverlap, hasStrongPairOverlap, isSportsText } from "./live-semantic-scheduler-prefilter.js";
import { validateAutoScope } from "./live-semantic-auto-guard.js";
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
  planSubBatches,
  sourcesPerCluster,
  publishedEntityCount,
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

const MODEL = CLOUDFLARE_JSON_MODE_MODEL;
const PROVIDER = "llm_cloudflare_workers_ai";
const EXTRACTION_SCHEMA_VERSION = "live-claim-extraction-v3";
const SEGMENTATION_VERSION = "dialektik-live-excerpt-claim-v3";
const MAX_BATCH = 5;
const MAX_PAIR_ASSESSMENTS = 20;
const MAX_CLAIM_PAIR_ASSESSMENTS = 95;
const MAX_STANCE_PAIR_ASSESSMENTS = 8;
const MAX_CASE_PAIR_ASSESSMENTS = 8;
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

/** One scheduled batch: at most 25 Workers AI calls shared by every stage. */
const SCHEDULED_CALL_BUDGET = 25;
const SCHEDULED_MAX_PAIRS = 8;
/**
 * New extractions per batch. live_semantic_production_runs.requested_count
 * is constrained to 1..5 (migration 058), and the cap also leaves most of
 * the shared budget for the case and stance stages that lead to publication.
 */
export const SCHEDULED_MAX_NEW_EXTRACTIONS = MAX_BATCH;
/**
 * Sub-batches chained within one scheduled run. Each records its own run row
 * (requested_count<=5) and all share the single 25-call budget.
 */
export const SCHEDULED_SUB_BATCHES = 2;
/** Queued pairs above which the batch spacing shortens to drain the day. */
export const BACKLOG_PAIRS_THRESHOLD = 15;
/** Spacing while a backlog of strong pairs remains. */
const GAP_WITH_BACKLOG_MS = 15 * 60 * 1000;
/** Pairs whose newest item is within this window are evaluated first. */
const FRESH_PAIR_WINDOW_MS = 18 * 60 * 60 * 1000;
const SCHEDULER_STARTUP_DELAY_MS = 15_000;
/** Each tick only checks the shared database guard; it spends nothing by itself. */
const SCHEDULER_TICK_MS = 5 * 60 * 1000;
const HEALTH_WAKE_THROTTLE_MS = 5 * 60 * 1000;
/** Spacing after a batch that published something. */
const GAP_AFTER_PUBLISHING_MS = 45 * 60 * 1000;
/** Shorter spacing after a batch that published nothing, so fresh news is retried. */
const GAP_AFTER_EMPTY_MS = 30 * 60 * 1000;
/** A deploy or restart runs soon, but a crash loop cannot spend repeatedly. */
const GAP_AT_STARTUP_MS = 10 * 60 * 1000;
const MAX_AUTO_PROMOTION_GROUPS = 12;

export type SchedulerTrigger = 'startup' | 'tick' | 'health' | 'manual';

/** Safe, public summary of the last scheduled batch: counts and codes only. */
export interface SemanticRunSummary {
  readonly trigger: SchedulerTrigger;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly status: string;
  readonly targetDay: string;
  readonly candidateArticles: number;
  readonly candidatePairs: number;
  readonly pairsEvaluated: number;
  readonly pairsDeferred: number;
  readonly subBatches: number;
  readonly articlesSelected: number;
  readonly articlesProcessed: number;
  readonly modelCalls: number;
  readonly eventGroupsFormed: number;
  readonly eventsPromoted: number;
  readonly contrastsPromoted: number;
  readonly skipOrRejectReasons: Readonly<Record<string, number>>;
}

/** Collects the outcome of automatic promotion attempts. */
export class AutoPromotionTally {
  events = 0;
  contrasts = 0;
  readonly reasons: Record<string, number> = {};
  reject(code: string): void {
    this.reasons[code] = (this.reasons[code] ?? 0) + 1;
  }
}

function safeReasonCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_]{1,80}$/u.test(error.message)) return error.message;
  const sqlState = safeDatabaseErrorCode(error);
  if (sqlState) return `DATABASE_${sqlState}`;
  return error instanceof Error ? error.name.toUpperCase().slice(0, 40) : 'UNKNOWN';
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

export function parseSemanticBatchBody(raw: unknown): { targetDay: string; limit: number; articleIds: string[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new ModerationHttpError(400, "MOD_INVALID_REQUEST");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["targetDay", "limit", "articleIds"].includes(key)))
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
  const articleIds = value.articleIds === undefined ? [] : value.articleIds;
  if (!Array.isArray(articleIds) || articleIds.length > MAX_BATCH ||
      articleIds.some((id) => typeof id !== "string" || !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(id)) ||
      new Set(articleIds).size !== articleIds.length)
    throw new ModerationHttpError(400, "MOD_INVALID_REQUEST");
  return { targetDay: value.targetDay, limit: Number(limit), articleIds: articleIds as string[] };
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
export class LiveSemanticProductionService implements OnApplicationBootstrap, OnModuleDestroy {
  private scheduler: ReturnType<typeof setInterval> | undefined;
  private startup: ReturnType<typeof setTimeout> | undefined;
  private busy = false;
  private lastSchedulerAttemptAt = 0;
  private readonly logger = new Logger(LiveSemanticProductionService.name);
  constructor(
    @Inject(HeadlineReviewService)
    private readonly reviews: HeadlineReviewService,
    @Inject(HeadlineSemanticDatabaseService)
    private readonly writer: HeadlineSemanticDatabaseService,
    @Inject(ModerationDatabaseService)
    private readonly moderationWriter: ModerationDatabaseService,
  ) {}

  private lastRun: SemanticRunSummary | undefined;
  private lastSkip: { readonly at: string; readonly trigger: SchedulerTrigger; readonly status: string } | undefined;

  /** Last completed batch, for the public pipeline status. */
  get lastRunSummary(): SemanticRunSummary | undefined { return this.lastRun; }
  /** Last tick that decided not to spend (guard, no pairs, lock). */
  get lastSkippedTick() { return this.lastSkip; }
  get schedulerEnabled(): boolean { return process.env.DIALEKTIK_LIVE_SEMANTIC_SCHEDULER_ENABLED === 'true'; }
  get schedulerBusy(): boolean { return this.busy; }

  /** Latest batch as recorded in the database; survives restarts. */
  async latestRunRecord(): Promise<{startedAt:string;completedAt:string|null;processed:number;pairAssessments:number;eventsPromotedSince:number}|null> {
    const rows=await sql<{startedAt:Date;completedAt:Date|null;processed:number;pairAssessments:number;promoted:number}>`
      select r.started_at as "startedAt",r.completed_at as "completedAt",r.processed_count as processed,
        r.pair_assessment_count as "pairAssessments",
        (select count(*)::int from public.live_semantic_editorial_decisions d
          where d.decision='APPROVED' and d.decided_at>=r.started_at) as promoted
      from public.live_semantic_production_runs r order by r.started_at desc limit 1`.execute(this.writer.database);
    const row=rows.rows[0];
    if(!row) return null;
    return {startedAt:new Date(row.startedAt).toISOString(),completedAt:row.completedAt===null ? null : new Date(row.completedAt).toISOString(),
      processed:row.processed,pairAssessments:row.pairAssessments,eventsPromotedSince:row.promoted};
  }

  onApplicationBootstrap(): void {
    if(!this.schedulerEnabled) return;
    // Starts shortly after boot so /health/ready answers first; the shorter
    // startup guard lets a fresh deploy run without waiting for the cadence.
    this.startup=setTimeout(()=>void this.runScheduledSafely('startup'),SCHEDULER_STARTUP_DELAY_MS); this.startup.unref();
    this.scheduler=setInterval(()=>void this.runScheduledSafely('tick'),SCHEDULER_TICK_MS); this.scheduler.unref();
  }
  onModuleDestroy(): void { if(this.startup) clearTimeout(this.startup); if(this.scheduler) clearInterval(this.scheduler); }
  private async runScheduledSafely(trigger: SchedulerTrigger = 'tick'): Promise<void> {
    if(this.busy) return;
    this.lastSchedulerAttemptAt=Date.now();
    this.busy=true;
    try { const result=await this.runScheduled(false,undefined,trigger); this.logger.log(`Semantic scheduled run (${trigger}): ${result}`); }
    catch(error) {
      const reason=safeReasonCode(error);
      this.lastSkip={at:new Date().toISOString(),trigger,status:`FAILED:${reason}`};
      this.logger.warn(`Semantic scheduled run failed: ${reason}`);
    }
    finally { this.busy=false; }
  }
  /** Best-effort wake-up; the work remains guarded by the existing DB lock and budget. */
  public wakeFromHealthPing(): void {
    if (!this.schedulerEnabled || this.busy) return;
    // Pings only recheck the shared database guard; they never bypass it.
    if (Date.now()-this.lastSchedulerAttemptAt < HEALTH_WAKE_THROTTLE_MS) return;
    void this.runScheduledSafely('health');
  }
  async runAutomatic(authorization: string | undefined, body: unknown): Promise<{status:string}> {
    this.ensureEnabled();
    await this.reviews.authorizeEditor(authorization);
    let targetDay: string | undefined;
    if (body !== undefined && body !== null && (typeof body !== 'object' || Array.isArray(body)))
      throw new ModerationHttpError(400, 'MOD_INVALID_REQUEST');
    const request = (body ?? {}) as Record<string,unknown>;
    if (Object.keys(request).some(key => key !== 'targetDay')) throw new ModerationHttpError(400, 'MOD_INVALID_REQUEST');
    if (request.targetDay !== undefined) targetDay = parseSemanticBatchBody({targetDay:request.targetDay}).targetDay;
    return {status:await this.runScheduled(true,targetDay,'manual')};
  }
  /**
   * Minimum spacing since the last batch. A batch that published nothing is
   * retried sooner; at startup a short guard lets a deploy run right away
   * while still stopping a crash loop from spending repeatedly.
   */
  static minimumGapMs(trigger: SchedulerTrigger, lastRunPublished: boolean, queuedPairs = 0): number {
    if (trigger === 'startup') return GAP_AT_STARTUP_MS;
    // A queue of strong pairs drains every 15 minutes; each batch keeps its
    // own 25-call budget, and a tick with nothing pending spends nothing.
    if (queuedPairs > BACKLOG_PAIRS_THRESHOLD) return GAP_WITH_BACKLOG_MS;
    return lastRunPublished ? GAP_AFTER_PUBLISHING_MS : GAP_AFTER_EMPTY_MS;
  }

  /** Strong pairs left for later by the last planned batch. */
  private queuedPairs = 0;

  private skip(trigger: SchedulerTrigger, status: string): string {
    this.lastSkip={at:new Date().toISOString(),trigger,status};
    return status;
  }

  async runScheduled(manual = false, targetDayOverride?: string, trigger: SchedulerTrigger = manual ? 'manual' : 'tick'): Promise<string> {
    this.ensureEnabled();
    const actor=process.env.DIALEKTIK_SEMANTIC_AUTOMATION_ACTOR_ID ?? '';
    if(!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(actor)) throw new Error('SEMANTIC_AUTOMATION_ACTOR_REQUIRED');
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const date=new Date(`${today}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate()-1);
    const targetDay=targetDayOverride ?? date.toISOString().slice(0,10); const configSha=this.configSha256();
    const startedAt=new Date().toISOString();
    return this.writer.database.connection().execute(async connection=>{
      const global=await sql<{locked:boolean}>`select pg_try_advisory_lock(hashtextextended('dialektik-live-semantic-automation',0)) as locked`.execute(connection);
      if(global.rows[0]?.locked!==true) return this.skip(trigger,'ALREADY_RUNNING');
      try {
      const locked=await sql<{locked:boolean}>`select pg_try_advisory_lock(hashtextextended(${'dialektik-live-semantic:'+targetDay},0)) as locked`.execute(connection);
      if(locked.rows[0]?.locked!==true) return this.skip(trigger,'ALREADY_RUNNING');
      try {
        const editor=await sql<{allowed:boolean}>`select exists(select 1 from public.users u join public.editorial_single_editor_authorizations a on a.editor_user_id=u.id where u.id=${actor}::dialektik_ulid and u.role='editor' and a.revoked_at is null) as allowed`.execute(connection);
        if(editor.rows[0]?.allowed!==true) throw new Error('SEMANTIC_AUTOMATION_ACTOR_INVALID');
        // Shared database guard prevents duplicate model spending across
        // restarts and replicas; its length depends on whether the previous
        // batch published anything.
        if(!manual) {
          const last=await sql<{elapsedMs:number;published:boolean}>`
            select (extract(epoch from clock_timestamp()-r.started_at)*1000)::float8 as "elapsedMs",
              exists(select 1 from public.live_semantic_editorial_decisions d
                where d.decision='APPROVED' and d.decided_at>=r.started_at) as published
            from public.live_semantic_production_runs r order by r.started_at desc limit 1`.execute(connection);
          const previous=last.rows[0];
          if(previous && previous.elapsedMs < LiveSemanticProductionService.minimumGapMs(trigger,previous.published,this.queuedPairs))
            return this.skip(trigger,'RECENT_SEMANTIC_RUN');
        }
        const candidates=await sql<{articleId:string;sourceId:string;publishedAt:Date;headline:string;excerpt:string;needsExtraction:boolean}>`
          select * from (
          select i.article_id as "articleId",i.source_id as "sourceId",i.published_at as "publishedAt",i.headline,i.excerpt,
            row_number() over(partition by (i.published_at at time zone 'America/Santiago')::date order by i.published_at desc,i.article_id desc) as daily_rank,
            not exists(select 1 from public.live_semantic_article_attempts a where a.article_id=i.article_id::dialektik_ulid and a.input_sha256=i.input_sha256 and a.config_sha256=${configSha})
            and not exists(select 1 from public.assertion_extraction_generations g where g.article_id=i.article_id::dialektik_ulid and g.input_hash=i.input_sha256 and g.provider_id=${PROVIDER} and g.model_id=${MODEL} and g.config_version=${configSha} and g.state='active') as "needsExtraction"
          from public.live_semantic_excerpt_inputs i
          where (published_at at time zone 'America/Santiago')::date>=${targetDay}::date
            and (published_at at time zone 'America/Santiago')::date<${targetDay}::date+2
            and i.event_id is null
          ) ranked where daily_rank<=300 order by "publishedAt" desc,"articleId" desc`.execute(connection);
        const proposals=candidates.rows.map(a=>({...a,eventKey:'',eventTitle:a.headline,eventSummary:''}));
        const pendingIds=new Set(candidates.rows.filter(a=>a.needsExtraction).map(a=>a.articleId));
        const excerpts=new Map(candidates.rows.map(a=>[a.articleId,a.excerpt]));
        const published=await sql<{title:string}>`select title_descriptive as title from public.events
          where analysis_state='PUBLISHED' and origin='LIVE_REAL' and merged_into is null
          order by detected_at desc limit 150`.execute(connection);
        const publishedTitles=published.rows.map(row=>row.title);
        const reasons:Record<string,number>={};
        const count=(code:string,n=1)=>{ if(n>0) reasons[code]=(reasons[code] ?? 0)+n; };
        const clustered=preclusterLiveSemanticArticles(proposals,targetDay);
        const withPending=clustered.filter(pair=>pendingIds.has(pair.left.articleId) || pendingIds.has(pair.right.articleId));
        count('PAIR_ALREADY_ANALYZED',clustered.length-withPending.length);
        const text=(id:string,headline:string)=>`${headline} ${excerpts.get(id) ?? ''}`;
        // A sports item and a non-sports item are never the same case; the
        // promotion guard would reject them after spending model calls.
        const sameDomain=withPending.filter(pair=>
          isSportsText(text(pair.left.articleId,pair.left.headline))===isSportsText(text(pair.right.articleId,pair.right.headline)));
        count('PAIR_SPORTS_MISMATCH',withPending.length-sameDomain.length);
        const generic=sameDomain.filter(pair=>!hasSpecificHeadlineOverlap(pair.left.headline,pair.right.headline));
        count('PAIR_HEADLINES_TOO_GENERIC',generic.length);
        const overlapping=sameDomain.filter(pair=>hasStrongPairOverlap(
          pair.left.headline,excerpts.get(pair.left.articleId) ?? '',pair.right.headline,excerpts.get(pair.right.articleId) ?? ''));
        count('PAIR_OVERLAP_TOO_WEAK',sameDomain.length-generic.length-overlapping.length);
        const clusterSources=sourcesPerCluster(clustered);
        const nowMs=Date.now();
        const pairs=overlapping.map(pair=>{
            const newest=Math.max(pair.left.publishedAt.getTime(),pair.right.publishedAt.getTime());
            return {pair,newest,
              fresh:nowMs-newest<=FRESH_PAIR_WINDOW_MS ? 0 : 1,
              // One side already extracted, or a case three media cover.
              priority:!pendingIds.has(pair.left.articleId) || !pendingIds.has(pair.right.articleId) || (clusterSources.get(pair.clusterKey) ?? 0)>=3 ? 0 : 1,
              coverage:publishedEntityCount(pair,publishedTitles),
              tension:controversyScore(pair.left.headline,excerpts.get(pair.left.articleId) ?? '',pair.right.headline,excerpts.get(pair.right.articleId) ?? ''),
            };
          }).sort((a,b)=>a.fresh-b.fresh || a.priority-b.priority || a.coverage-b.coverage || b.tension-a.tension || b.newest-a.newest).map(item=>item.pair);
        const plans=planSubBatches(pairs,pendingIds,{maxPairs:SCHEDULED_MAX_PAIRS,maxNewPerBatch:SCHEDULED_MAX_NEW_EXTRACTIONS,batches:SCHEDULED_SUB_BATCHES});
        const subBatches=plans.map(item=>item.articleIds);
        const plan={pairs:plans.flatMap(item=>item.pairs),articleIds:[...new Set(subBatches.flat())]};
        const deferred=pairs.length-plan.pairs.length;
        count('PAIR_DEFERRED_TO_NEXT_BATCH',deferred);
        this.queuedPairs=deferred;
        const summary=(status:string,extra:Partial<SemanticRunSummary>={}):SemanticRunSummary=>({
          trigger,startedAt,finishedAt:new Date().toISOString(),status,targetDay,
          candidateArticles:candidates.rows.length,candidatePairs:clustered.length,
          pairsEvaluated:plan.pairs.length,pairsDeferred:deferred,subBatches:0,articlesSelected:plan.articleIds.length,articlesProcessed:0,modelCalls:0,
          eventGroupsFormed:0,eventsPromoted:0,contrastsPromoted:0,skipOrRejectReasons:{...reasons},...extra,
        });
        const tally=new AutoPromotionTally();
        // Groups whose assessments finished in a later batch are promoted too.
        const windowStart=new Date(`${targetDay}T00:00:00.000Z`); windowStart.setUTCDate(windowStart.getUTCDate()-1);
        const promoteWindow=async(runId:string|null)=>{
          const promoted=await this.autoPromoteRun(connection,runId,process.env.SYSTEM_AUTO_EDITOR_ID ?? '01M4YDQK00ED1T0R0R1AND0VE1',configSha,tally,windowStart.toISOString().slice(0,10));
          this.logger.log(`Semantic automatic promotions: ${promoted}`);
        };
        if(subBatches.length===0) {
          // Nothing new to spend on, but earlier groups may now be complete.
          await promoteWindow(null);
          for (const [code,n] of Object.entries(tally.reasons)) count(code,n);
          if(tally.events>0) {
            this.lastRun=summary('PROMOTED_PENDING_GROUPS',{eventsPromoted:tally.events,contrastsPromoted:tally.contrasts,skipOrRejectReasons:{...reasons}});
            return 'PROMOTED_PENDING_GROUPS';
          }
          return this.skip(trigger,'NO_PENDING_MULTISOURCE_PAIRS');
        }
        const budget=new LiveSemanticCallBudget(SCHEDULED_CALL_BUDGET);
        type RunDetails=Partial<{runId:string;status:string;extracted:number;insufficientEvidence:number;rejectedOrUnavailable:number;pairAssessments:number;providerHalted:boolean}>;
        const results:RunDetails[]=[];
        for (const ids of subBatches) {
          if(!budget.available) break;
          // Each sub-batch caps its pending query at MAX_BATCH, so its run row
          // always satisfies requested_count<=5.
          results.push(await this.runLocked(connection,actor,targetDay,MAX_BATCH,configSha,[...ids],budget) as RunDetails);
        }
        const runIds=results.flatMap(r=>r.runId ? [r.runId] : []);
        await promoteWindow(runIds.at(-1) ?? null);
        const sum=(key:'extracted'|'insufficientEvidence'|'rejectedOrUnavailable'|'pairAssessments')=>results.reduce((t,r)=>t+(r[key] ?? 0),0);
        count('ARTICLE_NO_CLAIM_WORTHY_CONTENT',sum('insufficientEvidence'));
        count('ARTICLE_REJECTED_OR_UNAVAILABLE',sum('rejectedOrUnavailable'));
        const halted=results.some(r=>r.providerHalted);
        if(halted) count('PROVIDER_HALTED');
        if(!budget.available && !halted) count('CALL_BUDGET_EXHAUSTED');
        let groups=0;
        if(runIds.length>0) {
          const formed=await sql<{n:number}>`select count(*)::int as n from public.live_semantic_event_group_candidates where origin_run_id::text=any(${runIds}::text[])`.execute(connection);
          groups=formed.rows[0]?.n ?? 0;
          count('PAIR_NOT_SAME_EVENT',Math.max(0,sum('pairAssessments')-groups));
        }
        for (const [code,n] of Object.entries(tally.reasons)) count(code,n);
        const status=results.at(-1)?.status ?? 'NO_PENDING_ARTICLES';
        this.lastRun=summary(status,{
          subBatches:results.length,
          articlesProcessed:sum('extracted')+sum('insufficientEvidence'),
          modelCalls:budget.used,eventGroupsFormed:groups,
          eventsPromoted:tally.events,contrastsPromoted:tally.contrasts,skipOrRejectReasons:{...reasons},
        });
        this.logger.log(`Semantic scheduled model calls: ${budget.used}/${SCHEDULED_CALL_BUDGET}`);
        return status;
      } finally {await sql`select pg_advisory_unlock(hashtextextended(${'dialektik-live-semantic:'+targetDay},0))`.execute(connection);}
      } finally {await sql`select pg_advisory_unlock(hashtextextended('dialektik-live-semantic-automation',0))`.execute(connection);}
    });
  }

  private async autoPromoteRun(connection: Kysely<Database>, runId: string | null, actor: string, configSha: string,
    tally: AutoPromotionTally = new AutoPromotionTally(), windowStartDay?: string): Promise<number> {
    if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(actor)) throw new Error('SEMANTIC_AUTOMATION_ACTOR_INVALID');
    type Candidate = {
      groupId:string; title:string; pairId:string; relation:string; sameEvent:boolean;
      sameEventConfidence:number; ratioConflicting:number; ratioComparable:number;
      leftId:string; rightId:string; leftOrdinal:number; rightOrdinal:number;
      leftSource:string; rightSource:string; leftText:string; rightText:string;
      leftDate:Date; rightDate:Date; leftSpan:Record<string,unknown>; rightSpan:Record<string,unknown>;
    };
    const rows=await sql<Candidate>`select g.id::text as "groupId",g.proposed_title as title,
      p.id::text as "pairId",p.relation,p.same_event as "sameEvent",p.same_event_confidence as "sameEventConfidence",
      p.ratio_conflicting as "ratioConflicting",p.ratio_comparable as "ratioComparable",
      lm.article_id::text as "leftId",rm.article_id::text as "rightId",
      p.left_claim_ordinal as "leftOrdinal",p.right_claim_ordinal as "rightOrdinal",
      lm.source_id::text as "leftSource",rm.source_id::text as "rightSource",
      li.text_original as "leftText",ri.text_original as "rightText",li.published_at as "leftDate",ri.published_at as "rightDate",
      lg.proposal_payload->'spans'->(p.left_claim_ordinal-1) as "leftSpan",
      rg.proposal_payload->'spans'->(p.right_claim_ordinal-1) as "rightSpan"
      from public.live_semantic_event_group_candidates g
      join public.live_semantic_claim_pair_assessments p on p.group_id=g.id
      join public.live_semantic_event_group_members lm on lm.group_id=g.id and lm.article_id=p.left_article_id
      join public.live_semantic_event_group_members rm on rm.group_id=g.id and rm.article_id=p.right_article_id
      join public.assertion_extraction_generations lg on lg.id=lm.extraction_generation_id and lg.id=p.left_extraction_generation_id and lg.state='active'
      join public.assertion_extraction_generations rg on rg.id=rm.extraction_generation_id and rg.id=p.right_extraction_generation_id and rg.state='active'
      join public.live_semantic_excerpt_inputs li on li.article_id=lm.article_id::text and li.input_sha256=lg.input_hash
      join public.live_semantic_excerpt_inputs ri on ri.article_id=rm.article_id::text and ri.input_sha256=rg.input_hash
      where (g.origin_run_id=${runId}::dialektik_ulid or (${windowStartDay ?? null}::date is not null and g.target_day>=${windowStartDay ?? null}::date))
        and g.config_sha256=${configSha}
        and p.config_sha256=${stanceConfigSha256(configSha)} and lm.source_id<>rm.source_id
        and (select count(*) from public.live_semantic_event_group_members m where m.group_id=g.id)=2
        and not exists(select 1 from public.live_semantic_editorial_decisions d where d.group_id=g.id)
      order by g.id desc,p.ratio_comparable desc,p.id limit 120`.execute(connection);
    const tried=new Set<string>(); let published=0;
    for (const row of rows.rows) {
      if (tried.has(row.groupId)) continue;
      if (tried.size >= MAX_AUTO_PROMOTION_GROUPS) break;
      try {
        const article=(sourceId:string,textOriginal:string,publishedAt:Date,span:Record<string,unknown>) => ({
          sourceId,textOriginal,publishedAt,selectedQuote:String(span?.quoted_text ?? ''),
          start:Number(span?.start),end:Number(span?.end),
        });
        const assessment=validateAutoScope({sameEvent:row.sameEvent,sameEventConfidence:row.sameEventConfidence,
          relation:row.relation,ratioConflicting:row.ratioConflicting,ratioComparable:row.ratioComparable},
          article(row.leftSource,row.leftText,row.leftDate,row.leftSpan),article(row.rightSource,row.rightText,row.rightDate,row.rightSpan));
        const conflictIds=['DIVERGENT','CONTRADICTORY'].includes(assessment.relation) ? [row.pairId] : [];
        const commandId=generateUlid({now:Date.now});
        await this.moderationWriter.database.transaction().execute(async transaction=>{
          await setTransactionAuditContext(transaction,{action:'moderation_decision',actorId:parseUlid(actor),actorType:'editor',
            correlationId:commandId,reasonCode:'live_semantic_automatic_promotion',metadata:{decision_mode:'AUTO_ENGINE',semantic_group_id:row.groupId}});
          const claims=[{articleId:row.leftId,ordinal:row.leftOrdinal},{articleId:row.rightId,ordinal:row.rightOrdinal}];
          await sql`select public.dialektik_record_live_semantic_editorial_decision(
            ${row.groupId}::dialektik_ulid,${actor}::dialektik_ulid,${commandId}::dialektik_ulid,
            'APPROVED','AUTO_ENGINE: promoción automática de citas y evaluación verificadas',${row.title},
            ${JSON.stringify(claims)}::jsonb,${JSON.stringify(conflictIds)}::jsonb)`.execute(transaction);
          const result=await sql<{result:{status:string}}>`select public.dialektik_promote_live_semantic_event_group(
            ${row.groupId}::dialektik_ulid,${actor}::dialektik_ulid,${commandId}::dialektik_ulid) as result`.execute(transaction);
          if (result.rows[0]?.result.status!=='PROMOTED') throw new Error('AUTO_PROMOTION_REVIEW_REQUIRED');
        });
        tried.add(row.groupId);
        published++;
        tally.events++;
        if (conflictIds.length>0) tally.contrasts++;
      } catch (error) {
        // A group may have several claim pairs; the next pair is tried.
        const reason=safeReasonCode(error);
        tally.reject(reason);
        this.logger.warn(`Semantic automatic group not promoted: ${reason}`);
      }
    }
    return published;
  }

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
        stancePrompt: LIVE_STANCE_PAIR_PROMPT,
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
    const { targetDay, limit, articleIds } = parseSemanticBatchBody(raw);
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
        const result = await this.runLocked(
          connection,
          identity.userId,
          targetDay,
          limit,
          configSha,
          articleIds,
          new LiveSemanticCallBudget(25),
        );
        if ('runId' in result && result.runId) {
          const actor = process.env.SYSTEM_AUTO_EDITOR_ID ?? '01M4YDQK00ED1T0R0R1AND0VE1';
          const automaticPromotions = await this.autoPromoteRun(connection,result.runId,actor,configSha);
          return {...result, automaticPromotions};
        }
        return result;
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
    articleIds: string[],
    budget?: LiveSemanticCallBudget,
  ) {
    const pending = await sql<LiveExcerptInput>`
      select i.article_id as "articleId",i.source_id as "sourceId",i.event_id as "eventId",
        i.url_canonical as "canonicalUrl",i.text_original as "textOriginal",i.published_at as "publishedAt",
        i.source_name as "sourceName",i.version_id as "versionId",i.headline,i.excerpt,
        i.policy_id as "policyId",i.input_sha256 as "inputSha256"
      from public.live_semantic_excerpt_inputs i
      where (i.published_at at time zone 'America/Santiago')::date>=${targetDay}::date
        and (${articleIds.length}::int=0 or i.article_id=any(${articleIds}::text[]))
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
        and (${articleIds.length}::int=0 or i.article_id=any(${articleIds}::text[]))
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
        budget?.request,
        process.env,
        LIVE_CLAIM_EXTRACTION_PROMPT,
      );
      pairTransport = new CloudflareWorkersAITransport(
        profile,
        budget?.request,
        process.env,
        LIVE_PAIR_ASSESSMENT_PROMPT,
      );
      stanceTransport = new CloudflareWorkersAITransport(
        profile,
        budget?.request,
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
        if(budget && !budget.available) break;
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
        articleIds,
        budget,
      );
      const claimPairAssessment = await this.assessGroupClaims(
        connection,
        runId,
        targetDay,
        configSha,
        pairTransport,
        articleIds,
        budget,
      );
      const stanceAssessment = await this.reassessClaimPairs(
        connection, runId, requestedBy, targetDay, configSha, stanceTransport, articleIds, budget,
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
        modelCalls: budget?.used ?? null,
        providerHalted: budget?.providerHalted ?? false,
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
    articleIds: string[] | null = [],
    budget?: LiveSemanticCallBudget,
  ): Promise<number> {
    articleIds ??= [];
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
      if(budget && !budget.available) break;
      if (articleIds.length > 0 && !articleIds.includes(pair.left.articleId) && !articleIds.includes(pair.right.articleId)) continue;
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
    articleIds: string[],
    budget?: LiveSemanticCallBudget,
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
        and (${articleIds.length}::int=0 or exists(select 1 from public.live_semantic_event_group_members selected where selected.group_id=group_row.id and selected.article_id::text=any(${articleIds}::text[])))
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
          if ((budget && !budget.available) || attempted >= MAX_ORIGINAL_CLAIM_PAIR_ASSESSMENTS)
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
    configSha: string, transport: CloudflareWorkersAITransport, articleIds: string[] | null = [],
    budget?: LiveSemanticCallBudget,
  ): Promise<{ attempted: number; validated: number; invalid: number; unavailable: number }> {
    articleIds ??= [];
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
          and (${articleIds.length}::int=0 or exists(select 1 from public.live_semantic_event_group_members selected where selected.group_id=group_row.id and selected.article_id::text=any(${articleIds}::text[])))
          and old.config_sha256=${configSha}
          and not exists(select 1 from public.live_semantic_stance_pair_attempts attempt
            where attempt.original_pair_id=old.id and attempt.config_sha256=${stanceConfig})
        -- Cross-source claims are needed for promotion; same-article pairs
        -- should not exhaust the bounded reassessment queue first.
        order by (old.left_article_id=old.right_article_id),old.created_at,old.id limit ${MAX_STANCE_PAIR_ASSESSMENTS}
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
      order by (old.left_article_id=old.right_article_id),old.created_at,old.id`.execute(connection);
    const totals = { attempted: 0, validated: 0, invalid: 0, unavailable: 0 };
    for (const row of rows.rows) {
      if(budget && !budget.available) break;
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
    if (groups.rows.length > 0) {
      const groupIdFilter = sql.join(
        groups.rows.map((group) => sql`${group.id}::dialektik_ulid`),
      );
      const [members, pairs, claimPairs] = await Promise.all([
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
      ]);
      memberRows = members.rows;
      pairRows = pairs.rows;
      claimPairRows = claimPairs.rows;
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
