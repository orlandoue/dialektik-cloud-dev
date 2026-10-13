import { parseUlid, type Ulid } from '@dialektik/database';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CORE_API_CONFIG, type CoreApiConfig } from '../config/core-api-config.js';
import type { SemanticObservation, SemanticObservationProvider } from './semantic.contracts.js';
import { FIXTURE_VERSION } from './semantic.fixtures.js';
import { STRESS_FIXTURE_VERSION } from './semantic.stress-version.js';
import { SemanticRepository } from './semantic.repository.js';

@Injectable()
export class SemanticApplicationService {
  constructor(
    @Inject(SemanticRepository) readonly repository: SemanticRepository,
    @Inject(CORE_API_CONFIG) private readonly config: Readonly<CoreApiConfig>,
  ) {}
  async ingestArticle(id: Ulid, provider: SemanticObservationProvider): Promise<boolean> {
    const article = await this.repository.safeArticle(id);
    if (article === undefined) throw new NotFoundException('Article not found.');
    return this.ingestObservation(
      await provider.observe({
        id: article.id,
        canonicalUrl: article.url_canonical,
        originalText: article.text_original,
      }),
    );
  }
  async ingestObservation(observation: SemanticObservation): Promise<boolean> {
    if (this.config.nodeEnvironment === 'production' || this.config.semanticMode !== 'fixture') {
      throw new BadRequestException(
        'Synthetic semantic ingestion is unavailable in this environment.',
      );
    }
    if (
      observation.provider !== 'fixture' ||
      ![FIXTURE_VERSION, STRESS_FIXTURE_VERSION].includes(observation.providerVersion)
    ) {
      throw new BadRequestException('Only the authored fixture provider is authorized.');
    }
    for (const id of [
      observation.id,
      observation.articleId,
      observation.occurrenceId,
      observation.threadId,
    ])
      parseUlid(id);
    const timestamps = [observation.observedAt];
    if (observation.eventAt !== null) timestamps.push(observation.eventAt);
    for (const timestamp of timestamps) {
      if (typeof timestamp !== 'string') {
        throw new BadRequestException('Observation time is required.');
      }
      const date = new Date(timestamp);
      if (!Number.isFinite(date.getTime()) || date.toISOString() !== timestamp) {
        throw new BadRequestException('Semantic timestamps must use canonical UTC ISO-8601.');
      }
    }
    for (const state of [observation.occurrenceState, observation.threadState]) {
      if (
        !['MATCH', 'DISTINCT', 'UNKNOWN'].includes(state.decision) ||
        !['APPLICABLE', 'INAPPLICABLE', 'UNKNOWN_APPLICABILITY'].includes(state.applicability)
      ) {
        throw new BadRequestException('Explicit semantic decision and applicability are required.');
      }
    }
    return this.repository.appendObservation(observation);
  }
  async listThreads(after?: string, limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new BadRequestException('Invalid page limit.');
    }
    const rows = await this.repository.listThreads(after, limit);
    return {
      items: rows.slice(0, limit),
      nextCursor: rows.length > limit ? (rows[limit - 1]?.id ?? null) : null,
    };
  }
  private async snapshot(id: Ulid) {
    const result = await this.repository.threadSnapshot(id);
    if (result === undefined) throw new NotFoundException('Thread not found.');
    return result;
  }
  async getThread(id: Ulid) {
    const snapshot = await this.snapshot(id);
    return { ...snapshot.detail, timeline: snapshot.timeline };
  }
  async getTimeline(id: Ulid) {
    return (await this.snapshot(id)).timeline;
  }
  async getThreadSources(id: Ulid) {
    return (await this.snapshot(id)).detail.sources;
  }
  async getOccurrence(id: Ulid) {
    const threadId = await this.repository.occurrenceThread(id);
    if (threadId === undefined) throw new NotFoundException('Occurrence not found.');
    const result = (await this.snapshot(threadId)).detail.occurrences.find(
      (item) => item.id === id,
    );
    if (result === undefined) throw new NotFoundException('Occurrence not found.');
    return result;
  }
  async getOccurrenceSources(id: Ulid) {
    return (await this.getOccurrence(id)).sources;
  }
  async getArticle(id: Ulid) {
    const result = await this.repository.articleDetail(id);
    if (result === undefined) throw new NotFoundException('Semantic Article not found.');
    return result;
  }
  async getArticleContext(id: Ulid) {
    const article = await this.getArticle(id);
    return { mode: 'fixture' as const, memberships: article.memberships };
  }
  async getProvenance(id: Ulid) {
    const result = await this.repository.getProvenance(id);
    if (result === undefined) throw new NotFoundException('Provenance not found.');
    return result;
  }
}
