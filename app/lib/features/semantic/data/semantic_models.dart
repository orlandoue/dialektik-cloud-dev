enum SemanticDecision { match, distinct, unknown }

enum SemanticApplicability { applicable, inapplicable, unknown }

SemanticDecision semanticDecision(Object? value) => switch (value) {
  'MATCH' => SemanticDecision.match,
  'DISTINCT' => SemanticDecision.distinct,
  'UNKNOWN' => SemanticDecision.unknown,
  _ => throw const FormatException('Explicit semantic decision required.'),
};
SemanticApplicability semanticApplicability(Object? value) => switch (value) {
  'APPLICABLE' => SemanticApplicability.applicable,
  'INAPPLICABLE' => SemanticApplicability.inapplicable,
  'UNKNOWN_APPLICABILITY' => SemanticApplicability.unknown,
  _ => throw const FormatException('Explicit applicability required.'),
};
Map<String, Object?> semanticObject(Object? value) {
  if (value is! Map<String, Object?>) {
    throw const FormatException('Expected semantic object.');
  }
  return value;
}

String semanticString(Object? value) {
  if (value is! String || value.isEmpty) {
    throw const FormatException('Expected non-empty string.');
  }
  return value;
}

String? semanticNullableString(Object? value) =>
    value == null ? null : semanticString(value);
int semanticCount(Object? value) {
  if (value is! int || value < 0) {
    throw const FormatException('Expected non-negative count.');
  }
  return value;
}

DateTime semanticTime(Object? value) {
  final String text = semanticString(value);
  final DateTime? parsed = DateTime.tryParse(text);
  if (!text.endsWith('Z') || parsed == null) {
    throw const FormatException('Expected UTC timestamp.');
  }
  return parsed.toUtc();
}

List<T> semanticList<T>(Object? value, T Function(Object?) decode) {
  if (value is! List<Object?>) {
    throw const FormatException('Expected semantic array.');
  }
  return List<T>.unmodifiable(value.map(decode));
}

class SemanticStateValueDto {
  const SemanticStateValueDto({
    required this.description,
    required this.decision,
    required this.applicability,
  });
  factory SemanticStateValueDto.fromJson(Object? value) {
    final Map<String, Object?> row = semanticObject(value);
    return SemanticStateValueDto(
      description: semanticString(row['description']),
      decision: semanticDecision(row['decision']),
      applicability: semanticApplicability(row['applicability']),
    );
  }
  final String description;
  final SemanticDecision decision;
  final SemanticApplicability applicability;
}

final class SemanticStateDto extends SemanticStateValueDto {
  const SemanticStateDto({
    required super.description,
    required super.decision,
    required super.applicability,
    required this.id,
    required this.revision,
    required this.previousStateId,
    required this.observedAt,
  });
  factory SemanticStateDto.fromJson(Object? value) {
    final Map<String, Object?> row = semanticObject(value);
    if (!row.containsKey('previousStateId')) {
      throw const FormatException('State lineage required.');
    }
    final int revision = semanticCount(row['revision']);
    if (revision == 0) {
      throw const FormatException('State revision must be positive.');
    }
    return SemanticStateDto(
      description: semanticString(row['description']),
      decision: semanticDecision(row['decision']),
      applicability: semanticApplicability(row['applicability']),
      id: semanticString(row['id']),
      revision: revision,
      previousStateId: semanticNullableString(row['previousStateId']),
      observedAt: semanticTime(row['observedAt']),
    );
  }
  final String id;
  final int revision;
  final String? previousStateId;
  final DateTime observedAt;
}

final class SemanticSourceDto {
  const SemanticSourceDto({
    required this.id,
    required this.name,
    required this.canonicalDomain,
  });
  factory SemanticSourceDto.fromJson(Object? value) {
    final Map<String, Object?> row = semanticObject(value);
    return SemanticSourceDto(
      id: semanticString(row['id']),
      name: semanticString(row['name']),
      canonicalDomain: semanticString(row['canonicalDomain']),
    );
  }
  final String id;
  final String name;
  final String canonicalDomain;
}

