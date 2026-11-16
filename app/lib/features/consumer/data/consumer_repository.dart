import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';

/// Consumer-facing read boundary. Presentation code never depends on HTTP.
abstract interface class ConsumerRepository {
  Future<PublicPage<EventCardDto>> listFeed({
    String? category,
    String? topic,
    String? cursor,
    int limit = 20,
    bool refresh = false,
    PublicRequestToken? requestToken,
  });

  Future<PublicPage<ContradictionDto>> listContradictions({
    String? cursor,
    int limit = 20,
    bool refresh = false,
    PublicRequestToken? requestToken,
  });

  Future<EventDetailDto> getEvent(
    String eventId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  });

  Future<List<PositionListItemDto>> listEventPositions(
    String eventId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  });

  Future<List<PublicAssertionDto>> listUnclusteredAssertions(
    String eventId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  });

  Future<List<RelationshipDto>> listEventRelationships(
    String eventId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  });

  Future<PositionDetailDto> getPosition(
    String positionId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  });

  Future<SourceDto> getSource(
    String sourceId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  });
}
