import 'package:dialektik/features/live/data/live_news_models.dart';

/// A development preflight receipt, never a semantic candidate result.
final class SemanticShadowPreflightDto {
  const SemanticShadowPreflightDto({
    required this.articles,
    required this.registryAuthenticated,
    required this.registryActualSha256,
    required this.registryRowCount,
  });

  factory SemanticShadowPreflightDto.fromJson(Object? value) {
    final Map<String, Object?> data = liveObject(value);
    liveRequire(
      data,
      'disposition',
      'CURRENT_LIVE_INPUT_INSUFFICIENT_FOR_V10_11',
    );
    liveRequire(data, 'adapter_status', 'READY');
    liveRequire(data, 'authority', 'NOT_AUTHORITATIVE');
    final Map<String, Object?> candidate = liveObject(data['candidate']);
    liveRequire(candidate, 'commit', candidateCommit);
    liveRequire(candidate, 'version', candidateVersion);
    _requireValue(candidate, 'execution_enabled', false);
    final Map<String, Object?> runtime = liveObject(candidate['runtime']);
    liveRequire(runtime, 'python', '3.11.9');
    liveRequire(runtime, 'model', 'none');
    final Map<String, Object?> contract = liveObject(data['input_contract']);
    liveRequire(contract, 'required_representation', 'FULL_SOURCE_TEXT');
    liveRequire(contract, 'required_body_field', 'text');
    _requireValue(contract, 'title_only_allowed', false);
    _requireValue(contract, 'excerpt_substitution_allowed', false);
    final Map<String, Object?> counters = liveObject(data['counters']);
    for (final String key in const <String>[
      'product_shadow_candidate_batches',
      'product_shadow_candidate_article_inputs',
      'determinism_replays',
      'final_holdout_candidate_executions',
    ]) {
      _requireValue(counters, key, 0);
    }
    for (final String key in const <String>[
      'observations',
      'proposed_occurrences',
      'proposed_threads',
    ]) {
      final Object? list = data[key];
      if (list is! List<Object?> || list.isNotEmpty) {
        throw const FormatException(
          'Preflight cannot contain candidate output.',
        );
      }
    }
    _requireValue(data, 'unknown_result_count', 0);
    _requireValue(data, 'eligible_article_count', 0);
    final List<SemanticShadowArticleDto> articles = liveList(
      data['articles'],
      SemanticShadowArticleDto.fromJson,
    );
    _requireValue(data, 'skipped_article_count', articles.length);
    if (articles
            .map((SemanticShadowArticleDto item) => item.id)
            .toSet()
            .length !=
        articles.length) {
      throw const FormatException(
        'Preflight Article identities must be unique.',
      );
    }
    final Map<String, Object?> registry = liveObject(data['registry']);
    liveRequire(registry, 'identity', 'product-live-shadow-exclusions-v1');
    liveRequire(registry, 'expected_sha256', registrySha256);
    final String actualSha = liveString(registry, 'actual_sha256');
    if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(actualSha)) {
      throw const FormatException('Invalid registry digest.');
    }
    final Object? authenticated = registry['authenticated'];
    final int rowCount = liveInt(registry, 'row_count');
    if (authenticated is! bool || rowCount < 0) {
      throw const FormatException('Invalid registry authentication.');
    }
    final bool verified =
        authenticated &&
        actualSha == registrySha256 &&
        articles.every(
          (SemanticShadowArticleDto item) => item.exclusionVerified,
        );
    liveString(data, 'required_source_representation');
    return SemanticShadowPreflightDto(
      articles: articles,
      registryAuthenticated: verified,
      registryActualSha256: actualSha,
      registryRowCount: rowCount,
    );
  }

  static const String candidateCommit =
      'ea47eb75e955b9a51d15dc0135c81145130553ca';
  static const String candidateVersion = 'phase3v10.11-applicability-replay-v1';
  static const String registrySha256 =
      '02bd750f97fdbd2bc98e3d59f7a657e8dce12a63a754fc7bd1ccde933ba3f9f3';

  final List<SemanticShadowArticleDto> articles;
  final bool registryAuthenticated;
  final String registryActualSha256;
  final int registryRowCount;
}

final class SemanticShadowArticleDto {
  const SemanticShadowArticleDto({
    required this.id,
    required this.headline,
    required this.canonicalUrl,
    required this.sourceItemId,
    required this.publishedAt,
    required this.firstAvailableAt,
    required this.language,
    required this.authorizedContentSha256,
    required this.authorizedContentSignature,
    required this.permittedRepresentationSha256,
    required this.sourceId,
    required this.sourceName,
    required this.exclusionVerified,
  });
  factory SemanticShadowArticleDto.fromJson(Object? value) {
    final Map<String, Object?> data = liveObject(value);
    liveRequire(data, 'representation', 'feed_excerpt');
    _requireValue(data, 'body', null);
    liveRequire(data, 'input_sufficiency', 'INVALID_FOR_CANDIDATE');
    liveRequire(data, 'reason_code', 'FULL_SOURCE_REQUIRED');
    liveRequire(data, 'authoritative_semantic_assignment', 'UNASSIGNED');
    final Object? verified = data['exclusion_verified'];
    if (verified is! bool) {
      throw const FormatException('Invalid Article exclusion authentication.');
    }
    final Map<String, Object?> source = liveObject(data['source']);
    return SemanticShadowArticleDto(
      id: liveString(data, 'article_id'),
      headline: liveString(data, 'headline'),
      canonicalUrl: liveHttpUri(data, 'canonical_url'),
      sourceItemId: liveString(data, 'source_item_id'),
      publishedAt: liveDate(data, 'published_at'),
      firstAvailableAt: liveDate(data, 'first_available_at'),
      language: liveString(data, 'language'),
      authorizedContentSha256: _digest(data, 'authorized_content_sha256'),
      authorizedContentSignature: liveString(
        data,
        'authorized_content_signature',
      ),
      permittedRepresentationSha256: _digest(
        data,
        'permitted_representation_sha256',
      ),
      sourceId: liveString(source, 'id'),
      sourceName: liveString(source, 'name'),
      exclusionVerified: verified,
    );
  }
  final String id;
  final String headline;
  final Uri canonicalUrl;
  final String sourceItemId;
  final DateTime publishedAt;
  final DateTime firstAvailableAt;
  final String language;
  final String authorizedContentSha256;
  final String authorizedContentSignature;
  final String permittedRepresentationSha256;
  final String sourceId;
  final String sourceName;
  final bool exclusionVerified;
}

String _digest(Map<String, Object?> data, String key) {
  final String value = liveString(data, key);
  if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(value)) {
    throw const FormatException('Invalid permitted representation digest.');
  }
  return value;
}

void _requireValue(Map<String, Object?> data, String key, Object? expected) {
  if (!data.containsKey(key) || data[key] != expected) {
    throw const FormatException('Unsupported semantic shadow preflight.');
  }
}
