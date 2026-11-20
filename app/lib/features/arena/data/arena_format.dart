import 'package:dialektik/features/consumer/data/public_api_models.dart';

/// Removes the technical YouTube suffix from a registered source name.
String arenaSourceName(String name) => name
    .replaceAll(RegExp(r'\s*\(youtube\)\s*', caseSensitive: false), ' ')
    .trim();

/// Relative age with a non-breaking space so the unit never wraps alone.
String arenaAgo(DateTime moment, {DateTime? now}) {
  final Duration age = (now ?? DateTime.now()).difference(moment);
  if (age.isNegative || age.inMinutes < 1) return 'hace un momento';
  // Fully non-breaking, so «hace 1 h» never splits across two lines.
  if (age.inMinutes < 60) return 'hace\u00A0${age.inMinutes}\u00A0min';
  if (age.inHours < 24) return 'hace\u00A0${age.inHours}\u00A0h';
  if (age.inDays < 30) return 'hace\u00A0${age.inDays}\u00A0d';
  return 'hace\u00A0${age.inDays ~/ 30}\u00A0mes${age.inDays ~/ 30 == 1 ? '' : 'es'}';
}

final RegExp _titlePrefix = RegExp(
  r'^\s*(?:Contraste de enfoques|Contradicci[oó]n)\s*:\s*',
  caseSensitive: false,
);

/// Title without the relation prefix Core adds; the pill already says it.
String arenaTitle(String title) =>
    arenaHeadline(title.replaceFirst(_titlePrefix, ''));

// Branding that YouTube and some feeds append to a headline: «… | 24»,
// «… | CNN Chile», «… - Análisis.». It is the channel, not what was said;
// the original text stays in the acquisition receipt.
// Up to three words, each starting with a capital or a digit, so a «|»
// inside the sentence itself is kept.
final RegExp _channelSuffix = RegExp(
  r'\s+\|\s+[A-ZÁÉÍÓÚÑ0-9][\wáéíóúñ.]*(?:\s+[A-ZÁÉÍÓÚÑ0-9][\wáéíóúñ.]*){0,2}$',
);
final RegExp _sectionSuffix = RegExp(
  r'\s+[-–—]\s+(?:an[aá]lisis|video|entrevista|en vivo|opini[oó]n|columna)\.?$',
  caseSensitive: false,
);

/// A headline without channel or section branding at its end.
String arenaHeadline(String headline) {
  String text = headline.trim();
  for (int i = 0; i < 2; i++) {
    text = text
        .replaceFirst(_channelSuffix, '')
        .replaceFirst(_sectionSuffix, '')
        .trim();
  }
  return text;
}

extension ArenaEventTitle on EventCardDto {
  String get arenaTitle => arenaTitleOf(titleDescriptive);
}

String arenaTitleOf(String title) => arenaTitle(title);

/// Below this length a quote or summary is a loose fragment, not a position.
const int arenaMinimumQuoteLength = 40;

/// Text that represents one posture. A literal quote is used when it says
/// enough; otherwise the headline of that source's publication, so a card
/// never shows two loose words such as «nuevo cargo».
({String text, bool literal}) arenaPostureText(
  EventDetailDto event,
  EventCoveragePositionDto? position,
) {
  if (position == null) return (text: 'Cita no disponible.', literal: false);
  final EventCoverageAssertionDto? first = position.assertions.firstOrNull;
  final String quote = first?.quotedText.trim() ?? '';
  if (quote.length >= arenaMinimumQuoteLength) {
    return (text: quote, literal: true);
  }
  if (first != null) {
    final ({String text, bool literal}) fallback = arenaAssertionText(
      event,
      first,
    );
    if (!fallback.literal || fallback.text.length > quote.length) {
      return fallback;
    }
  }
  final String title = position.title.trim();
  if (title.length >= quote.length && title.isNotEmpty) {
    return (text: title, literal: false);
  }
  return (text: quote, literal: quote.isNotEmpty);
}

/// The quote of one assertion, or its publication headline when too short.
({String text, bool literal}) arenaAssertionText(
  EventDetailDto event,
  EventCoverageAssertionDto assertion,
) {
  final String quote = assertion.quotedText.trim();
  if (quote.length >= arenaMinimumQuoteLength) {
    return (text: quote, literal: true);
  }
  for (final EventCoverageArticleDto article in event.articles) {
    if (article.id == assertion.articleId &&
        article.title.trim().length > quote.length) {
      return (text: article.title.trim(), literal: false);
    }
  }
  for (final EventCoverageArticleDto article in event.articles) {
    final bool sameSource = assertion.sourceId != null
        ? article.sourceId == assertion.sourceId
        : article.sourceName == assertion.sourceName;
    if (sameSource && article.title.trim().length > quote.length) {
      return (text: article.title.trim(), literal: false);
    }
  }
  return (text: quote, literal: quote.isNotEmpty);
}

