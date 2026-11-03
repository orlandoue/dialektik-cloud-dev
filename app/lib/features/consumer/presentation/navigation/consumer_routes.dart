import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/curated_event_preview.dart';
import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/consumer/presentation/screens/contradictions_screen.dart';
import 'package:dialektik/features/consumer/presentation/screens/event_detail_screen.dart';
import 'package:dialektik/features/consumer/presentation/screens/feed_screen.dart';
import 'package:dialektik/features/consumer/presentation/screens/source_screen.dart';
import 'package:dialektik/features/consumer/presentation/screens/synthesis_screen.dart';
import 'package:dialektik/features/consumer/presentation/widgets/consumer_navigation_action.dart';
import 'package:dialektik/features/live/data/chile_seismic_observations.dart';
import 'package:dialektik/features/live/data/govuk_preview.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/live/data/publisher_market_selection.dart';
import 'package:dialektik/features/live/presentation/live_components.dart';
import 'package:dialektik/features/live/presentation/live_news_screens.dart';
import 'package:dialektik/features/live/presentation/mirror_screen.dart';
import 'package:dialektik/features/personal_owner/data/personal_owner_operational.dart';
import 'package:dialektik/features/personal_owner/data/personal_owner_status.dart';
import 'package:dialektik/features/personal_owner/data/personal_owner_test_shadow.dart';
import 'package:dialektik/features/personal_owner/presentation/personal_owner_official_event_screen.dart';
import 'package:dialektik/features/personal_owner/presentation/personal_owner_operational_screen.dart';
import 'package:dialektik/features/personal_owner/presentation/personal_owner_status_screen.dart';
import 'package:dialektik/features/personal_owner/presentation/personal_owner_test_shadow_screen.dart';
import 'package:dialektik/features/semantic/data/semantic_repository.dart';
import 'package:dialektik/features/semantic/presentation/semantic_screens.dart';
import 'package:dialektik/features/semantic_shadow/data/ephemeral_semantic_repository.dart';
import 'package:dialektik/features/semantic_shadow/data/semantic_graph_repository.dart';
import 'package:dialektik/features/semantic_shadow/data/semantic_shadow_repository.dart';
import 'package:dialektik/features/semantic_shadow/presentation/ephemeral_semantic_screen.dart';
import 'package:dialektik/features/semantic_shadow/presentation/semantic_graph_screen.dart';
import 'package:dialektik/features/semantic_shadow/presentation/semantic_shadow_access.dart';
import 'package:dialektik/features/semantic_shadow/presentation/semantic_shadow_screen.dart';
import 'package:flutter/material.dart';

abstract final class ConsumerRoutes {
  static const String feed = '/';
  static const String liveNews = '/live/news';
  static const String mirror = '/mirror';
  static const String liveSources = '/live/sources';
  static const String semanticShadow = '/shadow/semantic';
  static const String ephemeralSemantic = '/shadow/semantic/content';
  static const String semanticGraph = '/shadow/semantic/graph';
  static const String personalOwner = '/personal/owner';
  static const String personalOwnerOperations = '/personal/owner/operations';
  static const String personalOwnerOfficialEvent =
      '/personal/owner/official-votes/read';
  static const String personalOwnerTestShadow = '/personal/owner/test/shadow';
  static String personalOwnerTestShadowJob(String jobId) =>
      '$personalOwnerTestShadow/${Uri.encodeComponent(jobId)}';
  static String graphNode(String runId, String kind, String key) =>
      '$semanticGraph/$kind/${Uri.encodeComponent(key)}?run_id=${Uri.encodeQueryComponent(runId)}';
  static String liveArticle(String id) =>
      '/live/news/${Uri.encodeComponent(id)}';
  static String liveSource(String id) =>
      '/live/sources/${Uri.encodeComponent(id)}';
  static String liveProvenance(String id) =>
      '/live/news/${Uri.encodeComponent(id)}/provenance';
  static const String contradictions = '/contradictions';
  static const String threads = '/threads';
  static String thread(String id) => '/threads/${Uri.encodeComponent(id)}';
  static String occurrence(String id) =>
      '/occurrences/${Uri.encodeComponent(id)}';
  static String article(String id) => '/articles/${Uri.encodeComponent(id)}';
  static String provenance(String id) =>
      '/provenance/${Uri.encodeComponent(id)}';

