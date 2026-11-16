import 'dart:convert';

import 'package:flutter/services.dart';

/// Availability state from the authoritative asset manifest.
enum DialektikAssetAvailability { bundled, blocked, pending }

/// Asset metadata without a rendering fallback.
final class DialektikAssetEntry {
  const DialektikAssetEntry({
    required this.path,
    required this.availability,
    this.reason,
  });

  final String path;
  final DialektikAssetAvailability availability;
  final String? reason;
}

/// Loads the Phase 0 asset catalog.
///
/// The catalog is metadata only. It deliberately offers no method that turns a
/// blocked or pending entry into an ImageProvider.
final class DialektikAssetCatalog {
  const DialektikAssetCatalog._(this.entries);

  static const String catalogPath = 'assets/asset_catalog.json';
  static const String missingMasterVector = 'assets/brand/dialektik-master.svg';

  final List<DialektikAssetEntry> entries;

  static Future<DialektikAssetCatalog> load(AssetBundle bundle) async {
    final String encoded = await bundle.loadString(catalogPath);
    final Map<String, Object?> document =
        jsonDecode(encoded) as Map<String, Object?>;
    final List<DialektikAssetEntry> entries = <DialektikAssetEntry>[];

    for (final String path in _stringList(document['bundled'])) {
      entries.add(
        DialektikAssetEntry(
          path: path,
          availability: DialektikAssetAvailability.bundled,
        ),
      );
    }
    for (final Object? rawEntry in _objectList(document['blocked'])) {
      final Map<String, Object?> entry = rawEntry! as Map<String, Object?>;
      entries.add(
        DialektikAssetEntry(
          path: entry['path']! as String,
          availability: DialektikAssetAvailability.blocked,
          reason: entry['reason'] as String?,
        ),
      );
    }
    for (final String path in _stringList(document['pending'])) {
      entries.add(
        DialektikAssetEntry(
          path: path,
          availability: DialektikAssetAvailability.pending,
        ),
      );
    }

    return DialektikAssetCatalog._(List.unmodifiable(entries));
  }

  static List<String> _stringList(Object? value) {
    return (value! as List<Object?>).cast<String>();
  }

  static List<Object?> _objectList(Object? value) {
    return value! as List<Object?>;
  }
}
