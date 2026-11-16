import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/semantic/data/semantic_models.dart';

abstract interface class SemanticRepository {
  Future<SemanticThreadPageDto> listSemanticThreads({
    String? cursor,
    int limit = 50,
    bool refresh = false,
    PublicRequestToken? requestToken,
  });
  Future<SemanticThreadDetailDto> getSemanticThread(
    String id, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  });
  Future<SemanticTimelineDto> getSemanticTimeline(
    String id, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  });
  Future<SemanticOccurrenceDto> getSemanticOccurrence(
    String id, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  });
  Future<List<SemanticSourceDto>> getSemanticOccurrenceSources(
    String id, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  });
  Future<List<SemanticSourceDto>> getSemanticThreadSources(
    String id, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  });
  Future<SemanticArticleContextDto> getArticleSemanticContext(
    String id, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  });
  Future<SemanticArticleDetailDto> getSemanticArticle(
    String id, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  });
  Future<SemanticProvenanceDto> getSemanticProvenance(
    String id, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  });
}
