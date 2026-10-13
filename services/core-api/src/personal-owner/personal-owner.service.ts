import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { generateUlid } from '@dialektik/database';
import { CORE_API_CONFIG, type CoreApiConfig } from '../config/core-api-config.js';
import { CoreDatabaseService } from '../database/core-database.service.js';
import { sha256 } from '../llm-shadow/llm.schema.js';

const CLOUDFLARE_GPT_OSS_MODEL = '@cf/openai/gpt-oss-20b';

@Injectable()
export class PersonalOwnerService {
  constructor(
    @Inject(CORE_API_CONFIG) private readonly config: Readonly<CoreApiConfig>,
    @Inject(CoreDatabaseService) private readonly database: CoreDatabaseService,
    @Inject('PERSONAL_OWNER_CLOCK') private readonly now: () => Date,
  ) {}

  async status() {
    if (
      this.config.ownershipMode !== 'personal' ||
      !this.config.personalOwnerId ||
      this.config.semanticMode !== 'unassigned'
    )
      throw new ServiceUnavailableException('PERSONAL_OWNER_MODE_NOT_ACTIVE');

    const recordedAt = this.now().toISOString();
    const id = generateUlid({ now: () => Date.parse(recordedAt) });
    const requestFingerprint = sha256(
      `${this.config.personalOwnerId}\nOWNER_STATUS_VIEWED\n${recordedAt}`,
    );
    await this.database.database
      .insertInto('personal_owner_audit_events')
      .values({
        id,
        owner_identity: this.config.personalOwnerId,
        event_type: 'OWNER_STATUS_VIEWED',
        request_fingerprint_sha256: requestFingerprint,
        recorded_at: recordedAt,
      })
      .execute();

    const selectedProvider = process.env.DIALEKTIK_LLM_PROVIDER?.trim() ?? 'gemini';
    const selectedModel =
      selectedProvider === 'cloudflare_workers_ai'
        ? (process.env.CLOUDFLARE_AI_MODEL?.trim() ?? CLOUDFLARE_GPT_OSS_MODEL)
        : (process.env.DIALEKTIK_GEMINI_MODEL?.trim() ?? 'gemini-3.5-flash-lite');
    const genericCloudflareJobState =
      selectedProvider === 'cloudflare_workers_ai'
        ? 'BLOCKED_BY_EXISTING_SHARED_DATABASE_AUTHORIZATION'
        : 'PROVIDER_NOT_SELECTED';
    return Object.freeze({
      ownership_mode: 'personal' as const,
      owner_identity: this.config.personalOwnerId,
      authentication: 'OWNER_BEARER_VERIFIED' as const,
      deployment: 'LOCAL_UNASSIGNED_DEVELOPMENT' as const,
      selected_provider: selectedProvider,
      selected_model: selectedModel,
      cloudflare_transport: 'INTEGRATED' as const,
      general_cloudflare_job: genericCloudflareJobState,
      article_processing: 'EXISTING_SOURCE_AND_ARTICLE_RIGHTS_REQUIRED' as const,
      derived_shadow_persistence: 'REQUIRES_EXISTING_EXPLICIT_RIGHTS' as const,
      live_assignment: 'UNASSIGNED' as const,
      v10_11_executions: 0 as const,
      final_holdout_v2_executions: 0 as const,
    });
  }
}
