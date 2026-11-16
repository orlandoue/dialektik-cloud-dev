import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/semantic_shadow/data/ephemeral_semantic_models.dart';

abstract interface class EphemeralSemanticRepository {
  Future<EphemeralSemanticDto> getEphemeralSemanticContent({
    bool refresh = false,
    PublicRequestToken? requestToken,
  });
}
