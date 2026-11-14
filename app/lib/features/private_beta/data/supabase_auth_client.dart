import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:dialektik/features/private_beta/data/auth_session_store.dart';
import 'package:http/http.dart' as http;

final class SupabaseAuthFailure implements Exception {
  const SupabaseAuthFailure([this.code]);

  /// Supabase `error_code` (for example `user_already_exists`), when given.
  final String? code;
}

/// Outcome of creating an account with email and password.
enum SupabaseSignUpResult {
  /// The account was created and the session is active.
  signedIn,

  /// The project requires confirming the email before the first sign-in.
  confirmationRequired,
}

/// The signed-in person, as Supabase Auth reports it. Never logged.
final class SupabaseAuthUser {
  const SupabaseAuthUser({this.email, this.alias, this.displayName});

  factory SupabaseAuthUser.fromJson(Object? value) {
    if (value is! Map<String, Object?>) return const SupabaseAuthUser();
    final Object? metadata = value['user_metadata'];
    final Map<String, Object?> meta = metadata is Map<String, Object?>
        ? metadata
        : const <String, Object?>{};
    String? text(Object? candidate) =>
        candidate is String && candidate.trim().isNotEmpty
        ? candidate.trim()
        : null;
    return SupabaseAuthUser(
      email: text(value['email']),
      alias: text(meta['alias']),
      displayName: text(meta['full_name']) ?? text(meta['name']),
    );
  }

  final String? email;
  final String? alias;
  final String? displayName;

  Map<String, Object?> _toStored() => <String, Object?>{
    'email': email,
    'alias': alias,
    'display_name': displayName,
  };

  static SupabaseAuthUser _fromStored(Object? value) {
    if (value is! Map<String, Object?>) return const SupabaseAuthUser();
    String? text(Object? candidate) =>
        candidate is String && candidate.isNotEmpty ? candidate : null;
    return SupabaseAuthUser(
      email: text(value['email']),
      alias: text(value['alias']),
      displayName: text(value['display_name']),
    );
  }
}

/// Public alias accepted by Core: 2-30 letters, digits, spaces or `._-`,
/// starting with a letter or digit. Returns null when nothing usable remains.
String? sanitizeAlias(String? raw) {
  if (raw == null) return null;
  final String cleaned = raw
      .replaceAll(RegExp(r'[^\p{L}\p{N} ._-]', unicode: true), '')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim()
      .replaceFirst(RegExp(r'^[ ._-]+'), '');
  final String clipped = cleaned.length > 30
      ? cleaned.substring(0, 30).trimRight()
      : cleaned;
  return clipped.length >= 2 ? clipped : null;
}

/// Alias shown for an account: the chosen one, else the Google name, else
/// the part of the email before `@`.
String aliasFor(SupabaseAuthUser? user) =>
    sanitizeAlias(user?.alias) ??
    sanitizeAlias(user?.displayName) ??
    sanitizeAlias(user?.email?.split('@').first) ??
    'Lector';

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
    this.user = const SupabaseAuthUser(),
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
      user: SupabaseAuthUser.fromJson(value['user']),
    );
  }

  final String accessToken;
  final String refreshToken;
  final DateTime expiresAt;
  final SupabaseAuthUser user;

  /// The device copy: tokens, expiry and the profile shown in Perfil.
  String toStored() => jsonEncode(<String, Object?>{
    'version': 1,
    'access_token': accessToken,
    'refresh_token': refreshToken,
    'expires_at': expiresAt.toUtc().toIso8601String(),
    'user': user._toStored(),
  });

  /// Reads [toStored]; `null` when the copy is missing fields or corrupt.
  static SupabaseAuthSession? fromStored(String raw) {
    try {
      final Object? value = jsonDecode(raw);
      if (value is! Map<String, Object?> ||
          value['version'] != 1 ||
          value['access_token'] is! String ||
          value['refresh_token'] is! String ||
          value['expires_at'] is! String) {
        return null;
      }
      final DateTime? expiresAt = DateTime.tryParse(
        value['expires_at']! as String,
      );
      if (expiresAt == null) return null;
      return SupabaseAuthSession(
        accessToken: value['access_token']! as String,
        refreshToken: value['refresh_token']! as String,
        expiresAt: expiresAt,
        user: SupabaseAuthUser._fromStored(value['user']),
      );
    } on FormatException {
      return null;
    }
  }

  SupabaseAuthSession withUser(SupabaseAuthUser value) => SupabaseAuthSession(
    accessToken: accessToken,
    refreshToken: refreshToken,
    expiresAt: expiresAt,
    user: value,
  );
}

