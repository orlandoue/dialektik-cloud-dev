import 'dart:convert';

import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/semantic_shadow/data/ephemeral_semantic_models.dart';
import 'package:dialektik/features/semantic_shadow/data/llm_semantic_models.dart';

Map<String, Object?> _graphObject(Object? value, Set<String> keys) {
  final Map<String, Object?> row = liveObject(value);
  if (row.length != keys.length || !row.keys.every(keys.contains)) {
    throw const FormatException('Unexpected shadow graph fields.');
  }
  return row;
}

String _id(Map<String, Object?> row, String key) {
  final String value = liveString(row, key);
  if (!RegExp(r'^[0-7][0-9A-HJKMNP-TV-Z]{25}$').hasMatch(value)) {
    throw const FormatException('Invalid graph run identity.');
  }
  return value;
}

String _hash(Map<String, Object?> row, String key) {
  final String value = liveString(row, key);
  if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(value)) {
    throw const FormatException('Invalid graph hash.');
  }
  return value;
}

List<String> _strings(Object? value) {
  final List<String> result = liveList(value, (Object? item) {
    if (item is! String || item.isEmpty) {
      throw const FormatException('Invalid graph member.');
    }
    return item;
  });
  if (result.isEmpty || result.toSet().length != result.length) {
    throw const FormatException('Empty or duplicate graph membership.');
  }
  return List<String>.unmodifiable(result);
}

String _nodeKey(Map<String, Object?> row, String key, String kind) {
  final String value = liveString(row, key);
  if (!RegExp('^$kind:[a-f0-9]{24}\$').hasMatch(value)) {
    throw const FormatException('Invalid native proposal key.');
  }
  return value;
}

bool _sameMembers(Iterable<String> a, Iterable<String> b) {
  final Set<String> left = a.toSet(), right = b.toSet();
  return left.length == right.length && left.containsAll(right);
}

final class SemanticGraphRunDto {
  const SemanticGraphRunDto(this.fields);
  factory SemanticGraphRunDto.fromJson(Object? value) {
    final raw = liveObject(value);
    final Map<String, Object?> row = _graphObject(value, <String>{
      if (raw.containsKey('llm')) 'llm',
      'run_id',
      'snapshot_id',
      'run_identity',
      'input_provenance',
      'provider_type',
      'provider_version',
      'candidate_commit',
      'runtime_python',
      'runtime_model',
      'sealed_at',
    });
    _id(row, 'run_id');
    _id(row, 'snapshot_id');
    liveString(row, 'run_identity');
    liveString(row, 'provider_version');
    liveDate(row, 'sealed_at');
    final bool authored = row['provider_type'] == 'authored_stub';
    if (authored) {
      liveRequire(row, 'input_provenance', 'AUTHORED_STUB');
      if (row['candidate_commit'] != null ||
          row['runtime_python'] != null ||
          row['runtime_model'] != null) {
        throw const FormatException(
          'Authored graph cannot impersonate the candidate.',
        );
      }
    } else if (row['provider_type'] == 'llm_gemini' ||
        row['provider_type'] == 'llm_cloudflare_workers_ai') {
      liveRequire(row, 'input_provenance', 'LIVE_REAL');
      if (!row.containsKey('llm') ||
          row['candidate_commit'] != null ||
          row['runtime_python'] != null ||
          row['runtime_model'] != null) {
        throw const FormatException('Independent LLM identity required.');
      }
    } else {
      liveRequire(row, 'provider_type', 'v10_11');
      liveRequire(row, 'input_provenance', 'LIVE_REAL');
      liveRequire(
        row,
        'candidate_commit',
        'ea47eb75e955b9a51d15dc0135c81145130553ca',
      );
      liveRequire(row, 'runtime_python', '3.11.9');
      liveRequire(row, 'runtime_model', 'none');
    }
    if (row.containsKey('llm')) {
      final config = LLMShadowConfigDto.fromJson(
        row['llm'],
        authoredStub: authored,
      );
      if (config.fields['providerVersion'] != row['provider_version'] ||
          !(authored
              ? config.model.startsWith('recorded-')
              : row['provider_type'] == 'llm_cloudflare_workers_ai'
              ? config.model.startsWith('@cf/')
              : config.model.startsWith('gemini-'))) {
        throw const FormatException('LLM configuration mismatch.');
      }
    }
    return SemanticGraphRunDto(Map<String, Object?>.unmodifiable(row));
  }
  final Map<String, Object?> fields;
  String get id => fields['run_id']! as String;
  String get snapshotId => fields['snapshot_id']! as String;
  String get identity => fields['run_identity']! as String;
  bool get isLLM => fields.containsKey('llm');
  LLMShadowConfigDto? get llm => isLLM
      ? LLMShadowConfigDto.fromJson(fields['llm'], authoredStub: isAuthored)
      : null;
  String get label => isLLM
      ? 'LLM Semantic Shadow · ${isAuthored ? 'authored recorded' : providerLabel}'
      : 'V10.11 histórico · $identity';
  bool get isAuthored => fields['input_provenance'] == 'AUTHORED_STUB';
  String get providerLabel {
    final String providerType = fields['provider_type']! as String;
    if (providerType == 'llm_cloudflare_workers_ai') {
      return 'Cloudflare Workers AI';
    }
    if (providerType == 'llm_gemini') {
      return 'Gemini';
    }
    return 'authored recorded';
  }
}

