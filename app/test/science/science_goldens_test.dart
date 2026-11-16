import 'dart:io';

import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/science/data/science_models.dart';
import 'package:dialektik/features/science/presentation/moderation_screen.dart';
import 'package:dialektik/features/science/presentation/science_feed.dart';
import 'package:dialektik/features/science/presentation/science_widgets.dart';
import 'package:dialektik/features/science/presentation/story_comments.dart';
import 'package:dialektik/features/science/presentation/study_label_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'science_fixtures.dart';

/// Allows sub-pixel antialiasing differences between machines.
class _TolerantComparator extends LocalFileComparator {
  _TolerantComparator(super.testFile);

  static const double tolerance = 0.005;

  @override
  Future<bool> compare(Uint8List imageBytes, Uri golden) async {
    final ComparisonResult result = await GoldenFileComparator.compareLists(
      imageBytes,
      await getGoldenBytes(golden),
    );
    if (result.passed || result.diffPercent <= tolerance) {
      result.dispose();
      return true;
    }
    final String error = await generateFailureOutput(result, golden, basedir);
    result.dispose();
    throw FlutterError(error);
  }
}

String get _flutterRoot {
  final String? root = Platform.environment['FLUTTER_ROOT'];
  if (root != null && root.isNotEmpty) return root;
  // …/flutter/bin/cache/dart-sdk/bin/dart
  return File(
    Platform.resolvedExecutable,
  ).parent.parent.parent.parent.parent.path;
}

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

