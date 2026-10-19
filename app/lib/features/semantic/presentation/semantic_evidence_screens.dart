import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/semantic/data/semantic_models.dart';
import 'package:dialektik/features/semantic/data/semantic_repository.dart';
import 'package:dialektik/features/semantic/presentation/editorial_components.dart';
import 'package:dialektik/features/semantic/presentation/editorial_vocabulary.dart';
import 'package:dialektik/features/semantic/presentation/story_context_card.dart';
import 'package:flutter/material.dart';

// dialektik:epistemic-component

final class SemanticArticleScreen extends StatelessWidget {
  const SemanticArticleScreen({
    required this.articleId,
    required this.repository,
    this.onOpenSource,
    this.onOpenOccurrence,
    this.onOpenThread,
    this.onOpenProvenance,
    super.key,
  });

  final String articleId;
  final SemanticRepository repository;
  final ValueChanged<String>? onOpenSource;
  final ValueChanged<String>? onOpenOccurrence;
  final ValueChanged<String>? onOpenThread;
  final ValueChanged<String>? onOpenProvenance;

  @override
  Widget build(BuildContext context) => _EvidenceLoader<_ArticleReading>(
    title: 'Noticia',
    eyebrow: 'Noticia',
    titleOf: (_ArticleReading reading) => editorialTitle(reading.article.title),
    identity: (repository, articleId),
    load: (PublicRequestToken token, bool refresh) async {
      final List<Object> result = await Future.wait<Object>(<Future<Object>>[
        repository.getSemanticArticle(
          articleId,
          refresh: refresh,
          requestToken: token,
        ),
        repository.getArticleSemanticContext(
          articleId,
          refresh: refresh,
          requestToken: token,
        ),
      ]);
      final SemanticArticleDetailDto article =
          result[0] as SemanticArticleDetailDto;
      final SemanticArticleContextDto context =
          result[1] as SemanticArticleContextDto;
      final _ContextReading reading = await _readContexts(
        repository,
        context.memberships,
        token,
        refresh: refresh,
      );
      return _ArticleReading(article, reading);
    },
    content: (BuildContext context, _ArticleReading reading) {
      final SemanticArticleDetailDto article = reading.article;
      final Map<String, SemanticProvenanceDto>
      observations = <String, SemanticProvenanceDto>{
        for (final SemanticOccurrenceDto occurrence
            in reading.context.occurrences.values)
          for (final SemanticProvenanceDto provenance in occurrence.provenance)
            if (provenance.article.id == article.id) provenance.id: provenance,
      };
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Align(
            alignment: Alignment.centerLeft,
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                maxWidth: DialektikSizing.maxReadingWidth,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  SourceBadge(
                    source: article.source,
                    compact: true,
                    onPressed: () => _openSource(context, article.source.id),
                  ),
                  const SizedBox(height: DialektikSpacing.space3),
                  Text(
                    'Publicado · ${editorialDate(article.publishedAt, includeTime: true)}',
                  ),
                  const SizedBox(height: DialektikSpacing.space8),
                  if (_authoredSummary(article)
                      case final String summary) ...<Widget>[
                    const _EvidenceHeading('Resumen'),
                    const SizedBox(height: DialektikSpacing.space6),
                    Text(summary, style: Theme.of(context).textTheme.bodyLarge),
                    const SizedBox(height: DialektikSpacing.space6),
                  ],
                  _OriginalArticleText(article: article),
                ],
              ),
            ),
          ),
          const SizedBox(height: DialektikSpacing.space8),
          if (reading.context.memberships.isEmpty)
            const EditorialEmptyState(
              title: 'Esta noticia todavía no tiene contexto asociado.',
              description:
                  'Puedes leer el texto completo y consultar su fuente.',
            ),
          for (final SemanticMembershipDto membership
              in reading.context.memberships) ...<Widget>[
            StoryContextCard(
              occurrence: reading.context.occurrences[membership.occurrenceId]!,
              thread: reading.context.threads[membership.threadId]!,
              articleId: article.id,
              membership: membership,
              onOpenStory: () => _openThread(context, membership.threadId),
              onOpenEvent: () =>
                  _openOccurrence(context, membership.occurrenceId),
            ),
            const SizedBox(height: DialektikSpacing.space6),
          ],
          if (observations.isNotEmpty) ...<Widget>[
            const SectionHeading(
              title: 'Cómo se ha asociado esta noticia',
              subtitle: 'Consulta el origen de cada asociación y su contexto.',
            ),
            for (final SemanticProvenanceDto provenance in observations.values)
              EditorialTextButton(
                onPressed: () => _openProvenance(context, provenance.id),
                child: Text(
                  '¿Por qué está aquí? · ${editorialDate(provenance.observedAt, includeTime: true)}',
                  textAlign: TextAlign.start,
                ),
              ),
          ],
          _TechnicalDetails(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                _TechnicalLine('Noticia (Article)', article.id),
                _TechnicalLine('Fuente (Source)', article.source.id),
                _TechnicalLine('Dominio', article.source.canonicalDomain),
                _TechnicalLine('Publicación UTC', _utc(article.publishedAt)),
                for (final SemanticMembershipDto membership
                    in reading.context.memberships) ...<Widget>[
                  const SizedBox(height: DialektikSpacing.space4),
                  _TechnicalLine('Observación', membership.observationId),
                  _TechnicalLine('Historia (Thread)', membership.threadId),
                  _TechnicalLine('Ocurrencia', membership.occurrenceId),
                  _TechnicalLine('Observado UTC', _utc(membership.observedAt)),
                  _AssociationLabel(membership: membership),
                ],
              ],
            ),
          ),
        ],
      );
    },
  );

  void _openSource(BuildContext context, String id) =>
      _open(context, '/sources/', id, onOpenSource);
  void _openOccurrence(BuildContext context, String id) =>
      _open(context, '/occurrences/', id, onOpenOccurrence);
  void _openThread(BuildContext context, String id) =>
      _open(context, '/threads/', id, onOpenThread);
  void _openProvenance(BuildContext context, String id) =>
      _open(context, '/provenance/', id, onOpenProvenance);
}

