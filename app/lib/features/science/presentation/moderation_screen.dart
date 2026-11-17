import 'dart:async';

import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/science/data/science_models.dart';
import 'package:dialektik/features/science/data/science_repository.dart';
import 'package:dialektik/features/science/presentation/science_format.dart';
import 'package:dialektik/features/science/presentation/science_widgets.dart';
import 'package:dialektik/features/science/presentation/study_label_screen.dart';
import 'package:flutter/material.dart';

/// Opens the moderation screen; only moderators reach it (see «Tú»).
Future<void> openScienceModeration(BuildContext context, ArenaStore store) =>
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ScienceModerationScreen(store: store),
      ),
    );

/// «Tipo de estudio»: the fixed list Core accepts. A design outside it
/// (from before the list) is kept until the moderator picks one.
const List<String> studyDesigns = <String>[
  'Ensayo aleatorizado',
  'Cohorte',
  'Casos y controles',
  'Transversal',
  'Serie de casos',
  'Revisión sistemática',
  'Metaanálisis',
  'Estudio en animales',
  'Estudio in vitro',
  'Modelación',
  'Otro',
];

/// Minimal moderation for Science: the review queue (study comments and
/// reported comments), the fields of each study a moderator completes, and
/// the daily use of the metadata APIs.
class ScienceModerationScreen extends StatefulWidget {
  const ScienceModerationScreen({required this.store, super.key});

  final ArenaStore store;

  @override
  State<ScienceModerationScreen> createState() =>
      _ScienceModerationScreenState();
}

class _ScienceModerationScreenState extends State<ScienceModerationScreen> {
  ModerationQueue? _queue;
  ApiUsage? _usage;
  bool _failed = false;

