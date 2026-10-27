import 'package:dialektik/design_system/theme/dialektik_theme.dart';
import 'package:dialektik/features/live/data/chile_rss_chronology.dart';
import 'package:dialektik/features/live/presentation/chile_rss_chronology_panel.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String,Object?> item(String source,String slug,String time) {
  final String publisher=source=='cl_diario_eldia_rss'?'Diario El Día':'Cooperativa.cl';
  final String url=source=='cl_diario_eldia_rss'
    ? 'https://www.diarioeldia.cl/noticias/2026/10/27/$slug'
    : 'https://www.cooperativa.cl/noticias/pais/$slug';
  return <String,Object?>{
    'item_key':'$source:$url','source_id':source,'publisher':publisher,
    'title':'Titular de prueba verificado $slug',
    'original_url':url,'published_at':time,
    'content_kind':'PUBLISHER_RSS_TITLE_AND_DEEP_LINK',
  };
}
Map<String,Object?> payload()=> <String,Object?>{
  'mode':'CHILE_MULTI_PUBLISHER_RSS_LINK_TIMELINE',
  'country_code':'CL',
  'refreshed_at':'2026-10-27T06:00:00.000Z',
  'publisher_count':2,
  'sources':<Object?>[
    <String,Object?>{'id':'cl_diario_eldia_rss','publisher':'Diario El Día',
      'status':'AVAILABLE','count':1},
    <String,Object?>{'id':'cl_cooperativa_rss','publisher':'Cooperativa.cl',
      'status':'AVAILABLE','count':1},
  ],
  'items':<Object?>[
    item('cl_cooperativa_rss','recent','2026-10-27T05:30:00.000Z'),
    item('cl_diario_eldia_rss','older','2026-10-27T04:00:00.000Z'),
  ],
  'persisted':false,'full_articles_downloaded':false,
  'story_text_republished':false,'semantic_grouping_performed':false,
  'contradictions_generated':false,'independent_events_claimed':0,
};
final class MockTimeline implements ChileRssChronologyRepository{
  MockTimeline(this.data);
  final ChileRssChronology data;
  @override
  Future<ChileRssChronology> loadChileRssChronology({bool refresh=false}) async=>data;
}
void main(){
  test('two real-source identities and chronological order retained',(){
    final ChileRssChronology data=ChileRssChronology.fromJson(payload());
    expect(data.sources.length,2);
    expect(data.items.first.publisher,'Cooperativa.cl');
    expect(data.items.last.publisher,'Diario El Día');
    expect(data.items.first.publishedAt.isAfter(data.items.last.publishedAt),isTrue);
  });
  test('forged URL, order, or semantic publication assertions fail closed',(){
    final Map<String,Object?> forged=payload();
    final List<Object?> items=forged['items']! as List<Object?>;
    final Map<String,Object?> first=items.first! as Map<String,Object?>;
    first['original_url']='https://evil.example/noticia';
    expect(()=>ChileRssChronology.fromJson(forged),throwsFormatException);
    final Map<String,Object?> unsorted=payload();
    (unsorted['items']! as List<Object?>).reverse;
    unsorted['items']=(unsorted['items']! as List<Object?>).reversed.toList();
    expect(()=>ChileRssChronology.fromJson(unsorted),throwsFormatException);
    final Map<String,Object?> claim=payload();
    claim['semantic_grouping_performed']=true;
    expect(()=>ChileRssChronology.fromJson(claim),throwsFormatException);
  });
  testWidgets('renders both publishers in one compact chronological card',(tester) async{
    final ChileRssChronology data=ChileRssChronology.fromJson(payload());
    await tester.pumpWidget(MaterialApp(
      theme:DialektikTheme.offWhite(loadInterFromDependency:false),
      home:Scaffold(body:SingleChildScrollView(
        child:ChileRssChronologyPanel(repository:MockTimeline(data)),
      )),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Noticias RSS · Chile'),findsOneWidget);
    expect(find.textContaining('Titular de prueba verificado'),findsNWidgets(2));
    expect(find.textContaining('Cooperativa.cl ·'),findsOneWidget);
    expect(find.textContaining('Diario El Día ·'),findsOneWidget);
    expect(find.text('Leer en medio original'),findsNWidgets(2));
  });
}
