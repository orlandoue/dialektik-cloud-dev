/// Runtime environments understood by the application shell.
///
/// This is deliberately infrastructure-only. It carries no product behavior
/// and can be replaced when deployment environments are defined.
enum AppEnvironment { development, test, production }

/// Compile-time environment selector used by the executable bootstrap.
abstract final class AppEnvironmentConfiguration {
  static const String _configured = String.fromEnvironment(
    'DIALEKTIK_ENVIRONMENT',
    defaultValue: 'development',
  );

  static AppEnvironment get current => switch (_configured) {
    'development' => AppEnvironment.development,
    'test' => AppEnvironment.test,
    'production' => AppEnvironment.production,
    _ => throw StateError(
      'DIALEKTIK_ENVIRONMENT must be development, test, or production.',
    ),
  };
}
