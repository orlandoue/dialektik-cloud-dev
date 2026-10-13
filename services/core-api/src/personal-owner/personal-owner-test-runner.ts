import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { generateUlid, parseUlid, type Database } from '@dialektik/database';
import { sql, type Kysely } from 'kysely';
import { CoreDatabaseService } from '../database/core-database.service.js';
import { CloudflareWorkersAITransport } from '../llm-shadow/llm.cloudflare.js';
import {
  CLOUDFLARE_GPT_OSS_20B_MODEL,
  CLOUDFLARE_PROVIDER_TYPE,
  createCloudflareProfile,
} from '../llm-shadow/llm.cloudflare-config.js';
import type { LLMGeneration } from '../llm-shadow/llm.contracts.js';
import { CloudflareTitleOnlyProjectionRepository } from '../llm-shadow/llm.title-only-repository.js';
import { DurableTitleOnlyProjectionReceiptWriter } from '../llm-shadow/llm.title-only-projection-receipts.js';
import {
  runTitleOnlyProjectionShadow,
  titleOnlyPersistenceValues,
  TITLE_ONLY_CLOUDFLARE_PROVIDER,
  TITLE_ONLY_GPT_OSS_MODEL,
  type TitleOnlyProjectionContext,
  type TitleOnlySemanticEnvelope,
} from '../llm-shadow/llm.title-only-projection.js';
import type { EventAnalystValidation } from '../llm-shadow/llm.event-analyst.js';
import {
  type PersonalOwnerTestJobRequest,
  type PersonalOwnerTestObservation,
  type PersonalOwnerTestRunner,
} from './personal-owner-test-workflow.js';
import { PersonalOwnerTestArticlesService } from './personal-owner-test-articles.js';

const SYNTHETIC_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
const SYNTHETIC_TOKEN = 'dialektik-isolated-test-only-token';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function requiredLoopbackUrl(name: string, expectedPath: string): URL {
  const value = process.env[name];
  if (!value) throw new ServiceUnavailableException('PERSONAL_TEST_MOCK_ENDPOINT_REQUIRED');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ServiceUnavailableException('PERSONAL_TEST_MOCK_ENDPOINT_INVALID');
  }
  if (
    url.protocol !== 'http:' ||
    !LOOPBACK.has(url.hostname) ||
    url.pathname !== expectedPath ||
    url.search !== '' ||
    url.hash !== '' ||
    url.username !== '' ||
    url.password !== ''
  )
    throw new ServiceUnavailableException('PERSONAL_TEST_MOCK_ENDPOINT_INVALID');
  return url;
}

function boundedBody(response: Response, maximumBytes: number): Promise<Buffer> {
  const responseBody = response.body;
  if (!responseBody) throw new Error('PERSONAL_TEST_MOCK_RESPONSE_MISSING');
  return (async () => {
    const reader = responseBody.getReader();
    const chunks: Buffer[] = [];
    let length = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > maximumBytes) {
          await reader.cancel();
          throw new Error('PERSONAL_TEST_MOCK_RESPONSE_TOO_LARGE');
        }
        chunks.push(Buffer.from(chunk.value));
      }
      return Buffer.concat(chunks, length);
    } finally {
      reader.releaseLock();
    }
  })();
}

async function currentPersistenceAuthorization(
  database: Kysely<Database>,
  request: PersonalOwnerTestJobRequest,
): Promise<boolean> {
  const clock = await sql<{ now: Date }>`
    select date_trunc('milliseconds', clock_timestamp()) as now
  `.execute(database);
  const now = clock.rows[0]?.now;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new Error('PERSONAL_TEST_DATABASE_CLOCK_UNAVAILABLE');
  const authorization = await database
    .selectFrom('personal_owner_test_authorizations')
    .selectAll()
    .where('id', '=', parseUlid(request.persistenceAuthorizationId))
    .where('owner_identity', '=', request.ownerIdentity)
    .where('source_id', '=', parseUlid(request.sourceId))
    .where('article_id', '=', parseUlid(request.articleId))
    .where('article_version_id', '=', parseUlid(request.articleVersionId))
    .where('projection_version_id', '=', parseUlid(request.projectionVersionId))
    .where('provider_type', '=', TITLE_ONLY_CLOUDFLARE_PROVIDER)
    .where('model_id', '=', TITLE_ONLY_GPT_OSS_MODEL)
    .where('operation', '=', 'MOCKED_DERIVED_SHADOW_PERSISTENCE')
    .executeTakeFirst();
  return (
    authorization?.decision_status === 'APPROVED' &&
    authorization.valid_from <= now &&
    authorization.expires_at > now
  );
}

