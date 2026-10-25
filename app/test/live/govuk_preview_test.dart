import 'package:dialektik/features/live/data/govuk_preview.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Map<String, Object?> payload() => <String, Object?>{
    'mode': 'OFFICIAL_READ_ONLY_PREVIEW',
    'persisted': false,
    'origin': 'EXTERNAL_OFFICIAL_API',
    'items': <Object?>[
      <String, Object?>{
        'headline': 'Official publication',
        'publisher': 'Regulator of Social Housing',
        'canonical_url':
            'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh',
        'published_at': '2026-10-07T08:30:03.000Z',
        'attribution': '© RSH. Open Government Licence v3.0.',
      },
    ],
  };

  Map<String, Object?> twoPublisherPayload() {
    Map<String, Object?> item(
      String source,
      String publisher,
      String id,
      String slug,
    ) => <String, Object?>{
      'source_id': source,
      'publisher': publisher,
      'content_id': id,
      'headline': 'Verified government bulletin',
      'canonical_url': 'https://www.gov.uk/government/news/$slug',
      'published_at': '2026-10-22T08:00:00.000Z',
      'modified_at': null,
      'rights_evidence_url': 'https://www.gov.uk/help/terms-conditions',
      'evidence_hash': 'a' * 64,
      'semantic_assignment': 'UNASSIGNED',
    };
    return <String, Object?>{
      'mode': 'TWO_OFFICIAL_PUBLISHERS_LIVE_METADATA_PREVIEW',
      'persisted': false,
      'origin': 'EXTERNAL_OFFICIAL_API',
      'generated_events': false,
      'generated_contradictions': false,
      'verified_publishers': 2,
      'items': <Object?>[
        item('govuk_rsh_official', 'Regulator of Social Housing',
          '123e4567-e89b-42d3-a456-426614174001', 'example-rsh-one'),
        item('govuk_mhclg_official',
          'Ministry of Housing, Communities and Local Government',
          '123e4567-e89b-42d3-a456-426614174002', 'example-ministry-two'),
      ],
    };
  }

  test('two original GOVUK issuers render as unassigned, nonpersistent headlines', () {
    final GovUkPreview preview = GovUkPreview.fromJson(twoPublisherPayload());
    expect(preview.multiPublisher, isTrue);
    expect(preview.items, hasLength(2));
    expect(preview.items.map((GovUkPreviewItem x) => x.publisher).toSet(), hasLength(2));
    expect(preview.items.first.attribution, contains('Open Government Licence'));
  });

  test('forged publisher identity or fabricated semantic result is rejected', () {
    final Map<String, Object?> spoof = twoPublisherPayload();
    final Map<String, Object?> first = (spoof['items']! as List<Object?>).first!
        as Map<String, Object?>;
    first['source_id'] = 'govuk_mhclg_official';
    expect(() => GovUkPreview.fromJson(spoof), throwsFormatException);

    final Map<String, Object?> fabricated = twoPublisherPayload()
      ..['generated_contradictions'] = true;
    expect(() => GovUkPreview.fromJson(fabricated), throwsFormatException);
  });

  test('two-source metadata demands both issuers and official rights evidence', () {
    final Map<String, Object?> missing = twoPublisherPayload();
    (missing['items']! as List<Object?>).removeLast();
    expect(() => GovUkPreview.fromJson(missing), throwsFormatException);

    final Map<String, Object?> rights = twoPublisherPayload();
    final Map<String, Object?> second = (rights['items']! as List<Object?>).last!
        as Map<String, Object?>;
    second['rights_evidence_url'] = 'https://example.org/not-the-licence';
    expect(() => GovUkPreview.fromJson(rights), throwsFormatException);
  });

  test('renders only clearly labeled official preview metadata', () {
    final GovUkPreview value = GovUkPreview.fromJson(payload());
    expect(value.items, hasLength(1));
    expect(value.items.single.headline, 'Official publication');
    expect(value.items.single.canonicalUrl.host, 'www.gov.uk');
  });

  test('shows multiple official publications newest first', () {
    final Map<String, Object?> values = payload();
    final List<Object?> items = values['items']! as List<Object?>;
    items.add(<String, Object?>{
      'headline': 'Newest official bulletin',
      'publisher': 'Regulator of Social Housing',
      'canonical_url':
          'https://www.gov.uk/government/news/rsh-takes-enforcement-action-against-concept-housing-association',
      'published_at': '2026-10-15T09:00:00.000Z',
      'attribution': '© RSH. Open Government Licence v3.0.',
    });
    final GovUkPreview news = GovUkPreview.fromJson(values);
    expect(news.items, hasLength(2));
    expect(news.items.first.headline, 'Newest official bulletin');
  });

  test('rejects duplicate preview URLs', () {
    final Map<String, Object?> values = payload();
    final List<Object?> items = values['items']! as List<Object?>;
    items.add(Map<String, Object?>.from(items.first! as Map<String, Object?>));
    expect(() => GovUkPreview.fromJson(values), throwsFormatException);
  });

  test('rejects a persisted-news masquerade', () {
    final Map<String, Object?> bad = payload()..['persisted'] = true;
    expect(() => GovUkPreview.fromJson(bad), throwsFormatException);
  });

  test('rejects an unapproved publisher-domain link', () {
    final Map<String, Object?> bad = payload();
    final Map<String, Object?> item =
        (bad['items']! as List<Object?>).first! as Map<String, Object?>;
    item['canonical_url'] = 'https://example.org/government/news/fake';
    expect(() => GovUkPreview.fromJson(bad), throwsFormatException);
  });
}
