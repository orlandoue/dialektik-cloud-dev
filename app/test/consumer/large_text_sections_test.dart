import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/screens/synthesis_screen.dart';
import 'package:dialektik/features/consumer/presentation/widgets/consumer_navigation_action.dart';
import 'package:dialektik/features/live/presentation/widgets/youtube_thumbnail.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../support/public_api_fixtures.dart';

void main() {
  testWidgets('contrastes y desarrollo no desbordan con letra ampliada', (tester) async {
    tester.view.physicalSize=const Size(390,844); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final detail=EventDetailDto.fromJson({
      ...eventDetailJson(id:publishedEventId,analysisState:'PUBLISHED',positionCount:2),
      'positions': [
        {'id':publicContradiction.positionA.id,'title':'Resumen A','assertions':[{'id':'aa','assertion_text':'A','quoted_text':'Primera cita','article_id':'1','source_name':'Cooperativa.cl'}]},
        {'id':publicContradiction.positionB.id,'title':'Resumen B','assertions':[{'id':'bb','assertion_text':'B','quoted_text':'segunda cita','article_id':'2','source_name':'Diario El Día'}]},
      ],
      'articles': [
        {'id':'1','title':'Noticia uno','source_name':'Cooperativa.cl','published_at':'2026-10-30T12:00:00Z','url':'https://example.com/uno'},
        {'id':'2','title':'Noticia dos','source_name':'Diario El Día','published_at':'2026-10-31T12:00:00Z','url':'https://example.com/dos'},
      ], 'contrasts': <Object?>[],
    });
    final contrast=EventCardDto(id:detail.id,titleDescriptive:detail.titleDescriptive,category:'economia',detectedAt:detail.detectedAt,analysisState:detail.analysisState,sourceCount:2,positionCount:2,synthesisRelation:'DIFFERENT_FOCUS');
    final developing=EventCardDto(id:'another-development-event',titleDescriptive:detail.titleDescriptive,category:'economia',detectedAt:detail.detectedAt,analysisState:detail.analysisState,sourceCount:2,positionCount:2,synthesisRelation:'DEVELOPING');
    Uri? opened;
    Widget app(EventCardDto card, bool development) {
      final repo=FakeConsumerRepository(event:detail,feedPages:[PublicPage<EventCardDto>(items:[card],nextCursor:null)]);
      return MaterialApp(home:MediaQuery(data:const MediaQueryData(size:Size(390,844),textScaler:TextScaler.linear(1.45)),child:SynthesisScreen(repository:repo,onOpenEvent:(_){},development:development,navigationActions:[for(final label in ['Actualidad','Espejo','Contradicciones','Desarrollo','Fuentes']) ConsumerNavigationAction(label:label,selected:false,onPressed:(){})],externalLinkOpener:(uri) async {opened=uri;return true;})));
    }
    await tester.pumpWidget(app(contrast,false)); await tester.pumpAndSettle();
    expect(find.text('Termómetro de evidencia'),findsOneWidget);
    await tester.ensureVisible(find.text('Fuentes')); await tester.pumpAndSettle();
    expect(tester.getRect(find.text('Fuentes')).right,lessThanOrEqualTo(390));
    expect(find.text('“[...] segunda cita”'),findsOneWidget);
    expect(tester.takeException(),isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpWidget(app(developing,true)); await tester.pumpAndSettle();
    await tester.tap(find.byType(ExpansionTile)); await tester.pumpAndSettle();
    expect(find.text('Noticia uno'),findsOneWidget);
    expect(tester.getTopLeft(find.text('Noticia dos')).dy,lessThan(tester.getTopLeft(find.text('Noticia uno')).dy));
    await tester.ensureVisible(find.text('Noticia uno')); await tester.tap(find.text('Noticia uno')); await tester.pump();
    expect(opened.toString(),'https://example.com/uno');
    expect(find.text('Termómetro de evidencia'),findsNothing);
    expect(tester.takeException(),isNull);
  });
  testWidgets('video con letra grande usa miniatura ancha', (tester) async {
    tester.view.physicalSize=const Size(390,844); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(home:MediaQuery(data:const MediaQueryData(size:Size(390,844),textScaler:TextScaler.linear(1.45)),child:Scaffold(body:SingleChildScrollView(child:YouTubeNewsCard(videoId:'aB3_deF-123',title:'Titular del video',source:'Canal',published:'Hoy',compact:true,onTap:(){}))))));
    await tester.pump();
    expect(tester.getSize(find.byType(YouTubeThumbnail)).width,greaterThan(250));
    expect(tester.takeException(),isNull);
  });

}