function requireEphemeralCapture(
  value: {
    envelope: TitleOnlySemanticEnvelope;
    validation: EventAnalystValidation;
  } | null,
): { envelope: TitleOnlySemanticEnvelope; validation: EventAnalystValidation } {
  if (value === null) throw new Error('PERSONAL_TEST_CORE_VALIDATION_FAILED');
  return value;
}

@Injectable()
export class PersonalOwnerTestRunnerAdapter implements PersonalOwnerTestRunner {
  private readonly profile = createCloudflareProfile(CLOUDFLARE_GPT_OSS_20B_MODEL, {
    maxArticles: 1,
    maxCalls: 1,
    timeoutMs: 8_000,
  });

  constructor(
    private readonly database: CoreDatabaseService,
    private readonly articles: PersonalOwnerTestArticlesService,
  ) {}

  async run(
    request: PersonalOwnerTestJobRequest,
    signal: AbortSignal,
    beforeProviderRequest: () => Promise<void>,
  ): Promise<PersonalOwnerTestObservation> {
    this.assertTestRuntime();
    const input = await this.articles.loadVerifiedInput(request);
    const context = input.context as TitleOnlyProjectionContext;
    const repository = new CloudflareTitleOnlyProjectionRepository(this.database.database);
    const providerEndpoint = requiredLoopbackUrl(
      'DIALEKTIK_PERSONAL_OWNER_TEST_PROVIDER_URL',
      '/workers-ai/run',
    );
    const expectedProviderUrl = `https://api.cloudflare.com/client/v4/accounts/${SYNTHETIC_ACCOUNT_ID}/ai/run/${CLOUDFLARE_GPT_OSS_20B_MODEL}`;
    const mockOnlyFetch: typeof fetch = async (resource, init) => {
      const actualUrl = resource instanceof Request ? resource.url : String(resource);
      const headers = new Headers(init?.headers);
      if (
        actualUrl !== expectedProviderUrl ||
        init?.method !== 'POST' ||
        headers.get('authorization') !== `Bearer ${SYNTHETIC_TOKEN}` ||
        headers.get('content-type') !== 'application/json' ||
        typeof init.body !== 'string'
      )
        throw new Error('PERSONAL_TEST_PROVIDER_BOUNDARY_REJECTED');

      // The Cloudflare transport remains the real application transport/normalizer.
      // Its only request function in this mode forwards to the explicitly loopback mock.
      await beforeProviderRequest();
      const mockHeaders = new Headers(headers);
      mockHeaders.delete('authorization');
      const mockResponse = await fetch(providerEndpoint, {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        headers: mockHeaders,
        body: init.body,
        ...(init.signal === undefined ? {} : { signal: init.signal }),
      });
      const contentType = mockResponse.headers.get('content-type')?.split(';', 1)[0]?.trim();
      if (!mockResponse.ok || contentType?.toLowerCase() !== 'application/json') {
        await mockResponse.body?.cancel().catch(() => undefined);
        throw new Error('PERSONAL_TEST_PROVIDER_MOCK_RESPONSE_INVALID');
      }
      const bytes = await boundedBody(mockResponse, 262_144);
      return new Response(Uint8Array.from(bytes), {
        status: mockResponse.status,
        headers: { 'content-type': 'application/json' },
      });
    };
    const transport = new CloudflareWorkersAITransport(
      this.profile,
      mockOnlyFetch,
      { CLOUDFLARE_ACCOUNT_ID: SYNTHETIC_ACCOUNT_ID, CLOUDFLARE_API_TOKEN: SYNTHETIC_TOKEN },
      input.skillInstruction,
    );
    const provider = {
      provider: CLOUDFLARE_PROVIDER_TYPE,
      model: CLOUDFLARE_GPT_OSS_20B_MODEL,
      providerConfigVersion: this.profile.config.providerVersion,
      generateDetailed: (
        modelInput: Parameters<typeof transport.generate>[1],
        schema: unknown,
        providerSignal: AbortSignal,
      ): Promise<LLMGeneration> =>
        transport.generate('extraction', modelInput, schema, providerSignal),
    };
    let ephemeral: {
      envelope: TitleOnlySemanticEnvelope;
      validation: EventAnalystValidation;
    } | null = null;
    const receiptRoot = process.env.DIALEKTIK_PERSONAL_OWNER_TEST_RECEIPT_DIR;
    if (!receiptRoot) throw new Error('PERSONAL_TEST_RECEIPT_DIRECTORY_REQUIRED');
    // Each isolated synthetic job gets its own one-shot receipt namespace. The
    // production writer still enforces one attempt per Article/version/projection
    // within that job; the test harness may exercise distinct durable jobs.
    const testJobReceiptRoot = resolve(
      receiptRoot,
      'synthetic-jobs',
      createHash('sha256').update(request.idempotencyKey, 'utf8').digest('hex'),
    );
    const receipts = new DurableTitleOnlyProjectionReceiptWriter(testJobReceiptRoot);
    try {
      const outcome = await runTitleOnlyProjectionShadow(
        context,
        input.projection,
        input.skillInstruction,
        {
          provider,
          authorization: {
            isAllowed: async (scope, candidate) => {
              if (scope === 'EXTERNAL_INFERENCE') return repository.isAllowed(scope, candidate);
              return currentPersistenceAuthorization(this.database.database, request);
            },
            reserveAttempt: (candidate, runId) => repository.reserveAttempt(candidate, runId),
            recordAttemptOutcome: (candidate, runId, result) =>
              repository.recordAttemptOutcome(candidate, runId, result),
          },
          persistence: {
            persist(envelope, validation) {
              ephemeral = { envelope, validation };
              return Promise.resolve();
            },
          },
          receipts,
          createRunId: randomUUID,
        },
        signal,
      );
      if (outcome.receipt.status === 'PROVIDER_FAILED')
        throw new Error('PERSONAL_TEST_PROVIDER_OUTCOME_UNKNOWN');
      if (outcome.receipt.status !== 'VALIDATED_PERSISTED')
        throw new Error('PERSONAL_TEST_CORE_VALIDATION_FAILED');
      const captured = requireEphemeralCapture(ephemeral);
      const row = titleOnlyPersistenceValues({
        envelope: captured.envelope,
        validation: captured.validation,
        id: String(generateUlid({ now: Date.now })),
        recordedAt: new Date().toISOString(),
        schemaSha256: context.schemaSha256,
        skillSha256: context.skillSha256,
      });
      return {
        providerRunId: row.provider_run_id,
        projectionSha256: row.projection_sha256,
        schemaSha256: row.schema_sha256,
        skillSha256: row.skill_sha256,
        derivativeSha256: row.derivative_sha256,
        applicability: row.applicability,
        eventNuggetCount: row.event_nugget_count,
        factCount: row.fact_count,
        groundedFactCount: row.grounded_fact_count,
        unsupportedFactCount: row.unsupported_fact_count,
        validEvidenceReferenceCount: row.valid_evidence_reference_count,
        invalidEvidenceReferenceCount: row.invalid_evidence_reference_count,
        semanticDerivatives: JSON.parse(String(row.semantic_derivatives)) as unknown,
        evidenceLocators: JSON.parse(String(row.evidence_locators)) as unknown,
      };
    } finally {
      transport.dispose();
      // The validated envelope and the original title projection are kept only for
      // the duration of this run; the durable test record is hash/locator-only.
      ephemeral = null;
    }
  }

  private assertTestRuntime(): void {
    if (
      !['test', 'development'].includes(process.env.NODE_ENV ?? '') ||
      process.env.DIALEKTIK_PERSONAL_OWNER_TEST_MODE !== '1' ||
      process.env.DIALEKTIK_PERSONAL_OWNER_TEST_PROVIDER_MODE !== 'mock'
    )
      throw new ServiceUnavailableException('PERSONAL_OWNER_TEST_MODE_DISABLED');
  }
}
