import 'package:dialektik/app/dialektik_app.dart';
import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/design_system/theme/dialektik_theme.dart';
import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/following_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/data/source_sync_repository.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/live/presentation/live_news_screens.dart';
import 'package:dialektik/features/live/presentation/source_radar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../live/live_fixtures.dart';
import '../support/public_api_fixtures.dart';

final class _FollowingLiveRepository extends Fake implements LiveNewsRepository, FollowingRepository, SourceSyncRepository {
  _FollowingLiveRepository({this.items});
  final List<LiveSourceDto>? items;
  final ValueNotifier<int> changes = ValueNotifier<int>(0);
  final Set<String> ids = <String>{};
  Set<String> youtubeMatches={};
  @override Future<YouTubeSourceMatches> lookupPublicYouTubeSubscriptions(String channel) async => YouTubeSourceMatches(sourceIds:youtubeMatches,truncated:false);
  @override bool get followingAvailable => true;
  @override Listenable get followingChanges => changes;
  @override Future<Set<String>> listFollowedSources() async => Set<String>.of(ids);
  @override Future<void> setFollowing(String sourceId, {required bool following}) async {
    if (following) { ids.add(sourceId); } else { ids.remove(sourceId); }
    changes.value += 1;
  }
  @override Future<BlindspotsResult> listBlindspots() async => const BlindspotsResult(items: [], total: 0, followedSourceCount: 0);
  @override Future<LiveNewsPageDto> listLiveNews({String? cursor,int limit=25,String? query,String? sourceId,String? format,String? topic,DateTime? publishedFrom,DateTime? publishedTo,bool refresh=false,PublicRequestToken? requestToken}) async => LiveNewsPageDto.fromJson(liveTestPage());
  @override Future<List<LiveSourceDto>> listLiveSources({bool refresh = false, PublicRequestToken? requestToken}) async => items ?? [
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
    await tester.drag(find.byKey(const Key('radar-scroll')),const Offset(0,-250));
    await tester.pumpAndSettle();
    expect(find.text('Editorial de pruebas · sintético'), findsOneWidget);
    expect(find.text('Canal de prueba'), findsOneWidget);
    await tester.drag(find.byKey(const Key('radar-scroll')),const Offset(0,-350));
    await tester.pumpAndSettle();
    final button = find.text('Seguir').first;
    await tester.ensureVisible(button);
    await tester.tap(button);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.text('Siguiendo'), findsOneWidget);
    expect(find.text('Sigues 1 de 2 medios'), findsOneWidget);
    // Following one source never hides the others.
    expect(find.text('Canal de prueba'), findsOneWidget);
    expect(find.text('Editorial de pruebas · sintético'), findsOneWidget);
    // A short directory needs no search field of its own.
    expect(find.byType(TextField), findsNothing);
  });
  testWidgets('a long directory can be filtered by name', (tester) async {
    tester.view.physicalSize=const Size(800,1600); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final repo=_FollowingLiveRepository(items:[
      for(var i=10;i<26;i++) LiveSourceDto.fromJson({...liveTestSource(),'name':'Medio de prueba $i','id':'01K6MYH00000000000000000$i'}),
    ]); addTearDown(repo.changes.dispose);
    await tester.pumpWidget(MaterialApp(home:Scaffold(body:SourceRadar(repository:repo,onContinue:(){}))));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField),'prueba 12');
    await tester.pumpAndSettle();
    expect(find.text('Medio de prueba 12'),findsOneWidget);
    expect(find.text('Medio de prueba 13'),findsNothing);
  });
  testWidgets('welcome radar opens for a new reader and can be skipped', (tester) async {
    final repo=_FollowingLiveRepository(); addTearDown(repo.changes.dispose);
    await tester.pumpWidget(DialektikApp(arenaEnabled: false, environment:AppEnvironment.test,loadInterFromDependency:false,
      consumerRepository:FakeConsumerRepository(),liveNewsRepository:repo,initialRoute:'/live/sources',locale:const Locale('es')));
    await tester.pumpAndSettle();
    expect(find.text('Saltar'),findsOneWidget);
    expect(find.text('Prensa escrita y digital'),findsWidgets);
    await tester.tap(find.text('Saltar'));
    await tester.pumpAndSettle();
    expect(find.text('Saltar'),findsNothing);
    expect(find.text('Personaliza tu radar'),findsOneWidget);
    await tester.tap(find.text('Actualidad')); await tester.pumpAndSettle();
    await tester.tap(find.text('Fuentes')); await tester.pumpAndSettle();
    expect(find.text('Saltar'),findsNothing);
  });
  testWidgets('radar groups outlets by format, never by editorial style', (tester) async {
    tester.view.physicalSize=const Size(800,1600); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    LiveSourceDto source(String name,String id) => LiveSourceDto.fromJson({...liveTestSource(),'name':name,'id':id});
    final repo=_FollowingLiveRepository(items:[
      source('Sin Filtros TV','01K6MYH0000000000000000010'),
      source('CIPER Chile','01K6MYH0000000000000000011'),
      source('BioBioChile','01K6MYH0000000000000000012'),
    ]); addTearDown(repo.changes.dispose);
    await tester.pumpWidget(MaterialApp(home:Scaffold(body:SourceRadar(repository:repo,onContinue:(){}))));
    await tester.pumpAndSettle();
    // All three publish press feeds: one format group, in alphabetical order.
    for(final name in ['Sin Filtros TV','CIPER Chile','BioBioChile']) {
      expect(find.descendant(of:find.byKey(const ValueKey('radar-group-0')),matching:find.text(name)),findsOneWidget);
    }
    expect(find.textContaining('Investigación'),findsNothing);
    expect(find.textContaining('Debate y tensión'),findsNothing);
    expect(tester.getTopLeft(find.text('BioBioChile')).dy,lessThan(tester.getTopLeft(find.text('CIPER Chile')).dy));
    expect(find.text('Sigues 0 de 3 medios'),findsOneWidget);
    await tester.tap(find.text('Seguir').first); await tester.pumpAndSettle();
    expect(find.text('Sigues 1 de 3 medios'),findsOneWidget);
  });
  testWidgets('radar agrupa CIPER y sincroniza sus dos fuentes con letra grande', (tester) async {
    tester.view.physicalSize=const Size(390,844); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    LiveSourceDto source(String name,String id) => LiveSourceDto.fromJson({...liveTestSource(),'name':name,'id':id});
    final repo=_FollowingLiveRepository(items:[source('CIPER Chile','01K6MYH0000000000000000011'),source('CIPER Chile (YouTube)','01K6MYH0000000000000000012')]);
    addTearDown(repo.changes.dispose);
    await tester.pumpWidget(MaterialApp(home:MediaQuery(data:const MediaQueryData(size:Size(390,844),textScaler:TextScaler.linear(1.45)),child:Scaffold(body:SourceRadar(repository:repo,onContinue:(){})))));
    await tester.pumpAndSettle();
    await tester.drag(find.byKey(const Key('radar-scroll')),const Offset(0,-240)); await tester.pumpAndSettle();
    final group=find.byKey(const ValueKey('radar-group-0'));
    await tester.ensureVisible(group); await tester.pumpAndSettle();
    expect(find.descendant(of:group,matching:find.text('CIPER Chile')),findsOneWidget);
    expect(tester.takeException(),isNull);
    await tester.tap(find.descendant(of:group,matching:find.text('Seguir'))); await tester.pumpAndSettle();
    expect(repo.ids,{'01K6MYH0000000000000000011','01K6MYH0000000000000000012'});
    await tester.tap(find.descendant(of:group,matching:find.text('Siguiendo'))); await tester.pumpAndSettle();
    expect(repo.ids,isEmpty);
    expect(tester.takeException(),isNull);
  });
  testWidgets('importa cuentas de X escritas sin consultar una cuenta privada', (tester) async {
    final repo=_FollowingLiveRepository(items:[LiveSourceDto.fromJson({...liveTestSource(),'id':'01K6MYH0000000000000000011','name':'CIPER Chile'})]);
    addTearDown(repo.changes.dispose);
    await tester.pumpWidget(MaterialApp(home:Scaffold(body:SourceRadar(repository:repo,onContinue:(){})))); await tester.pumpAndSettle();
    await tester.tap(find.text('Importar los medios que sigues en YouTube o X')); await tester.pumpAndSettle();
    await tester.tap(find.text('Sincronizar con X')); await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last,'@ciper');
    await tester.tap(find.text('Buscar y seguir coincidencias')); await tester.pumpAndSettle();
    expect(repo.ids,{'01K6MYH0000000000000000011'});
  });
  testWidgets('importa coincidencias públicas de YouTube', (tester) async {
    final repo=_FollowingLiveRepository(items:[LiveSourceDto.fromJson({...liveTestSource(),'id':'01K6MYH0000000000000000011','name':'BioBioChile TV (YouTube)'}),LiveSourceDto.fromJson({...liveTestSource(),'id':'01K6MYH0000000000000000012','name':'BioBioChile'})]);
    repo.youtubeMatches={'01K6MYH0000000000000000011'}; addTearDown(repo.changes.dispose);
    await tester.pumpWidget(MaterialApp(home:Scaffold(body:SourceRadar(repository:repo,onContinue:(){})))); await tester.pumpAndSettle();
    await tester.tap(find.text('Importar los medios que sigues en YouTube o X')); await tester.pumpAndSettle();
    await tester.tap(find.text('Sincronizar con YouTube')); await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last,'@usuario');
    await tester.tap(find.text('Buscar y seguir coincidencias')); await tester.pumpAndSettle();
    expect(repo.ids,{'01K6MYH0000000000000000011','01K6MYH0000000000000000012'});
  });
  testWidgets('welcome is not shown when a source is already followed', (tester) async {
    final repo=_FollowingLiveRepository(); repo.ids.add(liveTestSourceId); addTearDown(repo.changes.dispose);
    await tester.pumpWidget(DialektikApp(arenaEnabled: false, environment:AppEnvironment.test,loadInterFromDependency:false,
      consumerRepository:FakeConsumerRepository(),liveNewsRepository:repo,initialRoute:'/live/sources',locale:const Locale('es')));
    await tester.pumpAndSettle();
    expect(find.text('Saltar'),findsNothing);
    expect(find.text('Personaliza tu radar'),findsOneWidget);
  });
  testWidgets('feed shows followed badge and expandable blind spots', (tester) async {
    final repo = _FollowingFeedRepository();
    addTearDown(repo.changes.dispose);
    await tester.pumpWidget(DialektikApp(
      arenaEnabled: false,
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
