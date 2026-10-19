/// Explicitly human-curated, non-persisted evidence links for one DEV occurrence.
/// Never convert this DTO into EventCardDto or feed it to semantic scoring.
final class CuratedEventPublication {
  const CuratedEventPublication({
    required this.publisher,
    required this.publisherKind,
    required this.headline,
    required this.canonicalUrl,
    required this.publishedOn,
  });

  static const Map<String, String> approvedUrls = <String, String>{
    'La Tercera':
        'https://www.latercera.com/nacional/noticia/dmc-confirma-tornado-en-estacion-central-vientos-alcanzaron-los-137-kmh/',
    'BioBioChile':
        'https://www.biobiochile.cl/noticias/nacional/region-metropolitana/2026/10/13/dmc-asegura-que-fenomeno-apreciado-en-estacion-central-seria-un-tornado.shtml',
    'Cooperativa':
        'https://www.instagram.cooperativa.cl/noticias/pais/desastres-naturales/video-meteorologia-confirmo-evento-tornadico-en-estacion-central/2026-10-13/175530.html',
    'T13':
        'https://www.t13.cl/noticia/nacional/intentan-rescatar-familia-atrapada-tras-tornado-estacion-central-14-10-2026',
    'Gobierno de Santiago':
        'https://www.gobiernosantiago.cl/2026/10/14/gobernador-de-santiago-y-alcalde-de-estacion-central-coordinan-catastro-de-viviendas-afectadas-por-tornado/',
  };

  factory CuratedEventPublication.fromJson(Object? value) {
    if (value is! Map<String, dynamic>) {
      throw const FormatException('Invalid event evidence.');
    }
    final String? publisher = value['publisher'] as String?;
    final String? publisherKind = value['publisher_kind'] as String?;
    final String? url = value['canonical_url'] as String?;
    final String? publishedOn = value['published_on'] as String?;
    final String? headline = value['headline'] as String?;
    final Uri? uri = url == null ? null : Uri.tryParse(url);
    if (publisher == null ||
        approvedUrls[publisher] != url ||
        uri == null ||
        uri.scheme != 'https' ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment ||
        publisherKind !=
            (publisher == 'Gobierno de Santiago'
                ? 'PRIMARY_GOVERNMENT_SOURCE'
                : 'INDEPENDENT_NEWSROOM') ||
        !<String>{'2026-10-13', '2026-10-14'}.contains(publishedOn) ||
        headline == null ||
        headline.trim().isEmpty) {
      throw const FormatException('Unverified event evidence.');
    }
    return CuratedEventPublication(
      publisher: publisher,
      publisherKind: publisherKind,
      headline: headline,
      canonicalUrl: uri,
      publishedOn: publishedOn!,
    );
  }

  final String publisher;
  final String publisherKind;
  final String headline;
  final Uri canonicalUrl;
  final String publishedOn;
}

final class CuratedEventPreview {
  const CuratedEventPreview({
    required this.title,
    required this.location,
    required this.description,
    required this.warning,
    required this.reviewedOn,
    required this.publications,
  });

  factory CuratedEventPreview.fromJson(Object? value) {
    if (value is! Map<String, dynamic> ||
        value['mode'] != 'CURATED_REAL_EVENT_EVIDENCE_PREVIEW' ||
        value['id'] != 'editorial-preview:cl:estacion-central:2026-10-13:ef0' ||
        value['persisted'] != false ||
        value['semantic_engine_executed'] != false ||
        value['grouping_method'] != 'HUMAN_REVIEWED_FIXED_OCCURRENCE' ||
        value['occurred_on'] != '2026-10-13' ||
        value['category'] != 'País' ||
        value['publications'] is! List<dynamic>) {
      throw const FormatException('Invalid curated occurrence preview.');
    }
    final List<CuratedEventPublication> publications =
        (value['publications'] as List<dynamic>)
            .map(CuratedEventPublication.fromJson)
            .toList(growable: false);
    final int newsroomCount = publications
        .where(
          (CuratedEventPublication x) =>
              x.publisherKind == 'INDEPENDENT_NEWSROOM',
        )
        .length;
    if (publications.length < 3 ||
        publications.length > 5 ||
        value['source_count'] != publications.length ||
        value['independent_newsroom_count'] != newsroomCount ||
        newsroomCount < 2 ||
        !publications.any(
          (CuratedEventPublication x) =>
              x.publisherKind == 'PRIMARY_GOVERNMENT_SOURCE',
        ) ||
        publications
                .map((CuratedEventPublication p) => p.publisher)
                .toSet()
                .length !=
            publications.length ||
        value['verified_on'] != '2026-10-19' ||
        value['title'] is! String ||
        (value['title'] as String).isEmpty ||
        value['location'] != 'Estación Central, Región Metropolitana, Chile' ||
        value['editorial_evidence'] is! String ||
        value['warning'] is! String) {
      throw const FormatException('Unverifiable curated occurrence.');
    }
    return CuratedEventPreview(
      title: value['title'] as String,
      location: value['location'] as String,
      description: value['editorial_evidence'] as String,
      warning: value['warning'] as String,
      reviewedOn: value['verified_on'] as String,
      publications: List<CuratedEventPublication>.unmodifiable(publications),
    );
  }

  final String title;
  final String location;
  final String description;
  final String warning;
  final String reviewedOn;
  final List<CuratedEventPublication> publications;
}

typedef CuratedEventPreviewLoader =
    Future<CuratedEventPreview> Function({bool refresh});
