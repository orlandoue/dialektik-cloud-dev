import { createHash, randomUUID } from 'node:crypto';
import type { ObservationStatus, StructuredLLMTransport } from './llm.contracts.js';

export const EVENT_ANALYST_SKILL_ID = 'DIALEKTIK_EVENT_ANALYST_SKILL_V1';
export const EVENT_ANALYST_SKILL_VERSION = '1.0.0';
export const EVENT_ANALYST_SCHEMA_VERSION = 'event-analyst-result-v1';
export const CITABLE_BLOCK_BUILDER_VERSION = 'citable-block-builder-v1';
export const EVENT_ANALYST_VALIDATOR_VERSION = 'event-analyst-validator-v1';
export const EVENT_CANDIDATE_APPLICABILITY_VERSION = 'event-candidate-applicability-v1';
export const EVENT_ANALYST_TEMPORAL_NORMALIZER_VERSION = 'event-temporal-normalizer-v2';
export const EVENT_ANALYST_PROVIDER_CONFIG_VERSION = 'event-analyst-gemini-config-v1';

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const MAX_BLOCKS = 99;
const MAX_FACTS_PER_NUGGET = 10;
const MAX_NUGGETS = 3;
const FACT_KINDS = [
  'trigger_or_action',
  'actor',
  'time',
  'location',
  'external_identifier',
  'process',
  'topic',
  'other',
] as const;
export type EventAnalystFactKind = (typeof FACT_KINDS)[number];
export type EventCandidate = boolean | 'UNCERTAIN';
export type FactSupport =
  | 'SUPPORTED_DIRECT'
  | 'SUPPORTED_NORMALIZED'
  | 'UNSUPPORTED'
  | 'AMBIGUOUS_SUPPORT';
export type TemporalNormalizationRule =
  | 'EXPLICIT_ISO_DATE'
  | 'ENGLISH_ON_ISO_DATE'
  | 'SPANISH_EL_ISO_DATE'
  | 'SPANISH_EN_ISO_DATE';
export type TemporalNormalizationUncertainty =
  | 'NONE'
  | 'NEGATED_DATE'
  | 'RELATIVE_DATE'
  | 'MULTIPLE_DATES'
  | 'INVALID_DATE'
  | 'PUBLICATION_TIMESTAMP'
  | 'UNSUPPORTED_FORMAT';

export interface TemporalNormalization {
  readonly rawMention: string;
  readonly evidenceBlockIds: readonly string[];
  readonly normalizedValue: string | null;
  readonly rule: TemporalNormalizationRule | null;
  readonly version: string;
  readonly uncertainty: TemporalNormalizationUncertainty;
}

export interface EventAnalystArticleInput {
  /** Opaque local ArticleVersion identity. Never included in provider input. */
  readonly articleVersion: string;
  readonly title: string;
  readonly body: string;
  readonly language?: string | null;
}

export interface CitableBlock {
  readonly block_id: string;
  /** Internal ownership metadata; never included in provider input. */
  readonly article_version: string;
  readonly field: 'title' | 'body';
  readonly text: string;
  readonly start_offset: number;
  readonly end_offset: number;
  readonly block_hash: string;
}

export interface EventAnalystProviderInput {
  readonly language: string | null;
  readonly blocks: readonly Readonly<Pick<CitableBlock, 'block_id' | 'field' | 'text'>>[];
}

export interface EventAnalystProvider {
  readonly provider: string;
  readonly model: string;
  readonly providerConfigVersion: string;
  generate(
    input: EventAnalystProviderInput,
    schema: unknown,
    signal: AbortSignal,
  ): Promise<unknown>;
}

/** Adapt an existing structured transport without coupling the skill to a vendor. */
export class StructuredEventAnalystProvider implements EventAnalystProvider {
  constructor(
    private readonly transport: StructuredLLMTransport,
    readonly provider: string,
    readonly model: string,
    readonly providerConfigVersion: string,
  ) {}

