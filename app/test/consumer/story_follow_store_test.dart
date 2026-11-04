import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/data/story_follow_store.dart';
import 'package:flutter_test/flutter_test.dart';
import '../support/public_api_fixtures.dart';

void main() {
  test('persists follow state and last seen counts separately per account', () async {
    final saved=<String,String>{};
    Future<String?> read(String id) async => saved[id];
    Future<void> write(String id,String value) async { saved[id]=value; }
    final event=EventDetailDto.fromJson({...eventDetailJson(id:publishedEventId,analysisState:'PUBLISHED',positionCount:2),
      'positions':<Object?>[], 'contrasts':<Object?>[], 'articles':<Object?>[
        {'id':'a','title':'Nota','source_name':'Medio','published_at':'2026-10-30T12:00:00Z','url':'https://example.com/a'},
      ]});
    final first=StoryFollowStore.forTesting(userId:'account-a',read:read,write:write);
    await first.setFollowing(event,following:true);
    final restored=StoryFollowStore.forTesting(userId:'account-a',read:read,write:write);
    await restored.load();
    expect(restored.contains(event.id),isTrue);
    expect(restored.snapshot(event.id)!.articleCount,1);
    expect(restored.snapshot(event.id)!.sourceCount,event.sourceCount);
    final other=StoryFollowStore.forTesting(userId:'account-b',read:read,write:write);
    await other.load();
    expect(other.contains(event.id),isFalse);
    await restored.setFollowing(event,following:false);
    expect(restored.contains(event.id),isFalse);
  });
  test('a failed save cannot leak a follow into another concurrent save', () async {
    String? saved;
    var writes=0;
    Future<String?> read(String id) async => saved;
    Future<void> write(String id,String value) async {
      writes++;
      if (writes==1) throw StateError('write failed');
      saved=value;
    }
    EventDetailDto event(String id) => EventDetailDto.fromJson({
      ...eventDetailJson(id:id,analysisState:'PUBLISHED',positionCount:2),
      'positions':<Object?>[], 'contrasts':<Object?>[], 'articles':<Object?>[],
    });
    final first=event(publishedEventId);
    final second=event('01K4W4M7R0B000000000000003');
    final store=StoryFollowStore.forTesting(userId:'account-a',read:read,write:write);
    final failed=expectLater(store.setFollowing(first,following:true),throwsStateError);
    final succeeding=store.setFollowing(second,following:true);
    await failed;
    await succeeding;
    final restored=StoryFollowStore.forTesting(userId:'account-a',read:read,write:write);
    await restored.load();
    expect(restored.contains(first.id),isFalse);
    expect(restored.contains(second.id),isTrue);
  });

}