/// Substantive summary of a posture: its title when it says enough.
String arenaPositionSummary(
  EventDetailDto event,
  EventCoveragePositionDto position,
) {
  final String title = position.title.trim();
  return title.length >= arenaMinimumQuoteLength
      ? title
      : arenaPostureText(event, position).text;
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

/// A literal quote inside «», so the “” of a quote within it stay distinct.
/// An inner fragment is marked instead of being capitalised, and nothing is
/// added to its punctuation.
String arenaQuote(String quote) {
  final String text = arenaHeadline(quote);
  if (text.isEmpty) return '';
  final bool fragment = RegExp(r'^[a-záéíóúñü]').hasMatch(text);
  return '«${fragment ? '[...] ' : ''}$text»';
}

/// Editorial topics used for discovery only; they are not quality labels.
enum ArenaTopic {
  politica('Política', 'politica'),
  internacional('Internacional', null),
  justicia('Justicia', 'justicia'),
  economia('Economía', 'economia'),
  seguridad('Seguridad', 'seguridad'),
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

// Based on LIVE_NEWS_TOPIC_PATTERNS in Core. Political process words come
// first so a constitutional accusation or a committee vote is not filed
// under «Otros» or mistaken for a court case.
final Map<ArenaTopic, RegExp> _topicPatterns = <ArenaTopic, RegExp>{
  // First: a summit or a foreign government is international even when a
  // Chilean president or minister takes part («Kast en la cumbre APEC»).
  ArenaTopic.internacional: RegExp(
    r'\bapec\b|cumbre|\bonu\b|naciones unidas|\botan\b|\bchina\b|\bchino|'
    r'xi jinping|estados unidos|ee\.\s?uu|\beeuu\b|casa blanca|\btrump\b|'
    r'\bputin\b|\brusia|kremlin|ucrania|\bir[aá]n\b|israel|\bgaza\b|'
    r'venezuela|\bmaduro\b|\bmilei\b|uni[oó]n europea|bruselas|cancill|'
    r'embajad|diplom[aá]tic',
  ),
  ArenaTopic.politica: RegExp(
    'polític|politic|gobierno|presidente|ministr|congreso|diputad|senado|'
    'elecci|alcald|subsecretar|partido republican|oposición|oposicion|'
    'comisión|comision|acusación constitucional|acusacion constitucional|'
    'rabat|oficialismo|parlamentari|encuesta|sondeo|cadem|aprobación|'
    'aprobacion|desaprobación|desaprobacion|gabinete|la moneda|mandatari',
  ),
  ArenaTopic.justicia: RegExp(
    'justicia|judicial|tribunal|corte|juez|jueza|fiscal|condena|querella',
  ),
  ArenaTopic.deportes: RegExp(
    'deporte|fútbol|futbol|tenis|colo.colo|campeonato|selección|seleccion|'
    'liga|gol|jugador|atleta',
  ),
  ArenaTopic.economia: RegExp(
    'econom|inflación|inflacion|empleo|desempleo|pensión|pension|afp|banco|'
    'dólar|dolar|codelco|empresa|salario|sueldo|despido',
  ),
  ArenaTopic.seguridad: RegExp(
    'seguridad|delito|polic|carabinero|crimen|robo|asalto|homicid|detenido|'
    'balacera|siniestro',
  ),
  ArenaTopic.medioambiente: RegExp(
    'medio ?ambiente|ambiental|clima|climátic|climatic|contaminación|'
    'contaminacion|incendio forestal|sequía|sequia|biodiversidad|glaciar',
  ),
  ArenaTopic.ciencia: RegExp(
    'ciencia|científic|cientific|investigador|astronom|tecnolog|'
    'inteligencia artificial|vacuna|estudio revela',
  ),
  ArenaTopic.sociedad: RegExp(
    'sociedad|salud|educación|educacion|colegio|escuela|vivienda|familia|'
    'niñez|ninez|cultura|mujer|sala cuna',
  ),
};

// «AC» as the usual abbreviation of a constitutional accusation.
final RegExp _accusationAbbreviation = RegExp(r'\bAC\b');

ArenaTopic arenaTopicOfText(String text, {String category = ''}) {
  final String normalized = category.toLowerCase();
  // «Otros» from Core is no answer: the headline may still say the topic.
  for (final ArenaTopic topic in ArenaTopic.values.where(
    (ArenaTopic t) => t != ArenaTopic.otros,
  )) {
    if (topic.serverKey == normalized ||
        topic.label.toLowerCase() == normalized) {
      return topic;
    }
  }
  if (_accusationAbbreviation.hasMatch(text)) return ArenaTopic.politica;
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

/// «La Tercera: balance…» shown under «La Tercera» reads twice; the outlet
/// prefix is dropped when the card already names the outlet.
String arenaWithoutSourcePrefix(String headline, String sourceName) {
  final String name = arenaSourceName(sourceName).toLowerCase();
  final String trimmed = headline.trim();
  for (final String separator in const <String>[': ', ' | ', ' - ']) {
    final int at = trimmed.indexOf(separator);
    if (at > 0 && trimmed.substring(0, at).trim().toLowerCase() == name) {
      final String rest = trimmed.substring(at + separator.length).trim();
      if (rest.isNotEmpty) return rest;
    }
  }
  return trimmed;
}

/// The one clock of a story, in its list card and inside it: when its
/// newest coverage was published. [fallback] only without coverage.
DateTime arenaLastCoverage(
  Iterable<EventCoverageArticleDto> articles, {
  required DateTime fallback,
}) {
  DateTime? newest;
  for (final EventCoverageArticleDto a in articles) {
    if (newest == null || a.publishedAt.isAfter(newest)) newest = a.publishedAt;
  }
  return newest ?? fallback;
}

/// The newest-first [items] with at most [maxRun] in a row from one outlet:
/// an item that would extend a run waits for the next item of another
/// outlet. Nothing is dropped, and each outlet keeps its own order.
List<T> arenaInterleaveByOutlet<T>(
  List<T> items,
  String Function(T) outletOf, {
  int maxRun = 2,
}) {
  final List<T> pending = List<T>.of(items);
  final List<T> result = <T>[];
  while (pending.isNotEmpty) {
    final int run = result.length < maxRun
        ? 0
        : result.sublist(result.length - maxRun).map(outletOf).toSet().length ==
              1
        ? maxRun
        : 0;
    final String? blocked = run == maxRun ? outletOf(result.last) : null;
    final int next = blocked == null
        ? 0
        : pending.indexWhere((T item) => outletOf(item) != blocked);
    result.add(pending.removeAt(next < 0 ? 0 : next));
  }
  return result;
}
