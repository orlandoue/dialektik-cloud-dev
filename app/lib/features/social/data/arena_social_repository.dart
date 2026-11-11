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

  bool get hasLink => url != null && url!.hasScheme && url!.host.isNotEmpty;
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
  });
  Future<List<CommunityEntry>> voteCommunityEntry(String entryId, int? vote);
}
