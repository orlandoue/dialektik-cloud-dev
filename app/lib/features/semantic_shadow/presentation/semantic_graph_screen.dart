import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/live/presentation/live_components.dart';
import 'package:dialektik/features/semantic/presentation/editorial_components.dart';
import 'package:dialektik/features/semantic_shadow/data/semantic_graph_models.dart';
import 'package:dialektik/features/semantic_shadow/data/semantic_graph_repository.dart';
import 'package:flutter/material.dart';

// dialektik:epistemic-component
// Each state and membership is a retained non-authoritative proposal, never a score.
typedef GraphNodeOpener = void Function(String runId, String key);

final class _GraphIndicator extends StatelessWidget {
  const _GraphIndicator();

  @override
  Widget build(BuildContext context) => Text(
    'SHADOW · PROPUESTAS',
    style: Theme.of(
      context,
    ).textTheme.bodyMedium?.copyWith(color: context.surfaceColors.muted),
  );
}

final class _GraphReader extends StatefulWidget {
  const _GraphReader({
    required this.repository,
    required this.runId,
    required this.content,
  });
  final SemanticGraphRepository repository;
  final String? runId;
  final Widget Function(SemanticGraphDto data) content;
  @override
  State<_GraphReader> createState() => _GraphReaderState();
}

final class _GraphReaderState extends State<_GraphReader> {
  late PublicRequestToken _token;
  late Future<SemanticGraphDto> _future;
  void _load() {
    _token = PublicRequestToken();
    _future = widget.repository.getSemanticGraph(
      runId: widget.runId,
      requestToken: _token,
    );
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(_GraphReader oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.runId != widget.runId ||
        oldWidget.repository != widget.repository) {
      _token.cancel();
      _load();
    }
  }

