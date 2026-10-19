enum AnalysisState { analysisPending, published }

enum EvidenceAbsence { noEvidenceYet, inconclusive }

enum RelationshipType { r01a, r05, r06, r07, r11a, r11b }

enum RelationshipScope { intraEvent, crossEvent, intraArticle }

enum RelationshipEndpointRole { peer, source, target }

enum RectifiedBy { source, moderation }

enum ClaimLocation { headline, lede, body, caption }

enum TombstoneOperation { split, merge, absorbed, rectification }

enum TombstoneSuccessorType {
  event,
  position,
  claimSpan,
  contradictionPublication,
}

final class PublicPage<T> {
  const PublicPage({required this.items, required this.nextCursor});

  final List<T> items;
  final String? nextCursor;
}

class EventCardDto {
  const EventCardDto({
    required this.id,
    required this.titleDescriptive,
    required this.category,
    required this.detectedAt,
    required this.analysisState,
    required this.sourceCount,
    required this.positionCount,
  });

  factory EventCardDto.fromJson(Object? value) {
    final _JsonObject json =
        _JsonObject.read(value, 'EventCard', const <String>{
          'id',
          'title_descriptive',
          'category',
          'detected_at',
          'analysis_state',
          'source_count',
          'position_count',
        });
    return EventCardDto(
      id: json.string('id'),
      titleDescriptive: json.string('title_descriptive'),
      category: json.string('category'),
      detectedAt: json.dateTime('detected_at'),
      analysisState: json
          .enumValue('analysis_state', const <String, AnalysisState>{
            'ANALYSIS_PENDING': AnalysisState.analysisPending,
            'PUBLISHED': AnalysisState.published,
          }),
      sourceCount: json.integer('source_count', minimum: 0),
      positionCount: json.nullableInteger('position_count', minimum: 1),
    );
  }

  final String id;
  final String titleDescriptive;
  final String category;
  final DateTime detectedAt;
  final AnalysisState analysisState;
  final int sourceCount;
  final int? positionCount;
}

final class EventDetailDto extends EventCardDto {
  const EventDetailDto({
    required super.id,
    required super.titleDescriptive,
    required super.category,
    required super.detectedAt,
    required super.analysisState,
    required super.sourceCount,
    required super.positionCount,
    required this.window,
    required this.primaryFact,
  });

  factory EventDetailDto.fromJson(Object? value) {
    final _JsonObject json =
        _JsonObject.read(value, 'EventDetail', const <String>{
          'id',
          'title_descriptive',
          'category',
          'detected_at',
          'analysis_state',
          'source_count',
          'position_count',
          'window',
          'primary_fact',
          'merged_into',
        });
    if (json.raw('merged_into') != null) {
      throw const FormatException('EventDetail.merged_into must be null.');
    }
    final _JsonObject window = json.object('window', const <String>{
      'from',
      'to',
    });
    return EventDetailDto(
      id: json.string('id'),
      titleDescriptive: json.string('title_descriptive'),
      category: json.string('category'),
      detectedAt: json.dateTime('detected_at'),
      analysisState: json
          .enumValue('analysis_state', const <String, AnalysisState>{
            'ANALYSIS_PENDING': AnalysisState.analysisPending,
            'PUBLISHED': AnalysisState.published,
          }),
      sourceCount: json.integer('source_count', minimum: 0),
      positionCount: json.nullableInteger('position_count', minimum: 1),
      window: EventWindowDto(
        from: window.dateTime('from'),
        to: window.nullableDateTime('to'),
      ),
      primaryFact: json.raw('primary_fact') == null
          ? null
          : PrimaryFactDto.fromJson(json.raw('primary_fact')),
    );
  }

  final EventWindowDto window;
  final PrimaryFactDto? primaryFact;
}

final class EventWindowDto {
  const EventWindowDto({required this.from, required this.to});

  final DateTime from;
  final DateTime? to;
}

final class PrimaryFactDto {
  const PrimaryFactDto({
    required this.statement,
    required this.primaryPublicationUrl,
    required this.primarySource,
  });

