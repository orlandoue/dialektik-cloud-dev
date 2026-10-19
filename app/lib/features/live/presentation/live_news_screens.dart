import 'dart:async';

import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/consumer/presentation/widgets/horizontal_choice_strip.dart';
import 'package:dialektik/features/live/data/candidate_source_registry.dart';
import 'package:dialektik/features/live/data/govuk_preview.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/live/presentation/live_components.dart';
import 'package:dialektik/features/semantic/presentation/editorial_components.dart';
import 'package:dialektik/features/semantic/presentation/editorial_vocabulary.dart';
import 'package:flutter/material.dart';

// dialektik:epistemic-component

enum LiveDateFilter { all, today, yesterday, week }

typedef LiveClock = DateTime Function();

(DateTime?, DateTime?) liveDateBounds(LiveDateFilter filter, DateTime now) {
  final DateTime local = now.toLocal();
  final DateTime today = DateTime(local.year, local.month, local.day);
  final DateTime tomorrow = DateTime(local.year, local.month, local.day + 1);
  return switch (filter) {
    LiveDateFilter.all => (null, null),
    LiveDateFilter.today => (today.toUtc(), tomorrow.toUtc()),
    LiveDateFilter.yesterday => (
      DateTime(local.year, local.month, local.day - 1).toUtc(),
      today.toUtc(),
    ),
    LiveDateFilter.week => (
      DateTime(local.year, local.month, local.day - 6).toUtc(),
      tomorrow.toUtc(),
    ),
  };
}

final class LiveNewsScreen extends StatefulWidget {
  const LiveNewsScreen({
    required this.repository,
    required this.onOpenArticle,
    this.initialSourceId,
    this.govUkPreviewLoader,
    this.clock = DateTime.now,
    this.navigationActions = const <Widget>[],
    super.key,
  });
  final LiveNewsRepository repository;
  final ValueChanged<String> onOpenArticle;
  final String? initialSourceId;
  final GovUkPreviewLoader? govUkPreviewLoader;
  final LiveClock clock;
  final List<Widget> navigationActions;
  @override
  State<LiveNewsScreen> createState() => _LiveNewsScreenState();
}

final class _LiveNewsScreenState extends State<LiveNewsScreen> {
  Future<GovUkPreview>? _govUkPreviewFuture;
  final TextEditingController _query = TextEditingController();
  PublicRequestToken? _newsToken;
  PublicRequestToken? _sourceToken;
  Timer? _debounce;
  List<LiveNewsItemDto> _items = <LiveNewsItemDto>[];
  List<LiveSourceDto> _sources = <LiveSourceDto>[];
  String? _sourceId;
  LiveDateFilter _date = LiveDateFilter.all;
  String? _nextCursor;
  bool _loading = true;
  bool _addingPage = false;
  bool _sourceError = false;
  bool _filtersExpanded = false;
  Object? _error;
  Object? _moreError;
  bool get _hasFilters =>
      _query.text.trim().isNotEmpty ||
      _sourceId != null ||
      _date != LiveDateFilter.all;
  @override
  void initState() {
    super.initState();
    _sourceId = widget.initialSourceId;
    _govUkPreviewFuture = widget.govUkPreviewLoader?.call(refresh: true);
    unawaited(_loadSources());
    unawaited(_load());
  }

  @override
  void dispose() {
    _newsToken?.cancel();
    _sourceToken?.cancel();
    _debounce?.cancel();
    _query.dispose();
    super.dispose();
  }

  Future<void> _loadSources() async {
    _sourceToken?.cancel();
    final PublicRequestToken token = PublicRequestToken();
    _sourceToken = token;
    try {
      final List<LiveSourceDto> sources = await widget.repository
          .listLiveSources(requestToken: token);
      if (!mounted || token.isCancelled) return;
      setState(() {
        _sources = List<LiveSourceDto>.of(sources)
          ..sort(
            (LiveSourceDto a, LiveSourceDto b) =>
                a.name.toLowerCase().compareTo(b.name.toLowerCase()),
          );
        _sourceError = false;
      });
    } on Exception {
      if (mounted && !token.isCancelled) setState(() => _sourceError = true);
    }
  }

  Future<void> _load({bool append = false, bool refresh = false}) async {
    if (append && (_addingPage || _nextCursor == null)) return;
    _newsToken?.cancel();
    final PublicRequestToken token = PublicRequestToken();
    _newsToken = token;
    final String? cursor = append ? _nextCursor : null;
    final (DateTime?, DateTime?) bounds = liveDateBounds(_date, widget.clock());
    final String query = _query.text.trim();
    setState(() {
      _error = null;
      _moreError = null;
      if (append) {
        _addingPage = true;
      } else {
        _items = <LiveNewsItemDto>[];
        _nextCursor = null;
        _loading = true;
        _addingPage = false;
      }
    });
    try {
      final LiveNewsPageDto page = await widget.repository.listLiveNews(
        cursor: cursor,
        query: query.isEmpty ? null : query,
        sourceId: _sourceId,
        publishedFrom: bounds.$1,
        publishedTo: bounds.$2,
        refresh: refresh,
        requestToken: token,
      );
      if (!mounted || token.isCancelled) return;
      if (cursor != null && page.nextCursor == cursor) {
        throw const PublicApiFailure(kind: PublicFailureKind.invalidResponse);
      }
      setState(() {
        if (append) {
          final Set<String> existing = _items
              .map((LiveNewsItemDto item) => item.id)
              .toSet();
          _items = <LiveNewsItemDto>[
            ..._items,
            ...page.items.where(
              (LiveNewsItemDto item) => existing.add(item.id),
            ),
          ];
        } else {
          _items = page.items;
        }
        _nextCursor = page.nextCursor;
        _loading = false;
        _addingPage = false;
      });
    } on Exception catch (error) {
      if (!mounted || token.isCancelled) return;
      setState(() {
        if (append) {
          _moreError = error;
        } else {
          _error = error;
        }
        _loading = false;
        _addingPage = false;
      });
    }
  }

