import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/presentation/duel_screen.dart';
import 'package:dialektik/features/arena/presentation/youtube_player_sheet.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/public_api_fixtures.dart';
import 'arena_fixtures.dart';

void main() {
  setUp(() => debugYouTubePlayerBuilder = (String id) => Text('player:$id'));
  tearDown(() => debugYouTubePlayerBuilder = null);

  test('the embed is the privacy-enhanced player, autoplaying inline', () {
    expect(
      youTubeEmbedUri('dQw4w9WgXcQ').toString(),
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&playsinline=1&rel=0',
    );
    expect(
      youTubeWatchUri('dQw4w9WgXcQ').toString(),
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
  });

  for (final double scale in <double>[1, 1.45]) {
    testWidgets('YouTube evidence plays inside the app · escala $scale', (
      WidgetTester tester,
    ) async {
      final List<Uri> opened = <Uri>[];
      final ArenaFullCore core = ArenaFullCore();
      final ArenaStore store = ArenaStore(
        consumer: core,
        live: core,
        openLink: (Uri uri) async {
          opened.add(uri);
          return true;
        },
      );
      final ArenaDuel duel = ArenaDuel(
        contrast: ContradictionDto.fromJson(contradictionJson()),
        event: storyEvent,
      );
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          builder: (BuildContext context, Widget? child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: TextScaler.linear(scale)),
            child: child!,
          ),
          home: DuelScreen(duel: duel, store: store),
        ),
      );
      await tester.pumpAndSettle();

      final Finder video = find.byKey(
        const ValueKey<String>('arena-source-link-art5'),
      );
      await tester.scrollUntilVisible(
        video,
        300,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey<String>('arena-source-thumbnail-art5')),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: video,
          matching: find.text('▶ Ver video en la app'),
        ),
        findsOneWidget,
      );
      // Press links keep opening the original publication.
      expect(find.text('Leer en medio original'), findsWidgets);

      await tester.tap(video);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('arena-youtube-player-sheet')),
        findsOneWidget,
      );
      expect(find.text('player:dQw4w9WgXcQ'), findsOneWidget);
      expect(
        find.text('Ministra Williams responde por los despidos en Codelco'),
        findsWidgets,
      );
      expect(find.byKey(const Key('arena-youtube-channel')), findsOneWidget);
      expect(opened, isEmpty, reason: 'the reader stays in Dialektik');

      await tester.tap(find.byKey(const Key('arena-youtube-open-external')));
      await tester.pumpAndSettle();
      expect(
        opened.single.toString(),
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      );

      await tester.tap(find.byKey(const Key('arena-youtube-close')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('arena-youtube-player-sheet')), findsNothing);
      expect(video, findsOneWidget, reason: 'the duel keeps its position');
      expect(tester.takeException(), isNull);
      store.dispose();
    });
  }
}
