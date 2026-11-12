export interface SemanticPreclusterArticle {
  readonly articleId: string;
  readonly sourceId: string;
  readonly publishedAt: Date;
  readonly headline: string;
  readonly eventKey: string;
  readonly eventTitle: string;
  readonly eventSummary: string;
}

export interface SemanticCandidatePair {
  readonly left: SemanticPreclusterArticle;
  readonly right: SemanticPreclusterArticle;
  readonly clusterKey: string;
}

export function canJoinSemanticEventGroup(assessment: {
  readonly sameEvent: boolean;
  readonly sameEventConfidence: number;
}): boolean {
  return assessment.sameEvent && assessment.sameEventConfidence >= 70;
}

const STOP_WORDS = new Set([
  "ante", "como", "desde", "donde", "entre", "hacia", "hasta", "para", "pero",
  "sobre", "tras", "segun", "según", "tambien", "también", "durante", "este",
  "esta", "estos", "estas", "tras", "porque", "cuando", "quien", "quienes",
  "the", "and", "with", "from", "after", "before", "into", "over", "under",
  "chile", "chileno", "chilena", "nacional", "gobierno", "ministro", "ministra",
  "presidente", "presidenta", "comision", "comisión", "anuncia", "anuncian",
  "informa", "informan", "seguridad", "economia", "economía", "politica", "política",
  "caso", "corte", "suprema", "tribunal", "fiscalia", "fiscalía", "justicia",
  "causa", "proceso", "acusacion", "acusación", "nueva", "nuevas", "nuevo", "nuevos",
  "informe", "medida", "medidas", "proyecto", "comunicado", "tras", "reporta",
  "desempleo", "desocupacion", "desocupación", "unemployment", "employment",
  "economy", "economic", "regional", "rate", "tasa", "porcentaje", "crisis",
  "controversy", "controversia", "tour", "gira", "viaje", "government",
  "party", "partido", "critica", "critican", "criticó", "criticized", "criticizes",
  "criticize", "criticism", "actions", "acción", "acciones", "becomes",
  "lleg", "llego", "llega", "hora", "noticias", "programa", "radio", "television",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "uno", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho",
  "nueve", "diez",
]);

function normalized(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es-CL");
}

function namedTokens(article: SemanticPreclusterArticle): ReadonlySet<string> {
  const sourceText = [
    article.headline,
    article.eventSummary,
    article.eventKey.replace(/[-_:]/gu, " "),
  ].join(" ");
  const tokens = new Set<string>();
  for (const match of sourceText.matchAll(/\b[\p{Lu}][\p{L}\p{N}-]{2,}\b/gu)) {
    const token = normalized(match[0]);
    if (token.length >= 4 && !STOP_WORDS.has(token)) tokens.add(token);
  }
  for (const match of sourceText.matchAll(/\b[\p{Lu}]{2,}\b/gu)) {
    const token = normalized(match[0]);
    if (!STOP_WORDS.has(token)) tokens.add(token);
  }
  return tokens;
}

/** Shared names are used for queue diversity, not as proof of the same event. */
export function sharedSemanticEntities(pair: SemanticCandidatePair): readonly string[] {
  const right = namedTokens(pair.right);
  return [...namedTokens(pair.left)].filter(token => token.length >= 3 && right.has(token)).sort();
}

/** Count already-published event titles mentioning any entity in this pair. */
export function publishedEntityCount(pair: SemanticCandidatePair, publishedTitles: readonly string[]): number {
  const entities = new Set(sharedSemanticEntities(pair));
  return publishedTitles.filter(title => (normalized(title).match(/[a-z0-9]+/gu) ?? []).some(token => entities.has(token))).length;
}

/** Prefer distinct named entities in the first pass; retain the supplied rank within each pass. */
export function diversifySemanticPairs(pairs: readonly SemanticCandidatePair[], maxArticles: number): readonly SemanticCandidatePair[] {
  const selected: SemanticCandidatePair[] = [];
  const selectedIds = new Set<string>();
  const selectedEntities = new Set<string>();
  const add = (pair: SemanticCandidatePair) => {
    const ids = [pair.left.articleId, pair.right.articleId];
    if (new Set([...selectedIds, ...ids]).size > maxArticles || ids.some(id => selectedIds.has(id))) return false;
    selected.push(pair);
    ids.forEach(id => selectedIds.add(id));
    sharedSemanticEntities(pair).forEach(entity => selectedEntities.add(entity));
    return true;
  };
  for (const pair of pairs) {
    const entities = sharedSemanticEntities(pair);
    if (entities.length === 0 || entities.some(entity => selectedEntities.has(entity))) continue;
    add(pair);
  }
  // If diversity cannot fill the batch, return to the highest ranked remaining pairs.
  for (const pair of pairs) add(pair);
  return selected;
}

export interface ScheduledPairPlan {
  readonly pairs: readonly SemanticCandidatePair[];
  readonly articleIds: readonly string[];
  readonly newExtractions: number;
}

/**
 * Chooses the pairs of one scheduled batch within its model-call budget.
 *
 * Each article that still needs extraction costs one model call; articles
 * already extracted are reused for free, so a pair joining a new article to
 * an extracted one is cheap. Distinct named entities are preferred first
 * (topic diversity), then the batch is filled by rank. Extraction calls are
 * capped so the rest of the shared budget remains for the case and stance
 * assessments that can actually lead to a publication.
 */
