import 'dart:async';
import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/consumer/presentation/widgets/dialectical_thread.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/social/presentation/media_public_profile.dart';
import 'package:dialektik/features/social/theme/dialektik_social_theme.dart';
import 'package:flutter/material.dart';

class DialektikStoriesBar extends StatefulWidget {
  const DialektikStoriesBar({
    required this.repository,
    this.sourcesRepository,
    this.initialSources,
    this.initialContrasts,
    this.contrastsFuture,
    super.key,
  });
  final ConsumerRepository repository;
  final LiveNewsRepository? sourcesRepository;
  final List<LiveSourceDto>? initialSources;
  final List<ContradictionDto>? initialContrasts;
  final Future<PublicPage<ContradictionDto>>? contrastsFuture;
  @override
  State<DialektikStoriesBar> createState() => _DialektikStoriesBarState();
}

class _DialektikStoriesBarState extends State<DialektikStoriesBar> {
  List<ContradictionDto> contrasts = [];
  List<LiveSourceDto> sources = [];
  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void didUpdateWidget(covariant DialektikStoriesBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialSources != oldWidget.initialSources &&
        widget.initialSources != null) {
      sources = widget.initialSources!;
    }
    if (widget.initialContrasts != oldWidget.initialContrasts &&
        widget.initialContrasts != null) {
      contrasts = widget.initialContrasts!;
    }
  }

  Future<void> _load() async {
    try {
      final existing = widget.initialContrasts;
      final all =
          existing ??
          (await (widget.contrastsFuture ??
                  widget.repository.listContradictions(limit: 50)))
              .items;
      if (mounted) setState(() => contrasts = all);
    } on Exception {
      /* Keep the rest of the feed usable. */
    }
    try {
      final all =
          widget.initialSources ??
          await widget.sourcesRepository?.listLiveSources();
      if (mounted && all != null) setState(() => sources = all);
    } on Exception {
      /* Source stories are optional. */
    }
  }

  @override
  Widget build(BuildContext context) {
    if (contrasts.isEmpty && sources.isEmpty) return const SizedBox.shrink();
    final scale = MediaQuery.textScalerOf(context).scale(1).clamp(1.0, 1.6);
    return SizedBox(
      height: 82 + 28 * scale,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          for (final item in contrasts)
            _StoryCircle(
              label: item.eventTitle,
              gradient: DialektikSocialTheme.storyGradient,
              monogram: 'VS',
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) =>
                      _StoryViewer(repository: widget.repository, item: item),
                ),
              ),
            ),
          for (final source in sources)
            _StoryCircle(
              label: source.name.replaceAll('(YouTube)', '').trim(),
              gradient: DialektikSocialTheme.sourceGradient,
              monogram: _initials(source.name),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => MediaPublicProfileScreen(
                    source: source,
                    repository: widget.sourcesRepository!,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

String _initials(String name) => name
    .split(RegExp(r'\s+'))
    .where((s) => s.isNotEmpty)
    .take(2)
    .map((s) => s.characters.first.toUpperCase())
    .join();

class _StoryCircle extends StatelessWidget {
  const _StoryCircle({
    required this.label,
    required this.gradient,
    required this.monogram,
    required this.onTap,
  });
  final String label, monogram;
  final Gradient gradient;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => SizedBox(
    width: 78,
    child: InkWell(
      onTap: onTap,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 66,
            height: 66,
            padding: const EdgeInsets.all(3),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: gradient,
            ),
            child: CircleAvatar(
              backgroundColor: DialektikSocialTheme.navy,
              child: Text(
                monogram,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12),
          ),
        ],
      ),
    ),
  );
}

class _StoryViewer extends StatefulWidget {
  const _StoryViewer({required this.repository, required this.item});
  final ConsumerRepository repository;
  final ContradictionDto item;
  @override
  State<_StoryViewer> createState() => _StoryViewerState();
}