final class SemanticGraphInputDto {
  const SemanticGraphInputDto(
    this.article,
    this.publishedAt,
    this.publisherFamily,
    this.declaredUpstream,
  );
  factory SemanticGraphInputDto.fromJson(Object? value) {
    final Map<String, Object?> row = _graphObject(value, const <String>{
      'article',
      'published_at',
      'publisher_family',
      'declared_upstream',
    });
    final EphemeralArticleDto article = EphemeralArticleDto.fromJson(
      row['article'],
    );
    if (article.envelope == null || article.version == null) {
      throw const FormatException(
        'Sealed graph requires exact input provenance.',
      );
    }
    return SemanticGraphInputDto(
      article,
      row['published_at'] == null ? null : liveDate(row, 'published_at'),
      liveOptionalString(row, 'publisher_family'),
      liveOptionalString(row, 'declared_upstream'),
    );
  }
  final EphemeralArticleDto article;
  final DateTime? publishedAt;
  final String? publisherFamily, declaredUpstream;
}

final class SemanticGraphOccurrenceDto {
  const SemanticGraphOccurrenceDto(
    this.key,
    this.threadKey,
    this.articleIds,
    this.generationHash,
  );
  factory SemanticGraphOccurrenceDto.fromJson(Object? value) {
    final Map<String, Object?> row = _graphObject(value, const <String>{
      'key',
      'thread_key',
      'article_ids',
      'generation_hash',
    });
    final String? threadKey = row['thread_key'] == null
        ? null
        : _nodeKey(row, 'thread_key', 'thread');
    return SemanticGraphOccurrenceDto(
      _nodeKey(row, 'key', 'occurrence'),
      threadKey,
      _strings(row['article_ids']),
      _hash(row, 'generation_hash'),
    );
  }
  final String key, generationHash;
  final String? threadKey;
  final List<String> articleIds;
}

final class SemanticGraphThreadDto {
  const SemanticGraphThreadDto(
    this.key,
    this.occurrenceKeys,
    this.articleIds,
    this.generationHash,
  );
  factory SemanticGraphThreadDto.fromJson(Object? value) {
    final Map<String, Object?> row = _graphObject(value, const <String>{
      'key',
      'occurrence_keys',
      'article_ids',
      'generation_hash',
    });
    return SemanticGraphThreadDto(
      _nodeKey(row, 'key', 'thread'),
      _strings(row['occurrence_keys']),
      _strings(row['article_ids']),
      _hash(row, 'generation_hash'),
    );
  }
  final String key, generationHash;
  final List<String> occurrenceKeys, articleIds;
}

