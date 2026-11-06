import 'dart:async';

import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/consumer/presentation/widgets/dialectical_thread.dart';
import 'package:dialektik/features/consumer/presentation/widgets/share_synthesis.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/live/data/youtube_video.dart';
import 'package:dialektik/features/social/data/social_repository.dart';
import 'package:dialektik/features/social/presentation/media_public_profile.dart';
import 'package:dialektik/features/social/theme/dialektik_social_theme.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

class SocialContrastPost extends StatefulWidget {
  const SocialContrastPost({
    required this.event,
    required this.positions,
    required this.onOpenEvent,
    this.title,
    this.relation,
    this.sourceCount,
    this.sourcesRepository,
    super.key,
  });
  final EventDetailDto event;
  final List<EventCoveragePositionDto> positions;
  final VoidCallback onOpenEvent;
  final String? title, relation;
  final int? sourceCount;
  final LiveNewsRepository? sourcesRepository;
  @override
  State<SocialContrastPost> createState() => _SocialContrastPostState();
}

class _SocialContrastPostState extends State<SocialContrastPost> {
  final controller = PageController();
  int page = 0;
  SocialSummary? summary;
  bool busy = false;
  Timer? refreshTimer;
  SocialRepository? get social => widget.sourcesRepository is SocialRepository
      ? widget.sourcesRepository as SocialRepository
      : null;
  @override
  void initState() {
    super.initState();
    unawaited(_load());
    if (social != null)
      refreshTimer = Timer.periodic(const Duration(seconds: 30), (_) {
        if (!busy) unawaited(_load());
      });
  }

  Future<void> _load() async {
    try {
      final value = await social?.socialSummary(eventId: widget.event.id);
      if (mounted) setState(() => summary = value);
    } on Exception {
      /* The post remains readable while community data is unavailable. */
    }
  }

