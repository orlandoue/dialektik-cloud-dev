import { sql, type Kysely, type Transaction } from 'kysely';

import type { AuditActionType, AuditActorType, Database, JsonValue } from './database.types';
import type { Ulid } from './domain/ids';

export type DatabaseExecutor = Kysely<Database> | Transaction<Database>;

export async function inTransaction<Result>(
  database: Kysely<Database>,
  operation: (transaction: Transaction<Database>) => Promise<Result>,
): Promise<Result> {
  return database.transaction().execute(operation);
}

export interface AuditContext {
  readonly actorType: AuditActorType;
  readonly actorId: Ulid | null;
  readonly correlationId: Ulid;
  readonly action: AuditActionType;
  readonly reasonCode?: string | null;
  readonly metadata?: JsonValue;
}

export async function setTransactionAuditMetadata(
  transaction: Transaction<Database>,
  metadata: JsonValue,
): Promise<void> {
  await sql`
    select set_config(
      'dialektik.audit_metadata',
      ${JSON.stringify(metadata)},
      true
    )
  `.execute(transaction);
}

export async function setTransactionAuditContext(
  transaction: Transaction<Database>,
  context: AuditContext,
): Promise<void> {
  await sql`
    select dialektik_set_audit_context(
      ${context.actorType}::audit_actor_type,
      ${context.actorId}::dialektik_ulid,
      ${context.correlationId}::dialektik_ulid,
      ${context.action}::audit_action_type,
      ${context.reasonCode ?? null}::text
    )
  `.execute(transaction);
  await setTransactionAuditMetadata(transaction, context.metadata ?? {});
}

export async function inAuditedTransaction<Result>(
  database: Kysely<Database>,
  context: AuditContext,
  operation: (transaction: Transaction<Database>) => Promise<Result>,
): Promise<Result> {
  return database.transaction().execute(async (transaction) => {
    await setTransactionAuditContext(transaction, context);
    return operation(transaction);
  });
}
