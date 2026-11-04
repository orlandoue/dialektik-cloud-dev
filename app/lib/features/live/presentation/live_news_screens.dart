import 'dart:async';

import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/data/following_repository.dart';
import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/consumer/presentation/widgets/horizontal_choice_strip.dart';
import 'package:dialektik/features/live/data/candidate_source_registry.dart';
import 'package:dialektik/features/live/data/govuk_preview.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/live/data/publisher_market_selection.dart';
import 'package:dialektik/features/live/data/registered_source_directory.dart';
import 'package:dialektik/features/live/data/youtube_video.dart';
import 'package:dialektik/features/live/presentation/live_components.dart';
import 'package:dialektik/features/live/presentation/widgets/youtube_thumbnail.dart';
import 'package:dialektik/features/semantic/presentation/editorial_components.dart';
import 'package:dialektik/features/semantic/presentation/editorial_vocabulary.dart';
import 'package:flutter/material.dart';

// dialektik:epistemic-component

// Strict beta source allowlist for Chile, not a general geolocation engine.
const Set<String> _chileBetaPublisherDomains = <String>{
  'bcentral.cl', 'biobiochile.cl', 'sismologia.cl',
  'ciperchile.cl', 'cooperativa.cl', 'diarioeldia.cl', 'www.diarioeldia.cl', 'elmostrador.cl',
  'emol.com', 'gob.cl', 'latercera.com', 'senapred.gob.cl', 'senapred.cl', 'youtube.com',
};

bool isChileBetaPublisher(LiveSourceDto source) =>
    _chileBetaPublisherDomains.contains(source.canonicalDomain.toLowerCase());

enum LiveDateFilter { all, today, yesterday, week }
enum LiveNewsFormatFilter { all, press, videos }
enum LiveNewsTopic { politica, justicia, economia, seguridad, deportes, sociedad }

bool matchesLiveNewsTopic(LiveNewsItemDto item, LiveNewsTopic? topic) {
  if (topic == null) return true;
  final text = '${item.headline} ${item.excerpt ?? ''}'.toLowerCase();
  final pattern = switch (topic) {
    LiveNewsTopic.politica => r'polític|politic|gobierno|presidente|ministro|congreso|diputad|senador|elecci|alcald|partido republican',
    LiveNewsTopic.justicia => r'justicia|judicial|tribunal|corte|juez|jueza|fiscal|condena|acusación constitucional|acusacion constitucional|querella',
    LiveNewsTopic.economia => r'econom|inflación|inflacion|empleo|desempleo|pensión|pension|afp|banco|peso|dólar|dolar|codelco|empresa|salario|sueldo',
    LiveNewsTopic.seguridad => r'seguridad|delito|polic|carabinero|crimen|robo|asalto|homicid|detenido|balacera|siniestro',
    LiveNewsTopic.deportes => r'deporte|fútbol|futbol|tenis|partido|campeonato|selección|seleccion|liga|gol|jugador|atleta',
    LiveNewsTopic.sociedad => r'sociedad|salud|educación|educacion|colegio|escuela|vivienda|familia|niñez|ninez|cultura|mujer|medio ambiente',
  };
  return RegExp(pattern, caseSensitive: false).hasMatch(text);
}


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
    this.briefingRepository,
    this.onOpenEvent,
    this.initialSourceId,
    this.externalLinkOpener = openExternalHttpLink,
    this.govUkPreviewLoader,
    this.publisherMarketSelection,
    this.clock = DateTime.now,
    this.navigationActions = const <Widget>[],
    super.key,
  });
  final LiveNewsRepository repository;
  final ValueChanged<String> onOpenArticle;
  final ConsumerRepository? briefingRepository;
  final ValueChanged<String>? onOpenEvent;
  final String? initialSourceId;
  final ExternalLinkOpener externalLinkOpener;
  final GovUkPreviewLoader? govUkPreviewLoader;
  final PublisherMarketSelection? publisherMarketSelection;
  final LiveClock clock;
  final List<Widget> navigationActions;
  @override
  State<LiveNewsScreen> createState() => _LiveNewsScreenState();
}