  void _queryChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(
      const Duration(milliseconds: 300),
      () => unawaited(_load()),
    );
  }

  void _clearFilters() {
    _debounce?.cancel();
    _query.clear();
    _sourceId = null;
    _date = LiveDateFilter.all;
    unawaited(_load());
  }

  Widget _sourceFilter() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: <Widget>[
      const Text('Fuentes'),
      const SizedBox(height: DialektikSpacing.space2),
      HorizontalChoiceStrip<String>(
        semanticsLabel: 'Filtrar por fuente',
        allLabel: 'Todas',
        selectedValue: _sourceId,
        keyPrefix: 'live-source-filter',
        options: <HorizontalChoiceOption<String>>[
          if (_sourceId != null &&
              !_sources.any((LiveSourceDto source) => source.id == _sourceId))
            HorizontalChoiceOption<String>(
              value: _sourceId!,
              label: 'Fuente seleccionada',
            ),
          for (final LiveSourceDto source in _sources)
            HorizontalChoiceOption<String>(
              value: source.id,
              label: source.name,
            ),
        ],
        onSelected: (String? value) {
          _debounce?.cancel();
          _sourceId = value;
          unawaited(_load());
        },
      ),
    ],
  );

  Widget _dateFilter() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: <Widget>[
      const Text('Fecha de publicación'),
      const SizedBox(height: DialektikSpacing.space2),
      HorizontalChoiceStrip<LiveDateFilter>(
        semanticsLabel: 'Filtrar por fecha de publicación',
        allLabel: 'Todas',
        selectedValue: _date == LiveDateFilter.all ? null : _date,
        keyPrefix: 'live-date-filter',
        options: const <HorizontalChoiceOption<LiveDateFilter>>[
          HorizontalChoiceOption<LiveDateFilter>(
            value: LiveDateFilter.today,
            label: 'Hoy',
          ),
          HorizontalChoiceOption<LiveDateFilter>(
            value: LiveDateFilter.yesterday,
            label: 'Ayer',
          ),
          HorizontalChoiceOption<LiveDateFilter>(
            value: LiveDateFilter.week,
            label: 'Últimos 7 días',
          ),
        ],
        onSelected: (LiveDateFilter? value) {
          _debounce?.cancel();
          _date = value ?? LiveDateFilter.all;
          unawaited(_load());
        },
      ),
    ],
  );

  @override
  Widget build(BuildContext context) {
    return LiveReaderScaffold(
      title: 'Noticias recientes',
      isRoot: true,
      scrollKey: const PageStorageKey<String>('live-news'),
      navigationActions: widget.navigationActions,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Titulares oficiales con enlace al medio de origen.'),
          if (widget.govUkPreviewLoader != null) ...<Widget>[
            const SizedBox(height: DialektikSpacing.space4),
            Card(
              key: const Key('govuk-official-preview'),
              child: Padding(
                padding: const EdgeInsets.all(DialektikSpacing.space4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        const Icon(Icons.verified_outlined, size: 20),
                        const SizedBox(width: DialektikSpacing.space2),
                        Expanded(
                          child: Text(
                            'Noticias oficiales · GOV.UK',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                        ),
                        IconButton(
                          tooltip: 'Actualizar publicaciones oficiales',
                          onPressed: () => setState(() {
                            _govUkPreviewFuture = widget.govUkPreviewLoader!
                                .call(refresh: true);
                          }),
                          icon: const Icon(Icons.refresh),
                        ),
                      ],
                    ),
                    Text(
                      'Vista previa en vivo · Solo titulares y enlaces. No guardados ni analizados por Dialektik.',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    const SizedBox(height: DialektikSpacing.space2),
                    FutureBuilder<GovUkPreview>(
                      future: _govUkPreviewFuture,
                      builder:
                          (
                            BuildContext context,
                            AsyncSnapshot<GovUkPreview> snapshot,
                          ) {
                            if (snapshot.connectionState !=
                                ConnectionState.done) {
                              return const Padding(
                                padding: EdgeInsets.symmetric(vertical: 12),
                                child: LinearProgressIndicator(),
                              );
                            }
                            if (snapshot.hasError || !snapshot.hasData) {
                              return TextButton.icon(
                                onPressed: () => setState(() {
                                  _govUkPreviewFuture = widget
                                      .govUkPreviewLoader!
                                      .call(refresh: true);
                                }),
                                icon: const Icon(Icons.refresh),
                                label: const Text(
                                  'Reintentar consulta oficial',
                                ),
                              );
                            }
                            final List<GovUkPreviewItem> items =
                                snapshot.data!.items;
                            return Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                Text(
                                  '${items.length} publicaciones verificadas · Regulator of Social Housing',
                                  style: Theme.of(
                                    context,
                                  ).textTheme.labelMedium,
                                ),
                                for (final GovUkPreviewItem article
                                    in items) ...<Widget>[
                                  const Divider(height: 14),
                                  ListTile(
                                    contentPadding: EdgeInsets.zero,
                                    dense: true,
                                    title: Text(
                                      article.headline,
                                      style: Theme.of(
                                        context,
                                      ).textTheme.titleSmall,
                                    ),
                                    subtitle: Text(
                                      'Publicado ${article.publishedAt.toLocal().day}/${article.publishedAt.toLocal().month}/${article.publishedAt.toLocal().year} · Abrir fuente',
                                    ),
                                    trailing: const Icon(
                                      Icons.open_in_new,
                                      size: 18,
                                    ),
                                    onTap: () => unawaited(
                                      openExternalHttpLink(
                                        article.canonicalUrl,
                                      ),
                                    ),
                                  ),
                                ],
                                const SizedBox(height: DialektikSpacing.space2),
                                Text(
                                  items.first.attribution,
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                              ],
                            );
                          },
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: DialektikSpacing.space4),
            Text(
              'Artículos incorporados a Dialektik',
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ],
          const SizedBox(height: DialektikSpacing.space4),
          Row(
            children: <Widget>[
              Expanded(
                child: TextField(
                  controller: _query,
                  onChanged: _queryChanged,
                  decoration: const InputDecoration(
                    prefixIcon: Icon(Icons.search),
                    labelText: 'Buscar titulares',
                  ),
                ),
              ),
              IconButton(
                tooltip: 'Actualizar noticias',
                onPressed: () {
                  _debounce?.cancel();
                  unawaited(_load(refresh: true));
                },
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
          if (_hasFilters)
            Align(
              alignment: Alignment.centerLeft,
              child: EditorialTextButton(
                onPressed: _clearFilters,
                child: const Text('Limpiar filtros'),
              ),
            ),
          LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) {
              final bool compact = constraints.maxWidth < 640;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  if (compact)
                    TextButton.icon(
                      onPressed: () =>
                          setState(() => _filtersExpanded = !_filtersExpanded),
                      icon: Icon(
                        _filtersExpanded ? Icons.expand_less : Icons.tune,
                      ),
                      label: Text(
                        _filtersExpanded ? 'Ocultar filtros' : 'Filtros',
                      ),
                    ),
                  if (!compact || _filtersExpanded) ...<Widget>[
                    const SizedBox(height: DialektikSpacing.space4),
                    LayoutBuilder(
                      key: const Key('live-search-filters-panel'),
                      builder:
                          (BuildContext context, BoxConstraints constraints) {
                            final bool wide =
                                constraints.maxWidth >=
                                    EditorialLayout.storyWideMinimum &&
                                MediaQuery.textScalerOf(context).scale(
                                      DialektikTypography.publicBodyMinimum,
                                    ) <=
                                    EditorialLayout.maxTwoColumnTextSize;
                            return wide
                                ? Row(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: <Widget>[
                                      Expanded(child: _sourceFilter()),
                                      const SizedBox(
                                        width: DialektikSpacing.space6,
                                      ),
                                      Expanded(child: _dateFilter()),
                                    ],
                                  )
                                : Column(
                                    children: <Widget>[
                                      _sourceFilter(),
                                      const SizedBox(
                                        height: DialektikSpacing.space4,
                                      ),
                                      _dateFilter(),
                                    ],
                                  );
                          },
                    ),
                  ],
                ],
              );
            },
          ),
          if (_sourceError)
            EditorialTextButton(
              onPressed: () => unawaited(_loadSources()),
              child: const Text('Reintentar la lista de fuentes'),
            ),
          const SizedBox(height: DialektikSpacing.space4),
          Semantics(
            child: Text(
              'Más recientes por fecha de publicación.',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: context.surfaceColors.muted,
              ),
            ),
          ),
          const SizedBox(height: DialektikSpacing.space3),
          if (_loading)
            const EditorialLoading(label: 'Cargando noticias…')
          else if (_error != null)
            EditorialEmptyState(
              title: liveFailureTitle(
                _error,
                notFoundTitle: 'El servicio de noticias no está disponible.',
              ),
              action: EditorialTextButton(
                onPressed: () => unawaited(_load(refresh: true)),
                child: const Text('Reintentar'),
              ),
            )
          else if (_items.isEmpty)
            EditorialEmptyState(
              title: _hasFilters
                  ? 'No hay noticias con estos filtros.'
                  : 'Todavía no hay noticias guardadas.',
              description: _hasFilters
                  ? 'Puedes ampliar la búsqueda o cambiar la fuente y la fecha.'
                  : 'Las publicaciones aparecerán aquí cuando estén disponibles.',
              action: _hasFilters
                  ? EditorialTextButton(
                      onPressed: _clearFilters,
                      child: const Text('Limpiar filtros'),
                    )
                  : null,
            )
          else ...<Widget>[
            LiveLeadCard(
              article: _items.first,
              onPressed: () => widget.onOpenArticle(_items.first.id),
            ),
            if (_items.length > 1) ...<Widget>[
              const SizedBox(height: EditorialLayout.sectionGap),
              Semantics(
                header: true,
                child: Text(
                  'Más noticias',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              const SizedBox(height: DialektikSpacing.space4),
              LayoutBuilder(
                builder: (BuildContext context, BoxConstraints constraints) {
                  final bool twoColumns =
                      constraints.maxWidth >= 920 &&
                      MediaQuery.textScalerOf(context).scale(16) <= 20;
                  final double cardWidth = twoColumns
                      ? (constraints.maxWidth - EditorialLayout.cardGap) / 2
                      : constraints.maxWidth;
                  return Wrap(
                    spacing: EditorialLayout.cardGap,
                    runSpacing: EditorialLayout.cardGap,
                    children: <Widget>[
                      for (final LiveNewsItemDto article in _items.skip(1))
                        SizedBox(
                          width: cardWidth,
                          child: LiveNewsCard(
                            article: article,
                            onPressed: () => widget.onOpenArticle(article.id),
                          ),
                        ),
                    ],
                  );
                },
              ),
            ],
            const SizedBox(height: EditorialLayout.cardGap),
            Text(
              editorialCount(
                _items.length,
                'noticia visible',
                'noticias visibles',
              ),
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: context.surfaceColors.muted,
              ),
            ),
            if (_addingPage)
              const EditorialLoading(label: 'Cargando más noticias…'),
            if (_moreError != null)
              const Text(
                'No pudimos cargar más noticias. Las anteriores siguen disponibles.',
              ),
            if (_nextCursor != null && !_addingPage)
              EditorialTextButton(
                onPressed: () => unawaited(_load(append: true)),
                child: Text(
                  _moreError == null
                      ? 'Ver más noticias'
                      : 'Reintentar más noticias',
                ),
              ),
          ],
        ],
      ),
    );
  }
}

