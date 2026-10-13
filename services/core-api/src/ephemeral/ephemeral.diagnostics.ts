import { createHash } from 'node:crypto';

export type NativeRetentionOutcome =
  | 'PERSISTED_NATIVE_VALUE'
  | 'HASH_ONLY'
  | 'OMITTED_RIGHTS_POLICY'
  | 'NOT_EMITTED';
export interface NativeDiagnosticField {
  readonly path: string;
  readonly nativeKind: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'absent';
  readonly outcome: NativeRetentionOutcome;
  readonly projection: 'MODELED' | 'NOT_MODELED';
  readonly reason:
    | 'STRUCTURAL_SEMANTIC_VALUE'
    | 'SOURCE_TEXT_RETENTION_DENIED'
    | 'UNMODELED_NATIVE_FIELD'
    | 'NOT_EMITTED_BY_PROVIDER';
  readonly value?: string | number | boolean | null;
  readonly sha256?: string;
}
export interface NativeDiagnosticReceipt {
  readonly schemaVersion: 'provider-native-diagnostics-v1';
  readonly canonicalization: 'sorted-json-utf8-v1';
  readonly sourceTextRetention: 'HASH_ONLY';
  readonly nativeOutputSha256: string;
  readonly projectionSha256: string;
  readonly fields: readonly NativeDiagnosticField[];
  readonly canonicalSha256: string;
}
/** A hash verifies an exact representation; it cannot recover a redacted value. */
export function canonicalDiagnosticJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalDiagnosticJson).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonicalDiagnosticJson(item))
        .join(',') +
      '}'
    );
  throw new Error('NATIVE_DIAGNOSTIC_INVALID');
}
export function diagnosticSha256(value: unknown): string {
  return createHash('sha256').update(canonicalDiagnosticJson(value), 'utf8').digest('hex');
}