/// Minimal Supabase Auth client: password, sign-up, Google (OAuth with PKCE)
/// and refresh. With an [AuthSessionStore] the session (tokens, email and
/// alias) survives app restarts; see [restoreSession].
final class SupabaseAuthClient {
  SupabaseAuthClient({
    required String supabaseUrl,
    required this.publishableKey,
    http.Client? httpClient,
    DateTime Function()? clock,
    this.timeout = const Duration(seconds: 20),
    AuthSessionStore? sessionStore,
  }) : _store = sessionStore,
       _baseUri = Uri.parse(supabaseUrl),
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
  final AuthSessionStore? _store;
  SupabaseAuthSession? _current;
  Future<void> _writes = Future<void>.value();

  SupabaseAuthSession? get _session => _current;

  /// Every change (sign-in, refresh with a rotated token, alias, sign-out or
  /// a rejected refresh) is mirrored to the store, in order.
  set _session(SupabaseAuthSession? value) {
    _current = value;
    final AuthSessionStore? store = _store;
    if (store == null) return;
    final String? stored = value?.toStored();
    _writes = _writes
        .then((_) => store.write(stored))
        .catchError((Object _) {});
  }

  /// Completes when the latest session change reached the store.
  Future<void> get persisted => _writes;

  /// Restores the session saved on the device, renewing the access token with
  /// the refresh token when it expired. Returns whether a session is ready.
  /// A refresh the server rejects deletes the saved copy; a network failure
  /// keeps it so the next request can renew it.
  Future<bool> restoreSession() async {
    final AuthSessionStore? store = _store;
    if (store == null || _current != null) return _current != null;
    final String? raw;
    try {
      raw = await store.read();
    } on Object {
      return false;
    }
    if (raw == null) return false;
    final SupabaseAuthSession? saved = SupabaseAuthSession.fromStored(raw);
    if (saved == null) {
      _session = null;
      return false;
    }
    _current = saved;
    try {
      await currentAccessToken();
    } on SupabaseAuthNetworkFailure {
      // Offline: keep the saved session; requests renew it later.
    } on SupabaseAuthFailure {
      return false;
    }
    return _current != null;
  }

  Future<void> signInWithPassword({
    required String email,
    required String password,
  }) async {
    final SupabaseAuthSession session = await _tokenRequest(
      'password',
      <String, String>{'email': email.trim(), 'password': password},
    );
    // The token response normally carries the user; keep the typed email
    // when it does not, so the account still has a name to show.
    _session = session.user.email == null
        ? session.withUser(
            SupabaseAuthUser(
              email: email.trim(),
              alias: session.user.alias,
              displayName: session.user.displayName,
            ),
          )
        : session;
  }

  /// Deep link Supabase sends the browser back to after Google sign-in.
  static final Uri oauthRedirect = Uri.parse(
    'io.dialektik.app://login-callback',
  );

  String? _codeVerifier;
  final Random _random = Random.secure();

  /// The person behind the current session, if any.
  SupabaseAuthUser? get currentUser => _session?.user;
  bool get hasSession => _session != null;

  /// Creates an account. The alias is stored in the account's metadata.
  Future<SupabaseSignUpResult> signUp({
    required String email,
    required String password,
    String? alias,
  }) async {
    final Object? decoded = await _authRequest(
      'POST',
      '/auth/v1/signup',
      body: <String, Object?>{
        'email': email.trim(),
        'password': password,
        'data': <String, Object?>{'alias': ?sanitizeAlias(alias)},
      },
    );
    if (decoded is Map<String, Object?> && decoded['access_token'] is String) {
      _session = SupabaseAuthSession.fromJson(decoded, now: _clock());
      return SupabaseSignUpResult.signedIn;
    }
    return SupabaseSignUpResult.confirmationRequired;
  }

  /// Browser address that starts Google sign-in. A fresh PKCE verifier is
  /// kept in memory until [completeOAuth] receives the callback.
  Uri googleSignInUri() {
    const String alphabet =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    final String verifier = List<String>.generate(
      64,
      (_) => alphabet[_random.nextInt(alphabet.length)],
    ).join();
    _codeVerifier = verifier;
    final String challenge = base64Url
        .encode(sha256.convert(utf8.encode(verifier)).bytes)
        .replaceAll('=', '');
    return _baseUri.replace(
      path: '/auth/v1/authorize',
      queryParameters: <String, String>{
        'provider': 'google',
        'redirect_to': oauthRedirect.toString(),
        'code_challenge': challenge,
        'code_challenge_method': 's256',
      },
    );
  }

