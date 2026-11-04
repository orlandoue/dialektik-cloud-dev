import 'package:dialektik/app/dialektik_app.dart';
import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/design_system/theme/dialektik_theme.dart';
import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/following_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/live/presentation/live_news_screens.dart';
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

final class _FollowingFeedRepository extends Fake implements ConsumerRepository, FollowingRepository {
  final ValueNotifier<int> changes = ValueNotifier<int>(0);
  @override bool get followingAvailable => true;
  @override Listenable get followingChanges => changes;
  @override Future<Set<String>> listFollowedSources() async => {'source-a','source-b'};
  @override Future<void> setFollowing(String sourceId, {required bool following}) async { changes.value += 1; }
  @override Future<BlindspotsResult> listBlindspots() async => BlindspotsResult(
    followedSourceCount:2, total:1, items:[EventCardDto.fromJson(eventCardJson(id:publishedEventId, title:'Tema no cubierto'))]);
  @override Future<PublicPage<EventCardDto>> listFeed({String? category, String? topic, String? cursor,
    int limit=20, bool refresh=false, PublicRequestToken? requestToken}) async => PublicPage(
      items:[EventCardDto.fromJson({...eventCardJson(), 'is_followed_source_match':true})], nextCursor:null);
}

void main() {
  testWidgets('sources can be followed and filtered without hiding other sources', (tester) async {
    final repo = _FollowingLiveRepository();
    addTearDown(repo.changes.dispose);
    await tester.pumpWidget(MaterialApp(theme: DialektikTheme.offWhite(loadInterFromDependency:false), home: LiveSourceListScreen(
      repository: repo, onOpenSource: (_) {},
    )));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.text('Editorial de pruebas · sintético'), findsOneWidget);
    expect(find.text('Canal de prueba'), findsOneWidget);
    final button = find.text('+ Seguir').first;
    await tester.ensureVisible(button);
    await tester.tap(button);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.text('✓ Siguiendo'), findsOneWidget);
    expect(find.textContaining('Tu mezcla: 1 fuentes en Actualidad · 1'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'Canal de prueba');
    await tester.pumpAndSettle();
    expect(find.text('Canal de prueba'), findsOneWidget);
    expect(find.text('Editorial de pruebas · sintético'), findsNothing);
  });
  testWidgets('welcome radar opens for a new reader and can be skipped', (tester) async {
    final repo=_FollowingLiveRepository(); addTearDown(repo.changes.dispose);
    await tester.pumpWidget(DialektikApp(environment:AppEnvironment.test,loadInterFromDependency:false,
      consumerRepository:FakeConsumerRepository(),liveNewsRepository:repo,initialRoute:'/live/sources',locale:const Locale('es')));
    await tester.pumpAndSettle();
    expect(find.text('Saltar'),findsOneWidget);
    expect(find.textContaining('Debate y tensión en video'),findsWidgets);
    expect(find.textContaining('Investigación y análisis'),findsWidgets);
    expect(find.textContaining('Minuto a minuto'),findsWidgets);
    await tester.tap(find.text('Saltar'));
    await tester.pumpAndSettle();
    expect(find.text('Saltar'),findsNothing);
    expect(find.text('Personaliza tu radar'),findsOneWidget);
  });
  testWidgets('feed shows followed badge and expandable blind spots', (tester) async {
    final repo = _FollowingFeedRepository();
    addTearDown(repo.changes.dispose);
    await tester.pumpWidget(DialektikApp(
      environment:AppEnvironment.test, loadInterFromDependency:false, consumerRepository:repo,
      locale:const Locale('es'),
    ));
    await tester.pumpAndSettle();
    expect(find.text('En tus fuentes'), findsOneWidget);
    expect(find.text('Punto ciego: 1 acontecimiento sin cobertura de tus medios'), findsOneWidget);
    await tester.tap(find.text('Punto ciego: 1 acontecimiento sin cobertura de tus medios'));
    await tester.pumpAndSettle();
    expect(find.text('Tema no cubierto'), findsOneWidget);
  });
}
