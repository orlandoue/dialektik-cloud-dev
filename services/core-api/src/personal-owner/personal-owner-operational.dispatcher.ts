import { createHash, randomUUID } from 'node:crypto';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { generateUlid, type Database } from '@dialektik/database';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { CoreApiConfig } from '../config/core-api-config.js';
import type { CoreDatabaseService } from '../database/core-database.service.js';
import {
  FROZEN_NORMALIZATION_VERSION,
  decodeOriginalUtf8,
  normalizeFrozenFields,
  sha256Bytes,
} from '../ephemeral/ephemeral.normalization.js';
import type { EphemeralProcessingRequest } from '../ephemeral/ephemeral.contracts.js';
import { runLLMShadowJob } from '../llm-shadow/llm.job.js';
import { CloudflareWorkersAITransport } from '../llm-shadow/llm.cloudflare.js';
import { createCloudflareProfile } from '../llm-shadow/llm.cloudflare-config.js';
import { ProviderResilience } from '../llm-shadow/llm.resilience.js';
import type { LLMUsage, StructuredLLMTransport } from '../llm-shadow/llm.contracts.js';
import { CLOUDFLARE_GPT_OSS_20B_MODEL } from '../llm-shadow/llm.cloudflare-config.js';
import type {
  PersonalOwnerJobDispatcher,
  PersonalOwnerLLMTransportFactory,
  PersonalOwnerLLMTransportSelection,
  PersonalOwnerProviderMode,
} from './personal-owner-operational.adapters.js';

const PERSONAL_OWNER_REQUEST_BYTE_LIMIT = 65_536;
const PERSONAL_OWNER_OUTPUT_TOKEN_LIMIT = 4_096;

interface ClaimedJob {
  readonly id: Database['personal_owner_operational_jobs']['id'];
  readonly owner_identity: string;
  readonly article_id: Database['articles']['id'];
  readonly article_version_id: Database['observed_article_content_versions']['id'];
  readonly source_id: Database['sources']['id'];
  readonly provider_type: 'llm_cloudflare_workers_ai';
  readonly model_id: string;
  readonly attempt_count: number;
}

interface OperationalInputRow {
  readonly article_id: string;
  readonly article_version_id: string;
  readonly source_id: string;
  readonly canonical_url: string;
  readonly publisher_item_id: string | null;
  readonly published_at: Date;
  readonly available_at: Date;
  readonly modified_at: Date | null;
  readonly acquired_at: Date;
  readonly language: string | null;
  readonly title: string;
  readonly excerpt: string;
  readonly acquired_content_hash: string;
  readonly normalized_input_hash: string;
  readonly title_input_hash: string;
  readonly normalization_version: string;
  readonly policy_id: string;
  readonly policy_local_processing: boolean;
  readonly policy_external_ai_transmission: boolean;
  readonly metadata_storage: boolean;
  readonly excerpt_storage: boolean;
  readonly fulltext_acquisition: boolean;
  readonly fulltext_machine_processing: boolean;
  readonly fulltext_persistence: boolean;
  readonly derived_semantic_persistence: boolean;
  readonly minimal_evidence_fragment: boolean;
  readonly redisplay: boolean;
  readonly external_source_link: boolean;
  readonly evidence_quote_max_codepoints: number;
  readonly policy_rights_evidence_sha256: string | null;
  readonly policy_rights_decision_id: string | null;
  readonly permanent_exclusion_verified: boolean;
  readonly source_decision_id: string | null;
  readonly source_decision_status: string | null;
  readonly source_scopes: Record<string, boolean> | null;
  readonly source_local_processing: boolean | null;
  readonly source_valid_from: Date | null;
  readonly source_expires_at: Date | null;
}

export class ConfiguredPersonalOwnerLLMTransportFactory
  implements PersonalOwnerLLMTransportFactory
{
  create(modelId: string): PersonalOwnerLLMTransportSelection {
    const profile = createCloudflareProfile(modelId, {
      maxArticles: 1,
      maxCalls: 1,
      timeoutMs: 55_000,
      maxOutputTokens: PERSONAL_OWNER_OUTPUT_TOKEN_LIMIT,
      maxRequestBytes: PERSONAL_OWNER_REQUEST_BYTE_LIMIT,
    });
    const resilience = new ProviderResilience();
    const transport: StructuredLLMTransport = new CloudflareWorkersAITransport(
      profile,
      undefined,
      process.env,
      undefined,
      resilience,
    );
    return { config: profile.config, transport };
  }
}

