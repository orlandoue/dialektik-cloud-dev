import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/localization/consumer_strings.dart';
import 'package:dialektik/features/consumer/presentation/screens/feed_screen.dart';
import 'package:dialektik/features/consumer/presentation/screens/source_screen.dart';
import 'package:dialektik/features/consumer/presentation/widgets/consumer_navigation_action.dart';
import 'package:dialektik/features/consumer/presentation/widgets/consumer_responsive_shell.dart';
import 'package:dialektik/features/consumer/presentation/widgets/consumer_scaffold.dart';
import 'package:dialektik/features/consumer/presentation/widgets/system_state_view.dart';
import 'package:dialektik/features/semantic/presentation/editorial_components.dart';
import 'package:dialektik/features/semantic/presentation/editorial_vocabulary.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';

import '../support/public_api_fixtures.dart';

void main() {
  setUpAll(() => initializeDateFormatting('es'));

  testWidgets(
    'topic spelling submits the existing exact filter and clears it',
    (WidgetTester tester) async {
      final _RecordingRepository repository = _RecordingRepository();
      await tester.pumpWidget(_app(_feed(repository)));
      await tester.pumpAndSettle();

      expect(find.text('Eventos'), findsOneWidget);
      expect(find.textContaining('nombre exacto'), findsOneWidget);
      expect(find.textContaining('identificador'), findsNothing);
      await tester.enterText(
        find.byKey(const Key('topic-search-input')),
        '  BANCO  CENTRÁL  ',
      );
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pumpAndSettle();

      expect(repository.topics, <String?>[null, 'banco-central']);
      expect(find.text('Tema: banco central'), findsOneWidget);
      await tester.ensureVisible(find.text('Quitar tema'));
      await tester.tap(find.text('Quitar tema'));
      await tester.pumpAndSettle();
      expect(repository.topics.last, isNull);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        isEmpty,
      );
    },
  );

  testWidgets('unsupported topic input stays local with a human explanation', (
    WidgetTester tester,
  ) async {
    final _RecordingRepository repository = _RecordingRepository();
    await tester.pumpWidget(_app(_feed(repository)));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '🚀');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();

    expect(repository.topics, <String?>[null]);
    expect(find.textContaining('Escribe un nombre de tema'), findsOneWidget);
    expect(find.textContaining('PUBLIC_INVALID'), findsNothing);
    expect(find.textContaining('ULID'), findsNothing);
    expect(find.textContaining('minúsculas'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('valid exact topic slugs retain repeated hyphens on reapply', (
    WidgetTester tester,
  ) async {
    final _RecordingRepository repository = _RecordingRepository();
    await tester.pumpWidget(_app(_feed(repository)));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'a--b');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(repository.topics.last, 'a--b');
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller!.text,
      'a--b',
    );
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(repository.topics.last, 'a--b');
  });

  testWidgets('topic search supports keyboard activation and visible focus', (
    WidgetTester tester,
  ) async {
    final _RecordingRepository repository = _RecordingRepository();
    await tester.pumpWidget(_app(_feed(repository)));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'tasas');
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();

    final Finder button = find.byKey(const Key('topic-search-submit'));
    final Iterable<DecoratedBox> decorations = tester.widgetList<DecoratedBox>(
      find.ancestor(of: button, matching: find.byType(DecoratedBox)),
    );
    expect(
      decorations.any((DecoratedBox box) {
        final Decoration decoration = box.decoration;
        return decoration is BoxDecoration &&
            decoration.border is Border &&
            (decoration.border! as Border).top.width ==
                DialektikSizing.focusRingWidth &&
            (decoration.border! as Border).top.color ==
                DialektikColors.electricViolet;
      }),
      isTrue,
    );
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(repository.topics.last, 'tasas');
  });

  testWidgets('categories scroll deliberately at 390px and 200% text', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(390, 1100);
    tester.view.devicePixelRatio = 1;
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    final _RecordingRepository repository = _RecordingRepository();
    var openedThreads = false;
    await tester.pumpWidget(
      _app(
        _feed(
          repository,
          onOpenThreads: () {
            openedThreads = true;
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    final Finder economy = find.widgetWithText(ChoiceChip, 'Economía');
    await tester.ensureVisible(economy);
    await tester.tap(economy);
    await tester.pumpAndSettle();
    expect(repository.categories.last, 'economia');
    final Rect categoryViewport = tester.getRect(
      find.byKey(const Key('category-filter-scroll')),
    );
    expect(
      tester.getRect(economy).center.dx,
      closeTo(categoryViewport.center.dx, 4),
    );
    expect(tester.getSize(economy).height, greaterThanOrEqualTo(44));
    final Finder histories = find.text('Historias');
    await tester.ensureVisible(histories);
    await tester.tap(histories);
    await tester.pumpAndSettle();
    expect(openedThreads, isTrue);
    expect(find.text('Threads'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  for (final double width in <double>[360, 390, 430]) {
    testWidgets(
      'event categories scroll with keyboard and semantics at ${width.toInt()}px',
      (WidgetTester tester) async {
        tester.view.physicalSize = Size(width, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        final _RecordingRepository repository = _RecordingRepository();
        await tester.pumpWidget(_app(_feed(repository)));
        await tester.pumpAndSettle();

        final Finder strip = find.byKey(const Key('category-filter-scroll'));
        final Finder scrollable = find.descendant(
          of: strip,
          matching: find.byType(Scrollable),
        );
        final ScrollableState scrollState = tester.state<ScrollableState>(
          scrollable,
        );
        expect(scrollState.position.maxScrollExtent, greaterThan(0));
        expect(
          find.byKey(const Key('category-filter-more-right-indicator')),
          findsOneWidget,
        );
        expect(
          find.descendant(of: strip, matching: find.text('Más')),
          findsNothing,
        );
        expect(
          tester
              .widget<Semantics>(
                find.byKey(const Key('category-filter-semantics')),
              )
              .properties
              .hint,
          contains('flechas'),
        );

        await tester.tap(find.widgetWithText(ChoiceChip, 'País'));
        await tester.pumpAndSettle();
        final double beforeKeyboardScroll = scrollState.position.pixels;
        final FocusNode keyboardFocus = Focus.of(tester.element(strip));
        keyboardFocus.requestFocus();
        await tester.pump();
        expect(keyboardFocus.hasFocus, isTrue);
        await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
        await tester.pumpAndSettle();
        expect(scrollState.position.pixels, greaterThan(beforeKeyboardScroll));
        expect(
          find.byKey(const Key('category-filter-more-left-indicator')),
          findsOneWidget,
        );

        final Finder economy = find.widgetWithText(ChoiceChip, 'Economía');
        await tester.ensureVisible(economy);
        await tester.tap(economy);
        await tester.pumpAndSettle();
        expect(repository.categories.last, 'economia');
        final Rect viewport = tester.getRect(strip);
        final Rect selected = tester.getRect(economy);
        expect(selected.left, greaterThanOrEqualTo(viewport.left));
        expect(selected.right, lessThanOrEqualTo(viewport.right + 0.5));
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('mobile topic search is advanced and opens independently', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(390, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(_app(_feed(_RecordingRepository())));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('category-filter-scroll')), findsOneWidget);
    expect(find.byKey(const Key('topic-search-input')), findsNothing);
    await tester.tap(find.byKey(const Key('topic-search-toggle')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('topic-search-input')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('mobile primary navigation keeps the More entry visible', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    var openedAdministration = false;
    await tester.pumpWidget(
      _app(
        ConsumerResponsiveShell(
          title: 'Actualidad',
          body: const SizedBox.shrink(),
          navigationActions: <Widget>[
            for (final String label in <String>[
              'Actualidad',
              'Espejo',
              'VS',
              'Desarrollo',
              'Fuentes',
            ])
              ConsumerNavigationAction(
                label: label,
                selected: false,
                onPressed: () {},
              ),
            ConsumerNavigationAction(
              label: 'Administración',
              selected: false,
              onPressed: () => openedAdministration = true,
            ),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();

    final Finder moreEntry = find.text('Más');
    await tester.ensureVisible(moreEntry);
    await tester.pumpAndSettle();
    final tabs = ['Actualidad','Espejo','VS','Desarrollo','Fuentes'].map((label)=>tester.getRect(find.text(label))).toList();
    for (final tab in tabs) {
      expect(tab.center.dy, closeTo(tabs.first.center.dy, 0.5));
    }
    expect(tabs.last.right, greaterThan(tabs.first.right));
    await tester.ensureVisible(find.text('Fuentes'));
    await tester.pumpAndSettle();
    expect(tester.getRect(find.text('Fuentes')).right, lessThanOrEqualTo(390));
    await tester.tap(moreEntry);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Administración'));
    await tester.pumpAndSettle();
    expect(openedAdministration, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('fixture indication is conditional and explains its data', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      _app(const ConsumerScaffold(title: 'Dialektik', body: SizedBox())),
    );
    expect(find.text('DEMO'), findsNothing);
    await tester.pumpWidget(
      _app(
        const ConsumerScaffold(
          title: 'Dialektik',
          isDemo: true,
          body: SizedBox(),
        ),
      ),
    );
    await tester.tap(find.text('DEMO'));
    await tester.pumpAndSettle();
    expect(find.textContaining('fuentes ficticias'), findsOneWidget);
    expect(find.textContaining('No son noticias en vivo'), findsOneWidget);
    await tester.tap(find.text('Entendido'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
  });

  testWidgets('source identity uses neutral initials and translated type', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      _app(
        SourceScreen(sourceId: sourceAId, repository: _RecordingRepository()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('AU'), findsOneWidget);
    expect(find.text('Agencia Uno'), findsOneWidget);
    expect(find.textContaining('Agencia de noticias'), findsOneWidget);
    expect(find.textContaining('news_agency'), findsNothing);
    expect(find.byType(Image), findsNothing);
    expect(find.text('DEMO'), findsNothing);
    expect(
      tester
          .getSemantics(find.bySemanticsLabel('Agencia Uno'))
          .getSemanticsData()
          .label,
      'Agencia Uno',
    );
    semantics.dispose();
  });

  testWidgets(
    'system states announce once and retain a separate retry action',
    (WidgetTester tester) async {
      final SemanticsHandle semantics = tester.ensureSemantics();
      await tester.pumpWidget(
        _app(
          Builder(
            builder: (BuildContext context) => MediaQuery(
              data: MediaQuery.of(context).copyWith(disableAnimations: true),
              child: const SystemStateView(
                message: 'Cargando eventos',
                isLoading: true,
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.bySemanticsLabel('Cargando eventos'), findsOneWidget);
      expect(
        find.bySemanticsLabel('Cargando eventos Cargando eventos'),
        findsNothing,
      );
      expect(find.byType(CircularProgressIndicator), findsNothing);
      var retried = false;
      await tester.pumpWidget(
        _app(
          SystemStateView(
            message: 'No se pudo conectar',
            actionLabel: 'Reintentar',
            onAction: () => retried = true,
          ),
        ),
      );
      await tester.pump();
      expect(find.bySemanticsLabel('Reintentar'), findsOneWidget);
      await tester.tap(find.bySemanticsLabel('Reintentar'));
      expect(retried, isTrue);
      semantics.dispose();
    },
  );

  testWidgets('source shell exposes single back and demo accessible names', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      _app(
        Builder(
          builder: (BuildContext context) => TextButton(
            onPressed: () => Navigator.of(context).push<void>(
              MaterialPageRoute<void>(
                builder: (_) => SourceScreen(
                  sourceId: sourceAId,
                  repository: _RecordingRepository(),
                  isDemo: true,
                ),
              ),
            ),
            child: const Text('Abrir fuente'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Abrir fuente'));
    await tester.pumpAndSettle();
    expect(find.bySemanticsLabel('Volver'), findsOneWidget);
    expect(find.bySemanticsLabel('Volver Volver'), findsNothing);
    const String demoName = 'DEMO · Información de los datos ficticios';
    expect(find.bySemanticsLabel(demoName), findsOneWidget);
    expect(find.bySemanticsLabel('$demoName $demoName'), findsNothing);
    semantics.dispose();
  });

  testWidgets('demo source naming removes only the trailing fixture marker', (
    WidgetTester tester,
  ) async {
    const SourceDto source = SourceDto(
      id: sourceAId,
      name: 'Agencia de la Costa · sintético',
      sourceType: 'news_agency',
    );
    await tester.pumpWidget(
      _app(
        SourceScreen(
          key: UniqueKey(),
          sourceId: sourceAId,
          repository: _RecordingRepository(source: source),
          isDemo: true,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Agencia de la Costa'), findsOneWidget);
    expect(find.text(source.name), findsNothing);
    expect(find.text('AC'), findsOneWidget);

    await tester.pumpWidget(
      _app(
        SourceScreen(
          key: UniqueKey(),
          sourceId: sourceAId,
          repository: _RecordingRepository(source: source),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(source.name), findsOneWidget);
    expect(find.text('AC'), findsOneWidget);
    expect(find.text('DEMO'), findsNothing);
  });

  testWidgets('stress source shell keeps its profile and long name at 200%', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(360, 900);
    tester.view.devicePixelRatio = 1;
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    final SemanticsHandle semantics = tester.ensureSemantics();
    const SourceDto source = SourceDto(
      id: sourceAId,
      name:
          'Diario de las comunidades ribereñas y sus localidades vecinas · sintético',
      sourceType: 'news_agency',
    );
    await tester.pumpWidget(
      _app(
        SourceScreen(
          sourceId: sourceAId,
          repository: _RecordingRepository(source: source),
          fixtureProfile: EditorialFixtureProfile.stress,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('STRESS'), findsOneWidget);
    expect(find.text('DEMO'), findsNothing);
    expect(find.text('Dialektik'), findsOneWidget);
    expect(find.bySemanticsLabel('Ubicación actual: Fuente'), findsOneWidget);
    expect(
      find.text(
        'Diario de las comunidades ribereñas y sus localidades vecinas',
      ),
      findsOneWidget,
    );
    expect(find.text(source.name), findsNothing);
    expect(tester.takeException(), isNull);
    final Rect nameRect = tester.getRect(
      find.text(
        'Diario de las comunidades ribereñas y sus localidades vecinas',
      ),
    );
    final Rect identityRect = tester.getRect(find.byType(SourceIdentity));
    expect(nameRect.left, identityRect.left);
    expect(nameRect.width, identityRect.width);
    expect(nameRect.top, greaterThan(tester.getRect(find.text('DC')).bottom));
    await tester.tap(
      find.bySemanticsLabel('STRESS · Información de los datos ficticios'),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('deterministas'), findsOneWidget);
    expect(tester.takeException(), isNull);
    semantics.dispose();
  });
}

Widget _app(Widget child) => MaterialApp(
  locale: const Locale('es'),
  localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
    GlobalMaterialLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    ConsumerStringsDelegate(),
  ],
  supportedLocales: consumerSupportedLocales,
  theme: DialektikTheme.offWhite(loadInterFromDependency: false),
  home: child,
);

Widget _feed(_RecordingRepository repository, {VoidCallback? onOpenThreads}) =>
    FeedScreen(
      repository: repository,
      onOpenEvent: (_) {},
      onOpenContradictions: () {},
      onOpenThreads: onOpenThreads,
    );

final class _RecordingRepository implements ConsumerRepository {
  _RecordingRepository({SourceDto? source})
    : _delegate = FakeConsumerRepository(source: source);

  final FakeConsumerRepository _delegate;
  final List<String?> topics = <String?>[];
  final List<String?> categories = <String?>[];

  @override
  Future<PublicPage<EventCardDto>> listFeed({
    String? category,
    String? topic,
    String? cursor,
    int limit = 20,
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) {
    topics.add(topic);
    categories.add(category);
    return _delegate.listFeed(
      category: category,
      topic: topic,
      cursor: cursor,
      limit: limit,
      refresh: refresh,
      requestToken: requestToken,
    );
  }

  @override
  Future<SourceDto> getSource(
    String sourceId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _delegate.getSource(sourceId, requestToken: requestToken);

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('Unused repository method in this focused test.');
}
