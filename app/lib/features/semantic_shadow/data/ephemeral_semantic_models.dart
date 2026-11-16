import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/semantic_shadow/data/llm_semantic_models.dart';

Map<String, Object?> _exact(Object? value, Set<String> keys) {
  final Map<String, Object?> data = liveObject(value);
  if (data.keys.length != keys.length || !data.keys.every(keys.contains)) {
    throw const FormatException('Unexpected retained semantic field.');
  }
  return data;
}

void _oneOf(Map<String, Object?> data, String key, Set<String> values) {
  if (!values.contains(data[key])) throw FormatException('Invalid $key.');
}

String _hash(Map<String, Object?> data, String key) {
  final String value = liveString(data, key);
  if (!RegExp(r'^[0-9a-f]{64}$').hasMatch(value)) {
    throw FormatException('Invalid $key hash.');
  }
  return value;
}

final class EphemeralSemanticDto {
  const EphemeralSemanticDto(this.articles);
  factory EphemeralSemanticDto.fromJson(Object? value) {
    final Map<String, Object?> data = _exact(value, const <String>{
      'authority',
      'body_retention',
      'articles',
    });
    liveRequire(data, 'authority', 'SHADOW_NOT_AUTHORITATIVE');
    liveRequire(data, 'body_retention', 'NO_EPHEMERAL_BODY');
    final List<EphemeralArticleDto> articles = liveList(
      data['articles'],
      EphemeralArticleDto.fromJson,
    );
    if (articles.map((EphemeralArticleDto a) => a.id).toSet().length !=
        articles.length) {
      throw const FormatException('Duplicate Article identity.');
    }
    return EphemeralSemanticDto(articles);
  }
  final List<EphemeralArticleDto> articles;

  List<EphemeralRunSummary> get runSummaries {
    final Map<String, List<EphemeralEnvelopeDto>> runs =
        <String, List<EphemeralEnvelopeDto>>{};
    for (final EphemeralArticleDto article in articles) {
      final EphemeralEnvelopeDto? envelope = article.envelope;
      if (envelope != null) {
        (runs[envelope.fields['provider_run_id']! as String] ??=
                <EphemeralEnvelopeDto>[])
            .add(envelope);
      }
    }
    return <EphemeralRunSummary>[
      for (final MapEntry<String, List<EphemeralEnvelopeDto>> run
          in runs.entries)
        EphemeralRunSummary.fromEnvelopes(run.key, run.value),
    ];
  }
}

/// Independent dimensions of the retained native projection, never a score.
final class EphemeralRunSummary {
  EphemeralRunSummary.fromEnvelopes(
    this.runId,
    List<EphemeralEnvelopeDto> envelopes,
  ) : articleCount = envelopes.length,
      nativeAmbiguousActions = envelopes
          .expand((EphemeralEnvelopeDto e) => e.articleProposals)
          .where((Map<String, Object?> p) => p['action'] == 'ambiguous')
          .length,
      noBoundedOccurrenceArticles = envelopes
          .where(
            (EphemeralEnvelopeDto e) => e.articleProposals.any(
              (Map<String, Object?> p) =>
                  p['reason_code'] == 'no_bounded_occurrence_observation',
            ),
          )
          .length,
      partialOccurrenceCount = envelopes
          .expand((EphemeralEnvelopeDto e) => e.articleProposals)
          .where(
            (Map<String, Object?> p) =>
                p['partial_occurrence_creation'] == true,
          )
          .map((Map<String, Object?> p) => p['proposed_occurrence_key'])
          .toSet()
          .length,
      proposedThreadCount = envelopes
          .expand((EphemeralEnvelopeDto e) => e.articleProposals)
          .map((Map<String, Object?> p) => p['proposed_thread_key'])
          .whereType<String>()
          .toSet()
          .length,
      unknownOccurrenceApplicabilityArticles = envelopes
          .where(
            (EphemeralEnvelopeDto e) => e.candidateApplicability.any(
              (Map<String, Object?> a) =>
                  a['scope'] == 'OCCURRENCE' &&
                  a['outcome'] == 'UNKNOWN_APPLICABILITY',
            ),
          )
          .length,
      identityComparisonCount = envelopes
          .expand((EphemeralEnvelopeDto e) => e.observations)
          .length,
      identityUnknownCount = envelopes
          .expand((EphemeralEnvelopeDto e) => e.observations)
          .where((Map<String, Object?> o) => o['decision'] == 'UNKNOWN')
          .length,
      historicalPacingNoncompliant = envelopes.any(
        (EphemeralEnvelopeDto e) => e.historicalPacingNoncompliant,
      );

