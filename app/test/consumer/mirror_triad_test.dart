import 'package:dialektik/design_system/theme/dialektik_theme.dart';
import 'package:dialektik/features/consumer/data/following_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/screens/synthesis_screen.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/live/presentation/mirror_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../live/live_fixtures.dart';
import '../support/public_api_fixtures.dart';

class _MirrorRepo extends Fake implements LiveNewsRepository, ScopedLiveNewsRepository, FollowingRepository {
  final ValueNotifier<int> changes=ValueNotifier<int>(0);
  final Set<String> ids={};
  @override bool get followingAvailable=>true;
  @override Listenable get followingChanges=>changes;
  @override Future<Set<String>> listFollowedSources() async=>Set.of(ids);
  @override Future<void> setFollowing(String sourceId,{required bool following}) async {if(following){ids.add(sourceId);}else{ids.remove(sourceId);}changes.value++;}
  @override Future<BlindspotsResult> listBlindspots() async=>const BlindspotsResult(items:[],total:0,followedSourceCount:0);
  @override Future<LiveNewsPageDto> listScopedLiveNews({required String scope,String? cursor,String? format,String? topic,String? query,String? sourceId,DateTime? publishedFrom,DateTime? publishedTo,bool refresh=false,PublicRequestToken? requestToken}) async {
    final item=liveTestArticle();
    return LiveNewsPageDto.fromJson({'origin':'LIVE_REAL','semantic_mode':'unassigned','items':ids.contains(liveTestSourceId)?<Object?>[]:<Object?>[item],'next_cursor':null});
  }
}
void main(){
  testWidgets('mirror shows unfollowed sources and removes an item after following', (tester) async {
    final repo=_MirrorRepo();addTearDown(repo.changes.dispose);
    await tester.pumpWidget(MaterialApp(theme:DialektikTheme.offWhite(loadInterFromDependency:false),home:MirrorScreen(repository:repo,onOpenArticle:(_){},onOpenSources:(){})));
    await tester.pumpAndSettle();
    expect(find.text('ANTÍTESIS · FUERA DE TU ALGORITMO'),findsOneWidget);
    expect(find.textContaining('FUERA DE TUS FUENTES'),findsOneWidget);
    await tester.tap(find.text('+ Seguir medio'));
    await tester.pumpAndSettle();
    expect(repo.ids,contains(liveTestSourceId));
    expect(find.textContaining('FUERA DE TUS FUENTES'),findsNothing);
  });
  testWidgets('synthesis combines published events and contrast filters', (tester) async {
    final repo=FakeConsumerRepository(feedPages:[PublicPage<EventCardDto>(items:[publishedEventCard],nextCursor:null)]);
    await tester.pumpWidget(MaterialApp(theme:DialektikTheme.offWhite(loadInterFromDependency:false),
      home:SynthesisScreen(repository:repo,onOpenEvent:(_){})));
    await tester.pumpAndSettle();
    expect(find.text('CONTRASTE DETECTADO · 2 POSTURAS'),findsOneWidget);
    await tester.tap(find.text('Con contraste (1)'));
    await tester.pumpAndSettle();
    expect(find.text(publishedEventCard.titleDescriptive),findsOneWidget);
    await tester.ensureVisible(find.text('Punto ciego'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Punto ciego'));
    await tester.pumpAndSettle();
    expect(find.text('No hay acontecimientos en este filtro.'),findsOneWidget);
  });
}
