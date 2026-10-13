import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { generateUlid, parseUlid, type Database } from '@dialektik/database';
import { sql, type Kysely, type Selectable } from 'kysely';
import type { CoreApiConfig } from '../config/core-api-config.js';
import { CORE_API_CONFIG } from '../config/core-api-config.js';
import { CoreDatabaseService } from '../database/core-database.service.js';
import { sha256 } from '../llm-shadow/llm.schema.js';

export const PERSONAL_OWNER_TEST_RUNNER = 'PERSONAL_OWNER_TEST_RUNNER';
export const PERSONAL_OWNER_TEST_MODE = 'ISOLATED_TEST_ONLY';
export const TEST_PROVIDER = 'llm_cloudflare_workers_ai' as const;
export const TEST_MODEL = '@cf/openai/gpt-oss-20b' as const;

type TestAuthorization = Selectable<Database['personal_owner_test_authorizations']>;
type TestJob = Selectable<Database['personal_owner_test_jobs']>;
type TestJobRuntime = Selectable<Database['personal_owner_test_job_runtime']>;
export type PersonalOwnerTestJobState = TestJobRuntime['state'];

export interface PersonalOwnerTestJobRequest {
  readonly fixtureId: 'synthetic-govuk-title-only-v1';
  readonly idempotencyKey: string;
  readonly inferenceAuthorizationId: string;
  readonly persistenceAuthorizationId: string;
  readonly ownerIdentity: string;
  readonly sourceId: string;
  readonly articleId: string;
  readonly articleVersionId: string;
  readonly projectionVersionId: string;
  readonly projectionSha256: string;
}

export interface PersonalOwnerTestObservation {
  readonly providerRunId: string;
  readonly projectionSha256: string;
  readonly schemaSha256: string;
  readonly skillSha256: string;
  readonly derivativeSha256: string;
  readonly applicability:
    | 'OBSERVATION_AVAILABLE'
    | 'INSUFFICIENT_EVIDENCE'
    | 'NOT_APPLICABLE'
    | 'AMBIGUOUS';
  readonly eventNuggetCount: number;
  readonly factCount: number;
  readonly groundedFactCount: number;
  readonly unsupportedFactCount: number;
  readonly validEvidenceReferenceCount: number;
  readonly invalidEvidenceReferenceCount: number;
  readonly semanticDerivatives: unknown;
  readonly evidenceLocators: unknown;
}

export interface PersonalOwnerTestSafeFact {
  readonly kind: string;
  readonly valueSha256: string;
  readonly evidenceBlockIds: readonly string[];
  readonly support: string;
  readonly normalizedTime: Readonly<{
    normalizedValue: string | null;
    rule: string | null;
    uncertainty: string;
  }> | null;
}

export interface PersonalOwnerTestSafeSemanticDerivatives {
  readonly eventCandidate: 'TRUE' | 'FALSE' | 'UNCERTAIN';
  readonly missingOrUncertainCount: number;
  readonly facts: readonly PersonalOwnerTestSafeFact[];
}

export interface PersonalOwnerTestSafeEvidenceLocator {
  readonly blockId: string;
  readonly field: 'title';
  readonly start: number;
  readonly end: number;
  readonly sourceSha256: string;
  readonly spanSha256: string;
}

/** Closed, sanitized representation exposed by the owner shadow API. */
export type PersonalOwnerTestObservationSummary = Omit<
  PersonalOwnerTestObservation,
  'semanticDerivatives' | 'evidenceLocators'
> & {
  readonly semanticDerivatives: PersonalOwnerTestSafeSemanticDerivatives;
  readonly evidenceLocators: readonly PersonalOwnerTestSafeEvidenceLocator[];
};

function safeSemanticDerivatives(value: unknown): PersonalOwnerTestSafeSemanticDerivatives {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('PERSONAL_TEST_OBSERVATION_INVALID');
  const candidate = parsed as Record<string, unknown>;
  if (
    !['TRUE', 'FALSE', 'UNCERTAIN'].includes(String(candidate.eventCandidate)) ||
    !Number.isSafeInteger(candidate.missingOrUncertainCount) ||
    Number(candidate.missingOrUncertainCount) < 0 ||
    !Array.isArray(candidate.facts) ||
    candidate.facts.length > 30
  )
    throw new Error('PERSONAL_TEST_OBSERVATION_INVALID');
  const facts = candidate.facts.map((raw): PersonalOwnerTestSafeFact => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('PERSONAL_TEST_OBSERVATION_INVALID');
    const fact = raw as Record<string, unknown>;
    const evidenceBlockIds = fact.evidenceBlockIds;
    const normalized = fact.normalizedTime;
    let normalizedTime: PersonalOwnerTestSafeFact['normalizedTime'] = null;
    if (normalized !== null && normalized !== undefined) {
      if (typeof normalized !== 'object' || Array.isArray(normalized))
        throw new Error('PERSONAL_TEST_OBSERVATION_INVALID');
      const time = normalized as Record<string, unknown>;
      const normalizedValue = time.normalizedValue;
      const rule = time.rule;
      const uncertainty = time.uncertainty;
      if (
        !(
          normalizedValue === null ||
          (typeof normalizedValue === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(normalizedValue))
        ) ||
        !(rule === null || (typeof rule === 'string' && /^[A-Z_]{1,48}$/u.test(rule))) ||
        typeof uncertainty !== 'string' ||
        !/^[A-Z_]{1,48}$/u.test(uncertainty)
      )
        throw new Error('PERSONAL_TEST_OBSERVATION_INVALID');
      normalizedTime = { normalizedValue, rule, uncertainty };
    }
    if (
      typeof fact.kind !== 'string' ||
      !/^[a-z_]{1,48}$/u.test(fact.kind) ||
      typeof fact.valueSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(fact.valueSha256) ||
      !Array.isArray(evidenceBlockIds) ||
      evidenceBlockIds.length > 4 ||
      !evidenceBlockIds.every((item) => typeof item === 'string' && /^B\d{3}$/u.test(item)) ||
      typeof fact.support !== 'string' ||
      !['SUPPORTED_DIRECT', 'SUPPORTED_NORMALIZED', 'UNSUPPORTED', 'AMBIGUOUS_SUPPORT'].includes(
        fact.support,
      )
    )
      throw new Error('PERSONAL_TEST_OBSERVATION_INVALID');
    return {
      kind: fact.kind,
      valueSha256: fact.valueSha256,
      evidenceBlockIds,
      support: fact.support,
      normalizedTime,
    };
  });
  return {
    eventCandidate:
      candidate.eventCandidate as PersonalOwnerTestSafeSemanticDerivatives['eventCandidate'],
    missingOrUncertainCount: Number(candidate.missingOrUncertainCount),
    facts,
  };
}

