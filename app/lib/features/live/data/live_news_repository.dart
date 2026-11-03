import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';

abstract interface class MirrorNewsMemory {
  LiveNewsPageDto? get cachedMirrorNews;
  Set<String>? get cachedFollowedSources;
  Future<void> prefetchMirrorNews();
}

abstract interface class ScopedLiveNewsRepository {
  Future<LiveNewsPageDto> listScopedLiveNews({required String scope, String? cursor,
    String? format, String? topic, String? query, String? sourceId, DateTime? publishedFrom,
    DateTime? publishedTo, bool refresh = false, PublicRequestToken? requestToken});
}

abstract interface class LiveNewsRepository {
  Future<LiveNewsPageDto> listLiveNews({
    String? cursor,
    int limit = 25,
    String? query,
    String? sourceId,
    String? format,
    String? topic,
    DateTime? publishedFrom,
    DateTime? publishedTo,
    bool refresh = false,
    PublicRequestToken? requestToken,
  });
  Future<List<LiveSourceDto>> listLiveSources({
    bool refresh = false,
    PublicRequestToken? requestToken,
  });
  Future<LiveNewsDetailDto> getLiveNews(
    String id, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  });
  Future<LiveSourceDetailDto> getLiveSource(
    String id, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  });
  Future<LiveProvenanceDto> getLiveProvenance(
    String articleId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  });
}