  async generate(
    input: EventAnalystProviderInput,
    schema: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    return (await this.generateDetailed(input, schema, signal)).output;
  }

  generateDetailed(input: EventAnalystProviderInput, schema: unknown, signal: AbortSignal) {
    return this.transport.generate('extraction', input, schema, signal);
  }
}

export interface PreparedEventAnalystInput {
  readonly article: EventAnalystArticleInput;
  readonly blocks: readonly CitableBlock[];
  readonly providerInput: EventAnalystProviderInput;
  readonly inputHash: string;
}

export const EVENT_ANALYST_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['event_candidate', 'event_nuggets', 'missing_or_uncertain'],
  properties: {
    event_candidate: {
      anyOf: [{ type: 'boolean' }, { type: 'string', enum: ['UNCERTAIN'] }],
    },
    event_nuggets: {
      type: 'array',
      maxItems: MAX_NUGGETS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['facts'],
        properties: {
          facts: {
            type: 'array',
            maxItems: MAX_FACTS_PER_NUGGET,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'value', 'evidence_block_ids'],
              properties: {
                kind: { type: 'string', enum: FACT_KINDS },
                value: { type: 'string', minLength: 1, maxLength: 256 },
                evidence_block_ids: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 4,
                  uniqueItems: true,
                  items: { type: 'string', pattern: '^B[0-9]{3}$' },
                },
              },
            },
          },
        },
      },
    },
    missing_or_uncertain: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string', minLength: 1, maxLength: 128 },
    },
  },
});

export const EVENT_ANALYST_TOOL_CONTRACTS = Object.freeze([
  Object.freeze({ name: 'get_citable_blocks', availableInV1: true }),
  Object.freeze({ name: 'validate_block_refs', availableInV1: true }),
  Object.freeze({ name: 'normalize_time', availableInV1: true }),
  Object.freeze({ name: 'resolve_entity_mention', availableInV1: false }),
  Object.freeze({ name: 'retrieve_occurrence_candidates', availableInV1: false }),
  Object.freeze({ name: 'retrieve_thread_candidates', availableInV1: false }),
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    isObject(value) && Object.keys(value).sort().join('\u0000') === [...keys].sort().join('\u0000')
  );
}

function hasUnicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function codepointOffset(value: string, utf16Offset: number): number {
  return Array.from(value.slice(0, utf16Offset)).length;
}

function hashBlockText(value: string): string {
  return sha256(value);
}

function trimSegment(
  value: string,
  utf16Start: number,
  articleVersion: string,
  field: 'title' | 'body',
): Omit<CitableBlock, 'block_id'> | null {
  const segment = value.slice(utf16Start);
  const leading = /^\s*/u.exec(segment)?.[0].length ?? 0;
  const contentStart = utf16Start + leading;
  const remainder = value.slice(contentStart);
  const contentLength = remainder.length - (/\s*$/u.exec(remainder)?.[0].length ?? 0);
  if (contentLength <= 0) return null;
  const contentEnd = contentStart + contentLength;
  const text = value.slice(contentStart, contentEnd);
  return Object.freeze({
    article_version: articleVersion,
    field,
    text,
    start_offset: codepointOffset(value, contentStart),
    end_offset: codepointOffset(value, contentEnd),
    block_hash: hashBlockText(text),
  });
}

function splitField(
  value: string,
  articleVersion: string,
  field: 'title' | 'body',
): Omit<CitableBlock, 'block_id'>[] {
  if (!value) return [];
  const blocks: Omit<CitableBlock, 'block_id'>[] = [];
  if (field === 'title') {
    const block = trimSegment(value, 0, articleVersion, field);
    if (block) blocks.push(block);
    return blocks;
  }
  const separators = /\r?\n(?:[\t ]*\r?\n)+/gu;
  let start = 0;
  for (const match of value.matchAll(separators)) {
    const index = match.index;
    const block = trimSegment(value.slice(0, index), start, articleVersion, field);
    if (block) blocks.push(block);
    start = index + match[0].length;
  }
  const last = trimSegment(value, start, articleVersion, field);
  if (last) blocks.push(last);
  return blocks;
}