export function planScheduledSemanticPairs(
  pairs: readonly SemanticCandidatePair[],
  pendingArticleIds: ReadonlySet<string>,
  limits: { readonly maxPairs: number; readonly maxNewExtractions: number },
): ScheduledPairPlan {
  const selected: SemanticCandidatePair[] = [];
  const articleIds = new Set<string>();
  const usedEntities = new Set<string>();
  const pairKeys = new Set<string>();
  let newExtractions = 0;
  const cost = (pair: SemanticCandidatePair) =>
    [pair.left.articleId, pair.right.articleId].filter(
      id => pendingArticleIds.has(id) && !articleIds.has(id),
    ).length;
  const add = (pair: SemanticCandidatePair): boolean => {
    if (selected.length >= limits.maxPairs) return false;
    const key = pairKey(pair.left.articleId, pair.right.articleId);
    if (pairKeys.has(key)) return false;
    const extra = cost(pair);
    if (newExtractions + extra > limits.maxNewExtractions) return false;
    selected.push(pair);
    pairKeys.add(key);
    newExtractions += extra;
    articleIds.add(pair.left.articleId);
    articleIds.add(pair.right.articleId);
    sharedSemanticEntities(pair).forEach(entity => usedEntities.add(entity));
    return true;
  };
  for (const pair of pairs) {
    const entities = sharedSemanticEntities(pair);
    if (entities.length === 0 || entities.some(entity => usedEntities.has(entity))) continue;
    add(pair);
  }
  for (const pair of pairs) add(pair);
  return { pairs: selected, articleIds: [...articleIds], newExtractions };
}

function incidentTokens(article: SemanticPreclusterArticle): ReadonlySet<string> {
  const text = [
    article.headline,
    article.eventTitle,
    article.eventSummary,
    article.eventKey.replace(/[-_:]/gu, " "),
  ].join(" ");
  const names = namedTokens(article);
  const tokens = new Set<string>();
  for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const token = normalized(match[0]);
    if (
      token.length >= 4 &&
      !/^\d+$/u.test(token) &&
      !STOP_WORDS.has(token) &&
      !names.has(token)
    )
      tokens.add(token);
  }
  return tokens;
}

const SANTIAGO_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Santiago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function santiagoDayStart(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) return null;
  const utcMidnight = Date.parse(`${day}T00:00:00.000Z`);
  if (
    !Number.isFinite(utcMidnight) ||
    new Date(utcMidnight).toISOString().slice(0, 10) !== day
  ) return null;
  const parts = Object.fromEntries(
    SANTIAGO_PARTS.formatToParts(new Date(utcMidnight))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const localAsUtc = Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return utcMidnight - (localAsUtc - utcMidnight);
}

function addCalendarDays(day: string, days: number): string | null {
  const parsed = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function clusterKey(
  left: SemanticPreclusterArticle,
  right: SemanticPreclusterArticle,
): string | null {
  const rightEntities = namedTokens(right);
  const shared = [...namedTokens(left)].filter((token) => rightEntities.has(token)).sort();
  if (shared.length === 0) return null;
  const leftKey = normalized(left.eventKey.replace(/[-_:]/gu, " ")).trim();
  const rightKey = normalized(right.eventKey.replace(/[-_:]/gu, " ")).trim();
  if (leftKey.length > 0 && leftKey === rightKey)
    return `signature:${leftKey.replace(/\s+/gu, "-")}`;
  const rightIncidents = incidentTokens(right);
  const incident = [...incidentTokens(left)]
    .filter((token) => rightIncidents.has(token))
    .sort();
  if (incident.length === 0) return null;
  return `entity:${shared[0]}:incident:${incident.slice(0, 2).join("-")}`;
}

function pairKey(left: string, right: string): string {
  return left < right ? `${left}\n${right}` : `${right}\n${left}`;
}

/** Prevents a bridge article from joining a group without pairwise confirmation. */
export function canAddSemanticPairToClique(
  existingMemberIds: readonly string[],
  leftArticleId: string,
  rightArticleId: string,
  confirmedSameEventPairs: ReadonlySet<string>,
): boolean {
  if (!confirmedSameEventPairs.has(pairKey(leftArticleId, rightArticleId))) return false;
  const candidates = new Set([leftArticleId, rightArticleId]);
  for (const existingId of existingMemberIds) {
    if (candidates.has(existingId)) continue;
    for (const candidateId of candidates) {
      if (!confirmedSameEventPairs.has(pairKey(existingId, candidateId))) return false;
    }
  }
  return true;
}

/**
 * A conservative candidate generator. It only narrows the pair set; Workers AI
 * still has to confirm the same occurrence before any editorial grouping.
 */
export function preclusterLiveSemanticArticles(
  articles: readonly SemanticPreclusterArticle[],
  targetDay: string,
): readonly SemanticCandidatePair[] {
  const endDay = addCalendarDays(targetDay, 2);
  const start = santiagoDayStart(targetDay);
  const end = endDay === null ? null : santiagoDayStart(endDay);
  if (start === null || end === null) return [];
  const eligible = articles.filter((article) => {
    const time = article.publishedAt.getTime();
    return Number.isFinite(time) && time >= start && time < end;
  });
  const pairs: SemanticCandidatePair[] = [];
  for (let index = 0; index < eligible.length; index += 1) {
    const left = eligible[index];
    if (left === undefined) continue;
    for (const right of eligible.slice(index + 1)) {
      if (left.sourceId === right.sourceId) continue;
      if (Math.abs(left.publishedAt.getTime() - right.publishedAt.getTime()) > 48 * 60 * 60 * 1000)
        continue;
      const key = clusterKey(left, right);
      if (key === null) continue;
      const [first, second] = left.articleId < right.articleId ? [left, right] : [right, left];
      pairs.push({ left: first, right: second, clusterKey: key });
    }
  }
  return pairs.sort((a, b) =>
    a.clusterKey.localeCompare(b.clusterKey) ||
    a.left.articleId.localeCompare(b.left.articleId) ||
    a.right.articleId.localeCompare(b.right.articleId),
  );
}
