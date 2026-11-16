import 'dart:async';
import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/semantic/data/semantic_models.dart';
import 'package:dialektik/features/semantic/data/semantic_repository.dart';
import 'package:dialektik/features/semantic/presentation/editorial_components.dart';
import 'package:dialektik/features/semantic/presentation/editorial_vocabulary.dart';
import 'package:dialektik/features/semantic/presentation/story_context_card.dart';
import 'package:flutter/material.dart';
export 'semantic_evidence_screens.dart';
// dialektik:epistemic-component

final class _Reader<T> extends StatefulWidget {
  const _Reader({
    required this.identity,
    required this.title,
    required this.load,
    required this.content,
    this.loadedTitle,
    this.eyebrow,
    this.isRoot = false,
    this.actions,
  });
  final Object identity;
  final String title;
  final Future<T> Function() load;
  final Widget Function(BuildContext, T) content;
  final String Function(T)? loadedTitle;
  final String? eyebrow;
  final bool isRoot;
  final List<Widget>? actions;
  @override
  State<_Reader<T>> createState() => _ReaderState<T>();
}

final class _ReaderState<T> extends State<_Reader<T>> {
  late Future<T> _future = _load();
  Future<T> _load() {
    final Future<T> future = widget.load();
    future.ignore();
    return future;
  }

