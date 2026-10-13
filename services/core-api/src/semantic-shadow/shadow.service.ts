import { Inject, Injectable } from '@nestjs/common';
import {
  FROZEN_V10_11_IDENTITY,
  REQUIRED_SOURCE_REPRESENTATION,
  type ShadowPreflight,
} from './shadow.contracts.js';
import { ShadowPreflightRepository } from './shadow.repository.js';

@Injectable()
export class ShadowPreflightService {
  constructor(
    @Inject(ShadowPreflightRepository) private readonly repository: ShadowPreflightRepository,
  ) {}

  async preflight(): Promise<ShadowPreflight> {
    const snapshot = await this.repository.read();
    return {
      disposition: 'CURRENT_LIVE_INPUT_INSUFFICIENT_FOR_V10_11',
      adapter_status: 'READY',
      authority: 'NOT_AUTHORITATIVE',
      candidate: { ...FROZEN_V10_11_IDENTITY, execution_enabled: false },
      input_contract: {
        required_representation: 'FULL_SOURCE_TEXT',
        required_body_field: 'text',
        title_only_allowed: false,
        excerpt_substitution_allowed: false,
      },
      ...snapshot,
      eligible_article_count: 0,
      skipped_article_count: snapshot.articles.length,
      counters: {
        product_shadow_candidate_batches: 0,
        product_shadow_candidate_article_inputs: 0,
        determinism_replays: 0,
        final_holdout_candidate_executions: 0,
      },
      observations: [],
      proposed_occurrences: [],
      proposed_threads: [],
      unknown_result_count: 0,
      required_source_representation: REQUIRED_SOURCE_REPRESENTATION,
    };
  }
}
