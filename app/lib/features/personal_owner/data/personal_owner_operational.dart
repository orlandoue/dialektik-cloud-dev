import 'dart:async';
import 'dart:convert';

import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:http/http.dart' as http;

typedef OwnerJson = Map<String, Object?>;

OwnerJson _asJson(Object? value) {
  if (value is! Map<String, Object?>) {
    throw const FormatException('Invalid personal owner response.');
  }
  return value;
}

List<OwnerJson> _items(Object? value) {
  final OwnerJson response = _asJson(value);
  final Object? rawItems = response['items'];
  if (rawItems is! List<Object?>) {
    throw const FormatException('Invalid personal owner collection.');
  }
  return rawItems.map(_asJson).toList(growable: false);
}

abstract interface class PersonalOwnerOperationalRepository {
  Future<List<OwnerJson>> sources(String token);
  Future<OwnerJson> registerSource(String token, OwnerJson body);
  Future<OwnerJson> recordRightsDecision(
    String token,
    String sourceId,
    OwnerJson body,
  );
  Future<OwnerJson> recordSourceConnection(
    String token,
    String sourceId,
    OwnerJson body,
  );
  Future<OwnerJson> acquireSource(String token, String sourceId);
  Future<List<OwnerJson>> articles(String token, {String? sourceId});
  Future<List<OwnerJson>> officialVoteEvents(String token, {String? sourceId});
  Future<OwnerJson> acquireOfficialVoteEvent(
    String token,
    String sourceId,
    String voteId,
  );
  Future<OwnerJson> budget(String token);
  Future<OwnerJson> configureBudget(String token, OwnerJson body);
  Future<OwnerJson> emergencyStop(String token);
  Future<OwnerJson> recordModelPrice(String token, OwnerJson body);
  Future<OwnerJson> recordProviderAuthorization(String token, OwnerJson body);
  Future<List<OwnerJson>> jobs(String token);
  Future<OwnerJson> job(String token, String jobId);
  Future<OwnerJson> submitJob(String token, String articleId, OwnerJson body);
  Future<OwnerJson> cancelJob(String token, String jobId);
  Future<OwnerJson> reconcileJob(String token, String jobId, OwnerJson body);
}