  @override
  void didUpdateWidget(covariant _Reader<T> old) {
    super.didUpdateWidget(old);
    if (old.identity != widget.identity) {
      _future = _load();
    }
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<T>(
    future: _future,
    builder: (BuildContext context, AsyncSnapshot<T> snapshot) {
      final bool ready = snapshot.connectionState == ConnectionState.done;
      return EditorialScaffold(
        title: ready && snapshot.hasData
            ? widget.loadedTitle?.call(snapshot.data as T) ?? widget.title
            : widget.title,
        eyebrow: widget.eyebrow,
        scrollKey: PageStorageKey<Object>(widget.identity),
        isRoot: widget.isRoot,
        actions: widget.actions,
        child: !ready
            ? const EditorialLoading()
            : snapshot.hasError
            ? EditorialEmptyState(
                title:
                    snapshot.error is PublicApiFailure &&
                        (snapshot.error! as PublicApiFailure).kind ==
                            PublicFailureKind.notFound
                    ? 'Este contenido no está disponible.'
                    : 'No pudimos cargar este contenido.',
                description:
                    'Puedes volver a intentarlo o regresar a Historias.',
                action: Wrap(
                  spacing: DialektikSpacing.space6,
                  children: <Widget>[
                    EditorialTextButton(
                      onPressed: () {
                        final Future<T> next = _load();
                        setState(() {
                          _future = next;
                        });
                      },
                      child: const Text('Reintentar'),
                    ),
                    EditorialTextButton(
                      onPressed: () =>
                          Navigator.of(context).pushNamed('/threads'),
                      child: const Text('Ir a Historias'),
                    ),
                  ],
                ),
              )
            : widget.content(context, snapshot.data as T),
      );
    },
  );
}

final class SemanticDecisionLabel extends StatelessWidget {
  const SemanticDecisionLabel({
    required this.decision,
    required this.applicability,
    super.key,
  });
  final SemanticDecision decision;
  final SemanticApplicability applicability;
  @override
  Widget build(BuildContext context) => Text(
    '${editorialDecisionLabel(decision)} · ${editorialApplicabilityLabel(applicability)}',
    style: Theme.of(context).textTheme.bodyMedium,
  );
}

String _coverage(int a, int s) =>
    '${editorialCount(a, 'noticia', 'noticias')} · ${editorialCount(s, 'fuente', 'fuentes')}';
String _span(SemanticThreadDto s) {
  final String a = editorialDate(s.firstObserved, relative: false);
  final String b = editorialDate(s.lastObserved, relative: false);
  return a == b ? a : '$a — $b';
}

String _searchText(String v) => v
    .toLowerCase()
    .replaceAll('á', 'a')
    .replaceAll('é', 'e')
    .replaceAll('í', 'i')
    .replaceAll('ó', 'o')
    .replaceAll('ú', 'u')
    .replaceAll('ü', 'u');

final class ThreadsScreen extends StatelessWidget {
  const ThreadsScreen({
    required this.repository,
    required this.onOpenThread,
    required this.onOpenFeed,
    this.cursor,
    super.key,
  });
  final SemanticRepository repository;
  final ValueChanged<String> onOpenThread;
  final VoidCallback onOpenFeed;
  final String? cursor;
  @override
  Widget build(BuildContext context) => _Reader<SemanticThreadPageDto>(
    identity: (repository, cursor),
    title: 'Historias',
    isRoot: true,
    actions: <Widget>[
      EditorialTextButton(
        onPressed: onOpenFeed,
        child: const Text('Explorar eventos'),
      ),
    ],
    load: () => repository.listSemanticThreads(
      cursor: cursor,
      limit: 25,
      refresh: true,
    ),
    content: (BuildContext context, SemanticThreadPageDto page) => _StoriesList(
      key: ValueKey<String>(cursor ?? 'first-page'),
      page: page,
      onOpenThread: onOpenThread,
    ),
  );
}

final class _StoriesList extends StatefulWidget {
  const _StoriesList({
    required this.page,
    required this.onOpenThread,
    super.key,
  });
  final SemanticThreadPageDto page;
  final ValueChanged<String> onOpenThread;
  @override
  State<_StoriesList> createState() => _StoriesListState();
}

final class _StoriesListState extends State<_StoriesList> {
  final TextEditingController _search = TextEditingController();
  String _query = '';
  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _clear() => setState(() {
    _search.clear();
    _query = '';
  });
  @override
  Widget build(BuildContext context) {
    final List<SemanticThreadDto> results = widget.page.items
        .where(
          (SemanticThreadDto s) => _searchText(
            '${s.title} ${s.summary}',
          ).contains(_searchText(_query.trim())),
        )
        .toList(growable: false);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          'Una historia, varios eventos. Sigue cómo evoluciona.',
          style: Theme.of(context).textTheme.bodyLarge,
        ),
        const SizedBox(height: DialektikSpacing.space6),
        ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: EditorialLayout.readerMaxWidth,
          ),
          child: TextField(
            controller: _search,
            minLines: 1,
            maxLines: null,
            keyboardType: TextInputType.text,
            textInputAction: TextInputAction.search,
            onChanged: (String v) => setState(() => _query = v),
            decoration: InputDecoration(
              labelText: 'Buscar historias',
              helperText: 'Busca por título o descripción en esta página.',
              helperMaxLines: 4,
              suffixIcon: _query.isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'Limpiar búsqueda',
                      onPressed: _clear,
                      icon: const DialektikIcon(
                        icon: DialektikFunctionalIcon.close,
                      ),
                    ),
            ),
          ),
        ),
        const SizedBox(height: DialektikSpacing.space8),
        if (widget.page.items.isEmpty)
          const EditorialEmptyState(
            title: 'Todavía no hay historias.',
            description: 'Cuando una historia esté disponible, aparecerá aquí.',
          )
        else if (results.isEmpty)
          EditorialEmptyState(
            title: 'No encontramos historias con esa búsqueda.',
            description: 'Prueba con otra palabra o vuelve a ver todas.',
            action: EditorialTextButton(
              onPressed: _clear,
              child: const Text('Ver todas las historias'),
            ),
          ),
        for (final SemanticThreadDto story in results) ...<Widget>[
          StoryCard(story: story, onOpen: () => widget.onOpenThread(story.id)),
          const SizedBox(height: EditorialLayout.cardGap),
        ],
        if (widget.page.nextCursor != null)
          EditorialTextButton(
            onPressed: () => Navigator.of(context).pushNamed(
              '/threads?cursor=${Uri.encodeQueryComponent(widget.page.nextCursor!)}',
            ),
            child: const Text('Ver más historias'),
          ),
      ],
    );
  }
}