// The dictionary is a structural schema, never a generic permission to retain text.
export const NATIVE_DIAGNOSTIC_KEYS = new Set([
  'artifact',
  'extractions',
  'anchor_extractions',
  'version',
  'hashes',
  'article_decisions',
  'occurrence_memberships',
  'thread_memberships',
  'occurrence_generations',
  'thread_generations',
  'candidate_applicability',
  'article_id',
  'source_id',
  'position',
  'action',
  'reason',
  'occurrence_id',
  'thread_id',
  'partial_occurrence_creation',
  'observation_ids',
  'thread_anchor_id',
  'occurrence_comparisons',
  'thread_comparisons',
  'occurrence_applicability',
  'thread_applicability',
  'occurrence',
  'thread',
  'outcome',
  'prior_family',
  'incoming_family',
  'references',
  'role',
  'normalized_value_sha256',
  'span',
  'field',
  'start',
  'end',
  'source_sha256',
  'span_sha256',
  'observations',
  'anchor',
  'facts',
  'issues',
  'identity',
  'evolving',
  'context',
  'observation_id',
  'available_at',
  'relation_type',
  'instance_identifier',
  'bounded',
  'knowledge',
  'value',
  'supports',
  'rule',
  'process_type',
  'boundary',
  'anchor_id',
  'extractor_version',
  'extractor_rule_id',
  'syndication_group',
  'semantic_type',
  'classification',
  'metadata_dependencies',
  'left',
  'right',
  'left_sha256',
  'right_sha256',
  'operator',
  'comparison',
]);
export const NATIVE_DIAGNOSTIC_TOKENS = new Set([
  'update_occurrence',
  'new_occurrence_in_existing_thread',
  'new_thread',
  'ambiguous',
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
  'MATCH',
  'DISTINCT',
  'UNKNOWN',
  'match',
  'distinct',
  'unknown',
  'APPLICABLE',
  'INAPPLICABLE',
  'UNKNOWN_APPLICABILITY',
  'OBSERVED',
  'CONFLICTING',
  'UNOBSERVED',
  'observed',
  'conflicting',
  'unobserved',
  'missing_unresolved_or_conflicting_class',
  'compatible_typed_family',
  'explicit_disjoint_typed_families',
  'family_overlap_unresolved',
  'fixture',
  'institutional_act',
  'incident',
  'explicit_instance',
  'fixture_series',
  'notification_process',
  'numbered_session',
  'legal_case',
  'investigation',
  'operation',
  'explicit_process',
  'scheduled_fixture',
  'institutional_decision',
  'physical_incident',
  'identified_action',
  'bounded_action',
  'bounded_series',
  'bounded_notification_dispute',
  'bounded_process',
  'title',
  'body',
  'home',
  'away',
  'competition',
  'authority',
  'decision_action',
  'process_object',
  'incident_kind',
  'site',
  'namespace',
  'round',
  'jurisdiction',
  'target',
  'origin_month',
  'regulation',
  'regulation_month',
  'process_key',
  'decision_day',
  'phase3v10.11-applicability-replay-v1',
  'phase3v10.11-namespace-compatibility-v1',
  'phase3v10.9-grounded-extractor-v1',
  'phase3v10.10-scoped-anchor-v1',
  'identity',
  'evolving',
  'context',
  'retained_observation',
  'DIRECT',
  'DERIVED',
  'direct_lexical',
  'modal_marker_v1',
  'calendar_date_v1',
  'relative_day_v1',
  'explicit_roles_schedule_v1',
  'court_lexical_v1',
  'ruling_lexical_v1',
  'scoped_visitation_object_v1',
  'dated_court_act_v1',
  'assembly_lexical_v1',
  'explicit_namespaced_action_v1',
  'existing_schema_adapter',
  'explicit_origin_month_v1',
  'integer_regulation_number_v1',
  'explicit_regulation_month_v1',
  'originating_directive_scope_v1',
  'process_boundary',
  'event_day',
  'quantity',
  'edition',
  'leg',
  'scheduled_day',
  'venue',
  'occurrence_day',
  'primary_target',
  'modality:conditional',
  'modality:expected',
  'modality:confirmed',
  'modality:cancelled',
  'modality:denied',
  'modality:retrospective',
  'modality:completed',
  'modality:planned',
  'missing_bounded_process_anchor',
  'ambiguous_or_conflicting_process_anchor',
  'incomparable_process_namespace_or_type',
  'incomplete_shared_process_scope',
  'bounded_process_scope_contradiction',
  'same_bounded_process_scope',
  'same_identifier_conflicting_identity',
  'unreconciled_schedule_venue_conflict',
]);
const issueTokens = new Set([
  'multiple_modal_markers_retained',
  'conflicting_event_dates',
  'missing_or_conflicting_competition',
  'conflicting_current_editions',
  'ambiguous_session_scope',
  'ambiguous_process_identifiers',
  'ambiguous_process_scope',
  'multiple_foreground_processes',
  'conflicting_round_scope',
]);
const identityReason =
  /^v10_7:(?:home|away|competition|edition|round|leg|authority|decision_action|process_object|decision_day|incident_kind|site|occurrence_day|primary_target|relation_type|explicit_identifier_or_namespace|shared_identifier_namespace|explicit_identifier|supported_occurrence_class|tournament_key_or_schedule_key|prior_same_class_observation|unambiguous_prior_explicit_identifier)(?:,(?:home|away|competition|edition|round|leg|authority|decision_action|process_object|decision_day|incident_kind|site|occurrence_day|primary_target|relation_type|explicit_identifier_or_namespace|shared_identifier_namespace|explicit_identifier|supported_occurrence_class|tournament_key_or_schedule_key|prior_same_class_observation|unambiguous_prior_explicit_identifier))*$/;
