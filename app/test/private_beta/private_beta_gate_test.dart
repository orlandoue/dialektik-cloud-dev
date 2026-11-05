import 'dart:async';
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
    expect(find.text('VS'), findsNothing);
    expect(authRequests, 0);
    expect(coreRequests, 0);
  });

  for (final double width in <double>[390, 1200]) {
    testWidgets('sign out remains available at ${width.toInt()}px', (
      WidgetTester tester,
    ) async {
      tester.view.physicalSize = Size(width, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final List<http.Request> authRequests = <http.Request>[];
      await tester.pumpWidget(
        _gate(
          authClient: MockClient((http.Request request) async {
            authRequests.add(request);
            if (request.url.path == '/auth/v1/logout') {
              return http.Response('', 204);
            }
            return _sessionResponse('valid-access', 'valid-refresh', 3600);
          }),
          apiClient: MockClient((_) async => _emptyPage()),
        ),
      );
      await _signIn(tester);
      final Finder signOut = find.byTooltip('Cerrar sesión');
      expect(signOut, findsOneWidget);
      await tester.tap(signOut);
      await tester.pumpAndSettle();
      expect(find.text('Beta privada'), findsOneWidget);
      expect(find.byTooltip('Cerrar sesión'), findsNothing);
      expect(authRequests.last.url.path, '/auth/v1/logout');
      expect(authRequests.last.headers['authorization'], 'Bearer valid-access');
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('authorized single editor can review and confirm a proposal', (
    WidgetTester tester,
  ) async {
    const String editorId = '01M4YDQK00ED1T0R0R1AND0VE1';
    const String taskId = '01M4YDQK000000000000000101';
    const String proposalId = '01M4YDQK000000000000000102';
    const List<String> assertionIds = <String>[
      '01M4YDQK000000000000000103',
      '01M4YDQK000000000000000104',
    ];
    bool claimed = false;
    bool proposed = false;
    bool confirmed = false;
    final List<http.Request> commands = <http.Request>[];
    await tester.pumpWidget(
      _gate(
        authClient: MockClient(
          (_) async => _sessionResponse('editor-access', 'refresh', 3600),
        ),
        apiClient: MockClient((http.Request request) async {
          final String path = request.url.path;
          if (path == '/v1/mod/session') {
            return _json(<String, Object?>{
              'userId': editorId,
              'role': 'editor',
              'singleEditorEnabled': true,
            });
          }
          final Map<String, Object?> task = <String, Object?>{
            'taskId': taskId,
            'eventTitle': 'Acontecimiento de prueba',
            'taskState': 'pending',
            'assignedTo': claimed ? editorId : null,
            'isCurrentSnapshot': true,
            'assertions': <Object?>[
              for (final String id in assertionIds)
                <String, Object?>{
                  'assertionId': id,
                  'sourceName': 'Fuente de prueba',
                  'articleUrl': 'https://example.test/article',
                  'articleTitle': 'Título de prueba',
                  'articleAuthor': 'Autor de prueba',
                  'articlePublishedAt': '2026-10-20T00:00:00.000Z',
                  'quotedText': 'x' * 140,
                },
            ],
            'proposals': <Object?>[
              if (proposed)
                <String, Object?>{
                  'proposalId': proposalId,
                  'state': confirmed ? 'confirmed' : 'submitted',
                  'outcome': 'accept_subset',
                  'proposerId': editorId,
                  'members': <Object?>[
                    for (final String id in assertionIds)
                      <String, Object?>{
                        'assertionId': id,
                        'partitionOrdinal': null,
                      },
                  ],
                },
            ],
          };
          if (request.method == 'POST') {
            commands.add(request);
            if (path.endsWith('/claim')) claimed = true;
            if (path.endsWith('/proposals')) proposed = true;
            if (path.endsWith('/confirm')) confirmed = true;
            return _json(<String, Object?>{});
          }
          if (path == '/v1/mod/tasks') return _json(<Object?>[task]);
          if (path == '/v1/mod/tasks/$taskId') return _json(task);
          return _emptyPage();
        }),
      ),
    );

    await _signIn(tester);
    await tester.tap(find.byTooltip('Revisión editorial'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Acontecimiento de prueba'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Tomar revisión'));
    await tester.pumpAndSettle();
    for (final Finder checkbox in <Finder>[
      find.byType(CheckboxListTile).first,
      find.byType(CheckboxListTile).last,
    ]) {
      await tester.ensureVisible(checkbox);
      await tester.tap(checkbox);
      await tester.pumpAndSettle();
    }
    await tester.ensureVisible(find.text('Proponer agrupación'));
    await tester.tap(find.text('Proponer agrupación'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Confirmar').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Confirmar').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Confirmar').last);
    await tester.pumpAndSettle();

    expect(confirmed, isTrue);
    expect(commands.map((request) => request.url.path), <String>[
      '/v1/mod/tasks/$taskId/claim',
      '/v1/mod/tasks/$taskId/proposals',
      '/v1/mod/tasks/$taskId/proposals/$proposalId/confirm',
    ]);
    expect(
      commands.every(
        (request) =>
            request.headers['authorization'] == 'Bearer editor-access' &&
            RegExp(
              r'^[0-7][0-9A-HJKMNP-TV-Z]{25}$',
            ).hasMatch(request.headers['idempotency-key'] ?? ''),
      ),
      isTrue,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('sign out returns to login while remote logout is pending', (
    WidgetTester tester,
  ) async {
    final Completer<http.Response> logout = Completer<http.Response>();
    await tester.pumpWidget(
      _gate(
        authClient: MockClient((http.Request request) async {
          if (request.url.path == '/auth/v1/logout') return logout.future;
          return _sessionResponse('valid-access', 'valid-refresh', 3600);
        }),
        apiClient: MockClient((_) async => _emptyPage()),
      ),
    );
    await _signIn(tester);
    await tester.tap(find.byTooltip('Cerrar sesión'));
    await tester.pump();
    expect(find.text('Beta privada'), findsOneWidget);
    expect(find.byTooltip('Cerrar sesión'), findsNothing);
    logout.complete(http.Response('', 204));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
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
        '/v1/mod/session',
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
          if (request.url.path == '/v1/sources/following' && testerEnabled) {
            return http.Response('{"source_ids":[]}', 200);
          }
          if (request.url.path.startsWith('/live/') && testerEnabled) {
            return _emptyPage();
          }
          if (request.url.path == '/v1/feed/blindspots' && testerEnabled) {
            return http.Response('{"items":[],"next_cursor":null,"total":0,"followed_source_count":0}', 200);
          }
          if ((request.url.path == '/v1/feed' || request.url.path == '/live/observations/chile/seismic') && testerEnabled) {
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
    await tester.tap(find.text('Actualidad'));
    await tester.pumpAndSettle();
    if (find.text('Saltar').evaluate().isNotEmpty) {
      await tester.tap(find.text('Saltar'));
      await tester.pumpAndSettle();
    }
    testerEnabled = false;
    await tester.ensureVisible(find.text('VS').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('VS').last);
    await tester.pumpAndSettle();
    expect(
      find.text(
        'La sesión venció o esta cuenta no está habilitada para la beta privada.',
      ),
      findsOneWidget,
    );
    expect(coreRequests.any((request) => request.url.path == '/v1/feed'), isTrue);

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

http.Response _json(Object? value) => http.Response(
  jsonEncode(value),
  200,
  headers: const <String, String>{'content-type': 'application/json'},
);
