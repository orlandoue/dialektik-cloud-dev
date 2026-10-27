import 'package:dialektik/features/live/data/live_news_models.dart';

abstract interface class ChileRssChronologyRepository {
  Future<ChileRssChronology> loadChileRssChronology({bool refresh = false});
}

/// Original publisher hyperlinks; not persisted journalistic Articles or Events.
final class ChileRssChronology {
  const ChileRssChronology({
    required this.items,
    required this.sources,
    required this.refreshedAt,
  });

  factory ChileRssChronology.fromJson(Object? input) {
    final Map<String, Object?> d = liveObject(input);
    liveRequire(d, 'mode', 'CHILE_MULTI_PUBLISHER_RSS_LINK_TIMELINE');
    liveRequire(d, 'country_code', 'CL');
    if (d['persisted'] != false ||
        d['full_articles_downloaded'] != false ||
        d['story_text_republished'] != false ||
        d['semantic_grouping_performed'] != false ||
        d['contradictions_generated'] != false ||
        liveInt(d, 'independent_events_claimed') != 0) {
      throw const FormatException('Unverified RSS semantic or rights claims.');
    }
    final List<ChileRssSource> sources =
        liveList(d['sources'], ChileRssSource.fromJson);
    if (sources.length != 2 ||
        sources.map((s) => s.id).toSet().length != 2 ||
        !sources.map((s) => s.id).toSet().containsAll(const <String>{
          'cl_diario_eldia_rss',
          'cl_cooperativa_rss',
        })) {
      throw const FormatException('Incomplete RSS source registry.');
    }
    final int available =
        sources.where((s) => s.status == 'AVAILABLE').length;
    if (available < 1 || available != liveInt(d, 'publisher_count')) {
      throw const FormatException('False RSS source availability.');
    }
    final List<ChileRssChronologyItem> items =
        liveList(d['items'], ChileRssChronologyItem.fromJson);
    if (items.isEmpty ||
        items.length > 30 ||
        items.map((e) => e.key).toSet().length != items.length ||
        items.any((e) => sources
            .where((source) => source.id == e.sourceId)
            .single
            .status != 'AVAILABLE')) {
      throw const FormatException('Unverifiable RSS list.');
    }
    for (int i = 1; i < items.length; i++) {
      if (items[i].publishedAt.isAfter(items[i - 1].publishedAt)) {
        throw const FormatException('RSS timeline is not chronological.');
      }
    }
    return ChileRssChronology(
      items: items,
      sources: sources,
      refreshedAt: liveDate(d, 'refreshed_at'),
    );
  }

  final List<ChileRssChronologyItem> items;
  final List<ChileRssSource> sources;
  final DateTime refreshedAt;
}

final class ChileRssSource {
  const ChileRssSource({
    required this.id,
    required this.publisher,
    required this.status,
    required this.count,
  });
  factory ChileRssSource.fromJson(Object? input) {
    final Map<String, Object?> d = liveObject(input);
    final String id = liveString(d, 'id');
    final String publisher = liveString(d, 'publisher');
    if ((id == 'cl_diario_eldia_rss' && publisher != 'Diario El Día') ||
        (id == 'cl_cooperativa_rss' && publisher != 'Cooperativa.cl') ||
        (id != 'cl_diario_eldia_rss' && id != 'cl_cooperativa_rss')) {
      throw const FormatException('Unknown original RSS source.');
    }
    final String status = liveString(d, 'status');
    final int count = liveInt(d, 'count');
    if (!const <String>{'AVAILABLE', 'EMPTY', 'UNAVAILABLE'}
            .contains(status) ||
        count < 0 ||
        count > 24 ||
        ((status == 'AVAILABLE') != (count > 0))) {
      throw const FormatException('RSS source readiness conflict.');
    }
    return ChileRssSource(
      id: id,
      publisher: publisher,
      status: status,
      count: count,
    );
  }
  final String id;
  final String publisher;
  final String status;
  final int count;
}

final class ChileRssChronologyItem {
  const ChileRssChronologyItem({
    required this.key,
    required this.sourceId,
    required this.publisher,
    required this.title,
    required this.originalUrl,
    required this.publishedAt,
  });

  factory ChileRssChronologyItem.fromJson(Object? input) {
    final Map<String, Object?> d = liveObject(input);
    liveRequire(d, 'content_kind', 'PUBLISHER_RSS_TITLE_AND_DEEP_LINK');
    final String sourceId = liveString(d, 'source_id');
    final String publisher = liveString(d, 'publisher');
    final Uri url = liveHttpUri(d, 'original_url');
    final String expectedHost;
    if (sourceId == 'cl_diario_eldia_rss' && publisher == 'Diario El Día') {
      if (!const <String>{'www.diarioeldia.cl', 'diarioeldia.cl'}
          .contains(url.host)) {
        throw const FormatException('Diario El Día source mismatch.');
      }
      expectedHost = sourceId;
    } else if (sourceId == 'cl_cooperativa_rss' &&
        publisher == 'Cooperativa.cl') {
      if (url.host != 'www.cooperativa.cl' ||
          !url.path.startsWith('/noticias/')) {
        throw const FormatException('Cooperativa source mismatch.');
      }
      expectedHost = sourceId;
    } else {
      throw const FormatException('Unrecognized RSS publisher.');
    }
    if (url.scheme != 'https' ||
        url.hasFragment ||
        liveString(d, 'item_key') != '$expectedHost:$url') {
      throw const FormatException('Forged RSS article link.');
    }
    final String title = liveString(d, 'title');
    if (title.length < 3 || title.length > 280) {
      throw const FormatException('Invalid RSS headline.');
    }
    return ChileRssChronologyItem(
      key: liveString(d, 'item_key'),
      sourceId: sourceId,
      publisher: publisher,
      title: title,
      originalUrl: url,
      publishedAt: liveDate(d, 'published_at'),
    );
  }

  final String key;
  final String sourceId;
  final String publisher;
  final String title;
  final Uri originalUrl;
  final DateTime publishedAt;
}
