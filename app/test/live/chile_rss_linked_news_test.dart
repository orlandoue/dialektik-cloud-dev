import 'package:dialektik/design_system/theme/dialektik_theme.dart';
import 'package:dialektik/features/live/data/chile_rss_linked_news.dart';
import 'package:dialektik/features/live/presentation/chile_rss_linked_news_panel.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String,Object?> headline(String suffix)=> <String,Object?>{
  'id':'https://www.diarioeldia.cl/noticias/2026/10/26/$suffix',
  'publisher':'Diario El Día',
  'publisher_domain':'diarioeldia.cl',
  'headline':suffix == 'uno'
      ? 'Natalia Valdebenito: &#34;El sueldo debiera ser más alto&#34; para ir a Viña'
      : 'Titular real de muestra original $suffix',
  'original_url':'https://www.diarioeldia.cl/noticias/2026/10/26/$suffix',
  'published_at':'2026-10-26T20:00:00.000Z',
  'media_category':'NEWS_LINKS_NOT_INGESTED_ARTICLES',
};
Map<String,Object?> response()=> <String,Object?>{
  'mode':'LIVE_RSS_ORIGINAL_LINK_PREVIEW',
  'country_code':'CL',
  'rights_basis':'PUBLISHER_OFFICIAL_RSS_AGGREGATION_INFORMATION',
  'rights_evidence_url':'https://www.diarioeldia.cl/rss',
  'feed_url':'https://www.diarioeldia.cl/rss/noticias/',
  'origin':'PUBLISHER_ORIGINAL_RSS',
  'persisted':false,
  'articles_reproduced':false,
  'excerpts_reproduced':false,
  'bodies_downloaded':false,
  'events_detected':false,
  'contradictions_detected':false,
  'fetched_at':'2026-10-26T21:00:00.000Z',
  'items':<Object?>[headline('uno'),headline('dos')],
};
final class FakeRss implements ChileRssLinkedNewsRepository {
  FakeRss(this.value);
  final ChileRssLinkedNews value;
  @override
  Future<ChileRssLinkedNews> loadChileRssLinkedNews({bool refresh=false}) async=>value;
}
void main(){
  test('source-backed headlines, never Article or contradiction',(){
    final data=ChileRssLinkedNews.fromJson(response());
    expect(data.items.length,2);
    expect(data.items.first.publisher,'Diario El Día');
    expect(data.items.first.originalUrl.host,'www.diarioeldia.cl');
    expect(data.items.first.headline,
        'Natalia Valdebenito: "El sueldo debiera ser más alto" para ir a Viña');
  });
  test('spoofed URL, fake license or inference flag fails closed',(){
    final d=response();
    final Map<String,Object?> poisonedItem =
        (d['items'] as List<Object?>).first! as Map<String,Object?>;
    poisonedItem['original_url']='https://attacker.example/article';
    expect(()=>ChileRssLinkedNews.fromJson(d),throwsFormatException);
    final f=response()..['events_detected']=true;
    expect(()=>ChileRssLinkedNews.fromJson(f),throwsFormatException);
    final g=response()..['rights_basis']='APPROVED_FULL_ARTICLE_REPRINT';
    expect(()=>ChileRssLinkedNews.fromJson(g),throwsFormatException);
  });
  testWidgets('displays RSS heading and original source links',(tester) async{
    final data=ChileRssLinkedNews.fromJson(response());
    await tester.pumpWidget(MaterialApp(
      theme:DialektikTheme.offWhite(loadInterFromDependency:false),
      home:Scaffold(body:SingleChildScrollView(
        child:ChileRssLinkedNewsPanel(repository:FakeRss(data)),
      )),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Titulares RSS · Chile'),findsOneWidget);
    expect(find.text('Natalia Valdebenito: "El sueldo debiera ser más alto" para ir a Viña'),findsOneWidget);
    expect(find.textContaining('Titular real de muestra original'),findsOneWidget);
    expect(find.text('Leer en el medio original'),findsNWidgets(2));
    expect(find.textContaining('no incorporada ni analizada'),findsOneWidget);
  });
}
