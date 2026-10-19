import 'dart:async';
import 'dart:convert';

import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:http/http.dart' as http;

final RegExp _ulidPattern = RegExp(r'^[0-9A-HJKMNP-TV-Z]{26}$');
final RegExp _hashPattern = RegExp(r'^[0-9a-f]{64}$');
final RegExp _providerRunPattern = RegExp(r'^[A-Za-z0-9_.:-]{16,96}$');
final Set<String> _resultKeys = <String>{
  'jobId',
  'state',
  'duplicate',
  'observation',
  'errorCategory',
};
final Set<String> _articleKeys = <String>{
  'fixtureId',
  'sourceId',
  'articleId',
  'articleVersionId',
  'projectionVersionId',
  'projectionSha256',
  'titleSha256',
  'title',
  'publisher',
  'publishedAt',
  'acquisitionMode',
};
final Set<String> _authorizationListKeys = <String>{
  'ownerIdentity',
  'sourceId',
  'articleId',
  'articleVersionId',
  'projectionVersionId',
  'projectionSha256',
  'provider',
  'model',
  'authorizations',
};
final Set<String> _authorizationKeys = <String>{
  'id',
  'operation',
  'validFrom',
  'expiresAt',
};
final Set<String> _observationKeys = <String>{
  'providerRunId',
  'projectionSha256',
  'schemaSha256',
  'skillSha256',
  'derivativeSha256',
  'applicability',
  'eventNuggetCount',
  'factCount',
  'groundedFactCount',
  'unsupportedFactCount',
  'validEvidenceReferenceCount',
  'invalidEvidenceReferenceCount',
  'semanticDerivatives',
  'evidenceLocators',
};

bool _exactKeys(Map<String, Object?> value, Set<String> keys) =>
    value.keys.toSet().containsAll(keys) &&
    value.keys.toSet().length == keys.length;

String _text(Object? value, String code, {int maximum = 4096}) {
  if (value is! String || value.isEmpty || value.length > maximum) {
    throw FormatException(code);
  }
  return value;
}

int _count(Object? value, String code, {int maximum = 100000}) {
  if (value is! int || value < 0 || value > maximum) {
    throw FormatException(code);
  }
  return value;
}

final class PersonalOwnerTestShadowDto {
  const PersonalOwnerTestShadowDto({
    required this.jobId,
    required this.state,
    required this.duplicate,
    required this.observation,
    required this.errorCategory,
  });

  factory PersonalOwnerTestShadowDto.fromJson(Object? value) {
    if (value is! Map<String, Object?> || !_exactKeys(value, _resultKeys)) {
      throw const FormatException('Invalid personal test shadow result.');
    }
    final String jobId = _text(value['jobId'], 'Invalid job id.');
    final String state = _text(value['state'], 'Invalid job state.');
    const Set<String> states = <String>{
      'PENDING',
      'RUNNING',
      'RECOVERABLE',
      'RECONCILIATION_REQUIRED',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
    };
    final Object? duplicate = value['duplicate'];
    final Object? errorCategory = value['errorCategory'];
    if (!_ulidPattern.hasMatch(jobId) ||
        !states.contains(state) ||
        duplicate is! bool ||
        (errorCategory != null &&
            (errorCategory is! String ||
                !RegExp(r'^[A-Z0-9_.:-]{1,96}$').hasMatch(errorCategory)))) {
      throw const FormatException('Invalid personal test shadow result.');
    }
    final Object? rawObservation = value['observation'];
    final PersonalOwnerTestShadowObservation? observation =
        rawObservation == null
        ? null
        : PersonalOwnerTestShadowObservation.fromJson(rawObservation);
    if (state == 'COMPLETED' && observation == null) {
      throw const FormatException('Completed job has no observation.');
    }
    return PersonalOwnerTestShadowDto(
      jobId: jobId,
      state: state,
      duplicate: duplicate,
      observation: observation,
      errorCategory: errorCategory as String?,
    );
  }

  final String jobId;
  final String state;
  final bool duplicate;
  final PersonalOwnerTestShadowObservation? observation;
  final String? errorCategory;
}