final class LiveSourceListScreen extends StatefulWidget {
  const LiveSourceListScreen({
    required this.repository,
    required this.onOpenSource,
    this.navigationActions = const <Widget>[],
    super.key,
  });

  final LiveNewsRepository repository;
  final ValueChanged<String> onOpenSource;
  final List<Widget> navigationActions;

  @override
  State<LiveSourceListScreen> createState() => _LiveSourceListScreenState();
}

final class _LiveSourceListScreenState extends State<LiveSourceListScreen> {
  List<LiveSourceDto> _sources = <LiveSourceDto>[];
  List<CandidateSourceInfo> _candidates = <CandidateSourceInfo>[];
  final TextEditingController _candidateSearch = TextEditingController();
  Object? _error;
  Object? _candidateError;
  bool _loading = true;
  bool _candidatesLoading = true;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
    unawaited(_loadCandidates());
  }

  @override
  void dispose() {
    _candidateSearch.dispose();
    super.dispose();
  }

  Future<void> _loadCandidates() async {
    try {
      final List<CandidateSourceInfo> candidates =
          await CandidateSourceRegistry.load();
      if (!mounted) return;
      setState(() {
        _candidates = candidates;
        _candidateError = null;
        _candidatesLoading = false;
      });
    } on Exception catch (error) {
      if (!mounted) return;
      setState(() {
        _candidateError = error;
        _candidatesLoading = false;
      });
    }
  }

  Future<void> _load({bool refresh = false}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final List<LiveSourceDto> sources = await widget.repository
          .listLiveSources(refresh: refresh);
      if (!mounted) return;
      setState(() {
        _sources = List<LiveSourceDto>.of(sources)
          ..sort(
            (LiveSourceDto a, LiveSourceDto b) =>
                a.name.toLowerCase().compareTo(b.name.toLowerCase()),
          );
        _loading = false;
      });
    } on Exception catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) => LiveReaderScaffold(
    title: 'Fuentes',
    location: 'Fuentes',
    isRoot: true,
    navigationActions: widget.navigationActions,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const Text('Consulta quién publica cada noticia y su sitio original.'),
        const SizedBox(height: DialektikSpacing.space6),
        SectionHeading(title: 'Fuentes operativas · ${_sources.length}'),
        EditorialTextButton(
          onPressed: () => unawaited(_load(refresh: true)),
          child: const Text('Actualizar fuentes'),
        ),
        const SizedBox(height: EditorialLayout.sectionGap),
        if (_loading)
          const EditorialLoading(label: 'Cargando fuentes…')
        else if (_error != null)
          EditorialEmptyState(
            title: liveFailureTitle(
              _error,
              notFoundTitle: 'El servicio de fuentes no está disponible.',
            ),
            action: EditorialTextButton(
              onPressed: () => unawaited(_load(refresh: true)),
              child: const Text('Reintentar'),
            ),
          )
        else if (_sources.isEmpty)
          const EditorialEmptyState(
            title: 'Todavía no hay fuentes operativas.',
            description: 'No se han activado fuentes de noticias para la beta.',
          )
        else ...<Widget>[
          for (final LiveSourceDto source in _sources) ...<Widget>[
            EditorialActionCard(
              onTap: () => widget.onOpenSource(source.id),
              semanticLabel:
                  'Consultar fuente ${source.name}, ${source.canonicalDomain}',
              child: SourceIdentity(
                name: source.name,
                domain: source.canonicalDomain,
                publisherType: liveSourceType(source.sourceType),
                header: true,
                stacked: false,
              ),
            ),
            const SizedBox(height: EditorialLayout.cardGap),
          ],
        ],
        const SizedBox(height: EditorialLayout.sectionGap),
        SectionHeading(title: 'Candidatas · ${_candidates.length}'),
        const SizedBox(height: DialektikSpacing.space2),
        const Text(
          'Este catálogo conserva los 50 medios revisados. Son propuestas de conexión: no se consultan ni se adquieren noticias y sus permisos siguen sin acreditar.',
        ),
        const SizedBox(height: DialektikSpacing.space4),
        TextField(
          controller: _candidateSearch,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(
            labelText: 'Buscar medio, región o categoría',
            prefixIcon: Icon(Icons.search),
          ),
        ),
        const SizedBox(height: DialektikSpacing.space3),
        if (_candidatesLoading)
          const EditorialLoading(label: 'Cargando catálogo de fuentes…')
        else if (_candidateError != null)
          const EditorialEmptyState(
            title: 'No se pudo cargar el catálogo de candidatas.',
            description: 'El catálogo local no modifica las fuentes activas.',
          )
        else ...<Widget>[
          for (final CandidateSourceInfo candidate in _filteredCandidates)
            ExpansionTile(
              key: PageStorageKey<String>('source-candidate-${candidate.id}'),
              title: Text(candidate.name),
              subtitle: Text('${candidate.domain} · ${candidate.region}'),
              childrenPadding: const EdgeInsets.fromLTRB(
                DialektikSpacing.space4,
                0,
                DialektikSpacing.space4,
                DialektikSpacing.space3,
              ),
              children: <Widget>[
                LiveDetailLine('Categoría', candidate.category),
                LiveDetailLine(
                  'Conectores posibles',
                  candidate.connectorCandidates.isEmpty
                      ? 'Por investigar'
                      : candidate.connectorCandidates.join(' · '),
                ),
                LiveDetailLine(
                  'Nota técnica del inventario',
                  candidate.technicalState,
                ),
                LiveDetailLine(
                  'Revalidación técnica actual',
                  candidate.currentTechnicalState == 'NOT_RECHECKED'
                      ? 'Pendiente'
                      : candidate.currentTechnicalState,
                ),
                LiveDetailLine(
                  'Revisión de términos',
                  candidateRightsReviewLabel(
                    candidate.currentRightsReviewState,
                  ),
                ),
                LiveDetailLine(
                  'Alcance de derechos',
                  candidate.currentRightsSummary,
                ),
                LiveDetailLine('Derechos por operación', candidate.rightsState),
                for (final MapEntry<String, String> operation
                    in candidate.currentRightsOperations.entries)
                  LiveDetailLine(
                    candidateRightsOperationLabel(operation.key),
                    candidateRightsOperationStateLabel(operation.value),
                  ),
                LiveDetailLine(
                  'Integración',
                  candidate.operationalState == 'NOT_VALIDATED'
                      ? 'No validada'
                      : candidate.operationalState,
                ),
                LiveDetailLine(
                  'Autorización de adquisición',
                  candidate.acquisitionAuthorizationState == 'NOT_AUTHORIZED'
                      ? 'No autorizada; desactivada'
                      : candidate.acquisitionAuthorizationState,
                ),
              ],
            ),
        ],
      ],
    ),
  );

  List<CandidateSourceInfo> get _filteredCandidates {
    final String query = _candidateSearch.text.trim().toLowerCase();
    if (query.isEmpty) return _candidates;
    return _candidates
        .where(
          (CandidateSourceInfo candidate) =>
              candidate.name.toLowerCase().contains(query) ||
              candidate.domain.toLowerCase().contains(query) ||
              candidate.region.toLowerCase().contains(query) ||
              candidate.category.toLowerCase().contains(query),
        )
        .toList(growable: false);
  }
}

