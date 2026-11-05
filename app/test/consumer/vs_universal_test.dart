import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/following_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/screens/synthesis_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/public_api_fixtures.dart';

class _UniversalRepo extends Fake implements ConsumerRepository, FollowingRepository {
  final ValueNotifier<int> changes=ValueNotifier(0);
  int followedReads=0;
  @override bool get followingAvailable=>true;
  @override Listenable get followingChanges=>changes;
  @override Future<Set<String>> listFollowedSources() async {followedReads++; return {'one-followed-source'};}
  @override Future<PublicPage<EventCardDto>> listFeed({String? category,String? topic,String? cursor,int limit=20,bool refresh=false,PublicRequestToken? requestToken}) async => PublicPage(items:[EventCardDto.fromJson({...eventCardJson(id:publishedEventId,title:'Contraste en feed'),'synthesis_relation':'DIFFERENT_FOCUS'}),EventCardDto.fromJson({...eventCardJson(id:'01K4W4M7R0B000000000000099',title:'Otro contraste del feed'),'synthesis_relation':'DIFFERENT_FOCUS'})],nextCursor:null);
  @override Future<PublicPage<ContradictionDto>> listContradictions({String? cursor,int limit=20,bool refresh=false,PublicRequestToken? requestToken}) async => PublicPage(items:[ContradictionDto.fromJson({...contradictionJson(),'event_title':'Contraste en feed'}),ContradictionDto.fromJson({...contradictionJson(),'id':'01K4W4M7R0B000000000000072','event_id':'01K4W4M7R0B000000000000098','event_title':'Contraste sin evento en feed','is_followed_source_match':false})],nextCursor:null);
  @override Future<EventDetailDto> getEvent(String id,{bool refresh=false,PublicRequestToken? requestToken}) async {
    if(id=='01K4W4M7R0B000000000000098') throw Exception('Sin detalle');
    return EventDetailDto.fromJson({...eventDetailJson(id:id,analysisState:'PUBLISHED',positionCount:2),'positions':<Object?>[],'articles':<Object?>[],'contrasts':<Object?>[]});
  }
}
void main() {
  testWidgets('VS incluye publicaciones fuera del feed y no consulta fuentes seguidas', (tester) async {
    tester.view.physicalSize=const Size(390,844); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final repo=_UniversalRepo(); addTearDown(repo.changes.dispose);
    await tester.pumpWidget(MaterialApp(home:MediaQuery(data:const MediaQueryData(size:Size(390,844),textScaler:TextScaler.linear(1.45)),child:SynthesisScreen(repository:repo,onOpenEvent:(_){}))));
    await tester.pumpAndSettle();
    expect(find.text('Contraste en feed'),findsOneWidget);
    expect(find.text('Contraste sin evento en feed'),findsOneWidget);
    expect(find.text('Otro contraste del feed'),findsOneWidget);
    expect(repo.followedReads,0);
    expect(tester.takeException(),isNull);
  });
}