  @override
  void dispose() {
    _token.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<SemanticGraphDto>(
    key: ValueKey<String?>(widget.runId),
    future: _future,
    builder: (BuildContext context, AsyncSnapshot<SemanticGraphDto> snapshot) {
      if (snapshot.hasError) {
        return const EditorialEmptyState(
          title: 'No pudimos verificar este grafo.',
          description:
              'Selecciona una ejecución sellada. No se sustituyen sus inputs por versiones recientes.',
        );
      }
      if (snapshot.connectionState != ConnectionState.done ||
          snapshot.data == null) {
        return const EditorialLoading();
      }
      return widget.content(snapshot.data!);
    },
  );
}

final class SemanticGraphScreen extends StatefulWidget {
  const SemanticGraphScreen({
    required this.repository,
    required this.onOpenThread,
    required this.onOpenOccurrence,
    required this.onOpenInput,
    this.initialRunId,
    super.key,
  });
  final SemanticGraphRepository repository;
  final GraphNodeOpener onOpenThread, onOpenOccurrence, onOpenInput;
  final String? initialRunId;
  @override
  State<SemanticGraphScreen> createState() => _SemanticGraphScreenState();
}

final class _SemanticGraphScreenState extends State<SemanticGraphScreen> {
  late String? _runId = widget.initialRunId;
  final TextEditingController _search = TextEditingController();
  String _query = '';
  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  bool _matches(SemanticGraphSnapshotDto graph, Iterable<String> ids) =>
      _query.isEmpty ||
      ids.any((String id) {
        final SemanticGraphInputDto input = graph.byArticle[id]!;
        return (input.article.headline ?? '').toLowerCase().contains(_query) ||
            input.article.sourceName.toLowerCase().contains(_query) ||
            id.toLowerCase().contains(_query);
      });
  @override
  Widget build(BuildContext context) => EditorialScaffold(
    title: 'Grafo shadow',
    eyebrow: 'PROPUESTAS · NO AUTORITATIVO',
    location: 'Stories propuestas',
    homeRoute: '/live/news',
    homeLabel: 'Noticias',
    dataIndicator: const _GraphIndicator(),
    stackDataIndicatorOnNarrow: true,
    child: _GraphReader(
      repository: widget.repository,
      runId: _runId,
      content: (SemanticGraphDto data) {
        final SemanticGraphSnapshotDto? graph = data.selected;
        if (graph == null) {
          return const EditorialEmptyState(
            title: 'Aún no hay una ejecución sellada.',
            description:
                'El grafo aparecerá cuando una ejecución autorizada conserve sus propuestas. No se crean Stories para completar esta vista.',
          );
        }
        final List<SemanticGraphThreadDto> threads = graph.threads
            .where((SemanticGraphThreadDto t) => _matches(graph, t.articleIds))
            .toList();
        final List<SemanticGraphOccurrenceDto> occurrences = graph
            .standaloneOccurrences
            .where(
              (SemanticGraphOccurrenceDto o) => _matches(graph, o.articleIds),
            )
            .toList();
        final List<SemanticGraphInputDto> unassigned = graph.unassignedInputs
            .where(
              (SemanticGraphInputDto i) =>
                  _matches(graph, <String>[i.article.id]),
            )
            .toList();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text('Ejecución sellada'),
            DropdownButton<String>(
              key: const Key('shadow-run-selector'),
              value: graph.run.id,
              isExpanded: true,
              itemHeight: null,
              items: data.runs
                  .map(
                    (SemanticGraphRunDto run) => DropdownMenuItem<String>(
                      value: run.id,
                      child: Text(
                        run.isLLM ? run.label : run.identity,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  )
                  .toList(),
              onChanged: (String? id) {
                if (id != null) {
                  setState(() {
                    _runId = id;
                    _search.clear();
                    _query = '';
                  });
                }
              },
            ),
            if (graph.run.isLLM) ...<Widget>[
              const Text('LLM Semantic Shadow · LIVE permanece UNASSIGNED'),
              Text(
                '${graph.run.llm!.model} · ${graph.run.isAuthored ? 'corpus authored, sin llamadas a Gemini' : 'proveedor real'}',
              ),
              Text(
                'Prompt ${graph.run.llm!.fields['promptVersion']} · Schema ${graph.run.llm!.fields['schemaVersion']}',
              ),
              Text(
                'Grounding verificado por Core · top K ${graph.run.llm!.fields['topK']} · sin autoridad automática',
              ),
            ],
            _RunFacts(graph: graph),
            const SizedBox(height: EditorialLayout.sectionGap),
            TextField(
              key: const Key('shadow-graph-search'),
              controller: _search,
              decoration: const InputDecoration(
                labelText: 'Buscar noticias o fuentes en este grafo',
              ),
              onChanged: (String value) =>
                  setState(() => _query = value.trim().toLowerCase()),
            ),
            const SizedBox(height: EditorialLayout.sectionGap),
            const SectionHeading(title: 'Stories propuestas'),
            if (graph.threads.isEmpty)
              const Text(
                'El proveedor no propuso ningún Thread. Las Occurrences se muestran sin crear una Story.',
              ),
            for (final SemanticGraphThreadDto thread in threads)
              _NodeCard(
                title: 'Story propuesta',
                nodeKey: thread.key,
                facts:
                    '${thread.occurrenceKeys.length} Occurrences · ${thread.articleIds.length} noticias · ${graph.sourceCount(thread.articleIds)} fuentes publicadoras',
                onOpen: () => widget.onOpenThread(graph.run.id, thread.key),
              ),
            const SizedBox(height: EditorialLayout.sectionGap),
            const SectionHeading(title: 'Occurrences sin Thread propuesto'),
            if (graph.standaloneOccurrences.isEmpty)
              const Text('No hay Occurrences sin Thread en este snapshot.'),
            for (final SemanticGraphOccurrenceDto occurrence in occurrences)
              _NodeCard(
                title: 'Occurrence propuesta',
                nodeKey: occurrence.key,
                facts:
                    '${occurrence.articleIds.length} noticias · ${graph.sourceCount(occurrence.articleIds)} fuentes publicadoras',
                onOpen: () =>
                    widget.onOpenOccurrence(graph.run.id, occurrence.key),
              ),
            const SizedBox(height: EditorialLayout.sectionGap),
            const SectionHeading(title: 'Noticias sin Occurrence propuesta'),
            if (graph.unassignedInputs.isEmpty)
              const Text(
                'Todas las noticias de este snapshot tienen una Occurrence propuesta.',
              ),
            for (final SemanticGraphInputDto input in unassigned)
              _InputLink(
                input: input,
                onOpen: () =>
                    widget.onOpenInput(graph.run.id, input.article.id),
              ),
            const SizedBox(height: EditorialLayout.sectionGap),
            _SourceFacts(graph: graph),
          ],
        );
      },
    ),
  );
}

final class _NodeCard extends StatelessWidget {
  const _NodeCard({
    required this.title,
    required this.nodeKey,
    required this.facts,
    required this.onOpen,
  });
  final String title, nodeKey, facts;
  final VoidCallback onOpen;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: EditorialLayout.detailGap),
    child: EditorialActionCard(
      semanticLabel: 'Abrir $title: $nodeKey',
      onTap: onOpen,
      child: Padding(
        padding: const EdgeInsets.all(EditorialLayout.cardPadding),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            Text(facts),
            Text(nodeKey, softWrap: true),
          ],
        ),
      ),
    ),
  );
}

