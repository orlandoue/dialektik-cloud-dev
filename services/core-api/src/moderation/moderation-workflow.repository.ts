import { createHash } from 'node:crypto';

import {
  generateUlid,
  type JsonValue,
  setTransactionAuditContext,
  setTransactionAuditMetadata,
  type Ulid,
  type UserRole,
} from '@dialektik/database';
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';

import type { ModerationIdentity } from './moderation-auth.service.js';
import { EquivalenceReviewRepository } from './equivalence-review.repository.js';
import { moderationConflict, ModerationHttpError } from './moderation-http.error.js';
import {
  type ModerationCapability,
  Od12AuthorizationError,
  Od12AuthorizationGate,
} from './od12-authorization.gate.js';
import type { Database, ModerationCommandType } from '@dialektik/database';

type CommandResponse = Readonly<Record<string, JsonValue>>;
type CommandAuditMetadata = Readonly<Record<string, JsonValue>>;

interface AuthenticatedActor {
  readonly userId: Ulid;
  readonly role: UserRole;
}

interface CurrentActor extends AuthenticatedActor {
  readonly singleEditorAuthorizationId: Ulid | null;
}

interface CommandDefinition {
  readonly capability: ModerationCapability;
  readonly commandId: Ulid;
  readonly commandType: ModerationCommandType;
  readonly payload: JsonValue;
  readonly taskId: Ulid;
  readonly auditAction: 'confirmed' | 'dismissed' | 'moderation_decision';
}

function payloadHash(payload: JsonValue): string {
  return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

function asCommandResponse(value: JsonValue): CommandResponse {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('Persisted moderation command response is invalid');
  }
  return value as CommandResponse;
}

function newId(now: Date): Ulid {
  return generateUlid({ now: () => now.getTime() });
}

export class ModerationWorkflowRepository {
  private readonly authorization = new Od12AuthorizationGate();

  public constructor(private readonly database: Kysely<Database>) {}

  public claim(
    identity: ModerationIdentity,
    taskId: Ulid,
    commandId: Ulid,
  ): Promise<CommandResponse> {
    return this.runCommand(
      identity,
      {
        auditAction: 'moderation_decision',
        capability: 'claim_task',
        commandId,
        commandType: 'claim',
        payload: {},
        taskId,
      },
      async (transaction, actor) => {
        await this.requireCurrentReview(transaction, taskId);
        const updated = await transaction
          .updateTable('moderation_tasks')
          .set({ assigned_to: actor.userId })
          .where('id', '=', taskId)
          .where('state', '=', 'pending')
          .where('assigned_to', 'is', null)
          .returning(['id', 'state', 'assigned_to'])
          .executeTakeFirst();
        if (updated === undefined) throw moderationConflict('MOD_TASK_CONFLICT');
        return {
          assignedTo: updated.assigned_to,
          state: updated.state,
          taskId: updated.id,
        };
      },
    );
  }

  public release(
    identity: ModerationIdentity,
    taskId: Ulid,
    commandId: Ulid,
  ): Promise<CommandResponse> {
    return this.runCommand(
      identity,
      {
        auditAction: 'moderation_decision',
        capability: 'release_task',
        commandId,
        commandType: 'release',
        payload: {},
        taskId,
      },
      async (transaction, actor) => {
        await this.lockTask(transaction, taskId);
        let query = transaction
          .updateTable('moderation_tasks')
          .set({ assigned_to: null })
          .where('id', '=', taskId)
          .where('state', 'in', ['pending', 'escalated'])
          .where('assigned_to', 'is not', null);
        if (actor.role === 'moderator') query = query.where('assigned_to', '=', actor.userId);
        const updated = await query.returning(['id', 'state', 'assigned_to']).executeTakeFirst();
        if (updated === undefined) throw moderationConflict('MOD_TASK_CONFLICT');
        return { assignedTo: null, state: updated.state, taskId: updated.id };
      },
    );
  }

