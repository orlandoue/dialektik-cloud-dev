import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/live/presentation/live_components.dart';
import 'package:dialektik/features/semantic/presentation/editorial_components.dart';
import 'package:dialektik/features/semantic_shadow/data/ephemeral_semantic_models.dart';
import 'package:dialektik/features/semantic_shadow/data/ephemeral_semantic_repository.dart';
import 'package:flutter/material.dart';

// dialektik:epistemic-component
final class EphemeralSemanticScreen extends StatefulWidget {
  const EphemeralSemanticScreen({
    required this.repository,
    required this.onOpenArticle,
    required this.onOpenSource,
    super.key,
  });
  final EphemeralSemanticRepository repository;
  final ValueChanged<String> onOpenArticle, onOpenSource;
  @override
  State<EphemeralSemanticScreen> createState() =>
      _EphemeralSemanticScreenState();
}

final class _EphemeralSemanticScreenState
    extends State<EphemeralSemanticScreen> {
  final PublicRequestToken _token = PublicRequestToken();
  late final Future<EphemeralSemanticDto> _future = widget.repository
      .getEphemeralSemanticContent(requestToken: _token);
  @override
  void dispose() {
    _token.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => EditorialScaffold(
    title: 'Memoria semántica',
    eyebrow: 'SHADOW · NO AUTORITATIVO',
    location: 'Inspección de desarrollo',
    dataIndicator: const Text('Vista de inspección'),
    homeRoute: '/live/news',
    homeLabel: 'Noticias',
    scrollKey: const PageStorageKey<String>('ephemeral-semantic-memory'),
    child: FutureBuilder<EphemeralSemanticDto>(
      future: _future,
      builder: (BuildContext context, AsyncSnapshot<EphemeralSemanticDto> snapshot) {
        if (snapshot.hasError) {
          return const EditorialEmptyState(
            title: 'No pudimos verificar la memoria semántica.',
            description:
                'Vuelve a las noticias. No se muestra texto descartado ni resultados sin procedencia.',
          );
        }
        final EphemeralSemanticDto? data = snapshot.data;
        if (data == null) {
          return const EditorialLoading();
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const SectionHeading(title: 'El texto se consulta en la fuente'),
            const Text(
              'El acceso al texto, su almacenamiento y el procesamiento semántico tienen permisos independientes. El texto completo efímero no se conserva ni se muestra aquí.',
            ),
            EditorialTextButton(
              onPressed: () =>
                  Navigator.of(context).pushNamed('/shadow/semantic/graph'),
              child: const Text('Explorar grafo de una ejecución sellada'),
            ),
            const SizedBox(height: EditorialLayout.sectionGap),
            for (final EphemeralRunSummary run in data.runSummaries)
              _runSummary(run),
            if (!data.articles.any(
              (EphemeralArticleDto a) => a.envelope != null,
            )) ...<Widget>[
              const SectionHeading(title: 'Aún no hay memoria semántica real'),
              const Text(
                'Los metadatos y extractos RSS no constituyen un input completo para V10.11. Ausencia de procesamiento no significa UNKNOWN.',
              ),
              const SizedBox(height: EditorialLayout.sectionGap),
            ],
            for (final EphemeralArticleDto article in data.articles)
              _article(context, article),
          ],
        );
      },
    ),
  );

  Widget _runSummary(EphemeralRunSummary run) => Padding(
    padding: const EdgeInsets.only(bottom: EditorialLayout.sectionGap),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const SectionHeading(title: 'Dimensiones de la ejecución shadow'),
        LiveDetailLine('Ejecución', run.runId),
        LiveDetailLine(
          'Articles visibles de esta ejecución',
          '${run.articleCount}',
        ),
        LiveDetailLine(
          'Acciones nativas ambiguous',
          '${run.nativeAmbiguousActions}',
        ),
        LiveDetailLine(
          'Articles sin observación acotada de Occurrence',
          '${run.noBoundedOccurrenceArticles}',
        ),
        LiveDetailLine(
          'Occurrences parciales propuestas',
          '${run.partialOccurrenceCount}',
        ),
        LiveDetailLine('Threads propuestos', '${run.proposedThreadCount}'),
        LiveDetailLine(
          'Articles con UNKNOWN_APPLICABILITY frente a Occurrence',
          '${run.unknownOccurrenceApplicabilityArticles}',
        ),
        LiveDetailLine(
          'Comparaciones de identidad',
          '${run.identityComparisonCount}',
        ),
        LiveDetailLine(
          'Decisiones de identidad UNKNOWN',
          '${run.identityUnknownCount}',
        ),
        const Text(
          'Acción nativa, observación, aplicabilidad e identidad son dimensiones independientes. Una comparación no realizada no es una decisión UNKNOWN. Estas propuestas no asignan autoridad LIVE.',
        ),
        if (run.historicalPacingNoncompliant) ...<Widget>[
          const Text('ACQUISITION_PACING_NONCOMPLIANT_HISTORICAL'),
          const Text(
            'La adquisición histórica no respetó la espera registrada por la política del publisher. El resultado conserva sus datos originales; la reparación de la espera se aplica a futuras adquisiciones.',
          ),
        ],
      ],
    ),
  );

  Widget _article(BuildContext context, EphemeralArticleDto a) {
    final EphemeralVersionDto? version = a.version;
    final EphemeralEnvelopeDto? envelope = a.envelope;
    return Padding(
      padding: const EdgeInsets.only(bottom: EditorialLayout.sectionGap),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (a.headline != null && a.canonicalUrl != null)
            EditorialTextButton(
              semanticLabel: 'Leer noticia: ${a.headline}',
              onPressed: () => widget.onOpenArticle(a.id),
              child: Text(a.headline!),
            ),
          if (a.headline == null)
            const Text(
              'Visualización del título restringida por la política de la fuente.',
            ),
          if (a.canonicalUrl != null)
            EditorialTextButton(
              semanticLabel: 'Consultar fuente: ${a.sourceName}',
              onPressed: () => widget.onOpenSource(a.sourceId),
              child: Text(a.sourceName),
            ),
          LiveDetailLine('Acceso al contenido', a.accessMode),
          LiveDetailLine('Procesamiento semántico', a.processingState),
          const LiveDetailLine('Asignación autoritativa LIVE', 'UNASSIGNED'),
          const Text(
            'UNASSIGNED indica que Core no ha asignado una estructura autoritativa; no es una decisión UNKNOWN del proveedor.',
          ),
          if (a.accessMode == 'METADATA_ONLY')
            const Text(
              'Disponible: metadatos y extracto permitido. No elegible para el candidato.',
            ),
          if (envelope != null) ...<Widget>[
            if (envelope.isAuthored)
              const Text(
                'PRUEBA SINTÉTICA · provider stub; no ejecución de V10.11',
              ),
            const SizedBox(height: EditorialLayout.detailGap),
            const Text(
              'Esta vista muestra una proyección tipada, no el archivo diagnóstico nativo completo.',
            ),
            Text(
              envelope.evidence.isEmpty
                  ? 'Esta proyección no conserva ubicaciones de evidencia. Este dato no autentica si el proveedor emitió ubicaciones nativas.'
                  : 'La ubicación histórica de la evidencia está registrada sin conservar su texto.',
            ),
            const Text(
              'Los hashes identifican y verifican una representación exacta; no recuperan el texto descartado.',
            ),
            LiveDetailLine('Reproducibilidad', envelope.reproducibility),
            if (envelope.sourceVersionStatus == 'UNVERIFIED')
              const Text(
                'La versión actual de la fuente aún no se ha comparado con los hashes históricos.',
              ),
            if (envelope.sourceVersionStatus == 'SOURCE_VERSION_CHANGED')
              const Text(
                'La versión del publisher cambió desde el procesamiento. Las ubicaciones históricas no corresponden al documento actual.',
              ),
            if (envelope.sourceVersionStatus == 'SOURCE_UNAVAILABLE')
              const Text(
                'La fuente no estuvo disponible para verificar la versión. El input descartado no puede recuperarse de sus hashes.',
              ),
            if (envelope.reproducibility == 'HASH_VERIFIABLE_REFETCH_REQUIRED')
              const Text(
                'Para repetir el input exacto se necesita una nueva adquisición autorizada que, con la misma normalización, coincida con los hashes de título y cuerpo. Los hashes no reconstruyen el input.',
              ),
            if (envelope.articleProposals.isEmpty)
              const Text(
                'Esta proyección no conserva una acción nativa del proveedor; no se fabrica una abstención.',
              ),
            for (final Map<String, Object?> proposal
                in envelope.articleProposals)
              Text(
                'Acción propuesta shadow: ${proposal['action']} · ${proposal['reason_code']}',
              ),
            for (final Map<String, Object?> applicability
                in envelope.candidateApplicability)
              Text(
                'Aplicabilidad ${applicability['scope']}: ${applicability['outcome']}',
              ),
            for (final Map<String, Object?> observation
                in envelope.observations)
              Text(
                'Propuesta shadow: ${observation['decision']} · ${observation['applicability']}',
              ),
            if (envelope.observations.isEmpty)
              const Text(
                'No hay comparaciones de identidad registradas para este Article. No se cuenta una decisión de identidad UNKNOWN.',
              ),
          ],
          LiveTechnicalDetails(
            disclosureKey: PageStorageKey<String>('ephemeral-${a.id}'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                LiveDetailLine('Article ID', a.id),
                if (a.canonicalUrl != null)
                  LiveDetailLine('Fuente canónica', a.canonicalUrl.toString()),
                if (a.canonicalUrl == null)
                  const Text(
                    'Enlace externo restringido por la política de la fuente.',
                  ),
                if (version != null)
                  for (final String key in <String>[
                    'id',
                    'version_number',
                    'acquired_content_hash',
                    'normalized_input_hash',
                    'title_input_hash',
                    'normalization_version',
                    'input_codepoint_length',
                    'observed_at',
                  ])
                    LiveDetailLine(key, '${version.fields[key]}'),
                if (envelope != null) ...<Widget>[
                  for (final String key in <String>[
                    'id',
                    'provider_type',
                    'provider_version',
                    'provider_run_id',
                    'candidate_commit',
                    'runtime_python',
                    'runtime_model',
                    'processed_at',
                    'source_version_status',
                  ])
                    LiveDetailLine(
                      key,
                      envelope.fields[key] == null
                          ? envelope.isAuthored
                                ? 'No aplicable al proveedor sintético'
                                : 'No conservado en esta proyección'
                          : '${envelope.fields[key]}',
                    ),
                  for (final Map<String, Object?> proposal
                      in envelope.articleProposals) ...<Widget>[
                    if (proposal['proposed_occurrence_key'] != null)
                      LiveDetailLine(
                        'Ocurrencia propuesta',
                        '${proposal['proposed_occurrence_key']}',
                      ),
                    if (proposal['proposed_thread_key'] != null)
                      LiveDetailLine(
                        'Thread propuesto',
                        '${proposal['proposed_thread_key']}',
                      ),
                  ],
                  for (final Map<String, Object?> evidence in envelope.evidence)
                    LiveDetailLine(
                      'Ubicación histórica de evidencia',
                      '${evidence['field']} [${evidence['span_start']}, ${evidence['span_end']}) · SHA-256 ${evidence['span_hash']} · sin cita retenida',
                    ),
                  for (final Map<String, Object?> observation
                      in envelope.observations) ...<Widget>[
                    LiveDetailLine(
                      'Occurrence propuesta',
                      observation['proposed_occurrence_key'] as String? ??
                          'No propuesta por el proveedor',
                    ),
                    LiveDetailLine(
                      'Thread propuesto',
                      observation['proposed_thread_key'] as String? ??
                          'No propuesto por el proveedor',
                    ),
                  ],
                  for (final Map<String, Object?> proposal
                      in envelope.articleProposals) ...<Widget>[
                    LiveDetailLine(
                      'Occurrence propuesta',
                      proposal['proposed_occurrence_key'] as String? ??
                          'No propuesta por el proveedor',
                    ),
                    LiveDetailLine(
                      'Thread propuesto',
                      proposal['proposed_thread_key'] as String? ??
                          'No propuesto por el proveedor',
                    ),
                    LiveDetailLine(
                      'Creación parcial',
                      '${proposal['partial_occurrence_creation']}',
                    ),
                  ],
                ],
                LiveDetailLine(
                  'Cuerpo completo en esta respuesta',
                  a.accessMode == 'FULLTEXT_EPHEMERAL' && envelope != null
                      ? 'No retenido; cuerpo efímero descartado'
                      : a.accessMode == 'METADATA_ONLY'
                      ? 'No adquirido como input completo'
                      : 'No incluido en esta respuesta',
                ),
              ],
            ),
          ),
          const SizedBox(height: EditorialLayout.detailGap),
          Divider(color: context.surfaceColors.divider),
        ],
      ),
    );
  }
}
