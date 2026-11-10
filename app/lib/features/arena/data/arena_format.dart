import 'package:dialektik/features/consumer/data/public_api_models.dart';

/// Removes the technical YouTube suffix from a registered source name.
String arenaSourceName(String name) => name
    .replaceAll(RegExp(r'\s*\(youtube\)\s*', caseSensitive: false), ' ')
    .trim();

/// Relative age with a non-breaking space so the unit never wraps alone.
String arenaAgo(DateTime moment, {DateTime? now}) {
  final Duration age = (now ?? DateTime.now()).difference(moment);
  if (age.isNegative || age.inMinutes < 1) return 'hace un momento';
  if (age.inMinutes < 60) return 'hace ${age.inMinutes} min';
  if (age.inHours < 24) return 'hace ${age.inHours} h';
  if (age.inDays < 30) return 'hace ${age.inDays} d';
  return 'hace ${age.inDays ~/ 30} mes${age.inDays ~/ 30 == 1 ? '' : 'es'}';
}

const List<String> _months = <String>[
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

String arenaDate(DateTime moment) {
  final DateTime local = moment.toLocal();
  return '${local.day} ${_months[local.month - 1]} ${local.year}';
}

String arenaDateTime(DateTime moment) {
  final DateTime local = moment.toLocal();
  final String minute = local.minute.toString().padLeft(2, '0');
  return '${local.day} ${_months[local.month - 1]} · '
      '${local.hour.toString().padLeft(2, '0')}:$minute';
}

/// A literal quote; an inner fragment is marked instead of being capitalised.
String arenaQuote(String quote) {
  final String text = quote.trim();
  if (text.isEmpty) return '';
  final bool fragment = RegExp(r'^[a-záéíóúñü]').hasMatch(text);
  return '“${fragment ? '[...] ' : ''}$text”';
}

/// Editorial topics used for discovery only; they are not quality labels.
enum ArenaTopic {
  politica('Política', 'politica'),
  justicia('Justicia', 'justicia'),
  economia('Economía', 'economia'),
  medioambiente('Medioambiente', null),
  ciencia('Ciencia', null),
  deportes('Deportes', 'deportes'),
  sociedad('Sociedad', 'sociedad'),
  otros('Otros', null);

  const ArenaTopic(this.label, this.serverKey);
  final String label;

  /// Topic key understood by `/live/news?topic=`; null means text search.
  final String? serverKey;
}

// Mirrors LIVE_NEWS_TOPIC_PATTERNS in Core so both sides agree on a topic.
final Map<ArenaTopic, RegExp> _topicPatterns = <ArenaTopic, RegExp>{
  ArenaTopic.justicia: RegExp(
    'justicia|judicial|tribunal|corte|juez|jueza|fiscal|condena|'
    'acusación constitucional|acusacion constitucional|querella',
  ),
  ArenaTopic.deportes: RegExp(
    'deporte|fútbol|futbol|tenis|colo.colo|campeonato|selección|seleccion|'
    'liga|gol|jugador|atleta',
  ),
  ArenaTopic.economia: RegExp(
    'econom|inflación|inflacion|empleo|desempleo|pensión|pension|afp|banco|'
    'dólar|dolar|codelco|empresa|salario|sueldo|despido',
  ),
  ArenaTopic.medioambiente: RegExp(
    'medio ?ambiente|ambiental|clima|climátic|climatic|contaminación|'
    'contaminacion|incendio forestal|sequía|sequia|biodiversidad|glaciar',
  ),
  ArenaTopic.ciencia: RegExp(
    'ciencia|científic|cientific|investigador|astronom|tecnolog|'
    'inteligencia artificial|vacuna|estudio revela',
  ),
  ArenaTopic.politica: RegExp(
    'polític|politic|gobierno|presidente|ministro|congreso|diputad|senador|'
    'elecci|alcald|subsecretar|partido republican',
  ),
  ArenaTopic.sociedad: RegExp(
    'sociedad|salud|educación|educacion|colegio|escuela|vivienda|familia|'
    'niñez|ninez|cultura|mujer|sala cuna|seguridad|delito|carabinero',
  ),
};

ArenaTopic arenaTopicOfText(String text, {String category = ''}) {
  final String normalized = category.toLowerCase();
  for (final ArenaTopic topic in ArenaTopic.values) {
    if (topic.serverKey == normalized ||
        topic.label.toLowerCase() == normalized) {
      return topic;
    }
  }
  final String haystack = text.toLowerCase();
  for (final MapEntry<ArenaTopic, RegExp> entry in _topicPatterns.entries) {
    if (entry.value.hasMatch(haystack)) return entry.key;
  }
  return ArenaTopic.otros;
}

ArenaTopic arenaTopicOfEvent(EventCardDto event) =>
    arenaTopicOfText(event.titleDescriptive, category: event.category);

/// Names written in the coverage itself; a heuristic, never an attribution.
List<String> arenaNamedActors(Iterable<String> texts, {int limit = 6}) {
  final RegExp pattern = RegExp(
    r'\b[A-ZÁÉÍÓÚÑ][a-záéíóúñü]+(?:\s+(?:de|del|la|los|las)\s+)?'
    r'(?:\s?[A-ZÁÉÍÓÚÑ][a-záéíóúñü]+)+|\b[A-ZÁÉÍÓÚÑ]{3,}\b',
  );
  final Map<String, int> counts = <String, int>{};
  for (final String text in texts) {
    for (final RegExpMatch match in pattern.allMatches(text)) {
      final String name = match.group(0)!.trim();
      counts[name] = (counts[name] ?? 0) + 1;
    }
  }
  final List<MapEntry<String, int>> ranked = counts.entries.toList()
    ..sort(
      (MapEntry<String, int> a, MapEntry<String, int> b) =>
          b.value.compareTo(a.value),
    );
  return ranked.take(limit).map((MapEntry<String, int> e) => e.key).toList();
}
