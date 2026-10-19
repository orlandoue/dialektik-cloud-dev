import 'package:dialektik/app/dialektik_app.dart';
import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/features/consumer/presentation/navigation/consumer_routes.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/public_api_fixtures.dart';

void main() {
  testWidgets('application shell mounts the Event-first consumer feed', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      DialektikApp(
        environment: AppEnvironment.test,
        loadInterFromDependency: false,
        consumerRepository: FakeConsumerRepository(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Dialektik'), findsOneWidget);
    expect(
      find.text('Banco central publica decisión de tasas'),
      findsOneWidget,
    );
    expect(find.text('Central bank holds benchmark rate'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('application shell can mount the authorized internal tool', (
    WidgetTester tester,
  ) async {
    const Key internalToolKey = Key('internal-moderation-tool');
    await tester.pumpWidget(
      const DialektikApp(
        environment: AppEnvironment.test,
        loadInterFromDependency: false,
        internalModerationHome: SizedBox(key: internalToolKey),
      ),
    );

    expect(find.byKey(internalToolKey), findsOneWidget);
    expect(find.text('Eventos'), findsNothing);
  });

  testWidgets('consumer router does not register moderation routes', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      DialektikApp(
        environment: AppEnvironment.test,
        loadInterFromDependency: false,
        consumerRepository: FakeConsumerRepository(),
        initialRoute: '/v1/mod/tasks',
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.text('Banco central publica decisión de tasas'),
      findsOneWidget,
    );
    expect(find.byKey(const Key('internal-moderation-tool')), findsNothing);
    expect(ConsumerRoutes.feed, '/');
  });
}
