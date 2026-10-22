import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../workflows/govuk-dynamic-discovery-ci.yml', import.meta.url), 'utf8');
const source = readFileSync(new URL('./govuk-housing-multi-source.mjs', import.meta.url), 'utf8');

test('periodic discovery is enabled only as readonly scheduled metadata', () => {
  assert.ok(workflow.includes("    - cron: '17 */6 * * *'"));
  assert.match(workflow, /permissions:\s*\n\s*contents: read\s*\n\s*actions: read/);
  assert.ok(!workflow.includes('DIALEKTIK_GOVUK_DISCOVERY_WATCH_ENABLED'));
  assert.ok(!workflow.includes('DATABASE_URL:'));
  assert.ok(!workflow.includes('SUPABASE_SERVICE_ROLE'));
  assert.match(source, /databaseWrites:0,eventsGenerated:0/);
  assert.match(source, /contradictionsGenerated:0,publicLaunchAuthority:false/);
});

test('incremental history is looked up on executing branch, never pinned to the old feature branch', () => {
  assert.match(workflow, /GH_BRANCH: \$\{\{ github.ref_name \}\}/);
  assert.match(workflow, /branch=\$GH_BRANCH&status=success&per_page=1/);
  assert.ok(!workflow.includes('branch=codex/govuk-incremental-discovery-state-20261021&status=success'));
  assert.match(workflow, /govuk-dynamic-readonly-receipt/);
  assert.match(workflow, /retention-days: 3/);
});

test('no background publication or server deployment step is hidden in discovery', () => {
  for (const denied of ['render deploy', 'supabase db', 'pg_restore', 'npm run db:migrate', 'gh workflow run', 'semantic_mode: live']) {
    assert.ok(!workflow.includes(denied), denied);
  }
  assert.match(workflow, /node \.github\/scripts\/govuk-housing-multi-source\.mjs/);
});
