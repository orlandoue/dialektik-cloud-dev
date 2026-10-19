/// Bounded read-only preview of prequalified official Content API items.
/// This is never an Article, a persisted version, or a semantic event.
final class GovUkPreviewItem {
  const GovUkPreviewItem({
    required this.headline,
    required this.publisher,
    required this.canonicalUrl,
    required this.publishedAt,
    required this.attribution,
  });

  factory GovUkPreviewItem.fromJson(Object? value) {
    if (value is! Map<String, dynamic>) {
      throw const FormatException('Invalid official preview item.');
    }
    final Object? rawUrl = value['canonical_url'];
    final Uri? uri = rawUrl is String ? Uri.tryParse(rawUrl) : null;
    final Object? rawDate = value['published_at'];
    final DateTime? date = rawDate is String
        ? DateTime.tryParse(rawDate)
        : null;
    final String? headline = value['headline'] is String
        ? value['headline'] as String
        : null;
    final String? publisher = value['publisher'] is String
        ? value['publisher'] as String
        : null;
    final String? attribution = value['attribution'] is String
        ? value['attribution'] as String
        : null;
    if (uri == null ||
        uri.scheme != 'https' ||
        uri.host != 'www.gov.uk' ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment ||
        !uri.path.startsWith('/government/news/') ||
        headline == null ||
        headline.trim().isEmpty ||
        publisher != 'Regulator of Social Housing' ||
        date == null ||
        !rawDate.toString().endsWith('Z') ||
        attribution == null ||
        attribution.trim().isEmpty) {
      throw const FormatException('Unverified official preview item.');
    }
    return GovUkPreviewItem(
      headline: headline,
      publisher: publisher!,
      canonicalUrl: uri,
      publishedAt: date.toUtc(),
      attribution: attribution,
    );
  }

  final String headline;
  final String publisher;
  final Uri canonicalUrl;
  final DateTime publishedAt;
  final String attribution;
}

final class GovUkPreview {
  const GovUkPreview({required this.items});

  factory GovUkPreview.fromJson(Object? value) {
    if (value is! Map<String, dynamic> ||
        value['mode'] != 'OFFICIAL_READ_ONLY_PREVIEW' ||
        value['persisted'] != false ||
        value['origin'] != 'EXTERNAL_OFFICIAL_API' ||
        value['items'] is! List<dynamic>) {
      throw const FormatException('Invalid read-only preview response.');
    }
    final List<GovUkPreviewItem> items = (value['items'] as List<dynamic>)
        .map(GovUkPreviewItem.fromJson)
        .toList(growable: false);
    if (items.isEmpty ||
        items.length > 7 ||
        items
                .map((GovUkPreviewItem item) => item.canonicalUrl)
                .toSet()
                .length !=
            items.length) {
      throw const FormatException('Unexpected official preview scope.');
    }
    items.sort(
      (GovUkPreviewItem a, GovUkPreviewItem b) =>
          b.publishedAt.compareTo(a.publishedAt),
    );
    return GovUkPreview(items: List<GovUkPreviewItem>.unmodifiable(items));
  }

  final List<GovUkPreviewItem> items;
}

typedef GovUkPreviewLoader = Future<GovUkPreview> Function({bool refresh});
