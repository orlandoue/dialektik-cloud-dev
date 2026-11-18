/**
 * Polls in duels. A duel only compares the same fact; for polls the same
 * fact is the same measurement: same pollster, same subject evaluated and
 * same round. Two different polls are different events. When two outlets
 * report the same measurement with different figures, the duel is valid and
 * its type is «Distinta cifra». Deterministic text rules, no AI.
 */
export interface PollText {
  /** Headline and first lines, as the engine compares them. */
  readonly text: string;
  readonly publishedAt: Date;
}

export interface PollReading {
  readonly isPoll: boolean;
  /** Canonical pollster name, or null when the text names none. */
  readonly pollster: string | null;
  /** Proper names evaluated (normalised), e.g. «kast», «boric». */
  readonly subjects: readonly string[];
  /** Fieldwork date written in the text (yyyy-mm-dd), if any. */
  readonly fieldwork: string | null;
  /** First percentage next to an approval or voting word. */
  readonly figure: number | null;
}

export type PollPairVerdict =
  | { kind: 'not_poll' }
  | { kind: 'same_measurement'; differentFigure: boolean }
  | { kind: 'different'; reason: 'poll_and_non_poll' | 'pollster_missing' | 'different_pollster' | 'different_subject' | 'different_round' };

const POLLSTERS: readonly (readonly [string, RegExp])[] = [
  ['Cadem', /\bcadem\b|\bplaza p[uú]blica\b/iu],
  ['CEP', /\bcep\b|centro de estudios p[uú]blicos/iu],
  ['Criteria', /\bcriteria\b/iu],
  ['Pulso Ciudadano', /pulso ciudadano|activa research/iu],
  ['Panel Ciudadano UDD', /panel ciudadano/iu],
  ['Black & White', /black\s*(?:&|and|y)\s*white/iu],
  ['Signos', /\bsignos\b/iu],
  ['Feedback', /\bfeedback\b/iu],
  ['Data Influye', /data influye/iu],
  ['Ipsos', /\bipsos\b/iu],
  ['Latinobarómetro', /latinobar[oó]metro/iu],
  ['Clapes UC', /clapes\s*uc/iu],
  ['Tu Influyes', /tu influyes/iu],
];

const POLL_WORDS = /\bencuesta|\bsondeo|\baprobaci[oó]n|\bdesaprobaci[oó]n|\bintenci[oó]n de voto|\bpreferencias? presidencial/iu;
const PERCENT = /(\d{1,3}(?:[.,]\d)?)\s?(?:%|por ciento|puntos)/iu;
/** «bajo el 20%», «más del 30%»: a threshold, not the figure measured. */
const THRESHOLD = /(?:bajo|sobre|menos|mas|encima|debajo)\s+(?:de\s+)?(?:el|del)\s*$/u;

const MEASURES = /\b(desaprobacion|aprobacion|desacuerdo|acuerdo|rechazo|rechaza|respaldo|apoyo|intencion de voto)/gu;

/**
 * The approval figure: the first percentage, not a threshold, whose nearest
 * measure word before it is «aprobación»; else the first one not a threshold.
 */
function figureOf(text: string): number | null {
  let first: number | null = null;
  for (const m of text.matchAll(/(\d{1,3}(?:[.,]\d)?)\s?(?:%|por ciento)/giu)) {
    const before = fold(text.slice(Math.max(0, m.index! - 120), m.index!));
    if (THRESHOLD.test(before.slice(-20))) continue;
    const value = Number(m[1]!.replace(',', '.'));
    first ??= value;
    const measures = [...before.matchAll(MEASURES)];
    if (measures.at(-1)?.[1] === 'aprobacion') return value;
  }
  return first;
}

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

/** Words that look like names in headlines but evaluate nobody. */
const NOT_SUBJECTS = new Set([
  'encuesta', 'sondeo', 'aprobacion', 'desaprobacion', 'segun', 'tras', 'chile', 'chilenos', 'chilenas', 'gobierno',
  'presidente', 'presidenta', 'mandatario', 'mandataria', 'la', 'el', 'los', 'las', 'un', 'una', 'en', 'de', 'del',
  'con', 'lea', 'aqui', 'ejecutivo', 'moneda', 'cae', 'sube', 'baja', 'alcanza', 'llega', 'marca', 'registra', 'nueva', 'nuevo', 'semana', 'puntos', 'por',
  ...Object.keys(MONTHS), 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo',
]);