  public reassign(
    identity: ModerationIdentity,
    taskId: Ulid,
    commandId: Ulid,
    moderatorId: Ulid,
  ): Promise<CommandResponse> {
    return this.runCommand(
      identity,
      {
        auditAction: 'moderation_decision',
        capability: 'reassign_task',
        commandId,
        commandType: 'reassign',
        payload: { moderatorId },
        taskId,
      },
      async (transaction) => {
        await this.lockTask(transaction, taskId);
        const moderator = await transaction
          .selectFrom('users')
          .select('id')
          .where('id', '=', moderatorId)
          .where('role', '=', 'moderator')
          .executeTakeFirst();
        if (moderator === undefined) throw new ModerationHttpError(400, 'MOD_INVALID_REQUEST');
        const updated = await transaction
          .updateTable('moderation_tasks')
          .set({ assigned_to: moderatorId })
          .where('id', '=', taskId)
          .where('state', 'in', ['pending', 'escalated'])
          .returning(['id', 'state', 'assigned_to'])
          .executeTakeFirst();
        if (updated === undefined) throw moderationConflict('MOD_TASK_CONFLICT');
        return {
          assignedTo: updated.assigned_to,
          state: updated.state,
          taskId: updated.id,
        };
      },
    );
  }

  public escalate(
    identity: ModerationIdentity,
    taskId: Ulid,
    commandId: Ulid,
  ): Promise<CommandResponse> {
    return this.runCommand(
      identity,
      {
        auditAction: 'moderation_decision',
        capability: 'escalate_task',
        commandId,
        commandType: 'escalate',
        payload: {},
        taskId,
      },
      async (transaction, actor) => {
        await this.lockTask(transaction, taskId);
        const updated = await transaction
          .updateTable('moderation_tasks')
          .set({ assigned_to: null, state: 'escalated' })
          .where('id', '=', taskId)
          .where('state', '=', 'pending')
          .where('assigned_to', '=', actor.userId)
          .returning(['id', 'state', 'assigned_to'])
          .executeTakeFirst();
        if (updated === undefined) throw moderationConflict('MOD_TASK_CONFLICT');
        return { assignedTo: null, state: updated.state, taskId: updated.id };
      },
    );
  }

  public submitAcceptSubset(
    identity: ModerationIdentity,
    taskId: Ulid,
    commandId: Ulid,
    assertionIds: readonly Ulid[],
  ): Promise<CommandResponse> {
    return this.submitProposal(identity, taskId, commandId, {
      assertionIds: [...assertionIds].sort(),
      outcome: 'accept_subset',
    });
  }

  public submitSplit(
    identity: ModerationIdentity,
    taskId: Ulid,
    commandId: Ulid,
    partitions: readonly (readonly Ulid[])[],
  ): Promise<CommandResponse> {
    const normalizedPartitions = partitions.map((partition) => [...partition].sort());
    return this.submitProposal(identity, taskId, commandId, {
      outcome: 'split',
      partitions: normalizedPartitions,
    });
  }

