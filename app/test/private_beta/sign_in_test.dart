import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/features/consumer/presentation/navigation/consumer_routes.dart';
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

Map<String, Object?> _session({
  String email = 'ana.perez@example.test',
  Map<String, Object?> metadata = const <String, Object?>{},
}) => <String, Object?>{
  'access_token': 'access-${email.hashCode}',
  'refresh_token': 'refresh',
  'expires_in': 3600,
  'user': <String, Object?>{'email': email, 'user_metadata': metadata},
};

/// Core answers every read with an empty page, like a fresh beta.
http.Client _core() => MockClient((http.Request request) async {
  if (request.url.path == '/v1/sources/following') {
    return http.Response('{"source_ids":[]}', 200);
  }
  return _json(<String, Object?>{'items': <Object?>[], 'next_cursor': null});
});

void main() {
  group('Supabase Auth client', () {
    SupabaseAuthClient client(MockClient mock) => SupabaseAuthClient(
      supabaseUrl: _authBase,
      publishableKey: 'sb_publishable_test',
      httpClient: mock,
    );

    test('creates an account and stores the alias in its metadata', () async {
      late Map<String, Object?> body;
      final SupabaseAuthClient auth = client(
        MockClient((http.Request request) async {
          expect(request.url.path, '/auth/v1/signup');
          body = jsonDecode(request.body) as Map<String, Object?>;
          return _json(
            _session(metadata: <String, Object?>{'alias': 'Ana P.'}),
          );
        }),
      );
      expect(
        await auth.signUp(
          email: ' ana.perez@example.test ',
          password: 'secreto1',
          alias: ' Ana P. ',
        ),
        SupabaseSignUpResult.signedIn,
      );
      expect(body, <String, Object?>{
        'email': 'ana.perez@example.test',
        'password': 'secreto1',
        'data': <String, Object?>{'alias': 'Ana P.'},
      });
      expect(auth.currentUser?.alias, 'Ana P.');
      expect(aliasFor(auth.currentUser), 'Ana P.');
    });

    test('reports when the email must be confirmed first', () async {
      final SupabaseAuthClient auth = client(
        MockClient(
          (_) async => _json(<String, Object?>{'id': 'u', 'email': 'x@y.z'}),
        ),
      );
      expect(
        await auth.signUp(email: 'x@y.z', password: 'secreto1'),
        SupabaseSignUpResult.confirmationRequired,
      );
      expect(auth.hasSession, isFalse);
    });

    test('carries the Supabase error code', () async {
      final SupabaseAuthClient auth = client(
        MockClient(
          (_) async => _json(<String, Object?>{
            'error_code': 'user_already_exists',
          }, 422),
        ),
      );
      await expectLater(
        auth.signUp(email: 'x@y.z', password: 'secreto1'),
        throwsA(
          isA<SupabaseAuthFailure>().having(
            (f) => f.code,
            'code',
            'user_already_exists',
          ),
        ),
      );
    });

    test('signs in with Google through PKCE and the app deep link', () async {
      late Map<String, Object?> exchange;
      final SupabaseAuthClient auth = client(
        MockClient((http.Request request) async {
          expect(request.url.path, '/auth/v1/token');
          expect(request.url.queryParameters['grant_type'], 'pkce');
          exchange = jsonDecode(request.body) as Map<String, Object?>;
          return _json(
            _session(
              email: 'gmail.user@gmail.com',
              metadata: <String, Object?>{'full_name': 'Gabriela Mistral'},
            ),
          );
        }),
      );
      final Uri start = auth.googleSignInUri();
      expect(start.path, '/auth/v1/authorize');
      expect(start.queryParameters['provider'], 'google');
      expect(
        start.queryParameters['redirect_to'],
        'io.dialektik.app://login-callback',
      );
      expect(start.queryParameters['code_challenge_method'], 's256');
      final String challenge = start.queryParameters['code_challenge']!;

      final Uri callback = Uri.parse(
        'io.dialektik.app://login-callback?code=abc123',
      );
      expect(SupabaseAuthClient.isOAuthCallback(callback), isTrue);
      expect(
        SupabaseAuthClient.isOAuthCallback(
          Uri.parse('https://evil.example/login-callback'),
        ),
        isFalse,
      );
      await auth.completeOAuth(callback);
      expect(exchange['auth_code'], 'abc123');
      // The verifier sent now is the one the challenge was derived from.
      final String verifier = exchange['code_verifier']! as String;
      expect(
        base64Url
            .encode(sha256.convert(utf8.encode(verifier)).bytes)
            .replaceAll('=', ''),
        challenge,
      );
      expect(aliasFor(auth.currentUser), 'Gabriela Mistral');
      // A replayed callback has no verifier left.
      await expectLater(
        auth.completeOAuth(callback),
        throwsA(isA<SupabaseAuthFailure>()),
      );
    });

    test('turns a provider error in the callback into a failure', () async {
      final SupabaseAuthClient auth = client(
        MockClient((_) async => _json(<String, Object?>{})),
      );
      auth.googleSignInUri();
      await expectLater(
        auth.completeOAuth(
          Uri.parse('io.dialektik.app://login-callback?error=access_denied'),
        ),
        throwsA(
          isA<SupabaseAuthFailure>().having(
            (f) => f.code,
            'code',
            'access_denied',
          ),
        ),
      );
    });

    test('updates the alias with the session token', () async {
      final List<http.Request> requests = <http.Request>[];
      final SupabaseAuthClient auth = client(
        MockClient((http.Request request) async {
          requests.add(request);
          if (request.url.path == '/auth/v1/user') {
            return _json(<String, Object?>{
              'email': 'ana.perez@example.test',
              'user_metadata': <String, Object?>{'alias': 'Anita'},
            });
          }
          return _json(_session());
        }),
      );
      await auth.signInWithPassword(
        email: 'ana.perez@example.test',
        password: 'secreto1',
      );
      await auth.updateAlias('Anita');
      expect(requests.last.method, 'PUT');
      expect(
        requests.last.headers['authorization'],
        startsWith('Bearer access-'),
      );
      expect(jsonDecode(requests.last.body), <String, Object?>{
        'data': <String, Object?>{'alias': 'Anita'},
      });
      expect(auth.currentUser?.alias, 'Anita');
      await expectLater(
        auth.updateAlias('!'),
        throwsA(isA<SupabaseAuthFailure>()),
      );
    });

    test('cleans aliases to what Core accepts', () {
      expect(sanitizeAlias('  ana.perez  '), 'ana.perez');
      expect(sanitizeAlias('José <script>'), 'José script');
      expect(sanitizeAlias('_x'), null);
      expect(sanitizeAlias('a' * 40)?.length, 30);
      expect(
        aliasFor(const SupabaseAuthUser(email: 'maria.jose@correo.cl')),
        'maria.jose',
      );
      expect(aliasFor(null), 'Lector');
    });
  });

  group('sign-in screen', () {
    PrivateBetaGate gate({
      required http.Client auth,
      Stream<Uri>? links,
      List<Uri>? opened,
    }) => PrivateBetaGate(
      apiConfiguration: ApiConfiguration.fromBaseUrl(_apiBase),
      supabaseUrl: _authBase,
      publishableKey: 'sb_publishable_test_key',
      initialRoute: ConsumerRoutes.feed,
      readOnlyNewsReaderEnabled: true,
      authHttpClient: auth,
      apiHttpClient: _core(),
      deepLinks: links,
      openBrowser: (Uri uri) async {
        opened?.add(uri);
        return true;
      },
    );

    Future<void> fill(WidgetTester tester, {String alias = ''}) async {
      await tester.enterText(
        find.byKey(const Key('login-email')),
        'ana.perez@example.test',
      );
      await tester.enterText(
        find.byKey(const Key('login-password')),
        'secreto1',
      );
      if (alias.isNotEmpty) {
        await tester.enterText(find.byKey(const Key('login-alias')), alias);
      }
    }

    Future<void> tapKey(WidgetTester tester, String key) async {
      await tester.ensureVisible(find.byKey(Key(key)));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(Key(key)));
      await tester.pumpAndSettle();
    }

    Future<void> openPerfil(WidgetTester tester) async {
      await tester.tap(
        find.descendant(
          of: find.byKey(const Key('arena-bottom-navigation')),
          matching: find.text('Perfil'),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('offers Google and email with sign-in and free sign-up', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        gate(auth: MockClient((_) async => _json(_session()))),
      );
      expect(find.text('Únete al Coliseo'), findsOneWidget);
      expect(find.text('Continuar con Google'), findsOneWidget);
      expect(find.byKey(const Key('login-email')), findsOneWidget);
      expect(find.byKey(const Key('login-password')), findsOneWidget);
      expect(find.byKey(const Key('login-alias')), findsOneWidget);
      expect(find.text('Iniciar sesión'), findsOneWidget);
      expect(find.text('Crear cuenta gratis'), findsOneWidget);
      // Google must come first, above the email form.
      expect(
        tester.getTopLeft(find.byKey(const Key('login-google'))).dy,
        lessThan(tester.getTopLeft(find.byKey(const Key('login-email'))).dy),
      );
    });

    testWidgets('creates an account, enters the Arena and shows it in Perfil', (
      WidgetTester tester,
    ) async {
      final List<http.Request> requests = <http.Request>[];
      await tester.pumpWidget(
        gate(
          auth: MockClient((http.Request request) async {
            requests.add(request);
            if (request.url.path == '/auth/v1/user') {
              return _json(<String, Object?>{
                'email': 'ana.perez@example.test',
                'user_metadata': <String, Object?>{'alias': 'Anita'},
              });
            }
            return _json(
              _session(metadata: <String, Object?>{'alias': 'Ana P.'}),
            );
          }),
        ),
      );
      await fill(tester, alias: 'Ana P.');
      await tapKey(tester, 'login-sign-up');
      expect(requests.first.url.path, '/auth/v1/signup');
      expect(find.byKey(const Key('arena-bottom-navigation')), findsOneWidget);

      await openPerfil(tester);
      final Finder card = find.byKey(const Key('arena-account-card'));
      expect(
        find.descendant(of: card, matching: find.text('Ana P.')),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: card,
          matching: find.text('ana.perez@example.test'),
        ),
        findsOneWidget,
      );

      await tester.tap(find.byKey(const Key('arena-account-edit-alias')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('arena-alias-input')),
        'Anita',
      );
      await tester.tap(find.byKey(const Key('arena-alias-save')));
      await tester.pumpAndSettle();
      expect(
        find.descendant(of: card, matching: find.text('Anita')),
        findsOneWidget,
      );
      expect(find.text('Tu alias ahora es «Anita».'), findsOneWidget);

      await tester.tap(find.byKey(const Key('arena-account-sign-out')));
      await tester.pumpAndSettle();
      expect(find.text('Únete al Coliseo'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('asks to confirm the email when the project requires it', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        gate(
          auth: MockClient(
            (_) async => _json(<String, Object?>{
              'id': 'u',
              'email': 'ana.perez@example.test',
            }),
          ),
        ),
      );
      await fill(tester);
      await tapKey(tester, 'login-sign-up');
      expect(find.textContaining('para confirmar tu cuenta'), findsOneWidget);
      expect(find.byKey(const Key('arena-bottom-navigation')), findsNothing);
    });

    testWidgets('explains wrong credentials and an existing account', (
      WidgetTester tester,
    ) async {
      var code = 'invalid_credentials';
      await tester.pumpWidget(
        gate(
          auth: MockClient(
            (_) async => _json(<String, Object?>{'error_code': code}, 400),
          ),
        ),
      );
      await fill(tester);
      await tapKey(tester, 'login-submit');
      expect(find.text('Correo o contraseña incorrectos.'), findsOneWidget);
      code = 'user_already_exists';
      await fill(tester);
      await tapKey(tester, 'login-sign-up');
      expect(
        find.text('Ese correo ya tiene cuenta. Toca «Iniciar sesión».'),
        findsOneWidget,
      );
    });

    testWidgets('requires six characters to create an account', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        gate(auth: MockClient((_) async => _json(_session()))),
      );
      await tester.enterText(
        find.byKey(const Key('login-email')),
        'ana.perez@example.test',
      );
      await tester.enterText(find.byKey(const Key('login-password')), '123');
      await tapKey(tester, 'login-sign-up');
      expect(find.text('Usa al menos 6 caracteres.'), findsOneWidget);
    });

    testWidgets(
      'Google opens the browser and the deep link signs the reader in',
      (WidgetTester tester) async {
        final StreamController<Uri> links = StreamController<Uri>();
        addTearDown(links.close);
        final List<Uri> opened = <Uri>[];
        final List<String?> grants = <String?>[];
        await tester.pumpWidget(
          gate(
            links: links.stream,
            opened: opened,
            auth: MockClient((http.Request request) async {
              grants.add(request.url.queryParameters['grant_type']);
              return _json(
                _session(
                  email: 'gmail.user@gmail.com',
                  metadata: <String, Object?>{'full_name': 'Gabriela Mistral'},
                ),
              );
            }),
          ),
        );
        await tester.tap(find.byKey(const Key('login-google')));
        await tester.pumpAndSettle();
        expect(opened.single.path, '/auth/v1/authorize');
        expect(opened.single.queryParameters['provider'], 'google');

        // An unrelated link is ignored.
        links.add(Uri.parse('https://example.com/other'));
        await tester.pumpAndSettle();
        expect(grants, isEmpty);

        links.add(
          Uri.parse('io.dialektik.app://login-callback?code=from-google'),
        );
        await tester.pumpAndSettle();
        expect(grants, <String?>['pkce']);
        expect(
          find.byKey(const Key('arena-bottom-navigation')),
          findsOneWidget,
        );
        await openPerfil(tester);
        expect(find.text('Gabriela Mistral'), findsOneWidget);
      },
    );

    testWidgets('a failed Google callback keeps the email form available', (
      WidgetTester tester,
    ) async {
      final StreamController<Uri> links = StreamController<Uri>();
      addTearDown(links.close);
      await tester.pumpWidget(
        gate(
          links: links.stream,
          auth: MockClient((_) async => _json(_session())),
        ),
      );
      await tester.tap(find.byKey(const Key('login-google')));
      await tester.pumpAndSettle();
      links.add(
        Uri.parse('io.dialektik.app://login-callback?error=access_denied'),
      );
      await tester.pumpAndSettle();
      expect(
        find.textContaining('No se pudo entrar con Google'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('login-email')), findsOneWidget);
    });

    for (final Size size in const <Size>[Size(360, 740), Size(412, 915)]) {
      testWidgets('no overflow at text scale 1.45 · ${size.width.toInt()}px', (
        WidgetTester tester,
      ) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1;
        tester.platformDispatcher.textScaleFactorTestValue = 1.45;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        await tester.pumpWidget(
          gate(
            auth: MockClient(
              (http.Request request) async =>
                  request.url.path == '/auth/v1/token'
                  ? _json(<String, Object?>{
                      'error_code': 'invalid_credentials',
                    }, 400)
                  : _json(
                      _session(metadata: <String, Object?>{'alias': 'Ana P.'}),
                    ),
            ),
          ),
        );
        expect(tester.takeException(), isNull);
        await fill(tester);
        await tapKey(tester, 'login-submit');
        expect(find.text('Correo o contraseña incorrectos.'), findsOneWidget);
        for (int i = 0; i < 4; i++) {
          await tester.drag(
            find.byKey(const Key('login-scroll')),
            const Offset(0, -300),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
        }
        await fill(tester);
        await tapKey(tester, 'login-sign-up');
        await openPerfil(tester);
        expect(find.byKey(const Key('arena-account-card')), findsOneWidget);
        await tester.tap(find.byKey(const Key('arena-account-edit-alias')));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });
    }
  });
}
