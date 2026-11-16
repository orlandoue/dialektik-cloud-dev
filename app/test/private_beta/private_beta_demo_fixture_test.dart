import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'private-beta demo scenario is isolated, synthetic, and provenance-complete',
    () {
      final Map<String, Object?> scenario =
          jsonDecode(
                File(
                  'test/fixtures/private_beta_demo/scenario.json',
                ).readAsStringSync(),
              )
              as Map<String, Object?>;
      final List<Object?> sources = scenario['sources']! as List<Object?>;
      final List<Object?> articles = scenario['articles']! as List<Object?>;
      final List<Object?> events = scenario['events']! as List<Object?>;
      final Map<String, Object?> contradiction =
          scenario['contradiction']! as Map<String, Object?>;

      expect(scenario['classification'], startsWith('DEMO/TEST'));
      expect(scenario['persistence'], 'TEST_FIXTURE_ONLY');
      expect(scenario['rights'], 'SYNTHETIC_NO_PUBLISHER_CONTENT');
      expect(sources, hasLength(3));
      expect(articles, hasLength(3));
      expect(events, hasLength(2));
      expect(
        articles.every(
          (Object? item) => (item! as Map<String, Object?>)['title']
              .toString()
              .startsWith('DEMO/TEST:'),
        ),
        isTrue,
      );
      expect(
        articles.every(
          (Object? item) => (item! as Map<String, Object?>)['url']
              .toString()
              .startsWith('https://example.test/'),
        ),
        isTrue,
      );
      expect((events.first! as Map<String, Object?>)['article_ids'], <String>[
        'demo-article-a1',
        'demo-article-b1',
      ]);
      expect(
        contradiction['classification'],
        'DEMO/TEST_ONLY_NOT_A_REAL_CONTRADICTION',
      );
      expect(contradiction['real_semantic_conclusion'], isFalse);
      expect(contradiction['provenance_article_ids'], <String>[
        'demo-article-a1',
        'demo-article-b1',
      ]);
    },
  );
}
