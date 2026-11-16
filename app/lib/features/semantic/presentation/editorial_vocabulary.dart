/// Presentation-only language for the authored demonstration world.
/// Original DTO values and source text remain untouched.
enum EditorialFixtureProfile { demo, stress }

/// Selected by the authorized fixture build, never guessed from an Article.
EditorialFixtureProfile get editorialConfiguredFixtureProfile {
  const String configured = String.fromEnvironment(
    'DIALEKTIK_SEMANTIC_PROFILE',
    defaultValue: 'demo',
  );
  return switch (configured) {
    'demo' => EditorialFixtureProfile.demo,
    'stress' => EditorialFixtureProfile.stress,
    _ => throw StateError('Perfil sintético de producto desconocido.'),
  };
}

const String _fixtureMarker = ' · sintético';
const List<String> _knownLocalities = <String>['Puerto Claro', 'Villa Nube'];

String _withoutFixtureMarker(String value) {
  final String trimmed = value.trim();
  return trimmed.endsWith(_fixtureMarker)
      ? trimmed.substring(0, trimmed.length - _fixtureMarker.length).trimRight()
      : trimmed;
}

String editorialSourceName(String value) => _withoutFixtureMarker(value);

/// Returns a locality only when the existing fixture title explicitly names it.
String? editorialLocality(String value) {
  final String title = _withoutFixtureMarker(value);
  for (final String locality in _knownLocalities) {
    final String prefix = '$locality · ';
    if (title.startsWith(prefix) && title.length > prefix.length) {
      return locality;
    }
  }
  return null;
}

/// A middle dot in an arbitrary news headline is never treated as a delimiter.
String editorialTitle(String value) {
  final String title = _withoutFixtureMarker(value);
  final String? locality = editorialLocality(title);
  if (locality == null) {
    return title;
  }
  final String headline = title.substring('$locality · '.length);
  return '${headline[0].toUpperCase()}${headline.substring(1)}';
}

/// Removes only the authored fixture's known framing sentences.
String editorialSummary(String value) {
  String summary = value.trim();
  const List<String> introductions = <String>[
    'Demostración sintética de un proceso acotado: ',
    'Demostración sintética con ',
    'Demostración sintética independiente: ',
  ];
  for (final String introduction in introductions) {
    if (summary.startsWith(introduction)) {
      summary = summary.substring(introduction.length);
      break;
    }
  }
  const String repeatedEnding = ' Cada etapa es una ocurrencia distinta.';
  if (summary.endsWith(repeatedEnding)) {
    summary = summary.substring(0, summary.length - repeatedEnding.length);
  }
  if (summary.isEmpty) {
    return summary;
  }
  return '${summary[0].toUpperCase()}${summary.substring(1)}';
}

/// Reader dates use the device's local clock. Exact detail preserves UTC,
/// including timestamp precision, without replacing the displayed source value.
String editorialDate(
  DateTime value, {
  bool includeTime = false,
  bool exact = false,
  bool relative = true,
}) {
  if (exact) {
    return '${value.toUtc().toIso8601String()} (UTC)';
  }
  final DateTime local = value.toLocal();
  final DateTime now = DateTime.now();
  final DateTime today = DateTime(now.year, now.month, now.day);
  final DateTime day = DateTime(local.year, local.month, local.day);
  const List<String> months = <String>[
    'ene',
    'feb',
    'mar',
    'abr',
    'may',
    'jun',
    'jul',
    'ago',
    'sep',
    'oct',
    'nov',
    'dic',
  ];
  final String date;
  if (relative && day == today) {
    date = 'Hoy';
  } else if (relative &&
      day == DateTime(today.year, today.month, today.day - 1)) {
    date = 'Ayer';
  } else {
    final String year = local.year == now.year ? '' : ' ${local.year}';
    date = '${local.day} ${months[local.month - 1]}$year';
  }
  if (!includeTime) {
    return date;
  }
  final String hour = local.hour.toString().padLeft(2, '0');
  final String minute = local.minute.toString().padLeft(2, '0');
  return '$date · $hour:$minute';
}

String editorialCount(int value, String singular, String plural) =>
    '$value ${value == 1 ? singular : plural}';
