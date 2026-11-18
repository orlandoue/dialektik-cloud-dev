// Dry run of the poll rule over duels exported from Supabase (CSV of
// duelos_ultima_semana.sql). Reads nothing else and writes nothing.
//
//   node dist/semantic/poll-preview.cli.js duelos.csv > informe.md
import { readFileSync } from 'node:fs';

import { comparePolls, readPoll, splitTitle, type PollPairVerdict, type PollText } from './poll-measurement.js';

/** RFC 4180: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(body: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i]!;
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && body[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  const [header, ...data] = rows;
  return (data ?? []).map((r) => Object.fromEntries((header ?? []).map((h, i) => [h.trim(), r[i] ?? ''])));
}

interface Side { outlet: string; text: PollText }
interface Duel { id: string; title: string; a: Side[]; b: Side[] }

export type DuelOutcome = 'separa' | 'mantiene' | 'distinta_cifra' | 'no_aplica';

export function judgeDuel(duel: Duel): { outcome: DuelOutcome; verdicts: PollPairVerdict[] } {
  const verdicts = duel.a.flatMap((left) => duel.b.map((right) => comparePolls(left.text, right.text)));
  if (verdicts.every((v) => v.kind === 'not_poll')) return { outcome: 'no_aplica', verdicts };
  if (verdicts.some((v) => v.kind === 'different')) return { outcome: 'separa', verdicts };
  if (verdicts.some((v) => v.kind === 'same_measurement' && v.differentFigure)) return { outcome: 'distinta_cifra', verdicts };
  return { outcome: 'mantiene', verdicts };
}

const REASONS: Record<string, string> = {
  poll_and_non_poll: 'un lado es encuesta y el otro no',
  pollster_missing: 'a un lado le falta la encuestadora',
  different_pollster: 'encuestadoras distintas',
  different_subject: 'sujeto evaluado distinto',
  different_round: 'ronda distinta',
};

export function previewMarkdown(rows: Record<string, string>[]): string {
  const duels = new Map<string, Duel>();
  for (const r of rows) {
    const duel = duels.get(r.duel_id!) ?? { id: r.duel_id!, title: r.event_title ?? '', a: [], b: [] };
    // Title and lead only: quotes may come from further down the story.
    const side: Side = { outlet: r.outlet ?? '', text: splitTitle(r.text_start ?? '', new Date(r.published_at ?? '')) };
    (r.side === 'A' ? duel.a : duel.b).push(side);
    duels.set(duel.id, duel);
  }
  const groups: Record<DuelOutcome, string[]> = { separa: [], mantiene: [], distinta_cifra: [], no_aplica: [] };
  for (const duel of duels.values()) {
    const { outcome, verdicts } = judgeDuel(duel);
    const describe = (s: Side) => {
      const p = readPoll(s.text);
      return p.isPoll
        ? `${s.outlet}: ${p.pollster ?? 'sin encuestadora'} · ${p.subjects.slice(0, 3).join(', ') || 'sin sujeto'} · ${p.figure ?? '–'} %`
          + ` · ${p.fieldwork ?? s.text.publishedAt.toISOString().slice(0, 10)}`
        : `${s.outlet}: no es encuesta`;
    };
    const reasons = [...new Set(verdicts.flatMap((v) => (v.kind === 'different' ? [REASONS[v.reason]] : [])))];
    groups[outcome].push(`- **${duel.title}**${reasons.length ? ` — ${reasons.join('; ')}` : ''}\n`
      + `  - A: ${duel.a.map(describe).join(' / ')}\n  - B: ${duel.b.map(describe).join(' / ')}`);
  }
  const section = (title: string, items: string[]) => [`## ${title} (${items.length})`, '', ...(items.length ? items : ['_Ninguno._']), ''];
  return [
    `# Regla de encuestas: ensayo sobre ${duels.size} duelos`, '',
    ...section('Se separarían', groups.separa),
    ...section('Se mantienen (misma medición, misma cifra)', groups.mantiene),
    ...section('«Distinta cifra» (misma medición, cifras distintas)', groups.distinta_cifra),
    ...section('No son encuestas: la regla no aplica', groups.no_aplica),
  ].join('\n');
}

if (process.argv[1]?.endsWith('poll-preview.cli.js') && process.argv[2]) {
  process.stdout.write(previewMarkdown(parseCsv(readFileSync(process.argv[2], 'utf8'))));
}
