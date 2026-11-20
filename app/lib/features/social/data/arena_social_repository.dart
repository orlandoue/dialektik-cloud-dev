/// Support of each posture of a case, as counted by Core.
class PositionVotes {
  const PositionVotes({
    required this.total,
    required this.byPosition,
    this.mine,
  });

  factory PositionVotes.fromJson(Map<String, dynamic> json) => PositionVotes(
    total: json['total'] as int,
    mine: json['mine'] as String?,
    byPosition: <String, int>{
      for (final Map<String, dynamic> item
          in ((json['positions'] as List<dynamic>?) ?? <dynamic>[])
              .cast<Map<String, dynamic>>())
        item['position_id'] as String: item['votes'] as int,
    },
  );

  final int total;

  /// Position the signed-in reader voted for, if any.
  final String? mine;
  final Map<String, int> byPosition;

  int votesFor(String? positionId) => byPosition[positionId] ?? 0;

  /// Share of all votes of the case, from 0 to 1.
  double shareOf(String? positionId) =>
      total == 0 ? 0 : votesFor(positionId) / total;
}

enum CommunityChannel {
  debate('debate'),
  aporte('aporte'),
  nota('nota');

  const CommunityChannel(this.wire);
  final String wire;

  static CommunityChannel parse(String value) => CommunityChannel.values
      .firstWhere((CommunityChannel c) => c.wire == value);
}

/// One entry of the «Comunidad del caso», with its shared usefulness votes.
class CommunityEntry {
  const CommunityEntry({
    required this.id,
    required this.channel,
    required this.author,
    required this.body,
    this.articleId,
    this.url,
    this.createdAt,
    this.upvotes = 0,
    this.downvotes = 0,
    this.myVote,
    this.mine = false,
    this.positionId,
    this.stance,
    this.inReview = false,
  });

  factory CommunityEntry.fromJson(Map<String, dynamic> json) => CommunityEntry(
    id: json['id'] as String,
    channel: CommunityChannel.parse(json['channel'] as String),
    author: json['author'] as String,
    body: json['body'] as String,
    articleId: json['article_id'] as String?,
    url: Uri.tryParse(json['url'] as String? ?? ''),
    createdAt: DateTime.tryParse(json['created_at'] as String? ?? ''),
    upvotes: json['upvotes'] as int,
    downvotes: json['downvotes'] as int,
    myVote: json['my_vote'] as int?,
    mine: json['mine'] as bool? ?? false,
    positionId: json['position_id'] as String?,
    stance: EntryStance.parse(json['stance'] as String?),
    inReview: json['status'] == 'in_review',
  );

  static List<CommunityEntry> listFromJson(Object? value) => <CommunityEntry>[
    for (final Object? item
        in ((value! as Map<String, dynamic>)['entries'] as List<dynamic>?) ??
            [])
      CommunityEntry.fromJson(item! as Map<String, dynamic>),
  ];

  final String id;
  final CommunityChannel channel;
  final String author;
  final String body;
  final String? articleId;
  final Uri? url;
  final DateTime? createdAt;
  final int upvotes;
  final int downvotes;

  /// `1`, `-1` or null for the signed-in reader.
  final int? myVote;
  final bool mine;

  /// The version (position) it is about; null: the case as a whole.
  final String? positionId;
  final EntryStance? stance;

  /// Waiting for a moderator; only its author sees it.
  final bool inReview;

  bool get hasLink => url != null && url!.hasScheme && url!.host.isNotEmpty;
}

/// What a contributed link does for the version it is about.
enum EntryStance {
  supports('supports', 'Respalda'),
  contradicts('contradicts', 'Contradice'),
  context('context', 'Da contexto');

  const EntryStance(this.wire, this.label);
  final String wire;
  final String label;

  static EntryStance? parse(String? value) =>
      EntryStance.values.where((EntryStance s) => s.wire == value).firstOrNull;
}

/// A link contribution waiting for a moderator.
final class ReviewEntry {
  const ReviewEntry({
    required this.id,
    required this.eventTitle,
    required this.author,
    required this.body,
    this.url,
    this.positionTitle,
    this.stance,
  });

  factory ReviewEntry.fromJson(Map<String, dynamic> json) => ReviewEntry(
    id: json['id']! as String,
    eventTitle: json['event_title'] as String? ?? '',
    author: json['author'] as String? ?? '',
    body: json['body'] as String? ?? '',
    url: Uri.tryParse(json['url'] as String? ?? ''),
    positionTitle: json['position_title'] as String?,
    stance: EntryStance.parse(json['stance'] as String?),
  );

  static List<ReviewEntry> listFromJson(Object? value) => <ReviewEntry>[
    for (final Object? item
        in ((value! as Map<String, dynamic>)['entries'] as List<dynamic>?) ??
            const <Object?>[])
      ReviewEntry.fromJson(item! as Map<String, dynamic>),
  ];

  final String id;
  final String eventTitle;
  final String author;
  final String body;
  final Uri? url;
  final String? positionTitle;
  final EntryStance? stance;
}

/// The moderator's queue of link contributions.
abstract interface class CommunityModerationRepository {
  Future<List<ReviewEntry>> communityReviewQueue();
  Future<void> reviewCommunityEntry(String entryId, {required bool approve});
}

/// Posture votes and the three community channels served by Core.
abstract interface class ArenaSocialRepository {
  Future<PositionVotes> positionVotes(String eventId);
  Future<PositionVotes> votePosition(String eventId, String? positionId);
  Future<List<CommunityEntry>> communityEntries(String eventId);
  Future<List<CommunityEntry>> addCommunityEntry(
    String eventId, {
    required CommunityChannel channel,
    required String body,
    String? articleId,
    Uri? link,

    /// Public alias; Core derives a pseudonym when it is null.
    String? alias,

    /// The version it is about (a position id), and what the link does.
    String? positionId,
    EntryStance? stance,
  });
  Future<List<CommunityEntry>> voteCommunityEntry(String entryId, int? vote);

  /// Published comments per case, for the duel cards (one request).
  Future<Map<String, int>> commentCounts(List<String> eventIds);
}
