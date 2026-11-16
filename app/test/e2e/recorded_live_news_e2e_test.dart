import 'dart:convert';
import 'package:dialektik/app/dialektik_app.dart';
import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/features/consumer/data/public_api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import '../support/loopback_socket_client.dart';

const _baseUrl = String.fromEnvironment('DIALEKTIK_RECORDED_LIVE_BASE_URL');
const _count = int.fromEnvironment('DIALEKTIK_RECORDED_LIVE_COUNT');

void main() {
  testWidgets(
    'permitted recorded real RSS → PostgreSQL → Core HTTP → Flutter',
    (tester) async {
      final transport = LoopbackSocketClient();
      final actual = PublicApiClient(
        configuration: ApiConfiguration.fromBaseUrl(_baseUrl),
        httpClient: transport,
      );
      final captured = <String, String>{};
      late String articleId, headline, sourceName, sourceId;
      late Uri canonicalUrl;
      await tester.runAsync<void>(() async {
        final page = await actual.listLiveNews();
        expect(page.items, hasLength(_count));
        final item = page.items.first;
        articleId = item.id;
        headline = item.headline;
        sourceName = item.source.name;
        sourceId = item.source.id;
        canonicalUrl = item.canonicalUrl;
        final detail = await actual.getLiveNews(item.id);
        final provenance = await actual.getLiveProvenance(item.id);
        expect(detail.article.headline, headline);
        expect(detail.content.representation, 'feed_excerpt');
        expect(provenance.originalPublishedAt, isNotEmpty);
        for (final path in <String>[
          '/live/news?limit=25',
          '/live/sources',
          '/live/news/$articleId',
          '/live/sources/$sourceId',
          '/live/news/$articleId/provenance',
        ]) {
          final response = await transport.get(Uri.parse(_baseUrl + path));
          expect(response.statusCode, 200);
          final body = utf8.decode(response.bodyBytes);
          expect(body, isNot(contains('candidate_prediction')));
          captured[path] = body;
        }
      });
      transport.close();
      final external = <Uri>[];
      final rendered = PublicApiClient(
        configuration: ApiConfiguration.fromBaseUrl(_baseUrl),
        httpClient: MockClient((request) async {
          final key =
              request.url.path +
              (request.url.hasQuery ? '?${request.url.query}' : '');
          return http.Response(
            captured[key] ?? '{}',
            captured.containsKey(key) ? 200 : 404,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      );
      await tester.pumpWidget(
        DialektikApp(
          environment: AppEnvironment.test,
          loadInterFromDependency: false,
          consumerRepository: rendered,
          liveNewsRepository: rendered,
          initialRoute: '/live/news',
          locale: const Locale('es'),
          externalLinkOpener: (uri) async {
            external.add(uri);
            return true;
          },
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text(headline), findsOneWidget);
      expect(find.text('LIVE · SHADOW'), findsNothing);
      Future<void> tap(Finder target) async {
        await tester.ensureVisible(target);
        await tester.pumpAndSettle();
        await tester.tap(target);
        await tester.pumpAndSettle();
      }

      await tap(
        find.bySemanticsLabel(
          RegExp(
            '^(Ver noticia:|Abrir noticia más reciente:) ${RegExp.escape(headline)}',
          ),
        ),
      );
      expect(find.text('Historia aún no determinada'), findsOneWidget);
      expect(find.text('UNKNOWN'), findsNothing);
      await tap(find.bySemanticsLabel('Abrir en la fuente'));
      expect(external.single, canonicalUrl);
      await tap(find.bySemanticsLabel('Consultar fuente: $sourceName'));
      expect(find.text(sourceName), findsOneWidget);
      await tap(find.bySemanticsLabel('Volver'));
      await tap(find.text('Consultar procedencia'));
      expect(find.text('Publicación y adquisición'), findsOneWidget);
      await tap(find.text('Detalles técnicos'));
      expect(
        find.text('PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
    skip: _baseUrl.isEmpty,
  );
}