/** A bounded poller over the existing durable job table; one Core instance runs one job at a time. */
export class PersonalOwnerOperationalDispatcher
  implements PersonalOwnerJobDispatcher, OnModuleInit, OnModuleDestroy
{
  private readonly workerId = randomUUID();
  private readonly controllers = new Map<string, AbortController>();
  private readonly activeSources = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private currentWork: Promise<void> | undefined;
  private shuttingDown = false;
  private readonly configuredProviderMode: PersonalOwnerProviderMode;
  private freePlanSuspended = false;
  get providerMode(): PersonalOwnerProviderMode {
    return this.freePlanSuspended ? 'disabled' : this.configuredProviderMode;
  }

  constructor(
    private readonly config: Readonly<CoreApiConfig>,
    private readonly database: CoreDatabaseService,
    private readonly transportFactory: PersonalOwnerLLMTransportFactory = new ConfiguredPersonalOwnerLLMTransportFactory(),
  ) {
    const requested = process.env.DIALEKTIK_PERSONAL_OWNER_PROVIDER_MODE?.trim() ?? 'disabled';
    const credentialsAvailable =
      /^[a-f0-9]{32}$/i.test(process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '') &&
      Boolean(process.env.CLOUDFLARE_API_TOKEN?.trim());
    const freeNoOverageConfirmed =
      process.env.DIALEKTIK_PERSONAL_OWNER_WORKERS_FREE_CONFIRMED === '1' &&
      process.env.DIALEKTIK_PERSONAL_OWNER_PAID_OVERAGE_DISABLED === '1';
    const retainedModel =
      (process.env.CLOUDFLARE_AI_MODEL?.trim() ?? CLOUDFLARE_GPT_OSS_20B_MODEL) ===
      CLOUDFLARE_GPT_OSS_20B_MODEL;
    const mockAllowed =
      process.env.NODE_ENV === 'test' &&
      process.env.DIALEKTIK_PERSONAL_OWNER_TEST_MODE === '1' &&
      process.env.DIALEKTIK_PERSONAL_OWNER_TEST_PROVIDER_MODE === 'mock';
    this.configuredProviderMode =
      requested === 'cloudflare' && credentialsAvailable && freeNoOverageConfirmed && retainedModel
        ? 'cloudflare'
        : requested === 'mock' && mockAllowed
          ? 'mock'
          : 'disabled';
  }

  async onModuleInit(): Promise<void> {
    if (this.config.ownershipMode !== 'personal' || this.config.semanticMode !== 'unassigned')
      return;
    await this.recoverInterruptedJobs();
    if (this.providerMode === 'disabled') return;
    this.timer = setInterval(() => this.pump(), 750);
    this.timer.unref();
    this.pump();
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer) clearInterval(this.timer);
    for (const controller of this.controllers.values()) controller.abort();
    await this.currentWork?.catch(() => undefined);
  }

  enqueue(_jobId: string): void {
    if (!this.shuttingDown && this.providerMode !== 'disabled') this.pump();
  }

  cancelJob(jobId: string): void {
    this.controllers.get(jobId)?.abort();
  }

  cancelSource(sourceId: string): void {
    for (const [jobId, activeSourceId] of this.activeSources)
      if (activeSourceId === sourceId) this.cancelJob(jobId);
  }

  cancelOwner(ownerId: string): void {
    if (ownerId === this.config.personalOwnerId)
      for (const controller of this.controllers.values()) controller.abort();
  }

  private pump(): void {
    if (this.currentWork || this.shuttingDown || this.providerMode === 'disabled') return;
    this.currentWork = this.processNext()
      .catch(() => undefined)
      .finally(() => {
        this.currentWork = undefined;
      });
  }

  private async databaseNow(database: Kysely<Database>): Promise<Date> {
    const result = await sql<{
      now: Date;
    }>`select date_trunc('milliseconds',clock_timestamp()) as now`.execute(database);
    const value = result.rows[0]?.now;
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
      throw new Error('PERSONAL_OWNER_DATABASE_CLOCK_UNAVAILABLE');
    return value;
  }

  private async appendEvent(
    tx: Transaction<Database>,
    jobId: ClaimedJob['id'],
    state:
      | 'RUNNING'
      | 'PROVIDER_REQUEST_STARTED'
      | 'RECOVERED_PENDING'
      | 'RECONCILIATION_REQUIRED'
      | 'COMPLETED'
      | 'FAILED'
      | 'CANCELLED',
    errorCategory: string | null,
  ): Promise<void> {
    const latest = await tx
      .selectFrom('personal_owner_operational_job_events')
      .select('sequence_number')
      .where('job_id', '=', jobId)
      .orderBy('sequence_number', 'desc')
      .executeTakeFirst();
    const now = await this.databaseNow(tx);
    await tx
      .insertInto('personal_owner_operational_job_events')
      .values({
        id: generateUlid({ now: () => now.getTime() }),
        job_id: jobId,
        sequence_number: (latest?.sequence_number ?? 0) + 1,
        state,
        error_category: errorCategory,
        recorded_at: now,
      })
      .execute();
  }

  private async updateReservation(
    tx: Transaction<Database>,
    jobId: ClaimedJob['id'],
    state: 'RELEASED' | 'RECONCILIATION_REQUIRED',
  ): Promise<void> {
    const reservation = await tx
      .selectFrom('personal_owner_budget_reservations')
      .selectAll()
      .where('job_id', '=', jobId)
      .forUpdate()
      .executeTakeFirst();
    if (reservation?.state !== 'RESERVED') return;
    const now = await this.databaseNow(tx);
    await tx
      .updateTable('personal_owner_budget_reservations')
      .set({ state, updated_at: now })
      .where('id', '=', reservation.id)
      .execute();
    await tx
      .insertInto('personal_owner_budget_events')
      .values({
        id: generateUlid({ now: () => now.getTime() }),
        reservation_id: reservation.id,
        event_type: state,
        reserved_microusd: reservation.reserved_microusd,
        actual_microusd: null,
        recorded_at: now,
      })
      .execute();
  }

  private async updateNeuronReservation(
    tx: Transaction<Database>,
    jobId: ClaimedJob['id'],
    state: 'RELEASED' | 'RECONCILIATION_REQUIRED',
  ): Promise<void> {
    const reservation = await tx
      .selectFrom('personal_owner_neuron_reservations')
      .selectAll()
      .where('job_id', '=', jobId)
      .forUpdate()
      .executeTakeFirst();
    if (reservation?.state !== 'RESERVED') return;
    const now = await this.databaseNow(tx);
    await tx
      .updateTable('personal_owner_neuron_reservations')
      .set({ state, updated_at: now })
      .where('id', '=', reservation.id)
      .execute();
    await tx
      .insertInto('personal_owner_neuron_events')
      .values({
        id: generateUlid({ now: () => now.getTime() }),
        reservation_id: reservation.id,
        event_type: state,
        reserved_neurons: reservation.reserved_neurons,
        actual_neurons: null,
        recorded_at: now,
      })
      .execute();
  }

  private async suspendFreeProvider(
    tx: Transaction<Database>,
    job: ClaimedJob,
    reason: string,
  ): Promise<void> {
    const now = await this.databaseNow(tx);
    const control = await tx
      .selectFrom('personal_owner_budget_controls')
      .selectAll()
      .where('owner_identity', '=', job.owner_identity)
      .forUpdate()
      .executeTakeFirst();
    if (control) {
      await tx
        .updateTable('personal_owner_budget_controls')
        .set({ enabled: false, emergency_stop: true, updated_at: now })
        .where('owner_identity', '=', job.owner_identity)
        .execute();
      await tx
        .insertInto('personal_owner_budget_control_events')
        .values({
          id: generateUlid({ now: () => now.getTime() }),
          owner_identity: job.owner_identity,
          event_type: 'EMERGENCY_STOPPED',
          limits_snapshot: {
            reason,
            daily_neuron_limit: control.daily_neuron_limit,
            per_request_neuron_limit: control.per_request_neuron_limit,
            workers_ai_plan: control.workers_ai_plan,
            paid_overage_disabled: control.paid_overage_disabled,
          },
          recorded_at: now,
        })
        .execute();
    }
    await tx
      .insertInto('personal_owner_provider_authorizations')
      .values({
        id: generateUlid({ now: () => now.getTime() }),
        owner_identity: job.owner_identity,
        provider_type: job.provider_type,
        model_id: job.model_id,
        decision_status: 'SUSPENDED',
        evidence_url: null,
        evidence_sha256: null,
        valid_from: now,
        expires_at: null,
        recorded_at: now,
      })
      .execute();
    await tx
      .insertInto('personal_owner_audit_events')
      .values({
        id: generateUlid({ now: () => now.getTime() }),
        owner_identity: job.owner_identity,
        event_type: 'PROVIDER_AUTO_SUSPENDED',
        request_fingerprint_sha256: createHash('sha256')
          .update(`${job.owner_identity}\n${job.model_id}\n${reason}\n${now.toISOString()}`)
          .digest('hex'),
        recorded_at: now,
      })
      .execute();
    this.freePlanSuspended = true;
    if (this.timer) clearInterval(this.timer);
  }

  private async claimNext(): Promise<ClaimedJob | null> {
    const owner = this.config.personalOwnerId;
    if (!owner) return null;
    return this.database.database.transaction().execute(async (tx) => {
      const job = await tx
        .selectFrom('personal_owner_operational_jobs')
        .selectAll()
        .where('owner_identity', '=', owner)
        .where('state', '=', 'PENDING')
        .orderBy('created_at')
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!job) return null;
      const now = await this.databaseNow(tx);
      await tx
        .updateTable('personal_owner_operational_jobs')
        .set({ state: 'RUNNING', updated_at: now })
        .where('id', '=', job.id)
        .execute();
      await this.appendEvent(tx, job.id, 'RUNNING', null);
      return job as ClaimedJob;
    });
  }

  private async loadInput(job: ClaimedJob): Promise<{
    readonly request: EphemeralProcessingRequest;
    readonly frozen: {
      readonly articleId: string;
      readonly versionId: string;
      readonly sourceId: string;
      readonly policyId: string;
      readonly inputHash: string;
      readonly titleHash: string;
    };
    readonly content: {
      acquire(signal: AbortSignal): Promise<Buffer>;
      parse(
        acquired: Uint8Array,
        signal: AbortSignal,
      ): Promise<{
        readonly title: string;
        readonly body: Buffer;
        readonly completeOriginalText: true;
      }>;
    };
  }> {
    const rows = await sql<OperationalInputRow>`
      select a.id::text as article_id,v.id::text as article_version_id,
        a.source_id::text as source_id,a.url_canonical as canonical_url,
        v.publisher_item_id,v.published_at,v.available_at,v.modified_at,v.acquired_at,
        v.language,v.original_title as title,lv.excerpt,v.acquired_content_hash,
        v.normalized_input_hash,v.title_input_hash,v.normalization_version,v.policy_id,
        p.local_processing as policy_local_processing,
        p.external_ai_transmission as policy_external_ai_transmission,
        p.metadata_storage,p.excerpt_storage,p.fulltext_acquisition,p.fulltext_machine_processing,
        p.fulltext_persistence,p.derived_semantic_persistence,p.minimal_evidence_fragment,
        p.redisplay,p.external_source_link,p.evidence_quote_max_codepoints,
        p.rights_evidence_sha256 as policy_rights_evidence_sha256,
        p.personal_owner_source_rights_decision_id::text as policy_rights_decision_id,
        exists(select 1 from live_exposure_exclusions x
          join live_exposure_exclusions identity_x on identity_x.id=a.live_exposure_id
          where x.canonical_url=a.url_canonical and x.content_hash=v.acquired_content_hash
            and x.registry_key=identity_x.registry_key
            and x.exclusion_status='PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2') as permanent_exclusion_verified,
        d.id::text as source_decision_id,d.decision_status as source_decision_status,
        d.scopes as source_scopes,d.local_processing as source_local_processing,
        d.valid_from as source_valid_from,d.expires_at as source_expires_at
      from personal_owner_operational_jobs j
      join articles a on a.id=j.article_id and a.source_id=j.source_id
      join observed_article_content_versions v on v.id=j.article_version_id and v.article_id=a.id
      join content_access_policies p on p.id=v.policy_id
      join lateral (select lv.* from live_article_versions lv
        join live_acquisition_receipts r on r.id=lv.receipt_id and r.disposition='PERSISTED'
        where lv.article_id=a.id and lv.content_hash=v.acquired_content_hash
          and lv.headline=v.original_title and lv.published_at=v.published_at
          and lv.modified_at is not distinct from v.modified_at and lv.excerpt is not null
        order by lv.version_number desc limit 1) lv on true
      left join lateral (select d.* from personal_owner_source_rights_decisions d
        where d.source_id=a.source_id order by d.sequence_number desc limit 1) d on true
      where j.id=${job.id} and j.owner_identity=${job.owner_identity}
        and a.origin='LIVE_REAL' and a.event_id is null and v.persisted_body is null
    `.execute(this.database.database);
    const row = rows.rows[0];
    if (!row?.excerpt || !row.title || !row.permanent_exclusion_verified)
      throw new Error('ARTICLE_EXCERPT_OR_EXCLUSION_PROVENANCE_UNAVAILABLE');
    const scopes = row.source_scopes;
    const now = await this.databaseNow(this.database.database);
    if (
      row.source_decision_status !== 'AUTHORIZED' ||
      row.source_decision_id !== row.policy_rights_decision_id ||
      row.source_valid_from === null ||
      row.source_valid_from > now ||
      (row.source_expires_at !== null && row.source_expires_at <= now) ||
      !scopes?.acquisition ||
      !scopes.metadata_storage ||
      !scopes.excerpt_storage ||
      !scopes.external_ai_transmission ||
      !scopes.derived_semantic_persistence ||
      !scopes.redisplay ||
      row.source_local_processing !== true ||
      !row.policy_local_processing ||
      !row.policy_external_ai_transmission ||
      !row.metadata_storage ||
      !row.excerpt_storage ||
      row.fulltext_acquisition ||
      row.fulltext_machine_processing ||
      row.fulltext_persistence ||
      !row.derived_semantic_persistence ||
      !row.policy_rights_evidence_sha256 ||
      row.evidence_quote_max_codepoints !== 0 ||
      row.minimal_evidence_fragment
    )
      throw new Error('CURRENT_SOURCE_OR_EXCERPT_RIGHTS_NOT_AUTHORIZED');
    const fields = normalizeFrozenFields(row.title, row.excerpt);
    if (
      fields.inputHash !== row.normalized_input_hash ||
      fields.titleHash !== row.title_input_hash ||
      fields.normalizationVersion !== row.normalization_version ||
      row.normalization_version !== FROZEN_NORMALIZATION_VERSION ||
      sha256Bytes(Buffer.from(`${row.title}\n${row.excerpt}`.normalize('NFC'), 'utf8')) !==
        row.acquired_content_hash
    )
      throw new Error('ARTICLE_VERSION_INPUT_IDENTITY_MISMATCH');
    const metadata = {
      articleId: row.article_id,
      articleVersionId: row.article_version_id,
      sourceId: row.source_id,
      canonicalUrl: row.canonical_url,
      publisherItemId: row.publisher_item_id,
      publishedAt: row.published_at.toISOString(),
      availableAt: row.available_at.toISOString(),
      modifiedAt: row.modified_at?.toISOString() ?? null,
      acquiredAt: row.acquired_at.toISOString(),
      language: row.language,
      title: row.title,
      contentEncoding: 'utf-8' as const,
    };
    const request: EphemeralProcessingRequest = {
      metadata,
      policy: {
        policyId: row.policy_id,
        sourceId: row.source_id,
        accessMode: 'EXCERPT_EPHEMERAL',
        active: true,
        rights: {
          metadataStorage: row.metadata_storage,
          excerptStorage: row.excerpt_storage,
          localProcessing: row.policy_local_processing,
          externalAiTransmission: row.policy_external_ai_transmission,
          fulltextAcquisition: row.fulltext_acquisition,
          fulltextMachineProcessing: row.fulltext_machine_processing,
          fulltextPersistence: row.fulltext_persistence,
          derivedSemanticPersistence: row.derived_semantic_persistence,
          minimalEvidenceFragment: row.minimal_evidence_fragment,
          redisplay: row.redisplay,
          externalSourceLink: row.external_source_link,
        },
        evidenceMaxCodepoints: row.evidence_quote_max_codepoints,
      },
      permanentExclusionVerified: row.permanent_exclusion_verified,
      providerRunId: String(job.id),
      position: 1,
    };
    const exactAcquisitionText = `${row.title}\n${row.excerpt}`.normalize('NFC');
    return {
      request,
      frozen: {
        articleId: row.article_id,
        versionId: row.article_version_id,
        sourceId: row.source_id,
        policyId: row.policy_id,
        inputHash: fields.inputHash,
        titleHash: fields.titleHash,
      },
      content: {
        acquire: (signal) => {
          if (signal.aborted) throw new Error('LLM_ABORTED');
          return Promise.resolve(Buffer.from(exactAcquisitionText, 'utf8'));
        },
        parse: (acquired, signal) => {
          if (signal.aborted || decodeOriginalUtf8(acquired) !== exactAcquisitionText)
            throw new Error('ARTICLE_EXCERPT_PARSE_FAILED');
          return Promise.resolve({
            title: row.title,
            body: Buffer.from(row.excerpt, 'utf8'),
            completeOriginalText: true as const,
          });
        },
      },
    };
  }

  private lifecycle(job: ClaimedJob) {
    return {
      beforeProviderCall: async (
        tx: Transaction<Database>,
        args: {
          readonly runId: string;
          readonly stage: 'extraction' | 'relation';
          readonly request: EphemeralProcessingRequest;
        },
      ) => {
        if (
          args.runId !== String(job.id) ||
          args.request.metadata.articleId !== String(job.article_id) ||
          args.request.metadata.articleVersionId !== String(job.article_version_id) ||
          args.request.metadata.sourceId !== String(job.source_id) ||
          args.stage !== 'extraction'
        )
          throw new Error('PERSONAL_OWNER_PROVIDER_ATTEMPT_SCOPE_MISMATCH');
        await tx
          .selectFrom('prospective_content_rights_write_guards')
          .select('source_id')
          .where('source_id', '=', job.source_id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        const current = await sql<{
          job_state: string;
          attempt_count: number;
          current_decision_id: string | null;
          decision_status: string | null;
          scopes: Record<string, boolean> | null;
          local_processing: boolean | null;
          valid_from: Date | null;
          expires_at: Date | null;
          policy_id: string | null;
          policy_decision_id: string | null;
          enabled: boolean | null;
          emergency_stop: boolean | null;
          revoked_at: Date | null;
          workers_ai_plan: string | null;
          paid_overage_disabled: boolean | null;
          workers_ai_plan_evidence_url: string | null;
          workers_ai_plan_evidence_sha256: string | null;
          workers_ai_plan_verified_until: Date | null;
          max_concurrency: number | null;
          max_requests_per_minute: number | null;
          authorization_status: string | null;
          authorization_valid_from: Date | null;
          authorization_expires_at: Date | null;
          reservation_state: string | null;
          neuron_reservation_state: string | null;
          neuron_reserved: number | null;
          price_status: string | null;
          price_valid_from: Date | null;
          price_expires_at: Date | null;
          input_neurons_per_million_tokens: number | null;
          output_neurons_per_million_tokens: number | null;
          max_input_tokens: number | null;
          max_output_tokens: number | null;
        }>`
          select j.state as job_state,j.attempt_count,d.id::text as current_decision_id,
            d.decision_status,d.scopes,d.local_processing,d.valid_from,d.expires_at,
            p.id as policy_id,p.personal_owner_source_rights_decision_id::text as policy_decision_id,
            c.enabled,c.emergency_stop,c.revoked_at,c.workers_ai_plan,c.paid_overage_disabled,
            c.workers_ai_plan_evidence_url,c.workers_ai_plan_evidence_sha256,
            c.workers_ai_plan_verified_until,c.max_concurrency,c.max_requests_per_minute,
            pa.decision_status as authorization_status,pa.valid_from as authorization_valid_from,
            pa.expires_at as authorization_expires_at,r.state as reservation_state,
            nr.state as neuron_reservation_state,nr.reserved_neurons as neuron_reserved,
            price.decision_status as price_status,price.valid_from as price_valid_from,
            price.expires_at as price_expires_at,price.input_neurons_per_million_tokens,
            price.output_neurons_per_million_tokens,price.max_input_tokens,price.max_output_tokens
          from personal_owner_operational_jobs j
          left join lateral (select * from personal_owner_source_rights_decisions
            where source_id=j.source_id order by sequence_number desc limit 1) d on true
          left join content_access_policies p on p.id=${args.request.policy.policyId}
          left join personal_owner_budget_controls c on c.owner_identity=j.owner_identity
          left join lateral (select * from personal_owner_provider_authorizations
            where owner_identity=j.owner_identity and provider_type=j.provider_type and model_id=j.model_id
            order by recorded_at desc,id desc limit 1) pa on true
          left join personal_owner_budget_reservations r on r.job_id=j.id
          left join personal_owner_neuron_reservations nr on nr.job_id=j.id
          left join personal_owner_model_prices price on price.id=r.price_id
          where j.id=${job.id} for update of j
        `.execute(tx);
        const row = current.rows[0];
        const now = await this.databaseNow(tx);
        if (
          row?.job_state !== 'RUNNING' ||
          row.attempt_count !== 0 ||
          row.current_decision_id !== row.policy_decision_id ||
          !row.enabled ||
          row.emergency_stop ||
          row.revoked_at !== null ||
          row.reservation_state !== 'RESERVED' ||
          (this.configuredProviderMode === 'cloudflare' &&
            (row.neuron_reservation_state !== 'RESERVED' ||
              row.neuron_reserved === null ||
              row.workers_ai_plan !== 'FREE' ||
              row.paid_overage_disabled !== true ||
              !row.workers_ai_plan_evidence_url ||
              !row.workers_ai_plan_evidence_sha256 ||
              row.workers_ai_plan_verified_until === null ||
              row.workers_ai_plan_verified_until <= now ||
              row.max_concurrency !== 1 ||
              row.max_requests_per_minute !== 1 ||
              job.model_id !== CLOUDFLARE_GPT_OSS_20B_MODEL ||
              row.input_neurons_per_million_tokens !== 18_182 ||
              row.output_neurons_per_million_tokens !== 27_273 ||
              row.max_input_tokens !== PERSONAL_OWNER_REQUEST_BYTE_LIMIT ||
              row.max_output_tokens !== PERSONAL_OWNER_OUTPUT_TOKEN_LIMIT)) ||
          row.decision_status !== 'AUTHORIZED' ||
          row.valid_from === null ||
          row.valid_from > now ||
          (row.expires_at !== null && row.expires_at <= now) ||
          row.local_processing !== true ||
          row.scopes?.acquisition !== true ||
          row.scopes.metadata_storage !== true ||
          row.scopes.excerpt_storage !== true ||
          row.scopes.external_ai_transmission !== true ||
          row.scopes.derived_semantic_persistence !== true ||
          row.scopes.redisplay !== true ||
          row.authorization_status !== 'AUTHORIZED' ||
          row.authorization_valid_from === null ||
          row.authorization_valid_from > now ||
          (row.authorization_expires_at !== null && row.authorization_expires_at <= now) ||
          row.price_status !== 'VERIFIED' ||
          row.price_valid_from === null ||
          row.price_valid_from > now ||
          (row.price_expires_at !== null && row.price_expires_at <= now)
        )
          throw new Error('PERSONAL_OWNER_PROVIDER_ATTEMPT_NOT_AUTHORIZED');
        const route = await sql<{ allowed: boolean }>`
          select dialektik_llm_route_allowed(${job.source_id},${job.article_id},
            ${args.request.policy.policyId},'llm_cloudflare_workers_ai',true,${job.model_id}) as allowed
        `.execute(tx);
        if (route.rows[0]?.allowed !== true)
          throw new Error('PERSONAL_OWNER_PROVIDER_ROUTE_REVOKED');
        const existingAttempt = await tx
          .selectFrom('personal_owner_provider_attempts')
          .select('id')
          .where('job_id', '=', job.id)
          .executeTakeFirst();
        if (existingAttempt) throw new Error('PERSONAL_OWNER_PROVIDER_ATTEMPT_ALREADY_CLAIMED');
        const id = generateUlid({ now: () => now.getTime() });
        await tx
          .insertInto('personal_owner_provider_attempts')
          .values({
            id,
            job_id: job.id,
            state: 'CLAIMED',
            provider_type: 'llm_cloudflare_workers_ai',
            model_id: job.model_id,
            claimed_at: now,
            request_started_at: null,
            response_received_at: null,
            response_sha256: null,
            input_tokens: null,
            output_tokens: null,
            error_category: null,
            updated_at: now,
          })
          .execute();
        await tx
          .updateTable('personal_owner_operational_jobs')
          .set({
            attempt_count: 1,
            provider_request_started_at: now,
            updated_at: now,
          })
          .where('id', '=', job.id)
          .execute();
        await tx
          .updateTable('personal_owner_provider_attempts')
          .set({
            state: 'REQUEST_STARTED',
            request_started_at: now,
            updated_at: now,
          })
          .where('id', '=', id)
          .execute();
        await this.appendEvent(tx, job.id, 'PROVIDER_REQUEST_STARTED', null);
      },
      afterProviderCall: async (
        tx: Transaction<Database>,
        args: {
          readonly runId: string;
          readonly stage: 'extraction' | 'relation';
          readonly request: EphemeralProcessingRequest;
          readonly outcome: 'RESPONSE_RECEIVED' | 'FAILED';
          readonly usage?: LLMUsage;
          readonly failureCategory?: string;
        },
      ) => {
        if (args.runId !== String(job.id))
          throw new Error('PERSONAL_OWNER_PROVIDER_ATTEMPT_SCOPE_MISMATCH');
        const attempt = await tx
          .selectFrom('personal_owner_provider_attempts')
          .selectAll()
          .where('job_id', '=', job.id)
          .forUpdate()
          .executeTakeFirst();
        if (attempt?.state !== 'REQUEST_STARTED')
          throw new Error('PERSONAL_OWNER_PROVIDER_ATTEMPT_STATE_INVALID');
        const now = await this.databaseNow(tx);
        let actualNeurons: number | null = null;
        let suspendReason: string | null = null;
        if (args.outcome === 'RESPONSE_RECEIVED' && this.configuredProviderMode === 'cloudflare') {
          const usage = args.usage;
          if (!usage) throw new Error('PERSONAL_OWNER_USAGE_RECONCILIATION_REQUIRED');
          if (usage.inputTokens === null || usage.outputTokens === null)
            throw new Error('PERSONAL_OWNER_USAGE_RECONCILIATION_REQUIRED');
          const accounting = await sql<{
            reservation_id: string;
            reservation_state: string;
            reserved_neurons: number;
            neuron_rate_input: number;
            neuron_rate_output: number;
          }>`
            select nr.id::text as reservation_id,nr.state as reservation_state,
              nr.reserved_neurons,p.input_neurons_per_million_tokens as neuron_rate_input,
              p.output_neurons_per_million_tokens as neuron_rate_output
            from personal_owner_neuron_reservations nr
            join personal_owner_budget_reservations br on br.job_id=nr.job_id
            join personal_owner_model_prices p on p.id=br.price_id
            where nr.job_id=${job.id} for update of nr,br
          `.execute(tx);
          const bounds = accounting.rows[0];
          if (bounds?.reservation_state !== 'RESERVED')
            throw new Error('PERSONAL_OWNER_NEURON_RESERVATION_INVALID');
          const inputNeurons = Math.ceil(
            (usage.inputTokens * bounds.neuron_rate_input) / 1_000_000,
          );
          const outputNeurons = Math.ceil(
            (usage.outputTokens * bounds.neuron_rate_output) / 1_000_000,
          );
          actualNeurons = inputNeurons + outputNeurons;
          if (!Number.isSafeInteger(actualNeurons) || actualNeurons < 0)
            throw new Error('PERSONAL_OWNER_NEURON_USAGE_INVALID');
          await tx
            .updateTable('personal_owner_neuron_reservations')
            .set({ state: 'SETTLED', actual_neurons: actualNeurons, updated_at: now })
            .where(
              'id',
              '=',
              bounds.reservation_id as Database['personal_owner_neuron_reservations']['id'],
            )
            .execute();
          await tx
            .insertInto('personal_owner_neuron_events')
            .values({
              id: generateUlid({ now: () => now.getTime() }),
              reservation_id:
                bounds.reservation_id as Database['personal_owner_neuron_reservations']['id'],
              event_type: 'SETTLED',
              reserved_neurons: bounds.reserved_neurons,
              actual_neurons: actualNeurons,
              recorded_at: now,
            })
            .execute();
          const moneyReservation = await tx
            .selectFrom('personal_owner_budget_reservations')
            .selectAll()
            .where('job_id', '=', job.id)
            .forUpdate()
            .executeTakeFirst();
          if (moneyReservation?.state !== 'RESERVED')
            throw new Error('PERSONAL_OWNER_COST_RESERVATION_INVALID');
          await tx
            .updateTable('personal_owner_budget_reservations')
            .set({ state: 'SETTLED', actual_microusd: 0, updated_at: now })
            .where('id', '=', moneyReservation.id)
            .execute();
          await tx
            .insertInto('personal_owner_budget_events')
            .values({
              id: generateUlid({ now: () => now.getTime() }),
              reservation_id: moneyReservation.id,
              event_type: 'SETTLED',
              reserved_microusd: moneyReservation.reserved_microusd,
              actual_microusd: 0,
              recorded_at: now,
            })
            .execute();
          if (actualNeurons > bounds.reserved_neurons) suspendReason = 'NEURON_RESERVATION_OVERRUN';
        }
        const errorCategory =
          args.outcome === 'FAILED'
            ? (args.failureCategory ?? 'PROVIDER_OUTCOME_UNKNOWN').slice(0, 96)
            : suspendReason;
        await tx
          .updateTable('personal_owner_provider_attempts')
          .set({
            state: args.outcome === 'RESPONSE_RECEIVED' ? 'RESPONSE_RECEIVED' : 'OUTCOME_UNKNOWN',
            response_received_at: args.outcome === 'RESPONSE_RECEIVED' ? now : null,
            input_tokens:
              args.outcome === 'RESPONSE_RECEIVED' ? (args.usage?.inputTokens ?? null) : null,
            output_tokens:
              args.outcome === 'RESPONSE_RECEIVED' ? (args.usage?.outputTokens ?? null) : null,
            error_category: errorCategory,
            updated_at: now,
          })
          .where('id', '=', attempt.id)
          .execute();
        if (
          suspendReason ||
          (args.outcome === 'FAILED' &&
            [
              'FREE_NEURON_QUOTA_EXHAUSTED',
              'MODEL_REQUIRES_PAID_PLAN',
              'CREDENTIAL_REJECTED',
              'USAGE_RECONCILIATION_REQUIRED',
            ].includes(args.failureCategory ?? ''))
        ) {
          await this.suspendFreeProvider(
            tx,
            job,
            suspendReason ?? args.failureCategory ?? 'PROVIDER_SUSPENDED',
          );
        }
      },
    };
  }

  private async processNext(): Promise<void> {
    const job = await this.claimNext();
    if (!job) return;
    const jobId = String(job.id);
    const controller = new AbortController();
    this.controllers.set(jobId, controller);
    this.activeSources.set(jobId, String(job.source_id));
    let selection: PersonalOwnerLLMTransportSelection | undefined;
    try {
      const input = await this.loadInput(job);
      if (controller.signal.aborted) throw new Error('PERSONAL_OWNER_JOB_CANCELLED');
      selection = this.transportFactory.create(job.model_id);
      if (
        selection.config.model !== job.model_id ||
        selection.config.maxArticles !== 1 ||
        selection.config.maxCalls !== 1 ||
        selection.transport.kind !== 'external' ||
        selection.transport.providerType !== job.provider_type
      )
        throw new Error('PERSONAL_OWNER_PROVIDER_PROFILE_INVALID');
      const result = await runLLMShadowJob(
        this.database.database,
        jobId,
        selection.config,
        selection.transport,
        [
          {
            request: input.request,
            frozen: input.frozen,
            route: 'EXTERNAL_LLM_PROCESSING_ALLOWED',
            content: input.content,
          },
        ],
        controller.signal,
        { providerAttemptLifecycle: this.lifecycle(job), disableCache: true },
      );
      if (
        result.failures.length !== 0 ||
        result.envelopes.length !== 1 ||
        result.snapshotId === null ||
        result.calls !== 1
      )
        throw new Error('PERSONAL_OWNER_SEMANTIC_PERSISTENCE_INCOMPLETE');
      await this.completeJob(job);
    } catch (error) {
      await this.failJob(
        job,
        error instanceof Error ? error.message : 'PERSONAL_OWNER_JOB_FAILED',
      ).catch(() => undefined);
    } finally {
      selection?.transport.dispose?.();
      this.controllers.delete(jobId);
      this.activeSources.delete(jobId);
    }
  }

  private async completeJob(job: ClaimedJob): Promise<void> {
    await this.database.database.transaction().execute(async (tx) => {
      const current = await tx
        .selectFrom('personal_owner_operational_jobs')
        .selectAll()
        .where('id', '=', job.id)
        .forUpdate()
        .executeTakeFirst();
      if (current?.state !== 'RUNNING') return;
      const attempt = await tx
        .selectFrom('personal_owner_provider_attempts')
        .selectAll()
        .where('job_id', '=', job.id)
        .executeTakeFirst();
      const neuronReservation = await tx
        .selectFrom('personal_owner_neuron_reservations')
        .select(['state'])
        .where('job_id', '=', job.id)
        .executeTakeFirst();
      const now = await this.databaseNow(tx);
      if (
        this.configuredProviderMode === 'cloudflare' &&
        (attempt?.state !== 'RESPONSE_RECEIVED' || neuronReservation?.state !== 'SETTLED')
      ) {
        await tx
          .updateTable('personal_owner_operational_jobs')
          .set({ state: 'RECONCILIATION_REQUIRED', blocked_reason: null, updated_at: now })
          .where('id', '=', job.id)
          .execute();
        await this.updateReservation(tx, job.id, 'RECONCILIATION_REQUIRED');
        await this.updateNeuronReservation(tx, job.id, 'RECONCILIATION_REQUIRED');
        await this.appendEvent(
          tx,
          job.id,
          'RECONCILIATION_REQUIRED',
          'USAGE_RECONCILIATION_REQUIRED',
        );
        return;
      }
      await tx
        .updateTable('personal_owner_operational_jobs')
        .set({
          state: 'COMPLETED',
          blocked_reason: null,
          completed_at: now,
          updated_at: now,
        })
        .where('id', '=', job.id)
        .execute();
      await this.appendEvent(tx, job.id, 'COMPLETED', null);
      if (this.configuredProviderMode === 'cloudflare' && neuronReservation?.state === 'SETTLED') {
        // Provider usage and the zero-dollar Free allocation were settled in the response hook.
      } else if (attempt?.state === 'RESPONSE_RECEIVED')
        await this.updateReservation(tx, job.id, 'RECONCILIATION_REQUIRED');
      else await this.updateReservation(tx, job.id, 'RELEASED');
    });
  }

  private async failJob(job: ClaimedJob, error: string): Promise<void> {
    await this.database.database.transaction().execute(async (tx) => {
      const current = await tx
        .selectFrom('personal_owner_operational_jobs')
        .selectAll()
        .where('id', '=', job.id)
        .forUpdate()
        .executeTakeFirst();
      if (current?.state !== 'RUNNING') return;
      const attempt = await tx
        .selectFrom('personal_owner_provider_attempts')
        .selectAll()
        .where('job_id', '=', job.id)
        .forUpdate()
        .executeTakeFirst();
      const now = await this.databaseNow(tx);
      if (attempt?.state === 'REQUEST_STARTED') {
        await tx
          .updateTable('personal_owner_provider_attempts')
          .set({
            state: 'OUTCOME_UNKNOWN',
            error_category: 'PROVIDER_OUTCOME_UNKNOWN',
            updated_at: now,
          })
          .where('id', '=', attempt.id)
          .execute();
      }
      const neuronReservation = await tx
        .selectFrom('personal_owner_neuron_reservations')
        .select(['state'])
        .where('job_id', '=', job.id)
        .executeTakeFirst();
      const cloudflareResponseSettled =
        this.configuredProviderMode === 'cloudflare' &&
        attempt?.state === 'RESPONSE_RECEIVED' &&
        neuronReservation?.state === 'SETTLED';
      const uncertain = current.attempt_count === 1 && !cloudflareResponseSettled;
      await tx
        .updateTable('personal_owner_operational_jobs')
        .set({
          state: uncertain ? 'RECONCILIATION_REQUIRED' : 'FAILED',
          blocked_reason: null,
          completed_at: uncertain ? null : now,
          updated_at: now,
        })
        .where('id', '=', job.id)
        .execute();
      await this.updateReservation(tx, job.id, uncertain ? 'RECONCILIATION_REQUIRED' : 'RELEASED');
      await this.updateNeuronReservation(
        tx,
        job.id,
        uncertain ? 'RECONCILIATION_REQUIRED' : 'RELEASED',
      );
      await this.appendEvent(
        tx,
        job.id,
        uncertain ? 'RECONCILIATION_REQUIRED' : 'FAILED',
        uncertain ? 'PROVIDER_OUTCOME_UNKNOWN' : sanitizeError(error),
      );
    });
  }

  private async recoverInterruptedJobs(): Promise<void> {
    const owner = this.config.personalOwnerId;
    if (!owner) return;
    await this.database.database.transaction().execute(async (tx) => {
      const jobs = await tx
        .selectFrom('personal_owner_operational_jobs')
        .selectAll()
        .where('owner_identity', '=', owner)
        .where('state', '=', 'RUNNING')
        .orderBy('updated_at')
        .forUpdate()
        .skipLocked()
        .execute();
      for (const job of jobs) {
        const attempt = await tx
          .selectFrom('personal_owner_provider_attempts')
          .selectAll()
          .where('job_id', '=', job.id)
          .forUpdate()
          .executeTakeFirst();
        const now = await this.databaseNow(tx);
        if (job.attempt_count === 0 && !attempt) {
          await tx
            .updateTable('personal_owner_operational_jobs')
            .set({
              state: 'PENDING',
              updated_at: now,
            })
            .where('id', '=', job.id)
            .execute();
          await this.appendEvent(
            tx,
            job.id,
            'RECOVERED_PENDING',
            'CORE_RESTART_BEFORE_PROVIDER_CALL',
          );
          continue;
        }
        if (attempt?.state === 'REQUEST_STARTED')
          await tx
            .updateTable('personal_owner_provider_attempts')
            .set({
              state: 'OUTCOME_UNKNOWN',
              error_category: 'CORE_RESTART_DURING_PROVIDER_CALL',
              updated_at: now,
            })
            .where('id', '=', attempt.id)
            .execute();
        await tx
          .updateTable('personal_owner_operational_jobs')
          .set({
            state: 'RECONCILIATION_REQUIRED',
            blocked_reason: null,
            updated_at: now,
          })
          .where('id', '=', job.id)
          .execute();
        await this.updateReservation(tx, job.id, 'RECONCILIATION_REQUIRED');
        await this.updateNeuronReservation(tx, job.id, 'RECONCILIATION_REQUIRED');
        await this.appendEvent(
          tx,
          job.id,
          'RECONCILIATION_REQUIRED',
          'CORE_RESTART_DURING_PROVIDER_ATTEMPT',
        );
      }
    });
  }
}

function sanitizeError(value: string): string {
  const normalized = value
    .toUpperCase()
    .replace(/[^A-Z0-9_.:-]+/gu, '_')
    .slice(0, 96);
  return normalized || 'PERSONAL_OWNER_JOB_FAILED';
}
