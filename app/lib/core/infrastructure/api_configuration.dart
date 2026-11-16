import 'package:dialektik/core/infrastructure/app_environment.dart';

/// The only place where the consumer API origin is resolved.
final class ApiConfiguration {
  const ApiConfiguration({required this.baseUri});

  factory ApiConfiguration.forEnvironment(AppEnvironment environment) {
    if (_definedBaseUrl.isNotEmpty) {
      return ApiConfiguration.forBaseUrl(_definedBaseUrl, environment);
    }
    if (environment == AppEnvironment.production) {
      throw StateError(
        'DIALEKTIK_API_BASE_URL is required for production builds.',
      );
    }
    return ApiConfiguration(baseUri: Uri.parse('http://127.0.0.1:3100'));
  }

  factory ApiConfiguration.fromBaseUrl(String value) {
    return ApiConfiguration(baseUri: _parse(value));
  }

  factory ApiConfiguration.forBaseUrl(
    String value,
    AppEnvironment environment,
  ) {
    final Uri baseUri = _parse(value);
    if (environment == AppEnvironment.production && baseUri.scheme != 'https') {
      throw StateError('Production API requests must use HTTPS.');
    }
    return ApiConfiguration(baseUri: baseUri);
  }

  static const String _definedBaseUrl = String.fromEnvironment(
    'DIALEKTIK_API_BASE_URL',
  );

  final Uri baseUri;

  Uri resolve(String path, [Map<String, String>? query]) {
    final String root = baseUri.toString().replaceFirst(RegExp(r'/$'), '');
    final Uri resolved = Uri.parse('$root$path');
    return query == null || query.isEmpty
        ? resolved
        : resolved.replace(queryParameters: query);
  }

  static Uri _parse(String value) {
    final Uri uri = Uri.parse(value);
    if (!uri.hasScheme || !uri.hasAuthority) {
      throw FormatException('The API base URL must be an absolute URI.');
    }
    if (uri.scheme != 'http' && uri.scheme != 'https') {
      throw FormatException('The API base URL must use HTTP or HTTPS.');
    }
    return uri.replace(path: uri.path.replaceFirst(RegExp(r'/$'), ''));
  }
}
