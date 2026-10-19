import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

final class SupabaseAuthFailure implements Exception {
  const SupabaseAuthFailure();
}

/// Transient transport failure; unlike a rejected refresh, it does not clear
/// an otherwise valid in-memory session.
final class SupabaseAuthNetworkFailure implements Exception {
  const SupabaseAuthNetworkFailure();
}

final class SupabaseAuthSession {
  const SupabaseAuthSession({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresAt,
  });

  factory SupabaseAuthSession.fromJson(Object? value, {required DateTime now}) {
    if (value is! Map<String, Object?> ||
        value['access_token'] is! String ||
        value['refresh_token'] is! String ||
        value['expires_in'] is! int) {
      throw const SupabaseAuthFailure();
    }
    return SupabaseAuthSession(
      accessToken: value['access_token']! as String,
      refreshToken: value['refresh_token']! as String,
      expiresAt: now.add(Duration(seconds: value['expires_in']! as int)),
    );
  }

  final String accessToken;
  final String refreshToken;
  final DateTime expiresAt;
}

/// Minimal Supabase Auth password/refresh client. Sessions exist in memory only.
final class SupabaseAuthClient {
  SupabaseAuthClient({
    required String supabaseUrl,
    required this.publishableKey,
    http.Client? httpClient,
    DateTime Function()? clock,
    this.timeout = const Duration(seconds: 20),
  }) : _baseUri = Uri.parse(supabaseUrl),
       _httpClient = httpClient ?? http.Client(),
       _ownsClient = httpClient == null,
       _clock = clock ?? DateTime.now {
    if (_baseUri.scheme != 'https' ||
        !_baseUri.hasAuthority ||
        publishableKey.trim().isEmpty) {
      throw ArgumentError(
        'A Supabase HTTPS URL and publishable key are required.',
      );
    }
  }

  final Uri _baseUri;
  final String publishableKey;
  final http.Client _httpClient;
  final bool _ownsClient;
  final DateTime Function() _clock;
  final Duration timeout;
  SupabaseAuthSession? _session;

  Future<void> signInWithPassword({
    required String email,
    required String password,
  }) async {
    _session = await _tokenRequest('password', <String, String>{
      'email': email.trim(),
      'password': password,
    });
  }

  Future<String?> currentAccessToken() async {
    final SupabaseAuthSession? session = _session;
    if (session == null) return null;
    if (session.expiresAt.isAfter(_clock().add(const Duration(minutes: 1)))) {
      return session.accessToken;
    }
    try {
      _session = await _tokenRequest('refresh_token', <String, String>{
        'refresh_token': session.refreshToken,
      });
      return _session!.accessToken;
    } on SupabaseAuthFailure {
      _session = null;
      rethrow;
    }
  }

  void clearSession() => _session = null;

  Future<void> signOut() async {
    final SupabaseAuthSession? session = _session;
    _session = null;
    if (session == null) return;
    try {
      await _httpClient
          .post(
            _baseUri.replace(path: '/auth/v1/logout'),
            headers: <String, String>{
              'accept': 'application/json',
              'apikey': publishableKey,
              'authorization': 'Bearer ${session.accessToken}',
            },
          )
          .timeout(timeout);
    } on Object {
      // Local sign-out remains complete even when the Auth endpoint is offline.
    }
  }

  Future<SupabaseAuthSession> _tokenRequest(
    String grantType,
    Map<String, String> body,
  ) async {
    try {
      final http.Response response = await _httpClient
          .post(
            _baseUri.replace(
              path: '/auth/v1/token',
              queryParameters: <String, String>{'grant_type': grantType},
            ),
            headers: <String, String>{
              'accept': 'application/json',
              'content-type': 'application/json',
              'apikey': publishableKey,
            },
            body: jsonEncode(body),
          )
          .timeout(timeout);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw const SupabaseAuthFailure();
      }
      final Object? decoded = jsonDecode(utf8.decode(response.bodyBytes));
      return SupabaseAuthSession.fromJson(decoded, now: _clock());
    } on TimeoutException {
      throw const SupabaseAuthNetworkFailure();
    } on http.ClientException {
      throw const SupabaseAuthNetworkFailure();
    } on FormatException {
      throw const SupabaseAuthFailure();
    }
  }

  void close() {
    if (_ownsClient) _httpClient.close();
  }
}