final class StoryCard extends StatelessWidget {
  const StoryCard({required this.story, required this.onOpen, super.key});
  final SemanticThreadDto story;
  final VoidCallback onOpen;
  @override
  Widget build(BuildContext context) {
    final String? locality = editorialLocality(story.title);
    return EditorialActionCard(
      onTap: onOpen,
      semanticLabel:
          'Abrir historia: ${editorialTitle(story.title)}. '
          '${locality == null ? '' : '$locality. '}'
          '${editorialDecisionLabel(story.state.decision)}. ${editorialApplicabilityLabel(story.state.applicability)}. '
          '${story.state.description}. ${editorialCount(story.occurrenceCount, 'evento', 'eventos')}. '
          '${editorialCount(story.sourceCount, 'fuente', 'fuentes')}. ${_span(story)}',
      child: LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final Widget identity = Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              if (locality != null) ...<Widget>[
                Text(locality),
                const SizedBox(height: DialektikSpacing.space3),
              ],
              Text(
                editorialTitle(story.title),
                style: Theme.of(context).textTheme.headlineSmall,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: DialektikSpacing.space4),
              SemanticStatusLabel(state: story.state),
              if (story.state.decision == SemanticDecision.unknown) ...<Widget>[
                const SizedBox(height: DialektikSpacing.space3),
                const Text('Relación sin resolver'),
              ],
            ],
          );
          final Widget inventory = _StoryInventory(story: story);
          if (constraints.maxWidth >= EditorialLayout.storyWideMinimum &&
              MediaQuery.textScalerOf(context).scale(16) <=
                  EditorialLayout.maxTwoColumnTextSize) {
            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(child: identity),
                const SizedBox(width: DialektikSpacing.space8),
                SizedBox(
                  width: EditorialLayout.storyMetadataWidth,
                  child: inventory,
                ),
              ],
            );
          }
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              identity,
              const SizedBox(height: DialektikSpacing.space6),
              inventory,
            ],
          );
        },
      ),
    );
  }
}

final class _StoryInventory extends StatelessWidget {
  const _StoryInventory({required this.story});
  final SemanticThreadDto story;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: <Widget>[
      Text('Observado · ${_span(story)}'),
      const SizedBox(height: DialektikSpacing.space3),
      // This line marks an observed span only; it never invents Event positions.
      ExcludeSemantics(
        child: SizedBox(
          height: 12,
          width: 120,
          child: CustomPaint(
            painter: _ObservedSpan(
              color: context.epistemicColors.muted,
              single: story.occurrenceCount <= 1,
            ),
          ),
        ),
      ),
      const SizedBox(height: DialektikSpacing.space3),
      Wrap(
        spacing: DialektikSpacing.space6,
        runSpacing: DialektikSpacing.space3,
        children: <Widget>[
          Text(editorialCount(story.occurrenceCount, 'evento', 'eventos')),
          Text(editorialCount(story.sourceCount, 'fuente', 'fuentes')),
        ],
      ),
    ],
  );
}

final class _ObservedSpan extends CustomPainter {
  const _ObservedSpan({required this.color, required this.single});
  final Color color;
  final bool single;
  @override
  void paint(Canvas canvas, Size size) {
    final Paint paint = Paint()
      ..color = color
      ..strokeWidth = DialektikBorders.hairlineWidth;
    if (single) {
      canvas.drawCircle(Offset(4, size.height / 2), 3, paint);
      return;
    }
    canvas.drawLine(
      Offset(4, size.height / 2),
      Offset(size.width - 4, size.height / 2),
      paint,
    );
    canvas.drawCircle(Offset(4, size.height / 2), 3, paint);
    canvas.drawCircle(Offset(size.width - 4, size.height / 2), 3, paint);
  }

  @override
  bool shouldRepaint(covariant _ObservedSpan old) =>
      color != old.color || single != old.single;
}

final class _StorySummary extends StatefulWidget {
  const _StorySummary({required this.summary, super.key});
  final String summary;
  @override
  State<_StorySummary> createState() => _StorySummaryState();
}

final class _StorySummaryState extends State<_StorySummary> {
  bool _expanded = false;
  @override
  Widget build(BuildContext context) {
    final bool long = widget.summary.length > 500;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          widget.summary,
          style: Theme.of(context).textTheme.bodyLarge,
          maxLines: long && !_expanded ? 4 : null,
          overflow: long && !_expanded ? TextOverflow.ellipsis : null,
        ),
        if (long)
          Semantics(
            expanded: _expanded,
            child: EditorialTextButton(
              onPressed: () => setState(() => _expanded = !_expanded),
              child: Text(
                _expanded
                    ? 'Ocultar descripción completa'
                    : 'Leer descripción completa',
              ),
            ),
          ),
      ],
    );
  }
}