  final String runId;
  final int articleCount,
      nativeAmbiguousActions,
      noBoundedOccurrenceArticles,
      partialOccurrenceCount,
      proposedThreadCount,
      unknownOccurrenceApplicabilityArticles,
      identityComparisonCount,
      identityUnknownCount;
  final bool historicalPacingNoncompliant;
}

final class EphemeralArticleDto {
  const EphemeralArticleDto({
    required this.id,
    required this.headline,
    required this.canonicalUrl,
    required this.sourceId,
    required this.sourceName,
    required this.accessMode,
    required this.processingState,
    required this.version,
    required this.envelope,
  });
  factory EphemeralArticleDto.fromJson(Object? value) {
    final Map<String, Object?> data = _exact(value, const <String>{
      'id',
      'headline',
      'canonical_url',
      'source',
      'content_access_mode',
      'semantic_processing_state',
      'body',
      'authoritative_semantic_assignment',
      'version',
      'envelope',
    });
    if (data['body'] != null) {
      throw const FormatException('Discarded body must be absent.');
    }
    liveRequire(data, 'authoritative_semantic_assignment', 'UNASSIGNED');
    _oneOf(data, 'content_access_mode', const <String>{
      'METADATA_ONLY',
      'FULLTEXT_EPHEMERAL',
      'FULLTEXT_PERSISTED',
    });
    _oneOf(data, 'semantic_processing_state', const <String>{
      'NOT_ELIGIBLE',
      'ELIGIBLE_UNPROCESSED',
      'PROCESSING',
      'PROCESSED_SHADOW',
      'PROCESSING_FAILED',
    });
    final Map<String, Object?> source = _exact(data['source'], const <String>{
      'id',
      'name',
    });
    final EphemeralVersionDto? version = data['version'] == null
        ? null
        : EphemeralVersionDto.fromJson(data['version']);
    final EphemeralEnvelopeDto? envelope = data['envelope'] == null
        ? null
        : EphemeralEnvelopeDto.fromJson(data['envelope']);
    if ((envelope != null && version == null) ||
        (data['semantic_processing_state'] == 'PROCESSED_SHADOW' &&
            envelope == null)) {
      throw const FormatException('Processed provenance is incomplete.');
    }
    if (data['content_access_mode'] == 'METADATA_ONLY' &&
        !const <String>[
          'NOT_ELIGIBLE',
          'PROCESSING_FAILED',
        ].contains(data['semantic_processing_state'])) {
      throw const FormatException('Metadata alone is not semantic input.');
    }
    if (data['content_access_mode'] == 'FULLTEXT_EPHEMERAL' &&
        envelope?.reproducibility == 'FULL_REPLAYABLE') {
      throw const FormatException(
        'Ephemeral input cannot claim retained replay.',
      );
    }
    if (version != null && envelope != null) {
      for (final f in envelope.llm?.facts ?? <Map<String, Object?>>[]) {
        final e = liveObject(f['evidence']);
        if (!envelope.evidence.any(
          (v) =>
              v['field'] == e['field'] &&
              v['field_hash'] == e['sourceSha256'] &&
              v['span_start'] == e['start'] &&
              v['span_end'] == e['end'] &&
              v['span_hash'] == e['spanSha256'],
        )) {
          throw const FormatException('LLM fact lacks envelope fingerprint.');
        }
      }
      for (final Map<String, Object?> evidence in envelope.evidence) {
        final bool body = evidence['field'] == 'body';
        if (evidence['field_hash'] !=
                version.fields[body
                    ? 'normalized_input_hash'
                    : 'title_input_hash'] ||
            (evidence['span_end']! as int) >
                (version.fields[body
                        ? 'input_codepoint_length'
                        : 'title_codepoint_length']!
                    as int)) {
          throw const FormatException(
            'Evidence does not identify this exact field version.',
          );
        }
      }
    }
    return EphemeralArticleDto(
      id: liveString(data, 'id'),
      headline: data['headline'] == null ? null : liveString(data, 'headline'),
      canonicalUrl: data['canonical_url'] == null
          ? null
          : liveHttpUri(data, 'canonical_url'),
      sourceId: liveString(source, 'id'),
      sourceName: liveString(source, 'name'),
      accessMode: liveString(data, 'content_access_mode'),
      processingState: liveString(data, 'semantic_processing_state'),
      version: version,
      envelope: envelope,
    );
  }
  final String id, sourceId, sourceName, accessMode, processingState;
  final String? headline;
  final Uri? canonicalUrl;
  final EphemeralVersionDto? version;
  final EphemeralEnvelopeDto? envelope;
}

