import { sql, type Kysely } from 'kysely';

import { HARVESTERS, type HarvestOptions, type HarvestSource, type HarvestedStudy } from './harvest-sources.js';

export interface SourceReport {
  fetched: number;
  added: number;
  updated: number;
  skipped: number;
  error: string | null;
}

export interface HarvestReport {
  status: 'ok' | 'partial' | 'failed';
  sources: Record<HarvestSource, SourceReport>;
  added: number;
  updated: number;
  deleted: number;
  /** Approximate size in bytes of each Science table. */
  tableBytes: Record<string, number>;
  dryRun: boolean;
}

const TABLES = ['science_studies', 'story_comments', 'story_comment_studies', 'story_comment_reactions',
  'story_comment_reports', 'science_api_usage', 'science_harvest_runs'];

/**
 * Stores one study. Moderator fields are out of reach of the harvester role;
 * a study whose abstract a moderator loaded is left untouched. Returns
 * whether it was added or updated, or null when it was skipped.
 */
async function store(db: Kysely<unknown>, s: HarvestedStudy): Promise<'added' | 'updated' | null> {
  const rows = await sql<{ inserted: boolean }>`
    insert into public.science_studies(doi, title, review, authors, institution, journal, published_at, published_precision,
      abstract, abstract_source, abstract_language, access, retracted, retracted_at, made_in_chile, resolved_at, harvested_at,
      harvest_source)
    values (${s.doi}, ${s.title}, ${s.review}, ${s.authors}, ${s.institution}, ${s.journal}, ${s.published_at}::date,
      ${s.published_precision},
      ${s.abstract}, ${s.abstract_source}, ${s.abstract_language}, ${s.access}, ${s.retracted}, ${s.retracted_at}::date,
      ${s.made_in_chile}, now(), now(), ${s.harvest_source})
    on conflict (doi) do update set
      title = excluded.title,
      -- A review a moderator set stays; «not_reported» never overwrites one.
      review = case when public.science_studies.review_by_moderator or excluded.review = 'not_reported'
        then public.science_studies.review else excluded.review end,
      published_precision = case when public.science_studies.published_at is null
        then excluded.published_precision else public.science_studies.published_precision end,
      authors = coalesce(excluded.authors, public.science_studies.authors),
      institution = coalesce(public.science_studies.institution, excluded.institution),
      journal = coalesce(public.science_studies.journal, excluded.journal),
      published_at = coalesce(public.science_studies.published_at, excluded.published_at),
      -- Keep an abstract that is already there; fill one that is missing.
      abstract = coalesce(public.science_studies.abstract, excluded.abstract),
      abstract_source = case when public.science_studies.abstract is null then excluded.abstract_source
        else public.science_studies.abstract_source end,
      abstract_language = coalesce(public.science_studies.abstract_language, excluded.abstract_language),
      access = coalesce(public.science_studies.access, excluded.access),
      retracted = public.science_studies.retracted or excluded.retracted,
      made_in_chile = public.science_studies.made_in_chile or excluded.made_in_chile
    where not public.science_studies.abstract_by_moderator
    returning (xmax = 0) as inserted`.execute(db);
  const row = rows.rows[0];
  return row === undefined ? null : row.inserted ? 'added' : 'updated';
}

async function recordUsage(db: Kysely<unknown>, calls: Map<string, { calls: number; errors: number }>, today: string): Promise<void> {
  for (const [source, usage] of calls) {
    await sql`insert into public.science_api_usage(source, day, calls, errors)
      values (${source}, ${today}::date, ${usage.calls}, ${usage.errors})
      on conflict (source, day) do update set calls = public.science_api_usage.calls + excluded.calls,
        errors = public.science_api_usage.errors + excluded.errors`.execute(db);
  }
}