/** Build stable title/paragraph blocks using Unicode-codepoint offsets. */
export function getCitableBlocks(article: EventAnalystArticleInput): readonly CitableBlock[] {
  if (
    !article.articleVersion.trim() ||
    typeof article.title !== 'string' ||
    typeof article.body !== 'string' ||
    !hasUnicodeScalars(article.articleVersion) ||
    !hasUnicodeScalars(article.title) ||
    !hasUnicodeScalars(article.body)
  )
    throw Error('EVENT_ANALYST_INPUT_INVALID');
  const blocks = [
    ...splitField(article.title, article.articleVersion, 'title'),
    ...splitField(article.body, article.articleVersion, 'body'),
  ];
  if (!blocks.length) throw Error('EVENT_ANALYST_INPUT_EMPTY');
  if (blocks.length > MAX_BLOCKS) throw Error('EVENT_ANALYST_BLOCK_LIMIT');
  return Object.freeze(
    blocks.map((block, index) =>
      Object.freeze({ ...block, block_id: 'B' + String(index + 1).padStart(3, '0') }),
    ),
  );
}

function shaJson(value: unknown): string {
  return sha256(JSON.stringify(value));
}

/** Prepare a provider-safe view; ArticleVersion, offsets, and hashes stay local. */
export function prepareEventAnalystInput(
  article: EventAnalystArticleInput,
): PreparedEventAnalystInput {
  const blocks = getCitableBlocks(article);
  const providerInput: EventAnalystProviderInput = Object.freeze({
    language: article.language ?? null,
    blocks: Object.freeze(
      blocks.map(({ block_id, field, text }) => Object.freeze({ block_id, field, text })),
    ),
  });
  return Object.freeze({
    article: Object.freeze({ ...article }),
    blocks,
    providerInput,
    inputHash: shaJson({
      blockBuilderVersion: CITABLE_BLOCK_BUILDER_VERSION,
      articleVersion: article.articleVersion,
      language: article.language ?? null,
      title: article.title,
      body: article.body,
    }),
  });
}

/** Stable local provenance; the ArticleVersion value itself is not serialized. */
export function eventAnalystProvenance(
  prepared: PreparedEventAnalystInput,
  provider: Pick<EventAnalystProvider, 'provider' | 'model' | 'providerConfigVersion'>,
  instructionHash: string,
  schemaHash = shaJson(EVENT_ANALYST_SCHEMA),
  runId = randomUUID(),
) {
  return Object.freeze({
    skill_id: EVENT_ANALYST_SKILL_ID,
    skill_version: EVENT_ANALYST_SKILL_VERSION,
    provider: provider.provider,
    model: provider.model,
    provider_config_version: provider.providerConfigVersion,
    instruction_hash: instructionHash,
    schema_version: EVENT_ANALYST_SCHEMA_VERSION,
    schema_hash: schemaHash,
    block_builder_version: CITABLE_BLOCK_BUILDER_VERSION,
    validator_version: EVENT_ANALYST_VALIDATOR_VERSION,
    temporal_normalizer_version: EVENT_ANALYST_TEMPORAL_NORMALIZER_VERSION,
    core_applicability_version: EVENT_CANDIDATE_APPLICABILITY_VERSION,
    input_hash: prepared.inputHash,
    run_id: runId,
  });
}

const ISO_DATE_TOKEN = /\d{4}-\d{2}-\d{2}/gu;
const PUBLICATION_DATE_MARKER =
  /\b(?:publication\s+date|date\s+published|published\s+(?:on|at)|posted\s+(?:on|at)|last\s+(?:modified|updated)|updated\s+(?:on|at)|date\s+updated|fecha\s+de\s+publicaci[oó]n|publicad[oa]\s+(?:el|en)|actualizad[oa]\s+(?:el|en)|última\s+actualizaci[oó]n|ultima\s+actualizacion)\b|(?:publicaci[oó]n|published|posted|updated)\s*[:：]/iu;