final class SemanticProvenanceScreen extends StatelessWidget {
  const SemanticProvenanceScreen({
    required this.provenanceId,
    required this.repository,
    this.onOpenSource,
    this.onOpenArticle,
    this.onOpenOccurrence,
    this.onOpenThread,
    super.key,
  });

  final String provenanceId;
  final SemanticRepository repository;
  final ValueChanged<String>? onOpenSource;
  final ValueChanged<String>? onOpenArticle;
  final ValueChanged<String>? onOpenOccurrence;
  final ValueChanged<String>? onOpenThread;

  @override
  Widget build(BuildContext context) => _EvidenceLoader<_ProvenanceReading>(
    title: '¿Por qué está aquí?',
    identity: (repository, provenanceId),
    load: (PublicRequestToken token, bool refresh) async {
      final SemanticProvenanceDto provenance = await repository
          .getSemanticProvenance(
            provenanceId,
            refresh: refresh,
            requestToken: token,
          );
      final SemanticArticleContextDto context = await repository
          .getArticleSemanticContext(
            provenance.article.id,
            refresh: refresh,
            requestToken: token,
          );
      final _ContextReading reading = await _readContexts(
        repository,
        context.memberships,
        token,
        refresh: refresh,
      );
      return _ProvenanceReading(provenance, reading);
    },
    content: (BuildContext context, _ProvenanceReading reading) {
      final SemanticProvenanceDto provenance = reading.provenance;
      final List<SemanticMembershipDto> associations = reading.associations;
      final Map<String, SemanticArticleDto>
      articles = <String, SemanticArticleDto>{
        for (final SemanticMembershipDto membership in associations)
          for (final SemanticArticleDto article
              in reading.context.occurrences[membership.occurrenceId]!.articles)
            article.id: article,
      };
      final Map<String, SemanticSourceDto> sources =
          <String, SemanticSourceDto>{
            provenance.article.source.id: provenance.article.source,
            for (final SemanticArticleDto article in articles.values)
              article.source.id: article.source,
          };
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (associations.isEmpty)
            const Text(
              'El contexto histórico de este registro no está disponible.',
            ),
          for (final SemanticMembershipDto membership in associations)
            Text(switch (membership.decision) {
              SemanticDecision.match =>
                'Esta noticia describe el evento «${editorialTitle(reading.context.occurrences[membership.occurrenceId]!.title)}».',
              SemanticDecision.distinct =>
                'Esta noticia describe un evento distinto de «${editorialTitle(reading.context.occurrences[membership.occurrenceId]!.title)}».',
              SemanticDecision.unknown =>
                'Todavía no se puede determinar si esta noticia describe el evento «${editorialTitle(reading.context.occurrences[membership.occurrenceId]!.title)}».',
            }, style: Theme.of(context).textTheme.bodyLarge),
          const SizedBox(height: DialektikSpacing.space6),
          EditorialActionCard(
            semanticLabel:
                'Abrir noticia original: ${editorialTitle(provenance.article.title)}',
            onTap: () => _openArticle(context, provenance.article.id),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Text('Noticia original'),
                const SizedBox(height: DialektikSpacing.space3),
                Text(
                  editorialTitle(provenance.article.title),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: DialektikSpacing.space4),
                Text(editorialSourceName(provenance.article.source.name)),
                Text(
                  'Publicado · ${editorialDate(provenance.article.publishedAt, includeTime: true)}',
                ),
              ],
            ),
          ),
          const SizedBox(height: DialektikSpacing.space8),
          if (associations.isEmpty) ...<Widget>[
            SemanticStatusLabel(
              state: SemanticStateValueDto(
                description: 'Decisión registrada',
                decision: provenance.article.decision,
                applicability: provenance.article.applicability,
              ),
              showApplicability: true,
            ),
          ],
          for (final SemanticMembershipDto membership
              in associations) ...<Widget>[
            StoryContextCard(
              occurrence: reading.context.occurrences[membership.occurrenceId]!,
              thread: reading.context.threads[membership.threadId]!,
              articleId: provenance.article.id,
              membership: membership,
              onOpenStory: () => _openThread(context, membership.threadId),
              onOpenEvent: () =>
                  _openOccurrence(context, membership.occurrenceId),
            ),
            const SizedBox(height: DialektikSpacing.space6),
          ],
          const SizedBox(height: DialektikSpacing.space8),
          SectionHeading(
            title: associations.isEmpty
                ? 'Fuente de esta noticia'
                : 'Cobertura del evento',
          ),
          SourceCollection(
            sources: sources.values.toList(),
            onOpenSource: (String id) => _openSource(context, id),
          ),
          _ProvenanceCoverage(
            key: ValueKey<String>(provenance.id),
            articles: articles.values.toList(),
            onOpenArticle: (String id) => _openArticle(context, id),
          ),
          const SizedBox(height: DialektikSpacing.space6),
          _TechnicalDetails(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                _TechnicalLine('Proveedor', provenance.provider),
                _TechnicalLine('Versión', provenance.providerVersion),
                _TechnicalLine('Observado UTC', _utc(provenance.observedAt)),
                const SizedBox(height: DialektikSpacing.space6),
                const Text(
                  'Asociar noticias a un evento no declara equivalencia entre lo que afirman.',
                ),
                if (provenance.spanId == null &&
                    provenance.assertionId == null) ...<Widget>[
                  const SizedBox(height: DialektikSpacing.space4),
                  const Text(
                    'La observación se vincula a la noticia original. En esta demostración no hay afirmaciones extraídas.',
                  ),
                ],
                const SectionHeading(title: 'Motivo'),
                _EvidenceText(provenance.rationale),
                const SizedBox(height: DialektikSpacing.space6),
                _TechnicalLine('Procedencia', provenance.id),
                _TechnicalLine('Noticia (Article)', provenance.article.id),
                _TechnicalLine('Fuente (Source)', provenance.article.source.id),
                _TechnicalLine(
                  'Dominio',
                  provenance.article.source.canonicalDomain,
                ),
                if (provenance.spanId != null)
                  _TechnicalLine('ClaimSpan', provenance.spanId!),
                if (provenance.assertionId != null)
                  _TechnicalLine('Assertion', provenance.assertionId!),
                for (final SemanticMembershipDto membership
                    in associations) ...<Widget>[
                  const SizedBox(height: DialektikSpacing.space4),
                  _TechnicalLine('Observación', membership.observationId),
                  _AssociationLabel(membership: membership),
                  _TechnicalLine('Historia (Thread)', membership.threadId),
                  _TechnicalLine('Ocurrencia', membership.occurrenceId),
                  _TechnicalLine(
                    'Evento (Event)',
                    reading
                        .context
                        .occurrences[membership.occurrenceId]!
                        .eventId,
                  ),
                ],
                for (final SemanticTransitionDto transition
                    in reading.transitions) ...<Widget>[
                  const SectionHeading(title: 'Cambio registrado'),
                  _TechnicalLine('Transición', transition.id),
                  _TechnicalLine('Entidad', transition.entityKind),
                  _TechnicalLine('Observado UTC', _utc(transition.observedAt)),
                  const Text('Estado anterior'),
                  if (transition.previousState == null)
                    const Text('Primer registro')
                  else
                    SemanticStatusLabel(
                      state: transition.previousState!,
                      showApplicability: true,
                    ),
                  const SizedBox(height: DialektikSpacing.space4),
                  const Text('Estado nuevo'),
                  SemanticStatusLabel(
                    state: transition.newState,
                    showApplicability: true,
                  ),
                ],
              ],
            ),
          ),
        ],
      );
    },
  );

  void _openSource(BuildContext context, String id) =>
      _open(context, '/sources/', id, onOpenSource);
  void _openArticle(BuildContext context, String id) =>
      _open(context, '/articles/', id, onOpenArticle);
  void _openOccurrence(BuildContext context, String id) =>
      _open(context, '/occurrences/', id, onOpenOccurrence);
  void _openThread(BuildContext context, String id) =>
      _open(context, '/threads/', id, onOpenThread);
}