export async function runHarvest(
  db: Kysely<unknown> | null,
  options: Omit<HarvestOptions, 'onCall'>,
  sources: HarvestSource[] = ['openalex_cl', 'scielo_cl', 'europepmc', 'arxiv'],
): Promise<HarvestReport> {
  const calls = new Map<string, { calls: number; errors: number }>();
  const onCall = (source: string, ok: boolean) => {
    const usage = calls.get(source) ?? { calls: 0, errors: 0 };
    usage.calls += 1;
    if (!ok) usage.errors += 1;
    calls.set(source, usage);
  };
  let runId: string | null = null;
  if (db !== null) {
    const run = await sql<{ id: string }>`insert into public.science_harvest_runs default values returning id::text as id`.execute(db);
    runId = run.rows[0]!.id;
  }

  const report: HarvestReport = {
    status: 'ok',
    sources: {} as Record<HarvestSource, SourceReport>,
    added: 0,
    updated: 0,
    deleted: 0,
    tableBytes: {},
    dryRun: db === null,
  };
  const seen = new Set<string>();
  for (const source of sources) {
    const entry: SourceReport = { fetched: 0, added: 0, updated: 0, skipped: 0, error: null };
    report.sources[source] = entry;
    try {
      const batch = await HARVESTERS[source]({ ...options, onCall });
      entry.fetched = batch.studies.length;
      entry.skipped = batch.skipped;
      if (db === null) continue;
      for (const study of batch.studies) {
        // The same DOI from two sources is stored once per run.
        if (seen.has(study.doi)) continue;
        seen.add(study.doi);
        const outcome = await store(db, study);
        if (outcome === 'added') entry.added += 1;
        else if (outcome === 'updated') entry.updated += 1;
      }
    } catch (error) {
      entry.error = error instanceof Error ? error.message.slice(0, 300) : 'unknown error';
    }
    report.added += entry.added;
    report.updated += entry.updated;
  }

  const failures = Object.values(report.sources).filter((s) => s.error !== null).length;
  report.status = failures === 0 ? 'ok' : failures === sources.length ? 'failed' : 'partial';

  if (db !== null) {
    // Retention: harvested, older than 90 days, never connected or moderated
    // (enforced again by row security for this role).
    const deleted = await sql<{ doi: string }>`delete from public.science_studies
      where harvested_at < now() - interval '90 days' and moderated_at is null and not abstract_by_moderator
        and not public.dialektik_science_study_connected(doi)
      returning doi`.execute(db);
    report.deleted = deleted.rows.length;
    await recordUsage(db, calls, options.now.toISOString().slice(0, 10));
    const sizes = await sql<{ name: string; bytes: string }>`select c.relname as name, pg_total_relation_size(c.oid)::text as bytes
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any(${TABLES})`.execute(db);
    report.tableBytes = Object.fromEntries(sizes.rows.map((r) => [r.name, Number(r.bytes)]));
    await sql`update public.science_harvest_runs set finished_at = now(), status = ${report.status},
      added = ${report.added}, updated = ${report.updated}, deleted = ${report.deleted},
      details = ${JSON.stringify({ sources: report.sources, table_bytes: report.tableBytes })}::jsonb
      where id = ${runId}::bigint`.execute(db);
  }
  return report;
}

const LABELS: Record<HarvestSource, string> = {
  openalex_cl: 'OpenAlex (Chile)',
  scielo_cl: 'SciELO Chile',
  europepmc: 'Europe PMC (Chile)',
  arxiv: 'arXiv',
};

const size = (bytes: number): string =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;

/** Markdown for the run summary in GitHub Actions. */
export function reportMarkdown(report: HarvestReport): string {
  const lines = [
    `## Cosecha de Ciencia: ${report.status === 'ok' ? 'correcta' : report.status === 'partial' ? 'parcial' : 'fallida'}${report.dryRun ? ' (ensayo, sin base)' : ''}`,
    '',
    '| Fuente | Leídos | Agregados | Actualizados | Sin DOI | Error |',
    '|---|---:|---:|---:|---:|---|',
    ...Object.entries(report.sources).map(([source, s]) =>
      `| ${LABELS[source as HarvestSource]} | ${s.fetched} | ${s.added} | ${s.updated} | ${s.skipped} | ${s.error ?? ''} |`),
    '',
    `Agregados: **${report.added}** · actualizados: **${report.updated}** · borrados por retención (90 días): **${report.deleted}**`,
  ];
  const tables = Object.entries(report.tableBytes);
  if (tables.length > 0) {
    const total = tables.reduce((sum, [, bytes]) => sum + bytes, 0);
    lines.push('', `Tamaño aproximado de las tablas de Ciencia: **${size(total)}**`, '',
      ...tables.sort((a, b) => b[1] - a[1]).map(([name, bytes]) => `- \`${name}\`: ${size(bytes)}`));
  }
  return `${lines.join('\n')}\n`;
}
