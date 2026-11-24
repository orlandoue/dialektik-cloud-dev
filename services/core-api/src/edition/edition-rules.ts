/**
 * The hourly edition of Inicio: fixed, published rules, no AI.
 *
 * Each case (or approved story, which counts as one) gets a score from how
 * many outlets cover it and how recent its last coverage is:
 *
 *   score = outlets × 0.5 ^ (hours since the last coverage / 12)
 *
 * so a case covered by eight outlets twelve hours ago weighs like one covered
 * by four now. Cases without coverage in 72 h leave the edition. No more than
 * two cases of the same category follow each other. The order says what
 * many outlets are covering now, never which version is right: versions are
 * not ranked here, and A/B is still drawn per reader.
 *
 * The «Duelo del día» is the duel (under 36 h old) of the highest-scoring
 * case. A moderator may pin a case to the top, hide it, or choose the duel,
 * always with a reason and an expiry; the edition says so.
 */
export const EDITION_RULES = {
  version: 'v1',
  halfLifeHours: 12,
  windowHours: 72,
  maxItems: 60,
  maxSameCategoryRun: 2,
  duelMaxAgeHours: 36,
  /** A case this wide, this new, outside the top, calls an extra edition. */
  breaking: { minOutlets: 4, withinMinutes: 60, topN: 10 },
  description: 'Ordenada por medios que lo cubren y novedad (mitad de peso cada 12 h); sin IA.',
} as const;

export interface EditionEvent {
  readonly id: string;
  readonly category: string;
  readonly sourceIds: readonly string[];
  readonly firstCoverage: Date;
  readonly lastCoverage: Date;
  /** When its duel was published, if it has one. */
  readonly duelAt: Date | null;
}

export interface EditionStory {
  readonly id: string;
  readonly title: string;
  readonly eventIds: readonly string[];
}

export interface EditionPin {
  readonly id: string;
  readonly targetKind: 'event' | 'story';
  readonly targetId: string;
  readonly action: 'pin' | 'hide' | 'duel';
  readonly reason: string;
  readonly expiresAt: Date;
}

export interface EditionItem {
  readonly kind: 'event' | 'story';
  readonly id: string;
  readonly event_ids: string[];
  /** The case whose card represents the item (the newest of a story). */
  readonly lead_event_id: string;
  readonly category: string;
  readonly outlets: number;
  readonly first_coverage_at: string;
  readonly last_coverage_at: string;
  readonly score: number;
  readonly pinned: boolean;
  readonly pin_reason: string | null;
}

export interface Edition {
  readonly rules_version: string;
  readonly rules: string;
  readonly items: EditionItem[];
  readonly duel_event_id: string | null;
  readonly duel_reason: 'score' | 'moderation' | null;
  readonly duel_pin_reason: string | null;
  readonly hidden: { kind: 'event' | 'story'; id: string; reason: string }[];
}

interface Unit {
  kind: 'event' | 'story';
  id: string;
  events: EditionEvent[];
}

const HOUR = 3_600_000;

export function editionScore(outlets: number, lastCoverage: Date, now: Date): number {
  const hours = Math.max(0, (now.getTime() - lastCoverage.getTime()) / HOUR);
  return Math.round(outlets * 0.5 ** (hours / EDITION_RULES.halfLifeHours) * 1000) / 1000;
}

function unitsOf(events: readonly EditionEvent[], stories: readonly EditionStory[]): Unit[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  const inStory = new Set<string>();
  const units: Unit[] = [];
  for (const story of stories) {
    const members = story.eventIds.map((id) => byId.get(id)).filter((e): e is EditionEvent => e !== undefined);
    if (members.length === 0) continue;
    // An event belongs to one story only: the first that claims it.
    const free = members.filter((e) => !inStory.has(e.id));
    if (free.length === 0) continue;
    free.forEach((e) => inStory.add(e.id));
    units.push({ kind: 'story', id: story.id, events: free });
  }
  for (const event of events) {
    if (!inStory.has(event.id)) units.push({ kind: 'event', id: event.id, events: [event] });
  }
  return units;
}

function itemOf(unit: Unit, now: Date, pin: EditionPin | undefined): EditionItem {
  const outlets = new Set(unit.events.flatMap((e) => e.sourceIds)).size;
  const last = new Date(Math.max(...unit.events.map((e) => e.lastCoverage.getTime())));
  const first = new Date(Math.min(...unit.events.map((e) => e.firstCoverage.getTime())));
  const lead = [...unit.events].sort((a, b) => b.lastCoverage.getTime() - a.lastCoverage.getTime() || (a.id < b.id ? -1 : 1))[0]!;
  return {
    kind: unit.kind,
    id: unit.id,
    event_ids: unit.events.map((e) => e.id).sort(),
    lead_event_id: lead.id,
    category: lead.category,
    outlets,
    first_coverage_at: first.toISOString(),
    last_coverage_at: last.toISOString(),
    score: editionScore(outlets, last, now),
    pinned: pin !== undefined,
    pin_reason: pin?.reason ?? null,
  };
}