  static String event(String id) => '/events/${Uri.encodeComponent(id)}';
  static String source(String id) => '/sources/${Uri.encodeComponent(id)}';
}

final class ConsumerRouteFactory {
  ConsumerRouteFactory({
    required this.repository,
    required this.externalLinkOpener,
    this.semanticRepository,
    this.liveNewsRepository,
    this.publisherMarketSelection,
    this.govUkPreviewLoader,
    this.curatedEventPreviewLoader,
    this.semanticShadowRepository,
    this.ephemeralSemanticRepository,
    this.semanticGraphRepository,
    this.personalOwnerStatusRepository,
    this.personalOwnerOperationalRepository,
    this.personalOwnerTestShadowRepository,
    this.additionalNavigationActions = const <Widget>[],
  });

  final ConsumerRepository repository;
  final ExternalLinkOpener externalLinkOpener;
  final SemanticRepository? semanticRepository;
  final LiveNewsRepository? liveNewsRepository;
  final PublisherMarketSelection? publisherMarketSelection;
  final GovUkPreviewLoader? govUkPreviewLoader;
  final CuratedEventPreviewLoader? curatedEventPreviewLoader;
  final SemanticShadowRepository? semanticShadowRepository;
  final EphemeralSemanticRepository? ephemeralSemanticRepository;
  final SemanticGraphRepository? semanticGraphRepository;
  final PersonalOwnerStatusRepository? personalOwnerStatusRepository;
  final PersonalOwnerOperationalRepository? personalOwnerOperationalRepository;
  final PersonalOwnerTestShadowRepository? personalOwnerTestShadowRepository;
  final List<Widget> additionalNavigationActions;
  final GlobalKey<NavigatorState> _navigatorKey = GlobalKey<NavigatorState>(
    debugLabel: 'consumer-navigator',
  );
  final ValueNotifier<String> _selectedTab = ValueNotifier<String>(ConsumerRoutes.liveNews);
  bool _buildingTab = false;
  int _activeTabHosts = 0;
  static const _mainTabs = <String>{ConsumerRoutes.liveNews, ConsumerRoutes.mirror, ConsumerRoutes.feed, ConsumerRoutes.liveSources};

