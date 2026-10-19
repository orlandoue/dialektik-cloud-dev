import 'dart:io';

Future<void> main() async {
  final Directory packageRoot = File(
    Platform.script.toFilePath(),
  ).parent.parent;
  final List<_QualityCommand> commands = <_QualityCommand>[
    const _QualityCommand('Dependency resolution', 'flutter', <String>[
      'pub',
      'get',
    ]),
    const _QualityCommand('Formatting verification', 'dart', <String>[
      'format',
      '--output=none',
      '--set-exit-if-changed',
      'lib',
      'test',
      'tool',
    ]),
    const _QualityCommand('Static analysis', 'flutter', <String>['analyze']),
    const _QualityCommand('Unit and widget tests', 'flutter', <String>[
      'test',
      '--test-randomize-ordering-seed=0',
    ]),
    const _QualityCommand('Design invariant checks', 'dart', <String>[
      'run',
      'tool/check_design_invariants.dart',
    ]),
  ];

  for (final _QualityCommand command in commands) {
    stdout.writeln('\n== ${command.label} ==');
    final Process process = await Process.start(
      command.executable,
      command.arguments,
      mode: ProcessStartMode.inheritStdio,
      runInShell: Platform.isWindows,
      workingDirectory: packageRoot.path,
    );
    final int result = await process.exitCode;
    if (result != 0) {
      stderr.writeln('${command.label} failed with exit code $result.');
      exitCode = result;
      return;
    }
  }

  stdout.writeln('\nPhase 0 quality checks passed.');
}

final class _QualityCommand {
  const _QualityCommand(this.label, this.executable, this.arguments);

  final String label;
  final String executable;
  final List<String> arguments;
}