final class PersonalOwnerTestSafeFact {
  const PersonalOwnerTestSafeFact({
    required this.kind,
    required this.valueSha256,
    required this.evidenceBlockIds,
    required this.support,
    required this.normalizedValue,
    required this.timeRule,
    required this.timeUncertainty,
  });

  factory PersonalOwnerTestSafeFact.fromJson(Object? value) {
    const Set<String> keys = <String>{
      'kind',
      'valueSha256',
      'evidenceBlockIds',
      'support',
      'normalizedTime',
    };
    if (value is! Map<String, Object?> || !_exactKeys(value, keys)) {
      throw const FormatException('Invalid sanitized fact.');
    }
    final String kind = _text(value['kind'], 'Invalid fact kind.', maximum: 48);
    final String valueSha256 = _text(
      value['valueSha256'],
      'Invalid fact hash.',
    );
    final Object? rawBlockIds = value['evidenceBlockIds'];
    final String support = _text(value['support'], 'Invalid fact support.');
    final Object? rawTime = value['normalizedTime'];
    if (!_hashPattern.hasMatch(valueSha256) ||
        !RegExp(r'^[a-z_]{1,48}$').hasMatch(kind) ||
        rawBlockIds is! List<Object?> ||
        rawBlockIds.length > 4 ||
        !<String>{
          'SUPPORTED_DIRECT',
          'SUPPORTED_NORMALIZED',
          'UNSUPPORTED',
          'AMBIGUOUS_SUPPORT',
        }.contains(support)) {
      throw const FormatException('Invalid sanitized fact.');
    }
    final List<String> blockIds = rawBlockIds
        .map((Object? item) {
          final String blockId = _text(
            item,
            'Invalid evidence block id.',
            maximum: 4,
          );
          if (!RegExp(r'^B\d{3}$').hasMatch(blockId)) {
            throw const FormatException('Invalid evidence block id.');
          }
          return blockId;
        })
        .toList(growable: false);
    String? normalizedValue;
    String? timeRule;
    String? timeUncertainty;
    if (rawTime != null) {
      const Set<String> timeKeys = <String>{
        'normalizedValue',
        'rule',
        'uncertainty',
      };
      if (rawTime is! Map<String, Object?> || !_exactKeys(rawTime, timeKeys)) {
        throw const FormatException('Invalid normalized time.');
      }
      final Object? rawValue = rawTime['normalizedValue'];
      final Object? rawRule = rawTime['rule'];
      final String uncertainty = _text(
        rawTime['uncertainty'],
        'Invalid time uncertainty.',
        maximum: 48,
      );
      if ((rawValue != null &&
              (rawValue is! String ||
                  !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(rawValue))) ||
          (rawRule != null &&
              (rawRule is! String ||
                  !RegExp(r'^[A-Z_]{1,48}$').hasMatch(rawRule))) ||
          !RegExp(r'^[A-Z_]{1,48}$').hasMatch(uncertainty)) {
        throw const FormatException('Invalid normalized time.');
      }
      normalizedValue = rawValue as String?;
      timeRule = rawRule as String?;
      timeUncertainty = uncertainty;
    }
    return PersonalOwnerTestSafeFact(
      kind: kind,
      valueSha256: valueSha256,
      evidenceBlockIds: blockIds,
      support: support,
      normalizedValue: normalizedValue,
      timeRule: timeRule,
      timeUncertainty: timeUncertainty,
    );
  }

  final String kind;
  final String valueSha256;
  final List<String> evidenceBlockIds;
  final String support;
  final String? normalizedValue;
  final String? timeRule;
  final String? timeUncertainty;
}

final class PersonalOwnerTestSafeSemanticDerivatives {
  const PersonalOwnerTestSafeSemanticDerivatives({
    required this.eventCandidate,
    required this.missingOrUncertainCount,
    required this.facts,
  });

