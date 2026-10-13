import { sql, type Kysely, type Migration } from 'kysely';
import type { Database } from '../database.types';

const SCHEMA = String.raw`
create table personal_owner_audit_events (
  id dialektik_ulid primary key,
  owner_identity text not null check (owner_identity ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  event_type text not null check (event_type in ('OWNER_STATUS_VIEWED')),
  request_fingerprint_sha256 text not null check (request_fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz(3) not null
);
create index personal_owner_audit_events_latest on personal_owner_audit_events(recorded_at desc,id desc);
create trigger personal_owner_audit_events_immutable before update or delete on personal_owner_audit_events
  for each row execute function dialektik_semantic_content_append_only();
create trigger personal_owner_audit_events_no_truncate before truncate on personal_owner_audit_events
  for each statement execute function dialektik_semantic_content_append_only();
`;

export const personalOwnerAuditMigration: Migration = {
  async up(database: Kysely<Database>): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
  down(): Promise<void> {
    throw new Error('Personal-owner audit events are append-only and forward-only.');
  },
};