final class _ProvenanceCoverage extends StatefulWidget {
  const _ProvenanceCoverage({
    required this.articles,
    required this.onOpenArticle,
    super.key,
  });
  final List<SemanticArticleDto> articles;
  final ValueChanged<String> onOpenArticle;

  @override
  State<_ProvenanceCoverage> createState() => _ProvenanceCoverageState();
}

final class _ProvenanceCoverageState extends State<_ProvenanceCoverage> {
  int _visible = EditorialLayout.coverageBatchSize;

  @override
  Widget build(BuildContext context) {
    final int shown = _visible.clamp(0, widget.articles.length);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        for (final SemanticArticleDto article in widget.articles.take(shown))
          EditorialTextButton(
            key: ValueKey<String>('provenance-news-${article.id}'),
            onPressed: () => widget.onOpenArticle(article.id),
            child: Text(
              '${editorialTitle(article.title)} · ${editorialSourceName(article.source.name)}',
              textAlign: TextAlign.start,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        if (widget.articles.length >
            EditorialLayout.coverageBatchSize) ...<Widget>[
          Text('Mostrando $shown de ${widget.articles.length} noticias'),
          if (shown < widget.articles.length)
            EditorialTextButton(
              onPressed: () =>
                  setState(() => _visible += EditorialLayout.coverageBatchSize),
              child: Text(
                'Ver más noticias de este evento · ${widget.articles.length - shown} restantes',
              ),
            ),
        ],
      ],
    );
  }
}