final class SemanticArticleDto {
  const SemanticArticleDto({
    required this.id,
    required this.title,
    required this.publishedAt,
    required this.source,
    required this.decision,
    required this.applicability,
  });
  factory SemanticArticleDto.fromJson(Object? value) {
    final Map<String, Object?> row = semanticObject(value);
    return SemanticArticleDto(
      id: semanticString(row['id']),
      title: semanticString(row['title']),
      publishedAt: semanticTime(row['publishedAt']),
      source: SemanticSourceDto.fromJson(row['source']),
      decision: semanticDecision(row['decision']),
      applicability: semanticApplicability(row['applicability']),
    );
  }
  final String id;
  final String title;
  final DateTime publishedAt;
  final SemanticSourceDto source;
  final SemanticDecision decision;
  final SemanticApplicability applicability;
}

final class SemanticMembershipDto {
  const SemanticMembershipDto({
    required this.observationId,
    required this.threadId,
    required this.occurrenceId,
    required this.articleId,
    required this.decision,
    required this.applicability,
    required this.observedAt,
  });
  factory SemanticMembershipDto.fromJson(Object? value) {
    final Map<String, Object?> row = semanticObject(value);
    return SemanticMembershipDto(
      observationId: semanticString(row['observationId']),
      threadId: semanticString(row['threadId']),
      occurrenceId: semanticString(row['occurrenceId']),
      articleId: semanticString(row['articleId']),
      decision: semanticDecision(row['decision']),
      applicability: semanticApplicability(row['applicability']),
      observedAt: semanticTime(row['observedAt']),
    );
  }
  final String observationId;
  final String threadId;
  final String occurrenceId;
  final String articleId;
  final SemanticDecision decision;
  final SemanticApplicability applicability;
  final DateTime observedAt;
}

final class SemanticRelationDto {
  const SemanticRelationDto({
    required this.id,
    required this.fromOccurrenceId,
    required this.toOccurrenceId,
    required this.fromTitle,
    required this.toTitle,
    required this.decision,
    required this.applicability,
    required this.provenanceId,
  });
  factory SemanticRelationDto.fromJson(Object? value) {
    final Map<String, Object?> row = semanticObject(value);
    return SemanticRelationDto(
      id: semanticString(row['id']),
      fromOccurrenceId: semanticString(row['fromOccurrenceId']),
      toOccurrenceId: semanticString(row['toOccurrenceId']),
      fromTitle: semanticString(row['fromTitle']),
      toTitle: semanticString(row['toTitle']),
      decision: semanticDecision(row['decision']),
      applicability: semanticApplicability(row['applicability']),
      provenanceId: semanticString(row['provenanceId']),
    );
  }
  final String id;
  final String fromOccurrenceId;
  final String toOccurrenceId;
  final String fromTitle;
  final String toTitle;
  final SemanticDecision decision;
  final SemanticApplicability applicability;
  final String provenanceId;
}

final class SemanticProvenanceDto {
  const SemanticProvenanceDto({
    required this.id,
    required this.article,
    required this.provider,
    required this.providerVersion,
    required this.observedAt,
    required this.rationale,
    required this.spanId,
    required this.assertionId,
  });
  factory SemanticProvenanceDto.fromJson(Object? value) {
    final Map<String, Object?> row = semanticObject(value);
    return SemanticProvenanceDto(
      id: semanticString(row['id']),
      article: SemanticArticleDto.fromJson(row['article']),
      provider: semanticString(row['provider']),
      providerVersion: semanticString(row['providerVersion']),
      observedAt: semanticTime(row['observedAt']),
      rationale: semanticString(row['rationale']),
      spanId: semanticNullableString(row['spanId']),
      assertionId: semanticNullableString(row['assertionId']),
    );
  }
  final String id;
  final SemanticArticleDto article;
  final String provider;
  final String providerVersion;
  final DateTime observedAt;
  final String rationale;
  final String? spanId;
  final String? assertionId;
}