const byScore = (a: EditionItem, b: EditionItem) =>
  b.score - a.score
  || b.last_coverage_at.localeCompare(a.last_coverage_at)
  || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** At most N items of one category in a row; the next other one moves up. */
function limitCategoryRuns(items: EditionItem[], max: number): EditionItem[] {
  const rest = [...items];
  const out: EditionItem[] = [];
  while (rest.length > 0) {
    const tail = out.slice(-max);
    const blocked = tail.length === max && tail.every((i) => i.category === tail[0]!.category) ? tail[0]!.category : null;
    const index = blocked === null ? 0 : rest.findIndex((i) => i.category !== blocked);
    out.push(...rest.splice(index === -1 ? 0 : index, 1));
  }
  return out;
}

export function composeEdition(
  events: readonly EditionEvent[],
  stories: readonly EditionStory[],
  pins: readonly EditionPin[],
  now: Date,
): Edition {
  const active = pins.filter((p) => p.expiresAt.getTime() > now.getTime());
  const pinOf = (kind: string, id: string, action: EditionPin['action']) =>
    active.find((p) => p.targetKind === kind && p.targetId === id && p.action === action);
  const windowStart = now.getTime() - EDITION_RULES.windowHours * HOUR;
  const hidden: Edition['hidden'] = [];
  const pinned: EditionItem[] = [];
  const ranked: EditionItem[] = [];
  for (const unit of unitsOf(events, stories)) {
    const hide = pinOf(unit.kind, unit.id, 'hide');
    if (hide !== undefined) {
      hidden.push({ kind: unit.kind, id: unit.id, reason: hide.reason });
      continue;
    }
    const pin = pinOf(unit.kind, unit.id, 'pin');
    const item = itemOf(unit, now, pin);
    if (pin !== undefined) pinned.push(item);
    else if (new Date(item.last_coverage_at).getTime() >= windowStart) ranked.push(item);
  }
  // Pinned first, in the order they were pinned.
  pinned.sort((a, b) => active.findIndex((p) => p.targetId === a.id) - active.findIndex((p) => p.targetId === b.id));
  const items = [...pinned, ...limitCategoryRuns(ranked.sort(byScore), EDITION_RULES.maxSameCategoryRun)]
    .slice(0, EDITION_RULES.maxItems);

  // «Duelo del día».
  const inEdition = new Map<string, EditionItem>();
  for (const item of items) for (const id of item.event_ids) inEdition.set(id, item);
  const duelEvents = events.filter((e) => e.duelAt !== null && inEdition.has(e.id));
  const chosen = active.find((p) => p.action === 'duel' && duelEvents.some((e) => e.id === p.targetId));
  let duel: EditionEvent | undefined;
  let duelReason: Edition['duel_reason'] = null;
  if (chosen !== undefined) {
    duel = duelEvents.find((e) => e.id === chosen.targetId);
    duelReason = 'moderation';
  } else {
    const fresh = duelEvents.filter((e) => now.getTime() - e.duelAt!.getTime() <= EDITION_RULES.duelMaxAgeHours * HOUR);
    duel = fresh.sort((a, b) =>
      inEdition.get(b.id)!.score - inEdition.get(a.id)!.score
      || b.duelAt!.getTime() - a.duelAt!.getTime()
      || (a.id < b.id ? -1 : 1))[0];
    if (duel !== undefined) duelReason = 'score';
  }
  return {
    rules_version: EDITION_RULES.version,
    rules: EDITION_RULES.description,
    items,
    duel_event_id: duel?.id ?? null,
    duel_reason: duelReason,
    duel_pin_reason: chosen?.reason ?? null,
    hidden,
  };
}

/** A wide, new case outside the top of the current edition. */
export function breakingCase(
  events: readonly EditionEvent[],
  current: Pick<Edition, 'items' | 'hidden'> | null,
  now: Date,
): EditionEvent | null {
  const top = new Set((current?.items ?? []).slice(0, EDITION_RULES.breaking.topN).flatMap((i) => i.event_ids));
  const hidden = new Set((current?.hidden ?? []).map((h) => h.id));
  return events.find((e) =>
    new Set(e.sourceIds).size >= EDITION_RULES.breaking.minOutlets
    && now.getTime() - e.firstCoverage.getTime() <= EDITION_RULES.breaking.withinMinutes * 60_000
    && !top.has(e.id) && !hidden.has(e.id)) ?? null;
}