  /// Whether [uri] is the Google sign-in callback for this app.
  static bool isOAuthCallback(Uri uri) =>
      uri.scheme == oauthRedirect.scheme && uri.host == oauthRedirect.host;

  /// Finishes Google sign-in from the callback deep link.
  Future<void> completeOAuth(Uri callback) async {
    final Map<String, String> query = <String, String>{
      ...callback.queryParameters,
      // Some providers report errors in the fragment.
      if (callback.fragment.contains('='))
        ...Uri.splitQueryString(callback.fragment),
    };
    final String? error = query['error_code'] ?? query['error'];
    if (error != null) throw SupabaseAuthFailure(error);
    final String? code = query['code'];
    final String? verifier = _codeVerifier;
    if (code == null || code.isEmpty || verifier == null) {
      throw const SupabaseAuthFailure('oauth_state_missing');
    }
    _codeVerifier = null;
    _session = await _tokenRequest('pkce', <String, String>{
      'auth_code': code,
      'code_verifier': verifier,
    });
  }

  /// Saves the public alias in the account metadata.
  Future<void> updateAlias(String alias) async {
    final String? clean = sanitizeAlias(alias);
    if (clean == null) throw const SupabaseAuthFailure('alias_invalid');
    final String? token = await currentAccessToken();
    if (token == null) throw const SupabaseAuthFailure('session_missing');
    final Object? decoded = await _authRequest(
      'PUT',
      '/auth/v1/user',
      bearer: token,
      body: <String, Object?>{
        'data': <String, Object?>{'alias': clean},
      },
    );
    final SupabaseAuthSession? session = _session;
    if (session != null) {
      final SupabaseAuthUser updated = SupabaseAuthUser.fromJson(decoded);
      _session = session.withUser(
        SupabaseAuthUser(
          email: updated.email ?? session.user.email,
          alias: updated.alias ?? clean,
          displayName: updated.displayName ?? session.user.displayName,
        ),
      );
    }
  }

  Future<String?> currentAccessToken() async {
    final SupabaseAuthSession? session = _session;
    if (session == null) return null;
    if (session.expiresAt.isAfter(_clock().add(const Duration(minutes: 1)))) {
      return session.accessToken;
    }
    // Concurrent requests share one refresh: Supabase rotates the refresh
    // token, so parallel refreshes would race each other.
    return _refreshing ??= _refresh(session).whenComplete(() {
      _refreshing = null;
    });
  }

  Future<String?>? _refreshing;

  Future<String?> _refresh(SupabaseAuthSession session) async {
    try {
      final SupabaseAuthSession refreshed = await _tokenRequest(
        'refresh_token',
        <String, String>{'refresh_token': session.refreshToken},
      );
      // A refresh may omit the user; keep the known profile then.
      _session = refreshed.user.email == null && refreshed.user.alias == null
          ? refreshed.withUser(session.user)
          : refreshed;
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
    final Object? decoded = await _authRequest(
      'POST',
      '/auth/v1/token',
      query: <String, String>{'grant_type': grantType},
      body: body,
    );
    try {
      return SupabaseAuthSession.fromJson(decoded, now: _clock());
    } on SupabaseAuthFailure {
      rethrow;
    }
  }

  Future<Object?> _authRequest(
    String method,
    String path, {
    Map<String, String>? query,
    Object? body,
    String? bearer,
  }) async {
    try {
      final http.Request request =
          http.Request(
              method,
              _baseUri.replace(path: path, queryParameters: query),
            )
            ..headers.addAll(<String, String>{
              'accept': 'application/json',
              'content-type': 'application/json',
              'apikey': publishableKey,
              'authorization': 'Bearer $bearer',
            })
            ..body = jsonEncode(body);
      if (bearer == null) request.headers.remove('authorization');
      final http.Response response = await http.Response.fromStream(
        await _httpClient.send(request).timeout(timeout),
      ).timeout(timeout);
      final Object? decoded = response.bodyBytes.isEmpty
          ? null
          : jsonDecode(utf8.decode(response.bodyBytes));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        final Object? code = decoded is Map<String, Object?>
            ? decoded['error_code'] ?? decoded['error']
            : null;
        throw SupabaseAuthFailure(code is String ? code : null);
      }
      return decoded;
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
