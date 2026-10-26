import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/design_system/theme/dialektik_theme.dart';
import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_client.dart';
import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/consumer/presentation/localization/consumer_strings.dart';
import 'package:dialektik/features/consumer/presentation/navigation/consumer_routes.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/personal_owner/data/personal_owner_operational.dart';
import 'package:dialektik/features/personal_owner/data/personal_owner_status.dart';
import 'package:dialektik/features/personal_owner/data/personal_owner_status_client.dart';
import 'package:dialektik/features/personal_owner/data/personal_owner_test_shadow.dart';
import 'package:dialektik/features/semantic/data/semantic_repository.dart';
import 'package:dialektik/features/semantic_shadow/data/ephemeral_semantic_repository.dart';
import 'package:dialektik/features/semantic_shadow/data/semantic_graph_repository.dart';
import 'package:dialektik/features/semantic_shadow/data/semantic_shadow_repository.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:http/http.dart' as http;

/// Consumer shell with isolated, explicitly authorized development profiles.
class DialektikApp extends StatefulWidget {
  const DialektikApp({
    required this.environment,
    this.loadInterFromDependency = true,
    this.internalModerationHome,
    this.consumerRepository,
    this.semanticRepository,
    this.liveNewsRepository,
    this.semanticShadowRepository,
    this.personalOwnerModeEnabled = false,
    this.personalOwnerStatusRepository,
    this.personalOwnerOperationalRepository,
    this.personalOwnerTestShadowRepository,
    this.apiAccessTokenProvider,
    this.onAuthorizationRejected,
    this.apiConfiguration,
    this.publicApiHttpClient,
    this.readOnlyNewsReaderEnabled = false,
    this.betaNavigationActions = const <Widget>[],
    this.externalLinkOpener = openExternalHttpLink,
    this.initialRoute = ConsumerRoutes.feed,
    this.locale,
    super.key,
  });
  final AppEnvironment environment;
  final bool loadInterFromDependency;
  final Widget? internalModerationHome;
  final ConsumerRepository? consumerRepository;
  final SemanticRepository? semanticRepository;
  final LiveNewsRepository? liveNewsRepository;
  final SemanticShadowRepository? semanticShadowRepository;
  final bool personalOwnerModeEnabled;
  final PersonalOwnerStatusRepository? personalOwnerStatusRepository;
  final PersonalOwnerOperationalRepository? personalOwnerOperationalRepository;
  final PersonalOwnerTestShadowRepository? personalOwnerTestShadowRepository;
  final AccessTokenProvider? apiAccessTokenProvider;
  final AuthorizationRejectedHandler? onAuthorizationRejected;
  final ApiConfiguration? apiConfiguration;
  final http.Client? publicApiHttpClient;
  final bool readOnlyNewsReaderEnabled;
  final List<Widget> betaNavigationActions;
  final ExternalLinkOpener externalLinkOpener;
  final String initialRoute;
  final Locale? locale;

  @override
  State<DialektikApp> createState() => _DialektikAppState();
}

final class _DialektikAppState extends State<DialektikApp> {
  ConsumerRepository? _repository;
  PublicApiClient? _ownedClient;
  PublicApiClient? _ownedSemanticClient;
  PublicApiClient? _ownedLiveClient;
  PersonalOwnerStatusClient? _ownedPersonalOwnerClient;
  PersonalOwnerOperationalClient? _ownedPersonalOwnerOperationalClient;
  PersonalOwnerTestShadowClient? _ownedPersonalOwnerTestShadowClient;
  ConsumerRouteFactory? _routes;
  SemanticsHandle? _semanticHandle;
  bool _readerSurfaceEnabled = false;
  bool _newsReaderEnabled = false;
  bool _semanticShadowEnabled = false;

