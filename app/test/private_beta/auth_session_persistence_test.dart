import 'dart:convert';

import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/features/consumer/presentation/navigation/consumer_routes.dart';
import 'package:dialektik/features/private_beta/data/auth_session_store.dart';
import 'package:dialektik/features/private_beta/data/supabase_auth_client.dart';
import 'package:dialektik/features/private_beta/presentation/private_beta_gate.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const String _apiBase = 'https://core.example.test';
const String _authBase = 'https://project.supabase.co';

http.Response _json(Object? value, [int status = 200]) => http.Response(
  jsonEncode(value),
  status,
  headers: const <String, String>{'content-type': 'application/json'},
);

Map<String, Object?> _token(
  String access,
  String refresh, {
  int seconds = 3600,
  bool withUser = true,
}) => <String, Object?>{
  'access_token': access,
  'refresh_token': refresh,
  'expires_in': seconds,
  if (withUser)
    'user': <String, Object?>{
      'email': 'ana.perez@example.test',
      'user_metadata': <String, Object?>{'alias': 'Ana P.'},
    },
};

String _saved({required DateTime expiresAt, String refresh = 'refresh-one'}) =>
    SupabaseAuthSession(
      accessToken: 'saved-access',
      refreshToken: refresh,
      expiresAt: expiresAt,
      user: const SupabaseAuthUser(
        email: 'ana.perez@example.test',
        alias: 'Ana P.',
      ),
    ).toStored();

http.Client _core({List<String>? authorizations, int status = 200}) =>
    MockClient((http.Request request) async {
      authorizations?.add(request.headers['authorization'] ?? '');
      if (status != 200) return http.Response('{}', status);
      if (request.url.path == '/v1/sources/following') {
        return http.Response('{"source_ids":[]}', 200);
      }
      return _json(<String, Object?>{
        'items': <Object?>[],
        'next_cursor': null,
      });
    });

