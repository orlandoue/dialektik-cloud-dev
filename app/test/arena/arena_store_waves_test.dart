import 'dart:async';

import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:flutter_test/flutter_test.dart';

import 'arena_fixtures.dart';

/// Seven duels whose event details stay pending until the test releases
/// them, so the store's request waves can be observed one by one.
class _HeldDetailsCore extends ArenaManyDuelsCore {
  final List<String> requested = <String>[];
  final Map<String, Completer<void>> gates = <String, Completer<void>>{};

  @override
  Future<EventDetailDto> getEvent(
    String eventId, {
    bool refresh = false,
    dynamic requestToken,
  }) async {
    requested.add(eventId);
    await (gates[eventId] ??= Completer<void>()).future;
    return super.getEvent(eventId, refresh: refresh);
  }

  void release(Iterable<String> ids) {
    for (final String id in ids) {
      (gates[id] ??= Completer<void>()).complete();
    }
  }
}

Future<void> _settle() async {
  for (var i = 0; i < 20; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  test('el Coliseo se muestra con los duelos del carrusel sin esperar al '
      'resto de los contrastes', () async {
    final _HeldDetailsCore core = _HeldDetailsCore();
    final ArenaStore store = ArenaStore(consumer: core, live: core);
    final Future<void> loading = store.load();
    await _settle();

    final List<String> carousel = <String>[
      for (int i = 0; i < ArenaStore.firstDuelWave; i++)
        ArenaManyDuelsCore.idOf(i),
    ];
    // Only the carousel's details are requested first, never one per
    // contrast at once.
    expect(core.requested, carousel);
    expect(store.loaded, isFalse);

    core.release(carousel);
    await _settle();
    expect(store.loaded, isTrue);
    expect(store.duels, hasLength(ArenaStore.firstDuelWave));
    expect(store.duels.first.event.id, ArenaManyDuelsCore.idOf(0));

    // The rest joins in the background and is appended in order.
    final List<String> rest = <String>[
      for (int i = ArenaStore.firstDuelWave; i < ArenaManyDuelsCore.count; i++)
        ArenaManyDuelsCore.idOf(i),
    ];
    expect(core.requested.skip(carousel.length), rest);
    core.release(rest);
    await loading;
    expect(store.duels.map((ArenaDuel d) => d.event.id), <String>[
      ...carousel,
      ...rest,
    ]);
    store.dispose();
  });
}
