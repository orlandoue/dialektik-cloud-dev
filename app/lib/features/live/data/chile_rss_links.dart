import 'package:dialektik/features/live/data/html_entities.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';

/// Direct links from a publisher RSS, never persisted newsroom Articles.
abstract interface class ChileRssLinksRepository {
  Future<ChileRssLinksPreview> loadChileRssLinks({bool refresh = false});
}

final class ChileRssLinksPreview {
  const ChileRssLinksPreview({
    required this.publisher,
    required this.inspectedAt,
    required this.items,
  });
  factory ChileRssLinksPreview.fromJson(Object? value) {
    final Map<String, Object?> d=liveObject(value);
    liveRequire(d,'mode','SOURCE_RSS_LINKS_READ_ONLY_BETA');
    liveRequire(d,'country_code','CL');
    liveRequire(d,'publisher','Cooperativa.cl');
    liveRequire(d,'rights_status','LINK_NAVIGATION_ONLY_RIGHTS_REVIEW_PENDING');
    if(d['content_republication_authorized']!=false ||
       d['persisted']!=false ||
       d['semantic_events_published']!=false ||
       d['contradictions_generated']!=false) {
      throw const FormatException('RSS was incorrectly treated as authorized content.');
    }
    final Uri source=liveHttpUri(d,'source_feed_url');
    if(source.scheme!='https' ||
       source.host!='www.cooperativa.cl' ||
       source.path!='/noticias/site/tax/port/all/rss____1.xml') {
      throw const FormatException('Unexpected RSS source origin.');
    }
    final List<ChileRssLink> items=liveList(d['items'],ChileRssLink.fromJson);
    if(items.isEmpty || items.length>18 ||
       items.map((ChileRssLink x)=>x.canonicalUrl).toSet().length!=items.length){
      throw const FormatException('RSS links missing or duplicated.');
    }
    return ChileRssLinksPreview(
      publisher:'Cooperativa.cl',
      inspectedAt:liveDate(d,'inspected_at'),
      items:items,
    );
  }
  final String publisher;
  final DateTime inspectedAt;
  final List<ChileRssLink> items;
}

final class ChileRssLink {
  const ChileRssLink({
    required this.headline,
    required this.canonicalUrl,
    required this.publishedAt,
  });
  factory ChileRssLink.fromJson(Object? input){
    final Map<String,Object?> d=liveObject(input);
    liveRequire(d,'publisher','Cooperativa.cl');
    final String id=liveString(d,'content_id');
    if(!RegExp(r'^[0-9a-f]{64}$').hasMatch(id)){
      throw const FormatException('Invalid RSS link identity.');
    }
    final String title=decodeHeadlineHtmlEntities(liveString(d,'headline'));
    if(title.length>230)throw const FormatException('Overlong title.');
    final Uri uri=liveHttpUri(d,'canonical_url');
    if(uri.scheme!='https'||uri.host!='www.cooperativa.cl'||
       !uri.path.startsWith('/noticias/')||uri.hasFragment ||
       uri.userInfo.isNotEmpty || uri.hasPort) {
      throw const FormatException('Untrusted RSS article link.');
    }
    final Uri feed=liveHttpUri(d,'source_feed_url');
    if(feed.host!='www.cooperativa.cl' ||
       feed.path!='/noticias/site/tax/port/all/rss____1.xml') {
      throw const FormatException('Unexpected RSS item publisher.');
    }
    return ChileRssLink(
      headline:title,
      canonicalUrl:uri,
      publishedAt:liveDate(d,'published_at'),
    );
  }
  final String headline;
  final Uri canonicalUrl;
  final DateTime publishedAt;
}
