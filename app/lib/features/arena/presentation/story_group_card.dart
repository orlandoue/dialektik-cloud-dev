import 'dart:async';

import 'package:dialektik/core/infrastructure/usage_analytics.dart';
import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/data/story_groups.dart';
import 'package:dialektik/features/arena/presentation/arena_home_tab.dart';
import 'package:dialektik/features/arena/presentation/arena_widgets.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:flutter/material.dart';

/// One card for a whole story (a tour, a summit, a trial): every outlet
/// that covered any of its events, instead of one card per pair of notes.
class StoryGroupCard extends StatelessWidget {
  const StoryGroupCard({
    required this.story,
    required this.members,
    required this.store,
    super.key,
  });

  final StoryGroup story;

  /// The story's events present in the feed, newest first.
  final List<EventCardDto> members;
  final ArenaStore store;

  @override
  Widget build(BuildContext context) {
    final EventCardDto lead = members.firstWhere(
      (EventCardDto e) => e.id == story.coverEventId,
      orElse: () => members.first,
    );
    final ArenaTopic topic = arenaTopicOfEvent(lead);
    final DateTime? updated = story.lastCoverageAt;
    final int coverages = story.eventIds.length;
    return ArenaCard(
      key: ValueKey<String>('arena-story-${story.id}'),
      padding: const EdgeInsets.all(12),
      onTap: () {
        logUsage('story_open');
        unawaited(
          Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => StoryGroupScreen(
                story: story,
                members: members,
                store: store,
              ),
            ),
          ),
        );
      },
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(arenaTopicIcon(topic), size: 16, color: ArenaColors.muted),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  '${topic.label.toUpperCase()} · HISTORIA',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.4,
                    color: ArenaColors.muted,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(story.title, style: ArenaText.cardTitle),
          const SizedBox(height: 6),
          Text(
            '${story.sourceCount} ${story.sourceCount == 1 ? 'medio' : 'medios'}'
            ' · $coverages ${coverages == 1 ? 'cobertura' : 'coberturas'}'
            '${updated == null ? '' : ' · Última cobertura ${arenaAgo(updated)}'}',
            style: ArenaText.meta,
          ),
          const SizedBox(height: 4),
          const Text('Título de Dialektik', style: ArenaText.meta),
        ],
      ),
    );
  }
}

/// The events of one story in time order, each with its own coverage.
class StoryGroupScreen extends StatelessWidget {
  const StoryGroupScreen({
    required this.story,
    required this.members,
    required this.store,
    super.key,
  });

  final StoryGroup story;
  final List<EventCardDto> members;
  final ArenaStore store;

  @override
  Widget build(BuildContext context) {
    final List<EventCardDto> ordered = List<EventCardDto>.of(members)
      ..sort(
        (EventCardDto a, EventCardDto b) =>
            a.detectedAt.compareTo(b.detectedAt),
      );
    return Scaffold(
      backgroundColor: ArenaColors.background,
      appBar: AppBar(
        backgroundColor: ArenaColors.background,
        surfaceTintColor: Colors.transparent,
        foregroundColor: ArenaColors.ink,
        title: Text(
          story.title,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
        ),
      ),
      body: ListView(
        key: const Key('arena-story-scroll'),
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        children: <Widget>[
          Text(
            '${story.sourceCount} medios cubrieron esta historia en '
            '${story.eventIds.length} coberturas. Dialektik las agrupó; cada '
            'una conserva lo que dijo cada medio.',
            style: ArenaText.meta,
          ),
          const SizedBox(height: 12),
          for (final EventCardDto event in ordered)
            DevelopingEventCard(event: event, store: store),
        ],
      ),
    );
  }
}

/// The feed's events with each story in one place: a story appears where
/// its first member would, once; ungrouped events stay as they are.
List<Object> arenaStoryItems(ArenaStore store, List<EventCardDto> events) {
  final Map<String, List<EventCardDto>> byStory =
      <String, List<EventCardDto>>{};
  for (final EventCardDto event in events) {
    final StoryGroup? story = store.storyOf(event.id);
    if (story != null) (byStory[story.id] ??= <EventCardDto>[]).add(event);
  }
  final Set<String> placed = <String>{};
  final List<Object> items = <Object>[];
  for (final EventCardDto event in events) {
    final StoryGroup? story = store.storyOf(event.id);
    if (story == null) {
      items.add(event);
    } else if (placed.add(story.id)) {
      items.add((story: story, members: byStory[story.id]!));
    }
  }
  return items;
}