void _open(
  BuildContext context,
  String route,
  String id,
  ValueChanged<String>? callback,
) {
  if (callback != null) {
    callback(id);
  } else {
    Navigator.of(context).pushNamed('$route${Uri.encodeComponent(id)}');
  }
}

String _utc(DateTime time) => time.toUtc().toIso8601String();

/// These reader summaries cover only the eight already authored demo pieces.
/// Each restates its supplied text; the immutable original remains available.
const Map<String, (String, String)>
_authoredDemoSummaries = <String, (String, String)>{
  '2B4DGVDXRF72CRYN15X3P77MW2': (
    'El municipio anuncia la inspección del puente',
    'La municipalidad de Puerto Claro anunció una inspección del puente del Estuario para el 1 de octubre. La inspección es una etapa del proceso y no constituye la reparación.',
  ),
  '6PTAQ0A4Y57P9BCXBQEVKCM00X': (
    'El equipo técnico llega al puente',
    'Radio del Estuario informó de la llegada del equipo técnico al puente. La noticia describe la inspección anunciada y no afirma que la reparación haya comenzado.',
  ),
  '1129PSXM8TV5734Q6WHAB7WD9G': (
    'La inspección finaliza con un acta',
    'Agencia Horizonte describió el cierre de la inspección del puente del Estuario. El acta recomienda una intervención posterior; la noticia sigue describiendo la inspección.',
  ),
  '18SE056B6MQH01ZFCB8JPTQQDJ': (
    'Comienza la reparación tras la inspección',
    'En Puerto Claro comenzó una reparación el día posterior a la inspección. La noticia describe una etapa distinta de la inspección del mismo puente.',
  ),
  '0JS0TH5VJV17G1QV4W729SY9SF': (
    'El barrio documenta el inicio de las obras',
    'Cuaderno del Barrio publicó una noticia sobre las obras iniciadas esa mañana en el puente del Estuario. La noticia cubre el mismo inicio de reparación.',
  ),
  '6YF8325NTNMNJV4KBRVHH7SZE1': (
    'El puente vuelve a abrir después de las obras',
    'El municipio comunicó la reapertura del puente del Estuario tras la reparación. La reapertura es una etapa distinta de la inspección y del inicio de las obras.',
  ),
  '2VYQNQ3Y66BXNKZ1YH274626R8': (
    'La biblioteca de Villa Nube abre una sala',
    'En Villa Nube se abrió una sala de lectura. Este acontecimiento no forma parte del proceso del puente de Puerto Claro.',
  ),
  '3M6AE9DG92G28VX1MZ30NQMMRQ': (
    'Un informe menciona un puente sin identificarlo',
    'El informe menciona la inspección de un puente sin indicar localidad, nombre ni fecha del suceso. No hay información suficiente para decidir si corresponde al puente del Estuario.',
  ),
};