  factory PersonalOwnerTestSafeSemanticDerivatives.fromJson(Object? value) {
    const Set<String> keys = <String>{
      'eventCandidate',
      'missingOrUncertainCount',
      'facts',
    };
    if (value is! Map<String, Object?> || !_exactKeys(value, keys)) {
      throw const FormatException('Invalid sanitized derivatives.');
    }
    final String eventCandidate = _text(
      value['eventCandidate'],
      'Invalid event candidate.',
    );
    final Object? rawFacts = value['facts'];
    if (!<String>{'TRUE', 'FALSE', 'UNCERTAIN'}.contains(eventCandidate) ||
        rawFacts is! List<Object?> ||
        rawFacts.length > 30) {
      throw const FormatException('Invalid sanitized derivatives.');
    }
    return PersonalOwnerTestSafeSemanticDerivatives(
      eventCandidate: eventCandidate,
      missingOrUncertainCount: _count(
        value['missingOrUncertainCount'],
        'Invalid uncertainty count.',
        maximum: 100,
      ),
      facts: rawFacts
          .map(PersonalOwnerTestSafeFact.fromJson)
          .toList(growable: false),
    );
  }

  final String eventCandidate;
  final int missingOrUncertainCount;
  final List<PersonalOwnerTestSafeFact> facts;
}

final class PersonalOwnerTestEvidenceLocator {
  const PersonalOwnerTestEvidenceLocator({
    required this.blockId,
    required this.field,
    required this.start,
    required this.end,
    required this.sourceSha256,
    required this.spanSha256,
  });

  factory PersonalOwnerTestEvidenceLocator.fromJson(Object? value) {
    const Set<String> keys = <String>{
      'blockId',
      'field',
      'start',
      'end',
      'sourceSha256',
      'spanSha256',
    };
    if (value is! Map<String, Object?> || !_exactKeys(value, keys)) {
      throw const FormatException('Invalid evidence locator.');
    }
    final String blockId = _text(value['blockId'], 'Invalid evidence locator.');
    final String field = _text(value['field'], 'Invalid evidence locator.');
    final String sourceSha256 = _text(
      value['sourceSha256'],
      'Invalid evidence hash.',
    );
    final String spanSha256 = _text(
      value['spanSha256'],
      'Invalid evidence hash.',
    );
    final int start = _count(value['start'], 'Invalid evidence offset.');
    final int end = _count(value['end'], 'Invalid evidence offset.');
    if (blockId != 'B001' ||
        field != 'title' ||
        end <= start ||
        !_hashPattern.hasMatch(sourceSha256) ||
        !_hashPattern.hasMatch(spanSha256)) {
      throw const FormatException('Invalid evidence locator.');
    }
    return PersonalOwnerTestEvidenceLocator(
      blockId: blockId,
      field: field,
      start: start,
      end: end,
      sourceSha256: sourceSha256,
      spanSha256: spanSha256,
    );
  }

  final String blockId;
  final String field;
  final int start;
  final int end;
  final String sourceSha256;
  final String spanSha256;
}

final class PersonalOwnerTestShadowObservation {
  const PersonalOwnerTestShadowObservation({
    required this.providerRunId,
    required this.projectionSha256,
    required this.schemaSha256,
    required this.skillSha256,
    required this.derivativeSha256,
    required this.applicability,
    required this.eventNuggetCount,
    required this.factCount,
    required this.groundedFactCount,
    required this.unsupportedFactCount,
    required this.validEvidenceReferenceCount,
    required this.invalidEvidenceReferenceCount,
    required this.semanticDerivatives,
    required this.evidenceLocators,
  });