  ScienceModerationRepository? get _repository => widget.store.moderation;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final ScienceModerationRepository? repository = _repository;
    if (repository == null) {
      setState(() => _failed = true);
      return;
    }
    try {
      final (ModerationQueue, ApiUsage) loaded = await (
        repository.moderationQueue(),
        repository.usage(),
      ).wait;
      if (!mounted) return;
      setState(() {
        _queue = loaded.$1;
        _usage = loaded.$2;
        _failed = false;
      });
    } on Object {
      if (mounted) setState(() => _failed = true);
    }
  }

  Future<void> _act(Future<void> Function() action, String done) async {
    try {
      await action();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(done)));
      await _load();
    } on Object {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('No se pudo guardar. Inténtalo de nuevo.'),
        ),
      );
    }
  }

  Future<void> _approve(ModerationItem item) => _act(
    () => _repository!.decide(item.comment.id, approve: true),
    'Comentario publicado',
  );

  Future<void> _reject(ModerationItem item) async {
    final String? reason = await askModerationReason(
      context,
      title: 'Rechazar el comentario',
      action: 'Rechazar',
    );
    if (reason == null) return;
    await _act(
      () =>
          _repository!.decide(item.comment.id, approve: false, reason: reason),
      'Comentario rechazado',
    );
  }

  Future<void> _dismiss(ModerationItem item) => _act(
    () => _repository!.resolveReports(item.comment.id, hide: false),
    'Reportes descartados',
  );

  Future<void> _hide(ModerationItem item) async {
    final String? reason = await askModerationReason(
      context,
      title: 'Ocultar el comentario',
      action: 'Ocultar',
    );
    if (reason == null) return;
    await _act(
      () => _repository!.resolveReports(
        item.comment.id,
        hide: true,
        reason: reason,
      ),
      'Comentario oculto',
    );
  }

  Future<void> _editStudy(Study study) async {
    final Study? saved = await Navigator.of(context).push<Study>(
      MaterialPageRoute<Study>(
        builder: (_) =>
            StudyModerationScreen(store: widget.store, study: study),
      ),
    );
    if (saved != null) await _load();
  }

  /// A tab label that wraps to two lines with large text. A [Tab] with an
  /// explicit height also gives the app bar its full height.
  static Tab _tab(BuildContext context, Key key, String label) {
    final double line = MediaQuery.textScalerOf(context).scale(15) * 1.25;
    return Tab(
      key: key,
      height: line > 26 ? line * 2 + 12 : 46,
      child: Text(
        label,
        maxLines: 2,
        textAlign: TextAlign.center,
        overflow: TextOverflow.ellipsis,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ModerationQueue? queue = _queue;
    final int pending = queue == null
        ? 0
        : queue.review.length + queue.reports.length;
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        backgroundColor: SciColors.bgApp,
        appBar: AppBar(
          backgroundColor: SciColors.surface,
          surfaceTintColor: Colors.transparent,
          foregroundColor: SciColors.ink,
          title: const Text(
            'Moderación de Ciencia',
            style: TextStyle(
              fontFamily: SciText.sans,
              fontSize: 17,
              fontWeight: FontWeight.w600,
            ),
          ),
          actions: <Widget>[
            IconButton(
              key: const Key('sci-mod-refresh'),
              tooltip: 'Actualizar',
              onPressed: () => unawaited(_load()),
              icon: const Icon(Icons.refresh),
            ),
          ],
          bottom: TabBar(
            // Two fixed halves; with large text a label wraps to a second
            // line instead of running off screen or over its neighbour.
            labelColor: SciColors.primaryText,
            unselectedLabelColor: SciColors.inkSecondary,
            indicatorColor: SciColors.primary,
            labelStyle: const TextStyle(
              fontFamily: SciText.sans,
              fontSize: 15,
              fontWeight: FontWeight.w600,
            ),
            tabs: <Widget>[
              _tab(context, const Key('sci-mod-tab-queue'), 'Cola · $pending'),
              _tab(context, const Key('sci-mod-tab-usage'), 'Consumo de APIs'),
            ],
          ),
        ),
        body: _failed
            ? _Message(
                'No pudimos cargar la moderación.',
                action: 'Reintentar',
                onAction: () => unawaited(_load()),
              )
            : queue == null
            ? const Center(child: CircularProgressIndicator())
            : TabBarView(
                children: <Widget>[
                  RefreshIndicator(
                    onRefresh: _load,
                    child: _QueueList(
                      queue: queue,
                      onApprove: _approve,
                      onReject: _reject,
                      onDismiss: _dismiss,
                      onHide: _hide,
                      onEditStudy: _editStudy,
                      onOpenStudy: (Study s) =>
                          unawaited(openStudyLabel(context, widget.store, s)),
                    ),
                  ),
                  RefreshIndicator(
                    onRefresh: _load,
                    child: ApiUsageView(
                      days: _usage?.days ?? const <ApiUsageDay>[],
                      harvest: _usage?.harvest,
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

class _QueueList extends StatelessWidget {
  const _QueueList({
    required this.queue,
    required this.onApprove,
    required this.onReject,
    required this.onDismiss,
    required this.onHide,
    required this.onEditStudy,
    required this.onOpenStudy,
  });

  final ModerationQueue queue;
  final ValueChanged<ModerationItem> onApprove;
  final ValueChanged<ModerationItem> onReject;
  final ValueChanged<ModerationItem> onDismiss;
  final ValueChanged<ModerationItem> onHide;
  final ValueChanged<Study> onEditStudy;
  final ValueChanged<Study> onOpenStudy;

  @override
  Widget build(BuildContext context) => ListView(
    key: const Key('sci-mod-queue'),
    padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
    children: <Widget>[
      if (queue.isEmpty)
        const _Message('No hay nada pendiente.')
      else ...<Widget>[
        _Heading('Con estudio, en revisión · ${queue.review.length}'),
        if (queue.review.isEmpty) const _Hint('Ningún comentario en revisión.'),
        for (final ModerationItem item in queue.review)
          ModerationCard(
            key: ValueKey<String>('sci-mod-review-${item.comment.id}'),
            item: item,
            actions: <Widget>[
              _ActionButton(
                key: ValueKey<String>('sci-mod-approve-${item.comment.id}'),
                label: 'Aprobar',
                primary: true,
                onPressed: () => onApprove(item),
              ),
              _ActionButton(
                key: ValueKey<String>('sci-mod-reject-${item.comment.id}'),
                label: 'Rechazar',
                onPressed: () => onReject(item),
              ),
            ],
            onEditStudy: onEditStudy,
            onOpenStudy: onOpenStudy,
          ),
        const SizedBox(height: 8),
        _Heading('Reportados · ${queue.reports.length}'),
        if (queue.reports.isEmpty) const _Hint('Ningún reporte abierto.'),
        for (final ModerationItem item in queue.reports)
          ModerationCard(
            key: ValueKey<String>('sci-mod-report-${item.comment.id}'),
            item: item,
            actions: <Widget>[
              _ActionButton(
                key: ValueKey<String>('sci-mod-dismiss-${item.comment.id}'),
                label: 'Descartar reportes',
                onPressed: () => onDismiss(item),
              ),
              _ActionButton(
                key: ValueKey<String>('sci-mod-hide-${item.comment.id}'),
                label: 'Ocultar comentario',
                primary: true,
                onPressed: () => onHide(item),
              ),
            ],
            onEditStudy: onEditStudy,
            onOpenStudy: onOpenStudy,
          ),
      ],
    ],
  );
}

/// One comment waiting for a decision: author, text, its study and claim,
/// and the reports it received.
class ModerationCard extends StatelessWidget {
  const ModerationCard({
    required this.item,
    required this.actions,
    required this.onEditStudy,
    required this.onOpenStudy,
    super.key,
  });

  final ModerationItem item;
  final List<Widget> actions;
  final ValueChanged<Study> onEditStudy;
  final ValueChanged<Study> onOpenStudy;

  @override
  Widget build(BuildContext context) {
    final StoryComment c = item.comment;
    final StudyAttachmentData? a = c.attachment;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: SciColors.surface,
        borderRadius: BorderRadius.circular(SciRadius.card),
        border: Border.all(color: SciColors.borderCard),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            '@${c.author} · ${sciAgo(c.createdAt)}',
            style: SciText.meta.copyWith(
              fontWeight: FontWeight.w700,
              color: SciColors.ink,
            ),
          ),
          const SizedBox(height: 6),
          Text(c.body, style: SciText.body),
          if (a != null) ...<Widget>[
            const SizedBox(height: 10),
            _Field('Responde a', '“${a.claim.text}” · ${a.claim.outlet}'),
            _Field('Relación', a.relation.label),
            _Field('Fragmento citado', '“${a.abstractFragment}”'),
            _Field('Estudio', a.study.title),
            if (!a.study.hasAbstract)
              const _Field(
                'Resumen',
                'Este estudio no tiene resumen disponible',
              ),
            Wrap(
              spacing: 8,
              children: <Widget>[
                TextButton(
                  key: ValueKey<String>('sci-mod-open-${c.id}'),
                  style: TextButton.styleFrom(
                    minimumSize: const Size(44, 44),
                    foregroundColor: SciColors.primaryText,
                  ),
                  onPressed: () => onOpenStudy(a.study),
                  child: const Text('Ver ficha'),
                ),
                TextButton(
                  key: ValueKey<String>('sci-mod-edit-${c.id}'),
                  style: TextButton.styleFrom(
                    minimumSize: const Size(44, 44),
                    foregroundColor: SciColors.primaryText,
                  ),
                  onPressed: () => onEditStudy(a.study),
                  child: const Text('Completar estudio'),
                ),
              ],
            ),
          ],
          if (item.reports.isNotEmpty) ...<Widget>[
            const SizedBox(height: 8),
            Text(
              item.reports.length == 1
                  ? '1 reporte'
                  : '${item.reports.length} reportes',
              style: SciText.label,
            ),
            for (final CommentReport r in item.reports)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  '· ${r.reason.label}${r.note == null ? '' : ': ${r.note}'}',
                  style: SciText.secondary,
                ),
              ),
          ],
          const SizedBox(height: 10),
          Wrap(spacing: 8, runSpacing: 8, children: actions),
        ],
      ),
    );
  }
}

/// Calls and errors per metadata API, totals for 30 days and day by day, so
/// a moderator can check OpenAlex without calling the API by hand.
class ApiUsageView extends StatelessWidget {
  const ApiUsageView({required this.days, this.harvest, super.key});

  final List<ApiUsageDay> days;

  /// The daily harvest; a notice when it has not finished in 48 hours.
  final HarvestStatus? harvest;

  static String sourceLabel(String source) => switch (source) {
    'openalex' => 'OpenAlex',
    'crossref' => 'Crossref',
    'europepmc' => 'Europe PMC',
    'unpaywall' => 'Unpaywall',
    'scielo' => 'SciELO',
    'semantic_scholar' => 'Semantic Scholar',
    _ => source,
  };

  @override
  Widget build(BuildContext context) {
    final List<String> sources =
        days.map((ApiUsageDay d) => d.source).toSet().toList()..sort();
    final List<DateTime> dates =
        days.map((ApiUsageDay d) => d.day).toSet().toList()
          ..sort((DateTime a, DateTime b) => b.compareTo(a));
    ApiUsageDay? at(String source, DateTime day) => days
        .where((ApiUsageDay d) => d.source == source && d.day == day)
        .firstOrNull;
    return ListView(
      key: const Key('sci-mod-usage'),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: <Widget>[
        if (harvest case final HarvestStatus h) HarvestNotice(status: h),
        const _Heading('Últimos 30 días'),
        if (days.isEmpty)
          const _Hint('Todavía no hay llamadas registradas.')
        else ...<Widget>[
          for (final String source in sources)
            Builder(
              builder: (BuildContext context) {
                final Iterable<ApiUsageDay> mine = days.where(
                  (ApiUsageDay d) => d.source == source,
                );
                final int calls = mine.fold(
                  0,
                  (int s, ApiUsageDay d) => s + d.calls,
                );
                final int errors = mine.fold(
                  0,
                  (int s, ApiUsageDay d) => s + d.errors,
                );
                return Container(
                  key: ValueKey<String>('sci-mod-usage-$source'),
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: SciColors.surface,
                    borderRadius: BorderRadius.circular(SciRadius.card),
                    border: Border.all(color: SciColors.borderCard),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(sourceLabel(source), style: SciText.cardTitle),
                      const SizedBox(height: 4),
                      Text(
                        '${_count(calls, 'llamada', 'llamadas')} · '
                        '${_count(errors, 'error', 'errores')}',
                        style: SciText.body.copyWith(
                          fontFeatures: const <FontFeature>[
                            FontFeature.tabularFigures(),
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          const SizedBox(height: 8),
          const _Heading('Día por día'),
          Container(
            decoration: BoxDecoration(
              color: SciColors.surface,
              borderRadius: BorderRadius.circular(SciRadius.card),
              border: Border.all(color: SciColors.borderCard),
            ),
            // Full width: every day starts at the same left edge.
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                for (int i = 0; i < dates.length; i++)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 10,
                    ),
                    decoration: BoxDecoration(
                      border: i == 0
                          ? null
                          : const Border(
                              top: BorderSide(color: SciColors.divider),
                            ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(sciShortDate(dates[i]), style: SciText.label),
                        for (final String source in sources)
                          if (at(source, dates[i]) case final ApiUsageDay d)
                            Text(
                              '${sourceLabel(source)}: '
                              '${_count(d.calls, 'llamada', 'llamadas')}, '
                              '${_count(d.errors, 'error', 'errores')}',
                              style: SciText.secondary.copyWith(
                                fontFeatures: const <FontFeature>[
                                  FontFeature.tabularFigures(),
                                ],
                              ),
                            ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  static String _count(int n, String one, String many) =>
      '$n ${n == 1 ? one : many}';
}

/// The fields of a study a moderator completes. Each one can be cleared back
/// to «No informado». The abstract is copied from the published article,
/// with its source; never a generated summary.
class StudyModerationScreen extends StatefulWidget {
  const StudyModerationScreen({
    required this.store,
    required this.study,
    super.key,
  });

  final ArenaStore store;
  final Study study;

  @override
  State<StudyModerationScreen> createState() => _StudyModerationScreenState();
}

class _StudyModerationScreenState extends State<StudyModerationScreen> {
  late final Map<String, TextEditingController> _fields =
      <String, TextEditingController>{
        'population': TextEditingController(text: widget.study.population),
        'sample_size': TextEditingController(
          text: widget.study.sampleSize?.toString(),
        ),
        'follow_up': TextEditingController(text: widget.study.followUp),
        'funding': TextEditingController(text: widget.study.funding),
        'conflicts': TextEditingController(text: widget.study.conflicts),
        'abstract': TextEditingController(text: widget.study.abstractText),
        'abstract_source': TextEditingController(
          text: widget.study.abstractSource,
        ),
      };
  bool _saving = false;
  String? _error;

  late String? _design = widget.study.design;
  late StudyReview _review = widget.study.review;

  static const List<(String, String)> labels = <(String, String)>[
    ('population', 'Población'),
    ('sample_size', 'Muestra (n)'),
    ('follow_up', 'Seguimiento'),
    ('funding', 'Financiamiento'),
    ('conflicts', 'Conflictos de interés'),
  ];

  @override
  void dispose() {
    for (final TextEditingController c in _fields.values) {
      c.dispose();
    }
    super.dispose();
  }

  String? _text(String key) {
    final String value = _fields[key]!.text.trim();
    return value.isEmpty ? null : value;
  }

  Future<void> _save() async {
    final ScienceModerationRepository? repository = widget.store.moderation;
    if (repository == null) return;
    final String? sample = _text('sample_size');
    final int? n = sample == null ? null : int.tryParse(sample);
    if (sample != null && (n == null || n <= 0)) {
      setState(
        () => _error = 'La muestra debe ser un número entero mayor que 0.',
      );
      return;
    }
    final String? abstract = _text('abstract');
    final String? source = _text('abstract_source');
    if (abstract != null && source == null) {
      setState(() => _error = 'Indica de dónde copiaste el resumen.');
      return;
    }
    final Map<String, Object?> fields = <String, Object?>{
      for (final (String key, String _) in labels)
        if (key != 'sample_size') key: _text(key),
      'sample_size': n,
      // A free-text design from before the fixed list is kept unless changed.
      if (_design != widget.study.design) 'design': _design,
      if (_review != widget.study.review)
        'review': switch (_review) {
          StudyReview.peerReviewed => 'peer_reviewed',
          StudyReview.preprint => 'preprint',
          StudyReview.notReported => 'not_reported',
        },
    };
    // Only touch the abstract when it changed: Crossref's stays untouched.
    if (abstract != widget.study.abstractText?.trim() ||
        source != widget.study.abstractSource) {
      fields['abstract'] = abstract == null
          ? null
          : <String, Object?>{
              'text': abstract,
              'source': source,
              'language': widget.study.abstractLanguage,
            };
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final Study saved = await repository.moderateStudy(
        widget.study.doi,
        StudyModeration(fields),
      );
      if (mounted) Navigator.of(context).pop(saved);
    } on Object {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = 'No se pudo guardar. Inténtalo de nuevo.';
        });
      }
    }
  }

  InputDecoration _decoration(String label, {String? helper}) =>
      InputDecoration(
        labelText: label,
        helperText: helper,
        helperMaxLines: 3,
        border: const OutlineInputBorder(),
        enabledBorder: const OutlineInputBorder(
          borderSide: BorderSide(color: SciColors.borderControl),
        ),
      );

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: SciColors.surface,
    appBar: AppBar(
      backgroundColor: SciColors.surface,
      surfaceTintColor: Colors.transparent,
      foregroundColor: SciColors.ink,
      title: const Text(
        'Completar estudio',
        style: TextStyle(
          fontFamily: SciText.sans,
          fontSize: 17,
          fontWeight: FontWeight.w600,
        ),
      ),
    ),
    body: ListView(
      key: const Key('sci-mod-study-form'),
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: <Widget>[
        Text(widget.study.title, style: SciText.cardTitle),
        const SizedBox(height: 4),
        Text('DOI ${widget.study.doi}', style: SciText.meta),
        const SizedBox(height: 4),
        const Text(
          'Un campo vacío se muestra como «No informado».',
          style: SciText.secondary,
        ),
        const SizedBox(height: 16),
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: DropdownButtonFormField<String?>(
            key: const Key('sci-mod-field-design'),
            initialValue: _design,
            isExpanded: true,
            decoration: _decoration('Tipo de estudio'),
            items: <DropdownMenuItem<String?>>[
              const DropdownMenuItem<String?>(child: Text(notInformed)),
              for (final String d in <String>[
                ...studyDesigns,
                if (_design != null && !studyDesigns.contains(_design))
                  _design!,
              ])
                DropdownMenuItem<String?>(value: d, child: Text(d)),
            ],
            onChanged: (String? value) => setState(() => _design = value),
          ),
        ),
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: DropdownButtonFormField<StudyReview>(
            key: const Key('sci-mod-field-review'),
            initialValue: _review,
            isExpanded: true,
            decoration: _decoration('Revisión'),
            items: const <DropdownMenuItem<StudyReview>>[
              DropdownMenuItem<StudyReview>(
                value: StudyReview.peerReviewed,
                child: Text('Revisado por pares'),
              ),
              DropdownMenuItem<StudyReview>(
                value: StudyReview.preprint,
                child: Text('Preprint'),
              ),
              DropdownMenuItem<StudyReview>(
                value: StudyReview.notReported,
                child: Text(notInformed),
              ),
            ],
            onChanged: (StudyReview? value) {
              if (value != null) setState(() => _review = value);
            },
          ),
        ),
        for (final (String key, String label) in labels)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: TextField(
              key: ValueKey<String>('sci-mod-field-$key'),
              controller: _fields[key],
              keyboardType: key == 'sample_size'
                  ? TextInputType.number
                  : TextInputType.text,
              decoration: _decoration(label),
            ),
          ),
        const _Heading('Resumen'),
        TextField(
          key: const Key('sci-mod-field-abstract'),
          controller: _fields['abstract'],
          minLines: 4,
          maxLines: 12,
          maxLength: 12000,
          decoration: _decoration(
            'Resumen del artículo',
            helper:
                'Cópialo tal cual del artículo publicado. No uses resúmenes '
                'generados.',
          ),
        ),
        const SizedBox(height: 8),
        TextField(
          key: const Key('sci-mod-field-abstract_source'),
          controller: _fields['abstract_source'],
          maxLength: 120,
          decoration: _decoration(
            'Fuente del resumen',
            helper: 'Por ejemplo, la revista o el repositorio del artículo.',
          ),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              _error!,
              key: const Key('sci-mod-study-error'),
              style: SciText.body.copyWith(color: SciColors.ink),
            ),
          ),
        const SizedBox(height: 12),
        FilledButton(
          key: const Key('sci-mod-study-save'),
          style: FilledButton.styleFrom(
            minimumSize: const Size.fromHeight(48),
            backgroundColor: SciColors.primary,
            textStyle: const TextStyle(
              fontFamily: SciText.sans,
              fontSize: 16,
              fontWeight: FontWeight.w600,
            ),
          ),
          onPressed: _saving ? null : () => unawaited(_save()),
          child: Text(_saving ? 'Guardando…' : 'Guardar'),
        ),
      ],
    ),
  );
}

/// Asks for the reason a moderator gives to reject or hide (2–300 chars).
Future<String?> askModerationReason(
  BuildContext context, {
  required String title,
  required String action,
}) => showModalBottomSheet<String>(
  context: context,
  isScrollControlled: true,
  backgroundColor: SciColors.surface,
  shape: const RoundedRectangleBorder(
    borderRadius: BorderRadius.vertical(top: Radius.circular(SciRadius.sheet)),
  ),
  builder: (_) => _ReasonSheet(title: title, action: action),
);

class _ReasonSheet extends StatefulWidget {
  const _ReasonSheet({required this.title, required this.action});

  final String title;
  final String action;

  @override
  State<_ReasonSheet> createState() => _ReasonSheetState();
}

class _ReasonSheetState extends State<_ReasonSheet> {
  final TextEditingController _reason = TextEditingController();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  bool get _valid => _reason.text.trim().length >= 2;

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
    child: SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
        child: Column(
          key: const Key('sci-mod-reason-sheet'),
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            const SheetHandle(),
            const SizedBox(height: 12),
            Text(widget.title, style: SciText.cardTitle),
            const SizedBox(height: 12),
            TextField(
              key: const Key('sci-mod-reason'),
              controller: _reason,
              autofocus: true,
              maxLength: 300,
              minLines: 2,
              maxLines: 4,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                labelText: 'Motivo (obligatorio)',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 8),
            FilledButton(
              key: const Key('sci-mod-reason-confirm'),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
                backgroundColor: SciColors.primary,
              ),
              onPressed: _valid
                  ? () => Navigator.of(context).pop(_reason.text.trim())
                  : null,
              child: Text(widget.action),
            ),
          ],
        ),
      ),
    ),
  );
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({
    required this.label,
    required this.onPressed,
    this.primary = false,
    super.key,
  });

  final String label;
  final VoidCallback onPressed;
  final bool primary;

  @override
  Widget build(BuildContext context) {
    const TextStyle text = TextStyle(
      fontFamily: SciText.sans,
      fontSize: 15,
      fontWeight: FontWeight.w600,
    );
    return primary
        ? FilledButton(
            style: FilledButton.styleFrom(
              minimumSize: const Size(44, 44),
              backgroundColor: SciColors.primary,
              textStyle: text,
            ),
            onPressed: onPressed,
            child: Text(label),
          )
        : OutlinedButton(
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(44, 44),
              foregroundColor: SciColors.ink,
              side: const BorderSide(color: SciColors.borderControl),
              textStyle: text,
            ),
            onPressed: onPressed,
            child: Text(label),
          );
  }
}