class _StoryViewerState extends State<_StoryViewer> {
  late Future<EventDetailDto> detail = widget.repository.getEvent(
    widget.item.eventId,
  );
  final page = PageController();
  int index = 0;
  @override
  void dispose() {
    page.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xff0b1320),
    body: SafeArea(
      child: FutureBuilder<EventDetailDto>(
        future: detail,
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return Center(
              child: TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('No se pudo cargar la historia · Cerrar'),
              ),
            );
          }
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final event = snapshot.data!;
          final positions = event.coveragePositions
              .where(
                (p) =>
                    p.id == widget.item.positionA.id ||
                    p.id == widget.item.positionB.id,
              )
              .toList();
          final pages = positions.length + 1;
          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    for (var i = 0; i < pages; i++)
                      Expanded(
                        child: Container(
                          margin: const EdgeInsets.symmetric(horizontal: 2),
                          height: 3,
                          color: i <= index ? Colors.white : Colors.white30,
                        ),
                      ),
                  ],
                ),
              ),
              Row(
                children: [
                  const SizedBox(width: 12),
                  const CircleAvatar(
                    backgroundColor: DialektikSocialTheme.navy,
                    child: Text('VS', style: TextStyle(color: Colors.white)),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      event.titleDescriptive,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close, color: Colors.white),
                  ),
                ],
              ),
              Expanded(
                child: Stack(
                  children: [
                    PageView(
                      controller: page,
                      onPageChanged: (i) => setState(() => index = i),
                      children: [
                        for (final p in positions)
                          Center(
                            child: SingleChildScrollView(
                              padding: const EdgeInsets.all(24),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    p.assertions.isEmpty
                                        ? 'Medio no disponible'
                                        : p.assertions.first.sourceName,
                                    style: const TextStyle(
                                      color: Color(0xffd4a359),
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                  const SizedBox(height: 20),
                                  Text(
                                    p.assertions.isEmpty
                                        ? p.title
                                        : '“${p.assertions.first.quotedText}”',
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontFamily: 'Merriweather',
                                      fontSize: 24,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        SingleChildScrollView(
                          padding: const EdgeInsets.all(24),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Container(
                                padding: const EdgeInsets.all(14),
                                decoration: BoxDecoration(
                                  color: DialektikSocialTheme.paper,
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: DialecticalThread(
                                  event: event,
                                  positions: positions,
                                  relation: event.synthesisRelation,
                                ),
                              ),
                              const SizedBox(height: 16),
                              const Text(
                                'Noticias originales',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 22,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              const SizedBox(height: 12),
                              for (final a in event.articles)
                                TextButton(
                                  onPressed: () =>
                                      unawaited(openExternalHttpLink(a.url)),
                                  child: Text(
                                    '${a.sourceName} · Abrir noticia ↗',
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    if (index > 0)
                      Positioned(
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: 28,
                        child: GestureDetector(
                          behavior: HitTestBehavior.translucent,
                          onTap: () => page.previousPage(
                            duration: const Duration(milliseconds: 200),
                            curve: Curves.easeOut,
                          ),
                        ),
                      ),
                    if (index < pages - 1)
                      Positioned(
                        right: 0,
                        top: 0,
                        bottom: 0,
                        width: 28,
                        child: GestureDetector(
                          behavior: HitTestBehavior.translucent,
                          onTap: () => page.nextPage(
                            duration: const Duration(milliseconds: 200),
                            curve: Curves.easeOut,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  TextButton(
                    onPressed: index > 0
                        ? () => page.previousPage(
                            duration: const Duration(milliseconds: 200),
                            curve: Curves.easeOut,
                          )
                        : null,
                    child: const Text('Anterior'),
                  ),
                  TextButton(
                    onPressed: index < pages - 1
                        ? () => page.nextPage(
                            duration: const Duration(milliseconds: 200),
                            curve: Curves.easeOut,
                          )
                        : null,
                    child: const Text('Siguiente'),
                  ),
                ],
              ),
            ],
          );
        },
      ),
    ),
  );
}