final class LiveLeadCard extends StatelessWidget {
  const LiveLeadCard({
    required this.article,
    required this.onPressed,
    super.key,
  });

  final LiveNewsItemDto article;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label:
        'Abrir noticia más reciente: ${article.headline}. ${article.source.name}. Publicada ${liveLocalDate(article.publishedAt)}',
    child: Material(
      color: DialektikColors.nocturne,
      borderRadius: DialektikRadii.mediumBorderRadius,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onPressed,
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) {
              final bool wide = constraints.maxWidth >= 640;
              final Widget copy = Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    'MÁS RECIENTE',
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                      color: DialektikColors.nocturneText,
                      letterSpacing: 0.7,
                    ),
                  ),
                  const SizedBox(height: DialektikSpacing.space4),
                  Text(
                    article.headline,
                    style: DialektikTypography.editorialHeading(
                      color: DialektikColors.nocturneText,
                      size: wide ? 34 : 29,
                    ),
                  ),
                  const SizedBox(height: DialektikSpacing.space6),
                  Text(
                    '${article.source.name}  ·  ${liveLocalDate(article.publishedAt)}',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: DialektikColors.nocturneMuted,
                    ),
                  ),
                ],
              );
              return Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: <Widget>[
                  Expanded(child: copy),
                  const SizedBox(width: DialektikSpacing.space4),
                  const Icon(
                    Icons.arrow_forward,
                    color: DialektikColors.nocturneText,
                  ),
                ],
              );
            },
          ),
        ),
      ),
    ),
  );
}