final class SemanticOccurrenceDto {
  const SemanticOccurrenceDto({
    required this.id,
    required this.eventId,
    required this.threadId,
    required this.threadTitle,
    required this.title,
    required this.eventAt,
    required this.state,
    required this.articleCount,
    required this.sourceCount,
    required this.articles,
    required this.sources,
    required this.provenance,
    required this.relations,
  });
  factory SemanticOccurrenceDto.fromJson(Object? value) {
    final Map<String, Object?> row = semanticObject(value);
    return SemanticOccurrenceDto(
      id: semanticString(row['id']),
      eventId: semanticString(row['eventId']),
      threadId: semanticString(row['threadId']),
      threadTitle: semanticString(row['threadTitle']),
      title: semanticString(row['title']),
      eventAt: row['eventAt'] == null ? null : semanticTime(row['eventAt']),
      state: SemanticStateDto.fromJson(row['state']),
      articleCount: semanticCount(row['articleCount']),
      sourceCount: semanticCount(row['sourceCount']),
      articles: semanticList(row['articles'], SemanticArticleDto.fromJson),
      sources: semanticList(row['sources'], SemanticSourceDto.fromJson),
      provenance: semanticList(
        row['provenance'],
        SemanticProvenanceDto.fromJson,
      ),
      relations: semanticList(row['relations'], SemanticRelationDto.fromJson),
    );
  }
  final String id;
  final String eventId;
  final String threadId;
  final String threadTitle;
  final String title;
  final DateTime? eventAt;
  final SemanticStateDto state;
  final int articleCount;
  final int sourceCount;
  final List<SemanticArticleDto> articles;
  final List<SemanticSourceDto> sources;
  final List<SemanticProvenanceDto> provenance;
  final List<SemanticRelationDto> relations;
}

final class SemanticThreadDto {
  const SemanticThreadDto({
    required this.id,
    required this.title,
    required this.summary,
    required this.state,
    required this.occurrenceCount,
    required this.articleCount,
    required this.sourceCount,
    required this.firstObserved,
    required this.lastObserved,
  });
  factory SemanticThreadDto.fromJson(Object? value) {
    final Map<String, Object?> row = semanticObject(value);
    if (row['mode'] != 'fixture') {
      throw const FormatException('Only fixture semantic mode is supported.');
    }
    return SemanticThreadDto(
      id: semanticString(row['id']),
      title: semanticString(row['title']),
      summary: semanticString(row['summary']),
      state: SemanticStateDto.fromJson(row['state']),
      occurrenceCount: semanticCount(row['occurrenceCount']),
      articleCount: semanticCount(row['articleCount']),
      sourceCount: semanticCount(row['sourceCount']),
      firstObserved: semanticTime(row['firstObserved']),
      lastObserved: semanticTime(row['lastObserved']),
    );
  }
  final String id;
  final String title;
  final String summary;
  final SemanticStateDto state;
  final int occurrenceCount;
  final int articleCount;
  final int sourceCount;
  final DateTime firstObserved;
  final DateTime lastObserved;
}

final class SemanticThreadPageDto {
  const SemanticThreadPageDto({required this.items, required this.nextCursor});
  factory SemanticThreadPageDto.fromJson(Object? value) {
    final Map<String, Object?> row = semanticObject(value);
    if (!row.containsKey('nextCursor')) {
      throw const FormatException('Cursor required.');
    }
    return SemanticThreadPageDto(
      items: semanticList(row['items'], SemanticThreadDto.fromJson),
      nextCursor: semanticNullableString(row['nextCursor']),
    );
  }
  final List<SemanticThreadDto> items;
  final String? nextCursor;
}

