import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { generateUlid, parseUlid, type Database, type SourceType } from '@dialektik/database';
import { sql, type Transaction } from 'kysely';
import { createHash } from 'node:crypto';
import {
  OFFICIAL_VOTE_ADAPTER_VERSION,
  OFFICIAL_VOTE_DETAIL_BASE_URL,
  OFFICIAL_VOTE_MAX_RESPONSE_BYTES,
  parseOfficialVoteDetail,
  readBoundedResponse,
} from './official-vote.adapter.js';
import { CORE_API_CONFIG, type CoreApiConfig } from '../config/core-api-config.js';
import { CoreDatabaseService } from '../database/core-database.service.js';
import { emptyLiveSyncSummary, syncLivePayload } from '../live/live.sync.js';
import type { LiveSourcePolicy } from '../live/live.registry.js';
import {
  FROZEN_NORMALIZATION_VERSION,
  normalizeFrozenFields,
  sha256Bytes,
} from '../ephemeral/ephemeral.normalization.js';
import {
  CLOUDFLARE_GPT_OSS_20B_MODEL,
  CLOUDFLARE_SUPPORTED_MODELS,
} from '../llm-shadow/llm.cloudflare-config.js';
import {
  DISABLED_PERSONAL_OWNER_JOB_DISPATCHER,
  GuardedPersonalOwnerFeedReader,
  PersonalOwnerFeedReadFailure,
  PERSONAL_OWNER_FEED_READER,
  PERSONAL_OWNER_JOB_DISPATCHER,
  type PersonalOwnerFeedReader,
  type PersonalOwnerFeedReadResult,
  type PersonalOwnerJobDispatcher,
} from './personal-owner-operational.adapters.js';

const RIGHTS_KEYS = [
  'acquisition',
  'metadata_storage',
  'excerpt_storage',
  'fulltext_acquisition',
  'fulltext_persistence',
  'external_ai_transmission',
  'derived_semantic_persistence',
  'redisplay',
] as const;
const WORKERS_FREE_DAILY_NEURON_CAP = 8_000;
const PERSONAL_OWNER_DAILY_REQUEST_NEURON_CAP = 1_500;
const PERSONAL_OWNER_REQUEST_BYTE_LIMIT = 65_536;
const PERSONAL_OWNER_OUTPUT_TOKEN_LIMIT = 4_096;
const SOURCE_POLL_MIN_SECONDS = 300;
const SOURCE_POLL_MAX_SECONDS = 3_600;
const SOURCE_POLL_TICK_MS = 30_000;
type RightsKey = (typeof RIGHTS_KEYS)[number];
type RightsScope = Record<RightsKey, boolean>;
type RecordValue = Record<string, unknown>;

const OBJECT = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function requiredText(record: RecordValue, key: string, max: number): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new BadRequestException(`INVALID_${key.toUpperCase()}`);
  return value.trim();
}

function dateValue(value: unknown, key: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new BadRequestException(`INVALID_${key.toUpperCase()}`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new BadRequestException(`INVALID_${key.toUpperCase()}`);
  return parsed;
}

function parseScopes(value: unknown): RightsScope {
  if (!OBJECT(value) || Object.keys(value).length !== RIGHTS_KEYS.length)
    throw new BadRequestException('INVALID_RIGHTS_SCOPES');
  const result = {} as RightsScope;
  for (const key of RIGHTS_KEYS) {
    if (typeof value[key] !== 'boolean') throw new BadRequestException('INVALID_RIGHTS_SCOPES');
    result[key] = value[key];
  }
  return result;
}

function isDecisionEffective(
  status: string | null,
  validFrom: Date | null,
  expiresAt: Date | null,
  now: Date,
  expectedStatus = 'AUTHORIZED',
): boolean {
  return (
    status === expectedStatus &&
    validFrom !== null &&
    validFrom <= now &&
    (expiresAt === null || expiresAt > now)
  );
}

function deniedRights(): RightsScope {
  return Object.fromEntries(RIGHTS_KEYS.map((key) => [key, false])) as RightsScope;
}

function parseRestrictions(value: unknown): RecordValue {
  if (value === undefined) return {};
  if (!OBJECT(value) || Object.keys(value).length > 32)
    throw new BadRequestException('INVALID_RESTRICTIONS');
  for (const [key, item] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/u.test(key) || typeof item !== 'string' || item.length > 500)
      throw new BadRequestException('INVALID_RESTRICTIONS');
  }
  return value;
}

function requireHash(value: unknown, key: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value))
    throw new BadRequestException(`INVALID_${key.toUpperCase()}`);
  return value;
}

function parseMicrousd(value: unknown, key: string, allowZero = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value > 2_000_000_000 ||
    value < (allowZero ? 0 : 1)
  )
    throw new BadRequestException(`INVALID_${key.toUpperCase()}`);
  return value;
}

@Injectable()
export class PersonalOwnerOperationalService implements OnModuleInit, OnModuleDestroy {
  private sourcePollTimer: ReturnType<typeof setInterval> | undefined;
  private sourcePollInFlight = false;
  constructor(
    @Inject(CORE_API_CONFIG) private readonly config: Readonly<CoreApiConfig>,
    @Inject(CoreDatabaseService) private readonly database: CoreDatabaseService,
    @Inject('PERSONAL_OWNER_CLOCK') private readonly now: () => Date,
    @Optional()
    @Inject(PERSONAL_OWNER_FEED_READER)
    private readonly feedReader?: PersonalOwnerFeedReader,
    @Optional()
    @Inject(PERSONAL_OWNER_JOB_DISPATCHER)
    private readonly dispatcher?: PersonalOwnerJobDispatcher,
  ) {}

  onModuleInit(): void {
    if (
      process.env.DIALEKTIK_PERSONAL_OWNER_ACQUISITION_MODE !== 'live' ||
      this.config.ownershipMode !== 'personal' ||
      this.config.semanticMode !== 'unassigned'
    )
      return;
    this.sourcePollTimer = setInterval(() => {
      void this.pollOneDueSource().catch(() => undefined);
    }, SOURCE_POLL_TICK_MS);
    this.sourcePollTimer.unref();
    void this.pollOneDueSource().catch(() => undefined);
  }

  onModuleDestroy(): void {
    if (this.sourcePollTimer) clearInterval(this.sourcePollTimer);
  }

  private get activeFeedReader(): PersonalOwnerFeedReader {
    return this.feedReader ?? new GuardedPersonalOwnerFeedReader();
  }

  private get activeDispatcher(): PersonalOwnerJobDispatcher {
    return this.dispatcher ?? DISABLED_PERSONAL_OWNER_JOB_DISPATCHER;
  }

  private assertOwnerMode(): string {
    if (
      this.config.ownershipMode !== 'personal' ||
      !this.config.personalOwnerId ||
      this.config.semanticMode !== 'unassigned'
    )
      throw new ServiceUnavailableException('PERSONAL_OWNER_MODE_NOT_ACTIVE');
    return this.config.personalOwnerId;
  }

  private async appendJobEvent(
    tx: Transaction<Database>,
    jobId: string,
    state:
      | 'BLOCKED'
      | 'PENDING'
      | 'RUNNING'
      | 'PROVIDER_REQUEST_STARTED'
      | 'RECOVERED_PENDING'
      | 'RECONCILIATION_REQUIRED'
      | 'COMPLETED'
      | 'FAILED'
      | 'CANCELLED',
    errorCategory: string | null = null,
  ): Promise<void> {
    const latest = await tx
      .selectFrom('personal_owner_operational_job_events')
      .select('sequence_number')
      .where('job_id', '=', parseUlid(jobId))
      .orderBy('sequence_number', 'desc')
      .executeTakeFirst();
    const recordedAt = this.now().toISOString();
    await tx
      .insertInto('personal_owner_operational_job_events')
      .values({
        id: generateUlid({ now: () => Date.parse(recordedAt) }),
        job_id: parseUlid(jobId),
        sequence_number: (latest?.sequence_number ?? 0) + 1,
        state,
        error_category: errorCategory,
        recorded_at: recordedAt,
      })
      .execute();
  }

  private async releaseReservation(
    tx: Transaction<Database>,
    jobId: string,
    state: 'RELEASED' | 'RECONCILIATION_REQUIRED',
  ): Promise<void> {
    const reservation = await tx
      .selectFrom('personal_owner_budget_reservations')
      .selectAll()
      .where('job_id', '=', parseUlid(jobId))
      .forUpdate()
      .executeTakeFirst();
    if (reservation?.state !== 'RESERVED') return;
    const recordedAt = this.now().toISOString();
    await tx
      .updateTable('personal_owner_budget_reservations')
      .set({
        state,
        updated_at: recordedAt,
      })
      .where('id', '=', reservation.id)
      .execute();
    await tx
      .insertInto('personal_owner_budget_events')
      .values({
        id: generateUlid({ now: () => Date.parse(recordedAt) }),
        reservation_id: reservation.id,
        event_type: state,
        reserved_microusd: reservation.reserved_microusd,
        actual_microusd: null,
        recorded_at: recordedAt,
      })
      .execute();
  }

  private async releaseNeuronReservation(
    tx: Transaction<Database>,
    jobId: string,
    state: 'RELEASED' | 'RECONCILIATION_REQUIRED',
  ): Promise<void> {
    const reservation = await tx
      .selectFrom('personal_owner_neuron_reservations')
      .selectAll()
      .where('job_id', '=', parseUlid(jobId))
      .forUpdate()
      .executeTakeFirst();
    if (reservation?.state !== 'RESERVED') return;
    const recordedAt = this.now().toISOString();
    await tx
      .updateTable('personal_owner_neuron_reservations')
      .set({ state, updated_at: recordedAt })
      .where('id', '=', reservation.id)
      .execute();
    await tx
      .insertInto('personal_owner_neuron_events')
      .values({
        id: generateUlid({ now: () => Date.parse(recordedAt) }),
        reservation_id: reservation.id,
        event_type: state,
        reserved_neurons: reservation.reserved_neurons,
        actual_neurons: null,
        recorded_at: recordedAt,
      })
      .execute();
  }

  private async cancelQueuedJobs(options: {
    readonly sourceId?: string;
    readonly modelId?: string;
    readonly reason: string;
  }): Promise<number> {
    const owner = this.assertOwnerMode();
    return this.database.database.transaction().execute(async (tx) => {
      let query = tx
        .selectFrom('personal_owner_operational_jobs')
        .selectAll()
        .where('owner_identity', '=', owner)
        .where('state', '=', 'PENDING');
      if (options.sourceId) query = query.where('source_id', '=', parseUlid(options.sourceId));
      if (options.modelId) query = query.where('model_id', '=', options.modelId);
      const jobs = await query.orderBy('created_at').forUpdate().execute();
      for (const job of jobs) {
        const recordedAt = this.now().toISOString();
        await tx
          .updateTable('personal_owner_operational_jobs')
          .set({
            state: 'CANCELLED',
            blocked_reason: null,
            updated_at: recordedAt,
            completed_at: recordedAt,
          })
          .where('id', '=', job.id)
          .execute();
        await this.releaseReservation(tx, String(job.id), 'RELEASED');
        await this.releaseNeuronReservation(tx, String(job.id), 'RELEASED');
        await this.appendJobEvent(tx, String(job.id), 'CANCELLED', options.reason);
        await tx
          .insertInto('personal_owner_audit_events')
          .values({
            id: generateUlid({ now: () => Date.parse(recordedAt) }),
            owner_identity: owner,
            event_type: 'OPERATIONAL_JOB_CANCELLED',
            request_fingerprint_sha256: sha256(
              `${owner}\nOPERATIONAL_JOB_CANCELLED\n${job.id}\n${options.reason}`,
            ),
            recorded_at: recordedAt,
          })
          .execute();
      }
      return jobs.length;
    });
  }

  async sources() {
    this.assertOwnerMode();
    const now = this.now();
    const result = await sql<{
      source_id: string;
      name: string;
      canonical_domain: string;
      created_at: Date;
      decision_id: string | null;
      decision_status: string | null;
      publisher_identity: string | null;
      acquisition_method: string | null;
      rights_evidence_url: string | null;
      attribution: string | null;
      restrictions: RecordValue | null;
      scopes: RightsScope | null;
      valid_from: Date | null;
      expires_at: Date | null;
      decision_provenance: string | null;
      local_processing: boolean | null;
      acquisition_endpoint: string | null;
      legacy_policy: RecordValue | null;
    }>`
      select s.id as source_id, s.name, s.canonical_domain, s.created_at,
        d.id as decision_id, d.decision_status, d.publisher_identity, d.acquisition_method,
        d.rights_evidence_url, d.attribution, d.restrictions, d.scopes,
        d.valid_from, d.expires_at, d.decision_provenance, d.local_processing,
        connection.endpoint as acquisition_endpoint, lp.policy as legacy_policy
      from sources s
      left join lateral (
        select * from personal_owner_source_rights_decisions
        where source_id = s.id order by sequence_number desc limit 1
      ) d on true
      left join lateral (
        select policy from live_source_policies
        where source_id = s.id order by recorded_at desc, id desc limit 1
      ) lp on true
      left join lateral (
        select endpoint from personal_owner_source_connections
        where source_id = s.id order by sequence_number desc limit 1
      ) connection on true
      order by lower(s.name), s.id
    `.execute(this.database.database);
    return {
      items: result.rows.map((row) => {
        const effective = isDecisionEffective(
          row.decision_status,
          row.valid_from,
          row.expires_at,
          now,
        );
        return {
          id: row.source_id,
          publisher: row.name,
          domain: row.canonical_domain,
          created_at: row.created_at,
          authorization:
            row.decision_id === null
              ? 'UNVERIFIED'
              : row.decision_status === 'AUTHORIZED' && !effective
                ? 'EXPIRED_OR_NOT_YET_VALID'
                : row.decision_status,
          rights: effective
            ? { ...(row.scopes ?? deniedRights()), local_processing: row.local_processing === true }
            : { ...deniedRights(), local_processing: false },
          acquisition_method: row.acquisition_method,
          evidence_url: row.rights_evidence_url,
          attribution: row.attribution,
          restrictions: row.restrictions ?? {},
          valid_from: row.valid_from,
          expires_at: row.expires_at,
          decision_provenance: row.decision_provenance,
          acquisition_endpoint: row.acquisition_endpoint,
          acquisition_available:
            row.acquisition_endpoint !== null && effective && row.scopes?.acquisition === true,
          established_live_policy:
            row.legacy_policy === null
              ? null
              : {
                  rights_class: row.legacy_policy.rightsClass,
                  storage_policy: row.legacy_policy.storagePolicy,
                  active: row.legacy_policy.active,
                  evidence_url: row.legacy_policy.rightsEvidenceUrl,
                  attribution: row.legacy_policy.attribution,
                  acquisition_method: row.legacy_policy.discoveryChannel,
                },
        };
      }),
      acquisition_execution:
        process.env.DIALEKTIK_PERSONAL_OWNER_ACQUISITION_MODE === 'live'
          ? 'EXPLICITLY_ENABLED'
          : 'DISABLED_PENDING_SEPARATE_ACTIVATION',
    };
  }

