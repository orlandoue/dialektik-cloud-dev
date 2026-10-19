import 'dart:io';

import 'package:dialektik/design_system/safety/design_invariant_checker.dart';

void main() {
  final Directory packageRoot = File(
    Platform.script.toFilePath(),
  ).parent.parent;
  final Directory libraryRoot = Directory('${packageRoot.path}/lib');
  final List<DesignSourceFile> sources = libraryRoot
      .listSync(recursive: true, followLinks: false)
      .whereType<File>()
      .where((File file) => file.path.endsWith('.dart'))
      .map(
        (File file) => DesignSourceFile(
          logicalPath: _relativePath(file.path, packageRoot.path),
          contents: file.readAsStringSync(),
        ),
      )
      .toList(growable: false);
  final List<DesignInvariantViolation> violations =
      DesignInvariantChecker.inspect(sources);

  if (violations.isNotEmpty) {
    stderr.writeln('Dialektik design invariants failed:');
    for (final DesignInvariantViolation violation in violations) {
      stderr.writeln('  $violation');
    }
    exitCode = 1;
    return;
  }

  stdout.writeln(
    'Dialektik design invariants passed (${sources.length} Dart files scanned).',
  );
}

String _relativePath(String path, String root) {
  final String normalizedPath = path.replaceAll('\\', '/');
  final String normalizedRoot = root.replaceAll('\\', '/');
  return normalizedPath.substring(normalizedRoot.length + 1);
}
