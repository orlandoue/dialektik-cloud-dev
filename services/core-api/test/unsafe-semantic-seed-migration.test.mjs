import assert from 'node:assert/strict';
import { test } from 'node:test';
import { up, down } from '../../../packages/database/dist/migration/043_chile_seed_and_semantic_writer_scope.js';

test('unsafe legacy semantic seed cannot grant roles or delete data', async () => {
  const database = new Proxy({}, {
    get() { throw new Error('The disabled draft must not access the database'); },
  });
  await assert.rejects(up(database), /MIGRATION_043_UNSAFE_DRAFT_DISABLED/);
  await assert.rejects(down(database), /MIGRATION_043_UNSAFE_DRAFT_DISABLED/);
});