final class SemanticGraphSnapshotDto {
  SemanticGraphSnapshotDto(
    this.run,
    this.inputs,
    this.occurrences,
    this.threads,
  );
  factory SemanticGraphSnapshotDto.fromJson(Object? value) {
    final Map<String, Object?> row = _graphObject(value, const <String>{
      'run',
      'inputs',
      'occurrences',
      'threads',
    });
    final SemanticGraphRunDto run = SemanticGraphRunDto.fromJson(row['run']);
    final List<SemanticGraphInputDto> inputs = liveList(
      row['inputs'],
      SemanticGraphInputDto.fromJson,
    );
    final List<SemanticGraphOccurrenceDto> occurrences = liveList(
      row['occurrences'],
      SemanticGraphOccurrenceDto.fromJson,
    );
    final List<SemanticGraphThreadDto> threads = liveList(
      row['threads'],
      SemanticGraphThreadDto.fromJson,
    );
    final int inputLimit =
        run.identity == 'PROSPECTIVE_MULTISOURCE_V10_11_SHADOW_RUN_V1'
        ? 150
        : 40;
    if (inputs.length > inputLimit ||
        inputs.map((SemanticGraphInputDto i) => i.article.id).toSet().length !=
            inputs.length ||
        occurrences
                .map((SemanticGraphOccurrenceDto o) => o.key)
                .toSet()
                .length !=
            occurrences.length ||
        threads.map((SemanticGraphThreadDto t) => t.key).toSet().length !=
            threads.length) {
      throw const FormatException('Duplicate or unbounded shadow graph.');
    }
    for (final SemanticGraphInputDto input in inputs) {
      final Map<String, Object?> envelope = input.article.envelope!.fields;
      for (final String key in const <String>[
        'provider_type',
        'provider_version',
        'input_provenance',
        'candidate_commit',
        'runtime_python',
        'runtime_model',
      ]) {
        if (envelope[key] != run.fields[key]) {
          throw const FormatException(
            'Input belongs to a different run identity.',
          );
        }
      }
      if (run.isLLM &&
          input.article.envelope!.llm?.config.hash != run.llm!.hash) {
        throw const FormatException('LLM input config mismatch.');
      }
      for (final relation
          in input.article.envelope!.llm?.relations ??
              <Map<String, Object?>>[]) {
        final candidates = inputs.where(
          (i) =>
              i.article.id == relation['targetArticleId'] &&
              i.article.version!.fields['id'] == relation['targetVersionId'],
        );
        if (candidates.length != 1 ||
            candidates.single.article.envelope!.llm == null ||
            (relation['rightFacts']! as List<Object?>).any(
              (ref) => !candidates.single.article.envelope!.llm!.facts.any(
                (f) => f['id'] == ref,
              ),
            )) {
          throw const FormatException(
            'Relation lacks exact other input grounding.',
          );
        }
      }
      if (envelope['provider_run_id'] != run.id) {
        throw const FormatException('Input belongs to a different run.');
      }
    }
    final Set<String> inputIds = inputs
        .map((SemanticGraphInputDto i) => i.article.id)
        .toSet();
    final Map<String, SemanticGraphOccurrenceDto> occurrenceMap =
        <String, SemanticGraphOccurrenceDto>{
          for (final SemanticGraphOccurrenceDto o in occurrences) o.key: o,
        };
    final Map<String, SemanticGraphThreadDto> threadMap =
        <String, SemanticGraphThreadDto>{
          for (final SemanticGraphThreadDto t in threads) t.key: t,
        };
    final Set<String> assignedIds = <String>{};
    for (final SemanticGraphOccurrenceDto o in occurrences) {
      if (!inputIds.containsAll(o.articleIds) ||
          assignedIds.intersection(o.articleIds.toSet()).isNotEmpty ||
          (o.threadKey != null &&
              !(threadMap[o.threadKey]?.occurrenceKeys.contains(o.key) ??
                  false))) {
        throw const FormatException(
          'Occurrence membership does not match this graph.',
        );
      }
      assignedIds.addAll(o.articleIds);
    }
    for (final SemanticGraphThreadDto t in threads) {
      final Set<String> articles = <String>{};
      for (final String key in t.occurrenceKeys) {
        final SemanticGraphOccurrenceDto? o = occurrenceMap[key];
        if (o == null || o.threadKey != t.key) {
          throw const FormatException(
            'Thread membership does not match this graph.',
          );
        }
        articles.addAll(o.articleIds);
      }
      if (!_sameMembers(articles, t.articleIds)) {
        throw const FormatException(
          'Thread Article membership is inconsistent.',
        );
      }
    }
    return SemanticGraphSnapshotDto(run, inputs, occurrences, threads);
  }
  final SemanticGraphRunDto run;
  final List<SemanticGraphInputDto> inputs;
  final List<SemanticGraphOccurrenceDto> occurrences;
  final List<SemanticGraphThreadDto> threads;
  late final Map<String, SemanticGraphInputDto> byArticle =
      <String, SemanticGraphInputDto>{
        for (final SemanticGraphInputDto input in inputs)
          input.article.id: input,
      };
  int sourceCount(Iterable<String> ids) =>
      ids.map((String id) => byArticle[id]!.article.sourceId).toSet().length;
  List<SemanticGraphInputDto> get unassignedInputs {
    final Set<String> members = occurrences
        .expand((SemanticGraphOccurrenceDto o) => o.articleIds)
        .toSet();
    return inputs
        .where((SemanticGraphInputDto i) => !members.contains(i.article.id))
        .toList();
  }

