class SocialComment {
  factory SocialComment.fromJson(Map<String, dynamic> json) => SocialComment(
    body: json['body'] as String,
    url: Uri.parse(json['url'] as String),
  );
  const SocialComment({required this.body, required this.url});
  final String body;
  final Uri url;
}

class SocialSummary {
  factory SocialSummary.fromJson(Map<String, dynamic> json) => SocialSummary(
    solid: json['solid'] as int,
    biased: json['biased'] as int,
    mine: json['mine'] as String?,
    followers: json['followers'] as int?,
    comments: ((json['comments'] as List?) ?? [])
        .map((e) => SocialComment.fromJson(e as Map<String, dynamic>))
        .toList(),
  );
  const SocialSummary({
    required this.solid,
    required this.biased,
    this.mine,
    this.followers,
    this.comments = const [],
  });
  final int solid, biased;
  final String? mine;
  final int? followers;
  final List<SocialComment> comments;
}

abstract interface class SocialRepository {
  Future<SocialSummary> socialSummary({String? eventId, String? sourceId});
  Future<SocialSummary> setSocialReaction(String eventId, String? reaction);
  Future<SocialSummary> addSocialComment(
    String eventId,
    String articleId,
    String body,
  );
}