const fold = (value: string): string => value.normalize('NFKD').replace(/[̀-ͯ]/gu, '').toLowerCase();

/** One pollster named; a text naming several reports no single measurement. */
function pollsterOf(text: string): string | null {
  const named = POLLSTERS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  return named.length === 1 ? named[0]! : null;
}

const namesPollster = (text: string): boolean => POLLSTERS.some(([, pattern]) => pattern.test(text));

function subjectsOf(text: string, pollster: string | null): string[] {
  const pollsterWords = new Set(pollster === null ? [] : fold(pollster).split(/\W+/u));
  const names = new Set<string>();
  // «aprobación de/a/del (Presidente) José Antonio Kast»: the evaluated one.
  const evaluated = [...text.matchAll(/aprobaci[oó]n\s+(?:de|a|al|del)\s+(?:la\s+|el\s+)?(?:(?:Presidente|Presidenta|mandatario|ministr[oa])\s+)?((?:[\p{Lu}][\p{Ll}]+\s*){1,4})/giu)]
    .map((m) => m[1]!).join(' ');
  for (const match of (evaluated || text).matchAll(/\b[\p{Lu}][\p{Ll}]+(?:[- ][\p{Lu}][\p{Ll}]+)*/gu)) {
    for (const word of fold(match[0]).split(/[\s-]+/u)) {
      if (word.length >= 3 && !NOT_SUBJECTS.has(word) && !pollsterWords.has(word)) names.add(word);
    }
  }
  return [...names].sort();
}

/** «levantada entre el 12 y el 14 de noviembre», «realizada el 13 de noviembre». */
function fieldworkOf(text: string, publishedAt: Date): string | null {
  const t = fold(text);
  const match = t.match(/(?:levantad[ao]s?|levanto|realizad[ao]s?|realizo|aplicad[ao]s?|aplico|terreno|muestreo)\b[^.]{0,40}?\b(\d{1,2})(?:\s*(?:y|al|-)\s*(?:el\s*)?(\d{1,2}))?\s+de\s+([a-z]+)/u);
  if (!match) return null;
  const month = MONTHS[match[3]!];
  if (month === undefined) return null;
  const last = Number(match[2] ?? match[1]);
  let year = publishedAt.getUTCFullYear();
  if (month > publishedAt.getUTCMonth() + 1) year -= 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

export function readPoll(input: PollText): PollReading {
  const pollster = pollsterOf(input.text);
  const words = POLL_WORDS.test(input.text);
  const percent = input.text.match(PERCENT);
  const isPoll = namesPollster(input.text) ? words || percent !== null : words && percent !== null;
  return {
    isPoll,
    pollster: isPoll ? pollster : null,
    subjects: isPoll ? subjectsOf(input.text, pollster) : [],
    fieldwork: isPoll ? fieldworkOf(input.text, input.publishedAt) : null,
    figure: isPoll ? figureOf(input.text) : null,
  };
}

const DAY = 86_400_000;
/** Without a fieldwork date, the same round means published within 3 days. */
export const SAME_ROUND_DAYS = 3;

export function comparePolls(left: PollText, right: PollText): PollPairVerdict {
  const a = readPoll(left);
  const b = readPoll(right);
  if (!a.isPoll && !b.isPoll) return { kind: 'not_poll' };
  if (a.isPoll !== b.isPoll) return { kind: 'different', reason: 'poll_and_non_poll' };
  if (a.pollster === null || b.pollster === null) return { kind: 'different', reason: 'pollster_missing' };
  if (a.pollster !== b.pollster) return { kind: 'different', reason: 'different_pollster' };
  if (!a.subjects.some((s) => b.subjects.includes(s))) return { kind: 'different', reason: 'different_subject' };
  const sameRound = a.fieldwork !== null && b.fieldwork !== null
    ? Math.abs(Date.parse(a.fieldwork) - Date.parse(b.fieldwork)) <= DAY
    : Math.abs(left.publishedAt.getTime() - right.publishedAt.getTime()) <= SAME_ROUND_DAYS * DAY;
  if (!sameRound) return { kind: 'different', reason: 'different_round' };
  return { kind: 'same_measurement', differentFigure: a.figure !== null && b.figure !== null && a.figure !== b.figure };
}

/** «Cadem: aprobación de Kast» — a poll event's title names its pollster. */
export function pollTitle(title: string, pollster: string): string {
  return fold(title).includes(fold(pollster)) ? title : `${pollster}: ${title}`;
}