final class SemanticTransitionDto {
  const SemanticTransitionDto({
    required this.id,
    required this.entityKind,
    required this.occurrenceId,
    required this.previousState,
    required this.newState,
    required this.observedAt,
    required this.provenanceId,
  });
  factory SemanticTransitionDto.fromJson(Object? value) {
    final Map<String, Object?> row = semanticObject(value);
    final String kind = semanticString(row['entityKind']);
    if (kind != 'thread' && kind != 'occurrence') {
      throw const FormatException('Invalid transition target.');
    }
    return SemanticTransitionDto(
      id: semanticString(row['id']),
      entityKind: kind,
      occurrenceId: semanticNullableString(row['occurrenceId']),
      previousState: row['previousState'] == null
          ? null
          : SemanticStateValueDto.fromJson(row['previousState']),
      newState: SemanticStateValueDto.fromJson(row['newState']),
      observedAt: semanticTime(row['observedAt']),
      provenanceId: semanticString(row['provenanceId']),
    );
  }
  final String id;
  final String entityKind;
  final String? occurrenceId;
  final SemanticStateValueDto? previousState;
  final SemanticStateValueDto newState;
  final DateTime observedAt;
  final String provenanceId;
}

final class SemanticTimelineDto {
  const SemanticTimelineDto({
    required this.occurrences,
    required this.arrivals,
    required this.transitions,
  });
  factory SemanticTimelineDto.fromJson(Object? value) {
    final Map<String, Object?> row = semanticObject(value);
    return SemanticTimelineDto(
      occurrences: semanticList(
        row['occurrences'],
        SemanticOccurrenceDto.fromJson,
      ),
      arrivals: semanticList(row['arrivals'], SemanticMembershipDto.fromJson),
      transitions: semanticList(
        row['transitions'],
        SemanticTransitionDto.fromJson,
      ),
    );
  }
  final List<SemanticOccurrenceDto> occurrences;
  final List<SemanticMembershipDto> arrivals;
  final List<SemanticTransitionDto> transitions;
}

final class SemanticThreadDetailDto {
  const SemanticThreadDetailDto({
    required this.thread,
    required this.occurrences,
    required this.sources,
    required this.relations,
    required this.timeline,
  });
  factory SemanticThreadDetailDto.fromJson(Object? value) {
    final Map<String, Object?> row = semanticObject(value);
    return SemanticThreadDetailDto(
      thread: SemanticThreadDto.fromJson(row),
      occurrences: semanticList(
        row['occurrences'],
        SemanticOccurrenceDto.fromJson,
      ),
      sources: semanticList(row['sources'], SemanticSourceDto.fromJson),
      relations: semanticList(row['relations'], SemanticRelationDto.fromJson),
      timeline: SemanticTimelineDto.fromJson(row['timeline']),
    );
  }
  final SemanticThreadDto thread;
  final List<SemanticOccurrenceDto> occurrences;
  final List<SemanticSourceDto> sources;
  final List<SemanticRelationDto> relations;
  final SemanticTimelineDto timeline;
}

final class SemanticArticleContextDto {
  const SemanticArticleContextDto({required this.memberships});
  factory SemanticArticleContextDto.fromJson(Object? value) {
    final Map<String, Object?> row = semanticObject(value);
    if (row['mode'] != 'fixture') {
      throw const FormatException('Fixture context required.');
    }
    return SemanticArticleContextDto(
      memberships: semanticList(
        row['memberships'],
        SemanticMembershipDto.fromJson,
      ),
    );
  }
  final List<SemanticMembershipDto> memberships;
}

final class SemanticArticleDetailDto {
  const SemanticArticleDetailDto({
    required this.id,
    required this.title,
    required this.originalText,
    required this.publishedAt,
    required this.source,
    required this.memberships,
  });
  factory SemanticArticleDetailDto.fromJson(Object? value) {
    final Map<String, Object?> row = semanticObject(value);
    return SemanticArticleDetailDto(
      id: semanticString(row['id']),
      title: semanticString(row['title']),
      originalText: semanticString(row['originalText']),
      publishedAt: semanticTime(row['publishedAt']),
      source: SemanticSourceDto.fromJson(row['source']),
      memberships: semanticList(
        row['memberships'],
        SemanticMembershipDto.fromJson,
      ),
    );
  }
  final String id;
  final String title;
  final String originalText;
  final DateTime publishedAt;
  final SemanticSourceDto source;
  final List<SemanticMembershipDto> memberships;
}
