import 'package:dialektik/features/live/data/live_news_models.dart';

Map<String, Object?> _closed(Object? value, Set<String> keys) {
  final row = liveObject(value);
  if (row.length != keys.length || !row.keys.every(keys.contains)) {
    throw const FormatException('Unsupported LLM shadow fields.');
  }
  return row;
}

String _hash(Map<String, Object?> row, String key) {
  final v = liveString(row, key);
  if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(v)) {
    throw const FormatException('Invalid grounded hash.');
  }
  return v;
}

void _enum(Map<String, Object?> row, String key, Set<String> values) {
  if (!values.contains(liveString(row, key))) {
    throw const FormatException('Invalid LLM enum.');
  }
}

final class LLMShadowConfigDto {
  const LLMShadowConfigDto(this.fields);
  factory LLMShadowConfigDto.fromJson(
    Object? value, {
    bool authoredStub = false,
  }) {
    final row = _closed(value, const {
      'model',
      'providerVersion',
      'configHash',
      'promptVersion',
      'schemaVersion',
      'retrievalVersion',
      'graphVersion',
      'maxArticles',
      'maxCalls',
      'topK',
      'timeoutMs',
      'maxRetries',
      'concurrency',
      'maxOutputTokens',
    });
    for (final k in [
      'model',
      'providerVersion',
      'promptVersion',
      'schemaVersion',
      'retrievalVersion',
      'graphVersion',
    ]) {
      liveString(row, k);
    }
    final hash = _hash(row, 'configHash');
    final providerVersion = row['providerVersion']! as String;
    final bool cloudflare =
        providerVersion ==
        'product-cloudflare-workers-ai-v1.${hash.substring(0, 24)}';
    final bool standardProvider =
        providerVersion == 'product-llm-v1.${hash.substring(0, 24)}';
    if ((!standardProvider && !cloudflare) ||
        row['promptVersion'] != 'product-llm-prompts-v1' ||
        row['schemaVersion'] != 'product-llm-schema-v1' ||
        row['retrievalVersion'] != 'fact-index-topk-v1' ||
        row['graphVersion'] != 'proposal-builder-v1' ||
        liveInt(row, 'maxArticles') < 1 ||
        liveInt(row, 'maxArticles') > 30 ||
        liveInt(row, 'maxCalls') < 1 ||
        liveInt(row, 'maxCalls') > 120 ||
        liveInt(row, 'topK') < 1 ||
        liveInt(row, 'topK') > 5 ||
        liveInt(row, 'timeoutMs') < 1 ||
        liveInt(row, 'timeoutMs') > 120000 ||
        row['maxRetries'] != 0 ||
        row['concurrency'] != 1 ||
        row['maxOutputTokens'] != 4096) {
      throw const FormatException('Invalid frozen LLM configuration.');
    }
    final model = row['model']! as String;
    final bool validModel = authoredStub
        ? standardProvider && model.startsWith('recorded-')
        : cloudflare
        ? const {
            '@cf/zai-org/glm-4.7-flash',
            '@cf/meta/llama-3.1-8b-instruct',
          }.contains(model)
        : standardProvider && model.startsWith('gemini-');
    if (!validModel) {
      throw const FormatException('Provider and model identity mismatch.');
    }
    return LLMShadowConfigDto(Map.unmodifiable(row));
  }
  final Map<String, Object?> fields;
  String get model => fields['model']! as String;
  String get hash => fields['configHash']! as String;
}