  Future<void> _react(String reaction) async {
    final repo = social;
    if (repo == null || busy) return;
    setState(() => busy = true);
    try {
      final updated = await repo.setSocialReaction(
        widget.event.id,
        summary?.mine == reaction ? null : reaction,
      );
      if (mounted) setState(() => summary = updated);
    } on Exception {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No se pudo guardar tu reacción.')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _comment() async {
    final repo = social;
    final articles = widget.event.articles;
    if (repo == null || articles.isEmpty) return;
    String text = '';
    String selected = articles.first.id;
    final result = await showDialog<(String, String)>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Aportar al debate'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('Elige la noticia que respalda tu aporte.'),
                DropdownButton<String>(
                  isExpanded: true,
                  value: selected,
                  items: [
                    for (final article in articles)
                      DropdownMenuItem(
                        value: article.id,
                        child: Text(
                          article.sourceName,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                  onChanged: (value) {
                    if (value != null) setDialogState(() => selected = value);
                  },
                ),
                TextField(
                  onChanged: (value) => text = value,
                  maxLength: 600,
                  maxLines: 4,
                  decoration: const InputDecoration(labelText: 'Tu aporte'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, (selected, text.trim())),
              child: const Text('Publicar'),
            ),
          ],
        ),
      ),
    );
    if (result == null || result.$2.isEmpty || !mounted) return;
    try {
      final updated = await repo.addSocialComment(
        widget.event.id,
        result.$1,
        result.$2,
      );
      if (mounted) setState(() => summary = updated);
    } on Exception {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No se pudo publicar el aporte.')),
        );
      }
    }
  }

  Future<void> _openProfile(EventCoveragePositionDto position) async {
    final repository = widget.sourcesRepository;
    final id = position.assertions.firstOrNull?.sourceId;
    if (repository == null) return;
    try {
      final sources = await repository.listLiveSources();
      final matches = sources.where(
        (source) => id != null
            ? source.id == id
            : source.name.trim().toLowerCase() == name(position).toLowerCase(),
      );
      if (!mounted || matches.isEmpty) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => MediaPublicProfileScreen(
            source: matches.first,
            repository: repository,
          ),
        ),
      );
    } on Exception {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No se pudo abrir el perfil.')),
        );
      }
    }
  }

  @override
  void dispose() {
    refreshTimer?.cancel();
    controller.dispose();
    super.dispose();
  }

  String name(EventCoveragePositionDto p) => p.assertions.isEmpty
      ? 'Medio no disponible'
      : p.assertions.first.sourceName.replaceAll('(YouTube)', '').trim();
  @override
  Widget build(BuildContext context) {
    final event = widget.event, positions = widget.positions.take(2).toList();
    final relation = widget.relation ?? event.synthesisRelation;
    final video = event.articles
        .map((a) => extractYouTubeVideoId(a.url.toString()))
        .whereType<String>()
        .firstOrNull;
    final scale = MediaQuery.textScalerOf(context).scale(1).clamp(1.0, 2.0);
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: DialektikSocialTheme.border),
        borderRadius: BorderRadius.circular(18),
        boxShadow: const [DialektikSocialTheme.shadow],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Align(
            alignment: Alignment.centerRight,
            child: Text(
              '${page + 1}/3 · Desliza para ver el otro lado →',
              style: Theme.of(context).textTheme.labelSmall,
            ),
          ),
          const SizedBox(height: 8),
          if (relation == 'CONTRADICTION' || relation == 'DIFFERENT_FOCUS')
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: relation == 'CONTRADICTION'
                      ? const Color(0xffc86446)
                      : const Color(0xffb47814),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 5,
                  ),
                  child: Text(
                    '${widget.sourceCount ?? event.sourceCount} MEDIOS · ${relation == 'CONTRADICTION' ? 'CONTRADICCIÓN' : 'DISTINTO ENFOQUE'}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
            ),
          Row(
            children: [
              SizedBox(
                width: 56,
                height: 36,
                child: Stack(
                  children: [
                    for (var i = 0; i < positions.length; i++)
                      Positioned(
                        left: 20.0 * i,
                        child: InkWell(
                          onTap: () => unawaited(_openProfile(positions[i])),
                          child: CircleAvatar(
                            radius: 17,
                            backgroundColor: Colors.white,
                            child: CircleAvatar(
                              radius: 15,
                              backgroundColor: DialektikSocialTheme.navy,
                              child: Text(
                                name(
                                  positions[i],
                                ).characters.first.toUpperCase(),
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 12,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Wrap(
                  spacing: 4,
                  children: [
                    for (final p in positions)
                      InkWell(
                        onTap: () => unawaited(_openProfile(p)),
                        child: Text(
                          name(p),
                          style: const TextStyle(fontWeight: FontWeight.bold),
                        ),
                      ),
                    const Text(
                      '· En duelo VS',
                      style: TextStyle(fontWeight: FontWeight.w500),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          SizedBox(
            height: 340 * scale,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: PageView(
                controller: controller,
                onPageChanged: (value) => setState(() => page = value),
                children: [
                  Container(
                    decoration: BoxDecoration(
                      color: DialektikSocialTheme.navy,
                      gradient: video == null
                          ? const LinearGradient(
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                              colors: [Color(0xff35455b), Color(0xff0b1320)],
                            )
                          : null,
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
                    child: Stack(
                      children: [
                        Center(
                          child: SingleChildScrollView(
                            padding: const EdgeInsets.all(20),
                            child: Align(
                              alignment: Alignment.centerLeft,
                              child: Text(
                                widget.title ?? event.titleDescriptive,
                                style: const TextStyle(
                                  fontFamily: 'Merriweather',
                                  fontSize: 24,
                                  fontWeight: FontWeight.w800,
                                  color: Color(0xff111111),
                                  backgroundColor: Color(0xfffdfbf7),
                                  height: 1.4,
                                ),
                              ),
                            ),
                          ),
                        ),
                        Positioned(
                          bottom: 12,
                          left: 0,
                          right: 0,
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              for (var i = 0; i < 3; i++)
                                Container(
                                  margin: const EdgeInsets.symmetric(
                                    horizontal: 3,
                                  ),
                                  width: 7,
                                  height: 7,
                                  decoration: BoxDecoration(
                                    shape: BoxShape.circle,
                                    color: i == page
                                        ? Colors.white
                                        : Colors.white38,
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  SingleChildScrollView(
                    padding: const EdgeInsets.all(12),
                    child: DialecticalThread(
                      event: event,
                      positions: positions,
                      relation: event.synthesisRelation,
                      onOpenSource: widget.sourcesRepository == null
                          ? null
                          : (id) => openMediaPublicProfile(
                              context,
                              widget.sourcesRepository!,
                              id,
                            ),
                    ),
                  ),
                  SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Cronología y transparencia',
                          style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 10),
                        for (final article
                            in [...event.articles]..sort(
                              (a, b) => a.publishedAt.compareTo(b.publishedAt),
                            ))
                          ListTile(
                            contentPadding: EdgeInsets.zero,
                            title: Text(article.sourceName),
                            subtitle: Text(
                              '${DateFormat('dd/MM HH:mm').format(article.publishedAt.toLocal())} · ${article.title}',
                            ),
                            trailing: const Icon(Icons.open_in_new),
                            onTap: () =>
                                unawaited(openExternalHttpLink(article.url)),
                          ),
                        const Text(
                          'Las citas se vinculan a las publicaciones originales disponibles.',
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: [
              for (final entry in [
                ('SOLID', '✓ Sólido', summary?.solid),
                ('BIASED', '⚖ Sesgado', summary?.biased),
              ])
                ActionChip(
                  backgroundColor: summary?.mine == entry.$1
                      ? DialektikSocialTheme.navy
                      : const Color(0xffede9df),
                  label: Text(
                    '${entry.$2}${entry.$3 == null ? '' : ' ${entry.$3}'}',
                    style: TextStyle(
                      color: summary?.mine == entry.$1
                          ? Colors.white
                          : DialektikSocialTheme.navy,
                    ),
                  ),
                  onPressed: social == null || busy
                      ? null
                      : () => _react(entry.$1),
                ),
              ActionChip(
                label: Text(
                  '💬 Debate${summary == null ? '' : ' ${summary!.comments.length}'}',
                ),
                onPressed: social == null
                    ? () => controller.animateToPage(
                        1,
                        duration: const Duration(milliseconds: 200),
                        curve: Curves.easeOut,
                      )
                    : _comment,
              ),
              ActionChip(
                label: const Text('↗ Compartir story'),
                onPressed: () => showSynthesisSharePreview(
                  context,
                  event,
                  relation: event.synthesisRelation,
                ),
              ),
            ],
          ),
          if (summary?.comments.isNotEmpty == true) ...[
            const Divider(),
            const Text(
              'Aportes de la comunidad · sin verificación editorial',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            for (final comment in summary!.comments) ...[
              Text(comment.body),
              TextButton(
                onPressed: () => openExternalHttpLink(comment.url),
                child: const Text('Ver evidencia ↗'),
              ),
            ],
          ],
          TextButton(
            onPressed: widget.onOpenEvent,
            child: const Text('Ver fuentes originales →'),
          ),
        ],
      ),
    );
  }
}