const NEGATION_MARKER = /\b(?:not|never|no|without|nunca|jamás|jamas)\b/iu;
const RELATION_MARKER =
  /\b(?:before|after|prior\s+to|following|preceding|until|since|by|antes\s+(?:de|del)|después\s+de|despues\s+de|hasta|desde)\s+(?:(?:the|on|el|en|del)\s+)?$/iu;
const RELATIONAL_SUFFIX = /^\s*(?:or\s+(?:later|earlier)|onward|and\s+(?:after|before))\b/iu;

interface LocatedDate {
  readonly value: string;
  readonly index: number;
}

function locateIsoDates(value: string): readonly LocatedDate[] {
  return Object.freeze(
    Array.from(value.matchAll(ISO_DATE_TOKEN), (match) =>
      Object.freeze({ value: match[0], index: match.index }),
    ),
  );
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function clauseAroundDate(text: string, index: number, length: number) {
  const delimiters = ['.', '!', '?', ';', '\n', '\r'];
  let start = -1;
  let end = text.length;
  for (const delimiter of delimiters) {
    start = Math.max(start, text.lastIndexOf(delimiter, index - 1));
    const next = text.indexOf(delimiter, index + length);
    if (next >= 0) end = Math.min(end, next);
  }
  return {
    prefix: text.slice(start + 1, index),
    suffix: text.slice(index + length, end),
    clause: text.slice(start + 1, end),
  };
}

function contextualUncertainty(
  date: string,
  evidenceBlocks: readonly CitableBlock[],
): TemporalNormalizationUncertainty | null {
  const dateBearingBlocks = evidenceBlocks.filter((block) => locateIsoDates(block.text).length > 0);
  const distinctCitedDates = new Set(
    dateBearingBlocks.flatMap((block) => locateIsoDates(block.text).map((item) => item.value)),
  );
  if (dateBearingBlocks.length > 1 && distinctCitedDates.size > 1) return 'MULTIPLE_DATES';
  for (const block of evidenceBlocks) {
    for (const located of locateIsoDates(block.text)) {
      if (located.value !== date) continue;
      const { prefix, suffix, clause } = clauseAroundDate(
        block.text,
        located.index,
        located.value.length,
      );
      if (locateIsoDates(clause).length > 1) return 'MULTIPLE_DATES';
      if (PUBLICATION_DATE_MARKER.test(prefix) || PUBLICATION_DATE_MARKER.test(suffix))
        return 'PUBLICATION_TIMESTAMP';
      if (NEGATION_MARKER.test(prefix) || NEGATION_MARKER.test(suffix)) return 'NEGATED_DATE';
      if (RELATION_MARKER.test(prefix) || RELATIONAL_SUFFIX.test(suffix)) return 'RELATIVE_DATE';
    }
  }
  return null;
}

/**
 * Normalize only a complete, explicit date mention. Contextual rules are
 * deliberately narrow; date tokens embedded in arbitrary prose are never
 * extracted as occurrence dates.
 */
export function normalizeTemporalMention(
  value: string,
  language: string | null = null,
  evidenceBlocks: readonly CitableBlock[] = [],
): TemporalNormalization {
  const candidate = value.trim();
  const evidenceBlockIds = Object.freeze(evidenceBlocks.map((block) => block.block_id));
  const result = (
    normalizedValue: string | null,
    rule: TemporalNormalizationRule | null,
    uncertainty: TemporalNormalizationUncertainty,
  ): TemporalNormalization =>
    Object.freeze({
      rawMention: value,
      evidenceBlockIds,
      normalizedValue,
      rule,
      version: EVENT_ANALYST_TEMPORAL_NORMALIZER_VERSION,
      uncertainty,
    });

  const dates = locateIsoDates(candidate);
  if (dates.length > 1) return result(null, null, 'MULTIPLE_DATES');
  if (!dates.length) return result(null, null, 'UNSUPPORTED_FORMAT');
  const date = dates[0]?.value;
  if (!date) return result(null, null, 'UNSUPPORTED_FORMAT');

  if (
    /^(?:not|never|no|without|nunca|jamás|jamas)\b/iu.test(candidate) ||
    NEGATION_MARKER.test(clauseAroundDate(candidate, dates[0]?.index ?? 0, date.length).prefix)
  )
    return result(null, null, 'NEGATED_DATE');
  if (
    /^(?:before|after|prior\s+to|following|preceding|until|since|by|antes\s+de|después\s+de|despues\s+de|hasta|desde)\b/iu.test(
      candidate,
    )
  )
    return result(null, null, 'RELATIVE_DATE');
  if (PUBLICATION_DATE_MARKER.test(candidate)) return result(null, null, 'PUBLICATION_TIMESTAMP');

  const contextIssue = contextualUncertainty(date, evidenceBlocks);
  if (contextIssue) return result(null, null, contextIssue);

  const locale = language?.trim() ?? '';
  const englishLanguage = locale === '' || /^en(?:[-_]|$)/iu.test(locale);
  const spanishLanguage = /^es(?:[-_]|$)/iu.test(locale);
  let rule: TemporalNormalizationRule | null = null;
  if (candidate === date) rule = 'EXPLICIT_ISO_DATE';
  else if (englishLanguage && /^on[ \t]+(\d{4}-\d{2}-\d{2})$/iu.test(candidate))
    rule = 'ENGLISH_ON_ISO_DATE';
  else if (spanishLanguage && /^el[ \t]+(\d{4}-\d{2}-\d{2})$/iu.test(candidate))
    rule = 'SPANISH_EL_ISO_DATE';
  else if (spanishLanguage && /^en[ \t]+(\d{4}-\d{2}-\d{2})$/iu.test(candidate))
    rule = 'SPANISH_EN_ISO_DATE';
  if (!rule) return result(null, null, 'UNSUPPORTED_FORMAT');
  if (!isValidIsoDate(date)) return result(null, null, 'INVALID_DATE');
  return result(date, rule, 'NONE');
}

/** Compatibility projection for callers that need only the normalized value. */
export function normalizeTime(value: string, language: string | null = null): string | null {
  return normalizeTemporalMention(value, language).normalizedValue;
}

/** Validate all supplied block ownership/slices before looking at model references. */
export function validateCitableBlockSet(
  article: EventAnalystArticleInput,
  blocks: readonly CitableBlock[],
): boolean {
  if (!blocks.length || blocks.length > MAX_BLOCKS) return false;
  const seen = new Set<string>();
  return blocks.every((block, index) => {
    const source = block.field === 'title' ? article.title : article.body;
    const slice = Array.from(source).slice(block.start_offset, block.end_offset).join('');
    const valid =
      block.block_id === 'B' + String(index + 1).padStart(3, '0') &&
      !seen.has(block.block_id) &&
      block.article_version === article.articleVersion &&
      Number.isSafeInteger(block.start_offset) &&
      Number.isSafeInteger(block.end_offset) &&
      block.start_offset >= 0 &&
      block.end_offset > block.start_offset &&
      slice === block.text &&
      block.block_hash === hashBlockText(block.text);
    seen.add(block.block_id);
    return valid;
  });
}

/** Provider-neutral deterministic block-reference contract. */
export function validateBlockRefs(
  refs: readonly string[],
  blocks: readonly CitableBlock[],
): Readonly<{ valid: readonly string[]; invalid: readonly string[] }> {
  const known = new Set(blocks.map((block) => block.block_id));
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const ref of refs) (known.has(ref) ? valid : invalid).push(ref);
  return Object.freeze({ valid: Object.freeze(valid), invalid: Object.freeze(invalid) });
}