  factory PersonalOwnerTestShadowObservation.fromJson(Object? value) {
    if (value is! Map<String, Object?> ||
        !_exactKeys(value, _observationKeys)) {
      throw const FormatException('Invalid personal test shadow observation.');
    }
    final String providerRunId = _text(
      value['providerRunId'],
      'Invalid provider run.',
    );
    final String projectionSha256 = _text(
      value['projectionSha256'],
      'Invalid projection hash.',
    );
    final String schemaSha256 = _text(
      value['schemaSha256'],
      'Invalid schema hash.',
    );
    final String skillSha256 = _text(
      value['skillSha256'],
      'Invalid skill hash.',
    );
    final String derivativeSha256 = _text(
      value['derivativeSha256'],
      'Invalid derivative hash.',
    );
    final String applicability = _text(
      value['applicability'],
      'Invalid applicability.',
    );
    final int eventNuggetCount = _count(
      value['eventNuggetCount'],
      'Invalid nugget count.',
      maximum: 3,
    );
    final int factCount = _count(
      value['factCount'],
      'Invalid fact count.',
      maximum: 30,
    );
    final int groundedFactCount = _count(
      value['groundedFactCount'],
      'Invalid grounded fact count.',
      maximum: 30,
    );
    final int unsupportedFactCount = _count(
      value['unsupportedFactCount'],
      'Invalid unsupported fact count.',
      maximum: 30,
    );
    final int validRefs = _count(
      value['validEvidenceReferenceCount'],
      'Invalid evidence count.',
      maximum: 120,
    );
    final int invalidRefs = _count(
      value['invalidEvidenceReferenceCount'],
      'Invalid evidence count.',
      maximum: 120,
    );
    final Object? rawLocators = value['evidenceLocators'];
    if (!_providerRunPattern.hasMatch(providerRunId) ||
        !_hashPattern.hasMatch(projectionSha256) ||
        !_hashPattern.hasMatch(schemaSha256) ||
        !_hashPattern.hasMatch(skillSha256) ||
        !_hashPattern.hasMatch(derivativeSha256) ||
        !<String>{
          'OBSERVATION_AVAILABLE',
          'INSUFFICIENT_EVIDENCE',
          'NOT_APPLICABLE',
          'AMBIGUOUS',
        }.contains(applicability) ||
        groundedFactCount > factCount ||
        unsupportedFactCount > factCount ||
        rawLocators is! List<Object?> ||
        rawLocators.length > 120) {
      throw const FormatException('Invalid personal test shadow observation.');
    }
    return PersonalOwnerTestShadowObservation(
      providerRunId: providerRunId,
      projectionSha256: projectionSha256,
      schemaSha256: schemaSha256,
      skillSha256: skillSha256,
      derivativeSha256: derivativeSha256,
      applicability: applicability,
      eventNuggetCount: eventNuggetCount,
      factCount: factCount,
      groundedFactCount: groundedFactCount,
      unsupportedFactCount: unsupportedFactCount,
      validEvidenceReferenceCount: validRefs,
      invalidEvidenceReferenceCount: invalidRefs,
      semanticDerivatives: PersonalOwnerTestSafeSemanticDerivatives.fromJson(
        value['semanticDerivatives'],
      ),
      evidenceLocators: rawLocators
          .map(PersonalOwnerTestEvidenceLocator.fromJson)
          .toList(growable: false),
    );
  }

  final String providerRunId;
  final String projectionSha256;
  final String schemaSha256;
  final String skillSha256;
  final String derivativeSha256;
  final String applicability;
  final int eventNuggetCount;
  final int factCount;
  final int groundedFactCount;
  final int unsupportedFactCount;
  final int validEvidenceReferenceCount;
  final int invalidEvidenceReferenceCount;
  final PersonalOwnerTestSafeSemanticDerivatives semanticDerivatives;
  final List<PersonalOwnerTestEvidenceLocator> evidenceLocators;
}

final class PersonalOwnerTestArticleDto {
  const PersonalOwnerTestArticleDto({
    required this.fixtureId,
    required this.sourceId,
    required this.articleId,
    required this.articleVersionId,
    required this.projectionVersionId,
    required this.projectionSha256,
    required this.titleSha256,
    required this.title,
    required this.publisher,
    required this.publishedAt,
    required this.acquisitionMode,
  });