final class _LiveNewsScreenState extends State<LiveNewsScreen> {
  late final Future<PublicPage<EventCardDto>>? _briefing = widget.briefingRepository?.listFeed(limit:50);
  Future<GovUkPreview>? _govUkPreviewFuture;
  final TextEditingController _query = TextEditingController();
  final ScrollController _countryScroll = ScrollController();
  PublicRequestToken? _newsToken;
  PublicRequestToken? _sourceToken;
  Timer? _debounce;
  List<LiveNewsItemDto> _items = <LiveNewsItemDto>[];
  List<LiveSourceDto> _sources = <LiveSourceDto>[];
  String? _sourceId;
  LiveDateFilter _date = LiveDateFilter.all;
  LiveNewsFormatFilter _format = LiveNewsFormatFilter.all;
  LiveNewsTopic? _topic;
  Set<String> _followed = <String>{};
  bool _allSources = false;
  FollowingRepository? get _following => widget.repository is FollowingRepository &&
      (widget.repository as FollowingRepository).followingAvailable ? widget.repository as FollowingRepository : null;
  String? _nextCursor;
  bool _loading = true;
  bool _addingPage = false;
  bool _sourceError = false;
  bool _filtersExpanded = false;
  String _selectedCountry = 'CL';
  Object? _error;
  Object? _moreError;
  bool get _hasFilters =>
      _query.text.trim().isNotEmpty ||
      _sourceId != null ||
      _date != LiveDateFilter.all ||
      _format != LiveNewsFormatFilter.all ||
      _topic != null;
  List<LiveNewsItemDto> get _visibleItems => _items
      .where((LiveNewsItemDto item) {
        if (!matchesLiveNewsTopic(item, _topic)) return false;
        final bool video =
            item.source.canonicalDomain.toLowerCase() == 'youtube.com';
        return switch (_format) {
          LiveNewsFormatFilter.all => true,
          LiveNewsFormatFilter.press => !video,
          LiveNewsFormatFilter.videos => video,
        };
      })
      .toList(growable: false);
  @override
  void initState() {
    super.initState();
    _sourceId = widget.initialSourceId;
    _selectedCountry = widget.publisherMarketSelection?.value ?? 'CL';
    widget.publisherMarketSelection?.addListener(_onMarketChanged);
    _govUkPreviewFuture = widget.govUkPreviewLoader?.call(refresh: true);
    unawaited(_loadSources());
    unawaited(_load());
    _following?.followingChanges.addListener(_onFollowingChanged);
    unawaited(_loadFollowing());
  }

  @override
  void dispose() {
    _following?.followingChanges.removeListener(_onFollowingChanged);
    widget.publisherMarketSelection?.removeListener(_onMarketChanged);
    _newsToken?.cancel();
    _sourceToken?.cancel();
    _debounce?.cancel();
    _query.dispose();
    _countryScroll.dispose();
    super.dispose();
  }

  void _onFollowingChanged() => unawaited(_loadFollowing());
  Future<void> _loadFollowing() async {
    final repository = _following;
    if (repository == null) return;
    try {
      final ids = await repository.listFollowedSources();
      if (widget.repository case final MirrorNewsMemory memory) unawaited(memory.prefetchMirrorNews());
      if (mounted) {
        final changed = !_followed.containsAll(ids) || !ids.containsAll(_followed);
        setState(() => _followed = ids);
        if (changed && !_allSources) unawaited(_load(refresh: true));
      }
    } on Exception { /* The feed remains complete if personalization is unavailable. */ }
  }

