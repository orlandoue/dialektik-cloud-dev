import 'package:dialektik/features/consumer/data/story_follow_store.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('story snapshot retains its seen time and source and article counts', () {
    final original = StorySnapshot(seenAt:DateTime.utc(2026,11,4,12,30),sourceCount:3,articleCount:5);
    final decoded = StorySnapshot.fromJson(original.toJson());
    expect(decoded.seenAt,original.seenAt);
    expect(decoded.sourceCount,3);
    expect(decoded.articleCount,5);
  });
}