  List<SemanticGraphOccurrenceDto> get standaloneOccurrences => occurrences
      .where((SemanticGraphOccurrenceDto o) => o.threadKey == null)
      .toList();
  Iterable<Map<String, Object?>> get comparisons => inputs.expand(
    (SemanticGraphInputDto i) => i.article.envelope!.observations,
  );
  Iterable<Map<String, Object?>> get llmRelations => inputs.expand(
    (i) => i.article.envelope!.llm?.relations ?? <Map<String, Object?>>[],
  );
  int comparisonsFor(String scope) => run.isLLM
      ? llmRelations.where((r) => r[scope] != 'NOT_APPLICABLE').length
      : comparisons
            .where(
              (Map<String, Object?> o) =>
                  (o['observation_key']! as String).startsWith('$scope:'),
            )
            .length;
  int get unscopedComparisons => run.isLLM
      ? 0
      : comparisons.where((Map<String, Object?> o) {
          final String key = o['observation_key']! as String;
          return !key.startsWith('occurrence:') && !key.startsWith('thread:');
        }).length;
  int get identityUnknown => run.isLLM
      ? llmRelations
            .where(
              (r) => r['occurrence'] == 'UNKNOWN' || r['thread'] == 'UNKNOWN',
            )
            .length
      : comparisons
            .where((Map<String, Object?> o) => o['decision'] == 'UNKNOWN')
            .length;
  int get applicabilityUnknown => inputs
      .expand(
        (SemanticGraphInputDto i) => i.article.envelope!.candidateApplicability,
      )
      .where(
        (Map<String, Object?> a) => a['outcome'] == 'UNKNOWN_APPLICABILITY',
      )
      .length;
  int get noComparisonArticles => run.isLLM
      ? inputs.where((i) => i.article.envelope!.llm!.relations.isEmpty).length
      : inputs
            .where(
              (SemanticGraphInputDto i) =>
                  i.article.envelope!.observations.isEmpty,
            )
            .length;
  int get ambiguousActions => inputs
      .expand((SemanticGraphInputDto i) => i.article.envelope!.articleProposals)
      .where((Map<String, Object?> p) => p['action'] == 'ambiguous')
      .length;
}

final class SemanticGraphDto {
  const SemanticGraphDto(this.runs, this.selected);
  factory SemanticGraphDto.fromJson(Object? value) {
    final Map<String, Object?> row = _graphObject(value, const <String>{
      'authority',
      'body_retention',
      'runs',
      'selected',
    });
    liveRequire(row, 'authority', 'SHADOW_NOT_AUTHORITATIVE');
    liveRequire(row, 'body_retention', 'NO_BODY_REDISPLAY');
    final List<SemanticGraphRunDto> runs = liveList(
      row['runs'],
      SemanticGraphRunDto.fromJson,
    );
    if (runs.map((SemanticGraphRunDto r) => r.id).toSet().length !=
        runs.length) {
      throw const FormatException('Duplicate run selector identity.');
    }
    final SemanticGraphSnapshotDto? selected = row['selected'] == null
        ? null
        : SemanticGraphSnapshotDto.fromJson(row['selected']);
    if (selected != null &&
        !runs.any(
          (SemanticGraphRunDto r) =>
              r.id == selected.run.id &&
              r.fields.keys.every(
                (String key) =>
                    jsonEncode(r.fields[key]) ==
                    jsonEncode(selected.run.fields[key]),
              ),
        )) {
      throw const FormatException(
        'Selected snapshot is not sealed in this run list.',
      );
    }
    return SemanticGraphDto(runs, selected);
  }
  final List<SemanticGraphRunDto> runs;
  final SemanticGraphSnapshotDto? selected;
}
