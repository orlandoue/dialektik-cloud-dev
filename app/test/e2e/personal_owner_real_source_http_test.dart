import 'dart:async';
import 'dart:io';

import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/features/personal_owner/data/personal_owner_operational.dart';
import 'package:dialektik/features/personal_owner/presentation/personal_owner_operational_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

void main() {
  final Map<String, String> environment = Platform.environment;
  final String apiUrl =
      environment['DIALEKTIK_PERSONAL_OWNER_REAL_E2E_API_URL'] ?? '';
  final String ownerToken =
      environment['DIALEKTIK_PERSONAL_OWNER_REAL_E2E_TOKEN'] ?? '';
  final String sourceId =
      environment['DIALEKTIK_PERSONAL_OWNER_REAL_E2E_SOURCE_ID'] ?? '';
  final String officialVoteId =
      environment['DIALEKTIK_PERSONAL_OWNER_REAL_E2E_VOTE_ID'] ?? '';

  testWidgets(
    'renders real persisted publisher metadata and processing state from Core HTTP',
    (WidgetTester tester) async {
      final IOClient ioClient = HttpOverrides.runWithHttpOverrides(
        () => IOClient(HttpClient()),
        _LocalHttpOverrides(),
      );
      final http.Client connectedClient = _ZoneHttpClient(ioClient);
      final PersonalOwnerOperationalClient client =
          PersonalOwnerOperationalClient(
            configuration: ApiConfiguration.fromBaseUrl(apiUrl),
            httpClient: connectedClient,
          );
      addTearDown(connectedClient.close);

      final List<OwnerJson> articles =
          await tester.runAsync<List<OwnerJson>>(
            () => client.articles(ownerToken, sourceId: sourceId),
          ) ??
          (throw StateError('The Core HTTP request did not complete.'));
      expect(articles, isNotEmpty);
      final OwnerJson article = articles.first;
      expect(article['publisher'], 'Diario El Día');
      expect(article['headline'], isA<String>());
      expect(article['canonical_url'], isA<String>());
      expect(article['excerpt'], isNull);
      final OwnerJson processing =
          article['processing_authorization']! as OwnerJson;
      expect(processing['local_processing'], isFalse);
      expect(processing['external_ai_transmission'], isFalse);
      expect(processing['reason'], 'SOURCE_RIGHTS_NOT_AUTHORIZED');

      tester.view.physicalSize = const Size(1280, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      Uri? openedSource;
      await tester.pumpWidget(
        MaterialApp(
          home: PersonalOwnerOperationalScreen(
            repository: client,
            initialOwnerToken: ownerToken,
            externalLinkOpener: (Uri uri) async {
              openedSource = uri;
              return true;
            },
          ),
        ),
      );
      await _waitFor(tester, find.text('Diario El Día'));
      final Finder articlesTab = find.descendant(
        of: find.byType(TabBar),
        matching: find.text('Articles'),
      );
      await _waitFor(tester, articlesTab);
      await tester.tap(articlesTab);
      await tester.pumpAndSettle();

      final String headline = article['headline']! as String;
      final Finder headlineWidget = find.byWidgetPredicate(
        (Widget widget) => widget is Text && widget.data == headline,
        description: 'rendered publisher headline',
      );
      await _waitFor(tester, headlineWidget);
      expect(find.text('Diario El Día · www.diarioeldia.cl'), findsWidgets);
      expect(
        find.textContaining(
          'Bloqueado: los derechos registrados no cubren esta operación semántica.',
        ),
        findsWidgets,
      );
      expect(
        find.textContaining(
          'Occurrence / Thread: sin asignación en Dialektik.',
        ),
        findsWidgets,
      );

      final Finder openButton = find.text('Abrir en el sitio de origen');
      expect(openButton, findsWidgets);
      await tester.ensureVisible(openButton.first);
      await tester.tap(openButton.first);
      await tester.pump();
      expect(openedSource, Uri.parse(article['canonical_url']! as String));

      if (officialVoteId.isNotEmpty) {
        final Finder voteTab = find.descendant(
          of: find.byType(TabBar),
          matching: find.text('Eventos oficiales'),
        );
        await tester.tap(voteTab);
        await tester.pumpAndSettle();
        await _waitFor(tester, find.textContaining('votación $officialVoteId'));
        expect(
          find.textContaining('Occurrence: ROLL_CALL_VOTE'),
          findsOneWidget,
        );
        expect(find.textContaining('Thread: UNKNOWN'), findsOneWidget);
        expect(
          find.textContaining('corroboración independiente: NONE'),
          findsOneWidget,
        );
      }
    },
    skip: apiUrl.isEmpty || ownerToken.isEmpty || sourceId.isEmpty,
  );
}

final class _LocalHttpOverrides extends HttpOverrides {}

final class _ZoneHttpClient extends http.BaseClient {
  _ZoneHttpClient(this._delegate);

  final http.Client _delegate;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    final Completer<http.StreamedResponse> response =
        Completer<http.StreamedResponse>();
    Zone.root.run(() {
      _delegate
          .send(request)
          .then(
            response.complete,
            onError: (Object error, StackTrace stackTrace) {
              response.completeError(error, stackTrace);
            },
          );
    });
    return response.future;
  }

  @override
  void close() => _delegate.close();
}

Future<void> _waitFor(WidgetTester tester, Finder finder) async {
  for (int attempt = 0; attempt < 120; attempt += 1) {
    if (finder.evaluate().isNotEmpty) return;
    await tester.runAsync<void>(
      () => Future<void>.delayed(const Duration(milliseconds: 100)),
    );
    await tester.pump();
  }
  expect(finder, findsOneWidget);
}