  void _onMarketChanged() {
    if (!mounted) return;
    final String code = widget.publisherMarketSelection?.value ?? 'CL';
    if (_selectedCountry == code) return;
    _debounce?.cancel();
    _query.clear();
    _sourceId = null;
    _date = LiveDateFilter.all;
    _format = LiveNewsFormatFilter.all;
    _topic = null;
    setState(() => _selectedCountry = code);
    unawaited(_loadSources());
    unawaited(_load(refresh: true));
  }

  void _chooseCountry(String code) {
    final PublisherMarketSelection? selection = widget.publisherMarketSelection;
    if (selection == null) {
      setState(() => _selectedCountry = code);
    } else {
      selection.select(code);
    }
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
        _sources = List<LiveSourceDto>.of(sources.where(isChileBetaPublisher))
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
      final format = switch (_format) {
        LiveNewsFormatFilter.all => null,
        LiveNewsFormatFilter.press => 'press',
        LiveNewsFormatFilter.videos => 'videos',
      };
      final scoped = widget.repository is ScopedLiveNewsRepository && _followed.isNotEmpty && !_allSources;
      final LiveNewsPageDto page = scoped
        ? await (widget.repository as ScopedLiveNewsRepository).listScopedLiveNews(
          scope:'following', cursor:cursor, query:query.isEmpty ? null : query, sourceId:_sourceId,
          format:format, topic:_topic?.name, publishedFrom:bounds.$1, publishedTo:bounds.$2,
          refresh:refresh, requestToken:token)
        : await widget.repository.listLiveNews(
        cursor: cursor,
        query: query.isEmpty ? null : query,
        sourceId: _sourceId,
        format: format,
        topic: _topic?.name,
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
              (LiveNewsItemDto item) => isChileBetaPublisher(item.source) && existing.add(item.id),
            ),
          ];
        } else {
          _items = page.items.where((LiveNewsItemDto item) => isChileBetaPublisher(item.source)).toList(growable: false);
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
    _format = LiveNewsFormatFilter.all;
    _topic = null;
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

  void _openNews(LiveNewsItemDto item) {
    if (extractYouTubeVideoId(item.canonicalUrl.toString()) != null) {
      unawaited(widget.externalLinkOpener(item.canonicalUrl));
    } else { widget.onOpenArticle(item.id); }
  }

  @override
  Widget build(BuildContext context) {
    return LiveReaderScaffold(
      title: 'Dialektik',
      backgroundColor: DialektikColors.triadCream,
      isRoot: true,
      scrollKey: const PageStorageKey<String>('live-news'),
      navigationActions: widget.navigationActions,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (_briefing != null) FutureBuilder<PublicPage<EventCardDto>>(
            future:_briefing, builder:(context,snapshot) {
              final now=widget.clock().toLocal();
              final events=(snapshot.data?.items ?? <EventCardDto>[]).where((event) {
                final date=event.detectedAt.toLocal();
                return date.year==now.year && date.month==now.month && date.day==now.day;
              }).take(5).toList();
              if (events.isEmpty) return const SizedBox.shrink();
              return Card(child:ExpansionTile(initiallyExpanded:true,title:const Text('Resumen de hoy · En 3 minutos'),children:[
                for(final event in events) ListTile(dense:true,
                  title:Text(event.titleDescriptive,maxLines:1,overflow:TextOverflow.ellipsis),
                  subtitle:Text('${switch(event.synthesisRelation) { 'CONTRADICTION' => 'Contradicción', 'DIFFERENT_FOCUS' => 'Distinto enfoque', 'DEVELOPING' => 'En desarrollo', 'TREND' => 'Tendencia', _ => 'Cobertura' }} · ${event.sourceCount} medios'),
                  onTap:widget.onOpenEvent == null ? null : () => widget.onOpenEvent!(event.id)),
              ]));
            }),
          if (_followed.isNotEmpty) Wrap(spacing:8, children: [
            ChoiceChip(label:const Text('Siguiendo'), selected:!_allSources, onSelected: (_) {
              setState(() => _allSources = false); unawaited(_load(refresh:true));
            }),
            ChoiceChip(label:const Text('Ver todo'), selected:_allSources, onSelected: (_) {
              setState(() => _allSources = true); unawaited(_load(refresh:true));
            }),
          ]),
          TextButton.icon(onPressed:()=>setState(()=>_filtersExpanded=!_filtersExpanded),
            icon:const Icon(Icons.tune), label:Text(_filtersExpanded ? 'Ocultar filtros' : 'Filtros')),
          if (_filtersExpanded) ...<Widget>[
          Semantics(
            header: true,
            child: Text('País', style: Theme.of(context).textTheme.titleMedium),
          ),
          const SizedBox(height: DialektikSpacing.space2),
          Scrollbar(
            controller: _countryScroll,
            thumbVisibility: true,
            notificationPredicate: (notification) => notification.depth == 0,
            child: SingleChildScrollView(
              key: const Key('live-country-scroll'),
              controller: _countryScroll,
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.only(bottom: DialektikSpacing.space3),
              child: Row(
                children: <Widget>[
                  for (final (String code, String label)
                      in const <(String, String)>[
                        ('CL', 'Chile'),
                        ('PE', 'Perú'),
                        ('AR', 'Argentina'),
                        ('CO', 'Colombia'),
                        ('MX', 'México'),
                        ('ES', 'España'),
                      ]) ...<Widget>[
                    ChoiceChip(
                      key: Key('live-country-$code'),
                      label: Text(label),
                      selected: _selectedCountry == code,
                      onSelected: (_) => _chooseCountry(code),
                    ),
                    const SizedBox(width: DialektikSpacing.space2),
                  ],
                  ActionChip(
                    label: const Text('Más países'),
                    onPressed: () => showModalBottomSheet<void>(
                      context: context,
                      showDragHandle: true,
                      builder: (BuildContext modalContext) => SafeArea(
                        child: ListView(
                          shrinkWrap: true,
                          children: <Widget>[
                            const ListTile(title: Text('Explorar países')),
                            for (final (String code, String name)
                                in const <(String, String)>[
                                  ('BO', 'Bolivia'),
                                  ('BR', 'Brasil'),
                                  ('CR', 'Costa Rica'),
                                  ('CU', 'Cuba'),
                                  ('DO', 'República Dominicana'),
                                  ('EC', 'Ecuador'),
                                  ('GT', 'Guatemala'),
                                  ('HN', 'Honduras'),
                                  ('NI', 'Nicaragua'),
                                  ('PA', 'Panamá'),
                                  ('PY', 'Paraguay'),
                                  ('SV', 'El Salvador'),
                                  ('UY', 'Uruguay'),
                                  ('VE', 'Venezuela'),
                                ])
                              ListTile(
                                title: Text(name),
                                onTap: () {
                                  Navigator.pop(modalContext);
                                  _chooseCountry(code);
                                },
                              ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: DialektikSpacing.space3),
          HorizontalChoiceStrip<LiveNewsFormatFilter>(
            semanticsLabel: 'Filtrar noticias por formato',
            allLabel: 'Todo',
            selectedValue: _format == LiveNewsFormatFilter.all ? null : _format,
            keyPrefix: 'live-news-format-filter',
            options: const <HorizontalChoiceOption<LiveNewsFormatFilter>>[
              HorizontalChoiceOption<LiveNewsFormatFilter>(
                value: LiveNewsFormatFilter.press,
                label: 'Prensa',
              ),
              HorizontalChoiceOption<LiveNewsFormatFilter>(
                value: LiveNewsFormatFilter.videos,
                label: 'Videos',
              ),
            ],
            onSelected: (LiveNewsFormatFilter? value) {
              setState(() => _format = value ?? LiveNewsFormatFilter.all);
              unawaited(_load());
            },
          ),
          const SizedBox(height: DialektikSpacing.space3),
          ],
          Text('Tema', style: Theme.of(context).textTheme.titleMedium),
          HorizontalChoiceStrip<LiveNewsTopic>(
            semanticsLabel: 'Filtrar noticias por tema',
            allLabel: 'Todos', selectedValue: _topic, keyPrefix: 'live-topic-filter',
            options: const <HorizontalChoiceOption<LiveNewsTopic>>[
              HorizontalChoiceOption(value: LiveNewsTopic.politica, label: 'Política'),
              HorizontalChoiceOption(value: LiveNewsTopic.justicia, label: 'Justicia'),
              HorizontalChoiceOption(value: LiveNewsTopic.economia, label: 'Economía'),
              HorizontalChoiceOption(value: LiveNewsTopic.seguridad, label: 'Seguridad'),
              HorizontalChoiceOption(value: LiveNewsTopic.deportes, label: 'Deportes'),
              HorizontalChoiceOption(value: LiveNewsTopic.sociedad, label: 'Sociedad'),
            ],
            onSelected: (value) {
              setState(() => _topic = value);
              unawaited(_load());
            },
          ),
          if (_selectedCountry != 'CL') ...<Widget>[
            const SizedBox(height: DialektikSpacing.space4),
            const EditorialEmptyState(
              title: 'Cobertura de este país todavía no habilitada.',
              description: 'El selector está preparado, pero aún no existe un feed de este país verificado. No mostraremos noticias chilenas como si fueran locales.',
            ),
          ] else ...<Widget>[
          if (widget.govUkPreviewLoader != null && (_allSources || _followed.isEmpty)) ...<Widget>[
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
                                  '${items.length} publicaciones verificadas · ${snapshot.data!.multiPublisher ? '2 organismos oficiales' : 'Regulator of Social Housing'}',
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
                                      '${article.publisher} · Publicado ${article.publishedAt.toLocal().day}/${article.publishedAt.toLocal().month}/${article.publishedAt.toLocal().year} · Abrir fuente',
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
          ],
          if (_filtersExpanded) ...<Widget>[
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
          ],
          if (_sourceError)
            EditorialTextButton(
              onPressed: () => unawaited(_loadSources()),
              child: const Text('Reintentar la lista de fuentes'),
            ),
          const SizedBox(height: DialektikSpacing.space4),
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
          else if (_visibleItems.isEmpty)
            EditorialEmptyState(
              title: _hasFilters
                  ? 'No hay noticias con estos filtros.'
                  : 'Todavía no hay noticias recientes disponibles.',
              description: _hasFilters
                  ? 'Puedes ampliar la búsqueda o cambiar la fuente y la fecha.'
                  : 'Vuelve a consultar más tarde; aquí aparecerán publicaciones con su fuente y enlace originales.',
              action: _nextCursor != null && !_addingPage
                  ? EditorialTextButton(
                      onPressed: () => unawaited(_load(append: true)),
                      child: const Text('Buscar en más noticias'),
                    )
                  : _hasFilters
                      ? EditorialTextButton(
                          onPressed: _clearFilters,
                          child: const Text('Limpiar filtros'),
                        )
                      : null,
            )
          else ...<Widget>[
            LiveLeadCard(
              article: _visibleItems.first,
              isFollowed: _followed.contains(_visibleItems.first.source.id),
              onPressed: () => _openNews(_visibleItems.first),
            ),
            if (_visibleItems.length > 1) ...<Widget>[
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
                      for (final LiveNewsItemDto article in _visibleItems.skip(1))
                        SizedBox(
                          width: cardWidth,
                          child: LiveNewsCard(
                            article: article,
                            isFollowed: _followed.contains(article.source.id),
                            onPressed: () => _openNews(article),
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
                _visibleItems.length,
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
  List<RegisteredSourceDto> _registered = <RegisteredSourceDto>[];
  bool _registeredLoading = true;
  Object? _registeredError;
  List<CandidateSourceInfo> _candidates = <CandidateSourceInfo>[];
  final TextEditingController _candidateSearch = TextEditingController();
  Object? _error;
  Object? _candidateError;
  bool _loading = true;
  bool _candidatesLoading = true;
  Set<String> _followed = <String>{};
  final Set<String> _followBusy = <String>{};
  String _sourceFormat = 'all';
  FollowingRepository? get _following => widget.repository is FollowingRepository &&
      (widget.repository as FollowingRepository).followingAvailable
      ? widget.repository as FollowingRepository : null;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
    unawaited(_loadRegistered());
    unawaited(_loadCandidates());
    unawaited(_loadFollowing());
  }

  Future<void> _loadFollowing() async {
    final repository = _following;
    if (repository == null) return;
    try {
      final ids = await repository.listFollowedSources();
      if (mounted) setState(() => _followed = ids);
    } on Exception {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No se pudieron cargar tus fuentes seguidas.')));
    }
  }

  Future<void> _toggleFollow(String id) async {
    final repository = _following;
    if (repository == null || _followBusy.contains(id)) return;
    final next = !_followed.contains(id);
    setState(() => _followBusy.add(id));
    try {
      await repository.setFollowing(id, following: next);
      if (mounted) setState(() { if (next) { _followed.add(id); } else { _followed.remove(id); } });
    } on Exception {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No se pudo actualizar el seguimiento.')));
    } finally {
      if (mounted) setState(() => _followBusy.remove(id));
    }
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

  Future<void> _loadRegistered({bool refresh = false}) async {
    final RegisteredSourceDirectoryRepository? directory =
        widget.repository is RegisteredSourceDirectoryRepository
        ? widget.repository as RegisteredSourceDirectoryRepository
        : null;
    if (directory == null) {
      if (mounted) setState(() => _registeredLoading = false);
      return;
    }
    try {
      final RegisteredSourceDirectory result =
          await directory.loadRegisteredSources(refresh: refresh);
      if (!mounted) return;
      setState(() {
        _registered = result.items;
        _registeredLoading = false;
        _registeredError = null;
      });
    } on Exception catch (error) {
      if (!mounted) return;
      setState(() {
        _registeredError = error;
        _registeredLoading = false;
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
        _sources = List<LiveSourceDto>.of(sources.where(isChileBetaPublisher))
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
    backgroundColor: DialektikColors.triadCream,
    location: 'Fuentes',
    isRoot: true,
    navigationActions: widget.navigationActions,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const Text('Consulta quién publica cada noticia y su sitio original.'),
        const SizedBox(height: DialektikSpacing.space6),
        SectionHeading(title: 'Fuentes operativas · ${_sources.length}'),
        Wrap(spacing: 8, children: [
          for (final entry in const [('all','Todas'),('press','Prensa'),('videos','Canales de YouTube')])
            ChoiceChip(label: Text(entry.$2), selected: _sourceFormat == entry.$1,
              onSelected: (_) => setState(() => _sourceFormat = entry.$1)),
        ]),
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
          for (final LiveSourceDto source in _sources.where((source) => _sourceFormat == 'all' ||
            (_sourceFormat == 'videos' ? source.canonicalDomain == 'youtube.com' : source.canonicalDomain != 'youtube.com'))) ...<Widget>[
            EditorialActionCard(
              onTap: () => widget.onOpenSource(source.id),
              semanticLabel:
                  'Consultar fuente ${source.name}, ${source.canonicalDomain}',
              child: Row(children: [
                CircleAvatar(child: Text(source.name.isEmpty ? '?' : source.name.characters.first.toUpperCase())),
                const SizedBox(width: 12),
                Expanded(child: SourceIdentity(
                  name: source.name,
                  domain: source.canonicalDomain,
                  publisherType: '${liveSourceType(source.sourceType)} · Chile',
                  header: true,
                  stacked: false,
                )),
              ]),
            ),
            if (_following != null) Align(alignment: Alignment.centerRight, child: TextButton(
              onPressed: _followBusy.contains(source.id) ? null : () => unawaited(_toggleFollow(source.id)),
              child: Text(_followed.contains(source.id) ? 'Siguiendo ✓' : '+ Seguir'),
            )),
            const SizedBox(height: EditorialLayout.cardGap),
          ],
        ],
        const SizedBox(height: EditorialLayout.sectionGap),
        SectionHeading(title: 'Registradas en revisión · ${_registered.length}'),
        const SizedBox(height: DialektikSpacing.space2),
        const Text(
          'Este registro técnico no verifica autorizaciones ni procedencia. Las fuentes operativas se muestran en la sección anterior.',
        ),
        const SizedBox(height: DialektikSpacing.space3),
        if (_registeredLoading)
          const EditorialLoading(label: 'Cargando registro de fuentes…')
        else if (_registeredError != null)
          EditorialTextButton(
            onPressed: () => unawaited(_loadRegistered(refresh: true)),
            child: const Text('Reintentar registro'),
          )
        else if (_registered.isEmpty)
          const Text('No hay fuentes registradas para este país.')
        else
          for (final RegisteredSourceDto source in _registered)
            Padding(
              padding: const EdgeInsets.only(bottom: DialektikSpacing.space3),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(DialektikSpacing.space4),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(source.name, style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: DialektikSpacing.space1),
                      Text(source.canonicalDomain),
                      const SizedBox(height: DialektikSpacing.space1),
                      Text('${source.stagedRecordCount} registros · Verificación independiente pendiente'),
                    ],
                  ),
                ),
              ),
            ),
        const SizedBox(height: EditorialLayout.sectionGap),
        SectionHeading(title: 'Candidatas · ${_candidates.length}'),
        const SizedBox(height: DialektikSpacing.space2),
        const Text(
          'Este catálogo conserva la revisión histórica de 50 medios. Sus datos no reflejan necesariamente el estado actual de las fuentes operativas y no activan la adquisición de noticias.',
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
                LiveExternalAction(
                  uri: Uri.https(candidate.domain, '/'),
                  opener: openExternalHttpLink,
                  label: 'Visitar sitio original del medio',
                ),
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
                  'Revalidación técnica registrada',
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
        const SizedBox(height: DialektikSpacing.space8),
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
    this.isFollowed = false,
    super.key,
  });

  final LiveNewsItemDto article;
  final VoidCallback onPressed;
  final bool isFollowed;

  @override
  Widget build(BuildContext context) => extractYouTubeVideoId(article.canonicalUrl.toString()) != null
      ? YouTubeNewsCard(videoId:extractYouTubeVideoId(article.canonicalUrl.toString())!,title:article.headline,source:article.source.name,
          published:liveLocalDate(article.publishedAt),followed:isFollowed,onTap:onPressed)
      : Semantics(
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
                  if (isFollowed) const Text('En tus fuentes', style: TextStyle(color: DialektikColors.nocturneText)),
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
    this.isFollowed = false,
    super.key,
  });
  final LiveNewsItemDto article;
  final VoidCallback onPressed;
  final bool isFollowed;
  @override
  Widget build(BuildContext context) => extractYouTubeVideoId(article.canonicalUrl.toString()) != null
      ? YouTubeNewsCard(videoId:extractYouTubeVideoId(article.canonicalUrl.toString())!,title:article.headline,source:article.source.name,
          published:liveLocalDate(article.publishedAt),followed:isFollowed,compact:true,onTap:onPressed)
      : EditorialActionCard(
    onTap: onPressed,
    semanticLabel:
        'Ver noticia: ${article.headline}. ${article.source.name}. Publicada ${liveLocalDate(article.publishedAt)}',
    child: LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final Widget metadata = Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            if (isFollowed) const Text('En tus fuentes'),
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
            if (article.modifiedAt != null && !article.modifiedAt!.isAtSameMomentAs(article.publishedAt)) ...<Widget>[
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
