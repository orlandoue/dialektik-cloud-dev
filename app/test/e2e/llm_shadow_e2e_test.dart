import 'dart:convert';
import 'package:dialektik/app/dialektik_app.dart';
import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/features/consumer/data/public_api_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import '../support/loopback_socket_client.dart';

const _base = String.fromEnvironment('DIALEKTIK_LLM_E2E_BASE_URL');
const _run = String.fromEnvironment('DIALEKTIK_LLM_E2E_RUN_ID');

void main() {
  testWidgets(
    'sealed PostgreSQL LLM graph → actual Core → strict Flutter DTO → shadow reader',
    (tester) async {
      final socket = LoopbackSocketClient();
      final client = PublicApiClient(
        configuration: ApiConfiguration.fromBaseUrl(_base),
        httpClient: socket,
      );
      late String response;
      await tester.runAsync<void>(() async {
        final graph = (await client.getSemanticGraph(runId: _run)).selected!;
        expect(graph.run.id, _run);
        expect(graph.run.llm!.model, 'recorded-product-v1');
        expect(graph.inputs, hasLength(6));
        expect(graph.occurrences, hasLength(3));
        expect(graph.threads, hasLength(2));
        expect(
          graph.occurrences.where((o) => o.articleIds.length > 1),
          hasLength(1),
        );
        expect(
          graph.threads.where((t) => t.occurrenceKeys.length > 1),
          hasLength(1),
        );
        expect(graph.identityUnknown, greaterThan(0));
        expect(
          graph.inputs.every(
            (i) =>
                i.article.envelope!.llm!.fields['evidenceVerification'] ==
                'VERIFIED',
          ),
          isTrue,
        );
        final raw = await socket.get(
          Uri.parse('$_base/shadow/semantic/graph?run_id=$_run'),
        );
        expect(raw.statusCode, 200);
        response = utf8.decode(raw.bodyBytes);
        expect(response, isNot(contains('GEMINI_API_KEY')));
      });
      socket.close();
      final rendered = PublicApiClient(
        configuration: ApiConfiguration.fromBaseUrl(_base),
        httpClient: MockClient(
          (r) async => http.Response(
            response,
            200,
            headers: {'content-type': 'application/json'},
          ),
        ),
      );
      addTearDown(rendered.close);
      await tester.pumpWidget(
        DialektikApp(
          environment: AppEnvironment.test,
          loadInterFromDependency: false,
          liveNewsRepository: rendered,
          initialRoute: '/shadow/semantic/graph?run_id=$_run',
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('LLM Semantic Shadow'), findsWidgets);
      expect(find.textContaining('UNASSIGNED'), findsWidgets);
      expect(find.textContaining('sin llamadas a Gemini'), findsWidgets);
      expect(tester.takeException(), isNull);
    },
    skip: _base.isEmpty || _run.isEmpty,
  );
}
