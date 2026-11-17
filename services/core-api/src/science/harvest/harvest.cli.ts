// Daily Science harvest, run by .github/workflows/science-harvest.yml.
//
//   node services/core-api/dist/science/harvest/harvest.cli.js [--dry-run]
//
// SCIENCE_HARVEST_DATABASE_URL: login of dialektik_science_harvester (never
// the service key). OPENALEX_API_KEY and SCIENCE_CONTACT_EMAIL as for Core.
// SCIENCE_HARVEST_DAYS (30), SCIENCE_HARVEST_LIMIT (300 per source),
// SCIENCE_HARVEST_ARXIV_CATEGORIES (comma separated).
// --dry-run reads the sources without a database and prints the counts.
// Exit code 1 when any source failed, so the workflow can alert.
import { appendFileSync } from 'node:fs';

import { createDatabase, destroyDatabase } from '@dialektik/database';
import type { Kysely } from 'kysely';

import { resolverOptionsFromEnv, type FetchLike } from '../study-resolver.js';
import { reportMarkdown, runHarvest } from './harvest.js';

export const DEFAULT_ARXIV_CATEGORIES = ['astro-ph.GA', 'astro-ph.SR', 'astro-ph.EP', 'astro-ph.CO', 'astro-ph.IM'];

function positive(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const env = process.env;
  const url = env.SCIENCE_HARVEST_DATABASE_URL?.trim();
  if (!dryRun && !url) throw new Error('SCIENCE_HARVEST_DATABASE_URL is required (or pass --dry-run).');
  const categories = (env.SCIENCE_HARVEST_ARXIV_CATEGORIES ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  const ca = env.DATABASE_CA_CERT?.trim() ?? '';
  if (!dryRun) {
    // Whether a CA arrived, never its content.
    process.stdout.write(ca.includes('BEGIN CERTIFICATE')
      ? 'Database CA: provided (SCIENCE_HARVEST_DATABASE_CA_CERT).\n'
      : ca === '' ? 'Database CA: not provided.\n' : 'Database CA: provided but not a PEM certificate.\n');
  }
  const database = dryRun ? null : createDatabase({
    connectionString: url!,
    applicationName: 'dialektik-science-harvest',
    maxConnections: 1,
    ...(env.DATABASE_CA_CERT?.trim() ? { caCertificate: env.DATABASE_CA_CERT } : {}),
  });
  try {
    const report = await runHarvest(database as Kysely<unknown> | null, {
      ...resolverOptionsFromEnv(env),
      fetcher: fetch as unknown as FetchLike,
      now: new Date(),
      days: positive(env.SCIENCE_HARVEST_DAYS, 30, 90),
      limit: positive(env.SCIENCE_HARVEST_LIMIT, 300, 1000),
      arxivCategories: categories.length > 0 ? categories : DEFAULT_ARXIV_CATEGORIES,
    });
    const markdown = reportMarkdown(report);
    process.stdout.write(markdown);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
    if (report.status !== 'ok') process.exitCode = 1;
  } finally {
    if (database) await destroyDatabase(database).catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Science harvest failed: ${message}\n`);
  if (/certificate/iu.test(message)) {
    process.stderr.write('The database TLS chain did not verify: store in SCIENCE_HARVEST_DATABASE_CA_CERT the same Supabase CA\n'
      + 'certificate that Core uses on Render (Supabase → Database settings → SSL → download), PEM text included.\n');
  }
  process.exitCode = 1;
});