function safeEvidenceLocators(value: unknown): readonly PersonalOwnerTestSafeEvidenceLocator[] {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(parsed) || parsed.length > 120)
    throw new Error('PERSONAL_TEST_OBSERVATION_INVALID');
  return parsed.map((raw) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('PERSONAL_TEST_OBSERVATION_INVALID');
    const locator = raw as Record<string, unknown>;
    if (
      locator.blockId !== 'B001' ||
      locator.field !== 'title' ||
      !Number.isSafeInteger(locator.start) ||
      !Number.isSafeInteger(locator.end) ||
      Number(locator.start) < 0 ||
      Number(locator.end) <= Number(locator.start) ||
      typeof locator.sourceSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(locator.sourceSha256) ||
      typeof locator.spanSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(locator.spanSha256)
    )
      throw new Error('PERSONAL_TEST_OBSERVATION_INVALID');
    return {
      blockId: 'B001',
      field: 'title',
      start: Number(locator.start),
      end: Number(locator.end),
      sourceSha256: locator.sourceSha256,
      spanSha256: locator.spanSha256,
    };
  });
}

export function summarizePersonalOwnerTestObservation(
  observation: PersonalOwnerTestObservation,
): PersonalOwnerTestObservationSummary {
  return {
    providerRunId: observation.providerRunId,
    projectionSha256: observation.projectionSha256,
    schemaSha256: observation.schemaSha256,
    skillSha256: observation.skillSha256,
    derivativeSha256: observation.derivativeSha256,
    applicability: observation.applicability,
    eventNuggetCount: observation.eventNuggetCount,
    factCount: observation.factCount,
    groundedFactCount: observation.groundedFactCount,
    unsupportedFactCount: observation.unsupportedFactCount,
    validEvidenceReferenceCount: observation.validEvidenceReferenceCount,
    invalidEvidenceReferenceCount: observation.invalidEvidenceReferenceCount,
    semanticDerivatives: safeSemanticDerivatives(observation.semanticDerivatives),
    evidenceLocators: safeEvidenceLocators(observation.evidenceLocators),
  };
}

export interface PersonalOwnerTestRunner {
  run(
    request: PersonalOwnerTestJobRequest,
    signal: AbortSignal,
    beforeProviderRequest: () => Promise<void>,
  ): Promise<PersonalOwnerTestObservation>;
}

export interface PersonalOwnerTestJobResult {
  readonly jobId: string;
  readonly state: PersonalOwnerTestJobState;
  readonly duplicate: boolean;
  readonly observation: PersonalOwnerTestObservationSummary | null;
  readonly errorCategory: string | null;
}

function id(value: string, code: string): ReturnType<typeof parseUlid> {
  try {
    return parseUlid(value);
  } catch {
    throw new Error(code);
  }
}

function assertHash(value: string, code: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error(code);
}

function isPersonalOwnerTestScope(value: string): boolean {
  return value === PERSONAL_OWNER_TEST_MODE;
}

function nextLifecycleSequenceNumber(currentMaximum: number | null): number {
  const next = (currentMaximum ?? 0) + 1;
  if (!Number.isSafeInteger(next) || next < 1)
    throw new Error('PERSONAL_TEST_LIFECYCLE_SEQUENCE_INVALID');
  return next;
}

function assertProviderRequestStarted(started: boolean): void {
  if (!started) throw new Error('PERSONAL_TEST_PROVIDER_MARKER_REQUIRED');
}