final class ThreadDetailScreen extends StatelessWidget {
  const ThreadDetailScreen({
    required this.threadId,
    required this.repository,
    required this.onOpenOccurrence,
    required this.onOpenArticle,
    required this.onOpenSource,
    required this.onOpenProvenance,
    super.key,
  });
  final String threadId;
  final SemanticRepository repository;
  final ValueChanged<String> onOpenOccurrence,
      onOpenArticle,
      onOpenSource,
      onOpenProvenance;
  @override
  Widget build(BuildContext context) => _Reader<SemanticThreadDetailDto>(
    identity: (repository, threadId),
    title: 'Historia',
    eyebrow: 'Historia',
    loadedTitle: (SemanticThreadDetailDto d) => editorialTitle(d.thread.title),
    load: () => repository.getSemanticThread(threadId, refresh: true),
    content: (BuildContext context, SemanticThreadDetailDto d) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        if (editorialLocality(d.thread.title) case final String locality)
          Text(locality),
        ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: EditorialLayout.readerMaxWidth,
          ),
          child: _StorySummary(
            key: ValueKey<String>(d.thread.id),
            summary: editorialSummary(d.thread.summary),
          ),
        ),
        const SizedBox(height: DialektikSpacing.space6),
        SemanticStatusLabel(state: d.thread.state),
        _CurrentState(state: d.thread.state),
        const SizedBox(height: DialektikSpacing.space6),
        Wrap(
          spacing: DialektikSpacing.space8,
          runSpacing: DialektikSpacing.space3,
          children: <Widget>[
            Text(editorialCount(d.thread.occurrenceCount, 'evento', 'eventos')),
            Text(editorialCount(d.thread.sourceCount, 'fuente', 'fuentes')),
            Text('Observado · ${_span(d.thread)}'),
          ],
        ),
        if (d.thread.state.decision == SemanticDecision.unknown) ...<Widget>[
          const SizedBox(height: DialektikSpacing.space8),
          const UnknownRelationshipCard(),
        ],
        SectionHeading(
          title: 'Cómo evoluciona',
          subtitle:
              d.occurrences.any((SemanticOccurrenceDto o) => o.eventAt == null)
              ? 'Eventos conocidos · fechas pendientes de determinar'
              : 'Eventos en orden cronológico',
        ),
        _StoryReadingColumns(
          timeline: StoryTimeline(
            key: ValueKey<String>(d.thread.id),
            occurrences: d.occurrences,
            onOpen: onOpenOccurrence,
          ),
          sources: SourceCollection(
            sources: d.sources,
            onOpenSource: onOpenSource,
          ),
        ),
        if (d.relations.any(
          (SemanticRelationDto r) => r.decision == SemanticDecision.unknown,
        ))
          _Relations(
            relations: d.relations
                .where(
                  (SemanticRelationDto r) =>
                      r.decision == SemanticDecision.unknown,
                )
                .toList(),
            onOpenOccurrence: onOpenOccurrence,
            onOpenProvenance: onOpenProvenance,
          ),
        _History(detail: d, onOpenProvenance: onOpenProvenance),
      ],
    ),
  );
}

/// A continuous neutral spine communicates time, never evidence strength.
final class StoryTimeline extends StatefulWidget {
  const StoryTimeline({
    required this.occurrences,
    required this.onOpen,
    super.key,
  });
  final List<SemanticOccurrenceDto> occurrences;
  final ValueChanged<String> onOpen;
  @override
  State<StoryTimeline> createState() => _StoryTimelineState();
}

final class _StoryTimelineState extends State<StoryTimeline> {
  int _visible = EditorialLayout.timelineBatchSize;
  final Map<String, GlobalKey> _anchors = <String, GlobalKey>{};

  String _day(SemanticOccurrenceDto occurrence) => occurrence.eventAt == null
      ? 'Fecha sin determinar'
      : editorialDate(occurrence.eventAt!, relative: false);

