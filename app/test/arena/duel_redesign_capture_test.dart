// Captures of the duel redesign for review against the mockups. Skipped
// unless DIALEKTIK_CAPTURE is set:
//   DIALEKTIK_CAPTURE=1 flutter test test/arena/duel_redesign_capture_test.dart --update-goldens
import 'dart:io';

import 'package:dialektik/features/arena/presentation/arena_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/public_api_fixtures.dart';
import 'arena_fixtures.dart';

final bool _capture = Platform.environment['DIALEKTIK_CAPTURE'] != null;

String get _flutterRoot =>
    Platform.environment['FLUTTER_ROOT'] ??
    File(Platform.resolvedExecutable).parent.parent.parent.parent.parent.path;

Future<void> _font(String family, List<String> paths) async {
  final FontLoader loader = FontLoader(family);
  for (final String path in paths) {
    loader.addFont(
      Future<ByteData>.value(
        ByteData.sublistView(File(path).readAsBytesSync()),
      ),
    );
  }
  await loader.load();
}

void main() {
  setUpAll(() async {
    if (!_capture) return;
    // The app's default text (no explicit family) is Roboto on Android;
    // Inter stands in for it here so no text renders as test blocks.
    await _font('Roboto', <String>[
      'assets/fonts/Inter-Regular.ttf',
      'assets/fonts/Inter-Medium.ttf',
    ]);
    await _font('Inter', <String>[
      'assets/fonts/Inter-Regular.ttf',
      'assets/fonts/Inter-Medium.ttf',
    ]);
    await _font('Merriweather', <String>[
      'assets/fonts/Merriweather-Regular.ttf',
      'assets/fonts/Merriweather-Bold.ttf',
    ]);
    await _font('MaterialIcons', <String>[
      '$_flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
    ]);
  });

  ArenaFullCore voted() => ArenaFullCore()
    ..otherVotes[positionAId] = 91
    ..otherVotes[positionBId] = 56
    ..myPosition = positionAId;

  for (final (String name, ArenaTab tab, bool vote)
      in <(String, ArenaTab, bool)>[
        ('vs_blind', ArenaTab.vs, false),
        ('vs_voted', ArenaTab.vs, true),
        ('inicio_blind', ArenaTab.inicio, false),
        ('inicio_voted', ArenaTab.inicio, true),
      ]) {
    testWidgets('capture $name', (WidgetTester tester) async {
      debugDisableShadows = false;
      try {
        await pumpArena(
          tester,
          vote ? voted() : ArenaFullCore(),
          initialTab: tab,
        );
        await tester.pumpAndSettle();
        if (name == 'vs_blind') {
          await tester.tap(find.byKey(const Key('arena-vs-blind')));
          await tester.pumpAndSettle();
        }
        await expectLater(
          find.byType(ArenaShell),
          matchesGoldenFile('captures/$name.png'),
        );
      } finally {
        debugDisableShadows = true;
      }
    }, skip: !_capture);
  }
}