function assertRequestShape(value: unknown): asserts value is PersonalOwnerTestJobRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('PERSONAL_TEST_JOB_REQUEST_INVALID');
  const keys = Object.keys(value).sort().join('\0');
  const expected = [
    'articleId',
    'articleVersionId',
    'fixtureId',
    'idempotencyKey',
    'inferenceAuthorizationId',
    'ownerIdentity',
    'persistenceAuthorizationId',
    'projectionSha256',
    'projectionVersionId',
    'sourceId',
  ]
    .sort()
    .join('\0');
  if (keys !== expected) throw new Error('PERSONAL_TEST_JOB_REQUEST_INVALID');
  const request = value as Record<string, unknown>;
  if (
    request.fixtureId !== 'synthetic-govuk-title-only-v1' ||
    typeof request.idempotencyKey !== 'string' ||
    !/^[A-Za-z0-9_.:-]{8,128}$/u.test(request.idempotencyKey) ||
    typeof request.ownerIdentity !== 'string' ||
    !/^synthetic-owner-[A-Za-z0-9_.:-]{1,48}$/u.test(request.ownerIdentity) ||
    typeof request.sourceId !== 'string' ||
    typeof request.articleId !== 'string' ||
    typeof request.articleVersionId !== 'string' ||
    typeof request.projectionVersionId !== 'string' ||
    typeof request.inferenceAuthorizationId !== 'string' ||
    typeof request.persistenceAuthorizationId !== 'string' ||
    typeof request.projectionSha256 !== 'string'
  )
    throw new Error('PERSONAL_TEST_JOB_REQUEST_INVALID');
  id(request.sourceId, 'PERSONAL_TEST_JOB_SCOPE_INVALID');
  id(request.articleId, 'PERSONAL_TEST_JOB_SCOPE_INVALID');
  id(request.articleVersionId, 'PERSONAL_TEST_JOB_SCOPE_INVALID');
  id(request.projectionVersionId, 'PERSONAL_TEST_JOB_SCOPE_INVALID');
  id(request.inferenceAuthorizationId, 'PERSONAL_TEST_AUTHORIZATION_INVALID');
  id(request.persistenceAuthorizationId, 'PERSONAL_TEST_AUTHORIZATION_INVALID');
  assertHash(request.projectionSha256, 'PERSONAL_TEST_JOB_SCOPE_INVALID');
}

function isIdempotencyConflict(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return (
    candidate.code === '23505' &&
    (candidate.constraint === 'personal_owner_test_jobs_owner_identity_idempotency_key_key' ||
      candidate.constraint === 'personal_owner_test_jobs_owner_identity_idempotency_key')
  );
}

@Injectable()
export class PersonalOwnerTestWorkflowService implements OnModuleInit, OnModuleDestroy {
  private readonly workerId = randomUUID();
  private workerTimer: NodeJS.Timeout | undefined;
  private workerBusy = false;
  private get leaseDurationMs(): number {
    if (process.env.NODE_ENV !== 'test') return 30_000;
    const value = Number(process.env.DIALEKTIK_PERSONAL_OWNER_TEST_LEASE_MS ?? 30_000);
    return Number.isSafeInteger(value) && value >= 500 && value <= 30_000 ? value : 30_000;
  }

  constructor(
    @Inject(CORE_API_CONFIG) private readonly config: Readonly<CoreApiConfig>,
    @Inject(CoreDatabaseService) private readonly database: CoreDatabaseService,
    @Inject(PERSONAL_OWNER_TEST_RUNNER) private readonly runner: PersonalOwnerTestRunner,
  ) {}

  private async databaseNow(database: Kysely<Database>): Promise<Date> {
    const clock = await sql<{ now: Date }>`
      select date_trunc('milliseconds', clock_timestamp()) as now
    `.execute(database);
    const now = clock.rows[0]?.now;
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
      throw new Error('PERSONAL_TEST_DATABASE_CLOCK_UNAVAILABLE');
    return now;
  }

  private assertEnabled(): void {
    let databaseUrl: URL;
    try {
      databaseUrl = new URL(this.config.databaseUrl);
    } catch {
      throw new ServiceUnavailableException('PERSONAL_OWNER_TEST_MODE_DISABLED');
    }
    if (
      !['test', 'development'].includes(this.config.nodeEnvironment) ||
      this.config.ownershipMode !== 'personal' ||
      this.config.semanticMode !== 'unassigned' ||
      !['127.0.0.1', 'localhost', '::1'].includes(this.config.host) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(databaseUrl.hostname) ||
      !/^\/dialektik_test_[a-z0-9_]+$/u.test(databaseUrl.pathname) ||
      process.env.DIALEKTIK_PERSONAL_OWNER_TEST_MODE !== '1' ||
      process.env.DIALEKTIK_PERSONAL_OWNER_TEST_PROVIDER_MODE !== 'mock'
    )
      throw new ServiceUnavailableException('PERSONAL_OWNER_TEST_MODE_DISABLED');
  }

