import 'package:dialektik/features/live/data/html_entities.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';

abstract interface class ChileRssLinkedNewsRepository {
  Future<ChileRssLinkedNews> loadChileRssLinkedNews({bool refresh = false});
}
final class ChileRssLinkedNews {
  const ChileRssLinkedNews({required this.items,required this.fetchedAt});
  factory ChileRssLinkedNews.fromJson(Object? input) {
    final Map<String,Object?> d=liveObject(input);
    liveRequire(d,'mode','LIVE_RSS_ORIGINAL_LINK_PREVIEW');
    liveRequire(d,'origin','PUBLISHER_ORIGINAL_RSS');
    liveRequire(d,'country_code','CL');
    liveRequire(d,'rights_basis','PUBLISHER_OFFICIAL_RSS_AGGREGATION_INFORMATION');
    if(d['persisted']!=false || d['articles_reproduced']!=false ||
       d['excerpts_reproduced']!=false || d['bodies_downloaded']!=false ||
       d['events_detected']!=false || d['contradictions_detected']!=false) {
       throw const FormatException('RSS feed cannot claim articles, inference or reuse.');
    }
    final Uri evidence=liveHttpUri(d,'rights_evidence_url');
    if(evidence.scheme!='https' || evidence.host!='www.diarioeldia.cl' ||
       evidence.path!='/rss') {
      throw const FormatException('Unverified RSS rights origin');
    }
    final List<ChileRssLink> rows=liveList(d['items'],ChileRssLink.fromJson);
    if(rows.length>20 || rows.map((e)=>e.originalUrl).toSet().length!=rows.length) {
      throw const FormatException('Duplicate or oversized RSS feed.');
    }
    return ChileRssLinkedNews(items:rows,fetchedAt:liveDate(d,'fetched_at'));
  }
  final List<ChileRssLink> items;
  final DateTime fetchedAt;
}
final class ChileRssLink {
  const ChileRssLink({required this.headline,required this.originalUrl,
    required this.publishedAt,required this.publisher});
  factory ChileRssLink.fromJson(Object? input) {
    final Map<String,Object?> d=liveObject(input);
    liveRequire(d,'publisher','Diario El Día');
    liveRequire(d,'publisher_domain','diarioeldia.cl');
    liveRequire(d,'media_category','NEWS_LINKS_NOT_INGESTED_ARTICLES');
    final Uri url=liveHttpUri(d,'original_url');
    if(url.scheme!='https' || !<String>{'diarioeldia.cl','www.diarioeldia.cl'}.contains(url.host) ||
       liveString(d,'id')!=url.toString() || url.hasFragment) {
      throw const FormatException('Forged RSS headline origin.');
    }
    final String headline=decodeHeadlineHtmlEntities(liveString(d,'headline'));
    if(headline.length<8 || headline.length>260)throw const FormatException('Bad RSS title');
    return ChileRssLink(headline:headline,originalUrl:url,
      publisher:'Diario El Día',publishedAt:liveDate(d,'published_at'));
  }
  final String headline;
  final Uri originalUrl;
  final DateTime publishedAt;
  final String publisher;
}