  factory PrimaryFactDto.fromJson(Object? value) {
    final _JsonObject json = _JsonObject.read(
      value,
      'PrimaryFact',
      const <String>{'statement', 'primary_publication_url', 'primary_source'},
    );
    final _JsonObject source = json.object('primary_source', const <String>{
      'id',
      'name',
    });
    return PrimaryFactDto(
      statement: json.string('statement'),
      primaryPublicationUrl: json.uri('primary_publication_url'),
      primarySource: SourceReferenceDto(
        id: source.string('id'),
        name: source.string('name'),
      ),
    );
  }

  final String statement;
  final Uri primaryPublicationUrl;
  final SourceReferenceDto primarySource;
}

final class SourceReferenceDto {
  const SourceReferenceDto({required this.id, required this.name});

  final String id;
  final String name;
}

class PositionListItemDto {
  const PositionListItemDto({
    required this.id,
    required this.ordinal,
    required this.total,
    required this.neutralRank,
    required this.title,
    required this.publishedAt,
    required this.assertionCount,
    required this.formedByCount,
    required this.evidenceAbsence,
    required this.evidenceAbsenceReason,
  });

  factory PositionListItemDto.fromJson(Object? value) {
    final _JsonObject json = _positionObject(value, 'PositionListItem');
    return _positionBase(json);
  }

  final String id;
  final int ordinal;
  final int total;
  final int neutralRank;
  final String title;
  final DateTime publishedAt;
  final int assertionCount;
  final int formedByCount;
  final EvidenceAbsence? evidenceAbsence;
  final String? evidenceAbsenceReason;
}

final class PositionDetailDto extends PositionListItemDto {
  const PositionDetailDto({
    required super.id,
    required super.ordinal,
    required super.total,
    required super.neutralRank,
    required super.title,
    required super.publishedAt,
    required super.assertionCount,
    required super.formedByCount,
    required super.evidenceAbsence,
    required super.evidenceAbsenceReason,
    required this.sourceCount,
    required this.assertions,
    required this.formedBy,
  });

  factory PositionDetailDto.fromJson(Object? value) {
    final _JsonObject json = _positionObject(
      value,
      'PositionDetail',
      extra: const <String>{'source_count', 'assertions', 'formed_by'},
    );
    final PositionListItemDto base = _positionBase(json);
    return PositionDetailDto(
      id: base.id,
      ordinal: base.ordinal,
      total: base.total,
      neutralRank: base.neutralRank,
      title: base.title,
      publishedAt: base.publishedAt,
      assertionCount: base.assertionCount,
      formedByCount: base.formedByCount,
      evidenceAbsence: base.evidenceAbsence,
      evidenceAbsenceReason: base.evidenceAbsenceReason,
      sourceCount: json.integer('source_count', minimum: 1),
      assertions: json.list('assertions', PublicAssertionDto.fromJson),
      formedBy: json.list('formed_by', FormedByDto.fromJson),
    );
  }

  final int sourceCount;
  final List<PublicAssertionDto> assertions;
  final List<FormedByDto> formedBy;
}

final class FormedByDto {
  const FormedByDto({required this.relationshipId, required this.declaredAt});

  factory FormedByDto.fromJson(Object? value) {
    final _JsonObject json = _JsonObject.read(value, 'FormedBy', const <String>{
      'relationship_id',
      'declared_by_display',
      'declared_at',
    });
    if (json.string('declared_by_display') != 'equipo editorial') {
      throw const FormatException('Invalid public declaration label.');
    }
    return FormedByDto(
      relationshipId: json.string('relationship_id'),
      declaredAt: json.dateTime('declared_at'),
    );
  }

  final String relationshipId;
  final DateTime declaredAt;
}

final class PublicAssertionDto {
  const PublicAssertionDto({
    required this.id,
    required this.ordinalInSpan,
    required this.isPrincipal,
    required this.span,
    required this.isNotEvaluable,
    required this.epistemicReason,
  });

