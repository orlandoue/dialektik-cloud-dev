import 'dart:convert';

import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/features/editorial/data/editorial_api.dart';
import 'package:dialektik/features/editorial/presentation/editorial_review_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const String _editor = '01M4YDQK00ED1T0R0R1AND0VE1';
const String _attempt = '01M4YDQK00EVART00000000001';

http.Response _json(Object body, [int status = 200]) => http.Response(
  jsonEncode(body),
  status,
  headers: const <String, String>{'content-type': 'application/json'},
);

Widget _screen(http.Client client) => MaterialApp(
  home: EditorialQueueScreen(
    api: EditorialApi(
      configuration: ApiConfiguration.fromBaseUrl('https://core.example.test'),
      tokenProvider: () async => 'editor-test-token',
      httpClient: client,
    ),
    session: const EditorialSession(
      userId: _editor,
      role: 'editor',
      singleEditorEnabled: true,
    ),
  ),
);

void main() {
  testWidgets('unavailable title endpoint does not block existing reviews', (
    tester,
  ) async {
    await tester.pumpWidget(
      _screen(
        MockClient((request) async {
          if (request.url.path == '/v1/mod/tasks') return _json(<Object?>[]);
          return _json(<String, Object?>{}, 404);
        }),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('No hay revisiones pendientes.'), findsOneWidget);
    expect(find.text('Analizar siguiente titular'), findsNothing);
  });

  testWidgets('editor can review a title without publishing a contradiction', (
    tester,
  ) async {
    final List<http.Request> commands = <http.Request>[];
    bool decided = false;
    await tester.pumpWidget(
      _screen(
        MockClient((request) async {
          if (request.url.path == '/v1/mod/tasks') return _json(<Object?>[]);
          if (request.url.path == '/v1/mod/headline-reviews/sources') {
            return _json(<Object?>[]);
          }
          if (request.method == 'GET' &&
              request.url.path == '/v1/mod/headline-reviews') {
            return _json(<Object?>[
              if (!decided)
                <String, Object?>{
                  'attemptId': _attempt,
                  'headline': 'Titular sintético para revisión',
                  'sourceName': 'Medio de prueba',
                  'publishedAt': '2026-10-28T00:00:00Z',
                  'canonicalUrl': 'https://example.test/noticia',
                  'extraction': <String, Object?>{
                    'status': 'OBSERVATION_AVAILABLE',
                  },
                },
            ]);
          }
          commands.add(request);
          decided = true;
          return _json(<String, Object?>{});
        }),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Titular sintético para revisión'), findsOneWidget);
    expect(
      find.textContaining('no publica acontecimientos ni contradicciones'),
      findsOneWidget,
    );
    await tester.ensureVisible(find.text('Permitir comparar'));
    await tester.tap(find.text('Permitir comparar'));
    await tester.pumpAndSettle();
    expect(commands, hasLength(1));
    expect(
      commands.single.url.path,
      '/v1/mod/headline-reviews/$_attempt/decision',
    );
    expect(jsonDecode(commands.single.body), <String, Object?>{
      'decision': 'ACCEPT_FOR_GROUPING',
    });
    expect(commands.single.headers['idempotency-key'], isNotEmpty);
    expect(
      find.text('No hay análisis de titulares pendientes.'),
      findsOneWidget,
    );
  });

  testWidgets(
    'analyzing uses a server selected title and displays an empty queue',
    (tester) async {
      final List<http.Request> commands = <http.Request>[];
      await tester.pumpWidget(
        _screen(
          MockClient((request) async {
            if (request.url.path == '/v1/mod/tasks' ||
                request.method == 'GET') {
              return _json(<Object?>[]);
            }
            commands.add(request);
            return _json(<String, Object?>{'status': 'NO_ELIGIBLE'});
          }),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Analizar siguiente titular'));
      await tester.pumpAndSettle();
      expect(commands.single.url.path, '/v1/mod/headline-reviews/analyze');
      expect(jsonDecode(commands.single.body), isEmpty);
      expect(
        find.text('No hay titulares pendientes de fuentes autorizadas.'),
        findsOneWidget,
      );
    },
  );

  testWidgets('editor explicitly enables one source for title analysis', (
    tester,
  ) async {
    final List<http.Request> commands = <http.Request>[];
    const String sourceId = '01M4YDQK00CH1000C1PERCH11E';
    bool enabled = false;
    await tester.pumpWidget(
      _screen(
        MockClient((request) async {
          if (request.url.path == '/v1/mod/headline-reviews/sources' &&
              request.method == 'GET') {
            return _json(<Object?>[
              <String, Object?>{
                'sourceId': sourceId,
                'sourceName': 'Fuente de prueba',
                'authorizationReference': 'Fundamento editorial',
                'rightsEvidenceUrl': 'https://example.test/fundamento',
                'grantId': enabled ? _attempt : null,
                'current': enabled,
              },
            ]);
          }
          if (request.method == 'GET') return _json(<Object?>[]);
          commands.add(request);
          enabled = true;
          return _json(<String, Object?>{});
        }),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Fuentes para análisis de titulares'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Habilitar').first);
    await tester.tap(find.text('Habilitar').first);
    await tester.pumpAndSettle();
    expect(
      find.textContaining('se publicarán contradicciones automáticamente'),
      findsOneWidget,
    );
    await tester.tap(find.text('Habilitar').last);
    await tester.pumpAndSettle();
    expect(
      commands.single.url.path,
      '/v1/mod/headline-reviews/sources/$sourceId/grant',
    );
    expect(jsonDecode(commands.single.body), <String, Object?>{
      'action': 'ENABLE',
    });
    expect(find.text('Habilitada'), findsOneWidget);
  });
}