  void _jump(String? id) {
    if (id == null) return;
    final int index = widget.occurrences.indexWhere(
      (SemanticOccurrenceDto occurrence) => occurrence.id == id,
    );
    setState(() {
      if (index >= _visible) _visible = index + 1;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final BuildContext? target = _anchors[id]?.currentContext;
      if (target != null && mounted) {
        Scrollable.ensureVisible(target, alignment: 0.05);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final List<SemanticOccurrenceDto> occurrences = widget.occurrences;
    final Map<String, String> days = <String, String>{};
    for (final SemanticOccurrenceDto occurrence in occurrences) {
      days.putIfAbsent(_day(occurrence), () => occurrence.id);
    }
    final int count = _visible.clamp(0, occurrences.length);
    return occurrences.isEmpty
        ? const EditorialEmptyState(
            title: 'Todavía no hay eventos en esta historia.',
          )
        : Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              if (occurrences.length >
                  EditorialLayout.timelineBatchSize) ...<Widget>[
                Text('Mostrando $count de ${occurrences.length} eventos'),
                const SizedBox(height: DialektikSpacing.space4),
                DropdownButtonFormField<String>(
                  itemHeight: null,
                  isDense: false,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    labelText: 'Ir a una fecha',
                  ),
                  items: <DropdownMenuItem<String>>[
                    for (final MapEntry<String, String> day in days.entries)
                      DropdownMenuItem<String>(
                        value: day.value,
                        child: Text(day.key),
                      ),
                  ],
                  onChanged: _jump,
                ),
                const SizedBox(height: DialektikSpacing.space6),
              ],
              for (final (int i, SemanticOccurrenceDto o)
                  in occurrences.take(count).indexed) ...<Widget>[
                if (i == 0 || _day(occurrences[i - 1]) != _day(o))
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      vertical: DialektikSpacing.space4,
                    ),
                    child: Semantics(
                      header: true,
                      child: Text(
                        _day(o),
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                  ),
                CustomPaint(
                  key: _anchors.putIfAbsent(o.id, GlobalKey.new),
                  painter: _Spine(
                    color: context.epistemicColors.muted,
                    first: i == 0,
                    last: i == occurrences.length - 1,
                  ),
                  child: Padding(
                    padding: const EdgeInsets.only(
                      left: EditorialLayout.timelineContentInset,
                    ),
                    child: Padding(
                      padding: const EdgeInsets.only(
                        bottom: EditorialLayout.timelineNodeGap,
                      ),
                      child: EditorialActionCard(
                        outlined: false,
                        onTap: () => widget.onOpen(o.id),
                        semanticLabel:
                            'Evento ${i + 1} de ${occurrences.length}. ${editorialTitle(o.title)}. '
                            '${o.eventAt == null ? 'Fecha sin determinar' : editorialDate(o.eventAt!, includeTime: true)}. '
                            '${o.state.description}. ${editorialDecisionLabel(o.state.decision)}. '
                            '${editorialApplicabilityLabel(o.state.applicability)}. '
                            '${_coverage(o.articleCount, o.sourceCount)}',
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text('Evento ${i + 1} de ${occurrences.length}'),
                            const SizedBox(height: DialektikSpacing.space3),
                            Text(
                              o.eventAt == null
                                  ? 'Fecha sin determinar'
                                  : editorialDate(
                                      o.eventAt!,
                                      includeTime: true,
                                    ),
                            ),
                            const SizedBox(height: DialektikSpacing.space3),
                            Text(
                              editorialTitle(o.title),
                              style: Theme.of(context).textTheme.titleLarge,
                            ),
                            const SizedBox(height: DialektikSpacing.space3),
                            SemanticStatusLabel(state: o.state),
                            const SizedBox(height: DialektikSpacing.space6),
                            Text(_coverage(o.articleCount, o.sourceCount)),
                            if (o.state.decision == SemanticDecision.unknown)
                              const Text('Relación sin resolver'),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ],
              if (count < occurrences.length)
                EditorialTextButton(
                  onPressed: () => setState(
                    () => _visible += EditorialLayout.timelineBatchSize,
                  ),
                  child: Text(
                    'Ver más eventos · ${occurrences.length - count} restantes',
                  ),
                ),
            ],
          );
  }
}

/// The reading column stays narrow; publisher identities use the secondary space.
final class _StoryReadingColumns extends StatelessWidget {
  const _StoryReadingColumns({required this.timeline, required this.sources});
  final Widget timeline, sources;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (BuildContext context, BoxConstraints constraints) {
      final Widget publishers = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const SectionHeading(title: 'Fuentes de esta historia'),
          sources,
        ],
      );
      if (constraints.maxWidth >= EditorialLayout.detailWideMinimum &&
          MediaQuery.textScalerOf(context).scale(16) <=
              EditorialLayout.maxTwoColumnTextSize) {
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(child: timeline),
            const SizedBox(width: DialektikSpacing.space8),
            SizedBox(
              width: EditorialLayout.publisherRailWidth,
              child: publishers,
            ),
          ],
        );
      }
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[timeline, publishers],
      );
    },
  );
}

/// Disclosure bounds the rendered coverage while preserving Core's order.
final class _EventCoverage extends StatefulWidget {
  const _EventCoverage({
    required this.occurrence,
    required this.onOpenArticle,
    required this.onOpenSource,
    required this.onOpenProvenance,
    super.key,
  });
  final SemanticOccurrenceDto occurrence;
  final ValueChanged<String> onOpenArticle, onOpenSource, onOpenProvenance;
  @override
  State<_EventCoverage> createState() => _EventCoverageState();
}

