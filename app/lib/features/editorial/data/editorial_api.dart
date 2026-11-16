import 'dart:convert';
import 'dart:math';

import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:http/http.dart' as http;

typedef EditorialTokenProvider = Future<String?> Function();

final class EditorialSession {
  const EditorialSession({
    required this.userId,
    required this.role,
    required this.singleEditorEnabled,
  });

  final String userId;
  final String role;
  final bool singleEditorEnabled;

  bool get canPropose => role == 'moderator' || singleEditorEnabled;
  bool get canConfirm => role == 'editor';
}

final class EditorialFailure implements Exception {
  const EditorialFailure(this.message);

  final String message;
}

/// Authenticated transport for the editorial review queue.
final class EditorialApi {
  EditorialApi({
    required this.configuration,
    required this.tokenProvider,
    http.Client? httpClient,
  }) : _httpClient = httpClient ?? http.Client(),
       _ownsClient = httpClient == null;

  final ApiConfiguration configuration;
  final EditorialTokenProvider tokenProvider;
  final http.Client _httpClient;
  final bool _ownsClient;

  Future<EditorialSession?> session() async {
    try {
      final Object? value = await _request('GET', '/v1/mod/session');
      final Map<String, Object?> data = _object(value);
      final Object? userId = data['userId'];
      final Object? role = data['role'];
      final Object? enabled = data['singleEditorEnabled'];
      if (userId is! String ||
          !_isUlid(userId) ||
          role is! String ||
          !const <String>{'editor', 'moderator'}.contains(role) ||
          enabled is! bool) {
        return null;
      }
      return EditorialSession(
        userId: userId,
        role: role,
        singleEditorEnabled: enabled,
      );
    } on Object {
      // Editorial access is optional and must not prevent consumer sign-in.
      return null;
    }
  }

  Future<List<Map<String, Object?>>> tasks() async {
    final Object? value = await _request('GET', '/v1/mod/tasks');
    if (value is! List) {
      throw const EditorialFailure('No se pudo leer la lista de revisiones.');
    }
    return value.map(_object).toList(growable: false);
  }

  /// Returns null while the server has not enabled title analysis yet.
  Future<List<Map<String, Object?>>?> headlineReviews() async {
    final Object? value = await _request(
      'GET',
      '/v1/mod/headline-reviews',
      allowNotFound: true,
    );
    if (value == null) return null;
    if (value is! List) {
      throw const EditorialFailure('No se pudo leer la revisión de titulares.');
    }
    return value.map(_object).toList(growable: false);
  }

  Future<Map<String, Object?>> analyzeHeadline() async => _object(
    await _request(
      'POST',
      '/v1/mod/headline-reviews/analyze',
      body: const <String, Object?>{},
      timeout: const Duration(seconds: 70),
    ),
  );

  Future<List<Map<String, Object?>>?> contextPairs() async {
    final Object? value = await _request(
      'GET',
      '/v1/mod/headline-context-pairs',
      allowNotFound: true,
    );
    if (value == null) return null;
    if (value is! List) {
      throw const EditorialFailure(
        'No se pudo leer la comparación entre fuentes.',
      );
    }
    return value.map(_object).toList(growable: false);
  }

  Future<Map<String, Object?>> analyzeContextPair() async => _object(
    await _request(
      'POST',
      '/v1/mod/headline-context-pairs/analyze',
      body: const <String, Object?>{},
      timeout: const Duration(seconds: 70),
    ),
  );

  Future<void> decideContextPair(String attemptId, String decision) async {
    _requireUlid(attemptId);
    if (!const <String>{
      'KEEP_FOR_REVIEW',
      'NEEDS_EVIDENCE',
      'DISMISS',
    }.contains(decision)) {
      throw const EditorialFailure('La decisión editorial no es válida.');
    }
    await _request(
      'POST',
      '/v1/mod/headline-context-pairs/$attemptId/decision',
      body: <String, Object?>{'decision': decision},
    );
  }

  Future<List<Map<String, Object?>>> headlineSources() async {
    final Object? value = await _request(
      'GET',
      '/v1/mod/headline-reviews/sources',
    );
    if (value is! List) {
      throw const EditorialFailure('No se pudo leer la lista de fuentes.');
    }
    return value.map(_object).toList(growable: false);
  }

  Future<void> setHeadlineSource(
    String sourceId, {
    required bool enabled,
  }) async {
    _requireUlid(sourceId);
    await _request(
      'POST',
      '/v1/mod/headline-reviews/sources/$sourceId/grant',
      body: <String, Object?>{'action': enabled ? 'ENABLE' : 'REVOKE'},
    );
  }