  @override
  void initState() {
    super.initState();
    const String semanticMode = String.fromEnvironment(
      'DIALEKTIK_SEMANTIC_MODE',
      defaultValue: 'disabled',
    );
    if (!const <String>{
      'disabled',
      'fixture',
      'unassigned',
    }.contains(semanticMode)) {
      throw StateError('Unsupported product semantic mode.');
    }
    final bool fixtureEnabled =
        semanticMode == 'fixture' || widget.semanticRepository != null;
    final bool unassignedDevelopmentMode =
        semanticMode == 'unassigned' &&
        widget.environment != AppEnvironment.production;
    _newsReaderEnabled =
        unassignedDevelopmentMode ||
        widget.readOnlyNewsReaderEnabled ||
        widget.liveNewsRepository != null;
    _semanticShadowEnabled =
        unassignedDevelopmentMode ||
        (widget.environment != AppEnvironment.production &&
            (widget.liveNewsRepository != null ||
                widget.semanticShadowRepository != null));
    if (fixtureEnabled && _semanticShadowEnabled) {
      throw StateError(
        'Synthetic and live product readers require separate profiles.',
      );
    }
    if (widget.environment == AppEnvironment.production &&
        (fixtureEnabled ||
            semanticMode != 'disabled' ||
            widget.semanticShadowRepository != null ||
            (widget.liveNewsRepository != null &&
                !widget.readOnlyNewsReaderEnabled) ||
            widget.personalOwnerModeEnabled)) {
      throw StateError(
        'Production permits only the explicitly enabled read-only news reader.',
      );
    }
    if (!widget.personalOwnerModeEnabled &&
        widget.personalOwnerStatusRepository != null) {
      throw StateError('Personal owner routes require explicit personal mode.');
    }
    if (widget.personalOwnerModeEnabled &&
        widget.personalOwnerStatusRepository == null) {
      _ownedPersonalOwnerClient = PersonalOwnerStatusClient(
        configuration: ApiConfiguration.forEnvironment(widget.environment),
      );
    }
    if (widget.personalOwnerModeEnabled &&
        widget.personalOwnerTestShadowRepository == null) {
      _ownedPersonalOwnerTestShadowClient = PersonalOwnerTestShadowClient(
        configuration: ApiConfiguration.forEnvironment(widget.environment),
      );
    }
    if (widget.personalOwnerModeEnabled &&
        widget.personalOwnerOperationalRepository == null) {
      _ownedPersonalOwnerOperationalClient = PersonalOwnerOperationalClient(
        configuration: ApiConfiguration.forEnvironment(widget.environment),
      );
    }
    _readerSurfaceEnabled =
        fixtureEnabled || _newsReaderEnabled || _semanticShadowEnabled;
    // Native accessibility owns activation. Forcing the Dart tree before the
    // platform enables it can suppress the transition that sends native nodes.
    if (_readerSurfaceEnabled &&
        (kIsWeb || widget.environment == AppEnvironment.test)) {
      _semanticHandle = SemanticsBinding.instance.ensureSemantics();
    }
    if (widget.internalModerationHome == null) {
      _repository = widget.consumerRepository;
      if (_repository == null) {
        _ownedClient = _createPublicApiClient();
        _repository = _ownedClient;
      }
      final LiveNewsRepository? liveRepository =
          widget.liveNewsRepository ??
          (_newsReaderEnabled
              ? (_ownedClient ?? (_ownedLiveClient = _createPublicApiClient()))
              : null);
      _routes = ConsumerRouteFactory(
        repository: _repository!,
        curatedEventPreviewLoader:
            const bool.fromEnvironment(
                  'DIALEKTIK_CHILE_EVENT_PREVIEW_ENABLED',
                  defaultValue: false,
                ) &&
                widget.readOnlyNewsReaderEnabled &&
                liveRepository is PublicApiClient
            ? ({bool refresh = false}) =>
                  liveRepository.loadChileTornadoEventPreview(refresh: refresh)
            : null,
        govUkPreviewLoader: null,
        externalLinkOpener: widget.externalLinkOpener,
        semanticRepository:
            widget.semanticRepository ??
            (fixtureEnabled
                ? (_ownedClient ??
                      (_ownedSemanticClient = _createPublicApiClient()))
                : null),
        liveNewsRepository: liveRepository,
        semanticGraphRepository:
            _semanticShadowEnabled && liveRepository is SemanticGraphRepository
            ? liveRepository as SemanticGraphRepository
            : null,
        ephemeralSemanticRepository:
            _semanticShadowEnabled &&
                liveRepository is EphemeralSemanticRepository
            ? liveRepository as EphemeralSemanticRepository
            : null,
        semanticShadowRepository: _semanticShadowEnabled
            ? (widget.semanticShadowRepository ??
                  (liveRepository is SemanticShadowRepository
                      ? liveRepository as SemanticShadowRepository
                      : null))
            : null,
        personalOwnerStatusRepository:
            widget.personalOwnerStatusRepository ?? _ownedPersonalOwnerClient,
        personalOwnerOperationalRepository:
            widget.personalOwnerOperationalRepository ??
            _ownedPersonalOwnerOperationalClient,
        personalOwnerTestShadowRepository:
            widget.personalOwnerTestShadowRepository ??
            _ownedPersonalOwnerTestShadowClient,
        additionalNavigationActions: widget.betaNavigationActions,
      );
    }
  }

  PublicApiClient _createPublicApiClient() => PublicApiClient(
    configuration:
        widget.apiConfiguration ??
        ApiConfiguration.forEnvironment(widget.environment),
    httpClient: widget.publicApiHttpClient,
    authorizationTokenProvider: widget.apiAccessTokenProvider,
    onAuthorizationRejected: widget.onAuthorizationRejected,
    maxAttempts: widget.apiAccessTokenProvider == null ? 1 : 2,
  );

  @override
  void dispose() {
    _semanticHandle?.dispose();
    _ownedClient?.close();
    _ownedSemanticClient?.close();
    _ownedLiveClient?.close();
    _ownedPersonalOwnerClient?.close();
    _ownedPersonalOwnerOperationalClient?.close();
    _ownedPersonalOwnerTestShadowClient?.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner:
        widget.environment == AppEnvironment.development &&
        !_readerSurfaceEnabled,
    home: widget.internalModerationHome,
    initialRoute: widget.internalModerationHome == null
        ? widget.initialRoute
        : null,
    navigatorKey: _routes?.navigatorKey,
    onGenerateRoute: widget.internalModerationHome == null
        ? _routes!.generate
        : null,
    // Deep links mount one reader rather than hidden prefix-route GET requests.
    onGenerateInitialRoutes:
        widget.internalModerationHome == null && _readerSurfaceEnabled
        ? (String route) => <Route<dynamic>>[
            _routes!.generate(RouteSettings(name: route)),
          ]
        : null,
    locale: widget.locale,
    supportedLocales: consumerSupportedLocales,
    localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
      ConsumerStringsDelegate(),
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
    theme: DialektikTheme.offWhite(
      loadInterFromDependency: widget.loadInterFromDependency,
    ),
    title: 'Dialektik',
  );
}