Future<void> _loadFonts() async {
  await _font('Inter', <String>[
    'assets/fonts/Inter-Regular.ttf',
    'assets/fonts/Inter-Medium.ttf',
  ]);
  await _font('Merriweather', <String>[
    'assets/fonts/Merriweather-Regular.ttf',
  ]);
  await _font('MaterialIcons', <String>[
    '$_flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
  ]);
}

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  required double scale,
  double height = 600,
}) async {
  tester.view.physicalSize = Size(390, height);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData(fontFamily: SciText.sans),
      builder: (BuildContext context, Widget? app) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(scale)),
        child: app!,
      ),
      home: Scaffold(
        backgroundColor: SciColors.bgApp,
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: RepaintBoundary(key: const Key('golden'), child: child),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _golden(WidgetTester tester, String name) => expectLater(
  find.byKey(const Key('golden')),
  matchesGoldenFile('goldens/$name.png'),
);

void main() {
  setUpAll(() async {
    await _loadFonts();
    final LocalFileComparator base =
        goldenFileComparator as LocalFileComparator;
    goldenFileComparator = _TolerantComparator(
      Uri.parse('${base.basedir}science_goldens_test.dart'),
    );
  });

  final DateTime now = DateTime.utc(2026, 11, 16, 12);
  final List<StoryComment> thread = sampleThread(now);
  final StoryCommentsController controller = StoryCommentsController(
    store: ArenaStore(consumer: ArenaScienceCore(), live: ArenaScienceCore()),
    eventId: vaccineEventId,
  );

  for (final double scale in <double>[1, 2]) {
    final String s = scale == 1 ? '1x' : '2x';

    testWidgets('ModeButton · $s', (WidgetTester tester) async {
      await _pump(
        tester,
        Align(
          alignment: Alignment.centerLeft,
          child: ModeButton(mode: ArenaMode.ciencia, onTap: () {}),
        ),
        scale: scale,
        height: 200,
      );
      await _golden(tester, 'mode_button_$s');
    });

    testWidgets('StudyCard · $s', (WidgetTester tester) async {
      await _pump(
        tester,
        StudyCard(study: hviid, onOpen: () {}, onConnect: () {}),
        scale: scale,
        height: scale == 1 ? 400 : 800,
      );
      await _golden(tester, 'study_card_$s');
    });

    testWidgets('CommentTile normal · $s', (WidgetTester tester) async {
      await _pump(
        tester,
        ColoredBox(
          color: SciColors.surface,
          child: CommentTile(
            comment: thread[0],
            now: now,
            onReply: () {},
            onReact: () {},
          ),
        ),
        scale: scale,
        height: scale == 1 ? 300 : 600,
      );
      await _golden(tester, 'comment_tile_normal_$s');
    });

    testWidgets('CommentTile con estudio · $s', (WidgetTester tester) async {
      await _pump(
        tester,
        ColoredBox(
          color: SciColors.surface,
          child: CommentTile(
            comment: thread[1],
            now: now,
            onReply: () {},
            onReact: () {},
            onOpenStudy: () {},
          ),
        ),
        scale: scale,
        height: scale == 1 ? 700 : 1500,
      );
      await _golden(tester, 'comment_tile_study_$s');
    });

    testWidgets('StudyAttachment · $s', (WidgetTester tester) async {
      await _pump(
        tester,
        StudyAttachment(data: thread[1].attachment!, onOpen: () {}),
        scale: scale,
        height: scale == 1 ? 400 : 900,
      );
      await _golden(tester, 'study_attachment_$s');
    });

    testWidgets('ModerationCard en revisión · $s', (WidgetTester tester) async {
      await _pump(
        tester,
        ModerationCard(
          item: ModerationItem(
            comment: thread[1].copyWith(status: CommentStatus.inReview),
            eventId: vaccineEventId,
          ),
          actions: <Widget>[
            FilledButton(onPressed: () {}, child: const Text('Aprobar')),
            OutlinedButton(onPressed: () {}, child: const Text('Rechazar')),
          ],
          onEditStudy: (_) {},
          onOpenStudy: (_) {},
        ),
        scale: scale,
        height: scale == 1 ? 600 : 1300,
      );
      await _golden(tester, 'moderation_review_$s');
    });

    testWidgets('ModerationCard reportado · $s', (WidgetTester tester) async {
      await _pump(
        tester,
        ModerationCard(
          item: ModerationItem(
            comment: thread[0],
            eventId: vaccineEventId,
            reports: const <CommentReport>[
              CommentReport(
                reason: ReportReason.offensive,
                note: 'Trata mal a otra lectora',
              ),
              CommentReport(reason: ReportReason.spam),
            ],
          ),
          actions: <Widget>[
            OutlinedButton(
              onPressed: () {},
              child: const Text('Descartar reportes'),
            ),
            FilledButton(
              onPressed: () {},
              child: const Text('Ocultar comentario'),
            ),
          ],
          onEditStudy: (_) {},
          onOpenStudy: (_) {},
        ),
        scale: scale,
        height: scale == 1 ? 400 : 900,
      );
      await _golden(tester, 'moderation_reported_$s');
    });

    testWidgets('ApiUsageView · $s', (WidgetTester tester) async {
      tester.view.physicalSize = Size(390, scale == 1 ? 700 : 1500);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: ThemeData(fontFamily: SciText.sans),
          builder: (BuildContext context, Widget? app) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: TextScaler.linear(scale)),
            child: app!,
          ),
          home: Scaffold(
            backgroundColor: SciColors.bgApp,
            body: RepaintBoundary(
              key: const Key('golden'),
              child: ApiUsageView(
                days: <ApiUsageDay>[
                  for (int d = 0; d < 3; d++) ...<ApiUsageDay>[
                    ApiUsageDay(
                      source: 'openalex',
                      day: DateTime(2026, 11, 16 - d),
                      calls: 40 - d * 3,
                      errors: d == 1 ? 2 : 0,
                    ),
                    ApiUsageDay(
                      source: 'crossref',
                      day: DateTime(2026, 11, 16 - d),
                      calls: 38 - d * 3,
                      errors: 0,
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await _golden(tester, 'api_usage_$s');
    });

    testWidgets('StudyLabel · $s', (WidgetTester tester) async {
      await _pump(
        tester,
        StudyLabel(study: wakefield),
        scale: scale,
        height: scale == 1 ? 900 : 1900,
      );
      await _golden(tester, 'study_label_$s');
    });
  }

  tearDownAll(controller.dispose);
}
