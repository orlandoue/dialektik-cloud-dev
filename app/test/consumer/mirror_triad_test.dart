import 'package:dialektik/design_system/theme/dialektik_theme.dart';
import 'package:dialektik/features/consumer/data/following_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/screens/synthesis_screen.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/live/presentation/mirror_screen.dart';
import 'package:dialektik/features/live/presentation/widgets/youtube_thumbnail.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../live/live_fixtures.dart';
import '../support/public_api_fixtures.dart';

class _MirrorRepo extends Fake implements LiveNewsRepository, ScopedLiveNewsRepository, FollowingRepository, MirrorNewsMemory {
  final ValueNotifier<int> changes=ValueNotifier<int>(0);
  final Set<String> ids={};
  LiveNewsPageDto? cached;
  int requests=0;
  @override LiveNewsPageDto? get cachedMirrorNews=>cached;
  @override Set<String>? get cachedFollowedSources=>cached == null ? null : Set.of(ids);
  @override Future<void> prefetchMirrorNews() async {}
  @override bool get followingAvailable=>true;
  @override Listenable get followingChanges=>changes;
  @override Future<Set<String>> listFollowedSources() async=>Set.of(ids);
  @override Future<void> setFollowing(String sourceId,{required bool following}) async {if(following){ids.add(sourceId);}else{ids.remove(sourceId);}changes.value++;}
  @override Future<BlindspotsResult> listBlindspots() async=>const BlindspotsResult(items:[],total:0,followedSourceCount:0);
  @override Future<LiveNewsPageDto> listScopedLiveNews({required String scope,String? cursor,String? format,String? topic,String? query,String? sourceId,DateTime? publishedFrom,DateTime? publishedTo,bool refresh=false,PublicRequestToken? requestToken}) async {
    requests++;
    final item=liveTestArticle();
    return LiveNewsPageDto.fromJson({'origin':'LIVE_REAL','semantic_mode':'unassigned','items':ids.contains(liveTestSourceId)?<Object?>[]:<Object?>[item],'next_cursor':null});
  }
}
void main(){
  testWidgets('mirror shows unfollowed sources and removes an item after following', (tester) async {
    final repo=_MirrorRepo();addTearDown(repo.changes.dispose);
    await tester.pumpWidget(MaterialApp(theme:DialektikTheme.offWhite(loadInterFromDependency:false),home:MirrorScreen(repository:repo,onOpenArticle:(_){},onOpenSources:(){})));
    await tester.pumpAndSettle();
    expect(find.textContaining('FUERA DE TUS FUENTES'),findsOneWidget);
    await tester.tap(find.text('Seguir medio'));
    await tester.pumpAndSettle();
    expect(repo.ids,contains(liveTestSourceId));
    expect(find.textContaining('FUERA DE TUS FUENTES'),findsNothing);
  });
  testWidgets('mirror displays the shared cached page immediately', (tester) async {
    final repo=_MirrorRepo(); addTearDown(repo.changes.dispose);
    repo.cached=LiveNewsPageDto.fromJson({'origin':'LIVE_REAL','semantic_mode':'unassigned','items':<Object?>[liveTestArticle()],'next_cursor':null});
    await tester.pumpWidget(MaterialApp(theme:DialektikTheme.offWhite(loadInterFromDependency:false),home:MirrorScreen(repository:repo,onOpenArticle:(_){},onOpenSources:(){})));
    expect(find.textContaining('FUERA DE TUS FUENTES'),findsOneWidget);
    expect(repo.requests,0);
  });
  testWidgets('mirror links an article to a verified public event', (tester) async {
    final repo=_MirrorRepo(); addTearDown(repo.changes.dispose);
    final article={...liveTestArticle(),'semantic_assignment':'EVENT_LINKED'};
    repo.cached=LiveNewsPageDto.fromJson({'origin':'LIVE_REAL','semantic_mode':'mixed','items':<Object?>[article],'next_cursor':null});
    final event=EventDetailDto.fromJson({...eventDetailJson(id:publishedEventId,analysisState:'PUBLISHED',positionCount:2),
      'positions':<Object?>[], 'contrasts':<Object?>[], 'articles':<Object?>[
        {'id':liveTestArticleId,'title':'Nota','source_name':'Medio','published_at':'2026-10-30T12:00:00Z','url':'https://example.com/a'},
      ]});
    final consumer=FakeConsumerRepository(event:event,feedPages:[PublicPage<EventCardDto>(items:[publishedEventCard],nextCursor:null)]);
    String? opened;
    await tester.pumpWidget(MaterialApp(theme:DialektikTheme.offWhite(loadInterFromDependency:false),home:MirrorScreen(
      repository:repo,consumerRepository:consumer,onOpenEvent:(id)=>opened=id,onOpenArticle:(_){},onOpenSources:(){})));
    await tester.pumpAndSettle();
    final link=find.textContaining('Aporta otra mirada sobre:');
    expect(link,findsOneWidget);
    await tester.ensureVisible(link);
    await tester.tap(link);
    expect(opened,publishedEventId);
  });
  testWidgets('mirror opens YouTube videos directly', (tester) async {
    final repo=_MirrorRepo();addTearDown(repo.changes.dispose);
    final article={...liveTestArticle(),'canonical_url':'https://www.youtube.com/watch?v=aB3_deF-123'};
    repo.cached=LiveNewsPageDto.fromJson({'origin':'LIVE_REAL','semantic_mode':'unassigned','items':<Object?>[article],'next_cursor':null});
    Uri? opened;
    await tester.pumpWidget(MaterialApp(theme:DialektikTheme.offWhite(loadInterFromDependency:false),home:MirrorScreen(repository:repo,onOpenArticle:(_){fail('Video opened in article screen');},onOpenSources:(){},externalLinkOpener:(uri) async {opened=uri;return true;})));
    await tester.pump();
    expect(find.byType(YouTubeThumbnail),findsOneWidget);
    final title=find.text('Noticia escrita para pruebas: océano & atmósfera — señales');
    await tester.ensureVisible(title);
    await tester.pump();
    await tester.tap(title);
    await tester.pump();
    expect(opened.toString(),'https://www.youtube.com/watch?v=aB3_deF-123');
  });
  testWidgets('synthesis filters editorial classifications without personal filters', (tester) async {
    final e=EventCardDto(id:publishedEventCard.id,titleDescriptive:publishedEventCard.titleDescriptive,
      category:publishedEventCard.category,detectedAt:publishedEventCard.detectedAt,
      analysisState:publishedEventCard.analysisState,sourceCount:publishedEventCard.sourceCount,
      positionCount:publishedEventCard.positionCount,synthesisRelation:'DIFFERENT_FOCUS',isFollowedSourceMatch:true);
    final repo=FakeConsumerRepository(feedPages:[PublicPage<EventCardDto>(items:[e],nextCursor:null)]);
    await tester.pumpWidget(MaterialApp(theme:DialektikTheme.offWhite(loadInterFromDependency:false),
      home:SynthesisScreen(repository:repo,onOpenEvent:(_){})));
    await tester.pumpAndSettle();
    expect(find.text('${e.sourceCount} MEDIOS · DISTINTO ENFOQUE'),findsOneWidget);
    expect(find.text('En tus fuentes'),findsNothing);
    expect(find.text('Punto ciego'),findsNothing);
    await tester.ensureVisible(find.text('Distinto enfoque'));
    await tester.tap(find.text('Distinto enfoque'));
    await tester.pumpAndSettle();
    expect(find.text(e.titleDescriptive),findsOneWidget);
    await tester.ensureVisible(find.text('Contradicción'));
    await tester.tap(find.text('Contradicción'));
    await tester.pumpAndSettle();
    expect(find.text('No hay acontecimientos en este filtro.'),findsOneWidget);
  });
  testWidgets('synthesis refreshes on return and on pull to refresh', (tester) async {
    final repo=FakeConsumerRepository(feedPages:[PublicPage<EventCardDto>(items:[publishedEventCard],nextCursor:null)]);
    final selected=ValueNotifier<String>('feed'); addTearDown(selected.dispose);
    await tester.pumpWidget(MaterialApp(theme:DialektikTheme.offWhite(loadInterFromDependency:false),home:SynthesisScreen(
      repository:repo,onOpenEvent:(_){},refreshSignal:selected,isVisible:()=>selected.value=='feed')));
    await tester.pumpAndSettle();
    expect(repo.feedCalls,1);
    selected.value='other';
    await tester.pumpAndSettle();
    expect(repo.feedCalls,1);
    selected.value='feed';
    await tester.pumpAndSettle();
    expect(repo.feedCalls,2);
    await tester.widget<RefreshIndicator>(find.byType(RefreshIndicator)).onRefresh();
    await tester.pumpAndSettle();
    expect(repo.feedCalls,3);
  });
  testWidgets('synthesis shows compact video coverage and opens the original', (tester) async {
    final event=EventDetailDto.fromJson({...eventDetailJson(id:publishedEventId,analysisState:'PUBLISHED',positionCount:2),
      'positions':<Object?>[], 'contrasts':<Object?>[], 'articles':<Object?>[
        {'id':'video','title':'Entrevista en video','source_name':'Canal (YouTube)',
          'published_at':'2026-10-30T12:00:00Z','url':'https://youtu.be/aB3_deF-123'},
      ]});
    final repo=FakeConsumerRepository(event:event,feedPages:[PublicPage<EventCardDto>(items:[publishedEventCard],nextCursor:null)]);
    Uri? opened;
    await tester.pumpWidget(MaterialApp(theme:DialektikTheme.offWhite(loadInterFromDependency:false),
      home:SynthesisScreen(repository:repo,onOpenEvent:(_){},externalLinkOpener:(uri) async {opened=uri;return true;})));
    await tester.pump();await tester.pump(const Duration(milliseconds:200));
    final preview=tester.widget<YouTubeThumbnail>(find.byType(YouTubeThumbnail));
    expect(preview.compact,isTrue);
    await tester.ensureVisible(find.byType(YouTubeThumbnail));
    await tester.tap(find.byType(YouTubeThumbnail));
    await tester.pump();
    expect(opened.toString(),'https://youtu.be/aB3_deF-123');
  });
}
