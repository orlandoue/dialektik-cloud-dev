import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/presentation/community_screen.dart';
import 'package:dialektik/features/arena/presentation/duel_screen.dart';
import 'package:dialektik/features/arena/presentation/living_event_screen.dart';
import 'package:dialektik/features/arena/presentation/media_profile_screen.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:flutter/material.dart';

Future<void> openArenaDuel(
  BuildContext context,
  ArenaStore store,
  ArenaDuel duel,
) => Navigator.of(context).push(
  MaterialPageRoute<void>(
    builder: (_) => DuelScreen(duel: duel, store: store),
  ),
);

Future<void> openArenaEvent(
  BuildContext context,
  ArenaStore store,
  String eventId,
) => Navigator.of(context).push(
  MaterialPageRoute<void>(
    builder: (_) => LivingEventScreen(eventId: eventId, store: store),
  ),
);

Future<void> openArenaCommunity(
  BuildContext context,
  ArenaStore store,
  EventDetailDto event,
) => Navigator.of(context).push(
  MaterialPageRoute<void>(
    builder: (_) => CommunityScreen(event: event, store: store),
  ),
);

/// Opens the public profile of a medium from any card of the app.
Future<void> openArenaMedia(
  BuildContext context,
  ArenaStore store,
  String sourceId,
) async {
  LiveSourceDto? source = store.source(sourceId);
  if (source == null) {
    try {
      final List<LiveSourceDto> all = await store.live.listLiveSources();
      for (final LiveSourceDto item in all) {
        if (item.id == sourceId) source = item;
      }
    } on Exception {
      /* Reported below as unavailable. */
    }
  }
  if (!context.mounted) return;
  if (source == null) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Perfil del medio no disponible.')),
    );
    return;
  }
  final LiveSourceDto found = source;
  await Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) => MediaProfileScreen(source: found, store: store),
    ),
  );
}
