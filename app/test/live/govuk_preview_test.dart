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