final class _EventCoverageState extends State<_EventCoverage> {
  int _visible = EditorialLayout.coverageBatchSize;
  String? _sourceId;
  @override
  Widget build(BuildContext context) {
    final List<SemanticArticleDto> articles = widget.occurrence.articles
        .where(
          (SemanticArticleDto article) =>
              _sourceId == null || article.source.id == _sourceId,
        )
        .toList(growable: false);
    final int count = _visible.clamp(0, articles.length);
    final Map<String, List<SemanticProvenanceDto>> evidence =
        <String, List<SemanticProvenanceDto>>{};
    for (final SemanticProvenanceDto item in widget.occurrence.provenance) {
      evidence
          .putIfAbsent(item.article.id, () => <SemanticProvenanceDto>[])
          .add(item);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        if (widget.occurrence.articles.length >
            EditorialLayout.coverageBatchSize) ...<Widget>[
          DropdownButtonFormField<String>(
            itemHeight: null,
            isDense: false,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Noticias por fuente'),
            items: <DropdownMenuItem<String>>[
              const DropdownMenuItem<String>(
                value: '',
                child: Text('Todas las fuentes'),
              ),
              for (final SemanticSourceDto source in widget.occurrence.sources)
                DropdownMenuItem<String>(
                  value: source.id,
                  child: Text(
                    editorialSourceName(source.name),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
            ],
            onChanged: (String? id) => setState(() {
              _sourceId = id == '' ? null : id;
              _visible = EditorialLayout.coverageBatchSize;
            }),
          ),
          const SizedBox(height: DialektikSpacing.space6),
          Text('Mostrando $count de ${articles.length} noticias'),
          const SizedBox(height: DialektikSpacing.space6),
        ],
        if (articles.isEmpty)
          const EditorialEmptyState(
            title: 'Todavía no hay noticias para este evento.',
          ),
        for (final SemanticArticleDto article in articles.take(count))
          _CoverageArticle(
            key: ValueKey<String>('news-${article.id}'),
            article: article,
            provenance: evidence[article.id] ?? const <SemanticProvenanceDto>[],
            onOpenArticle: widget.onOpenArticle,
            onOpenSource: widget.onOpenSource,
            onOpenProvenance: widget.onOpenProvenance,
          ),
        if (count < articles.length)
          EditorialTextButton(
            onPressed: () =>
                setState(() => _visible += EditorialLayout.coverageBatchSize),
            child: Text(
              'Ver más noticias · ${articles.length - count} restantes',
            ),
          ),
      ],
    );
  }
}

final class _Spine extends CustomPainter {
  const _Spine({required this.color, required this.first, required this.last});
  final Color color;
  final bool first, last;
  @override
  void paint(Canvas canvas, Size size) {
    final double x = EditorialLayout.timelineSpineInset,
        y = DialektikSpacing.space6 + DialektikSpacing.space4;
    final Paint paint = Paint()
      ..color = color
      ..strokeWidth = EditorialLayout.timelineStrokeWidth;
    canvas.drawLine(
      Offset(x, first ? y : 0),
      Offset(x, last ? y : size.height),
      paint,
    );
    canvas.drawCircle(Offset(x, y), EditorialLayout.timelineNodeRadius, paint);
  }

  @override
  bool shouldRepaint(covariant _Spine old) =>
      color != old.color || first != old.first || last != old.last;
}

final class OccurrenceDetailScreen extends StatelessWidget {
  const OccurrenceDetailScreen({
    required this.occurrenceId,
    required this.repository,
    required this.onOpenThread,
    required this.onOpenOccurrence,
    required this.onOpenArticle,
    required this.onOpenSource,
    required this.onOpenProvenance,
    super.key,
  });
  final String occurrenceId;
  final SemanticRepository repository;
  final ValueChanged<String> onOpenThread,
      onOpenOccurrence,
      onOpenArticle,
      onOpenSource,
      onOpenProvenance;
  Future<(SemanticOccurrenceDto, SemanticThreadDetailDto)> _load() async {
    final SemanticOccurrenceDto o = await repository.getSemanticOccurrence(
      occurrenceId,
      refresh: true,
    );
    return (o, await repository.getSemanticThread(o.threadId, refresh: true));
  }

