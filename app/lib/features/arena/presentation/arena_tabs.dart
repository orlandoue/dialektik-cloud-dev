import 'dart:async';

import 'package:dialektik/features/arena/data/arena_account.dart';
import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/presentation/account_card.dart';
import 'package:dialektik/features/arena/presentation/arena_home_tab.dart';
import 'package:dialektik/features/arena/presentation/arena_navigation.dart';
import 'package:dialektik/features/arena/presentation/arena_widgets.dart';
import 'package:dialektik/features/arena/presentation/duel_screen.dart';
import 'package:dialektik/features/arena/presentation/media_profile_screen.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/data/story_follow_store.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/presentation/source_sync_sheet.dart';
import 'package:flutter/material.dart';

class _TabHeader extends StatelessWidget {
  const _TabHeader({
    required this.title,
    required this.subtitle,
    this.actions = const <Widget>[],
  });

  final String title;
  final String subtitle;

  /// Account actions (sign out, editorial review) kept one tap away.
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.fromLTRB(16, 10, actions.isEmpty ? 16 : 6, 10),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: Semantics(
                header: true,
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(title, style: ArenaText.brand),
                  ),
                ),
              ),
            ),
            if (actions.isNotEmpty)
              IconTheme(
                data: const IconThemeData(color: ArenaColors.ink),
                child: Row(mainAxisSize: MainAxisSize.min, children: actions),
              ),
          ],
        ),
        const SizedBox(height: 4),
        Text(subtitle, style: ArenaText.meta),
      ],
    ),
  );
}

/// Pestaña `VS`: every published contrast, never filtered by follows.
class ArenaVsTab extends StatelessWidget {
  const ArenaVsTab({required this.store, super.key});

  final ArenaStore store;

