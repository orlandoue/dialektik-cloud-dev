import 'dart:async';

import 'package:dialektik/features/live/data/market_preference_io.dart'
    if (dart.library.js_interop) 'package:dialektik/features/live/data/market_preference_web.dart'
    as preference;
import 'package:flutter/foundation.dart';

/// One country of the verified media catalog, as the selector shows it.
typedef CatalogCountry = ({String code, String flag, String name});

/// Shared selection of the publisher's market; NOT event location.
/// Switching markets never invents articles or silently falls back to Chile.
final class PublisherMarketSelection extends ValueNotifier<String> {
  PublisherMarketSelection() : super('CL');

  static const Set<String> availableCodes = <String>{
    'CL',
    'PE',
    'AR',
    'CO',
    'MX',
    'ES',
    'BO',
    'BR',
    'CR',
    'CU',
    'DO',
    'EC',
    'GT',
    'HN',
    'NI',
    'PA',
    'PY',
    'SV',
    'UY',
    'VE',
    'US',
  };

  /// Countries with verified, licensed coverage (Coliseo, VS, Historias,
  /// Explorar and Medios all switch together).
  static const List<CatalogCountry> catalogCountries = <CatalogCountry>[
    (code: 'CL', flag: '🇨🇱', name: 'Chile'),
    (code: 'ES', flag: '🇪🇸', name: 'España'),
    (code: 'AR', flag: '🇦🇷', name: 'Argentina'),
    (code: 'US', flag: '🇺🇸', name: 'EE. UU.'),
  ];

  /// Countries open in this beta. The others stay in the catalog but are
  /// paused (shown as «Pronto») to keep the free-tier servers on Chile.
  static const Set<String> activeCountryCodes = <String>{'CL'};

  static bool isActiveCountry(String code) => activeCountryCodes.contains(code);

  static CatalogCountry countryOf(String code) => catalogCountries.firstWhere(
    (CatalogCountry country) => country.code == code,
    orElse: () => catalogCountries.first,
  );

  static bool isCatalogCountry(String code) =>
      catalogCountries.any((CatalogCountry country) => country.code == code);

  void select(String code) {
    if (!availableCodes.contains(code)) {
      throw ArgumentError.value(code, 'code', 'Unsupported publisher market');
    }
    value = code;
  }

  /// Selects a catalog country and remembers it on this device.
  void choose(String code) {
    select(code);
    if (isCatalogCountry(code)) {
      unawaited(preference.writeMarket(code).catchError((Object _) {}));
    }
  }

  /// Restores the country chosen on an earlier launch, if any.
  Future<void> restore() async {
    try {
      final String? saved = await preference.readMarket();
      if (saved != null && isActiveCountry(saved) && saved != value) {
        value = saved;
      }
    } on Object {
      // No stored preference (first launch, tests, blocked storage).
    }
  }
}