  Future<void> decideHeadline(String attemptId, String decision) async {
    _requireUlid(attemptId);
    if (!const <String>{
      'ACCEPT_FOR_GROUPING',
      'NEEDS_EVIDENCE',
      'REJECT',
    }.contains(decision)) {
      throw const EditorialFailure('La decisión editorial no es válida.');
    }
    await _request(
      'POST',
      '/v1/mod/headline-reviews/$attemptId/decision',
      body: <String, Object?>{'decision': decision},
    );
  }

  Future<Map<String, Object?>> task(String taskId) async {
    _requireUlid(taskId);
    return _object(await _request('GET', '/v1/mod/tasks/$taskId'));
  }

  Future<void> claim(String taskId) =>
      _command(taskId, 'claim', const <String, Object?>{});

  Future<void> release(String taskId) =>
      _command(taskId, 'release', const <String, Object?>{});

  Future<void> acceptSubset(String taskId, List<String> assertionIds) =>
      _command(taskId, 'proposals', <String, Object?>{
        'outcome': 'accept_subset',
        'assertionIds': assertionIds,
      });

  Future<void> split(String taskId, List<List<String>> partitions) => _command(
    taskId,
    'proposals',
    <String, Object?>{'outcome': 'split', 'partitions': partitions},
  );

  Future<void> confirm(String taskId, String proposalId) {
    _requireUlid(proposalId);
    return _command(
      taskId,
      'proposals/$proposalId/confirm',
      const <String, Object?>{},
    );
  }

  Future<void> refuse(String taskId, String proposalId, String reason) {
    _requireUlid(proposalId);
    return _command(taskId, 'proposals/$proposalId/refuse', <String, Object?>{
      'reason': reason,
    });
  }

  Future<void> _command(
    String taskId,
    String action,
    Map<String, Object?> body,
  ) async {
    _requireUlid(taskId);
    await _request('POST', '/v1/mod/tasks/$taskId/$action', body: body);
  }

  Future<Object?> _request(
    String method,
    String path, {
    Map<String, Object?>? body,
    bool allowNotFound = false,
    Duration timeout = const Duration(seconds: 15),
  }) async {
    try {
      final String? token = await tokenProvider();
      if (token == null || token.isEmpty) {
        throw const EditorialFailure('La sesión editorial ha expirado.');
      }
      final Uri uri = configuration.resolve(path);
      final Map<String, String> headers = <String, String>{
        'authorization': 'Bearer $token',
        'accept': 'application/json',
        if (method == 'POST') 'content-type': 'application/json',
        if (method == 'POST') 'idempotency-key': _newUlid(),
      };
      final http.Response response =
          await (method == 'GET'
                  ? _httpClient.get(uri, headers: headers)
                  : _httpClient.post(
                      uri,
                      headers: headers,
                      body: jsonEncode(body),
                    ))
              .timeout(timeout);
      if (response.statusCode == 404 && allowNotFound) return null;
      if (response.statusCode == 401 || response.statusCode == 403) {
        throw const EditorialFailure(
          'Esta cuenta ya no tiene acceso a la revisión editorial.',
        );
      }
      if (response.statusCode == 409) {
        throw const EditorialFailure(
          'La revisión cambió. Actualiza la pantalla antes de continuar.',
        );
      }
      if (response.statusCode == 503) {
        throw const EditorialFailure(
          'La edición aún no está disponible. Inténtalo más tarde.',
        );
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw const EditorialFailure(
          'No se pudo completar la acción editorial.',
        );
      }
      return jsonDecode(response.body);
    } on EditorialFailure {
      rethrow;
    } on Object {
      throw const EditorialFailure(
        'No se pudo conectar con la revisión editorial.',
      );
    }
  }

  void close() {
    if (_ownsClient) _httpClient.close();
  }
}

Map<String, Object?> _object(Object? value) {
  if (value is! Map<String, Object?>) {
    throw const EditorialFailure(
      'La respuesta editorial no tiene el formato esperado.',
    );
  }
  return value;
}

bool _isUlid(String value) =>
    RegExp(r'^[0-7][0-9A-HJKMNP-TV-Z]{25}$').hasMatch(value);

void _requireUlid(String value) {
  if (!_isUlid(value)) {
    throw const EditorialFailure(
      'La revisión no tiene un identificador válido.',
    );
  }
}

String _newUlid() {
  final int timestamp = DateTime.now().millisecondsSinceEpoch;
  final Random random = Random.secure();
  BigInt value = BigInt.from(timestamp);
  for (int i = 0; i < 10; i += 1) {
    value = (value << 8) | BigInt.from(random.nextInt(256));
  }
  const String alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  final List<String> digits = List<String>.filled(26, '0');
  for (int i = 25; i >= 0; i -= 1) {
    digits[i] = alphabet[(value & BigInt.from(31)).toInt()];
    value >>= 5;
  }
  return digits.join();
}