String? _authoredSummary(SemanticArticleDetailDto article) {
  final (String, String)? authored = _authoredDemoSummaries[article.id];
  return authored != null && authored.$1 == article.title ? authored.$2 : null;
}

final class _EvidenceHeading extends StatelessWidget {
  const _EvidenceHeading(this.title);
  final String title;

  @override
  Widget build(BuildContext context) => Semantics(
    header: true,
    child: Text(title, style: Theme.of(context).textTheme.titleLarge),
  );
}

final class _OriginalArticleText extends StatefulWidget {
  const _OriginalArticleText({required this.article});
  final SemanticArticleDetailDto article;
  @override
  State<_OriginalArticleText> createState() => _OriginalArticleTextState();
}

final class _OriginalArticleTextState extends State<_OriginalArticleText> {
  bool _expanded = false;

  @override
  void didUpdateWidget(covariant _OriginalArticleText oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.article.id != widget.article.id) _expanded = false;
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: <Widget>[
      Semantics(
        expanded: _expanded,
        child: EditorialTextButton(
          onPressed: () => setState(() => _expanded = !_expanded),
          child: Text(
            _expanded ? 'Ocultar texto completo' : 'Leer texto completo',
          ),
        ),
      ),
      if (_expanded) ...<Widget>[
        const SizedBox(height: DialektikSpacing.space6),
        const Text('Texto conservado en Dialektik · no abre un sitio externo'),
        const SizedBox(height: DialektikSpacing.space3),
        const _EvidenceHeading('Texto original'),
        const SizedBox(height: DialektikSpacing.space6),
        _EvidenceText(
          widget.article.originalText,
          semanticLabel:
              'Texto original de ${editorialSourceName(widget.article.source.name)}: ${widget.article.originalText}',
        ),
      ],
    ],
  );
}

final class _AssociationLabel extends StatelessWidget {
  const _AssociationLabel({required this.membership});
  final SemanticMembershipDto membership;