  public confirm(
    identity: ModerationIdentity,
    taskId: Ulid,
    proposalId: Ulid,
    commandId: Ulid,
  ): Promise<CommandResponse> {
    return this.runCommand(
      identity,
      {
        auditAction: 'confirmed',
        capability: 'confirm_decision',
        commandId,
        commandType: 'confirm_proposal',
        payload: { proposalId },
        taskId,
      },
      async (transaction, actor, now, hash, auditMetadata) => {
        void hash;
        const proposal = await this.lockSubmittedProposal(transaction, taskId, proposalId);
        const detail = await this.requireCurrentReview(transaction, taskId);
        if (!this.canDecideProposal(actor, proposal)) {
          throw new ModerationHttpError(403, 'MOD_FORBIDDEN');
        }
        const members = await transaction
          .selectFrom('moderation_review_proposal_members')
          .select(['assertion_id', 'partition_ordinal'])
          .where('proposal_id', '=', proposalId)
          .orderBy('assertion_id', 'asc')
          .execute();
        const resultingTaskState =
          proposal.outcome === 'accept_subset' && members.length < detail.assertions.length
            ? 'partially_accepted'
            : 'resolved';
        await setTransactionAuditMetadata(transaction, {
          ...auditMetadata,
          confirmer_user_id: actor.userId,
          outcome: proposal.outcome,
          proposal_id: proposalId,
          proposer_user_id: proposal.proposer_id,
          review_mode:
            proposal.single_editor_authorization_id === null ? 'dual_control' : 'single_editor',
          single_editor_authorization_id: proposal.single_editor_authorization_id,
          resulting_task_state: resultingTaskState,
        });
        await transaction
          .updateTable('moderation_review_proposals')
          .set({ decided_at: now, decided_by: actor.userId, state: 'confirmed' })
          .where('id', '=', proposalId)
          .executeTakeFirstOrThrow();

        const relationshipIds: Ulid[] = [];
        let remainderCandidateClassId: Ulid | null = null;
        let remainderTaskId: Ulid | null = null;
        if (proposal.outcome === 'accept_subset') {
          const selectedIds = members.map(({ assertion_id: assertionId }) => assertionId).sort();
          for (let index = 1; index < selectedIds.length; index += 1) {
            const leftId = selectedIds[index - 1];
            const rightId = selectedIds[index];
            if (leftId === undefined || rightId === undefined) {
              throw new Error('Confirmed subset lost a persisted member');
            }
            const relationshipId = newId(now);
            relationshipIds.push(relationshipId);
            await transaction
              .insertInto('relationships')
              .values({
                confidence: null,
                confirmed_at: now,
                confirmed_by: actor.userId,
                declared_by: proposal.proposer_id,
                event_id: detail.eventId,
                id: relationshipId,
                moderation_proposal_id: proposalId,
                non_comparable_reason: null,
                publication_state: 'published',
                rectified_by: null,
                rel_type: 'R01a',
                scope: 'intra_event',
                similarity_score: null,
                triggering_evidence_id: null,
              })
              .execute();
            await transaction
              .insertInto('relationship_endpoints')
              .values([
                {
                  assertion_id: leftId,
                  endpoint_order: 1,
                  relationship_id: relationshipId,
                  role: 'peer',
                },
                {
                  assertion_id: rightId,
                  endpoint_order: 2,
                  relationship_id: relationshipId,
                  role: 'peer',
                },
              ])
              .execute();
          }
          const selected = new Set(selectedIds);
          const remainderIds = detail.assertions
            .map(({ assertionId }) => assertionId)
            .filter((assertionId) => !selected.has(assertionId))
            .sort();
          const partial = remainderIds.length > 0;
          await transaction
            .updateTable('candidate_classes')
            .set({ state: partial ? 'partially_accepted' : 'accepted' })
            .where('id', '=', detail.candidateClassId)
            .execute();
          await transaction
            .updateTable('moderation_tasks')
            .set({
              resolution_reason: partial ? 'accept_subset_partial' : 'accept_subset_full',
              resolved_at: now,
              state: partial ? 'partially_accepted' : 'resolved',
            })
            .where('id', '=', taskId)
            .execute();
          if (remainderIds.length >= 2) {
            const original = await transaction
              .selectFrom('candidate_classes')
              .select(['model_ref', 'model_version'])
              .where('id', '=', detail.candidateClassId)
              .executeTakeFirstOrThrow();
            const newCandidateClassId = newId(now);
            remainderCandidateClassId = newCandidateClassId;
            remainderTaskId = newId(now);
            await transaction
              .insertInto('candidate_classes')
              .values({
                created_at: now,
                event_id: detail.eventId,
                id: newCandidateClassId,
                model_ref: original.model_ref,
                model_version: original.model_version,
                origin_proposal_id: proposalId,
                state: 'proposed',
              })
              .execute();
            await transaction
              .insertInto('candidate_class_members')
              .values(
                remainderIds.map((assertionId) => ({
                  assertion_id: assertionId,
                  candidate_class_id: newCandidateClassId,
                })),
              )
              .execute();
            await transaction
              .insertInto('moderation_tasks')
              .values({
                assigned_to: null,
                created_at: now,
                id: remainderTaskId,
                origin_proposal_id: proposalId,
                priority: 0,
                projection_event_id: null,
                projection_hash: null,
                projection_position_a_id: null,
                projection_position_b_id: null,
                resolution_reason: null,
                resolved_at: null,
                state: 'pending',
                target_id: newCandidateClassId,
                target_type: 'CandidateClass',
                task_type: 'equivalence_review',
              })
              .execute();
          }
        } else {
          await transaction
            .updateTable('candidate_classes')
            .set({ state: 'superseded' })
            .where('id', '=', detail.candidateClassId)
            .execute();
          await transaction
            .updateTable('moderation_tasks')
            .set({ resolution_reason: 'split_confirmed', resolved_at: now, state: 'resolved' })
            .where('id', '=', taskId)
            .execute();
        }
        return {
          outcome: proposal.outcome,
          proposalId,
          relationshipIds,
          remainderCandidateClassId,
          remainderTaskId,
          state: 'confirmed',
          taskId,
        };
      },
    );
  }