final class LLMShadowObservationDto {
  const LLMShadowObservationDto(
    this.fields,
    this.config,
    this.status,
    this.facts,
    this.relations,
  );
  factory LLMShadowObservationDto.fromJson(
    Object? value, {
    bool authoredStub = false,
  }) {
    final row = _closed(value, const {
      'mode',
      'config',
      'route',
      'extraction',
      'relations',
      'outputHash',
      'cacheKey',
      'usage',
      'evidenceVerification',
    });
    liveRequire(row, 'mode', 'LLM_SEMANTIC_SHADOW');
    liveRequire(row, 'evidenceVerification', 'VERIFIED');
    _enum(row, 'route', const {
      'LOCAL_ONLY_PROCESSING',
      'EXTERNAL_LLM_PROCESSING_ALLOWED',
    });
    _hash(row, 'outputHash');
    _hash(row, 'cacheKey');
    final config = LLMShadowConfigDto.fromJson(
      row['config'],
      authoredStub: authoredStub,
    );
    final extraction = _closed(row['extraction'], const {
      'status',
      'boundedOccurrence',
      'boundedThread',
      'facts',
    });
    _enum(extraction, 'status', const {
      'OBSERVATION_AVAILABLE',
      'INSUFFICIENT_EVIDENCE',
      'NOT_APPLICABLE',
      'AMBIGUOUS',
    });
    if (extraction['boundedOccurrence'] is! bool ||
        extraction['boundedThread'] is! bool) {
      throw const FormatException('Invalid bound.');
    }
    final facts = liveList(extraction['facts'], (Object? v) {
      final f = _closed(v, const {
        'id',
        'role',
        'valueHash',
        'retrievalHash',
        'evidence',
        'isoDate',
      });
      if (!RegExp(r'^f[0-9]{1,2}$').hasMatch(liveString(f, 'id')) ||
          f['isoDate'] != null) {
        throw const FormatException('Unsupported retained fact.');
      }
      _enum(f, 'role', const {
        'action',
        'participant',
        'date',
        'end_date',
        'location',
        'external_id',
        'process',
        'topic',
      });
      _hash(f, 'valueHash');
      _hash(f, 'retrievalHash');
      final e = _closed(f['evidence'], const {
        'field',
        'start',
        'end',
        'sourceSha256',
        'spanSha256',
      });
      _enum(e, 'field', const {'title', 'body'});
      _hash(e, 'sourceSha256');
      _hash(e, 'spanSha256');
      if (liveInt(e, 'start') < 0 ||
          liveInt(e, 'end') <= liveInt(e, 'start') ||
          e['spanSha256'] != f['valueHash']) {
        throw const FormatException('Invalid fact grounding.');
      }
      return Map<String, Object?>.unmodifiable(f);
    });
    if (facts.length > 12 ||
        facts.map((f) => f['id']).toSet().length != facts.length) {
      throw const FormatException('Invalid facts.');
    }
    if (extraction['status'] != 'OBSERVATION_AVAILABLE' &&
        (facts.isNotEmpty ||
            extraction['boundedOccurrence'] != false ||
            extraction['boundedThread'] != false)) {
      throw const FormatException('Unsupported abstention.');
    }
    final relations = liveList(row['relations'], (Object? v) {
      final r = _closed(v, const {
        'decision',
        'occurrence',
        'thread',
        'leftFacts',
        'rightFacts',
        'targetArticleId',
        'targetVersionId',
      });
      _enum(r, 'decision', const {
        'SAME_OCCURRENCE',
        'DIFFERENT_OCCURRENCE_SAME_THREAD',
        'DIFFERENT_THREAD',
        'UNKNOWN',
        'NOT_APPLICABLE',
      });
      for (final k in ['occurrence', 'thread']) {
        _enum(r, k, const {'SAME', 'DISTINCT', 'UNKNOWN', 'NOT_APPLICABLE'});
      }
      if ((r['decision'] == 'SAME_OCCURRENCE' &&
              (r['occurrence'] != 'SAME' ||
                  !{'SAME', 'UNKNOWN'}.contains(r['thread']))) ||
          (r['decision'] == 'DIFFERENT_OCCURRENCE_SAME_THREAD' &&
              (r['occurrence'] != 'DISTINCT' || r['thread'] != 'SAME')) ||
          (r['decision'] == 'DIFFERENT_THREAD' &&
              (r['occurrence'] != 'DISTINCT' || r['thread'] != 'DISTINCT')) ||
          (r['decision'] == 'UNKNOWN' &&
              (!{'UNKNOWN', 'DISTINCT'}.contains(r['occurrence']) ||
                  r['thread'] != 'UNKNOWN')) ||
          (r['decision'] == 'NOT_APPLICABLE' &&
              (r['occurrence'] != 'NOT_APPLICABLE' ||
                  r['thread'] != 'NOT_APPLICABLE'))) {
        throw const FormatException('Relation axes disagree.');
      }
      for (final k in ['targetArticleId', 'targetVersionId']) {
        if (!RegExp(
          r'^[0-7][0-9A-HJKMNP-TV-Z]{25}$',
        ).hasMatch(liveString(r, k))) {
          throw const FormatException('Invalid relation target.');
        }
      }
      for (final k in ['leftFacts', 'rightFacts']) {
        final refs = liveList(r[k], (Object? v) {
          if (v is! String || !RegExp(r'^f[0-9]{1,2}$').hasMatch(v)) {
            throw const FormatException('Invalid fact reference.');
          }
          return v;
        });
        if (refs.length > 12 ||
            refs.toSet().length != refs.length ||
            (k == 'leftFacts' &&
                refs.any((id) => !facts.any((f) => f['id'] == id)))) {
          throw const FormatException('Unknown fact reference.');
        }
      }
      return Map<String, Object?>.unmodifiable(r);
    });
    if (relations.length > liveInt(config.fields, 'topK')) {
      throw const FormatException('Retrieval bound exceeded.');
    }
    final usage = _closed(row['usage'], const {
      'inputTokens',
      'outputTokens',
      'totalTokens',
      'cost',
    });
    if (usage['cost'] != null) throw const FormatException('Unsupported cost.');
    for (final k in ['inputTokens', 'outputTokens', 'totalTokens']) {
      if (usage[k] != null &&
          (liveInt(usage, k) < 0 || liveInt(usage, k) > 1000000000)) {
        throw const FormatException('Invalid usage.');
      }
    }
    return LLMShadowObservationDto(
      Map.unmodifiable(row),
      config,
      extraction['status']! as String,
      List.unmodifiable(facts),
      List.unmodifiable(relations),
    );
  }
  final Map<String, Object?> fields;
  final LLMShadowConfigDto config;
  final String status;
  final List<Map<String, Object?>> facts, relations;
}