  factory PersonalOwnerTestArticleDto.fromJson(Object? value) {
    if (value is! Map<String, Object?> || !_exactKeys(value, _articleKeys)) {
      throw const FormatException('Invalid synthetic Article.');
    }
    final dto = PersonalOwnerTestArticleDto(
      fixtureId: _text(value['fixtureId'], 'Invalid fixture id.'),
      sourceId: _text(value['sourceId'], 'Invalid Source id.'),
      articleId: _text(value['articleId'], 'Invalid Article id.'),
      articleVersionId: _text(
        value['articleVersionId'],
        'Invalid Article version.',
      ),
      projectionVersionId: _text(
        value['projectionVersionId'],
        'Invalid projection version.',
      ),
      projectionSha256: _text(
        value['projectionSha256'],
        'Invalid projection hash.',
      ),
      titleSha256: _text(value['titleSha256'], 'Invalid title hash.'),
      title: _text(value['title'], 'Invalid fixture title.'),
      publisher: _text(value['publisher'], 'Invalid publisher.'),
      publishedAt: _text(value['publishedAt'], 'Invalid publication date.'),
      acquisitionMode: _text(
        value['acquisitionMode'],
        'Invalid acquisition mode.',
      ),
    );
    if (dto.fixtureId != 'synthetic-govuk-title-only-v1' ||
        !_ulidPattern.hasMatch(dto.sourceId) ||
        !_ulidPattern.hasMatch(dto.articleId) ||
        !_ulidPattern.hasMatch(dto.articleVersionId) ||
        !_ulidPattern.hasMatch(dto.projectionVersionId) ||
        !_hashPattern.hasMatch(dto.projectionSha256) ||
        !_hashPattern.hasMatch(dto.titleSha256) ||
        dto.publisher != 'Regulator of Social Housing' ||
        dto.acquisitionMode != 'SYNTHETIC_LOOPBACK_FIXTURE' ||
        DateTime.tryParse(dto.publishedAt) == null) {
      throw const FormatException('Invalid synthetic Article.');
    }
    return dto;
  }

  final String fixtureId;
  final String sourceId;
  final String articleId;
  final String articleVersionId;
  final String projectionVersionId;
  final String projectionSha256;
  final String titleSha256;
  final String title;
  final String publisher;
  final String publishedAt;
  final String acquisitionMode;
}

final class PersonalOwnerTestAuthorization {
  const PersonalOwnerTestAuthorization({
    required this.id,
    required this.operation,
    required this.validFrom,
    required this.expiresAt,
  });

  factory PersonalOwnerTestAuthorization.fromJson(Object? value) {
    if (value is! Map<String, Object?> ||
        !_exactKeys(value, _authorizationKeys)) {
      throw const FormatException('Invalid test authorization.');
    }
    final String id = _text(value['id'], 'Invalid authorization id.');
    final String operation = _text(
      value['operation'],
      'Invalid authorization operation.',
    );
    final String validFrom = _text(
      value['validFrom'],
      'Invalid authorization start.',
    );
    final String expiresAt = _text(
      value['expiresAt'],
      'Invalid authorization expiry.',
    );
    if (!_ulidPattern.hasMatch(id) ||
        !<String>{
          'MOCKED_TITLE_ONLY_INFERENCE',
          'MOCKED_DERIVED_SHADOW_PERSISTENCE',
        }.contains(operation) ||
        DateTime.tryParse(validFrom) == null ||
        DateTime.tryParse(expiresAt) == null) {
      throw const FormatException('Invalid test authorization.');
    }
    return PersonalOwnerTestAuthorization(
      id: id,
      operation: operation,
      validFrom: validFrom,
      expiresAt: expiresAt,
    );
  }

  final String id;
  final String operation;
  final String validFrom;
  final String expiresAt;
}

final class PersonalOwnerTestAuthorizationList {
  const PersonalOwnerTestAuthorizationList({
    required this.ownerIdentity,
    required this.sourceId,
    required this.articleId,
    required this.articleVersionId,
    required this.projectionVersionId,
    required this.projectionSha256,
    required this.provider,
    required this.model,
    required this.authorizations,
  });