  public refuse(
    identity: ModerationIdentity,
    taskId: Ulid,
    proposalId: Ulid,
    commandId: Ulid,
    reason: string,
  ): Promise<CommandResponse> {
    return this.runCommand(
      identity,
      {
        auditAction: 'dismissed',
        capability: 'refuse_decision',
        commandId,
        commandType: 'refuse_proposal',
        payload: { proposalId, reason },
        taskId,
      },
      async (transaction, actor, now, hash, auditMetadata) => {
        void hash;
        const proposal = await this.lockSubmittedProposal(transaction, taskId, proposalId);
        const detail = await this.requireCurrentReview(transaction, taskId);
        if (!this.canDecideProposal(actor, proposal)) {
          throw new ModerationHttpError(403, 'MOD_FORBIDDEN');
        }
        await setTransactionAuditMetadata(transaction, {
          ...auditMetadata,
          decision_reason: reason,
          outcome: proposal.outcome,
          proposal_id: proposalId,
          proposer_user_id: proposal.proposer_id,
          review_mode:
            proposal.single_editor_authorization_id === null ? 'dual_control' : 'single_editor',
          single_editor_authorization_id: proposal.single_editor_authorization_id,
          refusing_editor_user_id: actor.userId,
          resulting_task_state: detail.taskState,
        });
        await transaction
          .updateTable('moderation_review_proposals')
          .set({
            decided_at: now,
            decided_by: actor.userId,
            decision_reason: reason,
            state: 'refused',
          })
          .where('id', '=', proposalId)
          .execute();
        return { outcome: proposal.outcome, proposalId, state: 'refused', taskId };
      },
    );
  }

  private submitProposal(
    identity: ModerationIdentity,
    taskId: Ulid,
    commandId: Ulid,
    proposal:
      | { readonly assertionIds: readonly Ulid[]; readonly outcome: 'accept_subset' }
      | { readonly outcome: 'split'; readonly partitions: readonly (readonly Ulid[])[] },
  ): Promise<CommandResponse> {
    return this.runCommand(
      identity,
      {
        auditAction: 'moderation_decision',
        capability: 'propose_decision',
        commandId,
        commandType: 'submit_proposal',
        payload: proposal,
        taskId,
      },
      async (transaction, actor, now, hash, auditMetadata) => {
        await this.lockTask(transaction, taskId);
        const detail = await this.requireCurrentReview(transaction, taskId);
        if (detail.assignedTo !== actor.userId) throw moderationConflict('MOD_TASK_CONFLICT');
        const availableIds = new Set(detail.assertions.map(({ assertionId }) => assertionId));
        const normalizedMembers =
          proposal.outcome === 'accept_subset'
            ? proposal.assertionIds.map((assertionId) => ({
                assertionId,
                partitionOrdinal: null,
              }))
            : proposal.partitions.flatMap((partition, index) =>
                partition.map((assertionId) => ({
                  assertionId,
                  partitionOrdinal: index + 1,
                })),
              );
        if (
          normalizedMembers.some(({ assertionId }) => !availableIds.has(assertionId)) ||
          new Set(normalizedMembers.map(({ assertionId }) => assertionId)).size !==
            normalizedMembers.length ||
          (proposal.outcome === 'accept_subset' && normalizedMembers.length < 2) ||
          (proposal.outcome === 'split' &&
            (proposal.partitions.length < 2 ||
              proposal.partitions.some((partition) => partition.length === 0) ||
              normalizedMembers.length !== availableIds.size))
        ) {
          throw new ModerationHttpError(400, 'MOD_INVALID_REQUEST');
        }
        const proposalId = newId(now);
        await setTransactionAuditMetadata(transaction, {
          ...auditMetadata,
          outcome: proposal.outcome,
          proposal_id: proposalId,
          proposer_user_id: actor.userId,
          review_mode: actor.role === 'editor' ? 'single_editor' : 'dual_control',
          single_editor_authorization_id: actor.singleEditorAuthorizationId,
          resulting_task_state: detail.taskState,
        });
        await transaction
          .insertInto('moderation_review_proposal_members')
          .values(
            normalizedMembers.map(({ assertionId, partitionOrdinal }) => ({
              assertion_id: assertionId,
              partition_ordinal: partitionOrdinal,
              proposal_id: proposalId,
            })),
          )
          .execute();
        await transaction
          .insertInto('moderation_review_proposals')
          .values({
            candidate_class_id: detail.candidateClassId,
            decided_at: null,
            decided_by: null,
            decision_reason: null,
            id: proposalId,
            outcome: proposal.outcome,
            payload_hash: hash,
            proposer_id: actor.userId,
            single_editor_authorization_id: actor.singleEditorAuthorizationId,
            state: 'submitted',
            submitted_at: now,
            task_id: taskId,
          })
          .execute();
        return { outcome: proposal.outcome, proposalId, state: 'submitted', taskId };
      },
    );
  }