  factory PublicAssertionDto.fromJson(Object? value) {
    final _JsonObject json =
        _JsonObject.read(value, 'PublicAssertion', const <String>{
          'id',
          'ordinal_in_span',
          'is_principal',
          'span',
          'epistemic_class',
          'epistemic_reason',
          'evidence_by_stance_for_assertion',
          'my_evaluation',
        });
    final Object? epistemicClass = json.raw('epistemic_class');
    if (epistemicClass != null && epistemicClass != 'not_evaluable') {
      throw const FormatException('Unknown public epistemic class.');
    }
    if (json.raw('evidence_by_stance_for_assertion') != null ||
        json.raw('my_evaluation') != null) {
      throw const FormatException(
        'Prohibited assertion aggregates are non-null.',
      );
    }
    return PublicAssertionDto(
      id: json.string('id'),
      ordinalInSpan: json.integer('ordinal_in_span', minimum: 1),
      isPrincipal: json.boolean('is_principal'),
      span: ClaimSpanDto.fromJson(json.raw('span')),
      isNotEvaluable: epistemicClass == 'not_evaluable',
      epistemicReason: json.nullableString('epistemic_reason'),
    );
  }

  final String id;
  final int ordinalInSpan;
  final bool isPrincipal;
  final ClaimSpanDto span;
  final bool isNotEvaluable;
  final String? epistemicReason;
}

final class ClaimSpanDto {
  const ClaimSpanDto({
    required this.id,
    required this.quotedText,
    required this.location,
    required this.attributionChain,
    required this.article,
    required this.capturedAt,
    required this.highlightRanges,
  });

  factory ClaimSpanDto.fromJson(Object? value) {
    final _JsonObject json =
        _JsonObject.read(value, 'ClaimSpan', const <String>{
          'id',
          'quoted_text',
          'location',
          'attribution_chain',
          'article',
          'captured_at',
          'highlight_ranges',
          'rectified',
        });
    if (json.raw('rectified') != null) {
      throw const FormatException('ClaimSpan.rectified must be null.');
    }
    return ClaimSpanDto(
      id: json.string('id'),
      quotedText: json.string('quoted_text'),
      location: json.enumValue('location', const <String, ClaimLocation>{
        'headline': ClaimLocation.headline,
        'lede': ClaimLocation.lede,
        'body': ClaimLocation.body,
        'caption': ClaimLocation.caption,
      }),
      attributionChain: json.list('attribution_chain', AttributionDto.fromJson),
      article: ArticleDto.fromJson(json.raw('article')),
      capturedAt: json.dateTime('captured_at'),
      highlightRanges: json.list(
        'highlight_ranges',
        HighlightRangeDto.fromJson,
      ),
    );
  }

  final String id;
  final String quotedText;
  final ClaimLocation location;
  final List<AttributionDto> attributionChain;
  final ArticleDto article;
  final DateTime capturedAt;
  final List<HighlightRangeDto> highlightRanges;
}

final class ArticleDto {
  const ArticleDto({
    required this.id,
    required this.urlCanonical,
    required this.publishedAt,
    required this.source,
  });

  factory ArticleDto.fromJson(Object? value) {
    final _JsonObject json = _JsonObject.read(value, 'Article', const <String>{
      'id',
      'url_canonical',
      'published_at',
      'source',
    });
    return ArticleDto(
      id: json.string('id'),
      urlCanonical: json.uri('url_canonical'),
      publishedAt: json.dateTime('published_at'),
      source: SourceDto.fromJson(json.raw('source')),
    );
  }

  final String id;
  final Uri urlCanonical;
  final DateTime publishedAt;
  final SourceDto source;
}

final class AttributionDto {
  const AttributionDto({
    required this.order,
    required this.attributor,
    required this.attributorType,
  });

  factory AttributionDto.fromJson(Object? value) {
    final _JsonObject json = _JsonObject.read(
      value,
      'Attribution',
      const <String>{'order', 'attributor', 'attributor_type'},
    );
    return AttributionDto(
      order: json.integer('order', minimum: 1),
      attributor: json.string('attributor'),
      attributorType: json.string('attributor_type'),
    );
  }

  final int order;
  final String attributor;
  final String attributorType;
}

final class HighlightRangeDto {
  const HighlightRangeDto({
    required this.start,
    required this.end,
    required this.assertionId,
  });