  async registerSource(value: unknown) {
    const owner = this.assertOwnerMode();
    if (!OBJECT(value)) throw new BadRequestException('INVALID_SOURCE');
    const name = requiredText(value, 'publisher_name', 200);
    const domain = requiredText(value, 'canonical_domain', 253).toLowerCase();
    const sourceTypeValue = value.source_type ?? 'other';
    const sourceTypes: readonly SourceType[] = [
      'official_statistics',
      'wire_agency',
      'daily_newspaper',
      'digital_native',
      'radio',
      'tv',
      'other',
    ];
    if (typeof sourceTypeValue !== 'string' || !sourceTypes.includes(sourceTypeValue as SourceType))
      throw new BadRequestException('INVALID_SOURCE_TYPE');
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(domain))
      throw new BadRequestException('INVALID_CANONICAL_DOMAIN');
    const endpointValue = value.rss_atom_endpoint;
    let endpoint: string | null = null;
    if (endpointValue !== undefined && endpointValue !== null && endpointValue !== '') {
      if (typeof endpointValue !== 'string' || endpointValue.length > 2048)
        throw new BadRequestException('INVALID_RSS_ATOM_ENDPOINT');
      let parsed: URL;
      try {
        parsed = new URL(endpointValue);
      } catch {
        throw new BadRequestException('INVALID_RSS_ATOM_ENDPOINT');
      }
      if (
        parsed.protocol !== 'https:' ||
        parsed.username ||
        parsed.password ||
        parsed.hostname.toLowerCase() !== domain
      )
        throw new BadRequestException('INVALID_RSS_ATOM_ENDPOINT');
      endpoint = parsed.toString();
    }
    const rawDomains = value.allowed_article_domains;
    const articleDomains =
      rawDomains === undefined
        ? [domain]
        : Array.isArray(rawDomains) && rawDomains.length >= 1 && rawDomains.length <= 8
          ? rawDomains.map((item) => {
              if (typeof item !== 'string')
                throw new BadRequestException('INVALID_ARTICLE_DOMAINS');
              const normalized = item.toLowerCase().trim();
              if (
                !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
                  normalized,
                ) ||
                (normalized !== domain && !normalized.endsWith(`.${domain}`))
              )
                throw new BadRequestException('INVALID_ARTICLE_DOMAINS');
              return normalized;
            })
          : (() => {
              throw new BadRequestException('INVALID_ARTICLE_DOMAINS');
            })();
    const recordedAt = this.now().toISOString();
    const sourceId = generateUlid({ now: () => Date.parse(recordedAt) });
    await this.database.database.transaction().execute(async (tx) => {
      await tx
        .insertInto('sources')
        .values({
          id: sourceId,
          name,
          source_type: sourceTypeValue as SourceType,
          is_issuing_entity: false,
          canonical_domain: domain,
          origin: 'LIVE_REAL',
          created_at: recordedAt,
        })
        .execute();
      await tx
        .insertInto('personal_owner_audit_events')
        .values({
          id: generateUlid({ now: () => Date.parse(recordedAt) + 1 }),
          owner_identity: owner,
          event_type: 'SOURCE_REGISTERED',
          request_fingerprint_sha256: sha256(
            `${owner}\nSOURCE_REGISTERED\n${sourceId}\n${recordedAt}`,
          ),
          recorded_at: recordedAt,
        })
        .execute();
      if (endpoint !== null) {
        await tx
          .insertInto('personal_owner_source_connections')
          .values({
            id: generateUlid({ now: () => Date.parse(recordedAt) + 2 }),
            owner_identity: owner,
            source_id: sourceId,
            sequence_number: 1,
            discovery_channel: 'rss_atom',
            endpoint,
            allowed_article_domains: JSON.stringify(articleDomains),
            recorded_at: recordedAt,
          })
          .execute();
        await tx
          .insertInto('personal_owner_audit_events')
          .values({
            id: generateUlid({ now: () => Date.parse(recordedAt) + 3 }),
            owner_identity: owner,
            event_type: 'SOURCE_CONNECTION_RECORDED',
            request_fingerprint_sha256: sha256(
              `${owner}\nSOURCE_CONNECTION_RECORDED\n${sourceId}\n${endpoint}\n${recordedAt}`,
            ),
            recorded_at: recordedAt,
          })
          .execute();
      }
    });
    return {
      id: sourceId,
      publisher: name,
      domain,
      authorization: 'UNVERIFIED' as const,
      acquisition_endpoint: endpoint,
      acquisition_enabled: false,
    };
  }

  async recordRightsDecision(sourceIdValue: string, value: unknown) {
    const owner = this.assertOwnerMode();
    const sourceId = parseUlid(sourceIdValue);
    if (!OBJECT(value)) throw new BadRequestException('INVALID_RIGHTS_DECISION');
    const publisherIdentity = requiredText(value, 'publisher_identity', 200);
    const acquisitionMethod = requiredText(value, 'acquisition_method', 32);
    if (!['RSS_ATOM', 'OFFICIAL_API', 'OWNER_PROVIDED', 'OTHER'].includes(acquisitionMethod))
      throw new BadRequestException('INVALID_ACQUISITION_METHOD');
    const decisionStatus = requiredText(value, 'decision_status', 16);
    if (!['UNVERIFIED', 'AUTHORIZED', 'SUSPENDED', 'REVOKED'].includes(decisionStatus))
      throw new BadRequestException('INVALID_DECISION_STATUS');
    const scopes = parseScopes(value.scopes);
    if (decisionStatus === 'UNVERIFIED' && Object.values(scopes).some((enabled) => enabled))
      throw new BadRequestException('UNVERIFIED_RIGHTS_MUST_BE_DENIED');
    const localProcessing = value.local_processing === true;
    if (decisionStatus === 'UNVERIFIED' && localProcessing)
      throw new BadRequestException('UNVERIFIED_RIGHTS_MUST_BE_DENIED');
    const evidenceUrl = value.rights_evidence_url;
    const evidenceHash = value.rights_evidence_sha256;
    const attribution = value.attribution;
    if (decisionStatus === 'AUTHORIZED') {
      if (
        typeof evidenceUrl !== 'string' ||
        !evidenceUrl.startsWith('https://') ||
        evidenceUrl.length > 2048
      )
        throw new BadRequestException('RIGHTS_EVIDENCE_URL_REQUIRED');
      requireHash(evidenceHash, 'rights_evidence_sha256');
      if (typeof attribution !== 'string' || !attribution.trim() || attribution.length > 1000)
        throw new BadRequestException('ATTRIBUTION_REQUIRED');
    }
    const validFrom = dateValue(value.valid_from, 'valid_from') ?? this.now();
    const expiresAt = dateValue(value.expires_at, 'expires_at');
    const recordedAt = this.now().toISOString();
    if (validFrom.getTime() > Date.parse(recordedAt) || (expiresAt && expiresAt <= validFrom))
      throw new BadRequestException('INVALID_RIGHTS_VALIDITY');

    const decision = await this.database.database.transaction().execute(async (tx) => {
      const source = await tx
        .selectFrom('sources')
        .select(['id', 'name'])
        .where('id', '=', sourceId)
        .forUpdate()
        .executeTakeFirst();
      if (!source) throw new NotFoundException('SOURCE_NOT_FOUND');
      const latest = await tx
        .selectFrom('personal_owner_source_rights_decisions')
        .select('sequence_number')
        .where('source_id', '=', sourceId)
        .orderBy('sequence_number', 'desc')
        .executeTakeFirst();
      const id = generateUlid({ now: () => Date.parse(recordedAt) });
      await tx
        .insertInto('personal_owner_source_rights_decisions')
        .values({
          id,
          owner_identity: owner,
          source_id: sourceId,
          sequence_number: (latest?.sequence_number ?? 0) + 1,
          publisher_identity: publisherIdentity,
          acquisition_method: acquisitionMethod as
            | 'RSS_ATOM'
            | 'OFFICIAL_API'
            | 'OWNER_PROVIDED'
            | 'OTHER',
          rights_evidence_url:
            typeof evidenceUrl === 'string' && evidenceUrl.trim() ? evidenceUrl.trim() : null,
          rights_evidence_sha256:
            typeof evidenceHash === 'string' && evidenceHash.trim() ? evidenceHash : null,
          scopes,
          local_processing: localProcessing,
          attribution:
            typeof attribution === 'string' && attribution.trim() ? attribution.trim() : null,
          restrictions: parseRestrictions(value.restrictions),
          decision_status: decisionStatus as 'UNVERIFIED' | 'AUTHORIZED' | 'SUSPENDED' | 'REVOKED',
          decision_provenance: 'PERSONAL_OWNER_BEARER_WORKFLOW',
          valid_from: validFrom.toISOString(),
          expires_at: expiresAt?.toISOString() ?? null,
          recorded_at: recordedAt,
        })
        .execute();
      await tx
        .insertInto('personal_owner_audit_events')
        .values({
          id: generateUlid({ now: () => Date.parse(recordedAt) + 1 }),
          owner_identity: owner,
          event_type: 'RIGHTS_DECISION_RECORDED',
          request_fingerprint_sha256: sha256(
            `${owner}\nRIGHTS_DECISION\n${sourceId}\n${id}\n${decisionStatus}`,
          ),
          recorded_at: recordedAt,
        })
        .execute();
      return { id, source_id: sourceId, publisher: source.name, decision_status: decisionStatus };
    });
    if (decisionStatus !== 'AUTHORIZED') {
      this.activeDispatcher.cancelSource(sourceId);
      await this.cancelQueuedJobs({ sourceId, reason: 'SOURCE_RIGHTS_REVOKED' });
    }
    return decision;
  }

  async recordSourceConnection(sourceIdValue: string, value: unknown) {
    const owner = this.assertOwnerMode();
    const sourceId = parseUlid(sourceIdValue);
    if (!OBJECT(value)) throw new BadRequestException('INVALID_SOURCE_CONNECTION');
    const source = await this.database.database
      .selectFrom('sources')
      .select(['canonical_domain'])
      .where('id', '=', sourceId)
      .executeTakeFirst();
    if (!source) throw new NotFoundException('SOURCE_NOT_FOUND');
    const endpointValue = requiredText(value, 'rss_atom_endpoint', 2048);
    let endpoint: URL;
    try {
      endpoint = new URL(endpointValue);
    } catch {
      throw new BadRequestException('INVALID_RSS_ATOM_ENDPOINT');
    }
    if (
      endpoint.protocol !== 'https:' ||
      endpoint.username ||
      endpoint.password ||
      endpoint.hostname.toLowerCase() !== source.canonical_domain
    )
      throw new BadRequestException('INVALID_RSS_ATOM_ENDPOINT');
    const rawDomains = value.allowed_article_domains;
    const domains =
      rawDomains === undefined
        ? [source.canonical_domain]
        : Array.isArray(rawDomains) && rawDomains.length >= 1 && rawDomains.length <= 8
          ? rawDomains.map((raw) => {
              if (typeof raw !== 'string') throw new BadRequestException('INVALID_ARTICLE_DOMAINS');
              const domain = raw.trim().toLowerCase();
              if (
                !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
                  domain,
                ) ||
                (domain !== source.canonical_domain &&
                  !domain.endsWith(`.${source.canonical_domain}`))
              )
                throw new BadRequestException('INVALID_ARTICLE_DOMAINS');
              return domain;
            })
          : (() => {
              throw new BadRequestException('INVALID_ARTICLE_DOMAINS');
            })();
    const recordedAt = this.now().toISOString();
    const connection = await this.database.database.transaction().execute(async (tx) => {
      await tx
        .selectFrom('sources')
        .select('id')
        .where('id', '=', sourceId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const previous = await tx
        .selectFrom('personal_owner_source_connections')
        .select('sequence_number')
        .where('source_id', '=', sourceId)
        .orderBy('sequence_number', 'desc')
        .executeTakeFirst();
      const id = generateUlid({ now: () => Date.parse(recordedAt) });
      await tx
        .insertInto('personal_owner_source_connections')
        .values({
          id,
          owner_identity: owner,
          source_id: sourceId,
          sequence_number: (previous?.sequence_number ?? 0) + 1,
          discovery_channel: 'rss_atom',
          endpoint: endpoint.toString(),
          allowed_article_domains: JSON.stringify(domains),
          recorded_at: recordedAt,
        })
        .execute();
      await tx
        .insertInto('personal_owner_audit_events')
        .values({
          id: generateUlid({ now: () => Date.parse(recordedAt) + 1 }),
          owner_identity: owner,
          event_type: 'SOURCE_CONNECTION_RECORDED',
          request_fingerprint_sha256: sha256(
            `${owner}\nSOURCE_CONNECTION_RECORDED\n${sourceId}\n${id}\n${recordedAt}`,
          ),
          recorded_at: recordedAt,
        })
        .execute();
      return {
        id,
        endpoint: endpoint.toString(),
        sequence_number: (previous?.sequence_number ?? 0) + 1,
      };
    });
    return { source_id: sourceId, ...connection, acquisition_enabled: false };
  }

  private async assertCurrentSourceRights(
    tx: Transaction<Database>,
    sourceId: string,
    decisionId: string,
    requiredScopes: readonly RightsKey[],
    requireLocalProcessing = false,
  ): Promise<void> {
    await tx
      .selectFrom('prospective_content_rights_write_guards')
      .select('source_id')
      .where('source_id', '=', parseUlid(sourceId))
      .forUpdate()
      .executeTakeFirstOrThrow();
    const row = await tx
      .selectFrom('personal_owner_source_rights_decisions')
      .selectAll()
      .where('source_id', '=', parseUlid(sourceId))
      .orderBy('sequence_number', 'desc')
      .executeTakeFirst();
    const scopes = row?.scopes as RightsScope | undefined;
    const now = this.now();
    if (
      row?.id !== decisionId ||
      row.decision_status !== 'AUTHORIZED' ||
      !isDecisionEffective(row.decision_status, row.valid_from, row.expires_at, now) ||
      requiredScopes.some((scope) => scopes?.[scope] !== true) ||
      (requireLocalProcessing && !row.local_processing)
    )
      throw new ConflictException('SOURCE_RIGHTS_NOT_AUTHORIZED');
  }

  private async ensureExcerptContentPolicy(
    sourceId: string,
    decision: Readonly<{
      id: string;
      valid_from: Date;
      rights_evidence_url: string | null;
      rights_evidence_sha256: string | null;
      scopes: RightsScope;
      local_processing: boolean;
    }>,
  ): Promise<string> {
    if (
      !decision.scopes.metadata_storage ||
      !decision.scopes.excerpt_storage ||
      !decision.local_processing ||
      !decision.scopes.derived_semantic_persistence ||
      !decision.rights_evidence_url ||
      !decision.rights_evidence_sha256
    )
      throw new ConflictException('EXCERPT_PROCESSING_RIGHTS_NOT_AUTHORIZED');
    const policy = {
      sourceId,
      rightsDecisionId: decision.id,
      accessMode: 'EXCERPT_EPHEMERAL',
      metadataStorage: true,
      excerptStorage: true,
      localProcessing: true,
      externalAiTransmission: decision.scopes.external_ai_transmission,
      derivedSemanticPersistence: true,
      redisplay: decision.scopes.redisplay,
      evidenceHash: decision.rights_evidence_sha256,
    };
    const policyId = sha256(JSON.stringify(policy));
    const recordedAt = this.now().toISOString();
    await this.database.database
      .insertInto('content_access_policies')
      .values({
        id: policyId,
        source_id: parseUlid(sourceId),
        content_access_mode: 'EXCERPT_EPHEMERAL',
        metadata_storage: true,
        excerpt_storage: true,
        fulltext_acquisition: false,
        fulltext_machine_processing: false,
        fulltext_persistence: false,
        derived_semantic_persistence: true,
        minimal_evidence_fragment: false,
        redisplay: decision.scopes.redisplay,
        external_source_link: decision.scopes.redisplay,
        local_processing: true,
        external_ai_transmission: decision.scopes.external_ai_transmission,
        rights_evidence_sha256: decision.rights_evidence_sha256,
        personal_owner_source_rights_decision_id: parseUlid(decision.id),
        evidence_quote_max_codepoints: 0,
        rights_evidence_url: decision.rights_evidence_url,
        rights_verified_at: decision.valid_from,
        recorded_at: recordedAt,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute();
    return policyId;
  }

  private async recordPollSuccess(args: {
    readonly owner: string;
    readonly sourceId: string;
    readonly response: PersonalOwnerFeedReadResult;
    readonly changed: boolean;
  }): Promise<void> {
    const sourceId = parseUlid(args.sourceId);
    const prior = await this.database.database
      .selectFrom('personal_owner_source_poll_state')
      .selectAll()
      .where('source_id', '=', sourceId)
      .executeTakeFirst();
    const now = this.now();
    const interval = args.changed
      ? SOURCE_POLL_MIN_SECONDS
      : Math.min(
          SOURCE_POLL_MAX_SECONDS,
          Math.max(
            SOURCE_POLL_MIN_SECONDS,
            Math.ceil((prior?.poll_interval_seconds ?? SOURCE_POLL_MIN_SECONDS) * 1.5),
          ),
        );
    const retryDelay =
      args.response.retryAfterMs === null
        ? interval
        : Math.max(interval, Math.min(86_400, Math.ceil(args.response.retryAfterMs / 1000)));
    const recordedAt = now.toISOString();
    const nextPollAt = new Date(now.getTime() + retryDelay * 1000).toISOString();
    const etag =
      args.response.status === 304
        ? (args.response.etag ?? prior?.etag ?? null)
        : args.response.etag;
    const lastModified =
      args.response.status === 304
        ? (args.response.lastModified ?? prior?.last_modified ?? null)
        : args.response.lastModified;
    await this.database.database
      .insertInto('personal_owner_source_poll_state')
      .values({
        source_id: sourceId,
        owner_identity: args.owner,
        etag,
        last_modified: lastModified,
        poll_interval_seconds: interval,
        consecutive_failures: 0,
        last_http_status: args.response.status,
        last_polled_at: recordedAt,
        last_success_at: recordedAt,
        next_poll_at: nextPollAt,
        lease_until: null,
        updated_at: recordedAt,
      })
      .onConflict((conflict) =>
        conflict.column('source_id').doUpdateSet({
          owner_identity: args.owner,
          etag,
          last_modified: lastModified,
          poll_interval_seconds: interval,
          consecutive_failures: 0,
          last_http_status: args.response.status,
          last_polled_at: recordedAt,
          last_success_at: recordedAt,
          next_poll_at: nextPollAt,
          lease_until: null,
          updated_at: recordedAt,
        }),
      )
      .execute();
  }

  private async recordPollFailure(args: {
    readonly owner: string;
    readonly sourceId: string;
    readonly error: unknown;
    readonly httpStatus?: number | null;
    readonly clearValidators?: boolean;
  }): Promise<void> {
    const sourceId = parseUlid(args.sourceId);
    const prior = await this.database.database
      .selectFrom('personal_owner_source_poll_state')
      .selectAll()
      .where('source_id', '=', sourceId)
      .executeTakeFirst();
    const now = this.now();
    const failures = Math.min(12, (prior?.consecutive_failures ?? 0) + 1);
    const interval = Math.min(
      SOURCE_POLL_MAX_SECONDS,
      SOURCE_POLL_MIN_SECONDS * 2 ** Math.min(failures - 1, 8),
    );
    const error = args.error instanceof PersonalOwnerFeedReadFailure ? args.error : null;
    const retryDelay =
      error?.retryAfterMs === null || error?.retryAfterMs === undefined
        ? interval
        : Math.max(interval, Math.min(86_400, Math.ceil(error.retryAfterMs / 1000)));
    const recordedAt = now.toISOString();
    const nextPollAt = new Date(now.getTime() + retryDelay * 1000).toISOString();
    await this.database.database
      .insertInto('personal_owner_source_poll_state')
      .values({
        source_id: sourceId,
        owner_identity: args.owner,
        etag: args.clearValidators ? null : (prior?.etag ?? null),
        last_modified: args.clearValidators ? null : (prior?.last_modified ?? null),
        poll_interval_seconds: interval,
        consecutive_failures: failures,
        last_http_status: error?.httpStatus ?? args.httpStatus ?? null,
        last_polled_at: recordedAt,
        last_success_at: prior?.last_success_at ?? null,
        next_poll_at: nextPollAt,
        lease_until: null,
        updated_at: recordedAt,
      })
      .onConflict((conflict) =>
        conflict.column('source_id').doUpdateSet({
          owner_identity: args.owner,
          etag: args.clearValidators ? null : (prior?.etag ?? null),
          last_modified: args.clearValidators ? null : (prior?.last_modified ?? null),
          poll_interval_seconds: interval,
          consecutive_failures: failures,
          last_http_status: error?.httpStatus ?? args.httpStatus ?? null,
          last_polled_at: recordedAt,
          next_poll_at: nextPollAt,
          lease_until: null,
          updated_at: recordedAt,
        }),
      )
      .execute();
  }

  private async claimDueSource(owner: string): Promise<string | null> {
    return this.database.database.transaction().execute(async (tx) => {
      const due = await sql<{ source_id: string }>`
        select s.id::text as source_id
        from sources s
        join lateral (select * from personal_owner_source_rights_decisions
          where source_id=s.id order by sequence_number desc limit 1) d on true
        join lateral (select * from personal_owner_source_connections
          where source_id=s.id order by recorded_at desc,id desc limit 1) c on true
        left join personal_owner_source_poll_state p on p.source_id=s.id
        where c.owner_identity=${owner} and d.decision_status='AUTHORIZED'
          and d.valid_from<=clock_timestamp() and (d.expires_at is null or d.expires_at>clock_timestamp())
          and d.scopes->>'acquisition'='true' and d.scopes->>'metadata_storage'='true'
          and coalesce(p.next_poll_at,clock_timestamp())<=clock_timestamp()
          and (p.lease_until is null or p.lease_until<=clock_timestamp())
        order by coalesce(p.next_poll_at,clock_timestamp()),s.id
        for update of s skip locked limit 1
      `.execute(tx);
      const sourceId = due.rows[0]?.source_id;
      if (!sourceId) return null;
      const now = this.now();
      const nowIso = now.toISOString();
      const nextPollAt = new Date(now.getTime() + SOURCE_POLL_MIN_SECONDS * 1000).toISOString();
      const leaseUntil = new Date(now.getTime() + 120_000).toISOString();
      await tx
        .insertInto('personal_owner_source_poll_state')
        .values({
          source_id: parseUlid(sourceId),
          owner_identity: owner,
          etag: null,
          last_modified: null,
          poll_interval_seconds: SOURCE_POLL_MIN_SECONDS,
          consecutive_failures: 0,
          last_http_status: null,
          last_polled_at: null,
          last_success_at: null,
          next_poll_at: nextPollAt,
          lease_until: leaseUntil,
          updated_at: nowIso,
        })
        .onConflict((conflict) =>
          conflict.column('source_id').doUpdateSet({
            next_poll_at: nextPollAt,
            lease_until: leaseUntil,
            updated_at: nowIso,
          }),
        )
        .execute();
      return sourceId;
    });
  }

  private async pollOneDueSource(): Promise<void> {
    if (
      this.sourcePollInFlight ||
      process.env.DIALEKTIK_PERSONAL_OWNER_ACQUISITION_MODE !== 'live' ||
      this.config.ownershipMode !== 'personal' ||
      this.config.semanticMode !== 'unassigned'
    )
      return;
    this.sourcePollInFlight = true;
    try {
      const sourceId = await this.claimDueSource(this.assertOwnerMode());
      if (sourceId) await this.acquireSource(sourceId);
    } finally {
      this.sourcePollInFlight = false;
    }
  }

  async acquireSource(sourceIdValue: string) {
    const owner = this.assertOwnerMode();
    const sourceId = parseUlid(sourceIdValue);
    const current = await sql<{
      id: string;
      name: string;
      canonical_domain: string;
      source_type: string;
      decision_id: string | null;
      decision_status: string | null;
      publisher_identity: string | null;
      acquisition_method: string | null;
      rights_evidence_url: string | null;
      rights_evidence_sha256: string | null;
      attribution: string | null;
      scopes: RightsScope | null;
      local_processing: boolean | null;
      valid_from: Date | null;
      expires_at: Date | null;
      connection_id: string | null;
      endpoint: string | null;
      allowed_article_domains: string[] | null;
    }>`
      select s.id,s.name,s.canonical_domain,s.source_type,d.id as decision_id,d.decision_status,
        d.publisher_identity,d.acquisition_method,d.rights_evidence_url,d.rights_evidence_sha256,
        d.attribution,d.scopes,d.local_processing,d.valid_from,d.expires_at,
        c.id as connection_id,c.endpoint,c.allowed_article_domains
      from sources s
      left join lateral (select * from personal_owner_source_rights_decisions
        where source_id=s.id order by sequence_number desc limit 1) d on true
      left join lateral (select * from personal_owner_source_connections
        where source_id=s.id order by sequence_number desc limit 1) c on true
      where s.id=${sourceId}
    `.execute(this.database.database);
    const row = current.rows[0];
    if (!row) throw new NotFoundException('SOURCE_NOT_FOUND');
    if (!row.connection_id || !row.endpoint || !row.decision_id || !row.scopes)
      throw new ConflictException('SOURCE_CONNECTION_OR_RIGHTS_MISSING');
    const scopes = row.scopes;
    const validFrom = row.valid_from;
    if (
      row.decision_status !== 'AUTHORIZED' ||
      validFrom === null ||
      !isDecisionEffective(row.decision_status, validFrom, row.expires_at, this.now()) ||
      !scopes.acquisition ||
      !scopes.metadata_storage
    )
      throw new ConflictException('SOURCE_ACQUISITION_RIGHTS_NOT_AUTHORIZED');
    const decisionId = row.decision_id;
    const domains = row.allowed_article_domains ?? [row.canonical_domain];
    const policy: LiveSourcePolicy = {
      sourceId: parseUlid(row.id),
      registryKey: `personal-owner-${row.id}`,
      publisherName: row.name,
      canonicalDomain: row.canonical_domain,
      sourceType: row.source_type as SourceType,
      publisherFamily: null,
      category: null,
      discoveryChannel: 'rss_atom',
      endpoint: row.endpoint,
      rightsClass: 'LIVE_READY',
      storagePolicy: scopes.excerpt_storage ? 'METADATA_AND_FEED_EXCERPT' : 'METADATA_ONLY',
      active: true,
      rightsEvidenceUrl: row.rights_evidence_url ?? '',
      rightsVerifiedAt: validFrom.toISOString(),
      attribution: row.attribution ?? '',
      language: 'und',
      allowedArticleDomains: domains,
    };
    if (!policy.rightsEvidenceUrl || !policy.attribution)
      throw new ConflictException('SOURCE_RIGHTS_EVIDENCE_MISSING');

    let contentPolicyId: string | null = null;
    if (
      scopes.excerpt_storage &&
      row.local_processing === true &&
      scopes.derived_semantic_persistence
    ) {
      contentPolicyId = await this.ensureExcerptContentPolicy(row.id, {
        id: row.decision_id,
        valid_from: validFrom,
        rights_evidence_url: row.rights_evidence_url,
        rights_evidence_sha256: row.rights_evidence_sha256,
        scopes,
        local_processing: row.local_processing,
      });
    }

    const pollState = await this.database.database
      .selectFrom('personal_owner_source_poll_state')
      .select(['etag', 'last_modified'])
      .where('source_id', '=', parseUlid(row.id))
      .executeTakeFirst();
    let feedResult: PersonalOwnerFeedReadResult;
    try {
      const reader = this.activeFeedReader;
      feedResult = reader.readConditional
        ? await reader.readConditional(row.endpoint, {
            etag: pollState?.etag ?? null,
            lastModified: pollState?.last_modified ?? null,
          })
        : {
            status: 200,
            content: await reader.read(row.endpoint),
            etag: null,
            lastModified: null,
            retryAfterMs: null,
          };
    } catch (error) {
      await this.recordPollFailure({ owner, sourceId: row.id, error }).catch(() => undefined);
      throw new ServiceUnavailableException(
        error instanceof PersonalOwnerFeedReadFailure ? error.code : 'PUBLISHER_FEED_FETCH_FAILED',
      );
    }
    if (feedResult.status === 304) {
      await this.recordPollSuccess({
        owner,
        sourceId: row.id,
        response: feedResult,
        changed: false,
      });
      return {
        source_id: row.id,
        not_modified: true,
        acquisition: emptyLiveSyncSummary(),
        processing_versions_created: 0,
        external_acquisition_mode: 'LIVE_EXPLICIT_OPT_IN',
      };
    }
    if (feedResult.content === null) {
      const error = new PersonalOwnerFeedReadFailure('PUBLISHER_FEED_EMPTY', null, 200);
      await this.recordPollFailure({ owner, sourceId: row.id, error }).catch(() => undefined);
      throw new ServiceUnavailableException(error.code);
    }
    const discoveredAt = this.now();
    let acquisition;
    let processingVersionsCreated = 0;
    try {
      acquisition = await syncLivePayload(
        this.database.database,
        this.config,
        policy,
        feedResult.content,
        {
          discoveredAt,
          discoveryUrl: row.endpoint,
          authorizePersistence: (tx) =>
            this.assertCurrentSourceRights(tx, row.id, decisionId, [
              'acquisition',
              'metadata_storage',
              ...(scopes.excerpt_storage ? ['excerpt_storage' as const] : []),
            ]),
        },
      );
      if (contentPolicyId !== null) {
        processingVersionsCreated = await this.persistCurrentExcerptVersions(
          row.id,
          row.decision_id,
          contentPolicyId,
        );
      }
    } catch (error) {
      await this.recordPollFailure({ owner, sourceId: row.id, error }).catch(() => undefined);
      throw error;
    }
    if (acquisition.failedSources > 0 || acquisition.failedItems > 0) {
      // Do not cache validators for a feed whose content was not fully accepted:
      // a later 304 would suppress the retry needed to recover from parser or
      // persistence failures without changing the publisher's feed.
      await this.recordPollFailure({
        owner,
        sourceId: row.id,
        error: null,
        httpStatus: feedResult.status,
        clearValidators: true,
      });
    } else {
      await this.recordPollSuccess({
        owner,
        sourceId: row.id,
        response: feedResult,
        changed: acquisition.newArticles + acquisition.updatedArticles > 0,
      });
    }
    await this.database.database
      .insertInto('personal_owner_audit_events')
      .values({
        id: generateUlid({ now: () => this.now().getTime() }),
        owner_identity: owner,
        event_type: 'SOURCE_ACQUISITION_COMPLETED',
        request_fingerprint_sha256: sha256(
          `${owner}\nSOURCE_ACQUISITION_COMPLETED\n${row.id}\n${String(acquisition.itemsDiscovered)}\n${discoveredAt.toISOString()}`,
        ),
        recorded_at: this.now().toISOString(),
      })
      .execute();
    return {
      source_id: row.id,
      acquisition,
      processing_versions_created: processingVersionsCreated,
      external_acquisition_mode:
        process.env.DIALEKTIK_PERSONAL_OWNER_ACQUISITION_MODE === 'live'
          ? 'LIVE_EXPLICIT_OPT_IN'
          : 'DISABLED',
    };
  }

  private async persistCurrentExcerptVersions(
    sourceId: string,
    decisionId: string,
    policyId: string,
  ): Promise<number> {
    const rows = await sql<{
      article_id: string;
      canonical_url: string;
      headline: string;
      excerpt: string;
      source_item_id: string;
      published_at: Date;
      modified_at: Date | null;
      language: string;
      available_at: Date;
      policy_version_id: string;
      prior_id: string | null;
      prior_version_number: number | null;
      prior_policy_id: string | null;
      prior_input_hash: string | null;
      prior_title_hash: string | null;
      prior_acquired_hash: string | null;
    }>`
      select a.id as article_id,a.url_canonical as canonical_url,v.headline,v.excerpt,
        r.source_item_id,v.published_at,v.modified_at,a.lang as language,r.seen_at as available_at,
        v.id as policy_version_id,prior.id as prior_id,prior.version_number as prior_version_number,
        prior.policy_id as prior_policy_id,prior.normalized_input_hash as prior_input_hash,
        prior.title_input_hash as prior_title_hash,prior.acquired_content_hash as prior_acquired_hash
      from articles a
      join lateral (select * from live_article_versions where article_id=a.id
        order by version_number desc limit 1) v on true
      join live_acquisition_receipts r on r.id=v.receipt_id
      left join lateral (select * from observed_article_content_versions where article_id=a.id
        order by version_number desc limit 1) prior on true
      where a.source_id=${parseUlid(sourceId)} and a.origin='LIVE_REAL'
        and v.excerpt is not null and r.disposition='PERSISTED'
      order by a.id limit 100
    `.execute(this.database.database);
    let created = 0;
    for (const row of rows.rows) {
      const bytes = Buffer.from(`${row.headline}\n${row.excerpt}`.normalize('NFC'), 'utf8');
      const acquiredHash = sha256Bytes(bytes);
      const fields = normalizeFrozenFields(row.headline, row.excerpt);
      bytes.fill(0);
      if (
        row.prior_id &&
        row.prior_policy_id === policyId &&
        row.prior_input_hash === fields.inputHash &&
        row.prior_title_hash === fields.titleHash &&
        row.prior_acquired_hash === acquiredHash
      )
        continue;
      const id = generateUlid({ now: () => this.now().getTime() });
      const recordedAt = this.now().toISOString();
      await this.database.database.transaction().execute(async (tx) => {
        await this.assertCurrentSourceRights(
          tx,
          sourceId,
          decisionId,
          ['acquisition', 'metadata_storage', 'excerpt_storage', 'derived_semantic_persistence'],
          true,
        );
        await tx
          .insertInto('observed_article_content_versions')
          .values({
            id,
            article_id: parseUlid(row.article_id),
            source_id: parseUlid(sourceId),
            policy_id: policyId,
            previous_version_id: row.prior_id ? parseUlid(row.prior_id) : null,
            version_number: (row.prior_version_number ?? 0) + 1,
            canonical_url: row.canonical_url,
            publisher_item_id: row.source_item_id,
            original_title: row.headline,
            published_at: row.published_at,
            available_at: row.available_at,
            modified_at: row.modified_at,
            acquired_at: row.available_at,
            language: row.language === 'und' ? null : row.language,
            content_encoding: 'utf-8',
            acquired_content_hash: acquiredHash,
            normalized_input_hash: fields.inputHash,
            title_input_hash: fields.titleHash,
            normalization_version: FROZEN_NORMALIZATION_VERSION,
            input_codepoint_length: fields.bodyCodepoints,
            title_codepoint_length: fields.titleCodepoints,
            persisted_body: null,
            recorded_at: recordedAt,
          })
          .execute();
      });
      created++;
    }
    return created;
  }

  private assertOfficialVoteRights(decision: unknown): asserts decision is RecordValue {
    const now = this.now().getTime();
    if (!OBJECT(decision) || decision.decision_status !== 'AUTHORIZED')
      throw new ForbiddenException('OFFICIAL_EVENT_RIGHTS_NOT_AUTHORIZED');
    const validFromValue = decision.valid_from;
    const validFrom =
      validFromValue instanceof Date
        ? validFromValue.getTime()
        : typeof validFromValue === 'string'
          ? Date.parse(validFromValue)
          : Number.NaN;
    const expiresAtValue = decision.expires_at;
    const expiresAt =
      expiresAtValue === null
        ? null
        : expiresAtValue instanceof Date
          ? expiresAtValue.getTime()
          : typeof expiresAtValue === 'string'
            ? Date.parse(expiresAtValue)
            : Number.NaN;
    const scopes = decision.scopes;
    if (
      !Number.isFinite(validFrom) ||
      validFrom > now ||
      (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= now)) ||
      decision.acquisition_method !== 'OFFICIAL_API' ||
      decision.local_processing !== true ||
      !OBJECT(scopes) ||
      scopes.acquisition !== true ||
      scopes.metadata_storage !== true ||
      scopes.derived_semantic_persistence !== true ||
      scopes.redisplay !== true ||
      scopes.excerpt_storage !== false ||
      scopes.fulltext_acquisition !== false ||
      scopes.fulltext_persistence !== false ||
      scopes.external_ai_transmission !== false
    )
      throw new ForbiddenException('OFFICIAL_EVENT_RIGHTS_NOT_AUTHORIZED');
    if (
      typeof decision.rights_evidence_url !== 'string' ||
      typeof decision.rights_evidence_sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(decision.rights_evidence_sha256)
    )
      throw new ForbiddenException('OFFICIAL_EVENT_RIGHTS_EVIDENCE_MISSING');
  }

  private async assertOfficialVoteSource(sourceId: string) {
    const source = await this.database.database
      .selectFrom('sources')
      .select(['id', 'name', 'canonical_domain', 'source_type'])
      .where('id', '=', parseUlid(sourceId))
      .executeTakeFirst();
    if (!source) throw new NotFoundException('SOURCE_NOT_FOUND');
    if (
      source.canonical_domain !== 'opendata.camara.cl' ||
      source.source_type !== 'official_statistics'
    )
      throw new ForbiddenException('OFFICIAL_EVENT_SOURCE_IDENTITY_MISMATCH');
    const decision = await this.database.database
      .selectFrom('personal_owner_source_rights_decisions')
      .selectAll()
      .where('source_id', '=', source.id)
      .orderBy('sequence_number', 'desc')
      .executeTakeFirst();
    this.assertOfficialVoteRights(decision);
    return { source, decision };
  }

  async officialVoteEvents(sourceIdValue?: string) {
    this.assertOwnerMode();
    if (sourceIdValue !== undefined) parseUlid(sourceIdValue);
    let query = this.database.database
      .selectFrom('personal_owner_official_vote_observations as o')
      .innerJoin('personal_owner_official_vote_occurrences as c', 'c.id', 'o.occurrence_id')
      .innerJoin('personal_owner_official_vote_evidence as e', 'e.id', 'o.evidence_id')
      .innerJoin('sources as s', 's.id', 'o.source_id')
      .innerJoin('personal_owner_official_vote_provenance as p', 'p.observation_id', 'o.id')
      .select([
        'o.id as observation_id',
        'o.observed_at',
        'o.thread_identity_decision',
        'o.thread_abstention_reason',
        'c.id as occurrence_id',
        'c.occurrence_kind',
        'c.identity_basis',
        's.id as source_id',
        's.name as source_name',
        'e.source_record_id',
        'e.source_record_url',
        'e.response_sha256',
        'e.fetched_at',
        'e.description',
        'e.source_date_raw',
        (eb) => eb.ref('e.yes_votes').as('total_yes'),
        (eb) => eb.ref('e.no_votes').as('total_no'),
        (eb) => eb.ref('e.abstention_votes').as('total_abstention'),
        (eb) => eb.ref('e.excused_votes').as('total_excused'),
        'e.result',
        'e.quorum',
        'p.adapter_version',
        'p.acquisition_method',
      ]);
    if (sourceIdValue !== undefined) {
      query = query.where('o.source_id', '=', parseUlid(sourceIdValue));
    }
    const rows = await query.limit(100).execute();
    return {
      items: rows.map((row) => ({
        observation: { id: row.observation_id, observed_at: row.observed_at },
        occurrence: {
          id: row.occurrence_id,
          kind: row.occurrence_kind,
          identity_basis: row.identity_basis,
          source_record_id: row.source_record_id,
          source_date_raw: row.source_date_raw,
        },
        thread: {
          decision: row.thread_identity_decision,
          reason: row.thread_abstention_reason,
        },
        evidence: {
          source_id: row.source_id,
          source_name: row.source_name,
          source_record_url: row.source_record_url,
          description: row.description,
          totals: {
            yes: row.total_yes,
            no: row.total_no,
            abstention: row.total_abstention,
            excused: row.total_excused,
          },
          result: row.result,
          quorum: row.quorum,
          fetched_at: row.fetched_at,
          response_sha256: row.response_sha256,
        },
        provenance: {
          adapter_version: row.adapter_version,
          acquisition_method: row.acquisition_method,
          source_record_id: row.source_record_id,
          source_record_url: row.source_record_url,
          response_sha256: row.response_sha256,
          independent_corroboration: 'NONE',
          source_assertion_limit: 'SOURCE_REPORTED_NOT_INDEPENDENTLY_VERIFIED',
        },
      })),
    };
  }

  async acquireOfficialVoteEvent(sourceIdValue: string, voteIdValue: string) {
    const owner = this.assertOwnerMode();
    const sourceId = parseUlid(sourceIdValue);
    if (!/^\d{1,12}$/u.test(voteIdValue)) throw new BadRequestException('INVALID_OFFICIAL_VOTE_ID');
    await this.assertOfficialVoteSource(sourceId);
    const endpoint = `${OFFICIAL_VOTE_DETAIL_BASE_URL}?prmVotacionId=${voteIdValue}`;
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'GET',
        headers: { Accept: 'application/xml, text/xml;q=0.9' },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableException('OFFICIAL_EVENT_SOURCE_UNAVAILABLE');
    }
    if (!response.ok) throw new ServiceUnavailableException('OFFICIAL_EVENT_SOURCE_UNAVAILABLE');
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.includes('xml'))
      throw new BadRequestException('OFFICIAL_EVENT_SOURCE_FORMAT_UNSUPPORTED');
    let event: ReturnType<typeof parseOfficialVoteDetail>;
    try {
      const payload = await readBoundedResponse(response, OFFICIAL_VOTE_MAX_RESPONSE_BYTES);
      event = parseOfficialVoteDetail(payload, voteIdValue);
    } catch {
      throw new BadRequestException('OFFICIAL_EVENT_SOURCE_RESPONSE_INVALID');
    }
    const fetchedAt = this.now().toISOString();
    const evidenceCandidateId = generateUlid({ now: () => Date.parse(fetchedAt) });
    const occurrenceCandidateId = generateUlid({ now: () => Date.parse(fetchedAt) + 1 });
    const observationCandidateId = generateUlid({ now: () => Date.parse(fetchedAt) + 2 });
    const provenanceCandidateId = generateUlid({ now: () => Date.parse(fetchedAt) + 3 });
    const persisted = await this.database.database.transaction().execute(async (tx) => {
      const source = await tx
        .selectFrom('sources')
        .select(['id', 'name', 'canonical_domain', 'source_type'])
        .where('id', '=', sourceId)
        .forUpdate()
        .executeTakeFirst();
      if (
        source?.canonical_domain !== 'opendata.camara.cl' ||
        source.source_type !== 'official_statistics'
      )
        throw new ForbiddenException('OFFICIAL_EVENT_SOURCE_IDENTITY_MISMATCH');
      const decision = await tx
        .selectFrom('personal_owner_source_rights_decisions')
        .selectAll()
        .where('source_id', '=', sourceId)
        .orderBy('sequence_number', 'desc')
        .forUpdate()
        .executeTakeFirst();
      this.assertOfficialVoteRights(decision);

      await tx
        .insertInto('personal_owner_official_vote_evidence')
        .values({
          id: evidenceCandidateId,
          source_id: sourceId,
          source_record_id: event.sourceRecordId,
          source_record_url: event.sourceRecordUrl,
          response_sha256: event.responseSha256,
          fetched_at: fetchedAt,
          description: event.description,
          source_date_raw: event.sourceDateRaw,
          yes_votes: event.totalYes,
          no_votes: event.totalNo,
          abstention_votes: event.totalAbstention,
          excused_votes: event.totalExcused,
          result: event.result,
          quorum: event.quorum,
        })
        .onConflict((conflict) =>
          conflict.columns(['source_id', 'source_record_id', 'response_sha256']).doNothing(),
        )
        .execute();
      const evidence = await tx
        .selectFrom('personal_owner_official_vote_evidence')
        .select('id')
        .where('source_id', '=', sourceId)
        .where('source_record_id', '=', event.sourceRecordId)
        .where('response_sha256', '=', event.responseSha256)
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('personal_owner_official_vote_occurrences')
        .values({
          id: occurrenceCandidateId,
          source_id: sourceId,
          source_record_id: event.sourceRecordId,
          occurrence_kind: 'ROLL_CALL_VOTE',
          identity_basis: 'OFFICIAL_SOURCE_RECORD_ID',
          created_at: fetchedAt,
        })
        .onConflict((conflict) => conflict.columns(['source_id', 'source_record_id']).doNothing())
        .execute();
      const occurrence = await tx
        .selectFrom('personal_owner_official_vote_occurrences')
        .select('id')
        .where('source_id', '=', sourceId)
        .where('source_record_id', '=', event.sourceRecordId)
        .executeTakeFirstOrThrow();
      const observation = await tx
        .insertInto('personal_owner_official_vote_observations')
        .values({
          id: observationCandidateId,
          source_id: sourceId,
          source_record_id: event.sourceRecordId,
          occurrence_id: occurrence.id,
          evidence_id: evidence.id,
          occurrence_identity_decision: 'SOURCE_RECORD_IDENTIFIED',
          thread_identity_decision: 'UNKNOWN',
          thread_abstention_reason:
            'One source vote record does not establish a supported relationship to another event or legislative proceeding.',
          observed_at: fetchedAt,
        })
        .onConflict((conflict) => conflict.column('evidence_id').doNothing())
        .returning('id')
        .executeTakeFirst();
      if (observation) {
        await tx
          .insertInto('personal_owner_official_vote_provenance')
          .values({
            id: provenanceCandidateId,
            observation_id: observation.id,
            source_id: sourceId,
            source_record_id: event.sourceRecordId,
            evidence_id: evidence.id,
            source_record_url: event.sourceRecordUrl,
            response_sha256: event.responseSha256,
            adapter_version: OFFICIAL_VOTE_ADAPTER_VERSION,
            acquisition_method: 'OFFICIAL_API',
            recorded_at: fetchedAt,
          })
          .execute();
        await tx
          .insertInto('personal_owner_audit_events')
          .values({
            id: generateUlid({ now: () => Date.parse(fetchedAt) + 4 }),
            owner_identity: owner,
            event_type: 'OFFICIAL_EVENT_ACQUIRED',
            request_fingerprint_sha256: sha256(
              `${owner}\nOFFICIAL_EVENT_ACQUIRED\n${sourceId}\n${event.sourceRecordId}\n${event.responseSha256}`,
            ),
            recorded_at: fetchedAt,
          })
          .execute();
      }
      return {
        sourceId,
        sourceName: source.name,
        occurrenceId: occurrence.id,
        evidenceId: evidence.id,
        observationId: observation?.id ?? null,
        idempotent: observation === undefined,
      };
    });
    const items = await this.officialVoteEvents(persisted.sourceId);
    const item = items.items.find(
      (candidate) =>
        (candidate as { occurrence?: { source_record_id?: string } }).occurrence
          ?.source_record_id === event.sourceRecordId,
    );
    return { ...persisted, event: item ?? null };
  }

  async articles(sourceIdValue?: string) {
    const owner = this.assertOwnerMode();
    const sourceId = sourceIdValue ? parseUlid(sourceIdValue) : null;
    const modelId = process.env.CLOUDFLARE_AI_MODEL?.trim() ?? CLOUDFLARE_GPT_OSS_20B_MODEL;
    const providerAuthorization = await this.database.database
      .selectFrom('personal_owner_provider_authorizations')
      .select(['decision_status', 'valid_from', 'expires_at'])
      .where('owner_identity', '=', owner)
      .where('provider_type', '=', 'llm_cloudflare_workers_ai')
      .where('model_id', '=', modelId)
      .orderBy('recorded_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();
    const price = await this.database.database
      .selectFrom('personal_owner_model_prices')
      .select(['decision_status', 'valid_from', 'expires_at'])
      .where('provider_type', '=', 'llm_cloudflare_workers_ai')
      .where('model_id', '=', modelId)
      .orderBy('recorded_at', 'desc')
      .executeTakeFirst();
    const control = await this.database.database
      .selectFrom('personal_owner_budget_controls')
      .select(['enabled', 'emergency_stop', 'revoked_at'])
      .where('owner_identity', '=', owner)
      .executeTakeFirst();
    const result = await sql<{
      article_id: string;
      source_id: string;
      publisher: string;
      domain: string;
      headline: string | null;
      excerpt: string | null;
      canonical_url: string | null;
      published_at: Date;
      captured_at: Date;
      version_id: string | null;
      version_number: number | null;
      metadata_hash: string | null;
      observed_version_id: string | null;
      content_access_mode: string | null;
      fulltext_acquisition: boolean | null;
      machine_processing: boolean | null;
      fulltext_persistence: boolean | null;
      derived_persistence: boolean | null;
      policy_local_processing: boolean | null;
      policy_external_ai_transmission: boolean | null;
      authorization: string | null;
      rights_scopes: RightsScope | null;
      local_processing: boolean | null;
      rights_valid_from: Date | null;
      rights_expires_at: Date | null;
      external_ai_transmission: boolean | null;
      attribution: string | null;
      discovery_channel: string;
      discovery_url: string;
      first_seen_at: Date;
      last_seen_at: Date;
      adapter_version: string;
      receipt_count: number;
      rights_evidence_url: string | null;
      exclusion_status: string;
    }>`
      select a.id as article_id, s.id as source_id, s.name as publisher, s.canonical_domain as domain,
        case when current_policy.policy->>'active'='true'
          and current_policy.policy->>'rightsClass'='LIVE_READY'
          and d.decision_status='AUTHORIZED' and d.valid_from <= clock_timestamp()
          and (d.expires_at is null or d.expires_at > clock_timestamp())
          and (d.scopes->>'metadata_storage')::boolean
          and (d.scopes->>'redisplay')::boolean then v.headline else null end as headline,
        case when current_policy.policy->>'active'='true'
          and current_policy.policy->>'rightsClass'='LIVE_READY'
          and current_policy.policy->>'storagePolicy'='METADATA_AND_FEED_EXCERPT'
          and d.decision_status='AUTHORIZED' and d.valid_from <= clock_timestamp()
          and (d.expires_at is null or d.expires_at > clock_timestamp())
          and (d.scopes->>'metadata_storage')::boolean
          and (d.scopes->>'excerpt_storage')::boolean
          and (d.scopes->>'redisplay')::boolean
          then v.excerpt else null end as excerpt,
        case when current_policy.policy->>'active'='true'
          and d.decision_status='AUTHORIZED' and d.valid_from <= clock_timestamp()
          and (d.expires_at is null or d.expires_at > clock_timestamp())
          and (d.scopes->>'metadata_storage')::boolean
          and (d.scopes->>'redisplay')::boolean
          and current_policy.policy->'allowedArticleDomains' ? lower(split_part(split_part(a.url_canonical,'://',2),'/',1))
          then a.url_canonical else null end as canonical_url,
        a.published_at, a.captured_at,
        v.id as version_id, v.version_number, v.metadata_hash,
        ov.id as observed_version_id, p.content_access_mode,
        p.fulltext_acquisition, p.fulltext_machine_processing as machine_processing,
        p.fulltext_persistence, p.derived_semantic_persistence as derived_persistence,
        p.local_processing as policy_local_processing,
        p.external_ai_transmission as policy_external_ai_transmission,
        d.decision_status as authorization,
        d.scopes as rights_scopes, d.valid_from as rights_valid_from,
        d.expires_at as rights_expires_at,
        d.local_processing,
        (d.scopes->>'external_ai_transmission')::boolean as external_ai_transmission,
        d.attribution, receipt.discovery_channel, receipt.discovery_url,
        exclusion.first_seen_at,
        (select max(seen_at) from live_acquisition_receipts where exclusion_id=a.live_exposure_id) as last_seen_at,
        receipt.adapter_version,
        (select count(*)::int from live_acquisition_receipts where exclusion_id=a.live_exposure_id) as receipt_count,
        d.rights_evidence_url,
        exclusion.exclusion_status
      from articles a join sources s on s.id=a.source_id
      left join lateral (select * from live_article_versions where article_id=a.id order by version_number desc limit 1) v on true
      left join lateral (select * from observed_article_content_versions where article_id=a.id order by version_number desc limit 1) ov on true
      left join lateral (select * from content_access_policies where source_id=s.id order by recorded_at desc,id desc limit 1) p on true
      left join lateral (select * from personal_owner_source_rights_decisions where source_id=s.id order by sequence_number desc limit 1) d on true
      join live_exposure_exclusions exclusion on exclusion.id=a.live_exposure_id
      join live_acquisition_receipts receipt on receipt.id=(
        select id from live_acquisition_receipts where exclusion_id=a.live_exposure_id
          and disposition='PERSISTED' order by seen_at desc,id desc limit 1)
      left join lateral (select policy from live_source_policies where source_id=s.id
        order by recorded_at desc,id desc limit 1) current_policy on true
      where a.origin='LIVE_REAL'
        and (${sourceId}::text is null or a.source_id::text=${sourceId?.toString() ?? null})
      order by a.published_at desc,a.id desc limit 100
    `.execute(this.database.database);
    const now = this.now();
    return {
      items: result.rows.map((row) => {
        const effective = isDecisionEffective(
          row.authorization,
          row.rights_valid_from,
          row.rights_expires_at,
          now,
        );
        const sourceRightsAllowed =
          effective &&
          row.rights_scopes?.acquisition === true &&
          row.rights_scopes.metadata_storage &&
          row.rights_scopes.excerpt_storage &&
          row.rights_scopes.external_ai_transmission &&
          row.rights_scopes.derived_semantic_persistence &&
          row.rights_scopes.redisplay &&
          row.local_processing === true;
        let blockedReason = 'PROVIDER_ROUTE_NOT_AVAILABLE';
        if (!sourceRightsAllowed) blockedReason = 'SOURCE_RIGHTS_NOT_AUTHORIZED';
        else if (
          row.content_access_mode !== 'EXCERPT_EPHEMERAL' ||
          row.fulltext_acquisition ||
          row.machine_processing ||
          row.fulltext_persistence ||
          !row.derived_persistence ||
          row.policy_local_processing !== true ||
          row.policy_external_ai_transmission !== true
        )
          blockedReason = 'ARTICLE_PROCESSING_POLICY_DENIED';
        else if (row.observed_version_id === null)
          blockedReason = 'ARTICLE_EXCERPT_VERSION_UNAVAILABLE';
        else if (
          !providerAuthorization ||
          !isDecisionEffective(
            providerAuthorization.decision_status,
            providerAuthorization.valid_from,
            providerAuthorization.expires_at,
            now,
          )
        )
          blockedReason = 'PROVIDER_AUTHORIZATION_REQUIRED';
        else if (
          price?.decision_status !== 'VERIFIED' ||
          !isDecisionEffective(
            price.decision_status,
            price.valid_from,
            price.expires_at,
            now,
            'VERIFIED',
          )
        )
          blockedReason = 'MODEL_PRICE_UNVERIFIED';
        else if (!control?.enabled || control.emergency_stop || control.revoked_at !== null)
          blockedReason = 'OWNER_BUDGET_DISABLED';
        else if (this.activeDispatcher.providerMode === 'disabled')
          blockedReason = 'PROVIDER_DISPATCHER_DISABLED';
        return {
          id: row.article_id,
          source_id: row.source_id,
          publisher: row.publisher,
          domain: row.domain,
          headline: row.headline,
          excerpt: row.excerpt,
          canonical_url: row.canonical_url,
          published_at: row.published_at,
          captured_at: row.captured_at,
          version:
            row.version_id === null
              ? null
              : {
                  id: row.version_id,
                  number: row.version_number,
                  metadata_hash: row.metadata_hash,
                  observed_content_version_id: row.observed_version_id,
                },
          processing_authorization: {
            source_decision:
              row.authorization === 'AUTHORIZED' && !effective
                ? 'EXPIRED_OR_NOT_YET_VALID'
                : (row.authorization ?? 'UNVERIFIED'),
            external_ai_transmission:
              effective && row.rights_scopes?.external_ai_transmission === true,
            acquisition: effective && row.rights_scopes?.acquisition === true,
            metadata_storage: effective && row.rights_scopes?.metadata_storage === true,
            excerpt_storage: effective && row.rights_scopes?.excerpt_storage === true,
            local_processing: effective && row.local_processing === true,
            fulltext_acquisition:
              effective &&
              row.rights_scopes?.fulltext_acquisition === true &&
              row.fulltext_acquisition === true,
            machine_processing: row.machine_processing ?? false,
            derived_persistence: row.derived_persistence ?? false,
            content_access_mode: row.content_access_mode ?? 'METADATA_ONLY',
            ready: blockedReason === 'PROVIDER_ROUTE_NOT_AVAILABLE',
            provider_type: 'llm_cloudflare_workers_ai',
            model_id: modelId,
            reason: blockedReason,
          },
          attribution: row.attribution,
          provenance: {
            discovery_channel: row.discovery_channel,
            discovery_url: row.discovery_url,
            first_seen_at: row.first_seen_at,
            last_seen_at: row.last_seen_at,
            adapter_version: row.adapter_version,
            receipt_count: row.receipt_count,
            rights_class: row.authorization ?? 'UNVERIFIED',
            rights_evidence_url: row.rights_evidence_url,
            exclusion_status: row.exclusion_status,
          },
        };
      }),
    };
  }

  async budget() {
    const owner = this.assertOwnerMode();
    const control = await this.database.database
      .selectFrom('personal_owner_budget_controls')
      .selectAll()
      .where('owner_identity', '=', owner)
      .executeTakeFirst();
    const prices = await sql<{
      id: string;
      model_id: string;
      input_microusd_per_1k_tokens: number;
      output_microusd_per_1k_tokens: number;
      max_input_tokens: number;
      max_output_tokens: number;
      input_neurons_per_million_tokens: number;
      output_neurons_per_million_tokens: number;
      decision_status: string;
      evidence_url: string | null;
      valid_from: Date;
      expires_at: Date | null;
    }>`
      select distinct on (provider_type,model_id) id,model_id,input_microusd_per_1k_tokens,
        output_microusd_per_1k_tokens,max_input_tokens,max_output_tokens,
        input_neurons_per_million_tokens,output_neurons_per_million_tokens,decision_status,
        evidence_url,valid_from,expires_at
      from personal_owner_model_prices where provider_type='llm_cloudflare_workers_ai'
      order by provider_type,model_id,recorded_at desc
    `.execute(this.database.database);
    const totals = await sql<{
      daily_microusd: number;
      total_microusd: number;
      reserved_microusd: number;
      daily_neurons_actual: number;
      daily_neurons_reserved: number;
      daily_neurons_total: number;
    }>`
      select coalesce(sum(case when state='SETTLED' then actual_microusd else 0 end)
        filter (where created_at >= date_trunc('day',clock_timestamp())),0)::integer as daily_microusd,
        coalesce(sum(case when state='SETTLED' then actual_microusd else 0 end),0)::integer as total_microusd,
        coalesce(sum(reserved_microusd) filter(where state in ('RESERVED','RECONCILIATION_REQUIRED')),0)::integer as reserved_microusd
      from personal_owner_budget_reservations where owner_identity=${owner}
    `.execute(this.database.database);
    const neuronUsage = await sql<{
      daily_neurons_actual: number;
      daily_neurons_reserved: number;
      daily_neurons_total: number;
    }>`
      select coalesce(sum(actual_neurons) filter(where state='SETTLED'),0)::integer as daily_neurons_actual,
        coalesce(sum(reserved_neurons) filter(where state in ('RESERVED','RECONCILIATION_REQUIRED')),0)::integer as daily_neurons_reserved,
        coalesce(sum(case when state='SETTLED' then actual_neurons else reserved_neurons end)
          filter(where state in ('RESERVED','SETTLED','RECONCILIATION_REQUIRED')),0)::integer as daily_neurons_total
      from personal_owner_neuron_reservations
      where owner_identity=${owner} and utc_day=(clock_timestamp() at time zone 'UTC')::date
    `.execute(this.database.database);
    const providerAuthorizations = await sql<{
      id: string;
      provider_type: string;
      model_id: string;
      decision_status: string;
      valid_from: Date;
      expires_at: Date | null;
      evidence_url: string | null;
    }>`
      select distinct on (provider_type,model_id) id,provider_type,model_id,decision_status,
        valid_from,expires_at,evidence_url
      from personal_owner_provider_authorizations where owner_identity=${owner}
      order by provider_type,model_id,recorded_at desc,id desc
    `.execute(this.database.database);
    return {
      owner_identity: owner,
      controls: control ?? {
        enabled: false,
        emergency_stop: true,
        per_request_limit_microusd: 0,
        daily_limit_microusd: 0,
        total_limit_microusd: 0,
        max_concurrency: 1,
        max_requests_per_minute: 1,
        revoked_at: null,
        workers_ai_plan: 'UNVERIFIED',
        paid_overage_disabled: false,
        daily_neuron_limit: WORKERS_FREE_DAILY_NEURON_CAP,
        per_request_neuron_limit: PERSONAL_OWNER_DAILY_REQUEST_NEURON_CAP,
      },
      usage: {
        ...(totals.rows[0] ?? {
          daily_microusd: 0,
          total_microusd: 0,
          reserved_microusd: 0,
          daily_neurons_actual: 0,
          daily_neurons_reserved: 0,
          daily_neurons_total: 0,
        }),
        ...(neuronUsage.rows[0] ?? {
          daily_neurons_actual: 0,
          daily_neurons_reserved: 0,
          daily_neurons_total: 0,
        }),
      },
      zero_cost_policy: {
        workers_free_daily_allocation_neurons: 10_000,
        local_daily_neuron_cap: WORKERS_FREE_DAILY_NEURON_CAP,
        local_per_request_neuron_cap: PERSONAL_OWNER_DAILY_REQUEST_NEURON_CAP,
        paid_overage_required_to_be_disabled: true,
        automatic_paid_plan_upgrade: false,
        cloudflare_reset_timezone: 'UTC',
      },
      prices: prices.rows,
      provider_authorizations: providerAuthorizations.rows.map((row) => ({
        ...row,
        effective: isDecisionEffective(
          row.decision_status,
          row.valid_from,
          row.expires_at,
          this.now(),
        ),
      })),
      provider_mode: this.activeDispatcher.providerMode,
      external_activation:
        this.activeDispatcher.providerMode === 'cloudflare'
          ? 'EXPLICITLY_CONFIGURED_PENDING_PER_JOB_AUTHORIZATION'
          : 'DISABLED_PENDING_SEPARATE_ACTIVATION',
    };
  }

  async recordModelPrice(value: unknown) {
    const owner = this.assertOwnerMode();
    if (!OBJECT(value)) throw new BadRequestException('INVALID_MODEL_PRICE');
    const modelId = requiredText(value, 'model_id', 128);
    if (!(CLOUDFLARE_SUPPORTED_MODELS as readonly string[]).includes(modelId))
      throw new BadRequestException('INVALID_MODEL_ID');
    const inputRate = parseMicrousd(value.input_microusd_per_1k_tokens, 'input_rate', true);
    const outputRate = parseMicrousd(value.output_microusd_per_1k_tokens, 'output_rate', true);
    const inputNeurons = parseMicrousd(
      value.input_neurons_per_million_tokens === undefined
        ? 0
        : value.input_neurons_per_million_tokens,
      'input_neurons_per_million_tokens',
      true,
    );
    const outputNeurons = parseMicrousd(
      value.output_neurons_per_million_tokens === undefined
        ? 0
        : value.output_neurons_per_million_tokens,
      'output_neurons_per_million_tokens',
      true,
    );
    const maxInput = parseMicrousd(value.max_input_tokens, 'max_input_tokens');
    const maxOutput = parseMicrousd(value.max_output_tokens, 'max_output_tokens');
    if (maxInput > 1_000_000 || maxOutput > 1_000_000)
      throw new BadRequestException('INVALID_MODEL_TOKEN_BOUND');
    if (
      modelId === CLOUDFLARE_GPT_OSS_20B_MODEL &&
      (maxInput !== PERSONAL_OWNER_REQUEST_BYTE_LIMIT ||
        maxOutput !== PERSONAL_OWNER_OUTPUT_TOKEN_LIMIT ||
        inputRate !== 200 ||
        outputRate !== 300 ||
        inputNeurons !== 18_182 ||
        outputNeurons !== 27_273)
    )
      throw new BadRequestException('GPT_OSS_20B_FREE_PLAN_BOUNDS_OR_RATES_NOT_VERIFIED');
    const evidenceUrl = requiredText(value, 'evidence_url', 2048);
    if (!evidenceUrl.startsWith('https://')) throw new BadRequestException('INVALID_EVIDENCE_URL');
    const evidenceHash = requireHash(value.evidence_sha256, 'evidence_sha256');
    const status = value.decision_status === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED';
    const recordedAt = this.now().toISOString();
    const id = generateUlid({ now: () => Date.parse(recordedAt) });
    await this.database.database
      .insertInto('personal_owner_model_prices')
      .values({
        id,
        provider_type: 'llm_cloudflare_workers_ai',
        model_id: modelId,
        input_microusd_per_1k_tokens: inputRate,
        output_microusd_per_1k_tokens: outputRate,
        max_input_tokens: maxInput,
        max_output_tokens: maxOutput,
        input_neurons_per_million_tokens: inputNeurons,
        output_neurons_per_million_tokens: outputNeurons,
        evidence_url: evidenceUrl,
        evidence_sha256: evidenceHash,
        decision_status: status,
        valid_from: recordedAt,
        expires_at: dateValue(value.expires_at, 'expires_at')?.toISOString() ?? null,
        recorded_at: recordedAt,
      })
      .execute();
    await this.database.database
      .insertInto('personal_owner_audit_events')
      .values({
        id: generateUlid({ now: () => Date.parse(recordedAt) + 1 }),
        owner_identity: owner,
        event_type: 'MODEL_PRICE_RECORDED',
        request_fingerprint_sha256: sha256(`${owner}\nMODEL_PRICE_RECORDED\n${id}\n${recordedAt}`),
        recorded_at: recordedAt,
      })
      .execute();
    return {
      id,
      provider_type: 'llm_cloudflare_workers_ai',
      model_id: modelId,
      decision_status: status,
    };
  }

  async recordProviderAuthorization(value: unknown) {
    const owner = this.assertOwnerMode();
    if (!OBJECT(value)) throw new BadRequestException('INVALID_PROVIDER_AUTHORIZATION');
    const modelId = requiredText(value, 'model_id', 128);
    if (!(CLOUDFLARE_SUPPORTED_MODELS as readonly string[]).includes(modelId))
      throw new BadRequestException('INVALID_MODEL_ID');
    const decisionStatus = requiredText(value, 'decision_status', 16);
    if (!['UNVERIFIED', 'AUTHORIZED', 'SUSPENDED', 'REVOKED'].includes(decisionStatus))
      throw new BadRequestException('INVALID_DECISION_STATUS');
    const evidenceUrl = value.evidence_url;
    const evidenceHash = value.evidence_sha256;
    if (decisionStatus === 'AUTHORIZED') {
      if (
        typeof evidenceUrl !== 'string' ||
        !evidenceUrl.startsWith('https://') ||
        evidenceUrl.length > 2048
      )
        throw new BadRequestException('PROVIDER_AUTHORIZATION_EVIDENCE_URL_REQUIRED');
      requireHash(evidenceHash, 'evidence_sha256');
    }
    const validFrom = dateValue(value.valid_from, 'valid_from') ?? this.now();
    const expiresAt = dateValue(value.expires_at, 'expires_at');
    const recordedAt = this.now().toISOString();
    if (validFrom > this.now() || (expiresAt && expiresAt <= validFrom))
      throw new BadRequestException('INVALID_PROVIDER_AUTHORIZATION_VALIDITY');
    const id = generateUlid({ now: () => Date.parse(recordedAt) });
    await this.database.database.transaction().execute(async (tx) => {
      await tx
        .insertInto('personal_owner_provider_authorizations')
        .values({
          id,
          owner_identity: owner,
          provider_type: 'llm_cloudflare_workers_ai',
          model_id: modelId,
          decision_status: decisionStatus as 'UNVERIFIED' | 'AUTHORIZED' | 'SUSPENDED' | 'REVOKED',
          evidence_url: typeof evidenceUrl === 'string' ? evidenceUrl.trim() : null,
          evidence_sha256: typeof evidenceHash === 'string' ? evidenceHash : null,
          valid_from: validFrom.toISOString(),
          expires_at: expiresAt?.toISOString() ?? null,
          recorded_at: recordedAt,
        })
        .execute();
      await tx
        .insertInto('personal_owner_audit_events')
        .values({
          id: generateUlid({ now: () => Date.parse(recordedAt) + 1 }),
          owner_identity: owner,
          event_type: 'PROVIDER_AUTHORIZATION_RECORDED',
          request_fingerprint_sha256: sha256(
            `${owner}\nPROVIDER_AUTHORIZATION_RECORDED\n${id}\n${modelId}\n${decisionStatus}`,
          ),
          recorded_at: recordedAt,
        })
        .execute();
    });
    if (decisionStatus !== 'AUTHORIZED') {
      this.activeDispatcher.cancelOwner(owner);
      await this.cancelQueuedJobs({ modelId, reason: 'PROVIDER_AUTHORIZATION_REVOKED' });
    }
    return {
      id,
      provider_type: 'llm_cloudflare_workers_ai',
      model_id: modelId,
      decision_status: decisionStatus,
    };
  }

  async configureBudget(value: unknown) {
    const owner = this.assertOwnerMode();
    if (!OBJECT(value)) throw new BadRequestException('INVALID_BUDGET_CONFIG');
    const perRequest = parseMicrousd(
      value.per_request_limit_microusd,
      'per_request_limit_microusd',
      true,
    );
    const daily = parseMicrousd(value.daily_limit_microusd, 'daily_limit_microusd', true);
    const total = parseMicrousd(value.total_limit_microusd, 'total_limit_microusd', true);
    if (value.enabled !== undefined && typeof value.enabled !== 'boolean')
      throw new BadRequestException('INVALID_BUDGET_ENABLED');
    const enabled = value.enabled === true;
    if (enabled && (perRequest < 1 || daily < 1 || total < 1))
      throw new BadRequestException('ENABLED_BUDGET_REQUIRES_POSITIVE_LIMITS');
    const concurrency = value.max_concurrency;
    const requestsPerMinute = value.max_requests_per_minute;
    if (
      typeof concurrency !== 'number' ||
      !Number.isInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > 8
    )
      throw new BadRequestException('INVALID_MAX_CONCURRENCY');
    if (
      typeof requestsPerMinute !== 'number' ||
      !Number.isInteger(requestsPerMinute) ||
      requestsPerMinute < 1 ||
      requestsPerMinute > 10
    )
      throw new BadRequestException('INVALID_RATE_LIMIT');
    const recordedAt = this.now().toISOString();
    if (
      value.workers_ai_plan !== undefined &&
      value.workers_ai_plan !== 'UNVERIFIED' &&
      value.workers_ai_plan !== 'FREE'
    )
      throw new BadRequestException('INVALID_WORKERS_AI_PLAN');
    const workersAiPlan = value.workers_ai_plan === 'FREE' ? 'FREE' : 'UNVERIFIED';
    if (
      value.paid_overage_disabled !== undefined &&
      typeof value.paid_overage_disabled !== 'boolean'
    )
      throw new BadRequestException('INVALID_PAID_OVERAGE_CONTROL');
    const paidOverageDisabled = value.paid_overage_disabled === true;
    const dailyNeuronLimit = parseMicrousd(
      value.daily_neuron_limit ?? WORKERS_FREE_DAILY_NEURON_CAP,
      'daily_neuron_limit',
    );
    const perRequestNeuronLimit = parseMicrousd(
      value.per_request_neuron_limit ?? PERSONAL_OWNER_DAILY_REQUEST_NEURON_CAP,
      'per_request_neuron_limit',
    );
    if (dailyNeuronLimit > WORKERS_FREE_DAILY_NEURON_CAP)
      throw new BadRequestException('DAILY_NEURON_LIMIT_EXCEEDS_LOCAL_CAP');
    if (perRequestNeuronLimit > PERSONAL_OWNER_DAILY_REQUEST_NEURON_CAP)
      throw new BadRequestException('REQUEST_NEURON_LIMIT_EXCEEDS_LOCAL_CAP');
    let planEvidenceUrl: string | null = null;
    let planEvidenceHash: string | null = null;
    let planVerifiedUntil: Date | null = null;
    if (workersAiPlan === 'FREE') {
      if (!enabled || !paidOverageDisabled || concurrency !== 1 || requestsPerMinute !== 1)
        throw new BadRequestException('WORKERS_FREE_REQUIRES_DISABLED_OVERAGE_AND_SINGLE_REQUESTS');
      planEvidenceUrl = requiredText(value, 'workers_ai_plan_evidence_url', 2048);
      if (!planEvidenceUrl.startsWith('https://'))
        throw new BadRequestException('WORKERS_FREE_EVIDENCE_URL_REQUIRED');
      planEvidenceHash = requireHash(
        value.workers_ai_plan_evidence_sha256,
        'workers_ai_plan_evidence_sha256',
      );
      planVerifiedUntil = dateValue(
        value.workers_ai_plan_verified_until,
        'workers_ai_plan_verified_until',
      );
      if (planVerifiedUntil === null || planVerifiedUntil <= this.now())
        throw new BadRequestException('WORKERS_FREE_EVIDENCE_EXPIRY_REQUIRED');
    } else if (paidOverageDisabled) {
      throw new BadRequestException('PAID_OVERAGE_CONFIRMATION_REQUIRES_FREE_PLAN_EVIDENCE');
    }
    await this.database.database.transaction().execute(async (tx) => {
      await tx
        .insertInto('personal_owner_budget_controls')
        .values({
          owner_identity: owner,
          enabled,
          emergency_stop: !enabled,
          per_request_limit_microusd: perRequest,
          daily_limit_microusd: daily,
          total_limit_microusd: total,
          max_concurrency: concurrency,
          max_requests_per_minute: requestsPerMinute,
          revoked_at: null,
          workers_ai_plan: workersAiPlan,
          paid_overage_disabled: paidOverageDisabled,
          workers_ai_plan_evidence_url: planEvidenceUrl,
          workers_ai_plan_evidence_sha256: planEvidenceHash,
          workers_ai_plan_verified_until: planVerifiedUntil?.toISOString() ?? null,
          daily_neuron_limit: dailyNeuronLimit,
          per_request_neuron_limit: perRequestNeuronLimit,
          updated_at: recordedAt,
        })
        .onConflict((conflict) =>
          conflict.column('owner_identity').doUpdateSet({
            enabled,
            emergency_stop: !enabled,
            per_request_limit_microusd: perRequest,
            daily_limit_microusd: daily,
            total_limit_microusd: total,
            max_concurrency: concurrency,
            max_requests_per_minute: requestsPerMinute,
            workers_ai_plan: workersAiPlan,
            paid_overage_disabled: paidOverageDisabled,
            workers_ai_plan_evidence_url: planEvidenceUrl,
            workers_ai_plan_evidence_sha256: planEvidenceHash,
            workers_ai_plan_verified_until: planVerifiedUntil?.toISOString() ?? null,
            daily_neuron_limit: dailyNeuronLimit,
            per_request_neuron_limit: perRequestNeuronLimit,
            updated_at: recordedAt,
          }),
        )
        .execute();
      await tx
        .insertInto('personal_owner_budget_control_events')
        .values({
          id: generateUlid({ now: () => Date.parse(recordedAt) }),
          owner_identity: owner,
          event_type: enabled ? 'REACTIVATED' : 'CONFIGURED',
          limits_snapshot: {
            per_request_limit_microusd: perRequest,
            daily_limit_microusd: daily,
            total_limit_microusd: total,
            max_concurrency: concurrency,
            max_requests_per_minute: requestsPerMinute,
            workers_ai_plan: workersAiPlan,
            paid_overage_disabled: paidOverageDisabled,
            daily_neuron_limit: dailyNeuronLimit,
            per_request_neuron_limit: perRequestNeuronLimit,
            enabled,
            emergency_stop: !enabled,
          },
          recorded_at: recordedAt,
        })
        .execute();
    });
    if (enabled && this.activeDispatcher.providerMode === 'disabled')
      return {
        ...(await this.budget()),
        activation_blocked_reason: 'PROVIDER_DISPATCHER_DISABLED',
      };
    return this.budget();
  }

  async emergencyStop() {
    const owner = this.assertOwnerMode();
    const recordedAt = this.now().toISOString();
    await this.database.database.transaction().execute(async (tx) => {
      await tx
        .insertInto('personal_owner_budget_controls')
        .values({
          owner_identity: owner,
          enabled: false,
          emergency_stop: true,
          per_request_limit_microusd: 0,
          daily_limit_microusd: 0,
          total_limit_microusd: 0,
          max_concurrency: 1,
          max_requests_per_minute: 1,
          revoked_at: null,
          updated_at: recordedAt,
        })
        .onConflict((conflict) =>
          conflict.column('owner_identity').doUpdateSet({
            enabled: false,
            emergency_stop: true,
            updated_at: recordedAt,
          }),
        )
        .execute();
      await tx
        .insertInto('personal_owner_budget_control_events')
        .values({
          id: generateUlid({ now: () => Date.parse(recordedAt) }),
          owner_identity: owner,
          event_type: 'EMERGENCY_STOPPED',
          limits_snapshot: { enabled: false, emergency_stop: true },
          recorded_at: recordedAt,
        })
        .execute();
    });
    this.activeDispatcher.cancelOwner(owner);
    await this.cancelQueuedJobs({ reason: 'EMERGENCY_STOP' });
    return this.budget();
  }

  async submitJob(articleIdValue: string, versionIdValue: string, idempotencyKeyValue: string) {
    const owner = this.assertOwnerMode();
    if (!/^[A-Za-z0-9._:-]{16,128}$/u.test(idempotencyKeyValue))
      throw new BadRequestException('INVALID_IDEMPOTENCY_KEY');
    const articleId = parseUlid(articleIdValue);
    const versionId = parseUlid(versionIdValue);
    const modelId = process.env.CLOUDFLARE_AI_MODEL?.trim() ?? CLOUDFLARE_GPT_OSS_20B_MODEL;
    if (!(CLOUDFLARE_SUPPORTED_MODELS as readonly string[]).includes(modelId))
      throw new BadRequestException('CLOUDFLARE_MODEL_UNSUPPORTED');
    const fingerprint = sha256(
      `${owner}\n${articleId}\n${versionId}\nllm_cloudflare_workers_ai\n${modelId}`,
    );
    interface Candidate {
      source_id: string;
      policy_id: string;
      content_access_mode: string | null;
      fulltext_acquisition: boolean | null;
      machine_processing: boolean | null;
      fulltext_persistence: boolean | null;
      policy_local_processing: boolean | null;
      policy_external_ai_transmission: boolean | null;
      derived_persistence: boolean | null;
      persisted_body: string | null;
      acquired_content_hash: string;
      normalized_input_hash: string;
      title_input_hash: string;
      source_decision_id: string | null;
      source_decision: string | null;
      scopes: RightsScope | null;
      local_processing: boolean | null;
      rights_evidence_sha256: string | null;
      valid_from: Date | null;
      expires_at: Date | null;
      exclusion_verified: boolean;
      prior_cloudflare_envelope: boolean;
      prior_provider_attempt: boolean;
      prior_active_job: boolean;
    }
    let result: { jobId: string; shouldDispatch: boolean };
    try {
      result = await this.database.database.transaction().execute(async (tx) => {
        const existing = await tx
          .selectFrom('personal_owner_operational_jobs')
          .select(['id', 'request_fingerprint_sha256', 'state'])
          .where('owner_identity', '=', owner)
          .where('idempotency_key', '=', idempotencyKeyValue)
          .executeTakeFirst();
        if (existing) {
          if (existing.request_fingerprint_sha256 !== fingerprint)
            throw new ConflictException('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST');
          return { jobId: String(existing.id), shouldDispatch: existing.state === 'PENDING' };
        }
        const articleSource = await tx
          .selectFrom('articles')
          .select('source_id')
          .where('id', '=', articleId)
          .executeTakeFirst();
        if (!articleSource) throw new NotFoundException('ARTICLE_VERSION_NOT_FOUND');
        await tx
          .selectFrom('prospective_content_rights_write_guards')
          .select('source_id')
          .where('source_id', '=', articleSource.source_id)
          .forUpdate()
          .executeTakeFirst();
        const found = await sql<Candidate>`
          select a.source_id::text as source_id,v.policy_id,v.acquired_content_hash,
            v.normalized_input_hash,v.title_input_hash,v.persisted_body,
            p.content_access_mode,p.fulltext_acquisition,
            p.fulltext_machine_processing as machine_processing,p.fulltext_persistence,
            p.local_processing as policy_local_processing,
            p.external_ai_transmission as policy_external_ai_transmission,
            p.derived_semantic_persistence as derived_persistence,
            d.id::text as source_decision_id,d.decision_status as source_decision,d.scopes,
            d.local_processing,d.rights_evidence_sha256,d.valid_from,d.expires_at,
            exists(select 1 from live_exposure_exclusions x
              join live_exposure_exclusions identity_x on identity_x.id=a.live_exposure_id
              where x.canonical_url=a.url_canonical and x.content_hash=v.acquired_content_hash
                and x.registry_key=identity_x.registry_key
                and x.exclusion_status='PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2') as exclusion_verified,
            exists(select 1 from semantic_envelopes e where e.article_version_id=v.id
              and e.provider_type='llm_cloudflare_workers_ai') as prior_cloudflare_envelope,
            exists(select 1 from personal_owner_operational_jobs prior
              left join personal_owner_provider_attempts attempt on attempt.job_id=prior.id
              where prior.article_version_id=v.id
                and (prior.attempt_count > 0 or attempt.id is not null)) as prior_provider_attempt,
            exists(select 1 from personal_owner_operational_jobs prior
              where prior.article_version_id=v.id
                and prior.state in ('PENDING','RUNNING','RECONCILIATION_REQUIRED')) as prior_active_job
          from articles a join observed_article_content_versions v on v.article_id=a.id
          join content_access_policies p on p.id=v.policy_id
          left join lateral (select * from personal_owner_source_rights_decisions
            where source_id=a.source_id order by sequence_number desc limit 1) d on true
          where a.id=${articleId} and v.id=${versionId} and v.source_id=a.source_id
            and a.origin='LIVE_REAL'
        `.execute(tx);
        const row = found.rows[0];
        if (!row) throw new NotFoundException('ARTICLE_VERSION_NOT_FOUND');
        const now = this.now();
        const sourceRights =
          row.source_decision === 'AUTHORIZED' &&
          row.valid_from !== null &&
          row.valid_from <= now &&
          (row.expires_at === null || row.expires_at > now) &&
          row.scopes?.acquisition === true &&
          row.scopes.metadata_storage &&
          row.scopes.excerpt_storage &&
          row.scopes.external_ai_transmission &&
          row.scopes.derived_semantic_persistence &&
          row.scopes.redisplay &&
          row.local_processing === true;
        const providerAuthorization = await tx
          .selectFrom('personal_owner_provider_authorizations')
          .selectAll()
          .where('owner_identity', '=', owner)
          .where('provider_type', '=', 'llm_cloudflare_workers_ai')
          .where('model_id', '=', modelId)
          .orderBy('recorded_at', 'desc')
          .orderBy('id', 'desc')
          .executeTakeFirst();
        const price = await tx
          .selectFrom('personal_owner_model_prices')
          .selectAll()
          .where('provider_type', '=', 'llm_cloudflare_workers_ai')
          .where('model_id', '=', modelId)
          .orderBy('recorded_at', 'desc')
          .orderBy('id', 'desc')
          .executeTakeFirst();
        const control = await tx
          .selectFrom('personal_owner_budget_controls')
          .selectAll()
          .where('owner_identity', '=', owner)
          .forUpdate()
          .executeTakeFirst();
        const activeProviderAuthorization =
          providerAuthorization?.decision_status === 'AUTHORIZED' &&
          isDecisionEffective(
            providerAuthorization.decision_status,
            providerAuthorization.valid_from,
            providerAuthorization.expires_at,
            now,
          );
        const activePrice =
          price?.decision_status === 'VERIFIED' &&
          isDecisionEffective(
            price.decision_status,
            price.valid_from,
            price.expires_at,
            now,
            'VERIFIED',
          );
        let blockedReason: string | null = null;
        if (!sourceRights) blockedReason = 'SOURCE_RIGHTS_NOT_AUTHORIZED';
        else if (
          row.content_access_mode !== 'EXCERPT_EPHEMERAL' ||
          row.fulltext_acquisition ||
          row.machine_processing ||
          row.fulltext_persistence ||
          row.persisted_body !== null ||
          !row.policy_local_processing ||
          !row.policy_external_ai_transmission ||
          !row.derived_persistence
        )
          blockedReason = 'ARTICLE_PROCESSING_POLICY_DENIED';
        else if (!row.exclusion_verified) blockedReason = 'EXCLUSION_PROVENANCE_MISSING';
        else if (row.prior_cloudflare_envelope) blockedReason = 'ARTICLE_VERSION_ALREADY_PROCESSED';
        else if (row.prior_provider_attempt)
          blockedReason = 'ARTICLE_VERSION_PROVIDER_ATTEMPT_ALREADY_USED';
        else if (row.prior_active_job) blockedReason = 'ARTICLE_VERSION_JOB_ALREADY_ACTIVE';
        else if (!activeProviderAuthorization) blockedReason = 'PROVIDER_AUTHORIZATION_REQUIRED';
        else if (!activePrice) blockedReason = 'MODEL_PRICE_UNVERIFIED';
        else if (
          this.activeDispatcher.providerMode === 'cloudflare' &&
          modelId !== CLOUDFLARE_GPT_OSS_20B_MODEL
        )
          blockedReason = 'MODEL_NOT_VERIFIED_FOR_WORKERS_FREE';
        else if (price.max_output_tokens < PERSONAL_OWNER_OUTPUT_TOKEN_LIMIT)
          blockedReason = 'MODEL_PRICE_OUTPUT_BOUND_TOO_SMALL';
        else if (
          modelId === CLOUDFLARE_GPT_OSS_20B_MODEL &&
          (price.max_input_tokens !== PERSONAL_OWNER_REQUEST_BYTE_LIMIT ||
            price.max_output_tokens !== PERSONAL_OWNER_OUTPUT_TOKEN_LIMIT ||
            price.input_neurons_per_million_tokens !== 18_182 ||
            price.output_neurons_per_million_tokens !== 27_273)
        )
          blockedReason = 'WORKERS_FREE_MODEL_PRICE_OR_REQUEST_BOUND_UNVERIFIED';
        else if (!control?.enabled || control.emergency_stop || control.revoked_at !== null)
          blockedReason = 'OWNER_BUDGET_DISABLED';
        else if (
          this.activeDispatcher.providerMode === 'cloudflare' &&
          (control.workers_ai_plan !== 'FREE' ||
            !control.paid_overage_disabled ||
            !control.workers_ai_plan_evidence_url ||
            !control.workers_ai_plan_evidence_sha256 ||
            control.workers_ai_plan_verified_until === null ||
            control.workers_ai_plan_verified_until <= now ||
            control.daily_neuron_limit > WORKERS_FREE_DAILY_NEURON_CAP ||
            control.per_request_neuron_limit > PERSONAL_OWNER_DAILY_REQUEST_NEURON_CAP ||
            control.max_concurrency !== 1 ||
            control.max_requests_per_minute !== 1)
        )
          blockedReason = 'WORKERS_FREE_PLAN_OR_NO_OVERAGE_NOT_VERIFIED';
        else if (this.activeDispatcher.providerMode === 'disabled')
          blockedReason = 'PROVIDER_DISPATCHER_DISABLED';

        const recordedAt = this.now().toISOString();
        const jobId = generateUlid({ now: () => Date.parse(recordedAt) });
        await tx
          .insertInto('personal_owner_operational_jobs')
          .values({
            id: jobId,
            owner_identity: owner,
            idempotency_key: idempotencyKeyValue,
            article_id: articleId,
            article_version_id: versionId,
            source_id: parseUlid(row.source_id),
            provider_type: 'llm_cloudflare_workers_ai',
            model_id: modelId,
            state: blockedReason ? 'BLOCKED' : 'PENDING',
            blocked_reason: blockedReason,
            request_fingerprint_sha256: fingerprint,
            attempt_count: 0,
            provider_request_started_at: null,
            created_at: recordedAt,
            updated_at: recordedAt,
            completed_at: null,
          })
          .execute();

        if (!blockedReason && price) {
          const maximumCost = Math.ceil(
            (price.max_input_tokens * price.input_microusd_per_1k_tokens +
              4096 * price.output_microusd_per_1k_tokens) /
              1000,
          );
          const reserveAmount = Math.max(1, maximumCost);
          const reservedNeurons =
            modelId === CLOUDFLARE_GPT_OSS_20B_MODEL &&
            this.activeDispatcher.providerMode === 'cloudflare'
              ? Math.ceil(
                  (price.max_input_tokens * price.input_neurons_per_million_tokens) / 1_000_000,
                ) +
                Math.ceil(
                  (PERSONAL_OWNER_OUTPUT_TOKEN_LIMIT * price.output_neurons_per_million_tokens) /
                    1_000_000,
                )
              : null;
          if (
            !Number.isSafeInteger(reserveAmount) ||
            reserveAmount > 2_000_000_000 ||
            (reservedNeurons !== null &&
              (!Number.isSafeInteger(reservedNeurons) ||
                reservedNeurons < 1 ||
                reservedNeurons > 2000000000))
          ) {
            blockedReason = 'PRICE_RESERVATION_OVERFLOW';
            await tx
              .updateTable('personal_owner_operational_jobs')
              .set({
                state: 'BLOCKED',
                blocked_reason: blockedReason,
                updated_at: this.now().toISOString(),
              })
              .where('id', '=', jobId)
              .execute();
          } else {
            let neuronReservationId: ReturnType<typeof generateUlid> | null = null;
            let neuronReserved = false;
            if (reservedNeurons !== null) {
              neuronReservationId = generateUlid({ now: Date.now });
              const neuronAdmission = await sql<{ allowed: boolean }>`
                select dialektik_reserve_personal_owner_neurons(
                  ${neuronReservationId},${jobId},${owner},${modelId},${reservedNeurons}
                ) as allowed
              `.execute(tx);
              neuronReserved = neuronAdmission.rows[0]?.allowed === true;
              if (!neuronReserved) blockedReason = 'NEURON_BUDGET_RESERVATION_DENIED';
            }
            const reservationId = generateUlid({ now: Date.now });
            const reserved = blockedReason
              ? null
              : await sql<{ allowed: boolean }>`
                  select dialektik_reserve_personal_owner_budget(
                    ${reservationId},${jobId},${owner},${price.id},${reserveAmount}
                  ) as allowed
                `.execute(tx);
            if (blockedReason) {
              await tx
                .updateTable('personal_owner_operational_jobs')
                .set({
                  state: 'BLOCKED',
                  blocked_reason: blockedReason,
                  updated_at: this.now().toISOString(),
                })
                .where('id', '=', jobId)
                .execute();
            } else if (reserved?.rows[0]?.allowed !== true) {
              blockedReason = 'BUDGET_RESERVATION_DENIED';
              if (neuronReserved && neuronReservationId) {
                const releasedAt = this.now().toISOString();
                await tx
                  .updateTable('personal_owner_neuron_reservations')
                  .set({ state: 'RELEASED', updated_at: releasedAt })
                  .where('id', '=', neuronReservationId)
                  .execute();
                await tx
                  .insertInto('personal_owner_neuron_events')
                  .values({
                    id: generateUlid({ now: () => Date.parse(releasedAt) }),
                    reservation_id: neuronReservationId,
                    event_type: 'RELEASED',
                    reserved_neurons: reservedNeurons ?? 0,
                    actual_neurons: null,
                    recorded_at: releasedAt,
                  })
                  .execute();
              }
              await tx
                .updateTable('personal_owner_operational_jobs')
                .set({
                  state: 'BLOCKED',
                  blocked_reason: blockedReason,
                  updated_at: this.now().toISOString(),
                })
                .where('id', '=', jobId)
                .execute();
            } else {
              const grantReceipt = row.rights_evidence_sha256;
              if (!row.source_decision_id || !grantReceipt)
                throw new ConflictException('SOURCE_RIGHTS_EVIDENCE_MISSING');
              for (const grantArticleId of [null, articleId] as const) {
                await tx
                  .insertInto('llm_processing_route_grants')
                  .values({
                    id: generateUlid({ now: Date.now }),
                    source_id: parseUlid(row.source_id),
                    article_id: grantArticleId,
                    policy_id: row.policy_id,
                    provider_type: 'llm_cloudflare_workers_ai',
                    processing_route: 'EXTERNAL_LLM_PROCESSING_ALLOWED',
                    fulltext_acquisition: false,
                    machine_processing: false,
                    derived_persistence: true,
                    fulltext_persistence: false,
                    evidence_fragments: false,
                    rights_receipt_sha256: grantReceipt,
                    recorded_at: sql<Date>`date_trunc('milliseconds',clock_timestamp())`,
                  })
                  .execute();
              }
            }
          }
        }
        await this.appendJobEvent(
          tx,
          String(jobId),
          blockedReason ? 'BLOCKED' : 'PENDING',
          blockedReason,
        );
        await tx
          .insertInto('personal_owner_audit_events')
          .values({
            id: generateUlid({ now: () => Date.parse(recordedAt) + 1 }),
            owner_identity: owner,
            event_type: 'OPERATIONAL_JOB_SUBMITTED',
            request_fingerprint_sha256: sha256(
              `${owner}\nOPERATIONAL_JOB_SUBMITTED\n${jobId}\n${fingerprint}`,
            ),
            recorded_at: recordedAt,
          })
          .execute();
        return { jobId: String(jobId), shouldDispatch: blockedReason === null };
      });
    } catch (error) {
      if (
        OBJECT(error) &&
        error.code === '23505' &&
        error.constraint === 'personal_owner_operational_jobs_one_attempt_per_version'
      ) {
        const priorAttempt = await this.database.database
          .selectFrom('personal_owner_operational_jobs')
          .select('id')
          .where('article_version_id', '=', versionId)
          .where('attempt_count', '>', 0)
          .executeTakeFirst();
        throw new ConflictException(
          priorAttempt
            ? 'ARTICLE_VERSION_PROVIDER_ATTEMPT_ALREADY_USED'
            : 'ARTICLE_VERSION_JOB_ALREADY_ACTIVE',
        );
      }
      const existing = await this.database.database
        .selectFrom('personal_owner_operational_jobs')
        .select(['id', 'request_fingerprint_sha256', 'state'])
        .where('owner_identity', '=', owner)
        .where('idempotency_key', '=', idempotencyKeyValue)
        .executeTakeFirst();
      if (!existing) throw error;
      if (existing.request_fingerprint_sha256 !== fingerprint)
        throw new ConflictException('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST');
      result = { jobId: String(existing.id), shouldDispatch: existing.state === 'PENDING' };
    }
    if (result.shouldDispatch) this.activeDispatcher.enqueue(result.jobId);
    return this.job(result.jobId);
  }

  async cancelJob(jobIdValue: string) {
    const owner = this.assertOwnerMode();
    const jobId = parseUlid(jobIdValue);
    const result = await this.database.database.transaction().execute(async (tx) => {
      const job = await tx
        .selectFrom('personal_owner_operational_jobs')
        .selectAll()
        .where('id', '=', jobId)
        .where('owner_identity', '=', owner)
        .forUpdate()
        .executeTakeFirst();
      if (!job) throw new NotFoundException('JOB_NOT_FOUND');
      if (job.state === 'RUNNING' && job.attempt_count === 1)
        return { requested: true, runningAttempt: true };
      if (job.state !== 'PENDING' && !(job.state === 'RUNNING' && job.attempt_count === 0))
        throw new ConflictException('JOB_CANNOT_BE_CANCELLED_IN_CURRENT_STATE');
      const recordedAt = this.now().toISOString();
      await tx
        .updateTable('personal_owner_operational_jobs')
        .set({
          state: 'CANCELLED',
          blocked_reason: null,
          completed_at: recordedAt,
          updated_at: recordedAt,
        })
        .where('id', '=', jobId)
        .execute();
      await this.releaseReservation(tx, String(jobId), 'RELEASED');
      await this.releaseNeuronReservation(tx, String(jobId), 'RELEASED');
      await this.appendJobEvent(tx, String(jobId), 'CANCELLED', 'OWNER_CANCELLED');
      await tx
        .insertInto('personal_owner_audit_events')
        .values({
          id: generateUlid({ now: () => Date.parse(recordedAt) }),
          owner_identity: owner,
          event_type: 'OPERATIONAL_JOB_CANCELLED',
          request_fingerprint_sha256: sha256(
            `${owner}\nOPERATIONAL_JOB_CANCELLED\n${jobId}\nOWNER_CANCELLED`,
          ),
          recorded_at: recordedAt,
        })
        .execute();
      return { requested: true, runningAttempt: false };
    });
    if (result.runningAttempt) this.activeDispatcher.cancelJob(String(jobId));
    return {
      ...(await this.job(String(jobId))),
      cancellation_requested: result.runningAttempt,
      provider_outcome_may_require_reconciliation: result.runningAttempt,
    };
  }

  async reconcileJob(jobIdValue: string, value: unknown) {
    const owner = this.assertOwnerMode();
    const jobId = parseUlid(jobIdValue);
    if (!OBJECT(value)) throw new BadRequestException('INVALID_BUDGET_RECONCILIATION');
    const outcome = value.outcome;
    if (outcome !== 'CHARGED' && outcome !== 'NOT_CHARGED')
      throw new BadRequestException('INVALID_RECONCILIATION_OUTCOME');
    const evidenceUrl = requiredText(value, 'evidence_url', 2048);
    if (!evidenceUrl.startsWith('https://')) throw new BadRequestException('INVALID_EVIDENCE_URL');
    const evidenceHash = requireHash(value.evidence_sha256, 'evidence_sha256');
    const actual =
      outcome === 'CHARGED' ? parseMicrousd(value.actual_microusd, 'actual_microusd', true) : null;
    if (
      outcome === 'NOT_CHARGED' &&
      value.actual_microusd !== undefined &&
      value.actual_microusd !== null
    )
      throw new BadRequestException('NOT_CHARGED_REQUIRES_NULL_ACTUAL');
    await this.database.database.transaction().execute(async (tx) => {
      const job = await tx
        .selectFrom('personal_owner_operational_jobs')
        .selectAll()
        .where('id', '=', jobId)
        .where('owner_identity', '=', owner)
        .forUpdate()
        .executeTakeFirst();
      if (!job) throw new NotFoundException('JOB_NOT_FOUND');
      const reservation = await tx
        .selectFrom('personal_owner_budget_reservations')
        .selectAll()
        .where('job_id', '=', jobId)
        .forUpdate()
        .executeTakeFirst();
      const attempt = await tx
        .selectFrom('personal_owner_provider_attempts')
        .selectAll()
        .where('job_id', '=', jobId)
        .executeTakeFirst();
      if (
        reservation?.state !== 'RECONCILIATION_REQUIRED' ||
        !attempt ||
        !['OUTCOME_UNKNOWN', 'RESPONSE_RECEIVED'].includes(attempt.state)
      )
        throw new ConflictException('JOB_DOES_NOT_REQUIRE_BILLING_RECONCILIATION');
      const recordedAt = this.now().toISOString();
      await tx
        .insertInto('personal_owner_budget_reconciliations')
        .values({
          id: generateUlid({ now: () => Date.parse(recordedAt) }),
          job_id: jobId,
          owner_identity: owner,
          outcome,
          actual_microusd: actual,
          evidence_url: evidenceUrl,
          evidence_sha256: evidenceHash,
          recorded_at: recordedAt,
        })
        .execute();
      await tx
        .updateTable('personal_owner_budget_reservations')
        .set({
          state: outcome === 'CHARGED' ? 'SETTLED' : 'RELEASED',
          actual_microusd: actual,
          updated_at: recordedAt,
        })
        .where('id', '=', reservation.id)
        .execute();
      await tx
        .insertInto('personal_owner_budget_events')
        .values({
          id: generateUlid({ now: () => Date.parse(recordedAt) + 1 }),
          reservation_id: reservation.id,
          event_type: outcome === 'CHARGED' ? 'SETTLED' : 'RELEASED',
          reserved_microusd: reservation.reserved_microusd,
          actual_microusd: actual,
          recorded_at: recordedAt,
        })
        .execute();
      if (job.state === 'RECONCILIATION_REQUIRED') {
        await tx
          .updateTable('personal_owner_operational_jobs')
          .set({
            state: 'FAILED',
            blocked_reason: null,
            completed_at: recordedAt,
            updated_at: recordedAt,
          })
          .where('id', '=', jobId)
          .execute();
        await this.appendJobEvent(tx, String(jobId), 'FAILED', 'SEMANTIC_RESULT_NOT_CONFIRMED');
      }
      await tx
        .insertInto('personal_owner_audit_events')
        .values({
          id: generateUlid({ now: () => Date.parse(recordedAt) + 2 }),
          owner_identity: owner,
          event_type: 'BUDGET_RECONCILED',
          request_fingerprint_sha256: sha256(
            `${owner}\nBUDGET_RECONCILED\n${jobId}\n${outcome}\n${actual === null ? '' : String(actual)}\n${evidenceHash}`,
          ),
          recorded_at: recordedAt,
        })
        .execute();
    });
    return { ...(await this.job(String(jobId))), billing_reconciliation: 'OWNER_RECORDED' };
  }

  async jobs() {
    const owner = this.assertOwnerMode();
    const rows = await this.database.database
      .selectFrom('personal_owner_operational_jobs')
      .selectAll()
      .where('owner_identity', '=', owner)
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();
    return { items: rows };
  }

  async job(jobIdValue: string) {
    const owner = this.assertOwnerMode();
    const jobId = parseUlid(jobIdValue);
    const job = await this.database.database
      .selectFrom('personal_owner_operational_jobs')
      .selectAll()
      .where('id', '=', jobId)
      .where('owner_identity', '=', owner)
      .executeTakeFirst();
    if (!job) throw new NotFoundException('JOB_NOT_FOUND');
    const events = await this.database.database
      .selectFrom('personal_owner_operational_job_events')
      .select(['sequence_number', 'state', 'error_category', 'recorded_at'])
      .where('job_id', '=', jobId)
      .orderBy('sequence_number')
      .execute();
    const providerAttempt = await this.database.database
      .selectFrom('personal_owner_provider_attempts')
      .selectAll()
      .where('job_id', '=', jobId)
      .executeTakeFirst();
    const budgetReservation = await this.database.database
      .selectFrom('personal_owner_budget_reservations')
      .selectAll()
      .where('job_id', '=', jobId)
      .executeTakeFirst();
    const observations = await sql<{
      envelope_id: string;
      observation_key: string;
      decision: string;
      applicability: string;
      proposed_occurrence_key: string | null;
      proposed_thread_key: string | null;
      provider_type: string;
      provider_version: string;
      content_access_mode: string;
      processed_at: Date;
      evidence: readonly {
        field: string;
        span_start: number;
        span_end: number;
        field_hash: string;
        span_hash: string;
      }[];
    }>`
      select e.id as envelope_id,o.observation_key,o.decision,o.applicability,
        o.proposed_occurrence_key,o.proposed_thread_key,e.provider_type,e.provider_version,
        policy.content_access_mode,e.processed_at,
        coalesce((select jsonb_agg(jsonb_build_object('field',f.field,'span_start',f.span_start,
          'span_end',f.span_end,'field_hash',f.field_hash,'span_hash',f.span_hash)
          order by f.id) from evidence_fingerprints f where f.envelope_id=e.id),'[]'::jsonb) as evidence
      from semantic_envelopes e join derived_semantic_observations o on o.envelope_id=e.id
      join observed_article_content_versions version on version.id=e.article_version_id
      join content_access_policies policy on policy.id=version.policy_id
      join semantic_processing_records processed on processed.article_version_id=e.article_version_id
        and processed.provider_run_id=e.provider_run_id and processed.processing_state='PROCESSED_SHADOW'
      join lateral (select decision_status,scopes,valid_from,expires_at
        from personal_owner_source_rights_decisions
        where source_id=${job.source_id} order by sequence_number desc limit 1) rights on true
      where e.article_version_id=${job.article_version_id} and e.provider_run_id=${jobId}
        and rights.decision_status='AUTHORIZED'
        and rights.valid_from <= clock_timestamp()
        and (rights.expires_at is null or rights.expires_at > clock_timestamp())
        and (rights.scopes->>'derived_semantic_persistence')::boolean
        and (rights.scopes->>'redisplay')::boolean
      order by e.processed_at desc,o.id limit 100
    `.execute(this.database.database);
    return {
      job,
      events,
      provider_attempt: providerAttempt ?? null,
      budget_reservation: budgetReservation ?? null,
      observations: observations.rows.map((item) => ({
        ...item,
        authority: 'SHADOW_NOT_AUTHORITATIVE',
      })),
    };
  }
}
