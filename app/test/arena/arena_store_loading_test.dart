import 'dart:async';

import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:flutter_test/flutter_test.dart';

import 'arena_fixtures.dart';

/// Event details never answer: the Coliseo must still show its stories.
class _SlowDetailsCore extends ArenaManyDuelsCore {
  final Completer<void> gate = Completer<void>();

  @override
  Future<EventDetailDto> getEvent(
    String eventId, {
    bool refresh = false,
    dynamic requestToken,
  }) async {
    await gate.future;
    return super.getEvent(eventId, refresh: refresh);
  }
}

/// The feed throws an Error (not an Exception).
class _BrokenFeedCore extends ArenaManyDuelsCore {
  @override
  Future<PublicPage<EventCardDto>> listFeed({
    String? category,
    String? topic,
    String? cursor,
    int limit = 20,
    bool refresh = false,
    dynamic requestToken,
  }) async => throw StateError('unexpected');
}

Future<void> _settle() async {
  for (var i = 0; i < 20; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  test('stories show while duel details are still loading', () async {
    final _SlowDetailsCore core = _SlowDetailsCore();
    final ArenaStore store = ArenaStore(consumer: core, live: core);
    final Future<void> loading = store.load();
    await _settle();
    expect(store.loaded, isTrue, reason: 'no full-screen spinner');
    expect(store.events, isNotEmpty);
    expect(store.duelsLoading, isTrue);
    core.gate.complete();
    await loading;
    expect(store.duelsLoading, isFalse);
    expect(store.duels, isNotEmpty);
    expect(store.loading, isFalse);
    store.dispose();
  });

  test('an unexpected Error never leaves the spinner running', () async {
    final _BrokenFeedCore core = _BrokenFeedCore();
    final ArenaStore store = ArenaStore(consumer: core, live: core);
    await store.load();
    expect(store.loading, isFalse);
    expect(store.error, isNotNull);
    store.dispose();
  });
}