  private async runCommand(
    identity: ModerationIdentity,
    definition: CommandDefinition,
    mutation: (
      transaction: Transaction<Database>,
      actor: CurrentActor,
      now: Date,
      hash: string,
      auditMetadata: CommandAuditMetadata,
    ) => Promise<CommandResponse>,
  ): Promise<CommandResponse> {
    const hash = payloadHash(definition.payload);
    try {
      return await this.database
        .transaction()
        .setIsolationLevel('serializable')
        .execute(async (transaction) => {
          await sql`
            select pg_advisory_xact_lock(
              hashtextextended(
                ${`${identity.userId}:${definition.taskId}:${definition.commandId}`},
                0
              )
            )
          `.execute(transaction);
          const authenticatedActor = await this.resolveCurrentActor(transaction, identity);
          const authorization = authenticatedActor.role === 'editor'
            ? await sql<{ readonly id: Ulid }>`
                select id from public.editorial_single_editor_authorizations
                where editor_user_id = ${authenticatedActor.userId} and revoked_at is null
              `.execute(transaction)
            : null;
          const actor: CurrentActor = {
            ...authenticatedActor,
            singleEditorAuthorizationId: authorization?.rows[0]?.id ?? null,
          };
          this.authorization.assertAuthorized(
            actor.role,
            definition.capability,
            actor.singleEditorAuthorizationId !== null,
          );
          const receipt = await transaction
            .selectFrom('moderation_command_receipts')
            .select(['command_type', 'payload_hash', 'response_payload'])
            .where('actor_id', '=', actor.userId)
            .where('task_id', '=', definition.taskId)
            .where('command_id', '=', definition.commandId)
            .executeTakeFirst();
          if (receipt !== undefined) {
            if (receipt.command_type !== definition.commandType || receipt.payload_hash !== hash) {
              throw moderationConflict('MOD_IDEMPOTENCY_CONFLICT');
            }
            return asCommandResponse(receipt.response_payload);
          }
          const auditMetadata = await this.buildCommandAuditMetadata(
            transaction,
            actor,
            definition,
            hash,
          );
          await setTransactionAuditContext(transaction, {
            action: definition.auditAction,
            actorId: actor.userId,
            actorType: actor.role,
            correlationId: definition.commandId,
            metadata: auditMetadata,
            reasonCode: `phase6_${definition.commandType}`,
          });
          const now = new Date();
          const response = await mutation(transaction, actor, now, hash, auditMetadata);
          await transaction
            .insertInto('moderation_command_receipts')
            .values({
              actor_id: actor.userId,
              command_id: definition.commandId,
              command_type: definition.commandType,
              created_at: now,
              payload_hash: hash,
              response_payload: response,
              task_id: definition.taskId,
            })
            .execute();
          return response;
        });
    } catch (error) {
      if (error instanceof ModerationHttpError) throw error;
      if (error instanceof Od12AuthorizationError) {
        throw new ModerationHttpError(403, 'MOD_FORBIDDEN');
      }
      const message = error instanceof Error ? error.message : '';
      if (/current|stale|merged|tombstone|Phase 5|CandidateClass member/iu.test(message)) {
        throw moderationConflict('MOD_STALE_CONTEXT');
      }
      if (/proposal|terminal|submitted|confirmation|dual-control/iu.test(message)) {
        throw moderationConflict('MOD_PROPOSAL_CONFLICT');
      }
      if (/task|claim|assignment|serialize|could not serialize/iu.test(message)) {
        throw moderationConflict('MOD_TASK_CONFLICT');
      }
      throw error;
    }
  }

