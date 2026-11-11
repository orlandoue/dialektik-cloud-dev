import 'dart:async';

import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/following_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/consumer/presentation/widgets/dialectical_thread.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/live/data/youtube_video.dart';
import 'package:dialektik/features/social/data/social_repository.dart';
import 'package:dialektik/features/social/theme/dialektik_social_theme.dart';
import 'package:flutter/material.dart';

Future<void> openMediaPublicProfile(
  BuildContext context,
  LiveNewsRepository repository,
  String sourceId,
) async {
  try {
    final sources = await repository.listLiveSources();
    final match = sources.where((source) => source.id == sourceId).firstOrNull;
    if (!context.mounted) return;
    if (match == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Perfil del medio no disponible.')),
      );
      return;
    }
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            MediaPublicProfileScreen(source: match, repository: repository),
      ),
    );
  } on Exception {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No se pudo abrir el perfil.')),
      );
    }
  }
}

class MediaPublicProfileScreen extends StatefulWidget {
  const MediaPublicProfileScreen({
    required this.source,
    required this.repository,
    super.key,
  });
  final LiveSourceDto source;
  final LiveNewsRepository repository;
  @override
  State<MediaPublicProfileScreen> createState() =>
      _MediaPublicProfileScreenState();
}

class _MediaPublicProfileScreenState extends State<MediaPublicProfileScreen> {
  List<LiveNewsItemDto> items = [];
  List<EventDetailDto> duels = [];
  Map<String, int> opponents = {};
  bool loading = true, following = false, busy = false;
  String? error;
  SocialSummary? socialSummary;
  Timer? refreshTimer;
  int tab = 0;
  FollowingRepository? get follows =>
      widget.repository is FollowingRepository &&
          (widget.repository as FollowingRepository).followingAvailable
      ? widget.repository as FollowingRepository
      : null;
  @override
  void initState() {
    super.initState();
    unawaited(_load());
    if (widget.repository is SocialRepository) {
      refreshTimer = Timer.periodic(
        const Duration(seconds: 30),
        (_) => unawaited(_loadSocial()),
      );
    }
  }