  @override
  Widget build(
    BuildContext context,
  ) => _Reader<(SemanticOccurrenceDto, SemanticThreadDetailDto)>(
    identity: (repository, occurrenceId),
    title: 'Evento',
    eyebrow: 'Evento',
    loadedTitle: ((SemanticOccurrenceDto, SemanticThreadDetailDto) d) =>
        editorialTitle(d.$1.title),
    load: _load,
    content:
        (
          BuildContext context,
          (SemanticOccurrenceDto, SemanticThreadDetailDto) d,
        ) {
          final SemanticOccurrenceDto o = d.$1;
          final List<SemanticOccurrenceDto> sequence = d.$2.occurrences;
          final int index = sequence.indexWhere(
            (SemanticOccurrenceDto item) => item.id == o.id,
          );
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                o.eventAt == null
                    ? 'Fecha del evento sin determinar'
                    : editorialDate(o.eventAt!, includeTime: true),
              ),
              const SizedBox(height: DialektikSpacing.space6),
              SemanticStatusLabel(state: o.state),
              _CurrentState(state: o.state),
              const SizedBox(height: DialektikSpacing.space6),
              EditorialTextButton(
                onPressed: () => onOpenThread(o.threadId),
                child: Text('Historia · ${editorialTitle(o.threadTitle)}'),
              ),
              if (o.state.decision == SemanticDecision.unknown) ...<Widget>[
                const SizedBox(height: DialektikSpacing.space6),
                const UnknownRelationshipCard(),
              ],
              SectionHeading(
                title: 'Cobertura',
                subtitle: _coverage(o.articleCount, o.sourceCount),
              ),
              _EventCoverage(
                key: ValueKey<String>(o.id),
                occurrence: o,
                onOpenArticle: onOpenArticle,
                onOpenSource: onOpenSource,
                onOpenProvenance: onOpenProvenance,
              ),
              const SizedBox(height: EditorialLayout.sectionGap),
              StoryContextCard(
                occurrence: o,
                thread: d.$2,
                onOpenStory: () => onOpenThread(o.threadId),
                onOpenEvent: () => onOpenOccurrence(o.id),
              ),
              if (index >= 0 &&
                  o.state.decision != SemanticDecision.unknown) ...<Widget>[
                const SectionHeading(title: 'Continúa la historia'),
                if (index > 0)
                  EditorialTextButton(
                    onPressed: () => onOpenOccurrence(sequence[index - 1].id),
                    child: Text(
                      'Evento anterior · ${editorialTitle(sequence[index - 1].title)}',
                    ),
                  ),
                if (index + 1 < sequence.length)
                  EditorialTextButton(
                    onPressed: () => onOpenOccurrence(sequence[index + 1].id),
                    child: Text(
                      'Evento siguiente · ${editorialTitle(sequence[index + 1].title)}',
                    ),
                  ),
              ],
              if (o.relations.isNotEmpty)
                _Relations(
                  relations: o.relations,
                  onOpenOccurrence: onOpenOccurrence,
                  onOpenProvenance: onOpenProvenance,
                ),
            ],
          );
        },
  );
}

final class _CoverageArticle extends StatelessWidget {
  const _CoverageArticle({
    required this.article,
    required this.provenance,
    required this.onOpenArticle,
    required this.onOpenSource,
    required this.onOpenProvenance,
    super.key,
  });
  final SemanticArticleDto article;
  final List<SemanticProvenanceDto> provenance;
  final ValueChanged<String> onOpenArticle, onOpenSource, onOpenProvenance;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: DialektikSpacing.space8),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        SourceBadge(
          source: article.source,
          compact: true,
          onPressed: () => onOpenSource(article.source.id),
        ),
        const SizedBox(height: DialektikSpacing.space3),
        EditorialActionCard(
          outlined: false,
          onTap: () => onOpenArticle(article.id),
          semanticLabel:
              'Leer noticia: ${editorialTitle(article.title)}. ${editorialSourceName(article.source.name)}. '
              '${editorialDate(article.publishedAt, includeTime: true)}',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                editorialTitle(article.title),
                style: Theme.of(context).textTheme.titleLarge,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: DialektikSpacing.space3),
              Text(editorialDate(article.publishedAt, includeTime: true)),
            ],
          ),
        ),
        for (final SemanticProvenanceDto p in provenance)
          EditorialTextButton(
            onPressed: () => onOpenProvenance(p.id),
            child: const Text('¿Por qué está aquí?'),
          ),
        const Divider(),
      ],
    ),
  );
}

