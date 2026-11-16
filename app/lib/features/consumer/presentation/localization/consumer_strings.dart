import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

final class ConsumerStrings {
  const ConsumerStrings(this.locale);

  final Locale locale;

  bool get isSpanish => locale.languageCode == 'es';
  String _pick(String es, String en) => isSpanish ? es : en;

  static ConsumerStrings of(BuildContext context) =>
      Localizations.of<ConsumerStrings>(context, ConsumerStrings) ??
      const ConsumerStrings(Locale('es'));

  String get appName => 'Dialektik';
  String get feedTitle => _pick('Eventos', 'Events');
  String get stories => _pick('Historias', 'Stories');
  String get back => _pick('Volver', 'Back');
  String get demoExplanation => _pick(
    'Datos ficticios de demostración; no son noticias en vivo',
    'Fictional demonstration data; this is not live news',
  );
  String get demoTitle => _pick('Datos de demostración', 'Demonstration data');
  String get close => _pick('Cerrar', 'Close');
  String get feedDescription => _pick(
    'Explora los eventos por categoría, del más reciente al más antiguo.',
    'Explore events by category, from newest to oldest.',
  );
  String get categoryFilter => _pick('Categorías', 'Categories');
  String get topicSearch => _pick('Buscar por tema', 'Search by topic');
  String get hideTopicSearch =>
      _pick('Ocultar búsqueda por tema', 'Hide topic search');
  String get horizontalScrollHint => _pick(
    'Desliza horizontalmente o usa las flechas para ver más categorías.',
    'Swipe horizontally or use the arrow keys to see more categories.',
  );
  String get topicName => _pick('Nombre del tema', 'Topic name');
  String get topicHint => _pick('p. ej., banco central', 'e.g., central bank');
  String get topicSearchScope => _pick(
    'Filtra por el nombre exacto de un tema. No busca en títulos ni textos.',
    'Filter by an exact topic name. This does not search titles or text.',
  );
  String get search => _pick('Buscar', 'Search');
  String get clearTopic => _pick('Quitar tema', 'Clear topic');
  String get topicInputError => _pick(
    'Escribe un nombre de tema, por ejemplo «banco central».',
    'Enter a topic name, for example “central bank”.',
  );
  String get topicTooLong => _pick(
    'Prueba con un nombre de tema más breve.',
    'Try a shorter topic name.',
  );
  String activeTopic(String name) => _pick('Tema: $name', 'Topic: $name');
  String get contradictionsTitle =>
      _pick('Contradicciones publicadas', 'Published contradictions');
  String get allCategories => _pick('Todos', 'All');
  String get retry => _pick('Reintentar', 'Retry');
  String get refresh => _pick('Actualizar', 'Refresh');
  String get loading => _pick('Cargando eventos', 'Loading events');
  String get loadingEvent => _pick('Cargando evento', 'Loading event');
  String get loadingSource => _pick('Cargando fuente', 'Loading source');
  String get loadMore => _pick('Cargar más eventos', 'Load more events');
  String get paginating => _pick('Cargando más eventos', 'Loading more events');
  String get refreshing =>
      _pick('Actualizando contenido', 'Refreshing content');
  String get feedEmpty => _pick(
    'No hay eventos públicos disponibles por ahora.',
    'No public events are available right now.',
  );
  String get filteredFeedEmpty => _pick(
    'No hay eventos para este filtro. Puedes quitarlo para volver al índice completo.',
    'There are no events for this filter. Clear it to return to the full index.',
  );
  String get clearFilter => _pick('Quitar filtro', 'Clear filter');
  String get temporaryError => _pick(
    'El servicio no está disponible temporalmente. El contenido no se reemplazó.',
    'The service is temporarily unavailable. Existing content was not replaced.',
  );
  String get networkError => _pick(
    'No se pudo conectar. Revisa la red e inténtalo de nuevo.',
    'Could not connect. Check the network and try again.',
  );
  String get rateLimited => _pick(
    'Hay demasiadas solicitudes. Espera un momento e inténtalo de nuevo.',
    'There are too many requests. Wait a moment and try again.',
  );
  String get betaAccessDenied => _pick(
    'La sesión venció o esta cuenta no está habilitada para la beta privada.',
    'The session expired or this account is not enabled for the private beta.',
  );
  String get unavailable => _pick(
    'Este recurso ya no está disponible.',
    'This resource is unavailable.',
  );
  String get invalidResponse => _pick(
    'La respuesta pública no coincide con el contrato esperado.',
    'The public response does not match the expected contract.',
  );
  String get pendingAnalysis =>
      _pick('Análisis en curso', 'Analysis in progress');
  String get pendingExplanation => _pick(
    'Este evento está en análisis. Las afirmaciones citadas siguen disponibles, pero todavía no hay Posiciones publicadas ni una conclusión sobre conflicto.',
    'This Event is being analyzed. Cited assertions remain available, but there are no published Positions or conclusions about conflict yet.',
  );
  String get publishedAnalysis =>
      _pick('Análisis publicado', 'Published analysis');
  String get sourceMaterial => _pick('Material de origen', 'Source material');
  String get primaryFact =>
      _pick('Base común publicada', 'Published common basis');
  String get openOriginal =>
      _pick('Abrir publicación original', 'Open original publication');
  String get source => _pick('Fuente', 'Source');
  String get sources => _pick('Fuentes', 'Sources');
  String get positions => _pick('Posiciones publicadas', 'Published Positions');
  String get noPositions => _pick(
    'No hay Posiciones publicadas para este evento.',
    'There are no published Positions for this Event.',
  );
  String get assertions => _pick('Afirmaciones citadas', 'Cited assertions');
  String get noAssertions => _pick(
    'No hay afirmaciones públicas disponibles todavía.',
    'No public assertions are available yet.',
  );
  String get relationships =>
      _pick('Relaciones publicadas', 'Published relationships');
  String get noRelationships => _pick(
    'No hay relaciones publicadas para este evento. Esto no implica acuerdo ni desacuerdo.',
    'There are no published relationships for this Event. This does not imply agreement or disagreement.',
  );
  String get partialConflict => _pick(
    'El conflicto publicado se limita a las afirmaciones citadas; no se extiende automáticamente a toda la Posición.',
    'The published conflict is limited to the cited assertions; it does not automatically extend to the whole Position.',
  );
  String get noContradictions => _pick(
    'No hay contradicciones publicadas. La ausencia de una publicación no implica acuerdo.',
    'There are no published contradictions. Absence of a publication does not imply agreement.',
  );
  String get needsReview => _pick(
    'Estado editorial: requiere revisión',
    'Editorial state: review required',
  );
  String get currentPublication =>
      _pick('Estado editorial: publicada', 'Editorial state: published');
  String get expandPosition =>
      _pick('Abrir detalle de Posición', 'Open Position detail');
  String get collapsePosition =>
      _pick('Cerrar detalle de Posición', 'Close Position detail');
  String get positionDetailError => _pick(
    'No se pudo cargar el detalle de esta Posición.',
    'This Position detail could not be loaded.',
  );
  String get noEvidenceYet => _pick(
    'Aún no hay evidencia aportada. Esto no es una evaluación de la Posición.',
    'No evidence has been contributed yet. This is not an evaluation of the Position.',
  );
  String get evidenceInconclusive => _pick(
    'El material disponible es inconcluyente. Esto no determina qué Posición es correcta.',
    'The available material is inconclusive. This does not determine which Position is correct.',
  );
  String get notEvaluable => _pick(
    'Esta parte es una valoración, no un dato comprobable: la evidencia no puede confirmarla ni contradecirla.',
    'This part is an assessment, not a verifiable fact: evidence cannot confirm or contradict it.',
  );
  String get quotationFrom => _pick('Cita de', 'Quotation from');
  String get attribution => _pick('Atribución', 'Attribution');
  String get articlePublished =>
      _pick('Artículo publicado', 'Article published');
  String get eventDetected => _pick('Evento detectado', 'Event detected');
  String get eventWindow => _pick('Ventana del evento', 'Event window');
  String get historicalEvent => _pick('Evento histórico', 'Historical Event');
  String get historicalExplanation => _pick(
    'Este identificador fue reemplazado. El contenido anterior no se presenta como actual.',
    'This identifier was replaced. Previous content is not presented as current.',
  );
  String get openSuccessor =>
      _pick('Abrir evento vigente', 'Open current Event');
  String get backToFeed => _pick('Volver a Eventos', 'Back to Events');
  String get openContradictions =>
      _pick('Abrir contradicciones', 'Open contradictions');
  String get sourceType => _pick('Tipo de fuente', 'Source type');
  String sourceTypeLabel(String value) => switch (value) {
    'news_agency' => _pick('Agencia de noticias', 'News agency'),
    'other' => _pick('Otra', 'Other'),
    _ => value.replaceAll('_', ' ').replaceAll('-', ' '),
  };
  String get sourceLimit => _pick(
    'Esta ficha describe la identidad de la fuente.',
    'This profile describes the Source identity.',
  );
  String get externalLinkFailed => _pick(
    'No se pudo abrir el enlace original. La cita permanece disponible.',
    'The original link could not be opened. The quotation remains available.',
  );
  String get provenanceExplanation => _pick(
    'El texto se conserva como cita de la fuente; no es la voz de Dialektik ni una interpretación normalizada.',
    'The text is preserved as a quotation from the Source; it is not Dialektik’s voice or a normalized interpretation.',
  );

