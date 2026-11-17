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

  /// A DOI, a link or a title; up to three candidates from Crossref,
  /// OpenAlex and arXiv.
  Future<LookupResult> lookup(String query);

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

  /// «Reportar»: one report per reader; it reaches the moderation queue.
  Future<void> report(String commentId, ReportReason reason, {String? note});
}

/// What only accounts in DIALEKTIK_SCIENCE_MODERATORS can do.
abstract interface class ScienceModerationRepository {
  Future<ModerationQueue> moderationQueue();

  /// Approves a study comment in review, or rejects it with a reason.
  Future<void> decide(
    String commentId, {
    required bool approve,
    String? reason,
  });

  /// Dismisses the reports of a comment, or hides it with a reason.
  Future<void> resolveReports(
    String commentId, {
    required bool hide,
    String? reason,
  });

  Future<Study> moderateStudy(String doi, StudyModeration fields);

  /// Calls and errors per metadata API and day, last 30 days, and whether
  /// the daily harvest is running.
  Future<ApiUsage> usage();
}
