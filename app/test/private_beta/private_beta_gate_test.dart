import 'dart:convert';

import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/features/consumer/presentation/navigation/consumer_routes.dart';
import 'package:dialektik/features/private_beta/presentation/private_beta_gate.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const String _apiBase = 'https://core.example.test';
const String _authBase = 'https://project.supabase.co';

void main() {
  testWidgets('no session exposes only the private-beta login', (
    WidgetTester tester,
  ) async {
    var authRequests = 0;
    var coreRequests = 0;
    await tester.pumpWidget(
      _gate(
        authClient: MockClient((_) async {
          authRequests += 1;
          return _sessionResponse('unused-token', 'unused-refresh', 3600);
        }),
        apiClient: MockClient((_) async {
          coreRequests += 1;
          return _emptyPage();
        }),
      ),
    );

    expect(find.text('Beta privada'), findsOneWidget);
    expect(find.text('Contradicciones'), findsNothing);
    expect(authRequests, 0);
    expect(coreRequests, 0);
  });

  testWidgets(
    'valid session reaches an authorized empty contradictions state',
    (WidgetTester tester) async {
      final List<http.Request> coreRequests = <http.Request>[];
      await tester.pumpWidget(
        _gate(
          authClient: MockClient(
            (_) async => _sessionResponse('valid-access', 'refresh-one', 3600),
          ),
          apiClient: MockClient((http.Request request) async {
            coreRequests.add(request);
            return _emptyPage();
          }),
        ),
      );

      await _signIn(tester);

      expect(find.text('Beta privada'), findsNothing);
      expect(
        find.text('Aún no hay contradicciones publicadas.'),
        findsOneWidget,
      );
      expect(coreRequests.map((request) => request.url.path), <String>[
        '/v1/feed',
        '/v1/contradictions',
      ]);
      expect(
        coreRequests.every(
          (http.Request request) =>
              request.headers['authorization'] == 'Bearer valid-access',
        ),
        isTrue,
      );
    },
  );

  testWidgets('Core 401 blocks navigation until the tester is restored', (
    WidgetTester tester,
  ) async {
    var testerEnabled = false;
    var authRequests = 0;
    final List<http.Request> coreRequests = <http.Request>[];
    await tester.pumpWidget(
      _gate(
        authClient: MockClient((_) async {
          authRequests += 1;
          return _sessionResponse(
            'valid-access-$authRequests',
            'refresh',
            3600,
          );
        }),
        apiClient: MockClient((http.Request request) async {
          coreRequests.add(request);
          if (request.url.path == '/v1/feed' && testerEnabled) {
            return _emptyPage();
          }
          if (request.url.path == '/v1/contradictions' && testerEnabled) {
            return _emptyPage();
          }
          return _emptyPage(statusCode: 401);
        }),
      ),
    );

    await _signIn(tester);
    expect(
      find.text('La cuenta no está habilitada para la beta privada.'),
      findsOneWidget,
    );
    expect(find.text('Aún no hay contradicciones publicadas.'), findsNothing);

    testerEnabled = true;
    await _signIn(tester);
    expect(find.text('Aún no hay contradicciones publicadas.'), findsOneWidget);

    // Revoke access after login. Leaving and reopening the protected route
    // causes a real 401, which returns the app to the login gate.
    await tester.tap(find.text('Acontecimientos'));
    await tester.pumpAndSettle();
    testerEnabled = false;
    // Contradicciones is now a primary horizontal tab, not a More-menu item.
    // Scroll it into view before verifying revoked Core authorization.
    await tester.ensureVisible(find.text('Contradicciones').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Contradicciones').last);
    await tester.pumpAndSettle();
    expect(
      find.text(
        'La sesión venció o esta cuenta no está habilitada para la beta privada.',
      ),
      findsOneWidget,
    );
    expect(coreRequests.last.url.path, '/v1/contradictions');

    testerEnabled = true;
    await _signIn(tester);
    expect(find.text('Aún no hay contradicciones publicadas.'), findsOneWidget);
    expect(find.text('Beta privada'), findsNothing);
  });

  testWidgets('expired access refreshes before the Core allowlist preflight', (
    WidgetTester tester,
  ) async {
    final DateTime now = DateTime.utc(2026, 10, 14);
    var authRequests = 0;
    final List<String?> coreTokens = <String?>[];
    await tester.pumpWidget(
      _gate(
        authClock: () => now,
        authClient: MockClient((http.Request request) async {
          authRequests += 1;
          if (request.url.queryParameters['grant_type'] == 'refresh_token') {
            return _sessionResponse('refreshed-access', 'refresh-two', 3600);
          }
          return _sessionResponse('short-access', 'refresh-one', 10);
        }),
        apiClient: MockClient((http.Request request) async {
          coreTokens.add(request.headers['authorization']);
          return _emptyPage();
        }),
      ),
    );

    await _signIn(tester);
    expect(authRequests, 2);
    expect(coreTokens, <String?>[
      'Bearer refreshed-access',
      'Bearer refreshed-access',
    ]);
    expect(find.text('Aún no hay contradicciones publicadas.'), findsOneWidget);
  });
}

PrivateBetaGate _gate({
  required http.Client authClient,
  required http.Client apiClient,
  DateTime Function()? authClock,
}) => PrivateBetaGate(
  apiConfiguration: ApiConfiguration.fromBaseUrl(_apiBase),
  supabaseUrl: _authBase,
  publishableKey: 'sb_publishable_test_key',
  initialRoute: ConsumerRoutes.contradictions,
  readOnlyNewsReaderEnabled: true,
  authHttpClient: authClient,
  apiHttpClient: apiClient,
  authClock: authClock,
);

Future<void> _signIn(WidgetTester tester) async {
  final List<Finder> fields = <Finder>[
    find.byType(TextFormField).first,
    find.byType(TextFormField).last,
  ];
  await tester.enterText(fields[0], 'tester@example.test');
  await tester.enterText(fields[1], 'test-only-password');
  await tester.tap(find.text('Iniciar sesión'));
  await tester.pumpAndSettle();
}

http.Response _sessionResponse(String access, String refresh, int seconds) =>
    http.Response(
      jsonEncode(<String, Object?>{
        'access_token': access,
        'refresh_token': refresh,
        'expires_in': seconds,
      }),
      200,
      headers: const <String, String>{'content-type': 'application/json'},
    );

http.Response _emptyPage({int statusCode = 200}) => http.Response(
  jsonEncode(<String, Object?>{'items': <Object?>[], 'next_cursor': null}),
  statusCode,
  headers: const <String, String>{'content-type': 'application/json'},
);
