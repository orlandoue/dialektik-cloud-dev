/// Bounded metadata preview of prequalified official GOV.UK publications.
/// This is neither a stored Article nor an automatically inferred Event.
final class GovUkPreviewItem {
  const GovUkPreviewItem({
    required this.headline,
    required this.publisher,
    required this.canonicalUrl,
    required this.publishedAt,
    required this.attribution,
  });

  factory GovUkPreviewItem.fromJson(Object? value, {bool multiSource = false}) {
    if (value is! Map<String, dynamic>) {
      throw const FormatException('Invalid official preview item.');
    }
    final Object? rawUrl = value['canonical_url'];
    final Uri? uri = rawUrl is String ? Uri.tryParse(rawUrl) : null;
    final Object? rawDate = value['published_at'];
    final DateTime? date = rawDate is String ? DateTime.tryParse(rawDate) : null;
    final String? headline =
        value['headline'] is String ? value['headline'] as String : null;
    final String? publisher =
        value['publisher'] is String ? value['publisher'] as String : null;
    final String? attribution = multiSource
        ? '© Crown copyright · Open Government Licence v3.0 · GOV.UK'
        : value['attribution'] is String
            ? value['attribution'] as String
            : null;
    final bool issuerVerified = multiSource
        ? (publisher == 'Regulator of Social Housing' &&
                value['source_id'] == 'govuk_rsh_official') ||
            (publisher ==
                    'Ministry of Housing, Communities and Local Government' &&
                value['source_id'] == 'govuk_mhclg_official')
        : publisher == 'Regulator of Social Housing';
    if (multiSource) {
      final Object? id = value['content_id'];
      final Object? hash = value['evidence_hash'];
      if (value['semantic_assignment'] != 'UNASSIGNED' ||
          value['rights_evidence_url'] !=
              'https://www.gov.uk/help/terms-conditions' ||
          id is! String ||
          !RegExp(r'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$',
                  caseSensitive: false)
              .hasMatch(id) ||
          hash is! String ||
          !RegExp(r'^[0-9a-f]{64}$').hasMatch(hash)) {
        throw const FormatException('Unverified multi-publisher provenance.');
      }
    }
    if (uri == null ||
        uri.scheme != 'https' ||
        uri.host != 'www.gov.uk' ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment ||
        !uri.path.startsWith('/government/news/') ||
        headline == null ||
        headline.trim().isEmpty ||
        !issuerVerified ||
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
  const GovUkPreview({required this.items, this.multiPublisher = false});

  factory GovUkPreview.fromJson(Object? value) {
    if (value is! Map<String, dynamic> ||
        value['persisted'] != false ||
        value['origin'] != 'EXTERNAL_OFFICIAL_API' ||
        value['items'] is! List<dynamic>) {
      throw const FormatException('Invalid read-only preview response.');
    }
    final bool multiPublisher =
        value['mode'] == 'TWO_OFFICIAL_PUBLISHERS_LIVE_METADATA_PREVIEW';
    if (!multiPublisher && value['mode'] != 'OFFICIAL_READ_ONLY_PREVIEW') {
      throw const FormatException('Unknown official preview mode.');
    }
    if (multiPublisher &&
        (value['generated_events'] != false ||
            value['generated_contradictions'] != false ||
            value['verified_publishers'] != 2)) {
      throw const FormatException('Invalid official multi-publisher metadata.');
    }
    final List<GovUkPreviewItem> items = (value['items'] as List<dynamic>)
        .map((dynamic item) =>
            GovUkPreviewItem.fromJson(item, multiSource: multiPublisher))
        .toList(growable: false);
    if (items.isEmpty ||
        items.length > (multiPublisher ? 10 : 7) ||
        items.map((GovUkPreviewItem item) => item.canonicalUrl).toSet().length !=
            items.length) {
      throw const FormatException('Unexpected official preview scope.');
    }
    if (multiPublisher &&
        items.map((GovUkPreviewItem item) => item.publisher).toSet().length !=
            2) {
      throw const FormatException('Both original publishers are required.');
    }
    items.sort((GovUkPreviewItem a, GovUkPreviewItem b) =>
        b.publishedAt.compareTo(a.publishedAt));
    return GovUkPreview(
      items: List<GovUkPreviewItem>.unmodifiable(items),
      multiPublisher: multiPublisher,
    );
  }

  final List<GovUkPreviewItem> items;
  final bool multiPublisher;
}

typedef GovUkPreviewLoader = Future<GovUkPreview> Function({bool refresh});