  @override
  void dispose() {
    refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final page = await widget.repository.listLiveNews(
        sourceId: widget.source.id,
        limit: 50,
      );
      final ids = await follows?.listFollowedSources() ?? <String>{};
      if (mounted) {
        setState(() {
          items = page.items;
          following = ids.contains(widget.source.id);
          loading = false;
        });
      }
      unawaited(_loadDuels());
      unawaited(_loadSocial());
    } on Exception {
      if (mounted) {
        setState(() {
          loading = false;
          error = 'No se pudo cargar el perfil.';
        });
      }
    }
  }

  Future<void> _loadSocial() async {
    final repo = widget.repository;
    if (repo is! SocialRepository) return;
    try {
      final value = await (repo as SocialRepository).socialSummary(
        sourceId: widget.source.id,
      );
      if (mounted) setState(() => socialSummary = value);
    } on Exception {
      /* Keep the profile readable. */
    }
  }

  Future<void> _loadDuels() async {
    final repo = widget.repository;
    if (repo is! ConsumerRepository) return;
    final consumer = repo as ConsumerRepository;
    try {
      final page = await consumer.listContradictions(limit: 50);
      final results = await Future.wait(
        page.items.map((c) async {
          try {
            return await consumer.getEvent(c.eventId);
          } on Exception {
            return null;
          }
        }),
      );
      final sourceName = widget.source.name
          .replaceAll('(YouTube)', '')
          .trim()
          .toLowerCase();
      final found = <EventDetailDto>[], rivals = <String, int>{};
      for (final event in results.whereType<EventDetailDto>()) {
        final articles = event.articles;
        final matching = articles.where(
          (a) =>
              a.sourceId == widget.source.id ||
              (a.sourceId == null &&
                  a.sourceName
                          .replaceAll('(YouTube)', '')
                          .trim()
                          .toLowerCase() ==
                      sourceName),
        );
        if (matching.isEmpty) continue;
        found.add(event);
        for (final name
            in articles
                .where(
                  (a) =>
                      a.sourceId != widget.source.id &&
                      a.sourceName
                              .replaceAll('(YouTube)', '')
                              .trim()
                              .toLowerCase() !=
                          sourceName,
                )
                .map((a) => a.sourceName)
                .toSet()) {
          rivals[name] = (rivals[name] ?? 0) + 1;
        }
      }
      if (mounted) {
        setState(() {
          duels = found;
          opponents = rivals;
        });
      }
    } on Exception {
      /* Other profile data remains available. */
    }
  }

  Future<void> _toggle() async {
    final repo = follows;
    if (repo == null || busy) return;
    setState(() => busy = true);
    try {
      await repo.setFollowing(widget.source.id, following: !following);
      if (mounted) setState(() => following = !following);
      unawaited(_loadSocial());
    } on Exception {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('No se pudo actualizar el seguimiento.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final name = widget.source.name.replaceAll('(YouTube)', '').trim();
    final initials = name
        .split(RegExp(r'\s+'))
        .where((s) => s.isNotEmpty)
        .take(2)
        .map((s) => s.characters.first.toUpperCase())
        .join();
    final visible = tab == 2
        ? items
              .where(
                (a) => extractYouTubeVideoId(a.canonicalUrl.toString()) != null,
              )
              .toList()
        : items;
    return Scaffold(
      backgroundColor: DialektikSocialTheme.paper,
      appBar: AppBar(title: const Text('Dialektik'), centerTitle: true),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                CircleAvatar(
                  radius: 44,
                  backgroundColor: DialektikSocialTheme.navy,
                  child: CircleAvatar(
                    radius: 41,
                    backgroundColor: Colors.white,
                    child: CircleAvatar(
                      radius: 38,
                      backgroundColor: DialektikSocialTheme.navy,
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Padding(
                          padding: const EdgeInsets.all(8),
                          child: Text(
                            initials,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 23,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Perfil público del medio',
                        style: TextStyle(color: Colors.grey),
                      ),
                      Text(
                        name,
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      Text(
                        '${socialSummary?.followers == null ? '' : '${socialSummary!.followers} seguidores · '}${items.length}${items.length == 50 ? '+' : ''} publicaciones cargadas · ${duels.length} contrastes cargados',
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            FilledButton(
              onPressed: follows == null || busy ? null : _toggle,
              style: FilledButton.styleFrom(
                backgroundColor: DialektikSocialTheme.navy,
                minimumSize: const Size.fromHeight(44),
              ),
              child: Text(following ? '✓ Siguiendo' : '+ Seguir'),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                border: Border.all(color: DialektikSocialTheme.border),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Radiografía de la comunidad',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 8),
                  if (socialSummary == null ||
                      socialSummary!.solid + socialSummary!.biased == 0)
                    const Text(
                      'Aún no hay evaluaciones comunitarias disponibles.',
                    )
                  else ...[
                    ClipRRect(
                      borderRadius: BorderRadius.circular(5),
                      child: SizedBox(
                        height: 10,
                        child: Row(
                          children: [
                            if (socialSummary!.solid > 0)
                              Expanded(
                                flex: socialSummary!.solid,
                                child: Container(
                                  color: DialektikSocialTheme.navy,
                                ),
                              ),
                            if (socialSummary!.biased > 0)
                              Expanded(
                                flex: socialSummary!.biased,
                                child: Container(
                                  color: const Color(0xffbe123c),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Evaluación ciudadana de acontecimientos cubiertos: ${(100 * socialSummary!.solid / (socialSummary!.solid + socialSummary!.biased)).round()}% Sólido · ${(100 * socialSummary!.biased / (socialSummary!.solid + socialSummary!.biased)).round()}% Sesgado',
                    ),
                  ],
                  if (opponents.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Text(
                      'Mayor contraste frecuente con: ${(opponents.entries.toList()..sort((a, b) => b.value.compareTo(a.value))).first.key}',
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 8,
              children: [
                for (final entry in [
                  (0, 'Publicaciones'),
                  (1, 'Duelos VS'),
                  (2, 'Videos'),
                ])
                  ChoiceChip(
                    label: Text(entry.$2),
                    selected: tab == entry.$1,
                    onSelected: (_) => setState(() => tab = entry.$1),
                  ),
              ],
            ),
            if (loading)
              const Center(child: CircularProgressIndicator())
            else if (error != null)
              Text(error!)
            else if (tab == 1) ...[
              if (duels.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(12),
                  child: Text('No hay contrastes disponibles para este medio.'),
                )
              else
                LayoutBuilder(
                  builder: (context, constraints) {
                    final width = (constraints.maxWidth - 10) / 2;
                    return Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      children: [
                        for (final event in duels)
                          SizedBox(
                            width: width,
                            child: InkWell(
                              onTap: () => Navigator.of(context).push(
                                MaterialPageRoute<void>(
                                  builder: (_) => _ProfileDuel(
                                    event: event,
                                    repository: widget.repository,
                                  ),
                                ),
                              ),
                              child: Container(
                                constraints: const BoxConstraints(
                                  minHeight: 150,
                                ),
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: DialektikSocialTheme.navy,
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text(
                                      'VS',
                                      style: TextStyle(color: Colors.white70),
                                    ),
                                    const SizedBox(height: 30),
                                    Text(
                                      event.titleDescriptive,
                                      maxLines: 4,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                      ],
                    );
                  },
                ),
            ] else if (visible.isEmpty)
              const Padding(
                padding: EdgeInsets.all(12),
                child: Text('No hay publicaciones disponibles.'),
              )
            else
              LayoutBuilder(
                builder: (context, constraints) {
                  final width = (constraints.maxWidth - 10) / 2;
                  return Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: [
                      for (final article in visible)
                        SizedBox(
                          width: width,
                          child: _ProfileTile(article: article),
                        ),
                    ],
                  );
                },
              ),
          ],
        ),
      ),
    );
  }
}

class _ProfileDuel extends StatelessWidget {
  const _ProfileDuel({required this.event, required this.repository});
  final EventDetailDto event;
  final LiveNewsRepository repository;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Dialektik')),
    body: ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          event.titleDescriptive,
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 16),
        DialecticalThread(
          event: event,
          positions: event.coveragePositions,
          relation: event.synthesisRelation,
          onOpenSource: (id) => openMediaPublicProfile(context, repository, id),
        ),
        for (final article in event.articles)
          ListTile(
            title: InkWell(
              onTap: article.sourceId == null
                  ? null
                  : () => openMediaPublicProfile(
                      context,
                      repository,
                      article.sourceId!,
                    ),
              child: Text(article.sourceName),
            ),
            subtitle: Text(article.title),
            trailing: const Icon(Icons.open_in_new),
            onTap: () => unawaited(openExternalHttpLink(article.url)),
          ),
      ],
    ),
  );
}

class _ProfileTile extends StatelessWidget {
  const _ProfileTile({required this.article});
  final LiveNewsItemDto article;
  @override
  Widget build(BuildContext context) {
    final video = extractYouTubeVideoId(article.canonicalUrl.toString());
    return InkWell(
      onTap: () => unawaited(openExternalHttpLink(article.canonicalUrl)),
      child: Container(
        constraints: const BoxConstraints(minHeight: 150),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: DialektikSocialTheme.navy,
          borderRadius: BorderRadius.circular(12),
          image: video == null
              ? null
              : DecorationImage(
                  image: NetworkImage(youTubeThumbnailUrl(video)),
                  fit: BoxFit.cover,
                  colorFilter: ColorFilter.mode(
                    Colors.black.withValues(alpha: .55),
                    BlendMode.darken,
                  ),
                ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            if (video != null)
              const Icon(Icons.play_circle_fill, color: Colors.white),
            const SizedBox(height: 30),
            Text(
              article.headline,
              maxLines: 4,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