final class _InputLink extends StatelessWidget {
  const _InputLink({required this.input, required this.onOpen});
  final SemanticGraphInputDto input;
  final VoidCallback onOpen;
  @override
  Widget build(BuildContext context) => EditorialTextButton(
    semanticLabel: 'Abrir input del snapshot: ${input.article.id}',
    onPressed: onOpen,
    child: Text(
      '${input.article.headline ?? 'Título restringido por la política'} · ${input.article.sourceName}',
    ),
  );
}

final class _RunFacts extends StatelessWidget {
  const _RunFacts({required this.graph});
  final SemanticGraphSnapshotDto graph;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: <Widget>[
      if (graph.run.isAuthored)
        const Text('PRUEBA SINTÉTICA · sin ejecución de V10.11'),
      const LiveDetailLine('Asignación autoritativa LIVE', 'UNASSIGNED'),
      const Text(
        'Las membresías son propuestas del proveedor. Este grafo no asigna Events o Stories autoritativos. Los cuerpos no se muestran.',
      ),
      const Text(
        'Los recuentos de fuentes publicadoras no establecen independencia editorial, corroboración ni confirmación de verdad.',
      ),
      LiveDetailLine('Articles en el snapshot', '${graph.inputs.length}'),
      LiveDetailLine('Occurrences propuestas', '${graph.occurrences.length}'),
      LiveDetailLine('Threads propuestos', '${graph.threads.length}'),
      LiveDetailLine(
        'Comparaciones Occurrence',
        '${graph.comparisonsFor('occurrence')}',
      ),
      LiveDetailLine(
        'Comparaciones Thread',
        '${graph.comparisonsFor('thread')}',
      ),
      if (graph.unscopedComparisons > 0)
        LiveDetailLine(
          'Comparaciones con scope no identificado',
          '${graph.unscopedComparisons}',
        ),
      LiveDetailLine(
        'Decisiones de identidad UNKNOWN',
        '${graph.identityUnknown}',
      ),
      LiveDetailLine(
        'UNKNOWN_APPLICABILITY observados',
        '${graph.applicabilityUnknown}',
      ),
      LiveDetailLine(
        'Articles sin comparación en la proyección',
        '${graph.noComparisonArticles}',
      ),
      LiveDetailLine('Acciones nativas ambiguous', '${graph.ambiguousActions}'),
      const Text(
        'UNKNOWN de identidad, UNKNOWN_APPLICABILITY, ausencia de comparación y ambiguous son dimensiones independientes.',
      ),
      if (graph.inputs.any(
        (SemanticGraphInputDto i) =>
            i.article.envelope!.historicalPacingNoncompliant,
      ))
        const Text(
          'ACQUISITION_PACING_NONCOMPLIANT_HISTORICAL · el resultado histórico conserva su calificación original.',
        ),
      LiveTechnicalDetails(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            LiveDetailLine('Run', graph.run.id),
            LiveDetailLine('Snapshot sellado', graph.run.snapshotId),
            for (final String key in const <String>[
              'run_identity',
              'provider_type',
              'provider_version',
              'candidate_commit',
              'runtime_python',
              'runtime_model',
              'sealed_at',
            ])
              LiveDetailLine(
                key,
                graph.run.fields[key]?.toString() ??
                    'No aplicable al proveedor sintético',
              ),
          ],
        ),
      ),
    ],
  );
}

