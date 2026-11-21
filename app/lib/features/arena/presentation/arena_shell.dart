import 'dart:async';

import 'package:dialektik/core/infrastructure/usage_analytics.dart';
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
import 'package:dialektik/features/science/presentation/science_widgets.dart';
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

  void _select(ArenaTab tab) {
    if (tab != _tab) logScreen('tab_${tab.name}');
    setState(() {
      _built.add(tab);
      _tab = tab;
    });
  }

  Widget _page(ArenaTab tab) {
    if (!_built.contains(tab)) return const SizedBox.shrink();
    return switch (tab) {
      ArenaTab.inicio => ArenaHomeTab(
        store: _store,
        onOpenMedia: () => _select(ArenaTab.medios),
        onOpenStories: () => _select(ArenaTab.historias),
      ),
      ArenaTab.vs => ArenaVsTab(store: _store),
      ArenaTab.historias => ArenaStoriesTab(store: _store),
      ArenaTab.medios => ArenaMediaTab(store: _store),
      ArenaTab.perfil => ArenaProfileTab(
        store: _store,
        extraActions: widget.extraActions,
        onOpenAdmin: widget.onOpenAdmin,
        onConfigureRadar: () => unawaited(_openRadar()),
        onOpenStories: () => _select(ArenaTab.historias),
        onOpenVs: () => _select(ArenaTab.vs),
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
      // One bar for every mode: same names, icons and order.
      bottomNavigationBar: ArenaBottomBar(
        current: _tab.index,
        onSelected: (int index) => _select(ArenaTab.values[index]),
      ),
    ),
  );
}