const INTERNAL_ID_KEY =
  /(?:^id$|(?:^|_)(?:article|source|entity|occurrence|event|thread|claim|assertion|evidence|span|database|run)_(?:id|version)$|(?:^|_)(?:ulid|uuid)$)/iu;
const INTERNAL_ID_VALUE =
  /\b(?:entity|occurrence|event|thread|article|source|evidence|span|claim|assertion|run)[_-][A-Za-z0-9][A-Za-z0-9_-]{1,}\b/iu;

function providerInternalIdViolations(value: unknown): number {
  if (Array.isArray(value))
    return (value as unknown[]).reduce(
      (sum: number, item: unknown) => sum + providerInternalIdViolations(item),
      0,
    );
  if (isObject(value))
    return Object.entries(value).reduce(
      (sum, [key, item]) =>
        sum + (INTERNAL_ID_KEY.test(key) ? 1 : 0) + providerInternalIdViolations(item),
      0,
    );
  return typeof value === 'string' && INTERNAL_ID_VALUE.test(value) ? 1 : 0;
}

function normalizedWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function hasSplitLexicalSupport(value: string, blocks: readonly CitableBlock[]): boolean {
  const tokens = value
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length >= 2);
  if (tokens.length < 2) return false;
  const supportBlocks = tokens.map((token) => blocks.filter((block) => block.text.includes(token)));
  if (supportBlocks.some((matches) => !matches.length)) return false;
  const union = new Set(supportBlocks.flatMap((matches) => matches.map((block) => block.block_id)));
  return union.size > 1;
}