  Route<dynamic> generate(RouteSettings settings) {
    final Uri uri = Uri.parse(settings.name ?? ConsumerRoutes.feed);
    if (liveNewsRepository != null && !_buildingTab && _mainTabs.contains(uri.path) && uri.queryParameters.isEmpty) {
      return _page(settings, _PersistentReaderTabs(factory:this, initialTab:uri.path));
    }
    final List<String> segments = uri.pathSegments;
    final PersonalOwnerStatusRepository? ownerStatus =
        personalOwnerStatusRepository;
    final PersonalOwnerTestShadowRepository? ownerShadow =
        personalOwnerTestShadowRepository;
    final PersonalOwnerOperationalRepository? ownerOperations =
        personalOwnerOperationalRepository;
    if (ownerOperations != null &&
        uri.path == ConsumerRoutes.personalOwnerOperations) {
      final String? token = settings.arguments is String
          ? settings.arguments! as String
          : null;
      return _page(
        settings,
        PersonalOwnerOperationalScreen(
          repository: ownerOperations,
          initialOwnerToken: token,
          externalLinkOpener: externalLinkOpener,
          onReturnToConsumer: () => _openSection(ConsumerRoutes.liveNews),
          onOpenOfficialEvent: (OwnerJson event) =>
              _navigatorKey.currentState?.pushNamed(
                ConsumerRoutes.personalOwnerOfficialEvent,
                arguments: event,
              ),
        ),
      );
    }
    if (ownerOperations != null &&
        uri.path == ConsumerRoutes.personalOwnerOfficialEvent) {
      final Object? argument = settings.arguments;
      return _page(
        settings,
        PersonalOwnerOfficialEventScreen(
          record: argument is OwnerJson ? argument : null,
          externalLinkOpener: externalLinkOpener,
        ),
      );
    }
    if (ownerShadow != null &&
        uri.path == ConsumerRoutes.personalOwnerTestShadow) {
      return _page(
        settings,
        PersonalOwnerTestShadowScreen(repository: ownerShadow),
      );
    }
    if (ownerShadow != null &&
        segments.length == 5 &&
        uri.path.startsWith('${ConsumerRoutes.personalOwnerTestShadow}/')) {
      return _page(
        settings,
        PersonalOwnerTestShadowScreen(
          repository: ownerShadow,
          initialJobId: Uri.decodeComponent(segments[4]),
        ),
      );
    }
    if (ownerStatus != null && uri.path == ConsumerRoutes.personalOwner) {
      return _page(
        settings,
        PersonalOwnerStatusScreen(
          repository: ownerStatus,
          onReturnToConsumer: () => _openSection(ConsumerRoutes.liveNews),
          onOpenOperations: ownerOperations == null
              ? null
              : (String token) => _navigatorKey.currentState?.pushNamed(
                  ConsumerRoutes.personalOwnerOperations,
                  arguments: token,
                ),
          onOpenTestShadow: ownerShadow == null
              ? null
              : () => _navigatorKey.currentState?.pushNamed(
                  ConsumerRoutes.personalOwnerTestShadow,
                ),
        ),
      );
    }
    final LiveNewsRepository? live = liveNewsRepository;
    if (live != null) {
      void openLiveNews(String id) =>
          _navigatorKey.currentState?.pushNamed(ConsumerRoutes.liveArticle(id));
      void openLiveSource(String id) =>
          _navigatorKey.currentState?.pushNamed(ConsumerRoutes.liveSource(id));
      void openPublicSource(String id) =>
          _navigatorKey.currentState?.pushNamed(ConsumerRoutes.source(id));
      void openLiveProvenance(String id) => _navigatorKey.currentState
          ?.pushNamed(ConsumerRoutes.liveProvenance(id));
      final SemanticGraphRepository? graph = semanticGraphRepository;
      final String currentSection = _sectionForPath(uri.path);
      final List<Widget> navigationActions = _navigationActions(currentSection);
      // Every main section uses the same country selected in Actualidad.
      // No other country is enabled until its feeds and provenance are licensed.
      final String marketCode = publisherMarketSelection?.value ?? 'CL';
      final bool sectionRequiresCoverage =
          uri.path == ConsumerRoutes.feed ||
          uri.path == ConsumerRoutes.mirror ||
          uri.path == ConsumerRoutes.liveSources ||
          uri.path == ConsumerRoutes.contradictions ||
          uri.path.startsWith('/events/') ||
          uri.path.startsWith('/sources/') ||
          uri.path.startsWith('/live/news/') ||
          uri.path.startsWith('/live/sources/');
      if (marketCode != 'CL' && sectionRequiresCoverage) {
        return _page(
          settings,
          LiveReaderScaffold(
            title: 'Cobertura pendiente',
            location: marketCode,
            isRoot: true,
            navigationActions: navigationActions,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text('País seleccionado: $marketCode'),
                const SizedBox(height: 16),
                const Text(
                  'Este país todavía no tiene cobertura habilitada. No se presentarán noticias, acontecimientos ni contradicciones de Chile como si fueran locales.',
                ),
                const SizedBox(height: 16),
                TextButton(
                  onPressed: () => _openSection(ConsumerRoutes.liveNews),
                  child: const Text('Elegir otro país'),
                ),
                TextButton(
                  onPressed: () {
                    publisherMarketSelection?.select('CL');
                    _openSection(ConsumerRoutes.liveNews);
                  },
                  child: const Text('Volver a Chile'),
                ),
              ],
            ),
          ),
        );
      }
      void openGraphOccurrence(String runId, String key) => _navigatorKey
          .currentState
          ?.pushNamed(ConsumerRoutes.graphNode(runId, 'occurrences', key));
      void openGraphInput(String runId, String key) => _navigatorKey
          .currentState
          ?.pushNamed(ConsumerRoutes.graphNode(runId, 'articles', key));
      if (graph != null && uri.path == ConsumerRoutes.semanticGraph) {
        return _page(
          settings,
          SemanticGraphScreen(
            repository: graph,
            initialRunId: uri.queryParameters['run_id'],
            onOpenThread: (String runId, String key) => _navigatorKey
                .currentState
                ?.pushNamed(ConsumerRoutes.graphNode(runId, 'threads', key)),
            onOpenOccurrence: openGraphOccurrence,
            onOpenInput: openGraphInput,
          ),
        );
      }
      if (graph != null &&
          segments.length == 5 &&
          segments[0] == 'shadow' &&
          segments[1] == 'semantic' &&
          segments[2] == 'graph') {
        final String? runId = uri.queryParameters['run_id'];
        final SemanticGraphDetailKind? kind = switch (segments[3]) {
          'threads' => SemanticGraphDetailKind.thread,
          'occurrences' => SemanticGraphDetailKind.occurrence,
          'articles' => SemanticGraphDetailKind.article,
          _ => null,
        };
        if (runId != null && runId.isNotEmpty && kind != null) {
          return _page(
            settings,
            SemanticGraphDetailScreen(
              repository: graph,
              runId: runId,
              nodeKey: segments[4],
              kind: kind,
              onOpenOccurrence: openGraphOccurrence,
              onOpenInput: openGraphInput,
              onOpenArticle: openLiveNews,
              onOpenSource: openLiveSource,
              onOpenProvenance: openLiveProvenance,
            ),
          );
        }
        return _page(
          settings,
          const Scaffold(
            body: Center(
              child: Text(
                'El detalle requiere una ejecución y propuesta exactas.',
              ),
            ),
          ),
        );
      }
      final SemanticShadowRepository? shadow = semanticShadowRepository;
      final EphemeralSemanticRepository? ephemeral =
          ephemeralSemanticRepository;
      if (ephemeral != null && uri.path == ConsumerRoutes.ephemeralSemantic) {
        return _page(
          settings,
          EphemeralSemanticScreen(
            repository: ephemeral,
            onOpenArticle: openLiveNews,
            onOpenSource: openLiveSource,
          ),
        );
      }
      if (shadow != null && uri.path == ConsumerRoutes.semanticShadow) {
        return _page(
          settings,
          SemanticShadowScreen(
            repository: shadow,
            onOpenArticle: openLiveNews,
            onOpenSource: openLiveSource,
          ),
        );
      }
      if (uri.path == ConsumerRoutes.feed) {
        return _page(
          settings,
          SynthesisScreen(
            externalLinkOpener: externalLinkOpener,
            repository: repository,
            seismicRepository: liveNewsRepository is SeismicObservationRepository
                ? liveNewsRepository as SeismicObservationRepository : null,
            navigationActions: navigationActions,
            onOpenEvent: (String id) =>
                _navigatorKey.currentState?.pushNamed(ConsumerRoutes.event(id)),
          ),
        );
      }
      if (uri.path == ConsumerRoutes.mirror) {
        return _page(settings, MirrorScreen(repository:live, externalLinkOpener:externalLinkOpener, onOpenArticle:openLiveNews,
          onOpenSources:()=>_openSection(ConsumerRoutes.liveSources), navigationActions:navigationActions));
      }
      if (uri.path == ConsumerRoutes.contradictions) {
        return _page(
          settings,
          ContradictionsScreen(
            repository: repository,
            navigationActions: navigationActions,
            onOpenEvent: (String id) =>
                _navigatorKey.currentState?.pushNamed(ConsumerRoutes.event(id)),
          ),
        );
      }
      if (segments.length == 2 && segments.first == 'events') {
        return _page(
          settings,
          EventDetailScreen(
            eventId: Uri.decodeComponent(segments[1]),
            repository: repository,
            externalLinkOpener: externalLinkOpener,
            navigationActions: navigationActions,
            onOpenEvent: (String id) => _navigatorKey.currentState
                ?.pushReplacementNamed(ConsumerRoutes.event(id)),
            onOpenSource: openPublicSource,
          ),
        );
      }
      if (segments.length == 2 && segments.first == 'sources') {
        return _page(
          settings,
          SourceScreen(
            sourceId: Uri.decodeComponent(segments[1]),
            repository: repository,
            navigationActions: navigationActions,
          ),
        );
      }
      if (uri.path == ConsumerRoutes.liveSources) {
        return _page(
          settings,
          LiveSourceListScreen(
            repository: live,
            navigationActions: navigationActions,
            onOpenSource: openLiveSource,
          ),
        );
      }
      if (segments.length == 3 &&
          segments[0] == 'live' &&
          segments[1] == 'news') {
        return _page(
          settings,
          LiveArticleScreen(
            articleId: segments[2],
            repository: live,
            externalLinkOpener: externalLinkOpener,
            navigationActions: navigationActions,
            onOpenSource: openLiveSource,
            onOpenProvenance: openLiveProvenance,
          ),
        );
      }
      if (segments.length == 3 &&
          segments[0] == 'live' &&
          segments[1] == 'sources') {
        return _page(
          settings,
          LiveSourceScreen(
            sourceId: segments[2],
            repository: live,
            externalLinkOpener: externalLinkOpener,
            navigationActions: navigationActions,
            onOpenSourceNews: (String id) => _navigatorKey.currentState?.pushNamed(
              '${ConsumerRoutes.liveNews}?source_id=${Uri.encodeQueryComponent(id)}',
            ),
          ),
        );
      }
      if (segments.length == 4 &&
          segments[0] == 'live' &&
          segments[1] == 'news' &&
          segments[3] == 'provenance') {
        return _page(
          settings,
          LiveProvenanceScreen(
            articleId: segments[2],
            repository: live,
            externalLinkOpener: externalLinkOpener,
            navigationActions: navigationActions,
            onOpenSource: openLiveSource,
          ),
        );
      }
      return _page(
        settings,
        LiveNewsScreen(
          externalLinkOpener:externalLinkOpener,
          repository: live,
          publisherMarketSelection: publisherMarketSelection,
          govUkPreviewLoader: govUkPreviewLoader,
          initialSourceId: uri.queryParameters['source_id'],
          onOpenArticle: openLiveNews,
          navigationActions: navigationActions,
        ),
      );
    }

    final SemanticRepository? semantic = semanticRepository;
    void openThread(String id) =>
        _navigatorKey.currentState?.pushNamed(ConsumerRoutes.thread(id));
    void openOccurrence(String id) =>
        _navigatorKey.currentState?.pushNamed(ConsumerRoutes.occurrence(id));
    void openArticle(String id) =>
        _navigatorKey.currentState?.pushNamed(ConsumerRoutes.article(id));
    void openSource(String id) =>
        _navigatorKey.currentState?.pushNamed(ConsumerRoutes.source(id));
    void openProvenance(String id) =>
        _navigatorKey.currentState?.pushNamed(ConsumerRoutes.provenance(id));
    if (semantic != null &&
        segments.length == 1 &&
        segments.first == 'threads') {
      return _page(
        settings,
        ThreadsScreen(
          repository: semantic,
          cursor: uri.queryParameters['cursor'],
          onOpenThread: openThread,
          onOpenFeed: () =>
              _navigatorKey.currentState?.pushNamed(ConsumerRoutes.feed),
        ),
      );
    }
    if (semantic != null && segments.length == 2) {
      final String id = segments[1];
      if (segments.first == 'threads') {
        return _page(
          settings,
          ThreadDetailScreen(
            threadId: id,
            repository: semantic,
            onOpenOccurrence: openOccurrence,
            onOpenArticle: openArticle,
            onOpenSource: openSource,
            onOpenProvenance: openProvenance,
          ),
        );
      }
      if (segments.first == 'occurrences') {
        return _page(
          settings,
          OccurrenceDetailScreen(
            occurrenceId: id,
            repository: semantic,
            onOpenThread: openThread,
            onOpenOccurrence: openOccurrence,
            onOpenArticle: openArticle,
            onOpenSource: openSource,
            onOpenProvenance: openProvenance,
          ),
        );
      }
      if (segments.first == 'articles') {
        return _page(
          settings,
          SemanticArticleScreen(
            articleId: id,
            repository: semantic,
            onOpenSource: openSource,
            onOpenOccurrence: openOccurrence,
          ),
        );
      }
      if (segments.first == 'provenance') {
        return _page(
          settings,
          SemanticProvenanceScreen(
            provenanceId: id,
            repository: semantic,
            onOpenSource: openSource,
            onOpenArticle: openArticle,
          ),
        );
      }
    }
    if (segments.isEmpty) {
      return _page(
        settings,
        FeedScreen(
          repository: repository,
          seismicRepository: liveNewsRepository is SeismicObservationRepository
              ? liveNewsRepository as SeismicObservationRepository : null,
          navigationActions: additionalNavigationActions,
          onOpenThreads: semantic == null
              ? null
              : () => _navigatorKey.currentState?.pushNamed(
                  ConsumerRoutes.threads,
                ),
          onOpenEvent: (String id) =>
              _navigatorKey.currentState?.pushNamed(ConsumerRoutes.event(id)),
          onOpenContradictions: () => _navigatorKey.currentState?.pushNamed(
            ConsumerRoutes.contradictions,
          ),
        ),
      );
    }
    if (segments.length == 1 && segments.first == 'contradictions') {
      return _page(
        settings,
        ContradictionsScreen(
          repository: repository,
          onOpenEvent: (String id) =>
              _navigatorKey.currentState?.pushNamed(ConsumerRoutes.event(id)),
        ),
      );
    }
    if (segments.length == 2 && segments.first == 'events') {
      final String id = Uri.decodeComponent(segments[1]);
      return _page(
        settings,
        EventDetailScreen(
          eventId: id,
          isDemo: semantic != null,
          repository: repository,
          externalLinkOpener: externalLinkOpener,
          onOpenEvent: (String successorId) => _navigatorKey.currentState
              ?.pushReplacementNamed(ConsumerRoutes.event(successorId)),
          onOpenSource: (String sourceId) => _navigatorKey.currentState
              ?.pushNamed(ConsumerRoutes.source(sourceId)),
        ),
      );
    }
    if (segments.length == 2 && segments.first == 'sources') {
      return _page(
        settings,
        SourceScreen(
          sourceId: Uri.decodeComponent(segments[1]),
          isDemo: semantic != null,
          repository: repository,
        ),
      );
    }
    return _page(
      settings,
      FeedScreen(
        repository: repository,
        seismicRepository: liveNewsRepository is SeismicObservationRepository ? liveNewsRepository as SeismicObservationRepository : null,
        navigationActions: additionalNavigationActions,
        onOpenEvent: (String id) =>
            _navigatorKey.currentState?.pushNamed(ConsumerRoutes.event(id)),
        onOpenContradictions: () => _navigatorKey.currentState?.pushNamed(
          ConsumerRoutes.contradictions,
        ),
      ),
    );
  }

  MaterialPageRoute<void> _page(RouteSettings settings, Widget child) =>
      MaterialPageRoute<void>(
        settings: settings,
        builder: (_) =>
            liveNewsRepository != null && semanticShadowRepository != null
            ? SemanticShadowAccess(
                openInspector: () => _navigatorKey.currentState?.pushNamed(
                  ConsumerRoutes.semanticShadow,
                ),
                child: child,
              )
            : child,
      );

  GlobalKey<NavigatorState> get navigatorKey => _navigatorKey;

  List<Widget> _navigationActions(String currentSection) {
    final List<({String label, String route})> sections =
        <({String label, String route})>[
          (label: 'Actualidad', route: ConsumerRoutes.liveNews),
          (label: 'Espejo', route: ConsumerRoutes.mirror),
          (label: 'Síntesis', route: ConsumerRoutes.feed),
          (label: 'Fuentes', route: ConsumerRoutes.liveSources),
          if (personalOwnerStatusRepository != null)
            (label: 'Administración', route: ConsumerRoutes.personalOwner),
        ];
    return <Widget>[
      for (final ({String label, String route}) section in sections)
        ConsumerNavigationAction(
          label: section.label,
          selected: currentSection == section.label,
          onPressed: () {
            if (currentSection != section.label) _openSection(section.route);
          },
        ),
      ...additionalNavigationActions,
    ];
  }

  String _sectionForPath(String path) {
    if (path == ConsumerRoutes.feed || path.startsWith('/events/')) {
      return 'Síntesis';
    }
    if (path == ConsumerRoutes.liveSources ||
        path.startsWith('/sources/') ||
        path.startsWith('/live/sources/')) {
      return 'Fuentes';
    }
    if (path == ConsumerRoutes.contradictions) return 'Síntesis';
    if (path == ConsumerRoutes.mirror) return 'Espejo';
    if (path.startsWith('/personal/owner/official-votes/')) {
      return 'Administración';
    }
    return 'Actualidad';
  }

  void _openSection(String route) {
    if (_mainTabs.contains(route) && _activeTabHosts > 0) {
      _selectedTab.value = route;
      _navigatorKey.currentState?.popUntil((candidate) => candidate.isFirst || _mainTabs.contains(Uri.parse(candidate.settings.name ?? '').path));
      return;
    }
    _navigatorKey.currentState?.pushNamedAndRemoveUntil(
      route,
      (Route<dynamic> candidate) => candidate.isFirst,
    );
  }

  Widget _tabWidget(String route) {
    _buildingTab = true;
    try {
      final page = generate(RouteSettings(name:route)) as MaterialPageRoute<void>;
      return Builder(builder:page.builder);
    } finally { _buildingTab = false; }
  }
}