  @override
  Widget build(BuildContext context) => SafeArea(
    bottom: false,
    child: ListenableBuilder(
      listenable: store,
      builder: (BuildContext context, _) => RefreshIndicator(
        color: ArenaColors.violet,
        onRefresh: () => store.load(refresh: true),
        child: ListView(
          key: const Key('arena-vs-scroll'),
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.only(bottom: 24),
          children: <Widget>[
            const _TabHeader(
              title: 'VS · Duelos',
              subtitle:
                  'Todos los contrastes publicados entre medios, sin filtrar '
                  'por tus fuentes.',
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Column(
                children: <Widget>[
                  if (store.loading && !store.loaded)
                    const Padding(
                      padding: EdgeInsets.all(32),
                      child: CircularProgressIndicator(
                        color: ArenaColors.violet,
                      ),
                    )
                  else if (store.error != null && store.duels.isEmpty)
                    ArenaMessage(
                      'No se pudieron cargar los duelos.',
                      actionLabel: 'Reintentar',
                      onAction: () => unawaited(store.load(refresh: true)),
                    )
                  else if (store.duels.isEmpty)
                    const ArenaMessage('Todavía no hay duelos publicados.'),
                  for (final ArenaDuel duel in store.duels)
                    DuelListCard(duel: duel, store: store),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// Pestaña `Historias`: living events filtered by topic.
class ArenaStoriesTab extends StatefulWidget {
  const ArenaStoriesTab({required this.store, super.key});

  final ArenaStore store;

  @override
  State<ArenaStoriesTab> createState() => _ArenaStoriesTabState();
}

class _ArenaStoriesTabState extends State<ArenaStoriesTab> {
  static const List<ArenaTopic?> _filters = <ArenaTopic?>[
    null,
    ArenaTopic.politica,
    ArenaTopic.justicia,
    ArenaTopic.economia,
    ArenaTopic.deportes,
    ArenaTopic.sociedad,
    ArenaTopic.otros,
  ];
  int _filter = 0;

  @override
  void initState() {
    super.initState();
    widget.store.stories.addListener(_changed);
  }

  @override
  void dispose() {
    widget.store.stories.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final ArenaStore store = widget.store;
    final StoryFollowStore stories = store.stories;
    return SafeArea(
      bottom: false,
      child: ListenableBuilder(
        listenable: store,
        builder: (BuildContext context, _) {
          final ArenaTopic? topic = _filters[_filter];
          final List<EventCardDto> events = store.events
              .where(
                (EventCardDto e) =>
                    topic == null || arenaTopicOfEvent(e) == topic,
              )
              .toList();
          return RefreshIndicator(
            color: ArenaColors.violet,
            onRefresh: () => store.load(refresh: true),
            child: ListView(
              key: const Key('arena-stories-scroll'),
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.only(bottom: 24),
              children: <Widget>[
                const _TabHeader(
                  title: 'Historias vivas',
                  subtitle:
                      'Cada acontecimiento conserva su cronología, sus '
                      'versiones y su evidencia.',
                ),
                ArenaPillBar(
                  labels: <String>[
                    for (final ArenaTopic? item in _filters)
                      item?.label ?? 'Todos',
                  ],
                  selected: _filter,
                  onSelected: (int value) => setState(() => _filter = value),
                ),
                const SizedBox(height: 12),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(
                    children: <Widget>[
                      if (store.loading && !store.loaded)
                        const Padding(
                          padding: EdgeInsets.all(32),
                          child: CircularProgressIndicator(
                            color: ArenaColors.violet,
                          ),
                        )
                      else if (store.error != null && store.events.isEmpty)
                        ArenaMessage(
                          'No se pudieron cargar las historias.',
                          actionLabel: 'Reintentar',
                          onAction: () => unawaited(store.load(refresh: true)),
                        )
                      else if (events.isEmpty)
                        const ArenaMessage(
                          'No hay acontecimientos en este tema.',
                        ),
                      for (final EventCardDto event in events)
                        DevelopingEventCard(
                          event: event,
                          store: store,
                          note: switch (stories.snapshot(event.id)) {
                            final StorySnapshot snapshot
                                when event.sourceCount > snapshot.sourceCount =>
                              '⚡ Giro: ${event.sourceCount - snapshot.sourceCount} '
                                  'fuentes nuevas desde tu última visita',
                            StorySnapshot() => '🔔 Sigues esta historia',
                            null =>
                              store.duelForEvent(event.id) == null
                                  ? null
                                  : '⚔️ Tiene duelo VS publicado',
                          },
                        ),
                    ],
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

int _styleGroup(LiveSourceDto source) {
  final String name = source.name.toLowerCase();
  bool any(List<String> needles) => needles.any(name.contains);
  if (any(<String>[
    'sin filtros',
    'voz de los que sobran',
    'vía x',
    'via x',
    'el líbero',
    'el libero',
    'turno',
    'the clinic',
    'el ciudadano',
    'el desconcierto',
  ])) {
    return 0;
  }
  if (any(<String>[
    'ciper',
    'el mostrador',
    'la tercera',
    'fast check',
    'radio u. de chile',
    'radio universidad de chile',
    'diario el día',
    'diario el dia',
  ])) {
    return 1;
  }
  return 2;
}

/// Pestaña `Medios`: directory of every registered source.
class ArenaMediaTab extends StatefulWidget {
  const ArenaMediaTab({required this.store, super.key});

  final ArenaStore store;

  @override
  State<ArenaMediaTab> createState() => _ArenaMediaTabState();
}

class _ArenaMediaTabState extends State<ArenaMediaTab> {
  String _query = '';
  bool _syncing = false;
  final Set<String> _busy = <String>{};

  ArenaStore get store => widget.store;

  void _say(String message) => ScaffoldMessenger.of(
    context,
  ).showSnackBar(SnackBar(content: Text(message)));

  Future<void> _toggle(List<LiveSourceDto> brand) async {
    final String key = ArenaStore.brandKey(brand.first.name);
    if (_busy.contains(key)) return;
    setState(() => _busy.add(key));
    try {
      await store.setBrandFollowing(brand, value: !store.followsBrand(brand));
    } on Object {
      if (mounted) _say('No se pudo actualizar el seguimiento.');
    } finally {
      if (mounted) setState(() => _busy.remove(key));
    }
  }

  Future<void> _sync() async {
    final SourceSyncSelection? selected =
        await showModalBottomSheet<SourceSyncSelection>(
          context: context,
          isScrollControlled: true,
          backgroundColor: ArenaColors.card,
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          builder: (_) =>
              SourceSyncSheet(sources: store.sources, lookup: store.sourceSync),
        );
    if (selected == null || !mounted) return;
    final Set<String> brands = store.sources
        .where((LiveSourceDto s) => selected.ids.contains(s.id))
        .map((LiveSourceDto s) => ArenaStore.brandKey(s.name))
        .toSet();
    final List<String> ids = store.sources
        .where(
          (LiveSourceDto s) =>
              (selected.ids.contains(s.id) ||
                  brands.contains(ArenaStore.brandKey(s.name))) &&
              !store.followed.contains(s.id),
        )
        .map((LiveSourceDto s) => s.id)
        .toList();
    setState(() => _syncing = true);
    var done = 0;
    try {
      for (final String id in ids) {
        await store.setFollowing(id, value: true);
        done++;
      }
      if (mounted) {
        _say(
          '$done fuentes seguidas.'
          '${selected.truncated ? ' La lista era extensa y se consultó parcialmente.' : ''}',
        );
      }
    } on Object {
      if (mounted) _say('Se siguieron $done fuentes; no se guardaron todas.');
    } finally {
      if (mounted) setState(() => _syncing = false);
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    bottom: false,
    child: ListenableBuilder(
      listenable: store,
      builder: (BuildContext context, _) {
        final String needle = _query.trim().toLowerCase();
        // One card per medium: a press feed and its YouTube channel merge.
        final List<List<LiveSourceDto>> visible = store
            .brands(store.sources)
            .where(
              (List<LiveSourceDto> brand) => brand.any(
                (LiveSourceDto s) => s.name.toLowerCase().contains(needle),
              ),
            )
            .toList();
        final int followedBrands = store
            .brands(store.sources)
            .where(store.followsBrand)
            .length;
        final bool canFollow = store.following != null;
        return ListView(
          key: const Key('arena-media-tab-scroll'),
          padding: const EdgeInsets.only(bottom: 24),
          children: <Widget>[
            _TabHeader(
              title: 'Medios',
              subtitle:
                  '${store.sources.length} fuentes registradas · sigues '
                  '$followedBrands',
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  TextField(
                    key: const Key('arena-media-search'),
                    onChanged: (String value) => setState(() => _query = value),
                    decoration: InputDecoration(
                      hintText: 'Buscar medios...',
                      prefixIcon: const Icon(Icons.search),
                      filled: true,
                      fillColor: ArenaColors.card,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: const BorderSide(color: ArenaColors.border),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: const BorderSide(color: ArenaColors.border),
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                  OutlinedButton.icon(
                    key: const Key('arena-media-sync'),
                    onPressed: canFollow && !_syncing ? _sync : null,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: ArenaColors.violet,
                      side: const BorderSide(color: ArenaColors.violet),
                      minimumSize: const Size(48, 48),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 12,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                    icon: const Icon(Icons.sync),
                    label: const Text(
                      'Sincronizar mis fuentes con YouTube o X',
                      textAlign: TextAlign.center,
                    ),
                  ),
                ],
              ),
            ),
            if (store.sources.isEmpty)
              store.loading
                  ? const Padding(
                      padding: EdgeInsets.all(32),
                      child: Center(
                        child: CircularProgressIndicator(
                          color: ArenaColors.violet,
                        ),
                      ),
                    )
                  : ArenaMessage(
                      'El directorio de medios no está disponible.',
                      actionLabel: 'Reintentar',
                      onAction: () => unawaited(store.load(refresh: true)),
                    )
            else if (visible.isEmpty)
              const ArenaMessage('Sin resultados para esta búsqueda.'),
            for (final (int group, String title) in const <(int, String)>[
              (0, '🎬 Debate y tensión en video'),
              (1, '🔍 Investigación y análisis'),
              (2, '⚡ Minuto a minuto'),
            ])
              if (visible.any(
                (List<LiveSourceDto> b) => _styleGroup(b.first) == group,
              )) ...<Widget>[
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: ArenaSectionTitle(title),
                ),
                SingleChildScrollView(
                  key: ValueKey<String>('arena-media-carousel-$group'),
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: IntrinsicHeight(
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: <Widget>[
                        for (final List<LiveSourceDto> brand in visible.where(
                          (List<LiveSourceDto> b) =>
                              _styleGroup(b.first) == group,
                        ))
                          _MediaCard(
                            source: brand.first,
                            following: store.followsBrand(brand),
                            busy: _busy.contains(
                              ArenaStore.brandKey(brand.first.name),
                            ),
                            canFollow: canFollow,
                            onOpen: () => Navigator.of(context).push(
                              MaterialPageRoute<void>(
                                builder: (_) => MediaProfileScreen(
                                  source: brand.first,
                                  store: store,
                                ),
                              ),
                            ),
                            onToggle: () => _toggle(brand),
                          ),
                      ],
                    ),
                  ),
                ),
              ],
          ],
        );
      },
    ),
  );
}

class _MediaCard extends StatelessWidget {
  const _MediaCard({
    required this.source,
    required this.following,
    required this.busy,
    required this.canFollow,
    required this.onOpen,
    required this.onToggle,
  });

  final LiveSourceDto source;
  final bool following;
  final bool busy;
  final bool canFollow;
  final VoidCallback onOpen;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(right: 10),
    child: SizedBox(
      // Wide enough for «El Desconcierto» on one line.
      width: 168,
      child: Material(
        key: ValueKey<String>('arena-media-${source.id}'),
        color: ArenaColors.card,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: ArenaColors.border),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onOpen,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              children: <Widget>[
                MediaEmblem(name: source.name, size: 52),
                const SizedBox(height: 8),
                Text(
                  arenaSourceName(source.name),
                  textAlign: TextAlign.center,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: ArenaText.cardTitle,
                ),
                const SizedBox(height: 4),
                Text(
                  arenaMediaKind(source),
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: ArenaText.meta,
                ),
                const Spacer(),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: canFollow && !busy ? onToggle : null,
                    style: FilledButton.styleFrom(
                      backgroundColor: following
                          ? ArenaColors.violetSoft
                          : ArenaColors.violet,
                      foregroundColor: following
                          ? ArenaColors.violetDeep
                          : Colors.white,
                      minimumSize: const Size(48, 40),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 8,
                      ),
                    ),
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Text(following ? '✓ Siguiendo' : '+ Seguir'),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

/// Pestaña `Perfil`: the reader's own activity and radar settings.
class ArenaProfileTab extends StatefulWidget {
  const ArenaProfileTab({
    required this.store,
    required this.onConfigureRadar,
    this.extraActions = const <Widget>[],
    this.onOpenAdmin,
    super.key,
  });

  final ArenaStore store;
  final VoidCallback onConfigureRadar;
  final List<Widget> extraActions;
  final VoidCallback? onOpenAdmin;

  @override
  State<ArenaProfileTab> createState() => _ArenaProfileTabState();
}

class _ArenaProfileTabState extends State<ArenaProfileTab> {
  @override
  void initState() {
    super.initState();
    widget.store.stories.addListener(_changed);
  }

  @override
  void dispose() {
    widget.store.stories.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final ArenaStore store = widget.store;
    return SafeArea(
      bottom: false,
      child: ListenableBuilder(
        listenable: store,
        builder: (BuildContext context, _) {
          final StoryFollowStore stories = store.stories;
          final List<EventCardDto> followedStories = store.events
              .where((EventCardDto e) => stories.contains(e.id))
              .toList();
          // One entry per medium, even when it is registered twice.
          final List<LiveSourceDto> followedMedia = store
              .brands(store.sources)
              .where(store.followsBrand)
              .map((List<LiveSourceDto> brand) => brand.first)
              .toList();
          final List<ArenaDuel> savedDuels = store.duels
              .where((ArenaDuel d) => store.saved.contains(d.event.id))
              .toList();
          return ListView(
            key: const Key('arena-profile-scroll'),
            padding: const EdgeInsets.only(bottom: 24),
            children: <Widget>[
              _TabHeader(
                title: 'Perfil',
                subtitle:
                    'Tu actividad, tus medios y la configuración de tu radar.',
                actions: <Widget>[
                  ...widget.extraActions,
                  if (widget.onOpenAdmin != null)
                    IconButton(
                      tooltip: 'Administración',
                      onPressed: widget.onOpenAdmin,
                      icon: const Icon(Icons.settings_outlined),
                    ),
                ],
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    if (store.account
                        case final ArenaAccount account) ...<Widget>[
                      ArenaAccountCard(account: account),
                      const SizedBox(height: 12),
                    ],
                    ArenaCard(
                      child: Wrap(
                        alignment: WrapAlignment.spaceAround,
                        spacing: 16,
                        runSpacing: 12,
                        children: <Widget>[
                          _Stat('${followedMedia.length}', 'medios seguidos'),
                          _Stat(
                            '${followedStories.length}',
                            'historias seguidas',
                          ),
                          _Stat('${savedDuels.length}', 'duelos guardados'),
                        ],
                      ),
                    ),
                    ArenaPrimaryButton(
                      key: const Key('arena-configure-radar'),
                      icon: Icons.tune,
                      label: 'Configurar mi radar',
                      onPressed: widget.onConfigureRadar,
                    ),
                    const ArenaSectionTitle('Historias que sigues'),
                    if (followedStories.isEmpty)
                      const Text(
                        'Usa 🔔 Seguir en un acontecimiento para guardarlo aquí.',
                        style: ArenaText.body,
                      ),
                    for (final EventCardDto event in followedStories)
                      DevelopingEventCard(event: event, store: store),
                    const ArenaSectionTitle('Medios que sigues'),
                    if (followedMedia.isEmpty)
                      const Text(
                        'Todavía no sigues medios.',
                        style: ArenaText.body,
                      ),
                    Wrap(
                      spacing: 12,
                      runSpacing: 4,
                      children: <Widget>[
                        for (final LiveSourceDto source in followedMedia)
                          MediaNameRow(
                            name: source.name,
                            emblemSize: 28,
                            maxLines: 1,
                            onTap: () =>
                                openArenaMedia(context, store, source.id),
                          ),
                      ],
                    ),
                    const ArenaSectionTitle('Guardados'),
                    if (savedDuels.isEmpty)
                      const Text(
                        'Guarda un duelo con el marcador para leerlo después.',
                        style: ArenaText.body,
                      ),
                    for (final ArenaDuel duel in savedDuels)
                      DuelListCard(duel: duel, store: store),
                    const ArenaSectionTitle('Aportes'),
                    const Text(
                      'Tus aportes con fuente se publican en la «Comunidad '
                      'del caso» de cada acontecimiento.',
                      style: ArenaText.body,
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat(this.value, this.label);

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) => Column(
    mainAxisSize: MainAxisSize.min,
    children: <Widget>[
      Text(
        value,
        style: const TextStyle(
          fontSize: 22,
          fontWeight: FontWeight.w800,
          color: ArenaColors.violet,
        ),
      ),
      Text(label, style: ArenaText.meta),
    ],
  );
}
