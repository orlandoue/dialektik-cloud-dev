import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'Flutter consumed routes and DTO fields match the Phase-7 snapshot',
    () async {
      final Object? decoded = jsonDecode(
        await File('assets/contracts/public-api-v1.json').readAsString(),
      );
      expect(decoded, isA<Map<String, Object?>>());
      final Map<String, Object?> document = decoded! as Map<String, Object?>;
      final Map<String, Object?> paths =
          document['paths']! as Map<String, Object?>;
      expect(paths.keys.toSet(), <String>{
        '/v1/openapi.json',
        '/v1/feed',
        '/v1/contradictions',
        '/v1/events/{eventId}',
        '/v1/events/{eventId}/positions',
        '/v1/events/{eventId}/unclustered-assertions',
        '/v1/events/{eventId}/relationships',
        '/v1/positions/{positionId}',
        '/v1/sources/{sourceId}',
      });

      final Map<String, Object?> components =
          document['components']! as Map<String, Object?>;
      final Map<String, Object?> schemas =
          components['schemas']! as Map<String, Object?>;
      expect(
        schemas.keys,
        containsAll(<String>[
          'EventCard',
          'EventDetail',
          'PositionListItem',
          'PositionDetail',
          'PublicAssertion',
          'Relationship',
          'Contradiction',
          'Source',
          'Tombstone',
        ]),
      );

      final Set<String> propertyNames = <String>{};
      _collectPropertyNames(document, propertyNames);
      expect(
        propertyNames.intersection(<String>{
          'candidate_class',
          'similarity_score',
          'relation_confidence',
          'candidate_score',
          'embedding',
          'moderation_task',
          'claim_interpretation',
          'provider_output',
        }),
        isEmpty,
      );
    },
  );
}

void _collectPropertyNames(Object? value, Set<String> result) {
  if (value is Map<String, Object?>) {
    final Object? properties = value['properties'];
    if (properties is Map<String, Object?>) result.addAll(properties.keys);
    for (final Object? child in value.values) {
      _collectPropertyNames(child, result);
    }
  } else if (value is List<Object?>) {
    for (final Object? child in value) {
      _collectPropertyNames(child, result);
    }
  }
}