final class _SourceFacts extends StatelessWidget {
  const _SourceFacts({required this.graph});
  final SemanticGraphSnapshotDto graph;
  @override
  Widget build(BuildContext context) {
    final Map<String, List<SemanticGraphInputDto>> sources =
        <String, List<SemanticGraphInputDto>>{};
    for (final SemanticGraphInputDto input in graph.inputs) {
      (sources[input.article.sourceId] ??= <SemanticGraphInputDto>[]).add(
        input,
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const SectionHeading(title: 'Fuentes y relaciones registradas'),
        Text(
          '${sources.length} fuentes publicadoras; los dominios distintos no prueban independencia.',
        ),
        for (final List<SemanticGraphInputDto> source
            in sources.values) ...<Widget>[
          Text(
            source.first.article.sourceName,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          for (final String family
              in source
                  .map((SemanticGraphInputDto i) => i.publisherFamily)
                  .whereType<String>()
                  .toSet())
            Text('Grupo editor registrado · $family'),
          for (final String upstream
              in source
                  .map((SemanticGraphInputDto i) => i.declaredUpstream)
                  .whereType<String>()
                  .toSet())
            Text('Origen declarado · $upstream'),
          if (source.every(
            (SemanticGraphInputDto i) =>
                i.publisherFamily == null && i.declaredUpstream == null,
          ))
            const Text(
              'Esta proyección no conserva una relación organizativa o upstream declarada.',
            ),
          const SizedBox(height: EditorialLayout.detailGap),
        ],
      ],
    );
  }
}

enum SemanticGraphDetailKind { thread, occurrence, article }

final class SemanticGraphDetailScreen extends StatelessWidget {
  const SemanticGraphDetailScreen({
    required this.repository,
    required this.runId,
    required this.nodeKey,
    required this.kind,
    required this.onOpenOccurrence,
    required this.onOpenInput,
    required this.onOpenArticle,
    required this.onOpenSource,
    required this.onOpenProvenance,
    super.key,
  });
  final SemanticGraphRepository repository;
  final String runId, nodeKey;
  final SemanticGraphDetailKind kind;
  final GraphNodeOpener onOpenOccurrence, onOpenInput;
  final ValueChanged<String> onOpenArticle, onOpenSource, onOpenProvenance;
  @override
  Widget build(BuildContext context) => EditorialScaffold(
    title: kind == SemanticGraphDetailKind.thread
        ? 'Story propuesta'
        : kind == SemanticGraphDetailKind.occurrence
        ? 'Occurrence propuesta'
        : 'Input del snapshot',
    eyebrow: 'SHADOW · NO AUTORITATIVO',
    location: 'Grafo sellado',
    homeRoute:
        '/shadow/semantic/graph?run_id=${Uri.encodeQueryComponent(runId)}',
    homeLabel: 'Grafo shadow',
    dataIndicator: const _GraphIndicator(),
    stackDataIndicatorOnNarrow: true,
    child: _GraphReader(
      repository: repository,
      runId: runId,
      content: (SemanticGraphDto data) {
        final SemanticGraphSnapshotDto? graph = data.selected;
        if (graph == null || graph.run.id != runId) return _missing();
        if (kind == SemanticGraphDetailKind.article) {
          final SemanticGraphInputDto? input = graph.byArticle[nodeKey];
          if (input == null) return _missing();
          return _article(input, graph.run.providerLabel);
        }
        final List<String> articleIds;
        final String generationHash;
        final List<SemanticGraphOccurrenceDto> occurrences;
        if (kind == SemanticGraphDetailKind.thread) {
          final List<SemanticGraphThreadDto> matches = graph.threads
              .where((SemanticGraphThreadDto t) => t.key == nodeKey)
              .toList();
          if (matches.length != 1) return _missing();
          final SemanticGraphThreadDto thread = matches.single;
          articleIds = thread.articleIds;
          generationHash = thread.generationHash;
          occurrences = graph.occurrences
              .where(
                (SemanticGraphOccurrenceDto o) =>
                    thread.occurrenceKeys.contains(o.key),
              )
              .toList();
        } else {
          final List<SemanticGraphOccurrenceDto> matches = graph.occurrences
              .where((SemanticGraphOccurrenceDto o) => o.key == nodeKey)
              .toList();
          if (matches.length != 1) return _missing();
          articleIds = matches.single.articleIds;
          generationHash = matches.single.generationHash;
          occurrences = <SemanticGraphOccurrenceDto>[];
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(nodeKey),
            const LiveDetailLine('Asignación autoritativa LIVE', 'UNASSIGNED'),
            Text(
              '${articleIds.length} noticias · ${graph.sourceCount(articleIds)} fuentes publicadoras',
            ),
            const Text(
              'Membresías propuestas exactas de este snapshot; ningún recuento confirma verdad o independencia.',
            ),
            for (final SemanticGraphOccurrenceDto occurrence in occurrences)
              _NodeCard(
                title: 'Occurrence propuesta',
                nodeKey: occurrence.key,
                facts: '${occurrence.articleIds.length} noticias',
                onOpen: () => onOpenOccurrence(runId, occurrence.key),
              ),
            const SectionHeading(title: 'Noticias en esta propuesta'),
            for (final String id in articleIds)
              _InputLink(
                input: graph.byArticle[id]!,
                onOpen: () => onOpenInput(runId, id),
              ),
            LiveTechnicalDetails(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  LiveDetailLine('Run', runId),
                  LiveDetailLine('Snapshot', graph.run.snapshotId),
                  LiveDetailLine('Hash de generación nativa', generationHash),
                ],
              ),
            ),
          ],
        );
      },
    ),
  );
  Widget _missing() => const EditorialEmptyState(
    title: 'La propuesta no está en este snapshot.',
    description:
        'No se carga una propuesta de otra ejecución ni se crea un Thread para mostrarla.',
  );
  Widget _article(SemanticGraphInputDto input, String providerLabel) {
    final article = input.article;
    final envelope = article.envelope!;
    final llm = envelope.llm;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(article.headline ?? 'Título restringido por la política'),
        Text(article.sourceName),
        const LiveDetailLine('Asignación autoritativa LIVE', 'UNASSIGNED'),
        if (input.publishedAt != null)
          LiveDetailLine('Publicación', liveExactDate(input.publishedAt!)),
        if (input.publisherFamily != null)
          Text('Grupo editor registrado · ${input.publisherFamily}'),
        if (input.declaredUpstream != null)
          Text('Origen declarado · ${input.declaredUpstream}'),
        LiveDetailLine('Acceso al contenido', article.accessMode),
        if (llm != null) ...<Widget>[
          const Text('LLM Semantic Shadow · propuesta no autoritativa'),
          LiveDetailLine(
            'Proveedor / modelo',
            '$providerLabel · ${llm.config.model}',
          ),
          LiveDetailLine('Observación', llm.status),
          LiveDetailLine(
            'Grounding',
            '${llm.facts.length} referencias verificadas por Core',
          ),
          for (final relation in llm.relations)
            LiveDetailLine(
              'Comparación con ${relation['targetArticleId']}',
              '${relation['decision']} · Occurrence ${relation['occurrence']} · Thread ${relation['thread']}',
            ),
          const Text(
            'Las referencias prueban el texto de origen. No establecen verdad ni autoridad. No se conserva razonamiento privado.',
          ),
        ],
        LiveDetailLine('Reproducibilidad', envelope.reproducibility),
        LiveDetailLine('Estado de la fuente', envelope.sourceVersionStatus),
        const Text(
          'Los hashes verifican representaciones exactas; no recuperan texto. Esta vista conserva la versión y envelope del snapshot, sin mostrar cuerpos.',
        ),
        if (article.canonicalUrl != null &&
            !(llm != null &&
                envelope.fields['provider_type'] ==
                    'authored_stub')) ...<Widget>[
          EditorialTextButton(
            onPressed: () => onOpenArticle(article.id),
            child: const Text('Abrir noticia LIVE'),
          ),
          EditorialTextButton(
            onPressed: () => onOpenSource(article.sourceId),
            child: const Text('Consultar fuente'),
          ),
          EditorialTextButton(
            onPressed: () => onOpenProvenance(article.id),
            child: const Text('Consultar procedencia LIVE'),
          ),
        ],
        const SectionHeading(title: 'Acción nativa y comparaciones'),
        if (envelope.articleProposals.isEmpty)
          const Text('Esta proyección no conserva una acción nativa.'),
        for (final Map<String, Object?> p in envelope.articleProposals)
          Text('Acción: ${p['action']} · motivo: ${p['reason_code']}'),
        if (envelope.observations.isEmpty)
          const Text(
            'Esta proyección no conserva una comparación de identidad en este input.',
          ),
        for (final Map<String, Object?> o in envelope.observations)
          Text(
            '${o['observation_key']}: ${o['decision']} · ${o['applicability']}',
          ),
        for (final Map<String, Object?> a in envelope.candidateApplicability)
          Text(
            'Aplicabilidad ${a['scope']} frente a ${a['target_key']}: ${a['outcome']}',
          ),
        const Text(
          'UNASSIGNED no es UNKNOWN. Ausencia de comparación no es UNKNOWN_APPLICABILITY.',
        ),
        LiveTechnicalDetails(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              LiveDetailLine('Run', runId),
              LiveDetailLine(
                'Envelope exacto',
                envelope.fields['id']! as String,
              ),
              for (final MapEntry<String, Object?> field
                  in article.version!.fields.entries)
                LiveDetailLine(field.key, field.value.toString()),
              for (final String key in const <String>[
                'provider_type',
                'provider_version',
                'candidate_commit',
                'runtime_python',
                'runtime_model',
                'processed_at',
              ])
                LiveDetailLine(
                  key,
                  envelope.fields[key]?.toString() ??
                      'No aplicable al proveedor sintético',
                ),
              for (final Map<String, Object?> evidence in envelope.evidence)
                Text(
                  'Ubicación ${evidence['field']}: ${evidence['span_start']}–${evidence['span_end']} · hash ${evidence['span_hash']}; texto no mostrado',
                ),
            ],
          ),
        ),
      ],
    );
  }
}
