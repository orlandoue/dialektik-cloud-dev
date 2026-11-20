import 'package:dialektik/features/science/data/science_models.dart';
import 'package:intl/intl.dart';

const List<String> _months = <String>[
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sept',
  'oct',
  'nov',
  'dic',
];

/// «10 nov».
String sciShortDate(DateTime moment) {
  final DateTime local = moment.toLocal();
  return '${local.day} ${_months[local.month - 1]}';
}

/// A study's date with only what the source gives: «2026», «ene 2026» or
/// «10 nov» (short) / «10 nov 2026» (long).
String sciStudyDate(Study study, {bool long = false, DateTime? now}) {
  final DateTime? date = study.publishedAt;
  if (date == null) return notInformed;
  // Some repositories carry the year of a coming issue: say it is ahead
  // instead of showing a date that has not happened.
  if (date.isAfter(now ?? DateTime.now())) {
    return 'publicación prevista para ${date.year}';
  }
  return switch (study.publishedPrecision) {
    DatePrecision.year => '${date.year}',
    DatePrecision.month => '${_months[date.month - 1]} ${date.year}',
    DatePrecision.day => long ? sciLongDate(date) : sciShortDate(date),
  };
}

/// «10 nov 2026».
String sciLongDate(DateTime moment) =>
    '${sciShortDate(moment)} ${moment.toLocal().year}';

/// «hace 2 h», «hace 40 min», «hace 3 d».
String sciAgo(DateTime moment, {DateTime? now}) {
  final Duration age = (now ?? DateTime.now()).difference(moment);
  if (age.inMinutes < 1) return 'ahora';
  if (age.inMinutes < 60) return 'hace ${age.inMinutes} min';
  if (age.inHours < 24) return 'hace ${age.inHours} h';
  return 'hace ${age.inDays} d';
}

/// «hace 1 hora» for screen readers.
String sciAgoSpoken(DateTime moment, {DateTime? now}) {
  final Duration age = (now ?? DateTime.now()).difference(moment);
  String unit(int n, String one, String many) =>
      Intl.plural(n, one: 'hace $n $one', other: 'hace $n $many');
  if (age.inMinutes < 1) return 'ahora';
  if (age.inMinutes < 60) return unit(age.inMinutes, 'minuto', 'minutos');
  if (age.inHours < 24) return unit(age.inHours, 'hora', 'horas');
  return unit(age.inDays, 'día', 'días');
}

String connectedStoriesLabel(int n) => Intl.plural(
  n,
  one: 'Conectado a $n historia',
  other: 'Conectado a $n historias',
);

String moreRepliesLabel(int n) =>
    Intl.plural(n, one: 'Ver $n respuesta más', other: 'Ver $n respuestas más');

String mediaCountLabel(int n) =>
    Intl.plural(n, one: '$n medio', other: '$n medios');

/// «n = 657 461» with a thin grouping space.
String sampleLabel(int? n) {
  if (n == null) return notInformed;
  final String digits = n.toString();
  final StringBuffer out = StringBuffer();
  for (int i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) out.write(' ');
    out.write(digits[i]);
  }
  return 'n = $out';
}

/// Tags of a study card: status, design, population · n, place.
List<String> studyTagLabels(Study study) => <String>[
  if (study.retracted) 'Retractado',
  // Always said, the most useful fact for a reader: «Revisión no informada»
  // when the source does not say (never assumed either way).
  study.reviewLabel,
  ?study.design,
  if (study.population != null)
    study.sampleSize == null
        ? study.population!
        : '${study.population} · ${sampleLabel(study.sampleSize)}',
  if (study.madeInChile) 'Hecha en Chile',
];

/// A journal or repository without its long parenthetical owner:
/// «Zenodo (CERN European Organization for Nuclear Research)» → «Zenodo».
String sciVenue(String venue) =>
    venue.replaceFirst(RegExp(r'\s*\([^)]{12,}\)\s*$'), '').trim();
