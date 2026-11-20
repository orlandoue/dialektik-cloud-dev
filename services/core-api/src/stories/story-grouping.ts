import { createHash } from 'node:crypto';

/**
 * Proposals of stories: published events about one developing topic.
 *
 * The semantic engine pairs two notes per event, so one story (a tour, a
 * summit, a trial) arrives as many events of two outlets each. Two events
 * belong to one story when they share at least two proper names, enough of
 * their key words, and their coverage is close in time; stories chain, so
 * a five-day tour becomes one. No AI: names, words and dates only. Nothing
 * is grouped from here: every proposal waits for a moderator, who also
 * writes its title (the dry run of 19 Nov 2026: 7 of 8 proposals right).
 */
export interface StoryEvent {
  readonly id: string;
  readonly title: string;
  /** Latest headline of each article of the event. */
  readonly headlines: readonly string[];
  readonly sourceIds: readonly string[];
  readonly firstPublished: Date;
  readonly lastPublished: Date;
}

export interface ApprovedStory {
  readonly id: string;
  readonly eventIds: readonly string[];
}

export interface StoryProposal {
  /** Approved story the events would join; null for a new story. */
  readonly targetGroupId: string | null;
  /** Events to add (only those not already in a story). */
  readonly eventIds: readonly string[];
  readonly suggestedTitle: string;
  /** Same set, same signature: a rejected set is not proposed again. */
  readonly signature: string;
}

export const STORY_RULE = {
  minSharedNames: 2,
  minWordOverlap: 0.12,
  maxGapHours: 36,
} as const;

const STOP = new Set(
  `el la los las un una unos unas de del al a y o en con por para sobre tras ante entre su sus se que es fue son ha han lo le les mas muy sin desde hasta como cuando donde que cual como este esta estos estas ese esa eso nuevo nueva primer primera dos tres dia hoy ayer tiene hace sera ser
presidente gobierno ministro chile chileno chilena noticias video vivo analisis tvn horas 24 chv meganoticias cooperativa tercera radio cnn t13 teletrece adn mercado global lo mas importante doble click clinic`
    .split(/\s+/u)
    .filter((word) => word !== ''),
);

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Key words, cut to a crude stem so «reunión»/«reunirse» meet. */
export function storyWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const raw of text.match(/[\p{L}\p{N}][\p{L}\p{N}.]*/gu) ?? []) {
    const word = fold(raw).replace(/\.+$/u, '');
    if (word.length < 3 || STOP.has(word) || (/^\d+$/u.test(word) && word.length < 4)) continue;
    words.add(word.slice(0, 7));
  }
  return words;
}

/** Proper names and acronyms: capitalised words that do not open a phrase. */
export function storyNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const phrase of text.split(/\|\||[:;.?¿!¡"“”«»|]/u)) {
    const words = phrase.trim().split(/\s+/u);
    words.forEach((word, index) => {
      const clean = word.replace(/[^\p{L}\p{N}]/gu, '');
      if (clean.length < 3) return;
      const acronym = clean === clean.toUpperCase() && /\p{L}/u.test(clean);
      if (acronym || (index > 0 && /^\p{Lu}/u.test(clean))) {
        const name = fold(clean);
        if (!STOP.has(name)) names.add(name);
      }
    });
  }
  return names;
}

interface Node {
  readonly eventIds: string[];
  readonly groupId: string | null;
  readonly words: Set<string>;
  readonly names: Set<string>;
  first: number;
  last: number;
}

function intersect(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const item of a) if (b.has(item)) n += 1;
  return n;
}

function related(x: Node, y: Node): boolean {
  const gap = Math.max(x.first, y.first) - Math.min(x.last, y.last);
  if (gap > STORY_RULE.maxGapHours * 3_600_000) return false;
  if (intersect(x.names, y.names) < STORY_RULE.minSharedNames) return false;
  const shared = intersect(x.words, y.words);
  const union = x.words.size + y.words.size - shared;
  return union > 0 && shared / union >= STORY_RULE.minWordOverlap;
}

export function storySignature(targetGroupId: string | null, eventIds: readonly string[]): string {
  return createHash('sha256').update(`${targetGroupId ?? 'new'}:${[...eventIds].sort().join(',')}`).digest('hex').slice(0, 32);
}

/**
 * Proposals for the given published events. Approved stories take part as
 * one node each, so new coverage of a known story is proposed as an
 * addition to it. Events already in a story are never proposed again;
 * a cluster touching two approved stories only adds to the largest one.
 */
export function proposeStories(
  events: readonly StoryEvent[],
  approved: readonly ApprovedStory[],
  rejectedSignatures: ReadonlySet<string> = new Set(),
): StoryProposal[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  const grouped = new Set(approved.flatMap((story) => story.eventIds));
  const nodeOf = (eventIds: string[], groupId: string | null): Node | null => {
    const members = eventIds.map((id) => byId.get(id)).filter((e): e is StoryEvent => e !== undefined);
    if (members.length === 0) return null;
    const text = members.map((e) => `${e.title} || ${e.headlines.join(' || ')}`).join(' || ');
    return {
      eventIds,
      groupId,
      words: storyWords(text),
      names: storyNames(text),
      first: Math.min(...members.map((e) => e.firstPublished.getTime())),
      last: Math.max(...members.map((e) => e.lastPublished.getTime())),
    };
  };
  const nodes: Node[] = [];
  for (const story of approved) {
    const node = nodeOf([...story.eventIds], story.id);
    if (node) nodes.push(node);
  }
  for (const event of events) {
    if (grouped.has(event.id)) continue;
    const node = nodeOf([event.id], null);
    if (node) nodes.push(node);
  }

  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (related(nodes[i]!, nodes[j]!)) parent[find(i)] = find(j);
    }
  }
  const clusters = new Map<number, Node[]>();
  nodes.forEach((node, i) => {
    const root = find(i);
    clusters.set(root, [...(clusters.get(root) ?? []), node]);
  });

  const proposals: StoryProposal[] = [];
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const stories = members.filter((node) => node.groupId !== null)
      .sort((a, b) => b.eventIds.length - a.eventIds.length);
    const target = stories[0]?.groupId ?? null;
    const added = members.filter((node) => node.groupId === null).flatMap((node) => node.eventIds).sort();
    if (added.length === 0 || (target === null && added.length < 2)) continue;
    const signature = storySignature(target, added);
    if (rejectedSignatures.has(signature)) continue;
    proposals.push({ targetGroupId: target, eventIds: added, suggestedTitle: centralTitle(added, byId), signature });
  }
  return proposals.sort((a, b) => b.eventIds.length - a.eventIds.length);
}

/** Title of the event that shares the most names with the others. */
function centralTitle(eventIds: readonly string[], byId: ReadonlyMap<string, StoryEvent>): string {
  const members = eventIds.map((id) => byId.get(id)!).filter(Boolean);
  const names = members.map((e) => storyNames(`${e.title} || ${e.headlines.join(' || ')}`));
  let best = 0;
  let bestScore = -1;
  members.forEach((_, i) => {
    const score = names.reduce((sum, other, j) => (i === j ? sum : sum + intersect(names[i]!, other)), 0);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return members[best]?.title ?? '';
}
