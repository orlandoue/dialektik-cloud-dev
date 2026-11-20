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
import 'package:dialektik/features/live/data/chile_seismic_observations.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/publisher_market_selection.dart';
import 'package:dialektik/features/live/presentation/chile_seismic_observations_panel.dart';
import 'package:dialektik/features/live/presentation/source_sync_sheet.dart';
import 'package:dialektik/features/science/presentation/moderation_screen.dart';
import 'package:dialektik/features/science/presentation/my_comments.dart';
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
                  'Todos los duelos publicados entre medios, sin filtrar '
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
    ArenaTopic.internacional,
    ArenaTopic.justicia,
    ArenaTopic.economia,
    ArenaTopic.deportes,
    ArenaTopic.sociedad,
    ArenaTopic.otros,
  ];
  int _filter = 0;

  /// 0: most recent first; 1: covered by the most outlets first.
  int _order = 0;

  static const List<(int, String)> _storyOrders = <(int, String)>[
    (0, 'Recientes'),
    (1, 'Más cubiertas'),
  ];

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
          final List<EventCardDto> events =
              store.events
                  .where(
                    (EventCardDto e) =>
                        topic == null || arenaTopicOfEvent(e) == topic,
                  )
                  .toList()
                ..sort(
                  (EventCardDto a, EventCardDto b) => _order == 1
                      ? b.sourceCount.compareTo(a.sourceCount)
                      : b.detectedAt.compareTo(a.detectedAt),
                );
          final SeismicObservationRepository? seismic = store.seismic;
          return RefreshIndicator(
            color: ArenaColors.violet,
            onRefresh: () => store.load(refresh: true),
            child: ListView(
              key: const Key('arena-stories-scroll'),
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.only(bottom: 24),
              children: <Widget>[
                const _TabHeader(
                  title: 'En desarrollo',
                  subtitle:
                      'Cada acontecimiento conserva su cronología y lo que '
                      'dijo cada medio.',
                ),
                ArenaPillBar(
                  labels: <String>[
                    for (final ArenaTopic? item in _filters)
                      item?.label ?? 'Todos',
                  ],
                  selected: _filter,
                  onSelected: (int value) => setState(() => _filter = value),
                ),
                const SizedBox(height: 8),
                // Ordering is not a filter: a menu, not a second row of
                // the same pills as the topics.
                Align(
                  alignment: Alignment.centerLeft,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    child: PopupMenuButton<int>(
                      key: const Key('arena-stories-order'),
                      initialValue: _order,
                      onSelected: (int value) => setState(() => _order = value),
                      itemBuilder: (BuildContext context) =>
                          <PopupMenuEntry<int>>[
                            for (final (int value, String label)
                                in _storyOrders)
                              PopupMenuItem<int>(
                                key: ValueKey<String>(
                                  'arena-stories-order-$value',
                                ),
                                value: value,
                                child: Text(label),
                              ),
                          ],
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 10,
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: <Widget>[
                            const Icon(
                              Icons.sort_rounded,
                              size: 18,
                              color: ArenaColors.muted,
                            ),
                            const SizedBox(width: 6),
                            Flexible(
                              child: Text(
                                'Ordenar: ${_storyOrders[_order].$2}',
                                style: ArenaText.meta,
                              ),
                            ),
                            const Icon(
                              Icons.arrow_drop_down,
                              color: ArenaColors.muted,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
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
                          'No se pudo cargar En desarrollo.',
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
                              'Novedades: ${event.sourceCount - snapshot.sourceCount} '
                                  '${event.sourceCount - snapshot.sourceCount == 1 ? 'medio nuevo' : 'medios nuevos'} '
                                  'desde tu última visita',
                            StorySnapshot() => 'Sigues esta historia',
                            null => null,
                          },
                          duel: store.duelForEvent(event.id),
                        ),
                      if (seismic != null) ...<Widget>[
                        const SizedBox(height: 16),
                        DecoratedBox(
                          decoration: arenaCardDecoration(),
                          child: Theme(
                            data: Theme.of(
                              context,
                            ).copyWith(dividerColor: Colors.transparent),
                            child: ExpansionTile(
                              key: const Key('arena-seismic'),
                              shape: const Border(),
                              iconColor: ArenaColors.violet,
                              collapsedIconColor: ArenaColors.muted,
                              leading: const Icon(
                                Icons.sensors,
                                color: ArenaColors.violet,
                              ),
                              title: const Text(
                                'Actividad sísmica · USGS',
                                style: ArenaText.cardTitle,
                              ),
                              childrenPadding: const EdgeInsets.fromLTRB(
                                12,
                                0,
                                12,
                                12,
                              ),
                              children: <Widget>[
                                ChileSeismicObservationsPanel(
                                  repository: seismic,
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
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

/// Objective format groups: what the outlet publishes, never a judgement
/// of its style or quality.
const List<String> arenaMediaFormats = <String>[
  'Prensa escrita y digital',
  'Radio',
  'Canales de video',
];

int arenaMediaFormat(List<LiveSourceDto> brand) {
  bool video(LiveSourceDto s) =>
      s.canonicalDomain.contains('youtube') ||
      s.name.toLowerCase().contains('youtube');
  if (brand.any(arenaIsRadio)) return 1;
  return brand.every(video) ? 2 : 0;
}

/// A directory long enough to need its own search field.
const int arenaMediaSearchThreshold = 15;

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
    final String key = ArenaStore.brandKeyOf(brand.first);
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
        .map(ArenaStore.brandKeyOf)
        .toSet();
    final List<String> ids = store.sources
        .where(
          (LiveSourceDto s) =>
              (selected.ids.contains(s.id) ||
                  brands.contains(ArenaStore.brandKeyOf(s))) &&
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
                  '${store.brands(store.sources).length} '
                  '${store.brands(store.sources).length == 1 ? 'medio' : 'medios'} · '
                  'sigues $followedBrands',
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  if (store.brands(store.sources).length >=
                      arenaMediaSearchThreshold) ...<Widget>[
                    TextField(
                      key: const Key('arena-media-search'),
                      onChanged: (String value) =>
                          setState(() => _query = value),
                      decoration: InputDecoration(
                        hintText: 'Buscar medios...',
                        prefixIcon: const Icon(Icons.search),
                        filled: true,
                        fillColor: ArenaColors.card,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: const BorderSide(
                            color: ArenaColors.border,
                          ),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: const BorderSide(
                            color: ArenaColors.border,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],
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
                      'Importar los medios que sigues en YouTube o X',
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
            for (int group = 0; group < arenaMediaFormats.length; group++)
              if (visible.any(
                (List<LiveSourceDto> b) => arenaMediaFormat(b) == group,
              )) ...<Widget>[
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: ArenaSectionTitle(arenaMediaFormats[group]),
                ),
                for (final List<LiveSourceDto> brand
                    in visible
                        .where(
                          (List<LiveSourceDto> b) =>
                              arenaMediaFormat(b) == group,
                        )
                        .toList()
                      ..sort(
                        (List<LiveSourceDto> a, List<LiveSourceDto> b) =>
                            arenaSourceName(
                              a.first.name,
                            ).toLowerCase().compareTo(
                              arenaSourceName(b.first.name).toLowerCase(),
                            ),
                      ))
                  _MediaRow(
                    source: brand.first,
                    following: store.followsBrand(brand),
                    busy: _busy.contains(ArenaStore.brandKeyOf(brand.first)),
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
          ],
        );
      },
    ),
  );
}

/// One outlet per row: emblem, name, format and the follow button.
class _MediaRow extends StatelessWidget {
  const _MediaRow({
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
  Widget build(BuildContext context) => Material(
    key: ValueKey<String>('arena-media-${source.id}'),
    color: Colors.transparent,
    child: InkWell(
      onTap: onOpen,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 64),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: <Widget>[
              MediaEmblem(name: source.name, size: 40),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      arenaSourceName(source.name),
                      style: ArenaText.cardTitle,
                    ),
                    Text(arenaMediaKind(source), style: ArenaText.meta),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              ArenaFollowButton(
                compact: true,
                following: following,
                onPressed: canFollow && !busy ? onToggle : null,
              ),
            ],
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
    this.onOpenStories,
    this.onOpenVs,
    super.key,
  });

  final ArenaStore store;
  final VoidCallback onConfigureRadar;

  /// Empty sections lead somewhere: `Historias` and `VS`.
  final VoidCallback? onOpenStories;
  final VoidCallback? onOpenVs;
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
                    // Only moderator accounts (DIALEKTIK_SCIENCE_MODERATORS).
                    if (store.scienceModerator) ...<Widget>[
                      OutlinedButton.icon(
                        key: const Key('arena-open-science-moderation'),
                        onPressed: () =>
                            unawaited(openScienceModeration(context, store)),
                        style: arenaSecondaryButtonStyle(),
                        icon: const Icon(Icons.fact_check_outlined),
                        label: const Text('Moderación de Ciencia'),
                      ),
                      const SizedBox(height: 12),
                    ],
                    // Counts live in each heading; no separate scoreboard.
                    ArenaPrimaryButton(
                      key: const Key('arena-configure-radar'),
                      icon: Icons.tune,
                      label: 'Elegir mis medios',
                      onPressed: widget.onConfigureRadar,
                    ),
                    ArenaSectionTitle(
                      'Lo que sigues · ${followedStories.length}',
                    ),
                    if (followedStories.isEmpty)
                      _EmptySection(
                        text:
                            'Sigue un acontecimiento para guardarlo aquí y '
                            'ver sus novedades.',
                        actionLabel: 'Ver En desarrollo',
                        onAction: widget.onOpenStories,
                      ),
                    for (final EventCardDto event in followedStories)
                      DevelopingEventCard(event: event, store: store),
                    ArenaSectionTitle(
                      'Medios que sigues · ${followedMedia.length}',
                    ),
                    if (followedMedia.isEmpty)
                      _EmptySection(
                        text: 'Todavía no sigues medios.',
                        actionLabel: 'Elegir mis medios',
                        onAction: widget.onConfigureRadar,
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
                    ArenaSectionTitle('Guardados · ${savedDuels.length}'),
                    if (savedDuels.isEmpty)
                      _EmptySection(
                        text:
                            'Guarda un duelo con el marcador para leerlo '
                            'después.',
                        actionLabel: 'Ver duelos',
                        onAction: widget.onOpenVs,
                      ),
                    for (final ArenaDuel duel in savedDuels)
                      DuelListCard(duel: duel, store: store),
                    if (store.scienceEnabled)
                      MyCommentsSection(store: store)
                    else ...<Widget>[
                      const ArenaSectionTitle('Aportes'),
                      const Text(
                        'Tus aportes con fuente se publican en la «Comunidad '
                        'del caso» de cada acontecimiento.',
                        style: ArenaText.body,
                      ),
                    ],
                    const ArenaSectionTitle('Ajustes'),
                    ArenaCard(
                      key: const Key('arena-edition'),
                      onTap: () =>
                          unawaited(showArenaCountrySheet(context, store)),
                      child: Row(
                        children: <Widget>[
                          const Icon(Icons.public, color: ArenaColors.muted),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              'Edición: '
                              '${PublisherMarketSelection.countryOf(store.country).name}',
                              style: ArenaText.cardTitle,
                            ),
                          ),
                          const Icon(
                            Icons.chevron_right,
                            color: ArenaColors.muted,
                          ),
                        ],
                      ),
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

/// An empty section with a way forward.
class _EmptySection extends StatelessWidget {
  const _EmptySection({
    required this.text,
    required this.actionLabel,
    this.onAction,
  });

  final String text;
  final String actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: <Widget>[
      Text(text, style: ArenaText.body),
      if (onAction != null) ...<Widget>[
        const SizedBox(height: 8),
        OutlinedButton(
          style: arenaSecondaryButtonStyle(),
          onPressed: onAction,
          child: Text(actionLabel),
        ),
      ],
    ],
  );
}
