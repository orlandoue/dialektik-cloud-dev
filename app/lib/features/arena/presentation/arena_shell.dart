import 'dart:async';

import 'package:dialektik/features/arena/data/arena_account.dart';
import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/presentation/arena_home_tab.dart';
import 'package:dialektik/features/arena/presentation/arena_tabs.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/live/presentation/source_radar.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// The five destinations of the bottom navigation bar, in board order.
enum ArenaTab { inicio, vs, historias, medios, perfil }

/// «Dialektik Arena: El Coliseo de los Medios, con Historias Vivas».
///
/// Hosts the five persistent tabs over one shared [ArenaStore]. Each tab is
/// built on first visit and then kept alive, so returning to it is instant.
class ArenaShell extends StatefulWidget {
  const ArenaShell({
    required this.consumer,
    required this.live,
    this.store,
    this.externalLinkOpener = openExternalHttpLink,
    this.initialTab = ArenaTab.inicio,
    this.extraActions = const <Widget>[],
    this.account,
    this.onOpenAdmin,
    this.includeSource,
    this.offerWelcomeRadar = true,
    super.key,
  });

  final ConsumerRepository consumer;
  final LiveNewsRepository live;

  /// Shared state owned by the caller; the shell creates its own otherwise.
  final ArenaStore? store;
  final ExternalLinkOpener externalLinkOpener;
  final ArenaTab initialTab;
  final List<Widget> extraActions;

  /// The signed-in reader, when the shell creates its own store.
  final ArenaAccount? account;
  final VoidCallback? onOpenAdmin;
  final bool Function(LiveSourceDto)? includeSource;
  final bool offerWelcomeRadar;

  @override
  State<ArenaShell> createState() => _ArenaShellState();
}

class _ArenaShellState extends State<ArenaShell> {
  late final ArenaStore _store =
      widget.store ??
      ArenaStore(
        consumer: widget.consumer,
        live: widget.live,
        openLink: widget.externalLinkOpener,
        account: widget.account,
      );
  late ArenaTab _tab = widget.initialTab;
  late final Set<ArenaTab> _built = <ArenaTab>{widget.initialTab};
  bool _welcomeOffered = false;

  @override
  void initState() {
    super.initState();
    unawaited(_start());
  }

  @override
  void dispose() {
    if (widget.store == null) _store.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    await _store.load();
    if (!mounted || !widget.offerWelcomeRadar || _welcomeOffered) return;
    // A reader with no followed sources is invited once to build the radar.
    if (_store.following != null &&
        _store.followed.isEmpty &&
        _store.sources.isNotEmpty) {
      _welcomeOffered = true;
      await _openRadar();
    }
  }

