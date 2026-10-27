#!/usr/bin/env node
/**
 * Dialektik release evidence gate. Safe against an actual DEV API:
 * no credentials, no sensitive reads, no POST/PUT/PATCH/DELETE, no DB access.
 * Product truth != source/news preview health != launch approval.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEV_ORIGIN = 'https://dialektik-core-dev.onrender.com';
const PROTECTED_PATHS = Object.freeze([
  '/v1/feed',
  '/v1/contradictions',
  '/live/preview/govuk',
  '/live/preview/events/chile-tornado',
]);

export function releaseDecision({ runtime } = {}) {
  const runtimeOk = runtime?.status === 'PASS';
  return {
    release_status: 'NO_GO_PUBLIC_LAUNCH',
    authenticated_private_beta: runtimeOk ? 'EXISTING_API_RUNTIME_OBSERVED' : 'RUNTIME_NOT_VERIFIED',
    autonomous_multi_source_ingestion: 'NOT_VERIFIED',
    persisted_event_grouping: 'NOT_VERIFIED',
    evidence_backed_contradictions: 'NOT_VERIFIED',
    disaster_recovery: 'NOT_VERIFIED',
    independent_semantic_gold: 'NOT_VERIFIED',
    flutter_store_distribution: 'NOT_VERIFIED',
    public_marketing_authorization: false,
    safe_external_claim: 'Private, invitation-only Android DEV pilot with human-reviewed source/event previews',
  };
}

async function probe(fetchImpl, path, timeoutMs = 15_000, attempts = 1) {
  // Render DEV can be cold. Retry only transport errors; never hide a real
  // HTTP 503, 404 or an auth bypass behind subsequent responses.
  for (let index = 1; index <= attempts; index++) {
    let response;
    try {
      response = await fetchImpl(DEV_ORIGIN + path, {
        method: 'GET',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      if (index < attempts) continue;
      return { kind: 'UNAVAILABLE', status: null, attempts: index };
    }
    // Deliberately NEVER read the response body of a protected route.
    if (!Number.isInteger(response.status)) return { kind: 'INVALID', status: null, attempts: index };
    return { kind: 'HTTP', status: response.status, attempts: index };
  }
  throw new Error('UNREACHABLE_ATTEMPT_LIMIT');
}

export async function inspectRuntime(fetchImpl = fetch) {
  const live = await probe(fetchImpl, '/health/live', 15_000, 4);
  const ready = await probe(fetchImpl, '/health/ready', 15_000, 4);
  const guarded = {};
  for (const path of PROTECTED_PATHS) {
    guarded[path] = await probe(fetchImpl, path);
  }
  const runtimeIsHealthy = live.status === 200 && ready.status === 200;
  const allPrivate = Object.values(guarded).every((item) => item.status === 401);
  return {
    status: runtimeIsHealthy && allPrivate ? 'PASS' : 'NO_GO',
    checked_origin: DEV_ORIGIN,
    checked_at: new Date().toISOString(),
    health_live_status: live.status,
    health_ready_status: ready.status,
    protected_endpoints: guarded,
    unauthenticated_private_routes_all_401: allPrivate,
    protected_payloads_read: false,
    credentials_supplied: false,
    database_writes: 0,
  };
}

async function main() {
  const mode = process.argv[2];
  if (mode !== '--runtime' && mode !== '--contract') {
    console.error('usage: node pilot-release-readiness.mjs --runtime|--contract');
    process.exitCode = 2;
    return;
  }
  const runtime = mode === '--runtime' ? await inspectRuntime() : { status: 'NOT_CHECKED' };
  const summary = {
    schema: 'dialektik-public-launch-truth-gate-v1',
    ...releaseDecision({ runtime }),
    runtime,
    note: 'A healthy private-beta preview is NOT autonomous ingestion or scientifically validated contradiction inference.',
  };
  const destination = process.env.DIALEKTIK_LAUNCH_REPORT_PATH;
  if (destination) {
    await mkdir(resolve(destination, '..'), { recursive: true });
    await writeFile(destination, JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 });
  }
  console.log('RELEASE_PUBLIC_LAUNCH=NO_GO');
  console.log('RELEASE_PRIVATE_BETA_RUNTIME=' + runtime.status);
  console.log('RELEASE_AUTONOMOUS_ARTICLES=NOT_VERIFIED');
  console.log('RELEASE_AUTONOMOUS_EVENTS=NOT_VERIFIED');
  console.log('RELEASE_VERIFIED_CONTRADICTIONS=NOT_VERIFIED');
  console.log('RELEASE_PERSISTENT_STORAGE=NOT_VERIFIED');
  console.log('RELEASE_REPORT_SAVED=' + String(Boolean(destination)));
  if (mode === '--runtime' && runtime.status !== 'PASS') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
