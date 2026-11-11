import 'package:dialektik/app/dialektik_app.dart';
import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/features/consumer/presentation/navigation/consumer_routes.dart';
import 'package:dialektik/features/private_beta/presentation/private_beta_gate.dart';
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, kReleaseMode, TargetPlatform;
import 'package:flutter/widgets.dart';

/// Android release artifacts always require the private-beta sign-in gate,
/// even when a build accidentally omits the environment define.
bool requiresPrivateBetaGate({
  required AppEnvironment configuredEnvironment,
  required bool isAndroidRelease,
}) => configuredEnvironment == AppEnvironment.production || isAndroidRelease;

/// Only the authorized graph may carry one exact run identity at native startup.
bool isAllowedShadowInitialRoute(String route) {
  if (const <String>{
    ConsumerRoutes.semanticShadow,
    ConsumerRoutes.ephemeralSemantic,
    ConsumerRoutes.semanticGraph,
  }.contains(route)) {
    return true;
  }
  final Uri? uri = Uri.tryParse(route);
  if (uri == null ||
      uri.hasScheme ||
      uri.hasAuthority ||
      uri.hasFragment ||
      uri.path != ConsumerRoutes.semanticGraph ||
      uri.queryParametersAll.length != 1) {
    return false;
  }
  final List<String>? runIds = uri.queryParametersAll['run_id'];
  return runIds != null &&
      runIds.length == 1 &&
      RegExp(r'^[0-7][0-9A-HJKMNP-TV-Z]{25}$').hasMatch(runIds.single);
}

/// Consumer startup may select only existing, non-authenticated section roots.
bool isAllowedConsumerInitialRoute(String route) => const <String>{
  ConsumerRoutes.feed,
  ConsumerRoutes.development,
  ConsumerRoutes.liveNews,
  ConsumerRoutes.liveSources,
  ConsumerRoutes.contradictions,
}.contains(route);

/// Keeps startup on an existing consumer section in the metadata-only mode.
String selectInitialRoute({
  required String semanticMode,
  required String requestedInitialRoute,
  required bool inspectShadow,
}) {
  if (semanticMode == 'fixture') return '/threads';
  if (inspectShadow) return requestedInitialRoute;
  if (semanticMode == 'unassigned') {
    return isAllowedConsumerInitialRoute(requestedInitialRoute)
        ? requestedInitialRoute
        : ConsumerRoutes.liveNews;
  }
  if (semanticMode == 'disabled' &&
      isAllowedConsumerInitialRoute(requestedInitialRoute)) {
    return requestedInitialRoute;
  }
  return '/';
}

/// Initializes framework services and mounts the application shell.
void bootstrap() {
  WidgetsFlutterBinding.ensureInitialized();
  const String semanticMode = String.fromEnvironment(
    'DIALEKTIK_SEMANTIC_MODE',
    defaultValue: 'disabled',
  );
  const String requestedInitialRoute = String.fromEnvironment(
    'DIALEKTIK_INITIAL_ROUTE',
  );
  const String ownershipMode = String.fromEnvironment(
    'DIALEKTIK_OWNERSHIP_MODE',
    defaultValue: 'corporate',
  );
  final bool personalOwnerMode =
      ownershipMode == 'personal' &&
      semanticMode == 'unassigned' &&
      !requiresPrivateBetaGate(
        configuredEnvironment: AppEnvironmentConfiguration.current,
        isAndroidRelease: _isAndroidRelease,
      );
  final bool privateBetaRequired = requiresPrivateBetaGate(
    configuredEnvironment: AppEnvironmentConfiguration.current,
    isAndroidRelease: _isAndroidRelease,
  );
  final AppEnvironment environment = privateBetaRequired
      ? AppEnvironment.production
      : AppEnvironmentConfiguration.current;
  if (ownershipMode == 'personal' && !personalOwnerMode) {
    throw StateError(
      'Personal ownership requires a non-production unassigned local profile.',
    );
  }
  final bool inspectShadow =
      semanticMode == 'unassigned' &&
      environment != AppEnvironment.production &&
      isAllowedShadowInitialRoute(requestedInitialRoute);
  final String initialRoute = selectInitialRoute(
    semanticMode: semanticMode,
    requestedInitialRoute: requestedInitialRoute,
    inspectShadow: inspectShadow,
  );
  if (privateBetaRequired) {
    const String supabaseUrl = String.fromEnvironment(
      'DIALEKTIK_SUPABASE_URL',
      defaultValue: 'https://vclsswwfhljczxgnsciq.supabase.co',
    );
    const String publishableKey = String.fromEnvironment(
      'DIALEKTIK_SUPABASE_PUBLISHABLE_KEY',
    );
    runApp(
      PrivateBetaGate(
        apiConfiguration: ApiConfiguration.forEnvironment(environment),
        supabaseUrl: supabaseUrl,
        publishableKey: publishableKey,
        initialRoute: initialRoute,
        readOnlyNewsReaderEnabled: const bool.fromEnvironment(
          'DIALEKTIK_NEWS_READER_ENABLED',
          defaultValue: false,
        ),
      ),
    );
    return;
  }
  runApp(
    DialektikApp(
      environment: environment,
      initialRoute: initialRoute,
      personalOwnerModeEnabled: personalOwnerMode,
    ),
  );
}

bool get _isAndroidRelease =>
    kReleaseMode && !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