const sourceTextKeys = new Set(['value', 'instance_identifier']);
const tokenKeys = new Set([
  'action',
  'reason',
  'outcome',
  'prior_family',
  'incoming_family',
  'role',
  'field',
  'knowledge',
  'relation_type',
  'process_type',
  'version',
  'extractor_version',
  'semantic_type',
  'classification',
  'rule',
  'extractor_rule_id',
]);
const hashKeys = new Set([
  'normalized_value_sha256',
  'source_sha256',
  'span_sha256',
  'left_sha256',
  'right_sha256',
  'observation_ids',
  'thread_anchor_id',
  'observation_id',
  'anchor_id',
]);
function modeledPath(path: string): boolean {
  return (
    /^\/artifact\/article_decisions\/[0-9]+\/(article_id|position|action|reason|occurrence_id|thread_id|partial_occurrence_creation|observation_ids(?:\/[0-9]+)?|thread_anchor_id)$/.test(
      path,
    ) ||
    /^\/artifact\/article_decisions\/[0-9]+\/(occurrence|thread)_(applicability|comparisons)\/(occurrence|thread):[a-f0-9]{24}(?:\/[0-9]+)?\/outcome$/.test(
      path,
    ) ||
    /^\/artifact\/article_decisions\/[0-9]+\/(occurrence|thread)_(applicability|comparisons)\/(occurrence|thread):[a-f0-9]{24}(?:\/[0-9]+)?\/references\/[0-9]+\/span\/(article_id|source_id|field|start|end|source_sha256|span_sha256)$/.test(
      path,
    )
  );
}
function safeNativeString(
  value: string,
  key: string,
  path: string,
  identities?: ReadonlySet<string>,
): boolean {
  if (sourceTextKeys.has(key)) return false;
  if (key === 'reason' && identityReason.test(value)) return true;
  if (key === 'issues' && issueTokens.has(value)) return true;
  if (tokenKeys.has(key) && NATIVE_DIAGNOSTIC_TOKENS.has(value)) return true;
  if (hashKeys.has(key) && digest.test(value)) return true;
  if (/^\/artifact\/hashes\/[a-z_]+$/.test(path) && digest.test(value)) return true;
  if (['occurrence_id', 'thread_id'].includes(key) && generatedIdentity.test(value)) return true;
  if (
    ['article_id', 'source_id'].includes(key) &&
    (identities
      ? identities.has(value)
      : /^(?:[0-7][0-9A-HJKMNP-TV-Z]{25}|authored-[0-9]+)$/.test(value))
  )
    return true;
  if (key === 'available_at' && timestamp.test(value)) return true;
  if (
    /^\/artifact\/(?:occurrence|thread)_memberships\/[0-9]+\/1$/.test(path) &&
    (identities
      ? identities.has(value)
      : /^(?:[0-7][0-9A-HJKMNP-TV-Z]{25}|authored-[0-9]+)$/.test(value))
  )
    return true;
  if (
    /^\/artifact\/(?:occurrence|thread)_(?:memberships|generations)\/[0-9]+\/(?:1|2)$/.test(path) &&
    generatedIdentity.test(value)
  )
    return true;
  if (/^\/artifact\/(?:occurrence|thread)_generations\/[0-9]+\/2$/.test(path) && digest.test(value))
    return true;
  return false;
}
const mandatorySections = ['artifact', 'extractions', 'anchor_extractions'];
function optionalInventory(path: string): readonly string[] {
  if (/\/(?:occurrence|thread)_applicability\/(?:occurrence|thread):[a-f0-9]{24}$/.test(path))
    return ['version', 'outcome', 'reason', 'prior_family', 'incoming_family', 'references'];
  if (/\/(?:extractions|anchor_extractions)\/[0-9]+$/.test(path))
    return ['article_id', 'observations', 'anchor', 'facts', 'issues'];
  if (/\/observations\/[0-9]+$/.test(path))
    return [
      'article_id',
      'available_at',
      'relation_type',
      'extractor_version',
      'identity',
      'evolving',
      'context',
      'instance_identifier',
      'syndication_group',
      'extractor_rule_id',
    ];
  if (/\/facts\/[0-9]+$/.test(path))
    return [
      'field',
      'semantic_type',
      'classification',
      'rule',
      'supports',
      'metadata_dependencies',
    ];
  return [];
}
const digest = /^[a-f0-9]{64}$/;
const generatedIdentity = /^(?:occurrence|thread):[a-f0-9]{24}$/;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/;