function factSupport(
  value: string,
  refs: readonly string[],
  blocks: readonly CitableBlock[],
): FactSupport {
  const selected = blocks.filter((block) => refs.includes(block.block_id));
  if (selected.some((block) => block.text.includes(value))) return 'SUPPORTED_DIRECT';
  const normalized = normalizedWhitespace(value);
  if (
    selected.some((block) => normalizedWhitespace(block.text).includes(normalized)) &&
    normalized.length > 0
  )
    return 'SUPPORTED_NORMALIZED';
  return hasSplitLexicalSupport(value, selected) ? 'AMBIGUOUS_SUPPORT' : 'UNSUPPORTED';
}

interface ValidatedFact {
  readonly kind: EventAnalystFactKind;
  readonly value: string;
  readonly evidenceBlockIds: readonly string[];
  readonly support: FactSupport;
  readonly normalizedTime: string | null;
  readonly temporalNormalization: TemporalNormalization | null;
  readonly enteringObservation: boolean;
}

interface ValidatedNugget {
  readonly facts: readonly ValidatedFact[];
}

export interface EventAnalystValidation {
  readonly schemaValid: boolean;
  readonly blockSetValid: boolean;
  readonly eventCandidate: EventCandidate | null;
  readonly eventNuggets: readonly ValidatedNugget[];
  readonly missingOrUncertain: readonly string[];
  readonly applicability: ObservationStatus;
  readonly issueCodes: readonly string[];
  readonly factCount: number;
  readonly validEvidenceRefs: number;
  readonly invalidBlockRefs: number;
  readonly supportedDirect: number;
  readonly supportedNormalized: number;
  readonly unsupportedFacts: number;
  readonly ambiguousFacts: number;
  readonly unsupportedFactsEnteringObservation: number;
  readonly providerInternalIdViolations: number;
}

function baseInvalid(
  blockSetValid: boolean,
  issueCodes: readonly string[],
  idViolations: number,
): EventAnalystValidation {
  return Object.freeze({
    schemaValid: false,
    blockSetValid,
    eventCandidate: null,
    eventNuggets: Object.freeze([]),
    missingOrUncertain: Object.freeze([]),
    applicability: 'AMBIGUOUS',
    issueCodes: Object.freeze([...issueCodes]),
    factCount: 0,
    validEvidenceRefs: 0,
    invalidBlockRefs: 0,
    supportedDirect: 0,
    supportedNormalized: 0,
    unsupportedFacts: 0,
    ambiguousFacts: 0,
    unsupportedFactsEnteringObservation: 0,
    providerInternalIdViolations: idViolations,
  });
}

