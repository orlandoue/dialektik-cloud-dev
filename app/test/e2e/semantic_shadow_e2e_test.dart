import 'dart:convert';
import 'package:dialektik/app/dialektik_app.dart';
import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/features/consumer/data/public_api_client.dart';
import 'package:dialektik/features/semantic/data/semantic_models.dart';
import 'package:dialektik/features/semantic/presentation/editorial_vocabulary.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import '../support/loopback_socket_client.dart';

const String _baseUrl = String.fromEnvironment(
  'DIALEKTIK_SEMANTIC_E2E_BASE_URL',
);

void main() {
  testWidgets(
    'PostgreSQL → Core HTTP → typed Flutter DTOs → navigable semantic screens',
    (WidgetTester tester) async {
      final LoopbackSocketClient transport = LoopbackSocketClient();
      final PublicApiClient live = PublicApiClient(
        configuration: ApiConfiguration.fromBaseUrl(_baseUrl),
        httpClient: transport,
      );
      late SemanticThreadDto alpha;
      late SemanticThreadDto gamma;
      late SemanticOccurrenceDto occurrence;
      late SemanticOccurrenceDto unresolvedOccurrence;
      final Map<String, String> captured = <String, String>{};
      await tester.runAsync<void>(() async {
        final SemanticThreadPageDto threads = await live.listSemanticThreads();
        alpha = threads.items.firstWhere(
          (SemanticThreadDto item) => item.title.startsWith('Puerto Claro'),
        );
        gamma = threads.items.firstWhere(
          (SemanticThreadDto item) =>
              item.state.decision == SemanticDecision.unknown,
        );
        final SemanticThreadDetailDto detail = await live.getSemanticThread(
          alpha.id,
        );
        expect(detail.occurrences, hasLength(3));
        occurrence = await live.getSemanticOccurrence(
          detail.occurrences.first.id,
        );
        expect(occurrence.sources, hasLength(3));
        expect(
          (await live.getArticleSemanticContext(
            occurrence.articles.first.id,
          )).memberships,
          hasLength(1),
        );
        final SemanticThreadDetailDto unresolved = await live.getSemanticThread(
          gamma.id,
        );
        expect(
          unresolved.thread.state.applicability,
          SemanticApplicability.unknown,
        );
        unresolvedOccurrence = await live.getSemanticOccurrence(
          unresolved.occurrences.single.id,
        );
        expect(unresolvedOccurrence.state.decision, SemanticDecision.unknown);
        expect(unresolvedOccurrence.eventAt, isNull);
        expect(
          (await live.getArticleSemanticContext(
            unresolvedOccurrence.articles.first.id,
          )).memberships.single.decision,
          SemanticDecision.unknown,
        );
        for (final String path in <String>[
          '/v1/feed',
          '/semantic/threads',
          '/semantic/threads/${alpha.id}',
          '/semantic/threads/${gamma.id}',
          '/semantic/occurrences/${occurrence.id}',
          '/semantic/articles/${occurrence.articles.first.id}',
          '/articles/${occurrence.articles.first.id}/semantic-context',
          '/v1/sources/${occurrence.articles.first.source.id}',
          '/semantic/occurrences/${unresolvedOccurrence.id}',
          '/semantic/articles/${unresolvedOccurrence.articles.first.id}',
          '/articles/${unresolvedOccurrence.articles.first.id}/semantic-context',
          ...occurrence.provenance.map(
            (SemanticProvenanceDto item) => '/semantic/provenance/${item.id}',
          ),
          ...unresolvedOccurrence.provenance.map(
            (SemanticProvenanceDto item) => '/semantic/provenance/${item.id}',
          ),
        ]) {
          final http.Response response = await transport.get(
            Uri.parse('$_baseUrl$path'),
          );
          expect(response.statusCode, 200, reason: path);
          captured[path] = response.body;
        }
      });
      transport.close();
      final PublicApiClient rendered = PublicApiClient(
        configuration: ApiConfiguration.fromBaseUrl(_baseUrl),
        httpClient: MockClient(
          (http.Request request) async => http.Response(
            captured[request.url.path] ?? jsonEncode(<String, Object?>{}),
            captured.containsKey(request.url.path) ? 200 : 404,
            headers: <String, String>{'content-type': 'application/json'},
          ),
        ),
      );
      await tester.pumpWidget(
        DialektikApp(
          environment: AppEnvironment.test,
          loadInterFromDependency: false,
          consumerRepository: rendered,
          semanticRepository: rendered,
          initialRoute: '/threads',
          locale: const Locale('es'),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text(editorialTitle(alpha.title)), findsOneWidget);
      expect(find.text('DEMO'), findsOneWidget);
      await tester.tap(
        find.bySemanticsLabel(
          RegExp(
            '^Abrir historia: ${RegExp.escape(editorialTitle(alpha.title))}\\.',
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Cómo evoluciona'), findsOneWidget);
      expect(find.text('Eventos en orden cronológico'), findsOneWidget);
      expect(
        find.bySemanticsLabel(RegExp('^Evento 3 de 3\\.')),
        findsOneWidget,
      );
      final Finder firstEvent = find.bySemanticsLabel(
        RegExp('^Evento 1 de 3\\.'),
      );
      await tester.ensureVisible(firstEvent);
      await tester.tap(firstEvent);
      await tester.pumpAndSettle();
      expect(find.text('Cobertura'), findsOneWidget);
      expect(find.text('3 noticias · 3 fuentes'), findsOneWidget);
      final SemanticArticleDto article = occurrence.articles.first;
      final Finder firstNews = find.bySemanticsLabel(
        RegExp(
          '^Leer noticia: ${RegExp.escape(editorialTitle(article.title))}\\.',
        ),
      );
      await tester.ensureVisible(firstNews);
      await tester.tap(firstNews);
      await tester.pumpAndSettle();
      expect(find.text('Resumen'), findsOneWidget);
      expect(find.text('Texto original'), findsNothing);
      expect(find.textContaining('DEMOSTRACIÓN SINTÉTICA'), findsNothing);
      await tester.ensureVisible(find.bySemanticsLabel('Leer texto completo'));
      await tester.pumpAndSettle();
      await tester.tap(find.bySemanticsLabel('Leer texto completo'));
      await tester.pumpAndSettle();
      expect(find.text('Texto original'), findsOneWidget);
      expect(find.textContaining('DEMOSTRACIÓN SINTÉTICA'), findsOneWidget);
      expect(
        find.text(
          SemanticArticleDetailDto.fromJson(
            jsonDecode(captured['/semantic/articles/${article.id}']!),
          ).originalText,
        ),
        findsOneWidget,
      );
      expect(find.text('Dónde encaja esta noticia'), findsOneWidget);
      expect(find.text('Etapa 1 de 3'), findsOneWidget);
      expect(find.text('2 fuentes'), findsOneWidget);
      final Finder source = find.bySemanticsLabel(
        'Abrir fuente: ${editorialSourceName(article.source.name)}',
      );
      await tester.ensureVisible(source);
      await tester.tap(source);
      await tester.pumpAndSettle();
      expect(
        find.text(editorialSourceName(article.source.name)),
        findsOneWidget,
      );
      expect(find.text('DEMO'), findsOneWidget);
      await tester.tap(find.bySemanticsLabel('Volver'));
      await tester.pumpAndSettle();
      expect(find.text('Texto original'), findsOneWidget);
      expect(find.text('Etapa 1 de 3'), findsOneWidget);
      final Finder why = find
          .bySemanticsLabel(RegExp('^¿Por qué está aquí\\?'))
          .first;
      await tester.ensureVisible(why);
      await tester.tap(why);
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Esta noticia describe el evento'),
        findsOneWidget,
      );
      expect(find.text('Cobertura del evento'), findsOneWidget);
      expect(find.textContaining('Proveedor:'), findsNothing);
      expect(find.textContaining('Versión:'), findsNothing);
      await tester.ensureVisible(find.bySemanticsLabel('Detalles técnicos'));
      await tester.tap(find.bySemanticsLabel('Detalles técnicos'));
      await tester.pumpAndSettle();
      expect(find.text('Proveedor: fixture'), findsOneWidget);
      expect(
        find.text('Versión: ${occurrence.provenance.first.providerVersion}'),
        findsOneWidget,
      );
      expect(find.text(occurrence.provenance.first.rationale), findsOneWidget);
      expect(find.textContaining('payload_hash'), findsNothing);
      await tester.tap(find.bySemanticsLabel('dialektik · Ir a Historias'));
      await tester.pumpAndSettle();
      final Finder unknownStory = find.bySemanticsLabel(
        RegExp(
          '^Abrir historia: ${RegExp.escape(editorialTitle(gamma.title))}\\.',
        ),
      );
      await tester.ensureVisible(unknownStory);
      await tester.tap(unknownStory);
      await tester.pumpAndSettle();
      expect(find.text('Relación sin resolver'), findsWidgets);
      expect(find.text('Comparabilidad sin resolver'), findsWidgets);
      final Finder unknownEvent = find.bySemanticsLabel(
        RegExp('^Evento 1 de 1\\.'),
      );
      await tester.ensureVisible(unknownEvent);
      await tester.tap(unknownEvent);
      await tester.pumpAndSettle();
      expect(find.text('Fecha del evento sin determinar'), findsOneWidget);
      expect(find.textContaining('Etapa 1 de'), findsNothing);
      final Finder unknownNews = find.bySemanticsLabel(
        RegExp(
          '^Leer noticia: ${RegExp.escape(editorialTitle(unresolvedOccurrence.articles.first.title))}\\.',
        ),
      );
      await tester.ensureVisible(unknownNews);
      await tester.tap(unknownNews);
      await tester.pumpAndSettle();
      expect(find.text('Resumen'), findsOneWidget);
      expect(find.text('Texto original'), findsNothing);
      await tester.ensureVisible(find.bySemanticsLabel('Leer texto completo'));
      await tester.pumpAndSettle();
      await tester.tap(find.bySemanticsLabel('Leer texto completo'));
      await tester.pumpAndSettle();
      expect(
        find.text(
          SemanticArticleDetailDto.fromJson(
            jsonDecode(
              captured['/semantic/articles/${unresolvedOccurrence.articles.first.id}']!,
            ),
          ).originalText,
        ),
        findsOneWidget,
      );
      expect(find.textContaining('Etapa 1 de'), findsNothing);
      expect(find.textContaining('Asociación sin resolver'), findsOneWidget);
      expect(
        find.textContaining('Comparabilidad sin resolver'),
        findsOneWidget,
      );
      expect(find.text('No se pudo cargar el contenido.'), findsNothing);
      expect(find.byIcon(Icons.error), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      rendered.close();
      live.close();
    },
    skip: _baseUrl.isEmpty,
  );
}