  onModuleInit(): void {
    try {
      this.assertEnabled();
    } catch {
      return;
    }
    if (
      process.env.NODE_ENV === 'test' &&
      process.env.DIALEKTIK_PERSONAL_OWNER_TEST_PAUSE_WORKER === '1'
    )
      return;
    this.workerTimer = setInterval(() => {
      if (this.workerBusy) return;
      this.workerBusy = true;
      void this.processNext()
        .catch(() => undefined)
        .finally(() => {
          this.workerBusy = false;
        });
    }, 200);
    this.workerTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.workerTimer) clearInterval(this.workerTimer);
    this.workerTimer = undefined;
  }

  private async activeAuthorization(
    database: Kysely<Database>,
    request: PersonalOwnerTestJobRequest,
    idValue: string,
    operation: TestAuthorization['operation'],
    now: Date,
  ): Promise<TestAuthorization> {
    const authorizationId = id(idValue, 'PERSONAL_TEST_AUTHORIZATION_INVALID');
    const rows = await database
      .selectFrom('personal_owner_test_authorizations')
      .selectAll()
      .where('owner_identity', '=', request.ownerIdentity)
      .where('source_id', '=', id(request.sourceId, 'PERSONAL_TEST_JOB_SCOPE_INVALID'))
      .where('article_id', '=', id(request.articleId, 'PERSONAL_TEST_JOB_SCOPE_INVALID'))
      .where(
        'article_version_id',
        '=',
        id(request.articleVersionId, 'PERSONAL_TEST_JOB_SCOPE_INVALID'),
      )
      .where(
        'projection_version_id',
        '=',
        id(request.projectionVersionId, 'PERSONAL_TEST_JOB_SCOPE_INVALID'),
      )
      .where('provider_type', '=', TEST_PROVIDER)
      .where('model_id', '=', TEST_MODEL)
      .where('operation', '=', operation)
      .orderBy('recorded_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    const latest = rows[0];
    if (!latest) throw new ForbiddenException('PERSONAL_OWNER_TEST_AUTHORIZATION_REQUIRED');
    if (
      latest.id !== authorizationId ||
      latest.decision_status !== 'APPROVED' ||
      latest.revoked_at !== null ||
      !isPersonalOwnerTestScope(latest.environment_scope) ||
      latest.valid_from > now ||
      latest.expires_at <= now
    )
      throw new ForbiddenException('PERSONAL_OWNER_TEST_AUTHORIZATION_REQUIRED');
    return latest;
  }

  private async verifyExistingExternalGrant(
    database: Kysely<Database>,
    request: PersonalOwnerTestJobRequest,
  ): Promise<void> {
    const result = await sql<{ allowed: boolean }>`
      select dialektik_cloudflare_official_api_hash_only_route_allowed(
        ${id(request.sourceId, 'PERSONAL_TEST_JOB_SCOPE_INVALID')},
        ${id(request.articleId, 'PERSONAL_TEST_JOB_SCOPE_INVALID')},
        ${id(request.articleVersionId, 'PERSONAL_TEST_JOB_SCOPE_INVALID')},
        ${id(request.projectionVersionId, 'PERSONAL_TEST_JOB_SCOPE_INVALID')},
        (select policy_id from official_api_hash_only_projection_versions where id=${id(request.projectionVersionId, 'PERSONAL_TEST_JOB_SCOPE_INVALID')}),
        (select acquired_content_sha256 from official_api_hash_only_projection_versions where id=${id(request.projectionVersionId, 'PERSONAL_TEST_JOB_SCOPE_INVALID')}),
        (select projection_policy_version from official_api_hash_only_projection_versions where id=${id(request.projectionVersionId, 'PERSONAL_TEST_JOB_SCOPE_INVALID')}),
        ${request.projectionSha256}, ${TEST_PROVIDER}, ${TEST_MODEL}
      ) as allowed
    `.execute(database);
    if (result.rows[0]?.allowed !== true)
      throw new ForbiddenException('PERSONAL_OWNER_TEST_EXTERNAL_GRANT_REQUIRED');
  }

  private async readJob(
    database: Kysely<Database>,
    jobId: string,
    ownerIdentity: string,
  ): Promise<PersonalOwnerTestJobResult | null> {
    const job = await database
      .selectFrom('personal_owner_test_jobs')
      .selectAll()
      .where('id', '=', id(jobId, 'PERSONAL_TEST_JOB_ID_INVALID'))
      .where('owner_identity', '=', ownerIdentity)
      .executeTakeFirst();
    if (!job) return null;
    const runtime = await database
      .selectFrom('personal_owner_test_job_runtime')
      .selectAll()
      .where('job_id', '=', job.id)
      .executeTakeFirst();
    const observation = await database
      .selectFrom('personal_owner_test_shadow_observations')
      .selectAll()
      .where('job_id', '=', job.id)
      .executeTakeFirst();
    return {
      jobId: String(job.id),
      state: runtime?.state ?? 'FAILED',
      duplicate: false,
      observation:
        observation === undefined
          ? null
          : summarizePersonalOwnerTestObservation({
              providerRunId: observation.provider_run_id,
              projectionSha256: observation.projection_sha256,
              schemaSha256: observation.schema_sha256,
              skillSha256: observation.skill_sha256,
              derivativeSha256: observation.derivative_sha256,
              applicability: observation.applicability,
              eventNuggetCount: observation.event_nugget_count,
              factCount: observation.fact_count,
              groundedFactCount: observation.grounded_fact_count,
              unsupportedFactCount: observation.unsupported_fact_count,
              validEvidenceReferenceCount: observation.valid_evidence_reference_count,
              invalidEvidenceReferenceCount: observation.invalid_evidence_reference_count,
              semanticDerivatives: observation.semantic_derivatives,
              evidenceLocators: observation.evidence_locators,
            }),
      errorCategory: runtime?.error_category ?? null,
    };
  }

  async start(value: unknown): Promise<PersonalOwnerTestJobResult> {
    this.assertEnabled();
    assertRequestShape(value);
    const request = value;
    if (request.ownerIdentity !== this.config.personalOwnerId)
      throw new ForbiddenException('PERSONAL_OWNER_TEST_OWNER_MISMATCH');
    const database = this.database.database;
    const now = await this.databaseNow(database);
    const requestFingerprint = sha256(JSON.stringify(request));
    let reservation: { job: TestJob; duplicate: boolean };
    try {
      reservation = await database.transaction().execute(async (transaction) => {
        const existing = await transaction
          .selectFrom('personal_owner_test_jobs')
          .selectAll()
          .where('owner_identity', '=', request.ownerIdentity)
          .where('idempotency_key', '=', request.idempotencyKey)
          .executeTakeFirst();
        if (existing) {
          if (existing.request_fingerprint_sha256 !== requestFingerprint)
            throw new Error('PERSONAL_TEST_IDEMPOTENCY_SCOPE_MISMATCH');
          return { job: existing, duplicate: true };
        }
        await this.activeAuthorization(
          transaction,
          request,
          request.inferenceAuthorizationId,
          'MOCKED_TITLE_ONLY_INFERENCE',
          now,
        );
        await this.activeAuthorization(
          transaction,
          request,
          request.persistenceAuthorizationId,
          'MOCKED_DERIVED_SHADOW_PERSISTENCE',
          now,
        );
        await this.verifyExistingExternalGrant(transaction, request);
        const job = {
          id: generateUlid({ now: () => now.getTime() }),
          owner_identity: request.ownerIdentity,
          idempotency_key: request.idempotencyKey,
          inference_authorization_id: id(
            request.inferenceAuthorizationId,
            'PERSONAL_TEST_AUTHORIZATION_INVALID',
          ),
          persistence_authorization_id: id(
            request.persistenceAuthorizationId,
            'PERSONAL_TEST_AUTHORIZATION_INVALID',
          ),
          source_id: id(request.sourceId, 'PERSONAL_TEST_JOB_SCOPE_INVALID'),
          article_id: id(request.articleId, 'PERSONAL_TEST_JOB_SCOPE_INVALID'),
          article_version_id: id(request.articleVersionId, 'PERSONAL_TEST_JOB_SCOPE_INVALID'),
          projection_version_id: id(request.projectionVersionId, 'PERSONAL_TEST_JOB_SCOPE_INVALID'),
          projection_sha256: request.projectionSha256,
          provider_type: TEST_PROVIDER,
          model_id: TEST_MODEL,
          request_fingerprint_sha256: requestFingerprint,
          environment_scope: PERSONAL_OWNER_TEST_MODE,
          created_at: now,
        } as const;
        await transaction.insertInto('personal_owner_test_jobs').values(job).execute();
        await transaction
          .insertInto('personal_owner_test_job_events')
          .values({
            id: generateUlid({ now: () => now.getTime() + 1 }),
            job_id: job.id,
            sequence_number: 1,
            state: 'RESERVED',
            observation_id: null,
            error_category: null,
            recorded_at: now,
          })
          .execute();
        return { job, duplicate: false };
      });
    } catch (error) {
      if (!isIdempotencyConflict(error)) throw error;
      const existing = await database
        .selectFrom('personal_owner_test_jobs')
        .selectAll()
        .where('owner_identity', '=', request.ownerIdentity)
        .where('idempotency_key', '=', request.idempotencyKey)
        .executeTakeFirst();
      if (!existing) throw error;
      if (existing.request_fingerprint_sha256 !== requestFingerprint)
        throw new Error('PERSONAL_TEST_IDEMPOTENCY_SCOPE_MISMATCH');
      reservation = { job: existing, duplicate: true };
    }
    if (reservation.duplicate) {
      const existing = await this.readJob(
        database,
        String(reservation.job.id),
        request.ownerIdentity,
      );
      if (!existing) throw new Error('PERSONAL_TEST_JOB_STATE_MISSING');
      return { ...existing, duplicate: true };
    }
    const result = await this.readJob(database, String(reservation.job.id), request.ownerIdentity);
    if (!result) throw new Error('PERSONAL_TEST_JOB_STATE_MISSING');
    return result;
  }

  private async appendLifecycle(
    transaction: Kysely<Database>,
    jobId: TestJob['id'],
    state: TestJobRuntime['state'] | 'PROVIDER_REQUEST_STARTED',
    workerId: string | null,
    attemptCount: number,
    errorCategory: string | null = null,
  ): Promise<void> {
    const latest = await transaction
      .selectFrom('personal_owner_test_job_lifecycle_events')
      .select(({ fn }) => fn.max('sequence_number').as('max'))
      .where('job_id', '=', jobId)
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('personal_owner_test_job_lifecycle_events')
      .values({
        id: generateUlid({ now: Date.now }),
        job_id: jobId,
        sequence_number: nextLifecycleSequenceNumber(latest.max),
        state,
        worker_id: workerId,
        attempt_count: attemptCount,
        error_category: errorCategory,
        recorded_at: await this.databaseNow(transaction),
      })
      .execute();
  }

  private async claimNext(workerId: string): Promise<TestJob | null> {
    const database = this.database.database;
    return database.transaction().execute(async (transaction) => {
      const runtime = await transaction
        .selectFrom('personal_owner_test_job_runtime')
        .selectAll()
        .where('state', 'in', ['PENDING', 'RECOVERABLE'])
        .where('attempt_count', '=', 0)
        .orderBy('updated_at', 'asc')
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!runtime) return null;
      const now = await this.databaseNow(transaction);
      await transaction
        .updateTable('personal_owner_test_job_runtime')
        .set({
          state: 'RUNNING',
          lease_owner: workerId,
          lease_expires_at: new Date(now.getTime() + this.leaseDurationMs),
          heartbeat_at: now,
          updated_at: now,
          error_category: null,
        })
        .where('job_id', '=', runtime.job_id)
        .execute();
      await this.appendLifecycle(transaction, runtime.job_id, 'RUNNING', workerId, 0);
      const job = await transaction
        .selectFrom('personal_owner_test_jobs')
        .selectAll()
        .where('id', '=', runtime.job_id)
        .executeTakeFirstOrThrow();
      const legacyLatest = await transaction
        .selectFrom('personal_owner_test_job_events')
        .selectAll()
        .where('job_id', '=', runtime.job_id)
        .orderBy('sequence_number', 'desc')
        .executeTakeFirstOrThrow();
      if (legacyLatest.state === 'RESERVED') {
        await transaction
          .insertInto('personal_owner_test_job_events')
          .values({
            id: generateUlid({ now: Date.now }),
            job_id: runtime.job_id,
            sequence_number: legacyLatest.sequence_number + 1,
            state: 'RUNNING',
            observation_id: null,
            error_category: null,
            recorded_at: now,
          })
          .execute();
      }
      return job;
    });
  }

  private async heartbeatLease(jobId: TestJob['id'], workerId: string): Promise<void> {
    await this.database.database.transaction().execute(async (transaction) => {
      const now = await this.databaseNow(transaction);
      await transaction
        .updateTable('personal_owner_test_job_runtime')
        .set({
          lease_expires_at: new Date(now.getTime() + this.leaseDurationMs),
          heartbeat_at: now,
          updated_at: now,
        })
        .where('job_id', '=', jobId)
        .where('state', '=', 'RUNNING')
        .where('lease_owner', '=', workerId)
        .execute();
    });
  }

  private async holdAtTestCrashPoint(point: string): Promise<void> {
    if (
      process.env.NODE_ENV === 'test' &&
      process.env.DIALEKTIK_PERSONAL_OWNER_TEST_HOLD_AT === point
    )
      await new Promise<void>(() => undefined);
  }

  private async markProviderRequestStarted(jobId: TestJob['id'], workerId: string): Promise<void> {
    await this.database.database.transaction().execute(async (transaction) => {
      const runtime = await transaction
        .selectFrom('personal_owner_test_job_runtime')
        .selectAll()
        .where('job_id', '=', jobId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (
        runtime.state !== 'RUNNING' ||
        runtime.lease_owner !== workerId ||
        runtime.attempt_count !== 0
      )
        throw new Error('PERSONAL_TEST_JOB_LEASE_LOST');
      const now = await this.databaseNow(transaction);
      await transaction
        .updateTable('personal_owner_test_job_runtime')
        .set({
          attempt_count: 1,
          provider_request_started_at: now,
          heartbeat_at: now,
          lease_expires_at: new Date(now.getTime() + this.leaseDurationMs),
          updated_at: now,
        })
        .where('job_id', '=', jobId)
        .execute();
      await this.appendLifecycle(transaction, jobId, 'PROVIDER_REQUEST_STARTED', workerId, 1);
    });
  }

  async recoverExpiredJobs(): Promise<number> {
    this.assertEnabled();
    const database = this.database.database;
    return database.transaction().execute(async (transaction) => {
      const now = await this.databaseNow(transaction);
      const expired = await transaction
        .selectFrom('personal_owner_test_job_runtime')
        .selectAll()
        .where('state', '=', 'RUNNING')
        .where('lease_expires_at', '<=', now)
        .orderBy('lease_expires_at', 'asc')
        .forUpdate()
        .skipLocked()
        .execute();
      for (const runtime of expired) {
        if (runtime.attempt_count === 1) {
          await transaction
            .updateTable('personal_owner_test_job_runtime')
            .set({
              state: 'RECONCILIATION_REQUIRED',
              lease_owner: null,
              lease_expires_at: null,
              heartbeat_at: null,
              updated_at: now,
              error_category: 'PROVIDER_OUTCOME_UNKNOWN',
            })
            .where('job_id', '=', runtime.job_id)
            .execute();
          await this.appendLifecycle(
            transaction,
            runtime.job_id,
            'RECONCILIATION_REQUIRED',
            null,
            1,
            'PROVIDER_OUTCOME_UNKNOWN',
          );
        } else if (runtime.safe_recovery_count < 3) {
          await transaction
            .updateTable('personal_owner_test_job_runtime')
            .set({
              state: 'RECOVERABLE',
              lease_owner: null,
              lease_expires_at: null,
              heartbeat_at: null,
              safe_recovery_count: runtime.safe_recovery_count + 1,
              updated_at: now,
              error_category: 'WORKER_INTERRUPTED_BEFORE_PROVIDER',
            })
            .where('job_id', '=', runtime.job_id)
            .execute();
          await this.appendLifecycle(
            transaction,
            runtime.job_id,
            'RECOVERABLE',
            null,
            0,
            'WORKER_INTERRUPTED_BEFORE_PROVIDER',
          );
        } else {
          await transaction
            .updateTable('personal_owner_test_job_runtime')
            .set({
              state: 'FAILED',
              lease_owner: null,
              lease_expires_at: null,
              heartbeat_at: null,
              completed_at: now,
              updated_at: now,
              error_category: 'SAFE_RECOVERY_LIMIT_REACHED',
            })
            .where('job_id', '=', runtime.job_id)
            .execute();
          await this.appendLifecycle(
            transaction,
            runtime.job_id,
            'FAILED',
            null,
            0,
            'SAFE_RECOVERY_LIMIT_REACHED',
          );
          const legacyLatest = await transaction
            .selectFrom('personal_owner_test_job_events')
            .selectAll()
            .where('job_id', '=', runtime.job_id)
            .orderBy('sequence_number', 'desc')
            .executeTakeFirstOrThrow();
          if (legacyLatest.state === 'RUNNING')
            await transaction
              .insertInto('personal_owner_test_job_events')
              .values({
                id: generateUlid({ now: Date.now }),
                job_id: runtime.job_id,
                sequence_number: legacyLatest.sequence_number + 1,
                state: 'FAILED',
                observation_id: null,
                error_category: 'SAFE_RECOVERY_LIMIT_REACHED',
                recorded_at: now,
              })
              .execute();
        }
      }
      return expired.length;
    });
  }

  async processNext(workerId = this.workerId): Promise<boolean> {
    this.assertEnabled();
    await this.recoverExpiredJobs();
    const job = await this.claimNext(workerId);
    if (!job) return false;
    let heartbeatBusy = false;
    const heartbeatTimer = setInterval(
      () => {
        if (heartbeatBusy) return;
        heartbeatBusy = true;
        void this.heartbeatLease(job.id, workerId)
          .catch(() => undefined)
          .finally(() => {
            heartbeatBusy = false;
          });
      },
      Math.max(250, Math.floor(this.leaseDurationMs / 3)),
    );
    heartbeatTimer.unref();
    const request: PersonalOwnerTestJobRequest = {
      fixtureId: 'synthetic-govuk-title-only-v1',
      idempotencyKey: job.idempotency_key,
      inferenceAuthorizationId: String(job.inference_authorization_id),
      persistenceAuthorizationId: String(job.persistence_authorization_id),
      ownerIdentity: job.owner_identity,
      sourceId: String(job.source_id),
      articleId: String(job.article_id),
      articleVersionId: String(job.article_version_id),
      projectionVersionId: String(job.projection_version_id),
      projectionSha256: job.projection_sha256,
    };
    let providerStarted = false;
    let failureStage:
      | 'PRE_PROVIDER'
      | 'AUTHORIZATION'
      | 'PROVIDER_PIPELINE'
      | 'POST_PROVIDER_PERSISTENCE' = 'PRE_PROVIDER';
    const markStarted = async () => {
      await this.markProviderRequestStarted(job.id, workerId);
      providerStarted = true;
    };
    try {
      await this.holdAtTestCrashPoint('AFTER_CLAIM_BEFORE_PROVIDER');
      failureStage = 'AUTHORIZATION';
      const authorizationNow = await this.databaseNow(this.database.database);
      await this.activeAuthorization(
        this.database.database,
        request,
        request.inferenceAuthorizationId,
        'MOCKED_TITLE_ONLY_INFERENCE',
        authorizationNow,
      );
      await this.activeAuthorization(
        this.database.database,
        request,
        request.persistenceAuthorizationId,
        'MOCKED_DERIVED_SHADOW_PERSISTENCE',
        authorizationNow,
      );
      await this.verifyExistingExternalGrant(this.database.database, request);
      failureStage = 'PROVIDER_PIPELINE';
      const observation = await this.runner.run(request, new AbortController().signal, markStarted);
      assertProviderRequestStarted(providerStarted);
      await this.holdAtTestCrashPoint('AFTER_PROVIDER_RESPONSE_BEFORE_PERSISTENCE');
      failureStage = 'POST_PROVIDER_PERSISTENCE';
      await this.activeAuthorization(
        this.database.database,
        request,
        request.persistenceAuthorizationId,
        'MOCKED_DERIVED_SHADOW_PERSISTENCE',
        await this.databaseNow(this.database.database),
      );
      await this.database.database.transaction().execute(async (transaction) => {
        const runtime = await transaction
          .selectFrom('personal_owner_test_job_runtime')
          .selectAll()
          .where('job_id', '=', job.id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (runtime.state !== 'RUNNING' || runtime.lease_owner !== workerId)
          throw new Error('PERSONAL_TEST_JOB_LEASE_LOST');
        const now = await this.databaseNow(transaction);
        const observationId = generateUlid({ now: Date.now });
        await transaction
          .insertInto('personal_owner_test_shadow_observations')
          .values({
            id: observationId,
            job_id: job.id,
            source_id: job.source_id,
            article_id: job.article_id,
            article_version_id: job.article_version_id,
            projection_version_id: job.projection_version_id,
            provider_run_id: observation.providerRunId,
            provider_type: TEST_PROVIDER,
            model_id: TEST_MODEL,
            projection_sha256: observation.projectionSha256,
            schema_sha256: observation.schemaSha256,
            skill_sha256: observation.skillSha256,
            derivative_sha256: observation.derivativeSha256,
            applicability: observation.applicability,
            event_nugget_count: observation.eventNuggetCount,
            fact_count: observation.factCount,
            grounded_fact_count: observation.groundedFactCount,
            unsupported_fact_count: observation.unsupportedFactCount,
            valid_evidence_reference_count: observation.validEvidenceReferenceCount,
            invalid_evidence_reference_count: observation.invalidEvidenceReferenceCount,
            semantic_derivatives: JSON.stringify(observation.semanticDerivatives),
            evidence_locators: JSON.stringify(observation.evidenceLocators),
            recorded_at: now,
          })
          .execute();
        await transaction
          .updateTable('personal_owner_test_job_runtime')
          .set({
            state: 'COMPLETED',
            lease_owner: null,
            lease_expires_at: null,
            heartbeat_at: null,
            completed_at: now,
            updated_at: now,
            error_category: null,
          })
          .where('job_id', '=', job.id)
          .execute();
        await this.appendLifecycle(transaction, job.id, 'COMPLETED', null, 1);
        const latest = await transaction
          .selectFrom('personal_owner_test_job_events')
          .selectAll()
          .where('job_id', '=', job.id)
          .orderBy('sequence_number', 'desc')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('personal_owner_test_job_events')
          .values({
            id: generateUlid({ now: Date.now }),
            job_id: job.id,
            sequence_number: latest.sequence_number + 1,
            state: 'SUCCEEDED',
            observation_id: observationId,
            error_category: null,
            recorded_at: now,
          })
          .execute();
      });
      await this.holdAtTestCrashPoint('AFTER_PERSISTENCE_COMMIT_BEFORE_ACK');
    } catch (error) {
      const errorCategory =
        error instanceof Error && /^[A-Z0-9_.:-]{1,96}$/u.test(error.message)
          ? error.message
          : `PERSONAL_TEST_${failureStage}_FAILED`;
      await this.database.database.transaction().execute(async (transaction) => {
        const runtime = await transaction
          .selectFrom('personal_owner_test_job_runtime')
          .selectAll()
          .where('job_id', '=', job.id)
          .forUpdate()
          .executeTakeFirst();
        if (runtime?.state !== 'RUNNING' || runtime.lease_owner !== workerId) return;
        const now = await this.databaseNow(transaction);
        const nextState = providerStarted ? 'RECONCILIATION_REQUIRED' : 'FAILED';
        await transaction
          .updateTable('personal_owner_test_job_runtime')
          .set({
            state: nextState,
            lease_owner: null,
            lease_expires_at: null,
            heartbeat_at: null,
            completed_at: providerStarted ? null : now,
            updated_at: now,
            error_category: providerStarted ? 'PROVIDER_OUTCOME_UNKNOWN' : errorCategory,
          })
          .where('job_id', '=', job.id)
          .execute();
        await this.appendLifecycle(
          transaction,
          job.id,
          nextState,
          null,
          providerStarted ? 1 : 0,
          providerStarted ? 'PROVIDER_OUTCOME_UNKNOWN' : errorCategory,
        );
        if (!providerStarted) {
          const latest = await transaction
            .selectFrom('personal_owner_test_job_events')
            .selectAll()
            .where('job_id', '=', job.id)
            .orderBy('sequence_number', 'desc')
            .executeTakeFirstOrThrow();
          if (latest.state === 'RUNNING')
            await transaction
              .insertInto('personal_owner_test_job_events')
              .values({
                id: generateUlid({ now: Date.now }),
                job_id: job.id,
                sequence_number: latest.sequence_number + 1,
                state: 'FAILED',
                observation_id: null,
                error_category: errorCategory,
                recorded_at: now,
              })
              .execute();
        }
      });
    } finally {
      clearInterval(heartbeatTimer);
    }
    return true;
  }

  async get(jobId: string, ownerIdentity: string): Promise<PersonalOwnerTestJobResult> {
    this.assertEnabled();
    if (ownerIdentity !== this.config.personalOwnerId)
      throw new Error('PERSONAL_TEST_OWNER_MISMATCH');
    if (!/^synthetic-owner-[A-Za-z0-9_.:-]{1,48}$/u.test(ownerIdentity))
      throw new Error('PERSONAL_TEST_OWNER_INVALID');
    const result = await this.readJob(this.database.database, jobId, ownerIdentity);
    if (!result) throw new Error('PERSONAL_TEST_JOB_NOT_FOUND');
    return result;
  }

  async cancel(jobId: string, ownerIdentity: string): Promise<PersonalOwnerTestJobResult> {
    this.assertEnabled();
    if (ownerIdentity !== this.config.personalOwnerId)
      throw new Error('PERSONAL_TEST_OWNER_MISMATCH');
    const database = this.database.database;
    await database.transaction().execute(async (transaction) => {
      const job = await transaction
        .selectFrom('personal_owner_test_jobs')
        .select('id')
        .where('id', '=', id(jobId, 'PERSONAL_TEST_JOB_ID_INVALID'))
        .where('owner_identity', '=', ownerIdentity)
        .forUpdate()
        .executeTakeFirst();
      if (!job) throw new Error('PERSONAL_TEST_JOB_NOT_FOUND');
      const runtime = await transaction
        .selectFrom('personal_owner_test_job_runtime')
        .selectAll()
        .where('job_id', '=', job.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (runtime.state !== 'PENDING' || runtime.attempt_count !== 0)
        throw new Error('PERSONAL_TEST_JOB_NOT_CANCELLABLE');
      const latest = await transaction
        .selectFrom('personal_owner_test_job_events')
        .selectAll()
        .where('job_id', '=', job.id)
        .orderBy('sequence_number', 'desc')
        .executeTakeFirst();
      if (latest?.state !== 'RESERVED') throw new Error('PERSONAL_TEST_JOB_NOT_CANCELLABLE');
      const now = await this.databaseNow(transaction);
      await transaction
        .updateTable('personal_owner_test_job_runtime')
        .set({ state: 'CANCELLED', completed_at: now, updated_at: now })
        .where('job_id', '=', job.id)
        .execute();
      await this.appendLifecycle(transaction, job.id, 'CANCELLED', null, 0);
      await transaction
        .insertInto('personal_owner_test_job_events')
        .values({
          id: generateUlid({ now: () => now.getTime() }),
          job_id: job.id,
          sequence_number: latest.sequence_number + 1,
          state: 'CANCELLED',
          observation_id: null,
          error_category: null,
          recorded_at: now,
        })
        .execute();
    });
    return {
      jobId,
      state: 'CANCELLED',
      duplicate: false,
      observation: null,
      errorCategory: null,
    };
  }
}