function parseFact(
  raw: unknown,
  blocks: readonly CitableBlock[],
  language: string | null,
): { fact: ValidatedFact; invalidRefs: number; validRefs: number; idViolations: number } | null {
  if (!hasExactKeys(raw, ['kind', 'value', 'evidence_block_ids'])) return null;
  if (
    typeof raw.kind !== 'string' ||
    !FACT_KINDS.includes(raw.kind as EventAnalystFactKind) ||
    typeof raw.value !== 'string' ||
    !raw.value.trim() ||
    Array.from(raw.value).length > 256 ||
    !Array.isArray(raw.evidence_block_ids) ||
    raw.evidence_block_ids.length < 1 ||
    raw.evidence_block_ids.length > 4 ||
    raw.evidence_block_ids.some((ref) => typeof ref !== 'string') ||
    new Set(raw.evidence_block_ids).size !== raw.evidence_block_ids.length
  )
    return null;
  const idViolations = providerInternalIdViolations(raw);
  const refs = raw.evidence_block_ids as string[];
  const refsResult = validateBlockRefs(refs, blocks);
  const citedBlocks = blocks.filter((block) => refsResult.valid.includes(block.block_id));
  const support =
    idViolations || refsResult.invalid.length
      ? 'UNSUPPORTED'
      : factSupport(raw.value, refsResult.valid, blocks);
  const temporalNormalization =
    raw.kind === 'time' ? normalizeTemporalMention(raw.value, language, citedBlocks) : null;
  const normalizedTime = temporalNormalization?.normalizedValue ?? null;
  return {
    fact: Object.freeze({
      kind: raw.kind as EventAnalystFactKind,
      value: raw.value,
      evidenceBlockIds: Object.freeze([...refs]),
      support,
      normalizedTime,
      temporalNormalization,
      enteringObservation: support === 'SUPPORTED_DIRECT' || support === 'SUPPORTED_NORMALIZED',
    }),
    invalidRefs: refsResult.invalid.length,
    validRefs: refsResult.valid.length,
    idViolations,
  };
}

function deriveApplicability(
  candidate: EventCandidate | null,
  nuggets: readonly ValidatedNugget[],
  schemaValid: boolean,
): ObservationStatus {
  if (!schemaValid || candidate === null || candidate === 'UNCERTAIN') return 'AMBIGUOUS';
  if (!candidate) return nuggets.length === 0 ? 'NOT_APPLICABLE' : 'AMBIGUOUS';
  const bounded = nuggets.some((nugget) => {
    const supported = nugget.facts.filter((fact) => fact.enteringObservation);
    const action = supported.some((fact) => fact.kind === 'trigger_or_action');
    const time = supported.some((fact) => fact.kind === 'time' && fact.normalizedTime !== null);
    const externalId = supported.some((fact) => fact.kind === 'external_identifier');
    return action && (time || externalId);
  });
  return bounded ? 'OBSERVATION_AVAILABLE' : 'INSUFFICIENT_EVIDENCE';
}