  factory HighlightRangeDto.fromJson(Object? value) {
    final _JsonObject json = _JsonObject.read(
      value,
      'HighlightRange',
      const <String>{'start', 'end', 'assertion_id'},
    );
    final int start = json.integer('start', minimum: 0);
    final int end = json.integer('end', minimum: 1);
    if (end <= start) {
      throw const FormatException('HighlightRange.end must follow start.');
    }
    return HighlightRangeDto(
      start: start,
      end: end,
      assertionId: json.string('assertion_id'),
    );
  }

  final int start;
  final int end;
  final String assertionId;
}

final class RelationshipDto {
  const RelationshipDto({
    required this.id,
    required this.type,
    required this.scope,
    required this.endpoints,
    required this.nonComparableReason,
    required this.triggeringEvidenceId,
    required this.rectifiedBy,
    required this.confirmedAt,
  });

  factory RelationshipDto.fromJson(Object? value) {
    final _JsonObject json =
        _JsonObject.read(value, 'Relationship', const <String>{
          'id',
          'rel_type',
          'scope',
          'endpoints',
          'non_comparable_reason',
          'triggering_evidence_id',
          'rectified_by',
          'confirmed_at',
        });
    return RelationshipDto(
      id: json.string('id'),
      type: json.enumValue('rel_type', const <String, RelationshipType>{
        'R01a': RelationshipType.r01a,
        'R05': RelationshipType.r05,
        'R06': RelationshipType.r06,
        'R07': RelationshipType.r07,
        'R11a': RelationshipType.r11a,
        'R11b': RelationshipType.r11b,
      }),
      scope: json.enumValue('scope', const <String, RelationshipScope>{
        'intra_event': RelationshipScope.intraEvent,
        'cross_event': RelationshipScope.crossEvent,
        'intra_article': RelationshipScope.intraArticle,
      }),
      endpoints: json.list('endpoints', RelationshipEndpointDto.fromJson),
      nonComparableReason: json.nullableString('non_comparable_reason'),
      triggeringEvidenceId: json.nullableString('triggering_evidence_id'),
      rectifiedBy: json.nullableEnumValue(
        'rectified_by',
        const <String, RectifiedBy>{
          'SOURCE': RectifiedBy.source,
          'MODERATION': RectifiedBy.moderation,
        },
      ),
      confirmedAt: json.dateTime('confirmed_at'),
    );
  }

  final String id;
  final RelationshipType type;
  final RelationshipScope scope;
  final List<RelationshipEndpointDto> endpoints;
  final String? nonComparableReason;
  final String? triggeringEvidenceId;
  final RectifiedBy? rectifiedBy;
  final DateTime confirmedAt;
}

final class RelationshipEndpointDto {
  const RelationshipEndpointDto({
    required this.assertionId,
    required this.role,
  });

  factory RelationshipEndpointDto.fromJson(Object? value) {
    final _JsonObject json = _JsonObject.read(
      value,
      'RelationshipEndpoint',
      const <String>{'assertion_id', 'role'},
    );
    return RelationshipEndpointDto(
      assertionId: json.string('assertion_id'),
      role: json.enumValue('role', const <String, RelationshipEndpointRole>{
        'peer': RelationshipEndpointRole.peer,
        'source': RelationshipEndpointRole.source,
        'target': RelationshipEndpointRole.target,
      }),
    );
  }

  final String assertionId;
  final RelationshipEndpointRole role;
}

final class ContradictionDto {
  const ContradictionDto({
    required this.id,
    required this.eventId,
    required this.eventTitle,
    required this.positionA,
    required this.positionB,
    required this.conflicting,
    required this.comparable,
    required this.thresholdRule,
    required this.confirmedAt,
    required this.needsReview,
  });