  String categoryName(String slug) => switch (slug) {
    'pais' => _pick('País', 'Country'),
    'internacional' => _pick('Internacional', 'International'),
    'deportes' => _pick('Deportes', 'Sports'),
    'ciencia' => _pick('Ciencia', 'Science'),
    'tecnologia' => _pick('Tecnología', 'Technology'),
    'economia' => _pick('Economía', 'Economy'),
    _ => slug,
  };

  String eventSemantics(String title, String state) =>
      _pick('Evento: $title. Estado: $state.', 'Event: $title. State: $state.');
  String positionIndex(int ordinal, int total) =>
      _pick('Posición $ordinal de $total', 'Position $ordinal of $total');
  String assertionIndex(int ordinal) => _pick(
    'Afirmación $ordinal en esta cita',
    'Assertion $ordinal in this quotation',
  );
  String sourceCount(int count) =>
      _pick('$count fuentes registradas', '$count recorded Sources');
  String positionCount(int count) =>
      _pick('$count Posiciones publicadas', '$count published Positions');
  String detected(DateTime value) =>
      '$eventDetected · ${formatDateTime(value)}';
  String window(DateTime from, DateTime? to) =>
      '$eventWindow · ${formatDateTime(from)}${to == null ? '' : ' — ${formatDateTime(to)}'}';
  String published(DateTime value) =>
      '$articlePublished · ${formatDateTime(value)}';
  String formatDateTime(DateTime value) =>
      DateFormat.yMMMd(locale.languageCode).add_Hm().format(value.toLocal());

