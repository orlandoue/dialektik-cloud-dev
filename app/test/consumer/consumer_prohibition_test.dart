import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'consumer Dart source contains no internal epistemic dependency',
    () async {
      final List<File> sources = await Directory('lib/features/consumer')
          .list(recursive: true)
          .where(
            (FileSystemEntity entity) =>
                entity is File && entity.path.endsWith('.dart'),
          )
          .cast<File>()
          .toList();
      final String combined = (await Future.wait<String>(
        sources.map((File file) => file.readAsString()),
      )).join('\n');
      for (final String prohibited in <String>[
        'CandidateClass',
        'SimilarityScore',
        'RelationConfidence',
        'CandidateScore',
        'ModerationTask',
        'ClaimInterpretation',
        'provider_output',
        'embedding_vector',
        'R01b',
      ]) {
        expect(combined, isNot(contains(prohibited)), reason: prohibited);
      }
    },
  );

  test('consumer source and assets contain no credential material', () async {
    final List<File> files = <File>[];
    for (final String root in <String>['lib', 'assets']) {
      files.addAll(
        await Directory(root)
            .list(recursive: true)
            .where((FileSystemEntity entity) => entity is File)
            .cast<File>()
            .toList(),
      );
    }
    final String combined = (await Future.wait<String>(
      // Scan every byte, including packaged font binaries. Latin-1 preserves
      // ASCII credential signatures without failing UTF-8 decoding or skipping
      // an asset. Source dependency checks above retain their UTF-8 read.
      files.map((File file) async => latin1.decode(await file.readAsBytes())),
    )).join('\n');
    for (final RegExp secret in <RegExp>[
      RegExp(r'AIza[0-9A-Za-z_-]{20,}'),
      RegExp(r'sk-[0-9A-Za-z_-]{20,}'),
      RegExp(r'postgres(?:ql)?://[^\s]+:[^\s]+@'),
      RegExp(r'authorization\s*:\s*["\x27]Bearer ', caseSensitive: false),
    ]) {
      expect(secret.hasMatch(combined), isFalse, reason: secret.pattern);
    }
  });

  test('credential scanning detects ASCII signatures inside binary bytes', () {
    final List<int> bytes = <int>[
      0x00,
      0xff,
      ...ascii.encode('sk-${'a' * 24}'),
      0x80,
      0x00,
    ];
    expect(
      RegExp(r'sk-[0-9A-Za-z_-]{20,}').hasMatch(latin1.decode(bytes)),
      isTrue,
    );
  });

  test('consumer navigation has no internal moderation route', () async {
    final String routes = await File(
      'lib/features/consumer/presentation/navigation/consumer_routes.dart',
    ).readAsString();
    expect(routes, isNot(contains('/mod/')));
    expect(routes, isNot(contains('internal_moderation')));
  });
}