  private async buildCommandAuditMetadata(
    transaction: Transaction<Database>,
    actor: CurrentActor,
    definition: CommandDefinition,
    hash: string,
  ): Promise<CommandAuditMetadata> {
    const task = await transaction
      .selectFrom('moderation_tasks')
      .select(['state', 'target_id', 'target_type'])
      .where('id', '=', definition.taskId)
      .executeTakeFirst();
    const previousTaskState = task?.state ?? null;
    return {
      actor_id: actor.userId,
      actor_role: actor.role,
      candidate_class_id: task?.target_type === 'CandidateClass' ? task.target_id : null,
      command_id: definition.commandId,
      command_type: definition.commandType,
      payload_hash: hash,
      previous_task_state: previousTaskState,
      resulting_task_state: definition.commandType === 'escalate' ? 'escalated' : previousTaskState,
      task_id: definition.taskId,
    };
  }

  private async resolveCurrentActor(
    transaction: Transaction<Database>,
    identity: ModerationIdentity,
  ): Promise<AuthenticatedActor> {
    if (identity.kind === 'beta') {
      // Recheck the binding, beta access, role and JWT expiry within the same
      // transaction that applies the editorial command.
      const result = await sql<AuthenticatedActor>`
        select u.id as "userId", u.role
        from public.editorial_beta_identities binding
        join public.users u on u.id = binding.editorial_user_id
        join public.private_beta_testers beta on beta.user_id = binding.auth_user_id
        where binding.auth_user_id = ${identity.authUserId}::uuid
          and binding.editorial_user_id = ${identity.userId}
          and binding.enabled is true and binding.revoked_at is null
          and beta.enabled is true and beta.revoked_at is null
          and u.role in ('editor', 'moderator')
          and to_timestamp(${identity.tokenExpiresAt}) > clock_timestamp()
      `.execute(transaction);
      const actor = result.rows[0];
      if (actor === undefined) throw new ModerationHttpError(401, 'MOD_AUTH_INVALID');
      return actor;
    }

    const actor = await transaction
      .selectFrom('moderation_auth_sessions as session')
      .innerJoin('users as user', 'user.id', 'session.user_id')
      .select(['user.id as userId', 'user.role'])
      .where('session.id', '=', identity.sessionId)
      .where('session.token_hash', '=', identity.tokenHash)
      .where('session.revoked_at', 'is', null)
      .where('session.expires_at', '>', sql<Date>`clock_timestamp()`)
      .executeTakeFirst();
    if (actor === undefined || actor.userId !== identity.userId) {
      throw new ModerationHttpError(401, 'MOD_AUTH_INVALID');
    }
    return actor;
  }

  private async lockTask(transaction: Transaction<Database>, taskId: Ulid): Promise<void> {
    const task = await transaction
      .selectFrom('moderation_tasks')
      .select('id')
      .where('id', '=', taskId)
      .where('task_type', '=', 'equivalence_review')
      .where('target_type', '=', 'CandidateClass')
      .forUpdate()
      .executeTakeFirst();
    if (task === undefined) throw new ModerationHttpError(404, 'MOD_NOT_FOUND');
  }

  private async requireCurrentReview(transaction: Transaction<Database>, taskId: Ulid) {
    const detail = await EquivalenceReviewRepository.findInTransaction(transaction, taskId);
    if (detail === null) throw new ModerationHttpError(404, 'MOD_NOT_FOUND');
    if (!detail.isCurrentSnapshot) throw moderationConflict('MOD_STALE_CONTEXT');
    return detail;
  }

  private async lockSubmittedProposal(
    transaction: Transaction<Database>,
    taskId: Ulid,
    proposalId: Ulid,
  ) {
    const proposal = await transaction
      .selectFrom('moderation_review_proposals')
      .select(['id', 'outcome', 'proposer_id', 'single_editor_authorization_id'])
      .where('id', '=', proposalId)
      .where('task_id', '=', taskId)
      .where('state', '=', 'submitted')
      .forUpdate()
      .executeTakeFirst();
    if (proposal === undefined) throw moderationConflict('MOD_PROPOSAL_CONFLICT');
    return proposal;
  }

  private canDecideProposal(
    actor: CurrentActor,
    proposal: { readonly proposer_id: Ulid; readonly single_editor_authorization_id: Ulid | null },
  ): boolean {
    if (proposal.single_editor_authorization_id === null) {
      return proposal.proposer_id !== actor.userId;
    }
    return proposal.proposer_id === actor.userId &&
      proposal.single_editor_authorization_id === actor.singleEditorAuthorizationId;
  }
}
