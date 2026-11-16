import 'package:dialektik/features/live/data/live_news_models.dart';

/// Catalog-only beta diagnostic, not an enabled source or published article.
final class RegisteredSourceDto {
  const RegisteredSourceDto({
    required this.id,
    required this.name,
    required this.canonicalDomain,
    required this.stagedRecordCount,
  });
  factory RegisteredSourceDto.fromJson(Object? input) {
    final Map<String, Object?> data = liveObject(input);
    liveRequire(data, 'review_status', 'PENDING_INDEPENDENT_VERIFICATION');
    final int count = liveInt(data, 'staged_record_count');
    if (count < 0) throw const FormatException('Invalid staged record count');
    return RegisteredSourceDto(
      id: liveString(data, 'id'),
      name: liveString(data, 'name'),
      canonicalDomain: liveString(data, 'canonical_domain'),
      stagedRecordCount: count,
    );
  }
  final String id;
  final String name;
  final String canonicalDomain;
  final int stagedRecordCount;
}

final class RegisteredSourceDirectory {
  const RegisteredSourceDirectory({required this.items});
  factory RegisteredSourceDirectory.fromJson(Object? input) {
    final Map<String, Object?> data = liveObject(input);
    liveRequire(data, 'mode', 'UNVERIFIED_SOURCE_REGISTRY');
    liveRequire(data, 'license_status', 'NOT_ATTESTED');
    final int approved = liveInt(data, 'operational_source_count');
    if (approved < 0) throw const FormatException('Invalid operational count');
    return RegisteredSourceDirectory(
      items: liveList(data['items'], RegisteredSourceDto.fromJson),
    );
  }
  final List<RegisteredSourceDto> items;
}

abstract interface class RegisteredSourceDirectoryRepository {
  Future<RegisteredSourceDirectory> loadRegisteredSources({bool refresh = false});
}