final class PersonalOwnerOperationalClient
    implements PersonalOwnerOperationalRepository {
  PersonalOwnerOperationalClient({
    required ApiConfiguration configuration,
    http.Client? httpClient,
    this.timeout = const Duration(seconds: 12),
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
        'Personal owner operations require a loopback HTTP API.',
      );
    }
  }

  final ApiConfiguration _configuration;
  final http.Client _httpClient;
  final bool _ownsClient;
  final Duration timeout;

  Future<Object?> _request(
    String token,
    String method,
    String path, {
    OwnerJson? body,
  }) async {
    if (!RegExp(r'^[A-Za-z0-9._~-]{32,2048}$').hasMatch(token)) {
      throw const PersonalOwnerOperationalFailure(
        'Owner authentication is required.',
      );
    }
    final Uri uri = _configuration.resolve(path);
    final Map<String, String> headers = <String, String>{
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
      if (body != null) 'Content-Type': 'application/json',
    };
    try {
      final http.Response response;
      switch (method) {
        case 'GET':
          response = await _httpClient
              .get(uri, headers: headers)
              .timeout(timeout);
        case 'POST':
          response = await _httpClient
              .post(uri, headers: headers, body: jsonEncode(body))
              .timeout(timeout);
        case 'PUT':
          response = await _httpClient
              .put(uri, headers: headers, body: jsonEncode(body))
              .timeout(timeout);
        case 'DELETE':
          response = await _httpClient
              .delete(uri, headers: headers)
              .timeout(timeout);
        default:
          throw StateError('Unsupported request method.');
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        try {
          final Object? decoded = jsonDecode(response.body);
          final Object? rawCode = decoded is Map<String, Object?>
              ? decoded['code']
              : null;
          if (rawCode is String &&
              RegExp(
                r'^PERSONAL_OWNER_[A-Z0-9_.:-]{1,120}$',
              ).hasMatch(rawCode)) {
            throw PersonalOwnerOperationalFailure(
              'Core bloqueó la operación: ${rawCode.substring('PERSONAL_OWNER_'.length)}.',
            );
          }
        } on FormatException {
          // Fall through to the safe, generic local-service error.
        }
        throw const PersonalOwnerOperationalFailure(
          'The local owner service rejected the request or is unavailable.',
        );
      }
      return jsonDecode(response.body);
    } on TimeoutException {
      throw const PersonalOwnerOperationalFailure(
        'The local owner service timed out.',
      );
    } on FormatException {
      throw const PersonalOwnerOperationalFailure(
        'The local owner service returned invalid data.',
      );
    } on http.ClientException {
      throw const PersonalOwnerOperationalFailure(
        'The local owner service is unavailable.',
      );
    }
  }

  String _path(String path) => '/personal/owner$path';

  @override
  Future<List<OwnerJson>> sources(String token) async =>
      _items(await _request(token, 'GET', _path('/sources')));

  @override
  Future<OwnerJson> registerSource(String token, OwnerJson body) async =>
      _asJson(await _request(token, 'POST', _path('/sources'), body: body));

  @override
  Future<OwnerJson> recordRightsDecision(
    String token,
    String sourceId,
    OwnerJson body,
  ) async => _asJson(
    await _request(
      token,
      'POST',
      _path('/sources/${Uri.encodeComponent(sourceId)}/rights-decisions'),
      body: body,
    ),
  );

  @override
  Future<OwnerJson> recordSourceConnection(
    String token,
    String sourceId,
    OwnerJson body,
  ) async => _asJson(
    await _request(
      token,
      'PUT',
      _path('/sources/${Uri.encodeComponent(sourceId)}/connection'),
      body: body,
    ),
  );

  @override
  Future<OwnerJson> acquireSource(String token, String sourceId) async =>
      _asJson(
        await _request(
          token,
          'POST',
          _path('/sources/${Uri.encodeComponent(sourceId)}/acquire'),
          body: <String, Object?>{},
        ),
      );

  @override
  Future<List<OwnerJson>> articles(String token, {String? sourceId}) async {
    final String path = sourceId == null
        ? _path('/articles')
        : '${_path('/articles')}?source_id=${Uri.encodeQueryComponent(sourceId)}';
    return _items(await _request(token, 'GET', path));
  }

  @override
  Future<List<OwnerJson>> officialVoteEvents(
    String token, {
    String? sourceId,
  }) async {
    final String path = sourceId == null
        ? _path('/official-votes')
        : '${_path('/official-votes')}?source_id=${Uri.encodeQueryComponent(sourceId)}';
    return _items(await _request(token, 'GET', path));
  }

  @override
  Future<OwnerJson> acquireOfficialVoteEvent(
    String token,
    String sourceId,
    String voteId,
  ) async => _asJson(
    await _request(
      token,
      'POST',
      _path(
        '/sources/${Uri.encodeComponent(sourceId)}/official-votes/${Uri.encodeComponent(voteId)}/acquire',
      ),
      body: <String, Object?>{},
    ),
  );

  @override
  Future<OwnerJson> budget(String token) async =>
      _asJson(await _request(token, 'GET', _path('/budget')));

  @override
  Future<OwnerJson> configureBudget(String token, OwnerJson body) async =>
      _asJson(await _request(token, 'PUT', _path('/budget'), body: body));

  @override
  Future<OwnerJson> emergencyStop(String token) async =>
      _asJson(await _request(token, 'POST', _path('/budget/emergency-stop')));

  @override
  Future<OwnerJson> recordModelPrice(String token, OwnerJson body) async =>
      _asJson(
        await _request(
          token,
          'POST',
          _path('/provider/model-prices'),
          body: body,
        ),
      );

  @override
  Future<OwnerJson> recordProviderAuthorization(
    String token,
    OwnerJson body,
  ) async => _asJson(
    await _request(
      token,
      'POST',
      _path('/provider/authorizations'),
      body: body,
    ),
  );

  @override
  Future<List<OwnerJson>> jobs(String token) async =>
      _items(await _request(token, 'GET', _path('/jobs')));

  @override
  Future<OwnerJson> job(String token, String jobId) async => _asJson(
    await _request(token, 'GET', _path('/jobs/${Uri.encodeComponent(jobId)}')),
  );

  @override
  Future<OwnerJson> submitJob(
    String token,
    String articleId,
    OwnerJson body,
  ) async => _asJson(
    await _request(
      token,
      'POST',
      _path('/articles/${Uri.encodeComponent(articleId)}/jobs'),
      body: body,
    ),
  );

  @override
  Future<OwnerJson> cancelJob(String token, String jobId) async => _asJson(
    await _request(
      token,
      'DELETE',
      _path('/jobs/${Uri.encodeComponent(jobId)}'),
    ),
  );

  @override
  Future<OwnerJson> reconcileJob(
    String token,
    String jobId,
    OwnerJson body,
  ) async => _asJson(
    await _request(
      token,
      'POST',
      _path('/jobs/${Uri.encodeComponent(jobId)}/reconciliation'),
      body: body,
    ),
  );

  void close() {
    if (_ownsClient) _httpClient.close();
  }
}

final class PersonalOwnerOperationalFailure implements Exception {
  const PersonalOwnerOperationalFailure(this.message);
  final String message;
}
