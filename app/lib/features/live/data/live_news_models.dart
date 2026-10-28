/// Development-only live read contracts. No semantic relation is inferred.
final class LiveSourceDto {
  const LiveSourceDto({
    required this.id,
    required this.name,
    required this.sourceType,
    required this.canonicalDomain,
    this.publisherFamily,
    this.category,
  });
  factory LiveSourceDto.fromJson(Object? value) {
    final Map<String, Object?> data = liveObject(value);
    liveRequire(data, 'origin', 'LIVE_REAL');
    return LiveSourceDto(
      id: liveString(data, 'id'),
      name: liveString(data, 'name'),
      sourceType: liveString(data, 'source_type'),
      canonicalDomain: liveString(data, 'canonical_domain'),
      publisherFamily: liveOptionalString(data, 'publisher_family'),
      category: liveOptionalString(data, 'category'),
    );
  }
  final String id;
  final String name;
  final String sourceType;
  final String canonicalDomain;
  final String? publisherFamily;
  final String? category;
}

final class LiveNewsItemDto {
  const LiveNewsItemDto({
    required this.id,
    required this.headline,
    required this.canonicalUrl,
    required this.publishedAt,
    required this.firstSeenAt,
    required this.source,
    required this.versionCount,
    this.excerpt,
    this.modifiedAt,
  });
  factory LiveNewsItemDto.fromJson(Object? value) {
    final Map<String, Object?> data = liveObject(value);
    liveRequire(data, 'origin', 'LIVE_REAL');
    if (!const <String>[
      'UNASSIGNED',
      'EVENT_LINKED',
    ].contains(data['semantic_assignment'])) {
      throw const FormatException('Unsupported semantic_assignment.');
    }
    final int versionCount = liveInt(data, 'version_count');
    if (versionCount < 1) {
      throw const FormatException('Article version count is invalid.');
    }
    return LiveNewsItemDto(
      id: liveString(data, 'id'),
      headline: liveString(data, 'headline'),
      excerpt: liveOptionalString(data, 'excerpt'),
      canonicalUrl: liveHttpUri(data, 'canonical_url'),
      publishedAt: liveDate(data, 'published_at'),
      modifiedAt: liveOptionalDate(data, 'modified_at'),
      firstSeenAt: liveDate(data, 'first_seen_at'),
      source: LiveSourceDto.fromJson(data['source']),
      versionCount: versionCount,
    );
  }
  final String id;
  final String headline;
  final String? excerpt;
  final Uri canonicalUrl;
  final DateTime publishedAt;
  final DateTime? modifiedAt;
  final DateTime firstSeenAt;
  final LiveSourceDto source;
  final int versionCount;
}

final class LiveNewsPageDto {
  const LiveNewsPageDto({required this.items, this.nextCursor});
  factory LiveNewsPageDto.fromJson(Object? value) {
    final Map<String, Object?> data = liveObject(value);
    liveRequire(data, 'origin', 'LIVE_REAL');
    if (!const <String>[
      'unassigned',
      'mixed',
    ].contains(data['semantic_mode'])) {
      throw const FormatException('Unsupported semantic_mode.');
    }
    return LiveNewsPageDto(
      items: liveList(data['items'], LiveNewsItemDto.fromJson),
      nextCursor: liveOptionalString(data, 'next_cursor'),
    );
  }
  final List<LiveNewsItemDto> items;
  final String? nextCursor;
}

final class LiveContentDto {
  const LiveContentDto({
    required this.representation,
    required this.storagePolicy,
    this.text,
  });
  factory LiveContentDto.fromJson(Object? value) {
    final Map<String, Object?> data = liveObject(value);
    final String representation = liveString(data, 'representation');
    final String policy = liveString(data, 'storage_policy');
    if (!const <String>[
          'feed_excerpt',
          'metadata_only',
        ].contains(representation) ||
        !const <String>[
          'METADATA_AND_FEED_EXCERPT',
          'METADATA_ONLY',
        ].contains(policy) ||
        data['body'] != null) {
      throw const FormatException('Unsupported live content representation.');
    }
    final String? text = liveOptionalString(data, 'text');
    if (policy == 'METADATA_ONLY' && text != null) {
      throw const FormatException(
        'Metadata-only content cannot contain an excerpt.',
      );
    }
    return LiveContentDto(
      representation: representation,
      storagePolicy: policy,
      text: text,
    );
  }
  final String representation;
  final String storagePolicy;
  final String? text;
}

final class LiveProvenanceDto {
  const LiveProvenanceDto({
    required this.discoveryChannel,
    required this.discoveryUrl,
    required this.firstSeenAt,
    required this.lastSeenAt,
    required this.adapterVersion,
    required this.rightsEvidenceUrl,
    required this.receiptCount,
    this.sourceItemId,
    this.originalPublishedAt,
    this.originalModifiedAt,
    this.publishedAt,
    this.modifiedAt,
  });
  factory LiveProvenanceDto.fromJson(Object? value) {
    final Map<String, Object?> data = liveObject(value);
    liveRequire(data, 'rights_class', 'LIVE_READY');
    liveRequire(
      data,
      'exclusion_status',
      'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2',
    );
    final int receiptCount = liveInt(data, 'receipt_count');
    if (receiptCount < 1) {
      throw const FormatException('Missing discovery receipt.');
    }
    return LiveProvenanceDto(
      discoveryChannel: liveString(data, 'discovery_channel'),
      discoveryUrl: liveHttpUri(data, 'discovery_url'),
      sourceItemId: liveOptionalString(data, 'source_item_id'),
      originalPublishedAt: liveOptionalString(data, 'original_published_at'),
      originalModifiedAt: liveOptionalString(data, 'original_modified_at'),
      publishedAt: liveOptionalDate(data, 'published_at'),
      modifiedAt: liveOptionalDate(data, 'modified_at'),
      firstSeenAt: liveDate(data, 'first_seen_at'),
      lastSeenAt: liveDate(data, 'last_seen_at'),
      adapterVersion: liveString(data, 'adapter_version'),
      rightsEvidenceUrl: liveHttpUri(data, 'rights_evidence_url'),
      receiptCount: receiptCount,
    );
  }
  final String discoveryChannel;
  final Uri discoveryUrl;
  final String? sourceItemId;
  final String? originalPublishedAt;
  final String? originalModifiedAt;
  final DateTime? publishedAt;
  final DateTime? modifiedAt;
  final DateTime firstSeenAt;
  final DateTime lastSeenAt;
  final String adapterVersion;
  final Uri rightsEvidenceUrl;
  final int receiptCount;
}

