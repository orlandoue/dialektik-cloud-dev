import 'package:dialektik/design_system/theme/dialektik_theme.dart';
import 'package:dialektik/features/live/data/chile_rss_links.dart';
import 'package:dialektik/features/live/presentation/chile_rss_headlines_panel.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, Object?> sample(){
  const String url='https://www.cooperativa.cl/noticias/pais/reportaje/2026-10-26/190000.html';
  const String feed='https://www.cooperativa.cl/noticias/site/tax/port/all/rss____1.xml';
  return <String,Object?>{
    'mode':'SOURCE_RSS_LINKS_READ_ONLY_BETA',
    'country_code':'CL',
    'publisher':'Cooperativa.cl',
    'source_feed_url':feed,
    'rights_status':'LINK_NAVIGATION_ONLY_RIGHTS_REVIEW_PENDING',
    'content_republication_authorized':false,
    'persisted':false,
    'semantic_events_published':false,
    'contradictions_generated':false,
    'inspected_at':'2026-10-26T21:10:00.000Z',
    'items': <Object?>[
      <String,Object?>{
        'content_id':'a'*64,
        'headline':'Natalia Valdebenito: &quot;El sueldo debiera ser más alto&quot; &amp; entrevista &#39;especial&#39; &ndash; hoy',
        'publisher':'Cooperativa.cl',
        'canonical_url':url,
        'published_at':'2026-10-26T20:00:00.000Z',
        'source_feed_url':feed,
      },
    ],
  };
}
final class FakeRssRepository implements ChileRssLinksRepository{
  const FakeRssRepository(this.value);
  final ChileRssLinksPreview value;
  @override
  Future<ChileRssLinksPreview> loadChileRssLinks({bool refresh=false}) async => value;
}
void main(){
  test('only authentic original source URL, no persisted articles or false license',(){
    final ChileRssLinksPreview parsed=ChileRssLinksPreview.fromJson(sample());
    expect(parsed.items.single.canonicalUrl.host,'www.cooperativa.cl');
    expect(parsed.items.single.publishedAt.year,2026);
    expect(parsed.items.single.headline,
        'Natalia Valdebenito: "El sueldo debiera ser más alto" & entrevista \'especial\' – hoy');
    final Map<String,Object?> spoof=sample()..['persisted']=true;
    expect(()=>ChileRssLinksPreview.fromJson(spoof),throwsFormatException);
    final Map<String,Object?> poison=sample();
    final Map<String,Object?> row=(poison['items'] as List<Object?>).first! as Map<String,Object?>;
    row['canonical_url']='https://evil.example/phishing';
    expect(()=>ChileRssLinksPreview.fromJson(poison),throwsFormatException);
  });
  testWidgets('RSS beta card shows source headline and original navigation link',(tester) async{
    final ChileRssLinksPreview parsed=ChileRssLinksPreview.fromJson(sample());
    await tester.pumpWidget(MaterialApp(
      theme:DialektikTheme.offWhite(loadInterFromDependency:false),
      home:Scaffold(body:SingleChildScrollView(
        child:ChileRssHeadlinesPanel(repository:FakeRssRepository(parsed)),
      )),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Titulares RSS en vivo'),findsOneWidget);
    expect(find.text('Natalia Valdebenito: "El sueldo debiera ser más alto" & entrevista \'especial\' – hoy'),findsOneWidget);
    expect(find.text('Leer en Cooperativa'),findsOneWidget);
    expect(find.textContaining('No se almacena el artículo'),findsOneWidget);
  });
}