final class EphemeralVersionDto {
  const EphemeralVersionDto(this.fields);
  factory EphemeralVersionDto.fromJson(Object? value) {
    final Map<String, Object?> data = _exact(value, const <String>{
      'id',
      'version_number',
      'acquired_content_hash',
      'normalized_input_hash',
      'title_input_hash',
      'normalization_version',
      'input_codepoint_length',
      'title_codepoint_length',
      'observed_at',
    });
    liveString(data, 'id');
    liveString(data, 'normalization_version');
    liveDate(data, 'observed_at');
    for (final String key in <String>[
      'acquired_content_hash',
      'normalized_input_hash',
      'title_input_hash',
    ]) {
      _hash(data, key);
    }
    if (liveInt(data, 'version_number') < 1 ||
        liveInt(data, 'input_codepoint_length') < 1 ||
        liveInt(data, 'title_codepoint_length') < 1) {
      throw const FormatException('Invalid observed content version.');
    }
    return EphemeralVersionDto(Map<String, Object?>.unmodifiable(data));
  }
  final Map<String, Object?> fields;
}

final class EphemeralEnvelopeDto {
  const EphemeralEnvelopeDto({
    required this.fields,
    required this.evidence,
    required this.observations,
    required this.articleProposals,
    required this.candidateApplicability,
  });
  factory EphemeralEnvelopeDto.fromJson(Object? value) {
    final raw = liveObject(value);
    final Map<String, Object?> data = _exact(value, <String>{
      if (raw.containsKey('llm')) 'llm',
      'id',
      'provider_type',
      'provider_version',
      'provider_run_id',
      'input_provenance',
      'candidate_commit',
      'runtime_python',
      'runtime_model',
      'reproducibility_class',
      'processed_at',
      'source_version_status',
      'evidence',
      'observations',
      'article_proposals',
      'candidate_applicability',
    });
    for (final String key in <String>[
      'id',
      'provider_type',
      'provider_version',
      'provider_run_id',
    ]) {
      liveString(data, key);
    }
    liveDate(data, 'processed_at');
    _oneOf(data, 'input_provenance', const <String>{
      'AUTHORED_STUB',
      'LIVE_REAL',
    });
    _oneOf(data, 'reproducibility_class', const <String>{
      'FULL_REPLAYABLE',
      'HASH_VERIFIABLE_REFETCH_REQUIRED',
      'HISTORICAL_INPUT_NOT_RECONSTRUCTABLE',
    });
    _oneOf(data, 'source_version_status', const <String>{
      'UNVERIFIED',
      'HASH_MATCH',
      'SOURCE_VERSION_CHANGED',
      'SOURCE_UNAVAILABLE',
    });
    if ((data['input_provenance'] == 'AUTHORED_STUB') !=
        (data['provider_type'] == 'authored_stub')) {
      throw const FormatException('Synthetic provider identity required.');
    }
    if (data['provider_type'] == 'authored_stub' &&
        (data['candidate_commit'] != null ||
            data['runtime_python'] != null ||
            data['runtime_model'] != null)) {
      throw const FormatException(
        'Authored provider cannot claim frozen execution.',
      );
    }
    if (data['provider_type'] == 'v10_11' &&
        (data['candidate_commit'] !=
                'ea47eb75e955b9a51d15dc0135c81145130553ca' ||
            data['provider_version'] !=
                'phase3v10.11-applicability-replay-v1' ||
            data['runtime_python'] != '3.11.9' ||
            data['runtime_model'] != 'none')) {
      throw const FormatException('Frozen provider identity mismatch.');
    }
    if (data.containsKey('llm')) {
      final llm = LLMShadowObservationDto.fromJson(
        data['llm'],
        authoredStub: data['provider_type'] == 'authored_stub',
      );
      if (llm.config.fields['providerVersion'] != data['provider_version'] ||
          data['candidate_commit'] != null ||
          data['runtime_python'] != null ||
          data['runtime_model'] != null ||
          ((data['provider_type'] == 'llm_gemini' ||
                  data['provider_type'] == 'llm_cloudflare_workers_ai') &&
              llm.fields['route'] != 'EXTERNAL_LLM_PROCESSING_ALLOWED') ||
          (data['provider_type'] == 'llm_cloudflare_workers_ai' &&
              !llm.config.model.startsWith('@cf/'))) {
        throw const FormatException('Invalid LLM provenance.');
      }
    } else if (data['provider_type'] == 'llm_gemini' ||
        data['provider_type'] == 'llm_cloudflare_workers_ai' ||
        (data['provider_version']! as String).startsWith('product-llm-v1.')) {
      throw const FormatException('Missing grounded LLM observation.');
    }
    final List<Map<String, Object?>> evidence = liveList(data['evidence'], (
      Object? item,
    ) {
      final Map<String, Object?> e = _exact(item, const <String>{
        'field',
        'field_hash',
        'span_start',
        'span_end',
        'span_hash',
        'retained_quote',
      });
      _oneOf(e, 'field', const <String>{'title', 'body'});
      _hash(e, 'field_hash');
      _hash(e, 'span_hash');
      if (e['retained_quote'] != null ||
          liveInt(e, 'span_start') < 0 ||
          liveInt(e, 'span_end') <= liveInt(e, 'span_start')) {
        throw const FormatException(
          'Only valid text-free evidence locators are supported.',
        );
      }
      return Map<String, Object?>.unmodifiable(e);
    });
    final List<Map<String, Object?>> observations = liveList(
      data['observations'],
      (Object? item) {
        final Map<String, Object?> o = _exact(item, const <String>{
          'observation_key',
          'decision',
          'applicability',
          'proposed_occurrence_key',
          'proposed_thread_key',
        });
        liveString(o, 'observation_key');
        _oneOf(o, 'decision', const <String>{'MATCH', 'DISTINCT', 'UNKNOWN'});
        _oneOf(o, 'applicability', const <String>{
          'APPLICABLE',
          'INAPPLICABLE',
          'UNKNOWN_APPLICABILITY',
        });
        liveOptionalString(o, 'proposed_occurrence_key');
        liveOptionalString(o, 'proposed_thread_key');
        return Map<String, Object?>.unmodifiable(o);
      },
    );
    final List<Map<String, Object?>> proposals = liveList(
      data['article_proposals'],
      (Object? item) {
        final Map<String, Object?> p = _exact(item, const <String>{
          'action',
          'reason_code',
          'proposed_occurrence_key',
          'proposed_thread_key',
          'partial_occurrence_creation',
        });
        _oneOf(p, 'action', const <String>{
          'update_occurrence',
          'new_occurrence_in_existing_thread',
          'new_thread',
          'ambiguous',
        });
        _oneOf(p, 'reason_code', const <String>{
          'llm_grounded_same_occurrence',
          'llm_grounded_same_thread',
          'llm_bounded_singleton',
          'llm_abstention',
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
        });
        liveOptionalString(p, 'proposed_occurrence_key');
        liveOptionalString(p, 'proposed_thread_key');
        if (p['partial_occurrence_creation'] is! bool ||
            (p['partial_occurrence_creation'] == true &&
                p['proposed_occurrence_key'] == null)) {
          throw const FormatException('Invalid native occurrence proposal.');
        }
        return Map<String, Object?>.unmodifiable(p);
      },
    );
    if (proposals.length > 1) {
      throw const FormatException('One native Article proposal per envelope.');
    }
    final List<Map<String, Object?>> applicability = liveList(
      data['candidate_applicability'],
      (Object? item) {
        final Map<String, Object?> a = _exact(item, const <String>{
          'scope',
          'target_key',
          'outcome',
        });
        _oneOf(a, 'scope', const <String>{'OCCURRENCE', 'THREAD'});
        liveString(a, 'target_key');
        _oneOf(a, 'outcome', const <String>{
          'APPLICABLE',
          'INAPPLICABLE',
          'UNKNOWN_APPLICABILITY',
        });
        return Map<String, Object?>.unmodifiable(a);
      },
    );
    return EphemeralEnvelopeDto(
      fields: Map<String, Object?>.unmodifiable(data),
      evidence: evidence,
      observations: observations,
      articleProposals: proposals,
      candidateApplicability: applicability,
    );
  }
  LLMShadowObservationDto? get llm => fields.containsKey('llm')
      ? LLMShadowObservationDto.fromJson(
          fields['llm'],
          authoredStub: fields['provider_type'] == 'authored_stub',
        )
      : null;
  final Map<String, Object?> fields;
  final List<Map<String, Object?>> evidence,
      observations,
      articleProposals,
      candidateApplicability;
  String get reproducibility => fields['reproducibility_class']! as String;
  String get sourceVersionStatus => fields['source_version_status']! as String;
  bool get isAuthored => fields['input_provenance'] == 'AUTHORED_STUB';
  // Independent audit qualification for this exact historical execution only.
  // It changes no native result and adds no field to the existing API contract.
  bool get historicalPacingNoncompliant =>
      fields['provider_run_id'] == '01M43R0HEX7103W3JQHP025HX2' &&
      fields['candidate_commit'] ==
          'ea47eb75e955b9a51d15dc0135c81145130553ca' &&
      fields['provider_type'] == 'v10_11' &&
      fields['input_provenance'] == 'LIVE_REAL';
}
