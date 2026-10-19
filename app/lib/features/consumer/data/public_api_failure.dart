import 'package:dialektik/features/consumer/data/public_api_models.dart';

enum PublicFailureKind {
  invalidRequest,
  notFound,
  analysisUnavailable,
  gone,
  rateLimited,
  unauthorized,
  serviceUnavailable,
  network,
  invalidResponse,
  cancelled,
}

/// Safe failure exposed by the public transport boundary.
///
/// Response bodies, request IDs, SQL, stack traces and internal diagnostics do
/// not cross into presentation state.
final class PublicApiFailure implements Exception {
  const PublicApiFailure({
    required this.kind,
    this.statusCode,
    this.code,
    this.tombstone,
  });

  final PublicFailureKind kind;
  final int? statusCode;
  final String? code;
  final TombstoneDto? tombstone;

  bool get canRetry =>
      kind == PublicFailureKind.network ||
      kind == PublicFailureKind.rateLimited ||
      kind == PublicFailureKind.serviceUnavailable;

  @override
  String toString() => 'PublicApiFailure(${kind.name}, $statusCode, $code)';
}

/// Cooperative cancellation prevents obsolete responses from becoming UI.
final class PublicRequestToken {
  bool _isCancelled = false;

  bool get isCancelled => _isCancelled;

  void cancel() => _isCancelled = true;

  void throwIfCancelled() {
    if (_isCancelled) {
      throw const PublicApiFailure(kind: PublicFailureKind.cancelled);
    }
  }
}