final class _Relations extends StatelessWidget {
  const _Relations({
    required this.relations,
    required this.onOpenOccurrence,
    required this.onOpenProvenance,
  });
  final List<SemanticRelationDto> relations;
  final ValueChanged<String> onOpenOccurrence, onOpenProvenance;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: <Widget>[
      const SectionHeading(title: 'Relaciones entre eventos'),
      for (final SemanticRelationDto r in relations) ...<Widget>[
        if (r.decision == SemanticDecision.unknown)
          const UnknownRelationshipCard()
        else
          Text(
            r.decision == SemanticDecision.distinct
                ? 'Son eventos distintos'
                : 'Vínculo entre eventos registrado',
          ),
        const SizedBox(height: DialektikSpacing.space3),
        Text(editorialApplicabilityLabel(r.applicability)),
        EditorialTextButton(
          onPressed: () => onOpenOccurrence(r.fromOccurrenceId),
          child: Text(editorialTitle(r.fromTitle)),
        ),
        EditorialTextButton(
          onPressed: () => onOpenOccurrence(r.toOccurrenceId),
          child: Text(editorialTitle(r.toTitle)),
        ),
        EditorialTextButton(
          onPressed: () => onOpenProvenance(r.provenanceId),
          child: const Text('Ver evidencia de la relación'),
        ),
        const SizedBox(height: DialektikSpacing.space6),
      ],
    ],
  );
}

final class _CurrentState extends StatefulWidget {
  const _CurrentState({required this.state});
  final SemanticStateDto state;
  @override
  State<_CurrentState> createState() => _CurrentStateState();
}

final class _CurrentStateState extends State<_CurrentState> {
  bool _expanded = false;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: <Widget>[
      EditorialTextButton(
        onPressed: () => setState(() {
          _expanded = !_expanded;
        }),
        semanticLabel: _expanded
            ? 'Ocultar detalles del estado'
            : 'Detalles del estado',
        child: Text(
          _expanded ? 'Ocultar detalles del estado' : 'Detalles del estado',
        ),
      ),
      if (_expanded) ...<Widget>[
        SemanticDecisionLabel(
          decision: widget.state.decision,
          applicability: widget.state.applicability,
        ),
        Text(
          'Observado: ${editorialDate(widget.state.observedAt, exact: true)}',
        ),
      ],
    ],
  );
}

final class _History extends StatefulWidget {
  const _History({required this.detail, required this.onOpenProvenance});
  final SemanticThreadDetailDto detail;
  final ValueChanged<String> onOpenProvenance;
  @override
  State<_History> createState() => _HistoryState();
}

final class _HistoryState extends State<_History> {
  bool _expanded = false;
  int _visible = EditorialLayout.historyBatchSize;
  String _targetTitle(String? id) {
    for (final SemanticOccurrenceDto event in widget.detail.occurrences) {
      if (event.id == id) return editorialTitle(event.title);
    }
    return 'Evento del registro';
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: <Widget>[
      const SizedBox(height: EditorialLayout.sectionGap),
      EditorialTextButton(
        onPressed: () => setState(() => _expanded = !_expanded),
        child: Text(
          _expanded
              ? 'Ocultar historial de cambios'
              : 'Ver historial de cambios',
        ),
      ),
      if (_expanded) ...<Widget>[
        const SectionHeading(title: 'Historial de cambios'),
        for (final SemanticTransitionDto c
            in widget.detail.timeline.transitions.take(_visible)) ...<Widget>[
          Text(
            c.entityKind == 'thread'
                ? 'Historia · ${editorialTitle(widget.detail.thread.title)}'
                : 'Evento · ${_targetTitle(c.occurrenceId)}',
          ),
          Text(editorialDate(c.observedAt, includeTime: true)),
          Text(
            '${c.previousState?.description ?? 'Primer registro'} → ${c.newState.description}',
          ),
          SemanticDecisionLabel(
            decision: c.newState.decision,
            applicability: c.newState.applicability,
          ),
          EditorialTextButton(
            onPressed: () => widget.onOpenProvenance(c.provenanceId),
            child: const Text('Ver evidencia de este cambio'),
          ),
          const SizedBox(height: DialektikSpacing.space6),
        ],
        if (_visible < widget.detail.timeline.transitions.length)
          EditorialTextButton(
            onPressed: () =>
                setState(() => _visible += EditorialLayout.historyBatchSize),
            child: Text(
              'Ver más cambios · ${widget.detail.timeline.transitions.length - _visible} restantes',
            ),
          ),
      ],
    ],
  );
}
