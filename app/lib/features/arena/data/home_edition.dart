import 'package:dialektik/features/consumer/data/public_api_models.dart';

/// The hourly edition of Inicio that Core composes with fixed rules: the
/// order of «En desarrollo», the «Duelo del día» and moderators' pins.
final class HomeEdition {
  const HomeEdition({
    required this.generatedAt,
    required this.nextAt,
    required this.trigger,
    required this.rulesVersion,
    required this.rules,
    required this.items,
    required this.cards,
    required this.storyTitles,
    this.duelEventId,
    this.duelReason,
    this.duelPinReason,
    this.hidden = const <HomeEditionHidden>[],
  });

  factory HomeEdition.fromJson(Map<String, dynamic> json) {
    final Map<String, dynamic> rawCards =
        (json['cards'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
    final Map<String, EventCardDto> cards = <String, EventCardDto>{};
    for (final MapEntry<String, dynamic> entry in rawCards.entries) {
      try {
        cards[entry.key] = EventCardDto.fromJson(entry.value);
      } on Object {
        // A card the app cannot read is left out, never shown half-parsed.
      }
    }
    return HomeEdition(
      generatedAt: DateTime.parse(json['generated_at'] as String),
      nextAt: DateTime.parse(json['next_at'] as String),
      trigger: json['trigger'] as String,
      rulesVersion: json['rules_version'] as String,
      rules: json['rules'] as String,
      items: <HomeEditionItem>[
        for (final Object? item
            in (json['items'] as List<dynamic>?) ?? const <dynamic>[])
          HomeEditionItem.fromJson(item! as Map<String, dynamic>),
      ],
      cards: cards,
      storyTitles: <String, String>{
        for (final MapEntry<String, dynamic> e
            in ((json['story_titles'] as Map<String, dynamic>?) ??
                    const <String, dynamic>{})
                .entries)
          e.key: e.value as String,
      },
      duelEventId: json['duel_event_id'] as String?,
      duelReason: json['duel_reason'] as String?,
      duelPinReason: json['duel_pin_reason'] as String?,
      hidden: <HomeEditionHidden>[
        for (final Object? item
            in (json['hidden'] as List<dynamic>?) ?? const <dynamic>[])
          HomeEditionHidden.fromJson(item! as Map<String, dynamic>),
      ],
    );
  }

  final DateTime generatedAt;
  final DateTime nextAt;

  /// hourly, breaking, moderation or startup.
  final String trigger;
  final String rulesVersion;

  /// How the edition orders, in words, as Core publishes it.
  final String rules;
  final List<HomeEditionItem> items;
  final Map<String, EventCardDto> cards;
  final Map<String, String> storyTitles;
  final String? duelEventId;

  /// score (the highest-scoring case with a duel) or moderation.
  final String? duelReason;
  final String? duelPinReason;
  final List<HomeEditionHidden> hidden;

  /// The item a case belongs to in this edition, if any.
  HomeEditionItem? itemOf(String eventId) {
    for (final HomeEditionItem item in items) {
      if (item.eventIds.contains(eventId)) return item;
    }
    return null;
  }
}

final class HomeEditionItem {
  const HomeEditionItem({
    required this.kind,
    required this.id,
    required this.eventIds,
    required this.leadEventId,
    required this.outlets,
    required this.lastCoverageAt,
    required this.score,
    required this.pinned,
    this.pinReason,
  });

  factory HomeEditionItem.fromJson(Map<String, dynamic> json) =>
      HomeEditionItem(
        kind: json['kind'] as String,
        id: json['id'] as String,
        eventIds: <String>[
          for (final Object? id in json['event_ids'] as List<dynamic>)
            id! as String,
        ],
        leadEventId: json['lead_event_id'] as String,
        outlets: (json['outlets'] as num).toInt(),
        lastCoverageAt: DateTime.parse(json['last_coverage_at'] as String),
        score: (json['score'] as num).toDouble(),
        pinned: json['pinned'] == true,
        pinReason: json['pin_reason'] as String?,
      );

  /// event or story.
  final String kind;
  final String id;
  final List<String> eventIds;
  final String leadEventId;
  final int outlets;
  final DateTime lastCoverageAt;
  final double score;
  final bool pinned;
  final String? pinReason;
}

final class HomeEditionHidden {
  const HomeEditionHidden({
    required this.kind,
    required this.id,
    required this.reason,
  });

  factory HomeEditionHidden.fromJson(Map<String, dynamic> json) =>
      HomeEditionHidden(
        kind: json['kind'] as String,
        id: json['id'] as String,
        reason: json['reason'] as String,
      );

  final String kind;
  final String id;
  final String reason;
}

/// A moderator's pin, hide or duel choice, always with a reason and expiry.
final class HomeEditionPin {
  const HomeEditionPin({
    required this.id,
    required this.targetKind,
    required this.targetId,
    required this.action,
    required this.reason,
    required this.expiresAt,
  });

  factory HomeEditionPin.fromJson(Map<String, dynamic> json) => HomeEditionPin(
    id: json['id'] as String,
    targetKind: json['target_kind'] as String,
    targetId: json['target_id'] as String,
    action: json['action'] as String,
    reason: json['reason'] as String,
    expiresAt: DateTime.parse(json['expires_at'] as String),
  );

  final String id;
  final String targetKind;
  final String targetId;

  /// pin, hide or duel.
  final String action;
  final String reason;
  final DateTime expiresAt;
}

abstract interface class HomeEditionRepository {
  /// The current edition of a country; null before Core composes the first.
  Future<HomeEdition?> homeEdition(String country);
}

abstract interface class HomeEditionModerationRepository {
  Future<(HomeEdition?, List<HomeEditionPin>)> moderationEdition(
    String country,
  );

  Future<HomeEdition?> pinEdition({
    required String country,
    required String targetKind,
    required String targetId,
    required String action,
    required String reason,
    required int hours,
  });

  Future<HomeEdition?> unpinEdition(String pinId);
}