/** Validate model primitives, citations, block integrity, and Core-owned state. */
export function validateEventAnalystResult(
  raw: unknown,
  prepared: PreparedEventAnalystInput,
): EventAnalystValidation {
  const idViolations = providerInternalIdViolations(raw);
  const blockSetValid = validateCitableBlockSet(prepared.article, prepared.blocks);
  if (!blockSetValid) return baseInvalid(false, ['CITABLE_BLOCK_SET_INVALID'], idViolations);
  if (
    !hasExactKeys(raw, ['event_candidate', 'event_nuggets', 'missing_or_uncertain']) ||
    !(typeof raw.event_candidate === 'boolean' || raw.event_candidate === 'UNCERTAIN') ||
    !Array.isArray(raw.event_nuggets) ||
    raw.event_nuggets.length > MAX_NUGGETS ||
    !Array.isArray(raw.missing_or_uncertain) ||
    raw.missing_or_uncertain.length > 8 ||
    raw.missing_or_uncertain.some(
      (item) => typeof item !== 'string' || !item.trim() || Array.from(item).length > 128,
    )
  )
    return baseInvalid(true, ['EVENT_ANALYST_SCHEMA_INVALID'], idViolations);

  const issues: string[] = [];
  const nuggets: ValidatedNugget[] = [];
  let factCount = 0;
  let validEvidenceRefs = 0;
  let invalidBlockRefs = 0;
  let supportedDirect = 0;
  let supportedNormalized = 0;
  let unsupportedFacts = 0;
  let ambiguousFacts = 0;
  let unsupportedFactsEnteringObservation = 0;
  let countedIdViolations = 0;
  for (const rawNugget of raw.event_nuggets) {
    if (
      !hasExactKeys(rawNugget, ['facts']) ||
      !Array.isArray(rawNugget.facts) ||
      rawNugget.facts.length > MAX_FACTS_PER_NUGGET
    )
      return baseInvalid(true, ['EVENT_ANALYST_SCHEMA_INVALID'], idViolations);
    const facts: ValidatedFact[] = [];
    for (const rawFact of rawNugget.facts) {
      const parsed = parseFact(rawFact, prepared.blocks, prepared.article.language ?? null);
      if (!parsed) return baseInvalid(true, ['EVENT_ANALYST_SCHEMA_INVALID'], idViolations);
      facts.push(parsed.fact);
      factCount++;
      validEvidenceRefs += parsed.validRefs;
      invalidBlockRefs += parsed.invalidRefs;
      countedIdViolations += parsed.idViolations;
      if (parsed.fact.support === 'SUPPORTED_DIRECT') supportedDirect++;
      else if (parsed.fact.support === 'SUPPORTED_NORMALIZED') supportedNormalized++;
      else if (parsed.fact.support === 'AMBIGUOUS_SUPPORT') ambiguousFacts++;
      else unsupportedFacts++;
    }
    nuggets.push(Object.freeze({ facts: Object.freeze(facts) }));
  }
  const candidate = raw.event_candidate as EventCandidate;
  if (idViolations) issues.push('PROVIDER_INTERNAL_ID_REJECTED');
  if (invalidBlockRefs) issues.push('BLOCK_REFERENCE_INVALID');
  if (candidate === false && nuggets.length) issues.push('FALSE_CANDIDATE_WITH_NUGGETS');
  const consistent = !(candidate === false && nuggets.length > 0);
  const finalSchemaValid = consistent;
  const applicability = deriveApplicability(candidate, nuggets, finalSchemaValid);
  if (applicability === 'OBSERVATION_AVAILABLE') {
    // The observation projection contains only supported facts. This is a
    // safety invariant even when unsupported provider proposals are reported.
    unsupportedFactsEnteringObservation = 0;
  }
  return Object.freeze({
    schemaValid: finalSchemaValid,
    blockSetValid: true,
    eventCandidate: candidate,
    eventNuggets: Object.freeze(nuggets),
    missingOrUncertain: Object.freeze([...(raw.missing_or_uncertain as string[])]),
    applicability,
    issueCodes: Object.freeze(issues),
    factCount,
    validEvidenceRefs,
    invalidBlockRefs,
    supportedDirect,
    supportedNormalized,
    unsupportedFacts,
    ambiguousFacts,
    unsupportedFactsEnteringObservation,
    providerInternalIdViolations: Math.max(idViolations, countedIdViolations),
  });
}

export function providerSafeInputKeys(input: EventAnalystProviderInput): readonly string[] {
  return Object.freeze(Object.keys(input).sort());
}
