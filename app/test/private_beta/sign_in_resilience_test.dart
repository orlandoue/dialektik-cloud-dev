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

http.Response _json(Object? value, [int status = 200]) => http.Response(
  jsonEncode(value),
  status,
  headers: const <String, String>{'content-type': 'application/json'},
);

http.Client _auth() => MockClient(
  (_) async => _json(<String, Object?>{
    'access_token': 'access',
    'refresh_token': 'refresh',
    'expires_in': 3600,
    'user': <String, Object?>{'email': 'ana@example.test'},
  }),
);

/// Core answering the private-access check with [feed]; every other read
/// answers an empty page.
http.Client _core(Future<http.Response> Function() feed) => MockClient((
  http.Request request,
) async {
  if (request.url.path == '/v1/feed' &&
      request.url.queryParameters['limit'] == '1') {
    return feed();
  }
  if (request.url.path == '/v1/sources/following') {
    return http.Response('{"source_ids":[]}', 200);
  }
  return _json(<String, Object?>{'items': <Object?>[], 'next_cursor': null});
});

Widget _gate(http.Client core) => PrivateBetaGate(
  apiConfiguration: ApiConfiguration.fromBaseUrl(_apiBase),
  supabaseUrl: _authBase,
  publishableKey: 'sb_publishable_test_key',
  initialRoute: ConsumerRoutes.feed,
  readOnlyNewsReaderEnabled: true,
  authHttpClient: _auth(),
  apiHttpClient: core,
);

Future<void> _signIn(WidgetTester tester) async {
  await tester.enterText(
    find.byKey(const Key('login-email')),
    'ana@example.test',
  );
  await tester.enterText(find.byKey(const Key('login-password')), 'secreto1');
  await tester.ensureVisible(find.text('Iniciar sesión'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Iniciar sesión'));
}

Finder get _arena => find.byKey(const Key('arena-bottom-navigation'));

void main() {
  testWidgets('a field this version does not know never blocks sign-in', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      _gate(
        _core(
          () async => _json(<String, Object?>{
            'items': <Object?>[
              <String, Object?>{
                'id': '01M5MC0000000000000000EVNT',
                'title_descriptive': 'Evento',
                'category': 'pais',
                'detected_at': '2026-11-15T12:00:00.000Z',
                'analysis_state': 'ANALYSIS_PENDING',
                'source_count': 1,
                'position_count': null,
                'country_code': 'CL',
                'a_future_field': true,
              },
            ],
            'next_cursor': null,
          }),
        ),
      ),
    );
    await _signIn(tester);
    await tester.pumpAndSettle();
    expect(_arena, findsOneWidget);
    expect(
      find.text(
        'No se pudo comprobar el acceso privado. Inténtalo nuevamente.',
      ),
      findsNothing,
    );
  });

  testWidgets(
    'a server error after a valid Supabase sign-in still enters the Coliseo',
    (WidgetTester tester) async {
      await tester.pumpWidget(
        _gate(
          _core(() async => _json(<String, Object?>{'error': 'boom'}, 500)),
        ),
      );
      await _signIn(tester);
      await tester.pumpAndSettle();
      expect(_arena, findsOneWidget);
    },
  );

  testWidgets('a cold Core that does not answer does not trap the reader', (
    WidgetTester tester,
  ) async {
    final Completer<http.Response> never = Completer<http.Response>();
    await tester.pumpWidget(_gate(_core(() => never.future)));
    await _signIn(tester);
    await tester.pump(preflightTimeout + const Duration(seconds: 1));
    await tester.pumpAndSettle();
    expect(_arena, findsOneWidget);
    // Let the abandoned request's own transport timeout run out.
    await tester.pump(const Duration(seconds: 41));
  });

  testWidgets('only an explicit refusal from Core keeps the reader out', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      _gate(
        _core(
          () async =>
              _json(<String, Object?>{'code': 'PUBLIC_UNAUTHORIZED'}, 401),
        ),
      ),
    );
    await _signIn(tester);
    await tester.pumpAndSettle();
    expect(_arena, findsNothing);
    expect(
      find.text('La cuenta no está habilitada para la beta privada.'),
      findsOneWidget,
    );
  });
}
