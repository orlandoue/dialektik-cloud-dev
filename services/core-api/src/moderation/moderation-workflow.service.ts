import { isUlid, parseUlid, type Ulid } from '@dialektik/database';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { CoreDatabaseService } from '../database/core-database.service.js';
import { ModerationAuthService, type ModerationIdentity } from './moderation-auth.service.js';
import { EquivalenceReviewRepository } from './equivalence-review.repository.js';
import { ModerationDatabaseService } from './moderation-database.service.js';
import { ModerationHttpError } from './moderation-http.error.js';
import { ModerationWorkflowRepository } from './moderation-workflow.repository.js';
import { Od12AuthorizationError, Od12AuthorizationGate } from './od12-authorization.gate.js';

type JsonObject = Readonly<Record<string, unknown>>;

function hasAttribution(assertion: {
  readonly articleUrl: string;
  readonly articleTitle: string | null;
  readonly articleAuthor: string | null;
  readonly articlePublishedAt: Date | null;
  readonly sourceName: string;
}): boolean {
  try {
    const url = new URL(assertion.articleUrl);
    return url.protocol === 'https:' && url.hostname.length > 0 &&
      url.username.length === 0 && url.password.length === 0 && url.pathname !== '/' &&
      Boolean(assertion.articleTitle?.trim()) && Boolean(assertion.articleAuthor?.trim()) &&
      Boolean(assertion.sourceName.trim()) && assertion.articlePublishedAt instanceof Date &&
      Number.isFinite(assertion.articlePublishedAt.getTime());
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireExactKeys(value: unknown, keys: readonly string[]): JsonObject {
  if (!isObject(value)) throw new ModerationHttpError(400, 'MOD_INVALID_REQUEST');
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ModerationHttpError(400, 'MOD_INVALID_REQUEST');
  }
  return value;
}

function requireUlid(value: unknown): Ulid {
  if (typeof value !== 'string' || !isUlid(value)) {
    throw new ModerationHttpError(400, 'MOD_INVALID_REQUEST');
  }
  return parseUlid(value);
}

function requireUlidArray(value: unknown): readonly Ulid[] {
  if (!Array.isArray(value)) throw new ModerationHttpError(400, 'MOD_INVALID_REQUEST');
  const values = value.map(requireUlid);
  if (new Set(values).size !== values.length) {
    throw new ModerationHttpError(400, 'MOD_INVALID_REQUEST');
  }
  return Object.freeze(values);
}

@Injectable()
export class ModerationWorkflowService {
  private readonly authorization = new Od12AuthorizationGate();
  private repository: ModerationWorkflowRepository | undefined;

  public constructor(
    @Inject(CoreDatabaseService) private readonly databaseService: CoreDatabaseService,
    @Inject(ModerationAuthService) private readonly auth: ModerationAuthService,
    @Inject(ModerationDatabaseService) private readonly moderationDatabase: ModerationDatabaseService,
  ) {}

  public async session(authorization: string | undefined) {
    const identity = await this.authorize(authorization, 'inspect_queue');
    const result = identity.role === 'editor'
      ? await sql<{ readonly enabled: boolean }>`
          select exists (
            select 1 from public.editorial_single_editor_authorizations
            where editor_user_id = ${identity.userId} and revoked_at is null
          ) as enabled
        `.execute(this.databaseService.database)
      : undefined;
    return Object.freeze({
      userId: identity.userId,
      role: identity.role,
      singleEditorEnabled: result?.rows[0]?.enabled ?? false,
    });
  }

  public async list(authorization: string | undefined) {
    const identity = await this.authorize(authorization, 'inspect_queue');
    void identity;
    return EquivalenceReviewRepository.list(this.databaseService.database);
  }

  public async find(authorization: string | undefined, taskIdValue: string) {
    const identity = await this.authorize(authorization, 'inspect_candidate');
    const detail = await EquivalenceReviewRepository.find(
      this.databaseService.database,
      requireUlid(taskIdValue),
    );
    if (detail === null) throw new ModerationHttpError(404, 'MOD_NOT_FOUND');
    const boundedDetail = Object.freeze({
      ...detail,
      assertions: Object.freeze(detail.assertions.map((assertion) => {
        const length = Array.from(assertion.quotedText).length;
        return Object.freeze({
          ...assertion,
          quotedText: length >= 140 && length <= 300 && hasAttribution(assertion)
            ? assertion.quotedText
            : null,
        });
      })),
    });
    if (identity.role === 'editor' || detail.assignedTo === identity.userId) return boundedDetail;
    return Object.freeze({
      ...boundedDetail,
      proposals: Object.freeze(
        detail.proposals.filter(({ proposerId }) => proposerId === identity.userId),
      ),
    });
  }

  public async claim(
    authorization: string | undefined,
    taskIdValue: string,
    commandIdValue: string | undefined,
    body: unknown,
  ) {
    requireExactKeys(body ?? {}, []);
    const identity = await this.auth.authenticate(authorization);
    return this.writeRepository().claim(
      identity,
      requireUlid(taskIdValue),
      this.requireCommandId(commandIdValue),
    );
  }

  public async release(
    authorization: string | undefined,
    taskIdValue: string,
    commandIdValue: string | undefined,
    body: unknown,
  ) {
    requireExactKeys(body ?? {}, []);
    const identity = await this.auth.authenticate(authorization);
    return this.writeRepository().release(
      identity,
      requireUlid(taskIdValue),
      this.requireCommandId(commandIdValue),
    );
  }

  public async reassign(
    authorization: string | undefined,
    taskIdValue: string,
    commandIdValue: string | undefined,
    body: unknown,
  ) {
    const payload = requireExactKeys(body, ['moderatorId']);
    const identity = await this.auth.authenticate(authorization);
    return this.writeRepository().reassign(
      identity,
      requireUlid(taskIdValue),
      this.requireCommandId(commandIdValue),
      requireUlid(payload.moderatorId),
    );
  }

  public async escalate(
    authorization: string | undefined,
    taskIdValue: string,
    commandIdValue: string | undefined,
    body: unknown,
  ) {
    requireExactKeys(body ?? {}, []);
    const identity = await this.auth.authenticate(authorization);
    return this.writeRepository().escalate(
      identity,
      requireUlid(taskIdValue),
      this.requireCommandId(commandIdValue),
    );
  }

  public async submitProposal(
    authorization: string | undefined,
    taskIdValue: string,
    commandIdValue: string | undefined,
    body: unknown,
  ) {
    if (!isObject(body) || (body.outcome !== 'accept_subset' && body.outcome !== 'split')) {
      throw new ModerationHttpError(400, 'MOD_INVALID_REQUEST');
    }
    const identity = await this.auth.authenticate(authorization);
    const taskId = requireUlid(taskIdValue);
    const commandId = this.requireCommandId(commandIdValue);
    if (body.outcome === 'accept_subset') {
      const payload = requireExactKeys(body, ['assertionIds', 'outcome']);
      const assertionIds = requireUlidArray(payload.assertionIds);
      if (assertionIds.length < 2) throw new ModerationHttpError(400, 'MOD_INVALID_REQUEST');
      return this.writeRepository().submitAcceptSubset(identity, taskId, commandId, assertionIds);
    }
    const payload = requireExactKeys(body, ['outcome', 'partitions']);
    if (!Array.isArray(payload.partitions) || payload.partitions.length < 2) {
      throw new ModerationHttpError(400, 'MOD_INVALID_REQUEST');
    }
    const partitions = payload.partitions.map(requireUlidArray);
    if (partitions.some((partition) => partition.length === 0)) {
      throw new ModerationHttpError(400, 'MOD_INVALID_REQUEST');
    }
    return this.writeRepository().submitSplit(identity, taskId, commandId, partitions);
  }

  public async confirm(
    authorization: string | undefined,
    taskIdValue: string,
    proposalIdValue: string,
    commandIdValue: string | undefined,
    body: unknown,
  ) {
    requireExactKeys(body ?? {}, []);
    const identity = await this.auth.authenticate(authorization);
    return this.writeRepository().confirm(
      identity,
      requireUlid(taskIdValue),
      requireUlid(proposalIdValue),
      this.requireCommandId(commandIdValue),
    );
  }

  public async refuse(
    authorization: string | undefined,
    taskIdValue: string,
    proposalIdValue: string,
    commandIdValue: string | undefined,
    body: unknown,
  ) {
    const payload = requireExactKeys(body, ['reason']);
    if (typeof payload.reason !== 'string') {
      throw new ModerationHttpError(400, 'MOD_INVALID_REQUEST');
    }
    const reason = payload.reason.trim();
    if (reason.length === 0 || reason.length > 500) {
      throw new ModerationHttpError(400, 'MOD_INVALID_REQUEST');
    }
    const identity = await this.auth.authenticate(authorization);
    return this.writeRepository().refuse(
      identity,
      requireUlid(taskIdValue),
      requireUlid(proposalIdValue),
      this.requireCommandId(commandIdValue),
      reason,
    );
  }

  private requireCommandId(value: string | undefined): Ulid {
    if (value === undefined) throw new ModerationHttpError(400, 'MOD_IDEMPOTENCY_REQUIRED');
    return requireUlid(value);
  }

  private writeRepository(): ModerationWorkflowRepository {
    this.repository ??= new ModerationWorkflowRepository(this.moderationDatabase.database);
    return this.repository;
  }

  private async authorize(
    authorization: string | undefined,
    capability: 'inspect_candidate' | 'inspect_queue',
  ): Promise<ModerationIdentity> {
    const identity = await this.auth.authenticate(authorization);
    try {
      this.authorization.assertAuthorized(identity.role, capability);
    } catch (error) {
      if (error instanceof Od12AuthorizationError) {
        throw new ModerationHttpError(403, 'MOD_FORBIDDEN');
      }
      throw error;
    }
    return identity;
  }
}