  factory PersonalOwnerTestAuthorizationList.fromJson(Object? value) {
    if (value is! Map<String, Object?> ||
        !_exactKeys(value, _authorizationListKeys)) {
      throw const FormatException('Invalid authorization list.');
    }
    final String ownerIdentity = _text(
      value['ownerIdentity'],
      'Invalid owner identity.',
    );
    final String sourceId = _text(value['sourceId'], 'Invalid Source id.');
    final String articleId = _text(value['articleId'], 'Invalid Article id.');
    final String versionId = _text(
      value['articleVersionId'],
      'Invalid Article version.',
    );
    final String projectionVersionId = _text(
      value['projectionVersionId'],
      'Invalid projection version.',
    );
    final String projectionSha256 = _text(
      value['projectionSha256'],
      'Invalid projection hash.',
    );
    final String provider = _text(value['provider'], 'Invalid provider.');
    final String model = _text(value['model'], 'Invalid model.');
    final Object? rawAuthorizations = value['authorizations'];
    if (!RegExp(
          r'^synthetic-owner-[A-Za-z0-9_.:-]{1,48}$',
        ).hasMatch(ownerIdentity) ||
        !_ulidPattern.hasMatch(sourceId) ||
        !_ulidPattern.hasMatch(articleId) ||
        !_ulidPattern.hasMatch(versionId) ||
        !_ulidPattern.hasMatch(projectionVersionId) ||
        !_hashPattern.hasMatch(projectionSha256) ||
        provider != 'llm_cloudflare_workers_ai' ||
        model != '@cf/openai/gpt-oss-20b' ||
        rawAuthorizations is! List<Object?> ||
        rawAuthorizations.length > 16) {
      throw const FormatException('Invalid authorization list.');
    }
    return PersonalOwnerTestAuthorizationList(
      ownerIdentity: ownerIdentity,
      sourceId: sourceId,
      articleId: articleId,
      articleVersionId: versionId,
      projectionVersionId: projectionVersionId,
      projectionSha256: projectionSha256,
      provider: provider,
      model: model,
      authorizations: rawAuthorizations
          .map(PersonalOwnerTestAuthorization.fromJson)
          .toList(growable: false),
    );
  }

  final String ownerIdentity;
  final String sourceId;
  final String articleId;
  final String articleVersionId;
  final String projectionVersionId;
  final String projectionSha256;
  final String provider;
  final String model;
  final List<PersonalOwnerTestAuthorization> authorizations;
}

abstract interface class PersonalOwnerTestShadowRepository {
  Future<PersonalOwnerTestShadowDto> getJob(String jobId, String ownerToken);
  Future<PersonalOwnerTestArticleDto> ingestArticle(String ownerToken);
  Future<List<PersonalOwnerTestArticleDto>> listArticles(String ownerToken);
  Future<PersonalOwnerTestAuthorizationList> listAuthorizations(
    String ownerToken,
  );
  Future<PersonalOwnerTestShadowDto> startJob({
    required PersonalOwnerTestArticleDto article,
    required PersonalOwnerTestAuthorizationList authorization,
    required String ownerToken,
    required String idempotencyKey,
  });
  Future<PersonalOwnerTestShadowDto> cancelJob(String jobId, String ownerToken);
}