String candidateRightsReviewLabel(String status) => switch (status) {
  'OFFICIAL_NEWS_REUSE_POLICY_NOT_LOCATED_IN_TARGETED_SEARCH' =>
    'Búsqueda dirigida; sin política de reutilización localizada',
  'TERMS_FOUND_BUT_SCOPE_DOES_NOT_COVER_NEWS' =>
    'Documento encontrado; no cubre noticias',
  'RESTRICTIONS_FOUND_PERMISSION_REQUIRED' =>
    'Términos con permiso previo requerido',
  'SUBSCRIPTION_TERMS_ONLY' => 'Condiciones de suscripción; alcance parcial',
  'LIMITED_PERSONAL_USE_ONLY' => 'Uso personal limitado',
  'HISTORICAL_LICENSE_NOT_CURRENTLY_VERIFIED' =>
    'Licencia histórica; vigencia no confirmada',
  'RIGHTS_RESERVED_NO_REUSE_GRANT_FOUND' =>
    'Derechos reservados; permiso de reutilización no acreditado',
  'ARTICLE_SPECIFIC_EXCEPTION_NOT_APPLICABLE' =>
    'Excepción limitada a un artículo; no aplicable al piloto',
  'ATTRIBUTION_CONDITIONED_USE_AUTOMATION_UNRESOLVED' =>
    'Uso condicionado a atribución; automatización sin resolver',
  'CONFLICTING_LICENSE_AND_AUTOMATION_TERMS' =>
    'Licencia y condiciones de acceso en conflicto',
  'TERMS_FOUND_APP_SCOPE_UNCLEAR_FOR_NEWS_SITE' =>
    'Términos de aplicación; alcance web sin confirmar',
  'PERSONAL_PRIVATE_NONCOMMERCIAL_ACCESS_ONLY' =>
    'Acceso personal, privado y no comercial',
  'WRITTEN_PERMISSION_REQUIRED' => 'Requiere autorización escrita previa',
  'TERMS_LOCATED_SCOPE_REQUIRES_REVIEW' =>
    'Términos localizados; alcance de reutilización sin confirmar',
  'CITATION_ONLY_SCOPE_REQUIRES_PERMISSION_FOR_PIPELINE' =>
    'Cita con enlace; permiso para el pipeline sin acreditar',
  'PRIVATE_RSS_READER_ONLY_NO_SEMANTIC_OR_EXTERNAL_AI' =>
    'Alcance registrado: lector RSS privado; sin procesamiento semántico',
  'TERMS_FOUND_FOR_SEPARATE_PAID_PUBLICATION_PLATFORM' =>
    'Términos de otra plataforma; alcance noticioso sin confirmar',
  _ => 'Permisos por verificar',
};

