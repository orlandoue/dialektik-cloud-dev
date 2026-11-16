import 'package:dialektik/app/bootstrap/bootstrap.dart';
import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/features/consumer/presentation/navigation/consumer_routes.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'Android release requires private beta regardless of missing define',
    () {
      expect(
        requiresPrivateBetaGate(
          configuredEnvironment: AppEnvironment.development,
          isAndroidRelease: true,
        ),
        isTrue,
      );
      expect(
        requiresPrivateBetaGate(
          configuredEnvironment: AppEnvironment.production,
          isAndroidRelease: false,
        ),
        isTrue,
      );
      expect(
        requiresPrivateBetaGate(
          configuredEnvironment: AppEnvironment.development,
          isAndroidRelease: false,
        ),
        isFalse,
      );
    },
  );

  test('disabled reader honors only an existing consumer section', () {
    expect(
      selectInitialRoute(
        semanticMode: 'disabled',
        requestedInitialRoute: ConsumerRoutes.liveNews,
        inspectShadow: false,
      ),
      ConsumerRoutes.liveNews,
    );
    expect(
      selectInitialRoute(
        semanticMode: 'disabled',
        requestedInitialRoute: ConsumerRoutes.semanticShadow,
        inspectShadow: false,
      ),
      ConsumerRoutes.feed,
    );
  });

  test('unassigned startup accepts consumer section roots only', () {
    expect(isAllowedConsumerInitialRoute(ConsumerRoutes.feed), isTrue);
    expect(isAllowedConsumerInitialRoute(ConsumerRoutes.liveNews), isTrue);
    expect(isAllowedConsumerInitialRoute(ConsumerRoutes.liveSources), isTrue);
    expect(
      isAllowedConsumerInitialRoute(ConsumerRoutes.contradictions),
      isTrue,
    );
    expect(
      isAllowedConsumerInitialRoute(ConsumerRoutes.personalOwner),
      isFalse,
    );
    expect(isAllowedConsumerInitialRoute('/shadow/semantic'), isFalse);
    expect(isAllowedConsumerInitialRoute('https://example.test/'), isFalse);
  });
}