/** Every native field receives an outcome, including unknown keys and optional absence.
 * Source strings are hashed even when excerpt permission exists: diagnostic output
 * never consumes or circumvents the independently bounded evidence quote budget.
 */
export function preserveNativeDiagnostics(
  raw: unknown,
  projection: unknown,
  articleIds: ReadonlySet<string>,
): NativeDiagnosticReceipt {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('NATIVE_DIAGNOSTIC_INVALID');
  const fields: NativeDiagnosticField[] = [];
  const visit = (
    value: unknown,
    path: string,
    key: string,
    trustedPath: boolean,
    depth: number,
  ): void => {
    if (depth > 48 || fields.length >= 100_000 || path.length > 2048)
      throw new Error('NATIVE_DIAGNOSTIC_INVALID');
    const projectionState = trustedPath && modeledPath(path) ? 'MODELED' : 'NOT_MODELED';
    if (value && typeof value === 'object') {
      const array = Array.isArray(value);
      fields.push(
        Object.freeze({
          path,
          nativeKind: array ? 'array' : 'object',
          outcome: 'PERSISTED_NATIVE_VALUE',
          projection: projectionState,
          reason: 'STRUCTURAL_SEMANTIC_VALUE',
          value: array ? value.length : Object.keys(value).length,
        }),
      );
      if (array)
        value.forEach((item: unknown, index: number) =>
          visit(item, `${path}/${String(index)}`, key, trustedPath, depth + 1),
        );
      else
        for (const [childKey, item] of Object.entries(value).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        )) {
          const known = NATIVE_DIAGNOSTIC_KEYS.has(childKey) || generatedIdentity.test(childKey);
          // Unrecognized names may themselves contain publisher text.
          const token = known ? childKey : `key-sha256:${diagnosticSha256(childKey)}`;
          visit(item, `${path}/${token}`, childKey, trustedPath && known, depth + 1);
        }
      if (!array && trustedPath)
        for (const optionalKey of optionalInventory(path))
          if (!Object.hasOwn(value, optionalKey))
            fields.push(
              Object.freeze({
                path: `${path}/${optionalKey}`,
                nativeKind: 'absent',
                outcome: 'NOT_EMITTED',
                projection: modeledPath(`${path}/${optionalKey}`) ? 'MODELED' : 'NOT_MODELED',
                reason: 'NOT_EMITTED_BY_PROVIDER',
              }),
            );
      return;
    }
    if (
      !(
        value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
      )
    )
      throw new Error('NATIVE_DIAGNOSTIC_INVALID');
    const nativeKind = value === null ? 'null' : (typeof value as 'string' | 'boolean' | 'number');
    const safeString = typeof value !== 'string' || safeNativeString(value, key, path, articleIds);
    if (trustedPath && safeString)
      fields.push(
        Object.freeze({
          path,
          nativeKind,
          outcome: 'PERSISTED_NATIVE_VALUE',
          projection: projectionState,
          reason: 'STRUCTURAL_SEMANTIC_VALUE',
          value,
        }),
      );
    else
      fields.push(
        Object.freeze({
          path,
          nativeKind,
          outcome: 'HASH_ONLY',
          projection: projectionState,
          reason: trustedPath ? 'SOURCE_TEXT_RETENTION_DENIED' : 'UNMODELED_NATIVE_FIELD',
          sha256: diagnosticSha256(value),
        }),
      );
  };
  visit(raw, '', '', true, 0);
  for (const section of mandatorySections)
    if (!Object.hasOwn(raw, section))
      fields.push(
        Object.freeze({
          path: '/' + section,
          nativeKind: 'absent',
          outcome: 'NOT_EMITTED',
          projection: 'NOT_MODELED',
          reason: 'NOT_EMITTED_BY_PROVIDER',
        }),
      );
  fields.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const receipt = {
    schemaVersion: 'provider-native-diagnostics-v1' as const,
    canonicalization: 'sorted-json-utf8-v1' as const,
    sourceTextRetention: 'HASH_ONLY' as const,
    nativeOutputSha256: diagnosticSha256(raw),
    projectionSha256: diagnosticSha256(projection),
    fields: Object.freeze(fields),
  };
  return Object.freeze({ ...receipt, canonicalSha256: diagnosticSha256(receipt) });
}

