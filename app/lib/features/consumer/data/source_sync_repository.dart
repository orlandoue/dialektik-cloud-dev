/// A best-effort lookup of a channel's publicly visible YouTube subscriptions.
class YouTubeSourceMatches {
  const YouTubeSourceMatches({required this.sourceIds, required this.truncated});
  final Set<String> sourceIds;
  final bool truncated;
}
abstract interface class SourceSyncRepository {
  Future<YouTubeSourceMatches> lookupPublicYouTubeSubscriptions(String channel);
}