void main() {
  final DateTime now = DateTime.utc(2026, 11, 14, 12);

  SupabaseAuthClient client(
    AuthSessionStore store,
    Future<http.Response> Function(http.Request) handler,
  ) => SupabaseAuthClient(
    supabaseUrl: _authBase,
    publishableKey: 'sb_publishable_test',
    httpClient: MockClient(handler),
    clock: () => now,
    sessionStore: store,
  );

  group('device session', () {
    test('a sign-in is saved and a new launch restores it offline', () async {
      final MemoryAuthSessionStore store = MemoryAuthSessionStore();
      final SupabaseAuthClient first = client(
        store,
        (_) async => _json(_token('access-one', 'refresh-one')),
      );
      await first.signInWithPassword(
        email: 'ana.perez@example.test',
        password: 'secreto1',
      );
      await first.persisted;
      final Map<String, Object?> stored =
          jsonDecode(store.value!) as Map<String, Object?>;
      expect(stored['access_token'], 'access-one');
      expect(stored['refresh_token'], 'refresh-one');
      expect((stored['user']! as Map<String, Object?>)['alias'], 'Ana P.');

      var calls = 0;
      final SupabaseAuthClient second = client(store, (_) async {
        calls += 1;
        return _json(<String, Object?>{}, 500);
      });
      expect(await second.restoreSession(), isTrue);
      expect(calls, 0, reason: 'a valid token needs no network');
      expect(await second.currentAccessToken(), 'access-one');
      expect(second.currentUser?.email, 'ana.perez@example.test');
      expect(second.currentUser?.alias, 'Ana P.');
    });

    test('an expired saved token is renewed and the rotated refresh token '
        'replaces the saved one', () async {
      final MemoryAuthSessionStore store = MemoryAuthSessionStore(
        _saved(expiresAt: now.subtract(const Duration(hours: 2))),
      );
      late http.Request refresh;
      final SupabaseAuthClient auth = client(store, (
        http.Request request,
      ) async {
        refresh = request;
        return _json(_token('access-two', 'refresh-two', withUser: false));
      });
      expect(await auth.restoreSession(), isTrue);
      expect(refresh.url.queryParameters['grant_type'], 'refresh_token');
      expect(jsonDecode(refresh.body), <String, String>{
        'refresh_token': 'refresh-one',
      });
      await auth.persisted;
      final Map<String, Object?> stored =
          jsonDecode(store.value!) as Map<String, Object?>;
      expect(stored['access_token'], 'access-two');
      expect(stored['refresh_token'], 'refresh-two');
      // The refresh omitted the user: the saved profile is kept.
      expect(auth.currentUser?.alias, 'Ana P.');
    });

    test('a rejected refresh deletes the saved session', () async {
      final MemoryAuthSessionStore store = MemoryAuthSessionStore(
        _saved(expiresAt: now.subtract(const Duration(hours: 2))),
      );
      final SupabaseAuthClient auth = client(
        store,
        (_) async => _json(<String, Object?>{
          'error_code': 'refresh_token_not_found',
        }, 400),
      );
      expect(await auth.restoreSession(), isFalse);
      await auth.persisted;
      expect(store.value, isNull);
      expect(auth.hasSession, isFalse);
    });

    test('without network the saved session is kept for later', () async {
      final String saved = _saved(
        expiresAt: now.subtract(const Duration(hours: 2)),
      );
      final MemoryAuthSessionStore store = MemoryAuthSessionStore(saved);
      final SupabaseAuthClient auth = client(
        store,
        (_) async => throw http.ClientException('offline'),
      );
      expect(await auth.restoreSession(), isTrue);
      await auth.persisted;
      expect(store.value, saved);
    });

    test('a corrupt saved copy is discarded', () async {
      final MemoryAuthSessionStore store = MemoryAuthSessionStore('{nope');
      final SupabaseAuthClient auth = client(
        store,
        (_) async => _json(<String, Object?>{}, 500),
      );
      expect(await auth.restoreSession(), isFalse);
      await auth.persisted;
      expect(store.value, isNull);
    });

    test('concurrent requests share a single refresh', () async {
      var clock = now;
      var calls = 0;
      final SupabaseAuthClient auth = SupabaseAuthClient(
        supabaseUrl: _authBase,
        publishableKey: 'sb_publishable_test',
        clock: () => clock,
        sessionStore: MemoryAuthSessionStore(),
        httpClient: MockClient((_) async {
          calls += 1;
          await Future<void>.delayed(const Duration(milliseconds: 5));
          return _json(_token('access-$calls', 'refresh-$calls', seconds: 60));
        }),
      );
      await auth.signInWithPassword(
        email: 'ana.perez@example.test',
        password: 'secreto1',
      );
      clock = now.add(const Duration(hours: 1));
      final List<String?> tokens = await Future.wait(<Future<String?>>[
        for (var i = 0; i < 5; i++) auth.currentAccessToken(),
      ]);
      expect(calls, 2, reason: 'one sign-in and a single shared refresh');
      expect(tokens.toSet(), <String?>{'access-2'});
    });

    test('signing out deletes the saved session', () async {
      final MemoryAuthSessionStore store = MemoryAuthSessionStore(
        _saved(expiresAt: now.add(const Duration(hours: 1))),
      );
      final SupabaseAuthClient auth = client(store, (_) async => _json({}));
      expect(await auth.restoreSession(), isTrue);
      await auth.signOut();
      await auth.persisted;
      expect(store.value, isNull);
    });
  });

  group('gate', () {
    Widget gate({
      required AuthSessionStore store,
      required http.Client auth,
      required http.Client core,
    }) => PrivateBetaGate(
      apiConfiguration: ApiConfiguration.fromBaseUrl(_apiBase),
      supabaseUrl: _authBase,
      publishableKey: 'sb_publishable_test_key',
      initialRoute: ConsumerRoutes.feed,
      readOnlyNewsReaderEnabled: true,
      authHttpClient: auth,
      apiHttpClient: core,
      authClock: () => now,
      sessionStore: store,
    );

    testWidgets('reopening the app enters the Arena without signing in', (
      WidgetTester tester,
    ) async {
      final MemoryAuthSessionStore store = MemoryAuthSessionStore(
        _saved(expiresAt: now.add(const Duration(hours: 1))),
      );
      final List<String> authorizations = <String>[];
      var authCalls = 0;
      await tester.pumpWidget(
        gate(
          store: store,
          auth: MockClient((_) async {
            authCalls += 1;
            return _json(<String, Object?>{}, 500);
          }),
          core: _core(authorizations: authorizations),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Únete al Coliseo'), findsNothing);
      expect(find.byKey(const Key('arena-bottom-navigation')), findsOneWidget);
      expect(authCalls, 0);
      expect(authorizations, everyElement('Bearer saved-access'));

      await tester.tap(
        find.descendant(
          of: find.byKey(const Key('arena-bottom-navigation')),
          matching: find.text('Perfil'),
        ),
      );
      await tester.pumpAndSettle();
      final Finder card = find.byKey(const Key('arena-account-card'));
      expect(
        find.descendant(of: card, matching: find.text('Ana P.')),
        findsOneWidget,
      );

      await tester.ensureVisible(
        find.byKey(const Key('arena-account-sign-out')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('arena-account-sign-out')));
      await tester.pumpAndSettle();
      expect(find.text('Únete al Coliseo'), findsOneWidget);
      expect(store.value, isNull);
    });

    testWidgets('a cold Core does not send a restored reader back to sign in', (
      WidgetTester tester,
    ) async {
      final MemoryAuthSessionStore store = MemoryAuthSessionStore(
        _saved(expiresAt: now.add(const Duration(hours: 1))),
      );
      await tester.pumpWidget(
        gate(
          store: store,
          auth: MockClient((_) async => _json(<String, Object?>{}, 500)),
          core: _core(status: 503),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Únete al Coliseo'), findsNothing);
      expect(store.value, isNotNull);
    });

    testWidgets('Core rejecting a restored session signs out and deletes it', (
      WidgetTester tester,
    ) async {
      final MemoryAuthSessionStore store = MemoryAuthSessionStore(
        _saved(expiresAt: now.add(const Duration(hours: 1))),
      );
      await tester.pumpWidget(
        gate(
          store: store,
          auth: MockClient((_) async => _json(<String, Object?>{}, 500)),
          core: _core(status: 401),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Únete al Coliseo'), findsOneWidget);
      expect(
        find.text('La cuenta no está habilitada para la beta privada.'),
        findsOneWidget,
      );
      expect(store.value, isNull);
    });

    testWidgets('without a saved session the sign-in screen is shown', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        gate(
          store: MemoryAuthSessionStore(),
          auth: MockClient((_) async => _json(<String, Object?>{}, 500)),
          core: _core(),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Únete al Coliseo'), findsOneWidget);
      expect(find.byKey(const Key('login-email')), findsOneWidget);
    });
  });
}