class _Field extends StatelessWidget {
  const _Field(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 4),
    child: Text.rich(
      TextSpan(
        children: <InlineSpan>[
          TextSpan(
            text: '$label: ',
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
          TextSpan(text: value),
        ],
      ),
      style: SciText.secondary.copyWith(color: SciColors.ink),
    ),
  );
}

class _Heading extends StatelessWidget {
  const _Heading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 4, bottom: 10),
    child: Semantics(header: true, child: Text(text, style: SciText.cardTitle)),
  );
}

class _Hint extends StatelessWidget {
  const _Hint(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Text(text, style: SciText.secondary),
  );
}

class _Message extends StatelessWidget {
  const _Message(this.text, {this.action, this.onAction});

  final String text;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(32),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(text, style: SciText.body, textAlign: TextAlign.center),
        if (action != null)
          TextButton(
            style: TextButton.styleFrom(minimumSize: const Size(44, 44)),
            onPressed: onAction,
            child: Text(action!),
          ),
      ],
    ),
  );
}

/// State of the daily harvest. When no run finished in 48 hours, it says
/// so plainly, whatever happened to the scheduled job.
class HarvestNotice extends StatelessWidget {
  const HarvestNotice({required this.status, super.key});

  final HarvestStatus status;

  @override
  Widget build(BuildContext context) {
    final DateTime? last = status.lastRunAt;
    final String text = last == null
        ? 'La cosecha diaria todavía no ha terminado ninguna corrida.'
        : status.stale
        ? 'La cosecha diaria no termina hace más de 48 horas. Última: '
              '${sciShortDate(last.toLocal())}.'
        : 'Última cosecha: ${sciShortDate(last.toLocal())}'
              '${status.lastStatus == 'partial' ? ' (parcial)' : ''} · '
              '${status.added} ${status.added == 1 ? 'agregado' : 'agregados'} · '
              '${status.deleted} ${status.deleted == 1 ? 'borrado' : 'borrados'} '
              'por antigüedad.';
    final bool warn = status.stale || last == null;
    return Semantics(
      container: true,
      liveRegion: warn,
      child: Container(
        key: const Key('sci-mod-harvest'),
        margin: const EdgeInsets.only(bottom: 16),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: SciColors.surface,
          borderRadius: BorderRadius.circular(SciRadius.card),
          border: Border.all(
            color: warn ? SciColors.ink : SciColors.borderCard,
            width: warn ? 1.5 : 1,
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(
              warn ? Icons.error_outline : Icons.event_available_outlined,
              size: 20,
              color: SciColors.ink,
            ),
            const SizedBox(width: 10),
            Expanded(child: Text(text, style: SciText.body)),
          ],
        ),
      ),
    );
  }
}