String candidateRightsOperationLabel(String operation) => switch (operation) {
  'automatedConsultation' => 'Consulta automatizada',
  'metadataPersistence' => 'Persistencia de metadatos',
  'headlineExcerptDisplay' => 'Titulares y extractos',
  'automatedProcessing' => 'Procesamiento automatizado',
  'localSemanticInference' => 'Inferencia semántica local',
  'externalAiProcessing' => 'Procesamiento con IA externa',
  'privateAppDisplay' => 'Visualización en app privada',
  'futureCommercialUse' => 'Uso comercial futuro',
  _ => operation,
};

String candidateRightsOperationStateLabel(String status) => switch (status) {
  'NOT_ESTABLISHED' => 'No establecido',
  'PRIOR_WRITTEN_PERMISSION_REQUIRED' => 'Requiere autorización escrita previa',
  'LIMITED_PERSONAL_NONCOMMERCIAL_ONLY' =>
    'Solo uso personal no comercial; integración no autorizada',
  'CONDITIONAL_ATTRIBUTION_AND_AUTHORSHIP' =>
    'Condicionado a atribución y verificación de autoría',
  'CONFLICTING_TERMS_REQUIRES_CLARIFICATION' =>
    'Términos en conflicto; requiere aclaración',
  'THIRD_PARTY_CONTENT_EXCLUDED' => 'Contenido de terceros excluido',
  'ARTICLE_SPECIFIC_EXCEPTION_NOT_APPLICABLE' =>
    'Excepción de artículo no aplicable al piloto',
  'SCOPE_DOES_NOT_COVER_NEWS_CONTENT' => 'El alcance no cubre noticias',
  'HISTORICAL_LICENSE_NOT_CURRENTLY_VERIFIED' =>
    'Licencia histórica sin vigencia confirmada',
  'OWNER_RECORDED_PRIVATE_RSS_READER_ONLY' =>
    'Lector RSS privado; no autoriza otros usos',
  'PROHIBITED_AUTOMATED_ACCESS_WITHOUT_PERMISSION' =>
    'Acceso automatizado prohibido sin permiso',
  'CONDITIONAL_CITATION_WITH_DIRECT_LINK' =>
    'Cita condicionada a atribución y enlace directo',
  _ => 'No autorizado; verificar alcance',
};

final class LiveNewsCard extends StatelessWidget {
  const LiveNewsCard({
    required this.article,
    required this.onPressed,
    super.key,
  });
  final LiveNewsItemDto article;
  final VoidCallback onPressed;
  @override
  Widget build(BuildContext context) => EditorialActionCard(
    onTap: onPressed,
    semanticLabel:
        'Ver noticia: ${article.headline}. ${article.source.name}. Publicada ${liveLocalDate(article.publishedAt)}',
    child: LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final Widget metadata = Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              article.source.name,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: DialektikSpacing.space3),
            Text(
              liveLocalDate(article.publishedAt),
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: context.surfaceColors.muted,
              ),
            ),
            if (article.modifiedAt != null) ...<Widget>[
              const SizedBox(height: DialektikSpacing.space3),
              Text('Actualizada · ${liveLocalDate(article.modifiedAt!)}'),
            ],
          ],
        );
        final Widget headline = Text(
          article.headline,
          style: DialektikTypography.editorialHeading(
            color: DialektikColors.inkBlack,
            size: 22,
          ),
        );
        final bool wide =
            constraints.maxWidth >= EditorialLayout.storyWideMinimum &&
            MediaQuery.textScalerOf(
                  context,
                ).scale(DialektikTypography.publicBodyMinimum) <=
                EditorialLayout.maxTwoColumnTextSize;
        return wide
            ? Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  SizedBox(
                    width: EditorialLayout.publisherRailWidth,
                    child: metadata,
                  ),
                  const SizedBox(width: DialektikSpacing.space6),
                  Expanded(child: headline),
                ],
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  headline,
                  const SizedBox(height: DialektikSpacing.space6),
                  metadata,
                ],
              );
      },
    ),
  );
}