  factory ContradictionDto.fromJson(Object? value) {
    final _JsonObject json =
        _JsonObject.read(value, 'Contradiction', const <String>{
          'id',
          'event_id',
          'event_title',
          'position_a',
          'position_b',
          'ratio',
          'threshold_rule',
          'confirmed_at',
          'needs_review',
        });
    final _JsonObject ratio = json.object('ratio', const <String>{
      'conflicting',
      'comparable',
    });
    return ContradictionDto(
      id: json.string('id'),
      eventId: json.string('event_id'),
      eventTitle: json.string('event_title'),
      positionA: PositionReferenceDto.fromJson(json.raw('position_a')),
      positionB: PositionReferenceDto.fromJson(json.raw('position_b')),
      conflicting: ratio.integer('conflicting', minimum: 0),
      comparable: ratio.integer('comparable', minimum: 1),
      thresholdRule: json.string('threshold_rule'),
      confirmedAt: json.dateTime('confirmed_at'),
      needsReview: json.boolean('needs_review'),
    );
  }

  final String id;
  final String eventId;
  final String eventTitle;
  final PositionReferenceDto positionA;
  final PositionReferenceDto positionB;
  final int conflicting;
  final int comparable;
  final String thresholdRule;
  final DateTime confirmedAt;
  final bool needsReview;
}

final class PositionReferenceDto {
  const PositionReferenceDto({
    required this.id,
    required this.ordinal,
    required this.title,
  });

  factory PositionReferenceDto.fromJson(Object? value) {
    final _JsonObject json = _JsonObject.read(
      value,
      'PositionReference',
      const <String>{'id', 'ordinal', 'title'},
    );
    return PositionReferenceDto(
      id: json.string('id'),
      ordinal: json.integer('ordinal', minimum: 1),
      title: json.string('title'),
    );
  }

  final String id;
  final int ordinal;
  final String title;
}

final class SourceDto {
  const SourceDto({
    required this.id,
    required this.name,
    required this.sourceType,
  });

  factory SourceDto.fromJson(Object? value) {
    final _JsonObject json = _JsonObject.read(value, 'Source', const <String>{
      'id',
      'name',
      'source_type',
    });
    return SourceDto(
      id: json.string('id'),
      name: json.string('name'),
      sourceType: json.string('source_type'),
    );
  }

  final String id;
  final String name;
  final String sourceType;
}

final class TombstoneDto {
  const TombstoneDto({
    required this.operation,
    required this.successors,
    required this.occurredAt,
    required this.reason,
  });

  factory TombstoneDto.fromJson(Object? value) {
    final _JsonObject json = _JsonObject.read(
      value,
      'Tombstone',
      const <String>{'operation', 'successors', 'occurred_at', 'reason'},
    );
    return TombstoneDto(
      operation: json.enumValue('operation', const <String, TombstoneOperation>{
        'split': TombstoneOperation.split,
        'merge': TombstoneOperation.merge,
        'absorbed': TombstoneOperation.absorbed,
        'rectification': TombstoneOperation.rectification,
      }),
      successors: json.list('successors', TombstoneSuccessorDto.fromJson),
      occurredAt: json.dateTime('occurred_at'),
      reason: json.string('reason'),
    );
  }

  final TombstoneOperation operation;
  final List<TombstoneSuccessorDto> successors;
  final DateTime occurredAt;
  final String reason;
}

final class TombstoneSuccessorDto {
  const TombstoneSuccessorDto({
    required this.type,
    required this.id,
    required this.title,
  });

  factory TombstoneSuccessorDto.fromJson(Object? value) {
    final _JsonObject json = _JsonObject.read(
      value,
      'TombstoneSuccessor',
      const <String>{'type', 'id'},
      optional: const <String>{'title'},
    );
    return TombstoneSuccessorDto(
      type: json.enumValue('type', const <String, TombstoneSuccessorType>{
        'Event': TombstoneSuccessorType.event,
        'Position': TombstoneSuccessorType.position,
        'ClaimSpan': TombstoneSuccessorType.claimSpan,
        'ContradictionPublication':
            TombstoneSuccessorType.contradictionPublication,
      }),
      id: json.string('id'),
      title: json.nullableString('title'),
    );
  }

  final TombstoneSuccessorType type;
  final String id;
  final String? title;
}

const Set<String> _positionKeys = <String>{
  'id',
  'ordinal',
  'total',
  'neutral_rank',
  'title',
  'published_at',
  'assertion_count',
  'formed_by_count',
  'evidence_absence',
  'evidence_absence_reason',
};