  String relationshipType(String value) => switch (value) {
    'r01a' => _pick(
      'Equivalencia estricta publicada',
      'Published strict equivalence',
    ),
    'r05' => _pick('Conflicto publicado', 'Published conflict'),
    'r06' => _pick(
      'No comparable: contexto distinto',
      'Not comparable: different context',
    ),
    'r07' => _pick(
      'No comparable: escala distinta',
      'Not comparable: different scale',
    ),
    'r11a' => _pick('Rectificación publicada', 'Published rectification'),
    'r11b' => _pick(
      'Evolución ante nueva evidencia',
      'Evolution with new evidence',
    ),
    _ => value,
  };

  String relationshipScope(String value) => switch (value) {
    'intraEvent' => _pick('Dentro del evento', 'Within the Event'),
    'crossEvent' => _pick('Entre eventos', 'Across Events'),
    'intraArticle' => _pick('Dentro del artículo', 'Within the Article'),
    _ => value,
  };

  String errorForName(String name) => switch (name) {
    'network' => networkError,
    'rateLimited' => rateLimited,
    'unauthorized' => betaAccessDenied,
    'notFound' => unavailable,
    'invalidResponse' => invalidResponse,
    _ => temporaryError,
  };
}

final class ConsumerStringsDelegate
    extends LocalizationsDelegate<ConsumerStrings> {
  const ConsumerStringsDelegate();

  @override
  bool isSupported(Locale locale) =>
      locale.languageCode == 'es' || locale.languageCode == 'en';

  @override
  Future<ConsumerStrings> load(Locale locale) =>
      SynchronousFuture<ConsumerStrings>(ConsumerStrings(locale));

  @override
  bool shouldReload(ConsumerStringsDelegate old) => false;
}

const List<Locale> consumerSupportedLocales = <Locale>[
  Locale('es'),
  Locale('en'),
];

const List<String> consumerCategorySlugs = <String>[
  'pais',
  'internacional',
  'deportes',
  'ciencia',
  'tecnologia',
  'economia',
];
