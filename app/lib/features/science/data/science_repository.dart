import 'package:dialektik/features/science/data/science_models.dart';

/// Studies and story comments served by Core.
///
/// Requires API: every `/v1/science/*` and `/v1/stories/*/comments` route is
/// new. Until Core ships them the Science feed shows its error state, and
/// story comments fall back to the existing community entries (see
/// `PublicApiClient.storyComments`).
abstract interface class ScienceRepository {
  Future<List<Study>> listStudies(StudyFilter filter);

  /// Study by DOI, resolved and cached server side (Crossref, OpenAlex).
  Future<Study> study(String doi);

  Future<List<StoryComment>> storyComments(String eventId);

  /// Normal comments are published at once and can be reported.
  Future<StoryComment> addComment(
    String eventId, {
    required String body,
    String? parentId,
  });

  /// Study comments go to moderation first; the account must be three days
  /// old. Throws [StudyCommentRejected] for a retracted study, a duplicate
  /// (same DOI and claim in this story) or a non-literal fragment.
  Future<StoryComment> addStudyComment(
    String eventId, {
    required String doi,
    required String claimQuoteId,
    required StudyRelation relation,
    required String abstractFragment,
    required String body,
  });

  /// «Útil» or «Pertinente»; `reacted: false` withdraws it.
  Future<StoryComment> react(String commentId, {required bool reacted});

  Future<List<StoryComment>> commentsCitingStudy(String doi);

  /// Whether Science and story comments are on for this account.
  Future<ScienceAccess> access();
}