_JsonObject _positionObject(
  Object? value,
  String label, {
  Set<String> extra = const <String>{},
}) => _JsonObject.read(value, label, <String>{..._positionKeys, ...extra});

PositionListItemDto _positionBase(_JsonObject json) => PositionListItemDto(
  id: json.string('id'),
  ordinal: json.integer('ordinal', minimum: 1),
  total: json.integer('total', minimum: 1),
  neutralRank: json.integer('neutral_rank', minimum: 1),
  title: json.string('title'),
  publishedAt: json.dateTime('published_at'),
  assertionCount: json.integer('assertion_count', minimum: 1),
  formedByCount: json.integer('formed_by_count', minimum: 1),
  evidenceAbsence: json
      .nullableEnumValue('evidence_absence', const <String, EvidenceAbsence>{
        'no_evidence_yet': EvidenceAbsence.noEvidenceYet,
        'inconclusive': EvidenceAbsence.inconclusive,
      }),
  evidenceAbsenceReason: json.nullableString('evidence_absence_reason'),
);

final class _JsonObject {
  const _JsonObject(this._values, this._label);

  factory _JsonObject.read(
    Object? value,
    String label,
    Set<String> required, {
    Set<String> optional = const <String>{},
  }) {
    if (value is! Map<String, Object?>) {
      throw FormatException('$label must be a JSON object.');
    }
    final Set<String> keys = value.keys.toSet();
    final Set<String> allowed = <String>{...required, ...optional};
    if (!keys.containsAll(required) || !allowed.containsAll(keys)) {
      throw FormatException('$label has an invalid field set.');
    }
    return _JsonObject(value, label);
  }

  final Map<String, Object?> _values;
  final String _label;

  Object? raw(String key) => _values[key];

  String string(String key) {
    final Object? value = _values[key];
    if (value is! String || value.isEmpty) {
      throw FormatException('$_label.$key must be a non-empty string.');
    }
    return value;
  }

  String? nullableString(String key) {
    final Object? value = _values[key];
    if (value == null) return null;
    if (value is! String || value.isEmpty) {
      throw FormatException('$_label.$key must be null or a non-empty string.');
    }
    return value;
  }

  bool boolean(String key) {
    final Object? value = _values[key];
    if (value is! bool) {
      throw FormatException('$_label.$key must be a boolean.');
    }
    return value;
  }

  int integer(String key, {int? minimum}) {
    final Object? value = _values[key];
    if (value is! int || (minimum != null && value < minimum)) {
      throw FormatException('$_label.$key must be a valid integer.');
    }
    return value;
  }

  int? nullableInteger(String key, {int? minimum}) {
    final Object? value = _values[key];
    if (value == null) return null;
    return integer(key, minimum: minimum);
  }

  DateTime dateTime(String key) {
    final String value = string(key);
    final DateTime? parsed = DateTime.tryParse(value);
    if (parsed == null) {
      throw FormatException('$_label.$key must be an ISO timestamp.');
    }
    return parsed.toUtc();
  }

  DateTime? nullableDateTime(String key) =>
      _values[key] == null ? null : dateTime(key);

  Uri uri(String key) {
    final Uri? parsed = Uri.tryParse(string(key));
    if (parsed == null || !parsed.hasScheme || !parsed.hasAuthority) {
      throw FormatException('$_label.$key must be an absolute URI.');
    }
    return parsed;
  }

  T enumValue<T>(String key, Map<String, T> values) {
    final String value = string(key);
    final T? result = values[value];
    if (result == null) {
      throw FormatException('$_label.$key has an unknown value.');
    }
    return result;
  }

  T? nullableEnumValue<T>(String key, Map<String, T> values) =>
      _values[key] == null ? null : enumValue(key, values);

  _JsonObject object(String key, Set<String> required) =>
      _JsonObject.read(_values[key], '$_label.$key', required);

  List<T> list<T>(String key, T Function(Object?) decode) {
    final Object? value = _values[key];
    if (value is! List<Object?>) {
      throw FormatException('$_label.$key must be a JSON array.');
    }
    return List<T>.unmodifiable(value.map(decode));
  }
}
