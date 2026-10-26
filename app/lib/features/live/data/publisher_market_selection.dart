import 'package:flutter/foundation.dart';

/// Shared, in-memory selection of the publisher's market; NOT event location.
/// Switching markets never invents articles or silently falls back to Chile.
final class PublisherMarketSelection extends ValueNotifier<String> {
  PublisherMarketSelection() : super('CL');

  static const Set<String> availableCodes = <String>{
    'CL', 'PE', 'AR', 'CO', 'MX', 'ES', 'BO', 'BR', 'CR', 'CU',
    'DO', 'EC', 'GT', 'HN', 'NI', 'PA', 'PY', 'SV', 'UY', 'VE',
  };

  void select(String code) {
    if (!availableCodes.contains(code)) {
      throw ArgumentError.value(code, 'code', 'Unsupported publisher market');
    }
    value = code;
  }
}
