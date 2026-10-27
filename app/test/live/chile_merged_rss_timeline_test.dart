import 'package:dialektik/design_system/theme/dialektik_theme.dart';
import 'package:dialektik/features/live/data/chile_rss_linked_news.dart' as dia;
import 'package:dialektik/features/live/data/chile_rss_links.dart' as coop;
import 'package:dialektik/features/live/presentation/chile_merged_rss_timeline.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

dia.ChileRssLinkedNews elDia() => dia.ChileRssLinkedNews(
  fetchedAt: DateTime.utc(2026, 10, 26, 21),
  items: <dia.ChileRssLink>[
    dia.ChileRssLink(
      headline:'Noticia original RSS de prueba de Diario El Día',
      publisher:'Diario El Día',
      originalUrl:Uri.parse('https://www.diarioeldia.cl/noticias/nota-de-prueba'),
      publishedAt:DateTime.utc(2026,10,26,19),
    ),
  ],
);
coop.ChileRssLinksPreview cooperativa() => coop.ChileRssLinksPreview(
  publisher:'Cooperativa.cl',
  inspectedAt:DateTime.utc(2026,10,26,21),
  items:<coop.ChileRssLink>[
    coop.ChileRssLink(
      headline:'Nota RSS más reciente de Cooperativa para prueba',
      canonicalUrl:Uri.parse('https://www.cooperativa.cl/noticias/pais/nota-de-prueba'),
      publishedAt:DateTime.utc(2026,10,26,20,30),
    ),
  ],
);
final class MockDia implements dia.ChileRssLinkedNewsRepository {
  MockDia(this.feed,{this.fails=false});
  final dia.ChileRssLinkedNews feed;
  final bool fails;
  @override
  Future<dia.ChileRssLinkedNews> loadChileRssLinkedNews({bool refresh=false}) async {
    if(fails)throw Exception('Upstream El Día unavailable');
    return feed;
  }
}
final class MockCoop implements coop.ChileRssLinksRepository {
  MockCoop(this.feed,{this.fails=false});
  final coop.ChileRssLinksPreview feed;
  final bool fails;
  @override
  Future<coop.ChileRssLinksPreview> loadChileRssLinks({bool refresh=false}) async {
    if(fails)throw Exception('Upstream Cooperativa unavailable');
    return feed;
  }
}
void main() {
  test('two RSS results merge by source date, never semantic identity',(){
    final List<ChileUnifiedRssItem> items=mergeChileRssSources(
      elDia:elDia(),cooperativa:cooperativa());
    expect(items.length,2);
    expect(items[0].publisher,'Cooperativa.cl');
    expect(items[1].publisher,'Diario El Día');
    expect(items[0].originalUrl.host,'www.cooperativa.cl');
    expect(items[1].originalUrl.host,'www.diarioeldia.cl');
  });
  testWidgets('one chronological feed renders both originals and attribution',(tester)async {
    await tester.pumpWidget(MaterialApp(
      theme:DialektikTheme.offWhite(loadInterFromDependency:false),
      home:Scaffold(body:SingleChildScrollView(child:ChileMergedRssTimeline(
        elDiaRepository:MockDia(elDia()),
        cooperativaRepository:MockCoop(cooperativa()),
      ))),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Titulares recientes · Chile'),findsOneWidget);
    expect(find.textContaining('más reciente de Cooperativa'),findsOneWidget);
    expect(find.textContaining('original RSS de prueba'),findsOneWidget);
    expect(find.textContaining('2 medios disponibles'),findsOneWidget);
    expect(find.text('Leer en el medio original'),findsNWidgets(2));
  });
  testWidgets('failure of one RSS does not suppress the other',(tester)async{
    await tester.pumpWidget(MaterialApp(
      theme:DialektikTheme.offWhite(loadInterFromDependency:false),
      home:Scaffold(body:SingleChildScrollView(child:ChileMergedRssTimeline(
        elDiaRepository:MockDia(elDia(),fails:true),
        cooperativaRepository:MockCoop(cooperativa()),
      ))),
    ));
    await tester.pumpAndSettle();
    expect(find.textContaining('1 medio disponible'),findsOneWidget);
    expect(find.textContaining('Uno de los RSS no está disponible'),findsOneWidget);
    expect(find.textContaining('más reciente de Cooperativa'),findsOneWidget);
    expect(find.textContaining('original RSS de prueba'),findsNothing);
  });
}
