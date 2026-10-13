import { sql, type Kysely, type Migration } from 'kysely';
import type { Database } from '../database.types';

const SCHEMA = String.raw`
create table personal_owner_source_poll_state (
  source_id dialektik_ulid primary key references sources(id),
  owner_identity text not null check (owner_identity ~ '^[a-zA-Z0-9_.:-]{1,128}$'),
  etag text check (etag is null or (length(etag) <= 512 and etag !~ '[\r\n]')),
  last_modified text check (last_modified is null or (length(last_modified) <= 128 and last_modified !~ '[\r\n]')),
  poll_interval_seconds integer not null default 300 check (poll_interval_seconds between 300 and 21600),
  consecutive_failures smallint not null default 0 check (consecutive_failures between 0 and 12),
  last_http_status smallint check (last_http_status is null or last_http_status between 100 and 599),
  last_polled_at timestamptz(3),
  last_success_at timestamptz(3),
  next_poll_at timestamptz(3) not null default clock_timestamp(),
  lease_until timestamptz(3),
  updated_at timestamptz(3) not null default clock_timestamp(),
  check (last_success_at is null or last_polled_at is null or last_success_at <= last_polled_at),
  check (updated_at <= clock_timestamp())
);
create index personal_owner_source_poll_due
  on personal_owner_source_poll_state(owner_identity,next_poll_at,source_id);
`;

export const personalOwnerAdaptiveFeedPollingMigration: Migration = {
  async up(database: Kysely<Database>): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
  down(): Promise<void> {
    throw new Error('Personal-owner adaptive feed polling state is forward-only.');
  },
};