class _PersistentReaderTabs extends StatefulWidget {
  const _PersistentReaderTabs({required this.factory,required this.initialTab});
  final ConsumerRouteFactory factory;
  final String initialTab;
  @override State<_PersistentReaderTabs> createState()=>_PersistentReaderTabsState();
}
class _PersistentReaderTabsState extends State<_PersistentReaderTabs> {
  final Map<String,Widget> _pages = {};
  @override void initState() {
    super.initState();
    widget.factory._activeTabHosts++;
    widget.factory._selectedTab.value=widget.initialTab;
    widget.factory.publisherMarketSelection?.addListener(_marketChanged);
  }
  void _marketChanged() { if(mounted) setState(() { _pages.removeWhere((route,_) => route != ConsumerRoutes.liveNews); }); }
  @override void dispose() { widget.factory._activeTabHosts--;widget.factory.publisherMarketSelection?.removeListener(_marketChanged);super.dispose(); }
  @override Widget build(BuildContext context) => ValueListenableBuilder<String>(
    valueListenable:widget.factory._selectedTab,
    builder:(context,selected,_) {
      _pages.putIfAbsent(selected,()=>widget.factory._tabWidget(selected));
      final routes=_pages.keys.toList(growable:false);
      return IndexedStack(index:routes.indexOf(selected),children:[for(final route in routes) KeyedSubtree(key:ValueKey(route),child:TickerMode(enabled:route==selected,child:_pages[route]!)),]);
    },
  );
}