final class LiveArticleScreen extends StatelessWidget {
  const LiveArticleScreen({
    required this.articleId,
    required this.repository,
    required this.externalLinkOpener,
    required this.onOpenSource,
    required this.onOpenProvenance,
    this.navigationActions = const <Widget>[],
    super.key,
  });
  final String articleId;
  final LiveNewsRepository repository;
  final ExternalLinkOpener externalLinkOpener;
  final ValueChanged<String> onOpenSource;
  final ValueChanged<String> onOpenProvenance;
  final List<Widget> navigationActions;
  @override
  Widget build(BuildContext context) => LiveReader<LiveNewsDetailDto>(
    title: 'Noticia',
    notFoundTitle: 'Esta noticia ya no está disponible.',
    location: 'Noticia',
    navigationActions: navigationActions,
    identity: (repository, articleId),
    titleOf: (LiveNewsDetailDto data) => data.article.headline,
    load: (PublicRequestToken token, bool refresh) => repository.getLiveNews(
      articleId,
      refresh: refresh,
      requestToken: token,
    ),
    content: (BuildContext context, LiveNewsDetailDto data) {
      final LiveNewsItemDto article = data.article;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          LiveSourceLink(
            source: article.source,
            onPressed: () => onOpenSource(article.source.id),
          ),
          const SizedBox(height: DialektikSpacing.space3),
          Text('Publicado · ${liveLocalDate(article.publishedAt)}'),
          if (article.modifiedAt != null)
            Text('Actualizado · ${liveLocalDate(article.modifiedAt!)}'),
          if (data.author != null) Text('Autoría · ${data.author!}'),
          const SizedBox(height: DialektikSpacing.space6),
          LiveExternalAction(
            uri: article.canonicalUrl,
            opener: externalLinkOpener,
          ),
          const SizedBox(height: EditorialLayout.sectionGap),
          ConstrainedBox(
            constraints: const BoxConstraints(
              maxWidth: EditorialLayout.readerMaxWidth,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                if (data.content.representation == 'feed_excerpt' &&
                    data.content.storagePolicy != 'METADATA_ONLY' &&
                    data.content.text != null) ...<Widget>[
                  const SectionHeading(
                    title: 'Extracto de la fuente',
                    subtitle: 'Disponible para leer en Dialektik',
                  ),
                  Semantics(
                    label: 'Extracto publicado por ${article.source.name}',
                    child: Text(
                      data.content.text!,
                      style: Theme.of(context).textTheme.bodyLarge,
                    ),
                  ),
                  const SizedBox(height: DialektikSpacing.space6),
                  const Text('El artículo completo se lee en la fuente.'),
                ] else
                  const EditorialEmptyState(
                    title: 'El contenido se lee en la fuente.',
                    description:
                        'En Dialektik puedes consultar el titular, la publicación y su procedencia.',
                  ),
                if (data.declaredUpstream != null) ...<Widget>[
                  const SizedBox(height: DialektikSpacing.space6),
                  LiveDetailLine(
                    'Crédito declarado en la publicación',
                    data.declaredUpstream,
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: EditorialLayout.sectionGap),
          const LiveUnassignedContext(),
          const SizedBox(height: DialektikSpacing.space6),
          EditorialTextButton(
            onPressed: () => onOpenProvenance(article.id),
            child: const Text('Consultar procedencia'),
          ),
          LiveTechnicalDetails(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                LiveDetailLine('Noticia', article.id),
                LiveDetailLine('Fuente', article.source.id),
                LiveDetailLine(
                  'Publicación exacta',
                  liveExactDate(article.publishedAt),
                ),
                if (article.modifiedAt != null)
                  LiveDetailLine(
                    'Actualización exacta',
                    liveExactDate(article.modifiedAt!),
                  ),
                LiveDetailLine('URL canónica', article.canonicalUrl.toString()),
                LiveDetailLine(
                  'Contenido disponible',
                  data.content.storagePolicy,
                ),
                LiveDetailLine(
                  'Versiones conservadas',
                  article.versionCount.toString(),
                ),
              ],
            ),
          ),
        ],
      );
    },
  );
}

