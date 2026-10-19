import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/semantic_shadow/data/semantic_shadow_models.dart';

/// Separate read-only development boundary; it has no execution action.
abstract interface class SemanticShadowRepository {
  Future<SemanticShadowPreflightDto> getSemanticShadowPreflight({
    bool refresh = false,
    PublicRequestToken? requestToken,
  });
}