final class PersonalOwnerTestShadowClient
    implements PersonalOwnerTestShadowRepository {
  PersonalOwnerTestShadowClient({
    required ApiConfiguration configuration,
    http.Client? httpClient,
    this.timeout = const Duration(seconds: 10),
  }) : _configuration = configuration,
       _httpClient = httpClient ?? http.Client(),
       _ownsClient = httpClient == null {
    final Uri baseUri = configuration.baseUri;
    if (baseUri.scheme != 'http' ||
        !const <String>{
          '127.0.0.1',
          'localhost',
          '::1',
        }.contains(baseUri.host)) {
      throw ArgumentError(
        'Personal owner test shadow requires a loopback API.',
      );
    }
  }

  final ApiConfiguration _configuration;
  final http.Client _httpClient;
  final bool _ownsClient;
  final Duration timeout;

  Map<String, String> _headers(String ownerToken) {
    if (!RegExp(r'^[A-Za-z0-9._~-]{32,2048}$').hasMatch(ownerToken)) {
      throw const PersonalOwnerTestShadowFailure();
    }
    return <String, String>{
      'Accept': 'application/json',
      'Cache-Control': 'no-store',
      'Authorization': 'Bearer $ownerToken',
    };
  }

  Future<http.Response> _send(
    Future<http.Response> Function() operation,
  ) async {
    try {
      final http.Response response = await operation().timeout(timeout);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw const PersonalOwnerTestShadowFailure();
      }
      return response;
    } on TimeoutException {
      throw const PersonalOwnerTestShadowFailure();
    } on FormatException {
      throw const PersonalOwnerTestShadowFailure();
    } on http.ClientException {
      throw const PersonalOwnerTestShadowFailure();
    }
  }

  @override
  Future<PersonalOwnerTestShadowDto> getJob(
    String jobId,
    String ownerToken,
  ) async {
    if (!_ulidPattern.hasMatch(jobId)) {
      throw const PersonalOwnerTestShadowFailure();
    }
    final http.Response response = await _send(
      () => _httpClient.get(
        _configuration.resolve('/personal/owner/test/jobs/$jobId'),
        headers: _headers(ownerToken),
      ),
    );
    return PersonalOwnerTestShadowDto.fromJson(jsonDecode(response.body));
  }

  @override
  Future<PersonalOwnerTestArticleDto> ingestArticle(String ownerToken) async {
    final http.Response response = await _send(
      () => _httpClient.post(
        _configuration.resolve('/personal/owner/test/articles/ingest'),
        headers: _headers(ownerToken),
      ),
    );
    return PersonalOwnerTestArticleDto.fromJson(jsonDecode(response.body));
  }

  @override
  Future<List<PersonalOwnerTestArticleDto>> listArticles(
    String ownerToken,
  ) async {
    final http.Response response = await _send(
      () => _httpClient.get(
        _configuration.resolve('/personal/owner/test/articles'),
        headers: _headers(ownerToken),
      ),
    );
    final Object? decoded = jsonDecode(response.body);
    if (decoded is! List<Object?> || decoded.length > 1) {
      throw const PersonalOwnerTestShadowFailure();
    }
    return decoded
        .map(PersonalOwnerTestArticleDto.fromJson)
        .toList(growable: false);
  }

  @override
  Future<PersonalOwnerTestAuthorizationList> listAuthorizations(
    String ownerToken,
  ) async {
    final http.Response response = await _send(
      () => _httpClient.get(
        _configuration.resolve('/personal/owner/test/authorizations'),
        headers: _headers(ownerToken),
      ),
    );
    return PersonalOwnerTestAuthorizationList.fromJson(
      jsonDecode(response.body),
    );
  }

  @override
  Future<PersonalOwnerTestShadowDto> startJob({
    required PersonalOwnerTestArticleDto article,
    required PersonalOwnerTestAuthorizationList authorization,
    required String ownerToken,
    required String idempotencyKey,
  }) async {
    final http.Response response = await _send(
      () => _httpClient.post(
        _configuration.resolve('/personal/owner/test/jobs'),
        headers: <String, String>{
          ..._headers(ownerToken),
          'Content-Type': 'application/json',
        },
        body: jsonEncode(<String, Object>{
          'fixtureId': article.fixtureId,
          'idempotencyKey': idempotencyKey,
          'inferenceAuthorizationId': _authorizationId(
            authorization,
            'MOCKED_TITLE_ONLY_INFERENCE',
          ),
          'persistenceAuthorizationId': _authorizationId(
            authorization,
            'MOCKED_DERIVED_SHADOW_PERSISTENCE',
          ),
          'ownerIdentity': authorization.ownerIdentity,
          'sourceId': article.sourceId,
          'articleId': article.articleId,
          'articleVersionId': article.articleVersionId,
          'projectionVersionId': article.projectionVersionId,
          'projectionSha256': article.projectionSha256,
        }),
      ),
    );
    return PersonalOwnerTestShadowDto.fromJson(jsonDecode(response.body));
  }

  String _authorizationId(
    PersonalOwnerTestAuthorizationList authorization,
    String operation,
  ) {
    final List<PersonalOwnerTestAuthorization> matches = authorization
        .authorizations
        .where(
          (PersonalOwnerTestAuthorization item) => item.operation == operation,
        )
        .toList(growable: false);
    if (matches.isEmpty) throw const PersonalOwnerTestShadowFailure();
    return matches.first.id;
  }

  @override
  Future<PersonalOwnerTestShadowDto> cancelJob(
    String jobId,
    String ownerToken,
  ) async {
    if (!_ulidPattern.hasMatch(jobId)) {
      throw const PersonalOwnerTestShadowFailure();
    }
    final http.Response response = await _send(
      () => _httpClient.post(
        _configuration.resolve('/personal/owner/test/jobs/$jobId/cancel'),
        headers: _headers(ownerToken),
      ),
    );
    return PersonalOwnerTestShadowDto.fromJson(jsonDecode(response.body));
  }

  void close() {
    if (_ownsClient) _httpClient.close();
  }
}

final class PersonalOwnerTestShadowFailure implements Exception {
  const PersonalOwnerTestShadowFailure();
}