  Future<void> _openRadar() => showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: const Color(0xFFFAF8F3),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (BuildContext sheetContext) => Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.viewInsetsOf(sheetContext).bottom,
      ),
      child: FractionallySizedBox(
        heightFactor: 0.92,
        child: Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              child: Row(
                children: <Widget>[
                  const Expanded(
                    child: Text('Dialektik', style: ArenaText.brand),
                  ),
                  TextButton(
                    onPressed: () => Navigator.of(sheetContext).pop(),
                    child: const Text('Saltar'),
                  ),
                ],
              ),
            ),
            Expanded(
              child: SourceRadar(
                repository: widget.live,
                includeSource: widget.includeSource,
                onContinue: () => Navigator.of(sheetContext).pop(),
              ),
            ),
          ],
        ),
      ),
    ),
  );

  void _select(ArenaTab tab) => setState(() {
    _built.add(tab);
    _tab = tab;
  });

  Widget _page(ArenaTab tab) {
    if (!_built.contains(tab)) return const SizedBox.shrink();
    return switch (tab) {
      ArenaTab.inicio => ArenaHomeTab(
        store: _store,
        onOpenMedia: () => _select(ArenaTab.medios),
      ),
      ArenaTab.vs => ArenaVsTab(store: _store),
      ArenaTab.historias => ArenaStoriesTab(store: _store),
      ArenaTab.medios => ArenaMediaTab(store: _store),
      ArenaTab.perfil => ArenaProfileTab(
        store: _store,
        extraActions: widget.extraActions,
        onOpenAdmin: widget.onOpenAdmin,
        onConfigureRadar: () => unawaited(_openRadar()),
      ),
    };
  }

  @override
  Widget build(BuildContext context) => AnnotatedRegion<SystemUiOverlayStyle>(
    value: const SystemUiOverlayStyle(
      statusBarColor: ArenaColors.background,
      statusBarIconBrightness: Brightness.dark,
      statusBarBrightness: Brightness.light,
      systemNavigationBarColor: ArenaColors.card,
      systemNavigationBarIconBrightness: Brightness.dark,
    ),
    child: Scaffold(
      backgroundColor: ArenaColors.background,
      body: IndexedStack(
        index: _tab.index,
        children: <Widget>[
          for (final ArenaTab tab in ArenaTab.values)
            TickerMode(
              enabled: tab == _tab,
              child: KeyedSubtree(
                key: ValueKey<ArenaTab>(tab),
                child: _page(tab),
              ),
            ),
        ],
      ),
      bottomNavigationBar: DecoratedBox(
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: ArenaColors.border)),
        ),
        // Labels stay on one line: large system text is capped in the bar
        // only, never in the content above it.
        child: MediaQuery.withClampedTextScaling(
          maxScaleFactor: 1.15,
          child: BottomNavigationBar(
            key: const Key('arena-bottom-navigation'),
            type: BottomNavigationBarType.fixed,
            backgroundColor: ArenaColors.card,
            elevation: 0,
            currentIndex: _tab.index,
            onTap: (int index) => _select(ArenaTab.values[index]),
            selectedItemColor: ArenaColors.violet,
            unselectedItemColor: ArenaColors.muted,
            selectedFontSize: 12,
            unselectedFontSize: 12,
            selectedLabelStyle: const TextStyle(fontWeight: FontWeight.w700),
            items: const <BottomNavigationBarItem>[
              BottomNavigationBarItem(
                icon: Icon(Icons.home_outlined),
                activeIcon: Icon(Icons.home),
                label: 'Inicio',
                tooltip: 'Inicio',
              ),
              BottomNavigationBarItem(
                icon: _VsIcon(),
                label: 'VS',
                tooltip: 'VS',
              ),
              BottomNavigationBarItem(
                icon: Icon(Icons.auto_stories_outlined),
                activeIcon: Icon(Icons.auto_stories),
                label: 'Historias',
                tooltip: 'Historias',
              ),
              BottomNavigationBarItem(
                icon: Icon(Icons.cell_tower),
                label: 'Medios',
                tooltip: 'Medios',
              ),
              BottomNavigationBarItem(
                icon: Icon(Icons.person_outline),
                activeIcon: Icon(Icons.person),
                label: 'Perfil',
                tooltip: 'Perfil',
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

/// Crossed-swords glyph for the duel tab, tinted like the other icons.
class _VsIcon extends StatelessWidget {
  const _VsIcon();

  @override
  Widget build(BuildContext context) {
    final IconThemeData theme = IconTheme.of(context);
    final double size = theme.size ?? 24;
    return SizedBox.square(
      dimension: size,
      child: CustomPaint(
        painter: _SwordsPainter(theme.color ?? ArenaColors.muted),
      ),
    );
  }
}

class _SwordsPainter extends CustomPainter {
  _SwordsPainter(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final double s = size.shortestSide;
    final Paint blade = Paint()
      ..color = color
      ..strokeWidth = s * 0.09
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;
    for (final bool mirrored in <bool>[false, true]) {
      Offset at(double x, double y) =>
          Offset((mirrored ? 1 - x : x) * s, y * s);
      canvas
        ..drawLine(at(0.84, 0.12), at(0.28, 0.68), blade)
        ..drawLine(at(0.16, 0.56), at(0.40, 0.80), blade)
        ..drawLine(at(0.24, 0.72), at(0.12, 0.88), blade);
    }
  }

  @override
  bool shouldRepaint(_SwordsPainter oldDelegate) => oldDelegate.color != color;
}
