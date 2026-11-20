/// Stories: several published events about one developing topic, grouped
/// by a moderator from Core's proposals (names, words and dates; no AI).
/// Events and duels stay as they are; a story only lists them.
final class StoryGroup {
  const StoryGroup({
    required this.id,
    required this.title,
    required this.eventIds,
    required this.sourceIds,
    required this.sourceCount,
    this.coverEventId,
    this.lastCoverageAt,
  });

  factory StoryGroup.fromJson(Map<String, dynamic> json) => StoryGroup(
    id: json['id']! as String,
    title: json['title']! as String,
    coverEventId: json['cover_event_id'] as String?,
    eventIds: <String>[
      for (final Object? id in json['event_ids']! as List<Object?>)
        id! as String,
    ],
    sourceIds: <String>[
      for (final Object? id
          in (json['source_ids'] as List<Object?>?) ?? const <Object?>[])
        id! as String,
    ],
    sourceCount: (json['source_count'] as num?)?.toInt() ?? 0,
    lastCoverageAt: DateTime.tryParse(
      json['last_coverage_at'] as String? ?? '',
    ),
  );

  static List<StoryGroup> listFromJson(Object? value) => <StoryGroup>[
    for (final Object? item
        in ((value! as Map<String, dynamic>)['stories'] as List<Object?>?) ??
            const <Object?>[])
      StoryGroup.fromJson(item! as Map<String, dynamic>),
  ];

  final String id;

  /// Written by a moderator: Dialektik's title, not an outlet's.
  final String title;
  final String? coverEventId;
  final List<String> eventIds;

  /// Every outlet that covered any event of the story.
  final List<String> sourceIds;
  final int sourceCount;
  final DateTime? lastCoverageAt;
}

/// One event inside a proposal, as the moderator reviews it.
final class StoryProposalEvent {
  const StoryProposalEvent({
    required this.id,
    required this.title,
    required this.outlets,
    this.firstPublishedAt,
  });

  factory StoryProposalEvent.fromJson(Map<String, dynamic> json) =>
      StoryProposalEvent(
        id: json['id']! as String,
        title: json['title']! as String,
        outlets: <String>[
          for (final Object? o
              in (json['outlets'] as List<Object?>?) ?? const <Object?>[])
            o! as String,
        ],
        firstPublishedAt: DateTime.tryParse(
          json['first_published_at'] as String? ?? '',
        ),
      );

  final String id;
  final String title;
  final List<String> outlets;
  final DateTime? firstPublishedAt;
}

/// A grouping Core proposes: a new story, or events to add to one.
final class StoryProposal {
  const StoryProposal({
    required this.id,
    required this.suggestedTitle,
    required this.events,
    this.targetGroupId,
    this.targetTitle,
  });

  factory StoryProposal.fromJson(Map<String, dynamic> json) => StoryProposal(
    id: json['id']! as String,
    suggestedTitle: json['suggested_title']! as String,
    targetGroupId: json['target_group_id'] as String?,
    targetTitle: json['target_title'] as String?,
    events: <StoryProposalEvent>[
      for (final Object? e
          in (json['events'] as List<Object?>?) ?? const <Object?>[])
        StoryProposalEvent.fromJson(e! as Map<String, dynamic>),
    ],
  );

  static List<StoryProposal> listFromJson(Object? value) => <StoryProposal>[
    for (final Object? item
        in ((value! as Map<String, dynamic>)['proposals'] as List<Object?>?) ??
            const <Object?>[])
      StoryProposal.fromJson(item! as Map<String, dynamic>),
  ];

  final String id;
  final String suggestedTitle;
  final String? targetGroupId;
  final String? targetTitle;
  final List<StoryProposalEvent> events;

  bool get addsToStory => targetGroupId != null;
}

abstract interface class StoryGroupsRepository {
  Future<List<StoryGroup>> storyGroups();

  /// Moderators only.
  Future<List<StoryProposal>> storyProposals();

  /// Moderators only: approve with the story's title, or reject.
  Future<void> decideStoryProposal(
    String proposalId, {
    required bool approve,
    String? title,
  });
}