export function assertNativeDiagnosticReceipt(
  raw: unknown,
): asserts raw is NativeDiagnosticReceipt {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('NATIVE_DIAGNOSTIC_INVALID');
  const boundary = raw as Record<string, unknown>;
  const receipt = raw as NativeDiagnosticReceipt;
  const { canonicalSha256, ...identity } = receipt;
  if (
    Object.keys(receipt).sort().join(',') !==
      [
        'canonicalSha256',
        'canonicalization',
        'fields',
        'nativeOutputSha256',
        'projectionSha256',
        'schemaVersion',
        'sourceTextRetention',
      ]
        .sort()
        .join(',') ||
    boundary.schemaVersion !== 'provider-native-diagnostics-v1' ||
    boundary.canonicalization !== 'sorted-json-utf8-v1' ||
    boundary.sourceTextRetention !== 'HASH_ONLY' ||
    typeof boundary.nativeOutputSha256 !== 'string' ||
    typeof boundary.projectionSha256 !== 'string' ||
    typeof boundary.canonicalSha256 !== 'string' ||
    !digest.test(receipt.nativeOutputSha256) ||
    !digest.test(receipt.projectionSha256) ||
    canonicalSha256 !== diagnosticSha256(identity)
  )
    throw new Error('NATIVE_DIAGNOSTIC_INVALID');
  if (
    !Array.isArray(receipt.fields as unknown) ||
    receipt.fields.length < 1 ||
    receipt.fields.length > 100_000 ||
    new Set(receipt.fields.map((row) => row.path)).size !== receipt.fields.length
  )
    throw new Error('NATIVE_DIAGNOSTIC_INVALID');
  for (const row of receipt.fields) {
    const rowBoundary: unknown = row;
    const required = ['path', 'nativeKind', 'outcome', 'projection', 'reason'];
    if (
      !rowBoundary ||
      typeof rowBoundary !== 'object' ||
      required.some((key) => !Object.hasOwn(row, key)) ||
      Object.keys(row).some((key) => ![...required, 'value', 'sha256'].includes(key)) ||
      typeof row.path !== 'string' ||
      !['object', 'array', 'string', 'number', 'boolean', 'null', 'absent'].includes(
        row.nativeKind,
      ) ||
      ![
        'STRUCTURAL_SEMANTIC_VALUE',
        'SOURCE_TEXT_RETENTION_DENIED',
        'UNMODELED_NATIVE_FIELD',
        'NOT_EMITTED_BY_PROVIDER',
      ].includes(row.reason) ||
      row.projection !== (modeledPath(row.path) ? 'MODELED' : 'NOT_MODELED')
    )
      throw new Error('NATIVE_DIAGNOSTIC_INVALID');
    const segments: string[] = row.path.split('/');
    if (
      row.path.length > 2048 ||
      segments.some(
        (segment) =>
          segment !== '' &&
          !NATIVE_DIAGNOSTIC_KEYS.has(segment) &&
          !/^(?:0|[1-9][0-9]*)$/.test(segment) &&
          !generatedIdentity.test(segment) &&
          !/^key-sha256:[a-f0-9]{64}$/.test(segment),
      )
    )
      throw new Error('NATIVE_DIAGNOSTIC_INVALID');
    const outcome = (rowBoundary as Record<string, unknown>).outcome;
    if (outcome === 'PERSISTED_NATIVE_VALUE') {
      if (!Object.hasOwn(row, 'value') || row.sha256 !== undefined || row.nativeKind === 'absent')
        throw new Error('NATIVE_DIAGNOSTIC_INVALID');
      if (
        !['object', 'array'].includes(row.nativeKind) &&
        segments.some((segment) => segment.startsWith('key-sha256:'))
      )
        throw new Error('NATIVE_DIAGNOSTIC_INVALID');
      if (
        row.reason !== 'STRUCTURAL_SEMANTIC_VALUE' ||
        !(
          row.value === null ||
          typeof row.value === 'string' ||
          typeof row.value === 'boolean' ||
          (typeof row.value === 'number' && Number.isFinite(row.value))
        ) ||
        (['array', 'object'].includes(row.nativeKind)
          ? !Number.isSafeInteger(row.value) || Number(row.value) < 0
          : row.nativeKind === 'null'
            ? row.value !== null
            : typeof row.value !== row.nativeKind)
      )
        throw new Error('NATIVE_DIAGNOSTIC_INVALID');
      let key = segments.at(-1) ?? '';
      if (/^[0-9]+$/.test(key)) key = segments.at(-2) ?? '';
      if (typeof row.value === 'string' && !safeNativeString(row.value, key, row.path))
        throw new Error('NATIVE_DIAGNOSTIC_INVALID');
    } else if (outcome === 'HASH_ONLY') {
      if (
        Object.hasOwn(row, 'value') ||
        !row.sha256 ||
        !digest.test(row.sha256) ||
        !['SOURCE_TEXT_RETENTION_DENIED', 'UNMODELED_NATIVE_FIELD'].includes(row.reason) ||
        ['object', 'array', 'absent'].includes(row.nativeKind)
      )
        throw new Error('NATIVE_DIAGNOSTIC_INVALID');
    } else if (outcome === 'NOT_EMITTED' || outcome === 'OMITTED_RIGHTS_POLICY') {
      if (
        Object.hasOwn(row, 'value') ||
        Object.hasOwn(row, 'sha256') ||
        (row.outcome === 'NOT_EMITTED' &&
          (row.nativeKind !== 'absent' || row.reason !== 'NOT_EMITTED_BY_PROVIDER')) ||
        ((row as unknown as Record<string, unknown>).outcome === 'OMITTED_RIGHTS_POLICY' &&
          row.reason !== 'SOURCE_TEXT_RETENTION_DENIED')
      )
        throw new Error('NATIVE_DIAGNOSTIC_INVALID');
    } else throw new Error('NATIVE_DIAGNOSTIC_INVALID');
  }
  const byPath = new Map(receipt.fields.map((row) => [row.path, row]));
  const childCounts = new Map<string, number>();
  for (const row of receipt.fields)
    if (row.path !== '') {
      const parentPath = row.path.slice(0, row.path.lastIndexOf('/'));
      const parent = byPath.get(parentPath);
      if (!parent || !['object', 'array'].includes(parent.nativeKind))
        throw new Error('NATIVE_DIAGNOSTIC_INVALID');
      if (row.outcome !== 'NOT_EMITTED')
        childCounts.set(parentPath, (childCounts.get(parentPath) ?? 0) + 1);
      if (
        parent.nativeKind === 'array' &&
        (!/^(?:0|[1-9][0-9]*)$/.test(row.path.slice(row.path.lastIndexOf('/') + 1)) ||
          Number(row.path.slice(row.path.lastIndexOf('/') + 1)) >= Number(parent.value))
      )
        throw new Error('NATIVE_DIAGNOSTIC_INVALID');
    }
  for (const row of receipt.fields)
    if (
      ['object', 'array'].includes(row.nativeKind) &&
      row.value !== (childCounts.get(row.path) ?? 0)
    )
      throw new Error('NATIVE_DIAGNOSTIC_INVALID');
}
