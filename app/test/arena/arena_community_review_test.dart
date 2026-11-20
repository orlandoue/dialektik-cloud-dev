// Phase 5: a contribution says which version it is about and what its link
// does, as each reader sees the versions; one in review shows only to its
// author with that label.
import 'package:dialektik/features/arena/presentation/community_screen.dart';
import 'package:dialektik/features/social/data/arena_social_repository.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'a contribution reads its version, sense and review state from Core',
    () {
      final List<CommunityEntry> entries = CommunityEntry.listFromJson(
        <String, dynamic>{
          'entries': <Map<String, dynamic>>[
            <String, dynamic>{
              'id': 'e1',
              'channel': 'aporte',
              'author': 'Lector-1234',
              'body': 'Resolución del tribunal',
              'url': 'https://pjud.cl/r.pdf',
              'created_at': '2026-11-20T10:00:00Z',
              'upvotes': 0,
              'downvotes': 0,
              'my_vote': null,
              'mine': true,
              'position_id': 'posA',
              'stance': 'contradicts',
              'status': 'in_review',
            },
          ],
        },
      );
      expect(entries.single.positionId, 'posA');
      expect(entries.single.stance, EntryStance.contradicts);
      expect(entries.single.inReview, isTrue);
    },
  );

  test('an older Core without stance shows no label', () {
    expect(EntryStance.parse(null), isNull);
    expect(arenaEntryStanceLabel, isNotNull);
  });
}