final class LiveNewsDetailDto {
  const LiveNewsDetailDto({
    required this.article,
    required this.content,
    required this.provenance,
    this.author,
    this.declaredUpstream,
  });
  factory LiveNewsDetailDto.fromJson(Object? value) {
    final Map<String, Object?> data = liveObject(value);
    return LiveNewsDetailDto(
      article: LiveNewsItemDto.fromJson(data),
      author: liveOptionalString(data, 'author'),
      content: LiveContentDto.fromJson(data['content']),
      provenance: LiveProvenanceDto.fromJson(data['provenance']),
      declaredUpstream: liveOptionalString(data, 'declared_upstream'),
    );
  }
  final LiveNewsItemDto article;
  final String? author;
  final LiveContentDto content;
  final LiveProvenanceDto provenance;
  final String? declaredUpstream;
}

final class LiveSourceDetailDto {
  const LiveSourceDetailDto({
    required this.source,
    required this.storagePolicy,
    required this.rightsEvidenceUrl,
    required this.discoveryChannel,
    required this.discoveryUrl,
    required this.attribution,
  });
  factory LiveSourceDetailDto.fromJson(Object? value) {
    final Map<String, Object?> data = liveObject(value);
    liveRequire(data, 'rights_class', 'LIVE_READY');
    final String policy = liveString(data, 'storage_policy');
    if (!const <String>[
      'METADATA_AND_FEED_EXCERPT',
      'METADATA_ONLY',
    ].contains(policy)) {
      throw const FormatException('Unsupported source storage policy.');
    }
    return LiveSourceDetailDto(
      source: LiveSourceDto.fromJson(data),
      storagePolicy: policy,
      rightsEvidenceUrl: liveHttpUri(data, 'rights_evidence_url'),
      discoveryChannel: liveString(data, 'discovery_channel'),
      discoveryUrl: liveHttpUri(data, 'discovery_url'),
      attribution: liveString(data, 'attribution'),
    );
  }
  final LiveSourceDto source;
  final String storagePolicy;
  final Uri rightsEvidenceUrl;
  final String discoveryChannel;
  final Uri discoveryUrl;
  final String attribution;
}

Map<String, Object?> liveObject(Object? value) {
  if (value is! Map<String, Object?>) {
    throw const FormatException('Expected live JSON object.');
  }
  const Set<String> forbidden = <String>{
    'story_id',
    'event_id',
    'thread_id',
    'occurrence_id',
    'memberships',
    'candidate_prediction',
    'gold',
    'expected_relation',
    'reliability',
    'credibility',
    'quality',
    'trust',
    'source_independence',
    'syndication_of',
    'syndication_confidence',
  };
  if (value.keys.any(forbidden.contains)) {
    throw const FormatException('Prohibited live read field.');
  }
  return value;
}

void liveRequire(Map<String, Object?> data, String key, String expected) {
  if (data[key] != expected) throw FormatException('Unsupported $key.');
}

String liveString(Map<String, Object?> data, String key) {
  final Object? value = data[key];
  if (value is! String || value.trim().isEmpty) {
    throw FormatException('Invalid $key.');
  }
  return value;
}

String? liveOptionalString(Map<String, Object?> data, String key) {
  final Object? value = data[key];
  if (value == null) return null;
  if (value is! String) throw FormatException('Invalid $key.');
  return value.trim().isEmpty ? null : value;
}

int liveInt(Map<String, Object?> data, String key) {
  final Object? value = data[key];
  if (value is! int) throw FormatException('Invalid $key.');
  return value;
}

DateTime liveDate(Map<String, Object?> data, String key) {
  final String value = liveString(data, key);
  if (!RegExp(r'(Z|[+-]\d{2}:\d{2})$').hasMatch(value)) {
    throw FormatException('Timestamp $key must include its offset.');
  }
  return DateTime.parse(value).toUtc();
}

DateTime? liveOptionalDate(Map<String, Object?> data, String key) =>
    data[key] == null ? null : liveDate(data, key);
Uri liveHttpUri(Map<String, Object?> data, String key) {
  final Uri uri = Uri.parse(liveString(data, key));
  if (!const <String>['http', 'https'].contains(uri.scheme) ||
      !uri.hasAuthority ||
      uri.host.isEmpty ||
      uri.userInfo.isNotEmpty) {
    throw FormatException('Invalid $key URL.');
  }
  return uri;
}

List<T> liveList<T>(Object? value, T Function(Object?) decode) {
  if (value is! List<Object?>) {
    throw const FormatException('Expected live list.');
  }
  return List<T>.unmodifiable(value.map(decode));
}
