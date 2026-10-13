import { assertV10_11ExecutionAuthorized } from '../semantic-shadow/scientific-freeze.policy.js';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FROZEN_V10_11_IDENTITY } from '../semantic-shadow/shadow.contracts';
import type { EphemeralArticleContent } from './ephemeral.content';
import type { ProviderEvidenceLocator, SemanticEnvelope } from './ephemeral.contracts';
import { assertOriginalMetadata, decodeOriginalUtf8, sha256Bytes } from './ephemeral.normalization';
import {
  preserveNativeDiagnostics,
  diagnosticSha256,
  type NativeDiagnosticReceipt,
} from './ephemeral.diagnostics';

export const FROZEN_SOURCE_CLOSURE_SHA256 =
  '0305d1a904782f4f9b4d791c16b05cae6e5936ce225fd45b629bf86b5423aac7';
export const FROZEN_EPHEMERAL_RUN = 'REAL_NEWS_V10_11_EPHEMERAL_SHADOW_V1';
/** Explicit owner approval: product transport only, sealed modules unchanged. */
export const PROSPECTIVE_FROZEN_RUN = 'PROSPECTIVE_MULTISOURCE_V10_11_SHADOW_RUN_V1';
export type FrozenRunIdentity = typeof FROZEN_EPHEMERAL_RUN | typeof PROSPECTIVE_FROZEN_RUN;
function runArticleLimit(runIdentity: unknown): number {
  if (runIdentity === FROZEN_EPHEMERAL_RUN) return 40;
  if (runIdentity === PROSPECTIVE_FROZEN_RUN) return 150;
  throw new Error('FROZEN_BATCH_AUTHORIZATION_INVALID');
}
export const NATIVE_ACTIONS = [
  'update_occurrence',
  'new_occurrence_in_existing_thread',
  'new_thread',
  'ambiguous',
] as const;
export const NATIVE_REASONS = [
  'no_bounded_occurrence_observation',
  'multi_observation_article_requires_decomposition',
  'multiple_identity_matches',
  'occurrence_thread_incompatibility',
  'no_automatic_occurrence_reparent',
  'unique_occurrence_match',
  'thread_match_all_children_distinct',
  'occurrence_identity_unknown',
  'thread_identity_unknown',
  'unresolved_prior_thread_comparison',
  'unresolved_prior_occurrence_comparison',
  'grounded_process_distinct_from_all_prior',
] as const;
export interface NativeArticleProposal {
  readonly action: (typeof NATIVE_ACTIONS)[number];
  readonly reasonCode: (typeof NATIVE_REASONS)[number];
  readonly proposedOccurrenceKey: string | null;
  readonly proposedThreadKey: string | null;
  readonly partialOccurrenceCreation: boolean;
}
export interface NativeCandidateApplicability {
  readonly scope: 'OCCURRENCE' | 'THREAD';
  readonly targetKey: string;
  readonly outcome: 'APPLICABLE' | 'INAPPLICABLE' | 'UNKNOWN_APPLICABILITY';
  readonly references: readonly FrozenBatchEvidence[];
}
export interface FrozenBatchEvidence extends ProviderEvidenceLocator {
  readonly articleId: string;
  readonly sourceId: string;
}
export interface NativeIdentityComparison {
  readonly scope: 'OCCURRENCE' | 'THREAD';
  readonly targetKey: string;
  readonly index: number;
  readonly decision: 'MATCH' | 'DISTINCT' | 'UNKNOWN';
  readonly references: readonly FrozenBatchEvidence[];
}
export interface FrozenBatchArticleResult extends NativeArticleProposal {
  readonly articleId: string;
  readonly position: number;
  readonly observationIds: readonly string[];
  readonly threadAnchorId: string | null;
  readonly evidence: readonly FrozenBatchEvidence[];
  readonly comparisons: readonly NativeIdentityComparison[];
  readonly applicability: readonly NativeCandidateApplicability[];
}
export interface FrozenBatchResult {
  readonly commit: string;
  readonly version: string;
  readonly runtime: Readonly<{ python: string; model: string }>;
  readonly runIdentity: FrozenRunIdentity;
  readonly articles: readonly FrozenBatchArticleResult[];
  readonly occurrences: readonly Readonly<{
    key: string;
    threadKey: string | null;
    articleIds: readonly string[];
    generationHash: string;
  }>[];
  readonly threads: readonly Readonly<{
    key: string;
    occurrenceKeys: readonly string[];
    articleIds: readonly string[];
    generationHash: string;
  }>[];
  readonly streamHashes: Readonly<Record<string, string>>;
  readonly nativeDiagnosticReceipt: NativeDiagnosticReceipt;
}
export interface FrozenGitSource {
  readonly name: string;
  readonly path: string;
  readonly source: string;
  readonly sha256: string;
  readonly isPackage: boolean;
}
export interface FrozenSourceClosure {
  readonly sources: readonly FrozenGitSource[];
  readonly sha256: string;
}
/** Static Git reads only; no Python imports, child runtime or historical corpus. */
export function readFrozenSourceClosure(repositoryRoot: string): FrozenSourceClosure {
  const prefix = 'services/intelligence/src/';
  const pending = [
    'dialektik_intelligence',
    'dialektik_intelligence.semantic',
    'dialektik_intelligence.semantic.applicability_replay_v10_11',
    'dialektik_intelligence.semantic.scoped_extractor_v10_10',
  ];
  const sources = new Map<string, FrozenGitSource>();
  while (pending.length) {
    const name = pending.shift();
    if (!name || sources.has(name)) continue;
    if (!/^dialektik_intelligence(?:\.[a-zA-Z0-9_]+)*$/.test(name) || sources.size >= 128)
      throw new Error('FROZEN_SOURCE_CLOSURE_INVALID');
    const isPackage =
      name === 'dialektik_intelligence' || name === 'dialektik_intelligence.semantic';
    const path = prefix + name.replaceAll('.', '/') + (isPackage ? '/__init__.py' : '.py');
    let bytes: Buffer;
    try {
      bytes = execFileSync(
        'git',
        ['cat-file', 'blob', FROZEN_V10_11_IDENTITY.commit + ':' + path],
        { cwd: repositoryRoot, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
      );
    } catch {
      throw new Error('FROZEN_SOURCE_CLOSURE_INVALID');
    }
    const source = decodeOriginalUtf8(bytes);
    sources.set(name, Object.freeze({ name, path, source, sha256: sha256Bytes(bytes), isPackage }));
    const base = isPackage ? name.split('.') : name.split('.').slice(0, -1);
    const imports = /(?:^|\n)[ \t]*from\s+(\.+)([a-zA-Z0-9_.]*)\s+import\s+(\([^)]*\)|[^\r\n]+)/g;
    for (const match of source.matchAll(imports)) {
      const dots = match[1] ?? '';
      const relativeModule = match[2] ?? '';
      const values = match[3] ?? '';
      const parent = base.slice(0, base.length - dots.length + 1).join('.');
      if (relativeModule) pending.push(parent + '.' + relativeModule);
      else
        for (const value of values.replaceAll(/[()\r\n]/g, '').split(',')) {
          const imported = value.trim().split(/\s+as\s+/)[0];
          if (imported && /^[a-zA-Z0-9_]+$/.test(imported)) pending.push(parent + '.' + imported);
        }
    }
  }
  const ordered = [...sources.values()].sort((left, right) =>
    left.name.localeCompare(right.name, 'en'),
  );
  const sha256 = createHash('sha256')
    .update(
      JSON.stringify(
        ordered.map(({ name, path, sha256: digest }) => ({ name, path, sha256: digest })),
      ),
    )
    .digest('hex');
  return Object.freeze({ sources: Object.freeze(ordered), sha256 });
}
export interface FrozenBatchManifestArticle {
  readonly articleId: string;
  readonly articleVersionId: string;
  readonly sourceId: string;
  readonly policyId: string;
  readonly accessMode: 'FULLTEXT_EPHEMERAL' | 'FULLTEXT_PERSISTED';
  readonly acquiredContentHash: string;
  readonly inputHash: string;
  readonly titleHash: string;
  readonly permanentExclusionVerified: true;
  readonly rightsQualified: true;
  readonly completeOriginalField: true;
  /** Explicitly approved persisted path; authorize() verifies exact durable input and grants. */
  readonly retainedInput?: Readonly<{
    normalizedInputHash: string;
    titleInputHash: string;
    bodyCodepoints: number;
    titleCodepoints: number;
    normalizationVersion: string;
    offsetConvention: 'unicode_code_point_v1';
    exactCopyRetained: true;
  }>;
}
export interface FrozenBatchManifest {
  readonly runIdentity: FrozenRunIdentity;
  readonly sourceClosureSha256: string;
  readonly articles: readonly FrozenBatchManifestArticle[];
}
/** Resolves only after its owned provider child is terminated. No durable writes. */
export interface FrozenBatchTransport {
  invoke: (payload: Buffer, signal: AbortSignal) => Promise<Buffer>;
  /** Must settle after process close, including abort. Never permits a live child to escape. */
  terminateAndWait: () => Promise<void>;
}
export interface FrozenBatchRegistration {
  readonly sources: FrozenSourceClosure;
  readonly transport: FrozenBatchTransport;
  /** Root authenticates frozen corpus/rights/exclusions/exactly-once reservation. */
  readonly authorize: (manifest: FrozenBatchManifest) => Promise<void>;
  readonly timeoutMs?: number;
}
const digestPattern = /^[a-f0-9]{64}$/;
const occurrencePattern = /^occurrence:[a-f0-9]{24}$/;
const threadPattern = /^thread:[a-f0-9]{24}$/;
const streamKeys = [
  'article_decisions',
  'occurrence_memberships',
  'thread_memberships',
  'occurrence_generations',
  'thread_generations',
  'candidate_applicability',
];
function record(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('FROZEN_OUTPUT_INVALID');
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
    throw new Error('FROZEN_OUTPUT_INVALID');
  return value;
}
function text(raw: unknown, pattern = /^[A-Za-z0-9_.:-]{1,128}$/): string {
  if (typeof raw !== 'string' || !pattern.test(raw)) throw new Error('FROZEN_OUTPUT_INVALID');
  return raw;
}
function list(raw: unknown, maximum = 4096): unknown[] {
  if (!Array.isArray(raw) || raw.length > maximum) throw new Error('FROZEN_OUTPUT_INVALID');
  return raw as unknown[];
}
function optionalKey(raw: unknown, pattern: RegExp): string | null {
  return raw === null ? null : text(raw, pattern);
}
export function validateFrozenBatchOutput(
  raw: unknown,
  contents: readonly EphemeralArticleContent[],
  expectedRunIdentity: FrozenRunIdentity = FROZEN_EPHEMERAL_RUN,
): FrozenBatchResult {
  const articleLimit = runArticleLimit(expectedRunIdentity);
  const output = record(raw, [
    'commit',
    'version',
    'runtime',
    'runIdentity',
    'articles',
    'occurrences',
    'threads',
    'streamHashes',
    'nativeDiagnostics',
  ]);
  const runtime = record(output.runtime, ['python', 'model']);
  if (
    output.commit !== FROZEN_V10_11_IDENTITY.commit ||
    output.version !== FROZEN_V10_11_IDENTITY.version ||
    runtime.python !== '3.11.9' ||
    runtime.model !== 'none' ||
    output.runIdentity !== expectedRunIdentity
  )
    throw new Error('FROZEN_OUTPUT_INVALID');
  const byId = new Map(contents.map((content) => [content.metadata.articleId, content]));
  const evidence = (raw: unknown): FrozenBatchEvidence => {
    const value = record(raw, [
      'articleId',
      'sourceId',
      'field',
      'start',
      'end',
      'sourceSha256',
      'spanSha256',
    ]);
    const articleId = text(value.articleId);
    const content = byId.get(articleId);
    if (
      !content ||
      value.sourceId !== content.metadata.sourceId ||
      !(value.field === 'title' || value.field === 'body') ||
      typeof value.start !== 'number' ||
      typeof value.end !== 'number'
    )
      throw new Error('FROZEN_OUTPUT_INVALID');
    const locator: FrozenBatchEvidence = {
      articleId,
      sourceId: content.metadata.sourceId,
      field: value.field,
      start: value.start,
      end: value.end,
      sourceSha256: text(value.sourceSha256, digestPattern),
      spanSha256: text(value.spanSha256, digestPattern),
    };
    content.verifyLocator(locator);
    return Object.freeze(locator);
  };
  const articles = list(output.articles, articleLimit).map((rawArticle, index) => {
    const row = record(rawArticle, [
      'articleId',
      'position',
      'action',
      'reasonCode',
      'proposedOccurrenceKey',
      'proposedThreadKey',
      'partialOccurrenceCreation',
      'observationIds',
      'threadAnchorId',
      'evidence',
      'comparisons',
      'applicability',
    ]);
    if (
      row.articleId !== contents[index]?.metadata.articleId ||
      row.position !== index + 1 ||
      !(NATIVE_ACTIONS as readonly unknown[]).includes(row.action) ||
      !(NATIVE_REASONS as readonly unknown[]).includes(row.reasonCode) ||
      typeof row.partialOccurrenceCreation !== 'boolean'
    )
      throw new Error('FROZEN_OUTPUT_INVALID');
    const scopeAndTarget = (
      value: Record<string, unknown>,
    ): { scope: 'OCCURRENCE' | 'THREAD'; targetKey: string } => {
      if (!(value.scope === 'OCCURRENCE' || value.scope === 'THREAD'))
        throw new Error('FROZEN_OUTPUT_INVALID');
      return {
        scope: value.scope,
        targetKey: text(
          value.targetKey,
          value.scope === 'OCCURRENCE' ? occurrencePattern : threadPattern,
        ),
      };
    };
    const comparisons = list(row.comparisons).map((rawComparison) => {
      const value = record(rawComparison, [
        'scope',
        'targetKey',
        'index',
        'decision',
        'references',
      ]);
      const target = scopeAndTarget(value);
      if (
        !Number.isSafeInteger(value.index) ||
        typeof value.index !== 'number' ||
        value.index < 0 ||
        !['MATCH', 'DISTINCT', 'UNKNOWN'].includes(String(value.decision))
      )
        throw new Error('FROZEN_OUTPUT_INVALID');
      return Object.freeze({
        ...target,
        index: value.index,
        decision: value.decision as 'MATCH' | 'DISTINCT' | 'UNKNOWN',
        references: Object.freeze(list(value.references).map(evidence)),
      });
    });
    const applicability = list(row.applicability).map((rawScope) => {
      const value = record(rawScope, ['scope', 'targetKey', 'outcome', 'references']);
      const target = scopeAndTarget(value);
      if (!['APPLICABLE', 'INAPPLICABLE', 'UNKNOWN_APPLICABILITY'].includes(String(value.outcome)))
        throw new Error('FROZEN_OUTPUT_INVALID');
      return Object.freeze({
        ...target,
        outcome: value.outcome as NativeCandidateApplicability['outcome'],
        references: Object.freeze(list(value.references).map(evidence)),
      });
    });
    return Object.freeze({
      articleId: text(row.articleId),
      position: index + 1,
      action: row.action as NativeArticleProposal['action'],
      reasonCode: row.reasonCode as NativeArticleProposal['reasonCode'],
      partialOccurrenceCreation: row.partialOccurrenceCreation,
      proposedOccurrenceKey: optionalKey(row.proposedOccurrenceKey, occurrencePattern),
      proposedThreadKey: optionalKey(row.proposedThreadKey, threadPattern),
      observationIds: Object.freeze(
        list(row.observationIds).map((value) => text(value, digestPattern)),
      ),
      threadAnchorId: optionalKey(row.threadAnchorId, digestPattern),
      evidence: Object.freeze(list(row.evidence).map(evidence)),
      comparisons: Object.freeze(comparisons),
      applicability: Object.freeze(applicability),
    });
  });
  if (articles.length !== contents.length) throw new Error('FROZEN_OUTPUT_INVALID');
  const articleIds = (raw: unknown) =>
    Object.freeze(
      list(raw, articleLimit).map((value) => {
        const articleId = text(value);
        if (!byId.has(articleId)) throw new Error('FROZEN_OUTPUT_INVALID');
        return articleId;
      }),
    );
  const occurrences = list(output.occurrences).map((rawOccurrence) => {
    const value = record(rawOccurrence, ['key', 'threadKey', 'articleIds', 'generationHash']);
    return Object.freeze({
      key: text(value.key, occurrencePattern),
      threadKey: optionalKey(value.threadKey, threadPattern),
      articleIds: articleIds(value.articleIds),
      generationHash: text(value.generationHash, digestPattern),
    });
  });
  const threads = list(output.threads).map((rawThread) => {
    const value = record(rawThread, ['key', 'occurrenceKeys', 'articleIds', 'generationHash']);
    return Object.freeze({
      key: text(value.key, threadPattern),
      occurrenceKeys: Object.freeze(
        list(value.occurrenceKeys).map((key) => text(key, occurrencePattern)),
      ),
      articleIds: articleIds(value.articleIds),
      generationHash: text(value.generationHash, digestPattern),
    });
  });
  const hashes = record(output.streamHashes, streamKeys);
  const streamHashes = Object.freeze(
    Object.fromEntries(streamKeys.map((key) => [key, text(hashes[key], digestPattern)])),
  );
  const projection: Omit<FrozenBatchResult, 'nativeDiagnosticReceipt'> = {
    commit: FROZEN_V10_11_IDENTITY.commit,
    version: FROZEN_V10_11_IDENTITY.version,
    runtime: FROZEN_V10_11_IDENTITY.runtime,
    runIdentity: expectedRunIdentity,
    articles: Object.freeze(articles),
    occurrences: Object.freeze(occurrences),
    threads: Object.freeze(threads),
    streamHashes,
  };
  const native = record(output.nativeDiagnostics, [
    'artifact',
    'extractions',
    'anchor_extractions',
  ]);
  const artifact = record(native.artifact, ['version', ...streamKeys, 'hashes']);
  const nativeHashes = record(artifact.hashes, streamKeys);
  if (artifact.version !== output.version) throw new Error('FROZEN_OUTPUT_INVALID');
  for (const key of streamKeys)
    if (
      nativeHashes[key] !== streamHashes[key] ||
      diagnosticSha256(artifact[key]) !== streamHashes[key]
    )
      throw new Error('FROZEN_OUTPUT_INVALID');
  const nativeRows = list(artifact.article_decisions, articleLimit);
  const nativeReferences = (rawReferences: unknown): readonly FrozenBatchEvidence[] =>
    Object.freeze(
      list(rawReferences).map((rawReference) => {
        if (!rawReference || typeof rawReference !== 'object' || Array.isArray(rawReference))
          throw new Error('FROZEN_OUTPUT_INVALID');
        const span = (rawReference as Record<string, unknown>).span;
        if (!span || typeof span !== 'object' || Array.isArray(span))
          throw new Error('FROZEN_OUTPUT_INVALID');
        const value = span as Record<string, unknown>;
        return evidence({
          articleId: value.article_id,
          sourceId: value.source_id,
          field: value.field,
          start: value.start,
          end: value.end,
          sourceSha256: value.source_sha256,
          spanSha256: value.span_sha256,
        });
      }),
    );
  if (nativeRows.length !== articles.length) throw new Error('FROZEN_OUTPUT_INVALID');
  for (const [index, rawRow] of nativeRows.entries()) {
    if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow))
      throw new Error('FROZEN_OUTPUT_INVALID');
    const row = rawRow as Record<string, unknown>,
      projected = articles[index];
    if (
      !projected ||
      row.article_id !== projected.articleId ||
      row.position !== projected.position ||
      row.action !== projected.action ||
      row.reason !== projected.reasonCode ||
      row.occurrence_id !== projected.proposedOccurrenceKey ||
      row.thread_id !== projected.proposedThreadKey ||
      row.partial_occurrence_creation !== projected.partialOccurrenceCreation ||
      diagnosticSha256(row.observation_ids) !== diagnosticSha256(projected.observationIds) ||
      row.thread_anchor_id !== projected.threadAnchorId
    )
      throw new Error('FROZEN_OUTPUT_INVALID');
    for (const scope of ['occurrence', 'thread'] as const) {
      const applicability = row[scope + '_applicability'];
      const comparisons = row[scope + '_comparisons'];
      if (
        !applicability ||
        typeof applicability !== 'object' ||
        Array.isArray(applicability) ||
        !comparisons ||
        typeof comparisons !== 'object' ||
        Array.isArray(comparisons)
      )
        throw new Error('FROZEN_OUTPUT_INVALID');
      const nativeApplicability = Object.entries(applicability).map(([targetKey, item]) => {
        if (!item || typeof item !== 'object' || Array.isArray(item))
          throw new Error('FROZEN_OUTPUT_INVALID');
        const value = item as Record<string, unknown>;
        return {
          targetKey,
          outcome: value.outcome,
          references: nativeReferences(value.references),
        };
      });
      const projectedApplicability = projected.applicability
        .filter((value) => value.scope === scope.toUpperCase())
        .map(({ targetKey, outcome, references }) => ({ targetKey, outcome, references }));
      if (diagnosticSha256(nativeApplicability) !== diagnosticSha256(projectedApplicability))
        throw new Error('FROZEN_OUTPUT_INVALID');
      const nativeComparisons = Object.entries(comparisons).flatMap(([targetKey, items]) =>
        list(items).map((item, comparisonIndex) => {
          if (!item || typeof item !== 'object' || Array.isArray(item))
            throw new Error('FROZEN_OUTPUT_INVALID');
          const decision = (item as Record<string, unknown>).outcome;
          if (typeof decision !== 'string') throw new Error('FROZEN_OUTPUT_INVALID');
          return {
            targetKey,
            index: comparisonIndex,
            decision: decision.toUpperCase(),
            references: nativeReferences((item as Record<string, unknown>).references),
          };
        }),
      );
      const projectedComparisons = projected.comparisons
        .filter((value) => value.scope === scope.toUpperCase())
        .map(({ targetKey, index: comparisonIndex, decision, references }) => ({
          targetKey,
          index: comparisonIndex,
          decision,
          references,
        }));
      if (diagnosticSha256(nativeComparisons) !== diagnosticSha256(projectedComparisons))
        throw new Error('FROZEN_OUTPUT_INVALID');
    }
  }
  for (const scope of ['occurrence', 'thread'] as const) {
    const expectedMemberships = articles.map((row) => [
      row.position,
      row.articleId,
      scope === 'occurrence' ? row.proposedOccurrenceKey : row.proposedThreadKey,
    ]);
    if (
      diagnosticSha256(artifact[scope + '_memberships']) !== diagnosticSha256(expectedMemberships)
    )
      throw new Error('FROZEN_OUTPUT_INVALID');
    const finalGeneration = new Map<string, string>();
    for (const generation of list(artifact[scope + '_generations'])) {
      const entry = list(generation, 3);
      if (
        entry.length !== 3 ||
        !Number.isSafeInteger(entry[0]) ||
        Number(entry[0]) < 1 ||
        Number(entry[0]) > articles.length
      )
        throw new Error('FROZEN_OUTPUT_INVALID');
      finalGeneration.set(
        text(entry[1], scope === 'occurrence' ? occurrencePattern : threadPattern),
        text(entry[2], digestPattern),
      );
    }
    const nodes = scope === 'occurrence' ? occurrences : threads;
    if (
      finalGeneration.size !== nodes.length ||
      nodes.some(
        (node) =>
          finalGeneration.get(node.key) !== node.generationHash ||
          diagnosticSha256([...node.articleIds].sort()) !==
            diagnosticSha256(
              articles
                .filter(
                  (row) =>
                    (scope === 'occurrence' ? row.proposedOccurrenceKey : row.proposedThreadKey) ===
                    node.key,
                )
                .map((row) => row.articleId)
                .sort(),
            ),
      )
    )
      throw new Error('FROZEN_OUTPUT_INVALID');
  }
  for (const thread of threads)
    if (
      diagnosticSha256([...thread.occurrenceKeys].sort()) !==
      diagnosticSha256(
        occurrences
          .filter((occurrence) => occurrence.threadKey === thread.key)
          .map((occurrence) => occurrence.key)
          .sort(),
      )
    )
      throw new Error('FROZEN_OUTPUT_INVALID');
  for (const occurrence of occurrences)
    if (
      articles.some(
        (row) =>
          row.proposedOccurrenceKey === occurrence.key &&
          row.proposedThreadKey !== occurrence.threadKey,
      )
    )
      throw new Error('FROZEN_OUTPUT_INVALID');
  const nativeScopeStream = nativeRows.map((row) => {
    const value = row as Record<string, unknown>;
    return {
      position: value.position,
      occurrence: value.occurrence_applicability,
      thread: value.thread_applicability,
    };
  });
  if (diagnosticSha256(nativeScopeStream) !== diagnosticSha256(artifact.candidate_applicability))
    throw new Error('FROZEN_OUTPUT_INVALID');
  const nativeDiagnosticReceipt = preserveNativeDiagnostics(
    native,
    projection,
    new Set(contents.flatMap((content) => [content.metadata.articleId, content.metadata.sourceId])),
  );
  return Object.freeze({ ...projection, nativeDiagnosticReceipt });
}
/** Pin the authenticated 20-module closure before exposing any Article to transport. */
function assertPinnedSourceClosure(closure: FrozenSourceClosure): void {
  if (closure.sha256 !== FROZEN_SOURCE_CLOSURE_SHA256 || closure.sources.length !== 20)
    throw new Error('FROZEN_BATCH_AUTHORIZATION_INVALID');
  for (const source of closure.sources) {
    if (
      !/^dialektik_intelligence(?:\.[a-zA-Z0-9_]+)*$/.test(source.name) ||
      source.sha256 !== sha256Bytes(Buffer.from(source.source, 'utf8'))
    )
      throw new Error('FROZEN_BATCH_AUTHORIZATION_INVALID');
  }
  const sha256 = createHash('sha256')
    .update(
      JSON.stringify(
        closure.sources.map(({ name, path, sha256: digest }) => ({ name, path, sha256: digest })),
      ),
    )
    .digest('hex');
  if (sha256 !== FROZEN_SOURCE_CLOSURE_SHA256)
    throw new Error('FROZEN_BATCH_AUTHORIZATION_INVALID');
}
/** Disabled until Root installs an authenticated exactly-once registration. */
export class FrozenEphemeralBatchBoundary {
  constructor(private readonly registration?: FrozenBatchRegistration) {}
  async execute(
    contents: readonly EphemeralArticleContent[],
    manifest: FrozenBatchManifest,
  ): Promise<FrozenBatchResult> {
    let encoded: Buffer | null = null,
      received: Buffer | null = null;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let activeTransport: FrozenBatchTransport | undefined;
    let completedResult: FrozenBatchResult | undefined;
    let failure: Error | undefined;
    let terminationFailed = false;
    try {
      const registration = this.registration;
      if (!registration) throw new Error('FROZEN_BATCH_EXECUTION_NOT_REGISTERED');
      assertPinnedSourceClosure(registration.sources);
      const manifestValue = record(manifest, ['runIdentity', 'sourceClosureSha256', 'articles']);
      const articleLimit = runArticleLimit(manifestValue.runIdentity);
      const prospective = manifest.runIdentity === PROSPECTIVE_FROZEN_RUN;
      if (
        manifest.sourceClosureSha256 !== registration.sources.sha256 ||
        contents.length < 3 ||
        contents.length > articleLimit ||
        manifest.articles.length !== contents.length
      )
        throw new Error('FROZEN_BATCH_AUTHORIZATION_INVALID');
      const timeoutMs = registration.timeoutMs ?? 60_000;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
        throw new Error('FROZEN_BATCH_AUTHORIZATION_INVALID');
      for (const [index, content] of contents.entries()) {
        const row = manifest.articles[index];
        const rowValue = record(row, [
          'articleId',
          'articleVersionId',
          'sourceId',
          'policyId',
          'accessMode',
          'acquiredContentHash',
          'inputHash',
          'titleHash',
          'permanentExclusionVerified',
          'rightsQualified',
          'completeOriginalField',
          ...(prospective ? ['retainedInput'] : []),
        ]);
        assertOriginalMetadata(content.metadata, index + 1);
        if (
          !row ||
          row.articleId !== content.metadata.articleId ||
          row.articleVersionId !== content.metadata.articleVersionId ||
          row.sourceId !== content.metadata.sourceId ||
          row.acquiredContentHash !== content.acquiredContentHash ||
          row.inputHash !== content.normalizedInput.inputHash ||
          row.titleHash !== content.normalizedInput.titleHash ||
          !row.policyId ||
          rowValue.permanentExclusionVerified !== true ||
          rowValue.rightsQualified !== true ||
          rowValue.completeOriginalField !== true ||
          !(
            rowValue.accessMode === 'FULLTEXT_EPHEMERAL' ||
            rowValue.accessMode === 'FULLTEXT_PERSISTED'
          )
        )
          throw new Error('FROZEN_BATCH_AUTHORIZATION_INVALID');
        if (prospective) {
          const retained = record(row.retainedInput, [
            'normalizedInputHash',
            'titleInputHash',
            'bodyCodepoints',
            'titleCodepoints',
            'normalizationVersion',
            'offsetConvention',
            'exactCopyRetained',
          ]);
          if (
            row.accessMode !== 'FULLTEXT_PERSISTED' ||
            retained.exactCopyRetained !== true ||
            retained.normalizedInputHash !== content.normalizedInput.inputHash ||
            retained.titleInputHash !== content.normalizedInput.titleHash ||
            retained.bodyCodepoints !== content.normalizedInput.bodyCodepoints ||
            retained.titleCodepoints !== content.normalizedInput.titleCodepoints ||
            retained.normalizationVersion !== content.normalizedInput.normalizationVersion ||
            retained.offsetConvention !== content.normalizedInput.offsetConvention
          )
            throw new Error('FROZEN_BATCH_AUTHORIZATION_INVALID');
        }
        if (index > 0) {
          const previous = contents[index - 1];
          if (
            previous &&
            (Date.parse(previous.metadata.availableAt) > Date.parse(content.metadata.availableAt) ||
              (Date.parse(previous.metadata.availableAt) ===
                Date.parse(content.metadata.availableAt) &&
                previous.metadata.articleId >= content.metadata.articleId))
          )
            throw new Error('FROZEN_BATCH_AUTHORIZATION_INVALID');
        }
      }
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('FROZEN_BATCH_TIMEOUT'));
        }, timeoutMs);
      });
      await Promise.race([registration.authorize(manifest), timeout]);
      const articles: Record<string, unknown>[] = [];
      for (const [index, content] of contents.entries())
        await content.observe(
          {
            identity: {
              providerType: 'v10_11',
              providerVersion: FROZEN_V10_11_IDENTITY.version,
              candidateCommit: FROZEN_V10_11_IDENTITY.commit,
              runtime: FROZEN_V10_11_IDENTITY.runtime,
            },
            observe: (input) => {
              articles.push({
                article_id: input.article_id,
                position: input.position,
                available_at: input.available_at,
                published_at: input.published_at,
                source_id: input.source_id,
                language: input.language,
                title: input.title,
                body: input.body,
              });
              return Promise.resolve(undefined);
            },
          },
          index + 1,
          controller.signal,
        );
      encoded = Buffer.from(
        JSON.stringify({
          commit: FROZEN_V10_11_IDENTITY.commit,
          version: FROZEN_V10_11_IDENTITY.version,
          model: 'none',
          runIdentity: manifest.runIdentity,
          sources: registration.sources.sources,
          articles,
        }),
        'utf8',
      );
      for (const article of articles) article.body = null;
      articles.length = 0;
      if (encoded.length > 64 * 1024 * 1024) throw new Error('FROZEN_BATCH_INPUT_TOO_LARGE');
      const transferred = encoded;
      if (controller.signal.aborted) throw new Error('FROZEN_BATCH_TIMEOUT');
      activeTransport = registration.transport;
      const invocation = registration.transport.invoke(transferred, controller.signal);
      void invocation.then(
        (late) => {
          if (controller.signal.aborted) late.fill(0);
        },
        () => undefined,
      );
      received = await Promise.race([invocation, timeout]);
      if (received.length > 4 * 1024 * 1024) throw new Error('FROZEN_OUTPUT_INVALID');
      let raw: unknown;
      try {
        raw = JSON.parse(decodeOriginalUtf8(received)) as unknown;
      } catch {
        throw new Error('FROZEN_OUTPUT_INVALID');
      }
      completedResult = validateFrozenBatchOutput(raw, contents, manifest.runIdentity);
    } catch (error) {
      // Never copy a transport/candidate exception, stdout or body into an error.
      const codes = [
        'FROZEN_BATCH_EXECUTION_NOT_REGISTERED',
        'FROZEN_BATCH_AUTHORIZATION_INVALID',
        'FROZEN_BATCH_INPUT_TOO_LARGE',
        'FROZEN_BATCH_TIMEOUT',
        'FROZEN_OUTPUT_INVALID',
      ];
      failure = new Error(
        error instanceof Error && codes.includes(error.message)
          ? error.message
          : 'FROZEN_BATCH_PROVIDER_FAILED',
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
      try {
        await activeTransport?.terminateAndWait();
      } catch {
        terminationFailed = true;
      } finally {
        encoded?.fill(0);
        received?.fill(0);
        for (const content of contents) content.dispose();
        encoded = null;
        received = null;
      }
    }
    if (terminationFailed) throw new Error('FROZEN_BATCH_TERMINATION_FAILED');
    if (failure) throw failure;
    if (!completedResult) throw new Error('FROZEN_BATCH_PROVIDER_FAILED');
    return completedResult;
  }
}
/** Only identities/hashes remain at this point. Foreign references bind their own version. */
export function buildFrozenBatchEnvelopes(
  result: FrozenBatchResult,
  contents: readonly EphemeralArticleContent[],
  manifest: FrozenBatchManifest,
  providerRunId: string,
  processedAt: string,
): readonly SemanticEnvelope[] {
  if (
    contents.some((content) => !content.disposed) ||
    !providerRunId ||
    !Number.isFinite(Date.parse(processedAt)) ||
    result.articles.length !== contents.length ||
    manifest.articles.length !== contents.length ||
    result.runIdentity !== manifest.runIdentity
  )
    throw new Error('FROZEN_OUTPUT_INVALID');
  const referenced = result.articles.flatMap((row) => [
    ...row.evidence,
    ...row.comparisons.flatMap((comparison) => comparison.references),
    ...row.applicability.flatMap((scope) => scope.references),
  ]);
  return Object.freeze(
    contents.map((content, index): SemanticEnvelope => {
      const row = result.articles[index];
      const policy = manifest.articles[index];
      if (
        !row ||
        !policy ||
        row.articleId !== content.metadata.articleId ||
        policy.articleId !== row.articleId
      )
        throw new Error('FROZEN_OUTPUT_INVALID');
      if (
        manifest.runIdentity === PROSPECTIVE_FROZEN_RUN &&
        (policy.accessMode !== 'FULLTEXT_PERSISTED' ||
          policy.retainedInput?.exactCopyRetained !== true ||
          policy.retainedInput.normalizedInputHash !== content.normalizedInput.inputHash ||
          policy.retainedInput.titleInputHash !== content.normalizedInput.titleHash ||
          policy.retainedInput.bodyCodepoints !== content.normalizedInput.bodyCodepoints ||
          policy.retainedInput.titleCodepoints !== content.normalizedInput.titleCodepoints ||
          policy.retainedInput.normalizationVersion !==
            content.normalizedInput.normalizationVersion ||
          (policy.retainedInput as unknown as Record<string, unknown>).offsetConvention !==
            content.normalizedInput.offsetConvention)
      )
        throw new Error('FROZEN_OUTPUT_INVALID');
      const own = new Map<string, FrozenBatchEvidence>();
      for (const locator of referenced)
        if (locator.articleId === content.metadata.articleId)
          own.set(JSON.stringify(locator), locator);
      const observations = row.comparisons.map((comparison) => {
        if (
          !row.applicability.some(
            (scope) =>
              scope.scope === comparison.scope &&
              scope.targetKey === comparison.targetKey &&
              scope.outcome === 'APPLICABLE',
          )
        )
          throw new Error('FROZEN_OUTPUT_INVALID');
        return Object.freeze({
          observationKey: `${comparison.scope.toLowerCase()}:${comparison.targetKey}:${String(comparison.index)}`,
          decision: comparison.decision,
          applicability: 'APPLICABLE' as const,
          proposedOccurrenceKey: comparison.scope === 'OCCURRENCE' ? comparison.targetKey : null,
          proposedThreadKey: comparison.scope === 'THREAD' ? comparison.targetKey : null,
        });
      });
      return Object.freeze({
        authority: 'SHADOW_NOT_AUTHORITATIVE',
        metadata: content.metadata,
        accessMode: policy.accessMode,
        policyId: policy.policyId,
        acquiredContentHash: content.acquiredContentHash,
        normalizedInput: content.normalizedInput,
        provider: Object.freeze({
          providerType: 'v10_11',
          providerVersion: FROZEN_V10_11_IDENTITY.version,
          candidateCommit: FROZEN_V10_11_IDENTITY.commit,
          runtime: FROZEN_V10_11_IDENTITY.runtime,
        }),
        providerRunId,
        processedAt,
        reproducibilityClass:
          manifest.runIdentity === PROSPECTIVE_FROZEN_RUN
            ? 'FULL_REPLAYABLE'
            : 'HASH_VERIFIABLE_REFETCH_REQUIRED',
        evidence: Object.freeze(
          [...own.values()].map(({ field, start, end, sourceSha256, spanSha256 }) =>
            Object.freeze({
              field,
              start,
              end,
              sourceSha256,
              spanSha256,
              articleVersionId: content.metadata.articleVersionId,
              acquiredContentHash: content.acquiredContentHash,
              normalizedInputHash: content.normalizedInput.inputHash,
              normalizationVersion: content.normalizedInput.normalizationVersion,
              providerRunId,
              retainedQuote: null,
            }),
          ),
        ),
        observations: Object.freeze(observations),
        articleProposals: Object.freeze([
          Object.freeze({
            action: row.action,
            reasonCode: row.reasonCode,
            proposedOccurrenceKey: row.proposedOccurrenceKey,
            proposedThreadKey: row.proposedThreadKey,
            partialOccurrenceCreation: row.partialOccurrenceCreation,
          }),
        ]),
        candidateApplicability: Object.freeze(
          row.applicability.map(({ scope, targetKey, outcome }) =>
            Object.freeze({ scope, targetKey, outcome }),
          ),
        ),
      });
    }),
  );
}
/** No invocation occurs during creation. Root registers it only after all gates. */
export function createFrozenPythonBatchTransport(options: {
  readonly executablePath: string;
  readonly bootstrapPath: string;
}): FrozenBatchTransport {
  assertV10_11ExecutionAuthorized();
  const bootstrap = readFileSync(options.bootstrapPath, 'utf8');
  let terminated: Promise<void> = Promise.resolve();
  let stop: (() => void) | undefined;
  return {
    terminateAndWait: async () => {
      stop?.();
      await terminated;
    },
    invoke: (payload, signal) =>
      new Promise<Buffer>((resolve, reject) => {
        if (signal.aborted) {
          reject(new Error('FROZEN_BATCH_PROVIDER_FAILED'));
          return;
        }
        let confirmClosed: (() => void) | undefined;
        terminated = new Promise<void>((done) => {
          confirmClosed = done;
        });
        const stdout: Buffer[] = [],
          stderr: Buffer[] = [];
        let length = 0,
          failed = false;
        let child: ChildProcessWithoutNullStreams;
        try {
          child = spawn(options.executablePath, ['-I', '-S', '-B', '-u', '-c', bootstrap], {
            windowsHide: true,
            stdio: 'pipe',
            env: { SystemRoot: process.env.SystemRoot },
          });
        } catch {
          confirmClosed?.();
          reject(new Error('FROZEN_BATCH_PROVIDER_FAILED'));
          return;
        }
        const terminate = () => {
          failed = true;
          child.kill();
        };
        stop = terminate;
        signal.addEventListener('abort', terminate, { once: true });
        child.stdout.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > 4 * 1024 * 1024) {
            chunk.fill(0);
            terminate();
          } else stdout.push(chunk);
        });
        child.stderr.on('data', (chunk: Buffer) => {
          if (stderr.reduce((sum, value) => sum + value.length, 0) + chunk.length > 4096) {
            chunk.fill(0);
            terminate();
          } else stderr.push(chunk);
        });
        child.on('error', () => {
          failed = true;
        });
        child.stdin.on('error', () => {
          failed = true;
          terminate();
        });
        child.on('close', (code) => {
          signal.removeEventListener('abort', terminate);
          stop = undefined;
          confirmClosed?.();
          for (const value of stderr) value.fill(0);
          if (code !== 0 || failed || signal.aborted) {
            for (const value of stdout) value.fill(0);
            reject(new Error('FROZEN_BATCH_PROVIDER_FAILED'));
            return;
          }
          const output = Buffer.concat(stdout);
          for (const value of stdout) value.fill(0);
          resolve(output);
        });
        child.stdin.end(payload);
      }),
  };
}
