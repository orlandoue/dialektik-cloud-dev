import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/semantic_shadow/data/semantic_graph_models.dart';

abstract interface class SemanticGraphRepository {
  Future<SemanticGraphDto> getSemanticGraph({
    String? runId,
    bool refresh = false,
    PublicRequestToken? requestToken,
  });
}
