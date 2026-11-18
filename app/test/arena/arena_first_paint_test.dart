import 'dart:async';

import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:flutter_test/flutter_test.dart';

import 'arena_fixtures.dart';

/// The feed answers its first page at once and holds the second one.
class _SlowSecondPage extends ArenaFullCore {
  final Completer<void> secondPage = Completer<void>();
  final List<String?> cursors = <String?>[];

  @override
  Future<PublicPage<EventCardDto>> listFeed({
    String? category,
    String? topic,
    String? cursor,
    int limit = 20,
    bool refresh = false,
    dynamic requestToken,
  }) async {
    cursors.add(cursor);
    if (cursor == null) {
      return PublicPage<EventCardDto>(
        items: <EventCardDto>[storyEvent],
        nextCursor: 'page-2',
      );
    }
    await secondPage.future;
    return PublicPage<EventCardDto>(
      items: <EventCardDto>[duelEvent, storyEvent],
      nextCursor: null,
    );
  }
}

void main() {
  test(
    'Inicio is ready with the first feed page; later pages join after',
    () async {
      final _SlowSecondPage core = _SlowSecondPage();
      final ArenaStore store = ArenaStore(consumer: core, live: core);
      final Future<void> loading = store.load();
      // The second page is still pending, yet the store is loaded.
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(store.loaded, isTrue);
      expect(store.events.map((EventCardDto e) => e.id), <String>[
        storyEvent.id,
      ]);
      expect(core.cursors, <String?>[null, 'page-2']);

      core.secondPage.complete();
      await loading;
      await Future<void>.delayed(const Duration(milliseconds: 10));
      // The duel event joins once; the repeated story is not duplicated.
      expect(store.events.map((EventCardDto e) => e.id).toSet(), <String>{
        storyEvent.id,
        duelEvent.id,
      });
      expect(store.events.length, 2);
      store.dispose();
    },
  );
}