final class LiveSourceScreen extends StatelessWidget {
  const LiveSourceScreen({
    required this.sourceId,
    required this.repository,
    required this.externalLinkOpener,
    required this.onOpenSourceNews,
    this.navigationActions = const <Widget>[],
    super.key,
  });
  final String sourceId;
  final LiveNewsRepository repository;
  final ExternalLinkOpener externalLinkOpener;
  final ValueChanged<String> onOpenSourceNews;
  final List<Widget> navigationActions;
  @override
  Widget build(BuildContext context) => LiveReader<LiveSourceDetailDto>(
    title: 'Fuente',
    notFoundTitle: 'Esta fuente ya no está disponible.',
    location: 'Fuente',
    navigationActions: navigationActions,
    identity: (repository, sourceId),
    titleOf: (LiveSourceDetailDto data) => data.source.name,
    load: (PublicRequestToken token, bool refresh) => repository.getLiveSource(
      sourceId,
      refresh: refresh,
      requestToken: token,
    ),
    content: (BuildContext context, LiveSourceDetailDto data) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        DialektikSurface(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              SourceIdentity(
                name: data.source.name,
                domain: data.source.canonicalDomain,
                publisherType: liveSourceType(data.source.sourceType),
                header: true,
                stacked: false,
                showName: false,
              ),
              if (data.source.category != null) ...<Widget>[
                const SizedBox(height: DialektikSpacing.space3),
                Text('Categoría de la fuente · ${data.source.category!}'),
              ],
              if (data.source.publisherFamily != null) ...<Widget>[
                const SizedBox(height: DialektikSpacing.space3),
                Text('Grupo editor · ${data.source.publisherFamily!}'),
              ],
              const SizedBox(height: DialektikSpacing.space4),
              Text(data.attribution),
            ],
          ),
        ),
        const SizedBox(height: EditorialLayout.cardGap),
        DialektikSurface(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                'Alcance del contenido',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: DialektikSpacing.space3),
              Text(
                data.storagePolicy == 'METADATA_ONLY'
                    ? 'Solo metadatos: titular, publicación y enlace original.'
                    : 'El contenido disponible se limita a lo permitido para esta fuente.',
              ),
            ],
          ),
        ),
        const SizedBox(height: DialektikSpacing.space4),
        Wrap(
          spacing: DialektikSpacing.space3,
          runSpacing: DialektikSpacing.space2,
          children: <Widget>[
            OutlinedButton.icon(
              onPressed: () => onOpenSourceNews(sourceId),
              icon: const Icon(Icons.article_outlined),
              label: const Text('Ver noticias'),
            ),
            LiveExternalAction(
              uri: Uri.https(data.source.canonicalDomain, '/'),
              opener: externalLinkOpener,
              label: 'Abrir sitio de la fuente',
            ),
          ],
        ),
        LiveTechnicalDetails(
          title: 'Adquisición y derechos',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              LiveDetailLine('Fuente', sourceId),
              LiveDetailLine(
                'Canal de adquisición',
                liveAcquisitionChannel(data.discoveryChannel),
              ),
              LiveDetailLine(
                'Dirección del canal',
                data.discoveryUrl.toString(),
              ),
              LiveDetailLine('Contenido conservado', data.storagePolicy),
              LiveExternalAction(
                uri: data.rightsEvidenceUrl,
                opener: externalLinkOpener,
                label: 'Consultar condiciones de la fuente',
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

final class _ProvenanceReading {
  const _ProvenanceReading(this.article, this.provenance);
  final LiveNewsDetailDto article;
  final LiveProvenanceDto provenance;
}

final class LiveProvenanceScreen extends StatelessWidget {
  const LiveProvenanceScreen({
    required this.articleId,
    required this.repository,
    required this.externalLinkOpener,
    required this.onOpenSource,
    this.navigationActions = const <Widget>[],
    super.key,
  });
  final String articleId;
  final LiveNewsRepository repository;
  final ExternalLinkOpener externalLinkOpener;
  final ValueChanged<String> onOpenSource;
  final List<Widget> navigationActions;
  @override
  Widget build(BuildContext context) => LiveReader<_ProvenanceReading>(
    title: 'Procedencia',
    notFoundTitle: 'La procedencia de esta noticia no está disponible.',
    location: 'Procedencia',
    navigationActions: navigationActions,
    identity: (repository, articleId, 'provenance'),
    load: (PublicRequestToken token, bool refresh) async {
      final List<Object> data = await Future.wait<Object>(<Future<Object>>[
        repository.getLiveNews(
          articleId,
          refresh: refresh,
          requestToken: token,
        ),
        repository.getLiveProvenance(
          articleId,
          refresh: refresh,
          requestToken: token,
        ),
      ]);
      return _ProvenanceReading(
        data[0] as LiveNewsDetailDto,
        data[1] as LiveProvenanceDto,
      );
    },
    content: (BuildContext context, _ProvenanceReading reading) {
      final LiveNewsItemDto article = reading.article.article;
      final LiveProvenanceDto provenance = reading.provenance;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(article.headline, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: DialektikSpacing.space6),
          LiveSourceLink(
            source: article.source,
            onPressed: () => onOpenSource(article.source.id),
          ),
          const SizedBox(height: EditorialLayout.sectionGap),
          const SectionHeading(title: 'Publicación y adquisición'),
          LiveDetailLine(
            'Publicado por la fuente',
            liveLocalDate(article.publishedAt),
          ),
          if (article.modifiedAt != null)
            LiveDetailLine(
              'Actualizado por la fuente',
              liveLocalDate(article.modifiedAt!),
            ),
          LiveDetailLine(
            'Visto por primera vez en Dialektik',
            liveLocalDate(provenance.firstSeenAt),
          ),
          LiveDetailLine(
            'Canal de adquisición',
            liveAcquisitionChannel(provenance.discoveryChannel),
          ),
          LiveExternalAction(
            uri: article.canonicalUrl,
            opener: externalLinkOpener,
          ),
          LiveTechnicalDetails(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                LiveDetailLine('URL canónica', article.canonicalUrl.toString()),
                LiveDetailLine(
                  'Publicación exacta',
                  liveExactDate(article.publishedAt),
                ),
                if (article.modifiedAt != null)
                  LiveDetailLine(
                    'Actualización exacta',
                    liveExactDate(article.modifiedAt!),
                  ),
                LiveDetailLine(
                  'Fecha original de publicación',
                  provenance.originalPublishedAt,
                ),
                LiveDetailLine(
                  'Fecha original de actualización',
                  provenance.originalModifiedAt,
                ),
                LiveDetailLine(
                  'Primera adquisición exacta',
                  liveExactDate(provenance.firstSeenAt),
                ),
                LiveDetailLine(
                  'Última observación exacta',
                  liveExactDate(provenance.lastSeenAt),
                ),
                LiveDetailLine(
                  'Dirección del canal',
                  provenance.discoveryUrl.toString(),
                ),
                LiveDetailLine(
                  'Identificador de la fuente',
                  provenance.sourceItemId,
                ),
                LiveDetailLine(
                  'Versión del adaptador',
                  provenance.adapterVersion,
                ),
                LiveDetailLine(
                  'Recibos de adquisición',
                  provenance.receiptCount.toString(),
                ),
                LiveDetailLine(
                  'Registro de exposición',
                  'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2',
                ),
                LiveExternalAction(
                  uri: provenance.rightsEvidenceUrl,
                  opener: externalLinkOpener,
                  label: 'Consultar condiciones de la fuente',
                ),
              ],
            ),
          ),
        ],
      );
    },
  );
}