  @override
  Widget build(BuildContext context) => SemanticStatusLabel(
    state: SemanticStateValueDto(
      description: switch (membership.decision) {
        SemanticDecision.match => 'Asociación registrada',
        SemanticDecision.distinct => 'Asociación distinta',
        SemanticDecision.unknown => 'Asociación sin resolver',
      },
      decision: membership.decision,
      applicability: membership.applicability,
    ),
    showApplicability: true,
  );
}

final class _TechnicalLine extends StatelessWidget {
  const _TechnicalLine(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: DialektikSpacing.space3),
    child: _EvidenceText('$label: $value'),
  );
}

/// Explicit readable evidence alongside mouse/touch text selection. Flutter
/// web's selectable-text semantics must not hide the immutable record's text.
final class _EvidenceText extends StatelessWidget {
  const _EvidenceText(this.text, {this.semanticLabel});
  final String text;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    excludeSemantics: true,
    label: semanticLabel ?? text,
    child: SelectableText(text, style: Theme.of(context).textTheme.bodyLarge),
  );
}

final class _TechnicalDetails extends StatefulWidget {
  const _TechnicalDetails({required this.child});
  final Widget child;
  @override
  State<_TechnicalDetails> createState() => _TechnicalDetailsState();
}

final class _TechnicalDetailsState extends State<_TechnicalDetails> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: <Widget>[
      const Divider(),
      Semantics(
        expanded: _expanded,
        child: EditorialTextButton(
          onPressed: () => setState(() => _expanded = !_expanded),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Flexible(child: Text('Detalles técnicos')),
              const SizedBox(width: DialektikSpacing.space3),
              Icon(_expanded ? Icons.expand_less : Icons.expand_more),
            ],
          ),
        ),
      ),
      if (_expanded)
        Padding(
          padding: const EdgeInsets.symmetric(
            vertical: DialektikSpacing.space6,
          ),
          child: widget.child,
        ),
    ],
  );
}

final class _EvidenceLoader<T> extends StatefulWidget {
  const _EvidenceLoader({
    required this.title,
    required this.identity,
    required this.load,
    required this.content,
    this.eyebrow,
    this.titleOf,
  });
  final String title;
  final String? eyebrow;
  final String Function(T)? titleOf;
  final Object identity;
  final Future<T> Function(PublicRequestToken, bool refresh) load;
  final Widget Function(BuildContext, T) content;
  @override
  State<_EvidenceLoader<T>> createState() => _EvidenceLoaderState<T>();
}

final class _EvidenceLoaderState<T> extends State<_EvidenceLoader<T>> {
  PublicRequestToken _token = PublicRequestToken();
  late Future<T> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.load(_token, false);
  }

  @override
  void didUpdateWidget(covariant _EvidenceLoader<T> oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.identity != oldWidget.identity) {
      _token.cancel();
      _token = PublicRequestToken();
      _future = widget.load(_token, false);
    }
  }

  @override
  void dispose() {
    _token.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<T>(
    future: _future,
    builder: (BuildContext context, AsyncSnapshot<T> snapshot) {
      final bool loaded =
          snapshot.connectionState == ConnectionState.done &&
          !snapshot.hasError;
      return EditorialScaffold(
        title: loaded
            ? widget.titleOf?.call(snapshot.data as T) ?? widget.title
            : widget.title,
        eyebrow: loaded ? widget.eyebrow : null,
        scrollKey: PageStorageKey<Object>(widget.identity),
        child: _content(context, snapshot),
      );
    },
  );

  Widget _content(BuildContext context, AsyncSnapshot<T> snapshot) {
    if (snapshot.connectionState != ConnectionState.done) {
      return const EditorialLoading();
    }
    if (snapshot.hasError) {
      final bool missing =
          snapshot.error is PublicApiFailure &&
          (snapshot.error! as PublicApiFailure).kind ==
              PublicFailureKind.notFound;
      return EditorialEmptyState(
        title: missing
            ? 'Este contenido no está disponible.'
            : 'No se pudo cargar el contenido.',
        description: missing
            ? 'Puedes volver y continuar explorando.'
            : 'Comprueba la conexión y vuelve a intentarlo.',
        action: EditorialTextButton(
          onPressed: () {
            _token.cancel();
            _token = PublicRequestToken();
            final Future<T> next = widget.load(_token, true);
            next.ignore();
            setState(() {
              _future = next;
            });
          },
          child: const Text('Reintentar'),
        ),
      );
    }
    return widget.content(context, snapshot.data as T);
  }
}

