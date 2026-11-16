import 'dart:convert';
import 'package:dialektik/app/dialektik_app.dart';
import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/features/consumer/data/public_api_client.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import '../support/loopback_socket_client.dart';

const String _baseUrl = String.fromEnvironment('DIALEKTIK_LIVE_E2E_BASE_URL');

Future<void> _tap(WidgetTester tester, Finder target) async {
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
  await tester.tap(target);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'authored RSS adapter → PostgreSQL → actual Core HTTP → live Flutter readers',
    (WidgetTester tester) async {
      final LoopbackSocketClient transport = LoopbackSocketClient();
      final PublicApiClient actual = PublicApiClient(
        configuration: ApiConfiguration.fromBaseUrl(_baseUrl),
        httpClient: transport,
      );
      late LiveNewsItemDto article;
      late LiveNewsDetailDto detail;
      late LiveSourceDetailDto source;
      final Map<String, String> captured = <String, String>{};
      await tester.runAsync<void>(() async {
        final LiveNewsPageDto page = await actual.listLiveNews();
        expect(page.items, hasLength(2));
        article = page.items.firstWhere(
          (LiveNewsItemDto item) => item.headline.contains('observatorio'),
        );
        detail = await actual.getLiveNews(article.id);
        source = await actual.getLiveSource(article.source.id);
        final LiveProvenanceDto provenance = await actual.getLiveProvenance(
          article.id,
        );
        expect(
          provenance.originalPublishedAt,
          'Sat, 03 Oct 2026 08:15:00 -0300',
        );
        expect(article.publishedAt, DateTime.utc(2026, 10, 3, 11, 15));
        expect(
          detail.content.text,
          'Un contrato con acentos, “comillas” y texto.',
        );
        expect(detail.content.text, isNot(contains('CUERPO NO AUTORIZADO')));
        expect((await actual.listLiveSources()).single.id, article.source.id);
        expect(
          (await actual.listLiveNews(query: 'océano')).items.single.id,
          article.id,
        );
        expect(
          (await actual.listLiveNews(sourceId: source.source.id)).items,
          hasLength(2),
        );
        for (final String path in <String>[
          '/live/news?limit=25',
          '/live/sources',
          '/live/news/${article.id}',
          '/live/sources/${article.source.id}',
          '/live/news/${article.id}/provenance',
          '/live/news?limit=25&q=oc%C3%A9ano',
        ]) {
          final http.Response response = await transport.get(
            Uri.parse(_baseUrl + path),
          );
          expect(response.statusCode, 200, reason: path);
          captured[path] = utf8.decode(response.bodyBytes);
        }
      });
      transport.close();
      final List<Uri> external = <Uri>[];
      final List<Uri> requests = <Uri>[];
      final PublicApiClient rendered = PublicApiClient(
        configuration: ApiConfiguration.fromBaseUrl(_baseUrl),
        httpClient: MockClient((http.Request request) async {
          requests.add(request.url);
          final String key =
              request.url.path +
              (request.url.hasQuery ? '?${request.url.query}' : '');
          return http.Response(
            captured[key] ?? '{}',
            captured.containsKey(key) ? 200 : 404,
            headers: <String, String>{
              'content-type': 'application/json; charset=utf-8',
            },
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
          externalLinkOpener: (Uri uri) async {
            external.add(uri);
            return true;
          },
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Noticias recientes'), findsNothing);
      expect(find.text(article.headline), findsOneWidget);
      expect(find.text('LIVE · SHADOW'), findsNothing);
      expect(find.text('DEMO'), findsNothing);
      expect(find.text('STRESS'), findsNothing);
      expect(
        requests.length,
        2,
        reason:
            'One initial news GET and one Source-filter GET; no hidden prefix routes.',
      );
      expect(
        requests.every((Uri uri) => uri.path.startsWith('/live/')),
        isTrue,
      );
      await _tap(
        tester,
        find.bySemanticsLabel(
          RegExp(
            '^(Ver noticia:|Abrir noticia más reciente:) ${RegExp.escape(article.headline)}',
          ),
        ),
      );
      expect(find.text('Historia aún no determinada'), findsOneWidget);
      expect(find.text('UNKNOWN'), findsNothing);
      expect(find.text(detail.content.text!), findsOneWidget);
      expect(find.textContaining('CUERPO NO AUTORIZADO'), findsNothing);
      await _tap(tester, find.bySemanticsLabel('Abrir en la fuente'));
      expect(external.single, article.canonicalUrl);
      await _tap(
        tester,
        find.bySemanticsLabel('Consultar fuente: ${article.source.name}'),
      );
      expect(find.text(source.source.name), findsOneWidget);
      expect(find.text(source.attribution), findsOneWidget);
      await _tap(tester, find.bySemanticsLabel('Volver'));
      await _tap(tester, find.text('Consultar procedencia'));
      expect(find.text('Publicación y adquisición'), findsOneWidget);
      expect(find.text('RSS / Atom'), findsOneWidget);
      await _tap(tester, find.text('Detalles técnicos'));
      expect(find.text('2026-10-03T11:15:00.000Z (UTC)'), findsOneWidget);
      expect(find.text('Sat, 03 Oct 2026 08:15:00 -0300'), findsOneWidget);
      expect(
        find.text('PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2'),
        findsOneWidget,
      );
      await _tap(tester, find.bySemanticsLabel('Volver'));
      await _tap(tester, find.bySemanticsLabel('Volver'));
      await tester.enterText(find.byType(TextField), 'océano');
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pumpAndSettle();
      expect(find.text(article.headline), findsOneWidget);
      expect(find.text('1 noticia visible'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
    skip: _baseUrl.isEmpty,
  );
}
