import 'package:dialektik/app/dialektik_app.dart';
import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/features/consumer/data/following_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../live/live_fixtures.dart';
import '../support/public_api_fixtures.dart';

final class _FollowingLiveRepository extends Fake implements LiveNewsRepository, FollowingRepository {
  final ValueNotifier<int> changes = ValueNotifier<int>(0);
  final Set<String> ids = <String>{};
  @override bool get followingAvailable => true;
  @override Listenable get followingChanges => changes;
  @override Future<Set<String>> listFollowedSources() async => Set<String>.of(ids);
  @override Future<void> setFollowing(String sourceId, {required bool following}) async {
    if (following) { ids.add(sourceId); } else { ids.remove(sourceId); }
    changes.value += 1;
  }
  @override Future<BlindspotsResult> listBlindspots() async => const BlindspotsResult(items: [], total: 0, followedSourceCount: 0);
  @override Future<List<LiveSourceDto>> listLiveSources({bool refresh = false, PublicRequestToken? requestToken}) async => [
    LiveSourceDto.fromJson(liveTestSource()),
    LiveSourceDto.fromJson({...liveTestSource(), 'id':'01K6MYH0000000000000000011', 'name':'Canal de prueba', 'canonical_domain':'youtube.com'}),
  ];
}

void main() {
  testWidgets('sources can be followed and filtered without hiding other sources', (tester) async {
    final repo = _FollowingLiveRepository();
    addTearDown(repo.changes.dispose);
    await tester.pumpWidget(DialektikApp(
      environment: AppEnvironment.test, loadInterFromDependency:false,
      consumerRepository: FakeConsumerRepository(), liveNewsRepository: repo,
      initialRoute:'/live/sources', locale:const Locale('es'),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Editorial de pruebas · sintético'), findsOneWidget);
    expect(find.text('Canal de prueba'), findsOneWidget);
    final button = find.text('+ Seguir').first;
    await tester.ensureVisible(button);
    await tester.tap(button);
    await tester.pumpAndSettle();
    expect(find.text('Siguiendo ✓'), findsOneWidget);
    await tester.ensureVisible(find.text('Canales de YouTube'));
    await tester.tap(find.text('Canales de YouTube'));
    await tester.pumpAndSettle();
    expect(find.text('Canal de prueba'), findsOneWidget);
    expect(find.text('Editorial de pruebas · sintético'), findsNothing);
  });
}