final class _ContextReading {
  const _ContextReading(this.memberships, this.occurrences, this.threads);
  final List<SemanticMembershipDto> memberships;
  final Map<String, SemanticOccurrenceDto> occurrences;
  final Map<String, SemanticThreadDetailDto> threads;
}

Future<_ContextReading> _readContexts(
  SemanticRepository repository,
  List<SemanticMembershipDto> memberships,
  PublicRequestToken token, {
  required bool refresh,
}) async {
  final Map<String, SemanticMembershipDto> uniqueMemberships =
      <String, SemanticMembershipDto>{
        for (final SemanticMembershipDto membership in memberships)
          membership.observationId: membership,
      };
  final Set<String> occurrenceIds = <String>{
    for (final SemanticMembershipDto membership in uniqueMemberships.values)
      membership.occurrenceId,
  };
  final Set<String> threadIds = <String>{
    for (final SemanticMembershipDto membership in uniqueMemberships.values)
      membership.threadId,
  };
  final List<Object> result = await Future.wait<Object>(<Future<Object>>[
    Future.wait<SemanticOccurrenceDto>(<Future<SemanticOccurrenceDto>>[
      for (final String id in occurrenceIds)
        repository.getSemanticOccurrence(
          id,
          refresh: refresh,
          requestToken: token,
        ),
    ]),
    Future.wait<SemanticThreadDetailDto>(<Future<SemanticThreadDetailDto>>[
      for (final String id in threadIds)
        repository.getSemanticThread(id, refresh: refresh, requestToken: token),
    ]),
  ]);
  token.throwIfCancelled();
  final List<SemanticOccurrenceDto> occurrences =
      result[0] as List<SemanticOccurrenceDto>;
  final List<SemanticThreadDetailDto> threads =
      result[1] as List<SemanticThreadDetailDto>;
  return _ContextReading(
    List<SemanticMembershipDto>.unmodifiable(uniqueMemberships.values),
    <String, SemanticOccurrenceDto>{
      for (final SemanticOccurrenceDto occurrence in occurrences)
        occurrence.id: occurrence,
    },
    <String, SemanticThreadDetailDto>{
      for (final SemanticThreadDetailDto thread in threads)
        thread.thread.id: thread,
    },
  );
}

final class _ArticleReading {
  const _ArticleReading(this.article, this.context);
  final SemanticArticleDetailDto article;
  final _ContextReading context;
}

final class _ProvenanceReading {
  const _ProvenanceReading(this.provenance, this.context);
  final SemanticProvenanceDto provenance;
  final _ContextReading context;

  List<SemanticMembershipDto> get associations =>
      context.memberships.where((SemanticMembershipDto membership) {
        // A current context must never replace the immutable observation.
        if (membership.articleId != provenance.article.id ||
            membership.observedAt != provenance.observedAt ||
            membership.decision != provenance.article.decision ||
            membership.applicability != provenance.article.applicability) {
          return false;
        }
        final SemanticOccurrenceDto occurrence =
            context.occurrences[membership.occurrenceId]!;
        return occurrence.provenance.any(
              (SemanticProvenanceDto item) => item.id == provenance.id,
            ) ||
            context.threads[membership.threadId]!.timeline.transitions.any(
              (SemanticTransitionDto item) =>
                  item.provenanceId == provenance.id &&
                  (item.occurrenceId == null ||
                      item.occurrenceId == membership.occurrenceId),
            );
      }).toList();

  List<SemanticTransitionDto> get transitions =>
      <String, SemanticTransitionDto>{
        for (final SemanticThreadDetailDto thread in context.threads.values)
          for (final SemanticTransitionDto transition
              in thread.timeline.transitions)
            if (transition.provenanceId == provenance.id)
              transition.id: transition,
      }.values.toList();
}
