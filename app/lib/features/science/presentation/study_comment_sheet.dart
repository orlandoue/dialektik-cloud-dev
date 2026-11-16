import 'dart:async';

import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/science/data/science_models.dart';
import 'package:dialektik/features/science/data/science_repository.dart';
import 'package:dialektik/features/science/presentation/science_format.dart';
import 'package:dialektik/features/science/presentation/science_widgets.dart';
import 'package:flutter/material.dart';

/// Literal quotes of a story that a study comment can answer.
List<ClaimQuote> claimQuotesOf(EventDetailDto event) {
  final Map<String, EventCoverageArticleDto> articles =
      <String, EventCoverageArticleDto>{
        for (final EventCoverageArticleDto a in event.articles) a.id: a,
      };
  return <ClaimQuote>[
    for (final EventCoveragePositionDto position in event.coveragePositions)
      for (final EventCoverageAssertionDto a in position.assertions)
        if (a.quotedText.trim().isNotEmpty)
          ClaimQuote(
            id: a.id,
            text: a.quotedText.trim(),
            outlet: arenaSourceName(a.sourceName),
            publishedAt: articles[a.articleId]?.publishedAt,
          ),
  ];
}

/// C2 · «Comentar con un estudio». Returns the comment created (in review),
/// or the id of an existing one when the reader chose «Ver comentario».
Future<StoryComment?> showStudyCommentSheet(
  BuildContext context,
  ArenaStore store, {
  Study? study,
  EventDetailDto? event,
  List<StoryComment> existing = const <StoryComment>[],
  ValueChanged<String>? onShowExisting,
}) async {
  final Study? chosen = study ?? await _pickStudy(context, store);
  if (chosen == null || !context.mounted) return null;
  final StoryComment? created = await showModalBottomSheet<StoryComment>(
    context: context,
    isScrollControlled: true,
    backgroundColor: SciColors.surface,
    barrierColor: SciColors.scrim,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(
        top: Radius.circular(SciRadius.sheet),
      ),
    ),
    builder: (BuildContext sheetContext) => StudyCommentSheet(
      store: store,
      study: chosen,
      event: event,
      existing: existing,
      onShowExisting: onShowExisting,
    ),
  );
  if (created != null && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Tu comentario está en revisión')),
    );
  }
  return created;
}

/// Choose the study first when the sheet opens from a story.
Future<Study?> _pickStudy(BuildContext context, ArenaStore store) =>
    showModalBottomSheet<Study>(
      context: context,
      isScrollControlled: true,
      backgroundColor: SciColors.surface,
      barrierColor: SciColors.scrim,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(SciRadius.sheet),
        ),
      ),
      builder: (BuildContext sheetContext) => _StudyPicker(store: store),
    );

class _StudyPicker extends StatefulWidget {
  const _StudyPicker({required this.store});

  final ArenaStore store;

  @override
  State<_StudyPicker> createState() => _StudyPickerState();
}

class _StudyPickerState extends State<_StudyPicker> {
  final TextEditingController _doi = TextEditingController();
  Future<List<Study>>? _studies;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _studies = widget.store.science?.listStudies(StudyFilter.recent);
  }

  @override
  void dispose() {
    _doi.dispose();
    super.dispose();
  }

  Future<void> _lookup() async {
    final ScienceRepository? repository = widget.store.science;
    final String doi = _doi.text.trim().replaceFirst(
      RegExp(r'^(https?://)?(dx\.)?doi\.org/'),
      '',
    );
    if (repository == null || doi.isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final Study study = await repository.study(doi);
      if (mounted) Navigator.of(context).pop(study);
    } on Object {
      if (mounted) setState(() => _error = 'No encontramos ese DOI');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        8,
        20,
        16 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const SheetHandle(),
          const SizedBox(height: 12),
          const Text(
            'Elige el estudio',
            style: TextStyle(
              fontFamily: SciText.sans,
              fontSize: 18,
              fontWeight: FontWeight.w600,
              color: SciColors.ink,
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            key: const Key('sci-doi-input'),
            controller: _doi,
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => unawaited(_lookup()),
            style: SciText.body,
            decoration: InputDecoration(
              hintText: 'DOI, por ejemplo 10.7326/M18-2101',
              errorText: _error,
              constraints: const BoxConstraints(minHeight: 44),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(SciRadius.rowButton),
                borderSide: const BorderSide(color: SciColors.borderControl),
              ),
              suffixIcon: IconButton(
                tooltip: 'Buscar DOI',
                onPressed: () => unawaited(_lookup()),
                icon: const Icon(SciIcons.search),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Flexible(
            child: FutureBuilder<List<Study>>(
              future: _studies,
              builder: (BuildContext context, AsyncSnapshot<List<Study>> s) =>
                  ListView(
                    shrinkWrap: true,
                    children: <Widget>[
                      for (final Study study in s.data ?? const <Study>[])
                        ListTile(
                          minTileHeight: 56,
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(
                            SciIcons.flask,
                            size: 22,
                            color: SciColors.ink,
                          ),
                          title: Text(study.title, style: SciText.secondary),
                          onTap: () => Navigator.of(context).pop(study),
                        ),
                    ],
                  ),
            ),
          ),
        ],
      ),
    ),
  );
}

class StudyCommentSheet extends StatefulWidget {
  const StudyCommentSheet({
    required this.store,
    required this.study,
    this.event,
    this.existing = const <StoryComment>[],
    this.onShowExisting,
    super.key,
  });

  final ArenaStore store;
  final Study study;
  final EventDetailDto? event;
  final List<StoryComment> existing;
  final ValueChanged<String>? onShowExisting;

  @override
  State<StudyCommentSheet> createState() => _StudyCommentSheetState();
}

class _StudyCommentSheetState extends State<StudyCommentSheet> {
  final TextEditingController _comment = TextEditingController();
  EventDetailDto? _event;
  String? _claimId;
  StudyRelation? _relation;
  String _fragment = '';
  bool _fragmentInvalid = false;
  bool _busy = false;
  String? _error;
  String? _duplicateId;

  static const int maxLength = 280;

  Study get study => widget.study;

  @override
  void initState() {
    super.initState();
    _event = widget.event;
    _comment.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  List<ClaimQuote> get _claims =>
      _event == null ? const <ClaimQuote>[] : claimQuotesOf(_event!);

  /// Same DOI and same claim already in this story's thread.
  String? _duplicateOf(String? claimId) {
    for (final StoryComment c in widget.existing) {
      final StudyAttachmentData? a = c.attachment;
      if (a != null && a.study.doi == study.doi && a.claim.id == claimId) {
        return c.id;
      }
    }
    return null;
  }

  bool get _complete =>
      !study.retracted &&
      _duplicateId == null &&
      _event != null &&
      _claimId != null &&
      _relation != null &&
      _fragment.isNotEmpty &&
      !_fragmentInvalid &&
      _comment.text.trim().isNotEmpty;

  Future<void> _changeStory() async {
    final EventCardDto? picked = await showModalBottomSheet<EventCardDto>(
      context: context,
      backgroundColor: SciColors.surface,
      barrierColor: SciColors.scrim,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(SciRadius.sheet),
        ),
      ),
      builder: (BuildContext sheetContext) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
          children: <Widget>[
            const SheetHandle(),
            const SizedBox(height: 12),
            const Text('Noticia', style: SciText.cardTitle),
            for (final EventCardDto e in widget.store.events)
              ListTile(
                minTileHeight: 56,
                contentPadding: EdgeInsets.zero,
                title: Text(e.arenaTitle, style: SciText.secondary),
                onTap: () => Navigator.of(sheetContext).pop(e),
              ),
          ],
        ),
      ),
    );
    if (picked == null) return;
    try {
      final EventDetailDto detail = await widget.store.detail(picked.id);
      if (mounted) {
        setState(() {
          _event = detail;
          _claimId = null;
          _duplicateId = null;
        });
      }
    } on Object {
      if (mounted) {
        setState(() => _error = 'No pudimos cargar esa noticia');
      }
    }
  }

  void _selectClaim(String id) => setState(() {
    _claimId = id;
    _duplicateId = _duplicateOf(id);
  });

  void _selectFragment(String value) {
    final String text = value.trim();
    setState(() {
      _fragment = text;
      _fragmentInvalid =
          text.isNotEmpty && !isLiteralFragment(text, study.abstractText ?? '');
    });
  }

  Future<void> _publish() async {
    final ScienceRepository? repository = widget.store.science;
    if (!_complete || _busy || repository == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final StoryComment created = await repository.addStudyComment(
        _event!.id,
        doi: study.doi,
        claimQuoteId: _claimId!,
        relation: _relation!,
        abstractFragment: _fragment,
        body: _comment.text.trim(),
        alias: widget.store.alias,
      );
      if (mounted) Navigator.of(context).pop(created);
    } on StudyCommentRejected catch (rejected) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        switch (rejected.reason) {
          case 'duplicate':
            _duplicateId =
                rejected.existingCommentId ?? _duplicateOf(_claimId) ?? '';
          case 'not_literal':
            _fragmentInvalid = true;
          case 'account_too_new':
            _error =
                'Tu cuenta debe tener al menos 3 días para comentar con un '
                'estudio.';
          default:
            _error = 'No pudimos publicar el comentario.';
        }
      });
    } on Object {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = 'No pudimos publicar el comentario. Inténtalo de nuevo.';
        });
      }
    }
  }

  Widget _stepLabel(int n, String label, [String? note]) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Semantics(
      header: true,
      child: Text.rich(
        TextSpan(
          children: <InlineSpan>[
            TextSpan(text: '$n · $label'),
            if (note != null)
              TextSpan(
                text: ' $note',
                style: const TextStyle(
                  fontWeight: FontWeight.w400,
                  color: SciColors.inkSecondary,
                ),
              ),
          ],
        ),
        style: const TextStyle(
          fontFamily: SciText.sans,
          fontSize: 13,
          height: 18 / 13,
          fontWeight: FontWeight.w600,
          color: SciColors.ink,
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final double height = MediaQuery.sizeOf(context).height;
    final List<ClaimQuote> claims = _claims;
    final bool twoByTwo = MediaQuery.textScalerOf(context).scale(10) >= 15;
    final int count = _comment.text.characters.length;
    return SizedBox(
      key: const Key('sci-comment-sheet'),
      height: height < 830 ? height - 40 : 790,
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: SheetHandle(),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 8, 0),
              child: Row(
                children: <Widget>[
                  const Expanded(
                    child: Text(
                      'Comentar con un estudio',
                      style: TextStyle(
                        fontFamily: SciText.sans,
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                        color: SciColors.ink,
                      ),
                    ),
                  ),
                  TextButton(
                    key: const Key('sci-sheet-cancel'),
                    style: TextButton.styleFrom(
                      minimumSize: const Size(44, 44),
                      foregroundColor: SciColors.primaryText,
                      textStyle: const TextStyle(
                        fontFamily: SciText.sans,
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('Cancelar'),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                key: const Key('sci-sheet-scroll'),
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 12),
                children: <Widget>[
                  if (study.retracted) ...<Widget>[
                    DecoratedBox(
                      key: const Key('sci-retracted'),
                      decoration: BoxDecoration(
                        color: SciColors.bgApp,
                        borderRadius: BorderRadius.circular(
                          SciRadius.rowButton,
                        ),
                        border: Border.all(color: SciColors.ink),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Text(
                          study.retractedAt == null
                              ? 'La revista retractó este artículo'
                              : 'La revista retractó este artículo el '
                                    '${sciLongDate(study.retractedAt!)}',
                          style: SciText.body,
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  Text(
                    '${study.title} · ${study.reviewLabel}'
                    '${study.design == null ? '' : ' · ${study.design}'}',
                    style: SciText.meta,
                  ),
                  const SizedBox(height: 12),
                  _stepLabel(1, 'Noticia'),
                  _StoryField(
                    title: _event?.arenaTitle,
                    onChange: () => unawaited(_changeStory()),
                  ),
                  const SizedBox(height: 12),
                  _stepLabel(
                    2,
                    'Afirmación que aborda',
                    '(cita de la noticia)',
                  ),
                  if (_event != null && claims.isEmpty)
                    const Text(
                      'Esta noticia aún no tiene citas literales.',
                      style: SciText.secondary,
                    ),
                  for (final ClaimQuote claim in claims)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: _ClaimOption(
                        claim: claim,
                        selected: claim.id == _claimId,
                        onTap: () => _selectClaim(claim.id),
                      ),
                    ),
                  if (_duplicateId != null) ...<Widget>[
                    Row(
                      key: const Key('sci-duplicate'),
                      children: <Widget>[
                        const Expanded(
                          child: Text(
                            'Este estudio ya está conectado a esta afirmación',
                            style: SciText.secondary,
                          ),
                        ),
                        TextButton(
                          style: TextButton.styleFrom(
                            minimumSize: const Size(44, 44),
                            foregroundColor: SciColors.primaryText,
                          ),
                          onPressed: () {
                            Navigator.of(context).pop();
                            widget.onShowExisting?.call(_duplicateId!);
                          },
                          child: const Text('Ver comentario'),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 12),
                  _stepLabel(3, 'Según tú, el estudio…'),
                  Semantics(
                    label: 'Según tú, el estudio…',
                    child: GridView.count(
                      crossAxisCount: twoByTwo ? 2 : 4,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      mainAxisSpacing: 6,
                      crossAxisSpacing: 6,
                      childAspectRatio: twoByTwo ? 2.6 : 1.7,
                      children: <Widget>[
                        for (final StudyRelation relation
                            in StudyRelation.values)
                          SelectChip(
                            key: ValueKey<String>(
                              'sci-relation-${relation.wire}',
                            ),
                            label: relation.label,
                            selected: relation == _relation,
                            fontSize: 13,
                            radius: 10,
                            expand: true,
                            radio: true,
                            onTap: () => setState(() => _relation = relation),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  _stepLabel(4, 'Fragmento literal del resumen'),
                  _AbstractPicker(
                    study: study,
                    fragment: _fragment,
                    invalid: _fragmentInvalid,
                    onSelected: _selectFragment,
                  ),
                  const SizedBox(height: 12),
                  _stepLabel(5, 'Tu comentario', '(se publica con tu alias)'),
                  TextField(
                    key: const Key('sci-comment-input'),
                    controller: _comment,
                    minLines: 2,
                    maxLines: 5,
                    maxLength: maxLength,
                    style: const TextStyle(
                      fontFamily: SciText.sans,
                      fontSize: 14,
                      height: 20 / 14,
                      color: SciColors.ink,
                    ),
                    buildCounter:
                        (
                          BuildContext context, {
                          required int currentLength,
                          required bool isFocused,
                          required int? maxLength,
                        }) => Text(
                          '$currentLength/$maxLength',
                          style: TextStyle(
                            fontFamily: SciText.sans,
                            fontSize: 12,
                            color: currentLength >= 260
                                ? SciColors.ink
                                : SciColors.inkSecondary,
                          ),
                        ),
                    decoration: InputDecoration(
                      hintText: 'Escribe tu comentario',
                      hintStyle: const TextStyle(color: SciColors.inkSecondary),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 10,
                      ),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(
                          SciRadius.rowButton,
                        ),
                        borderSide: const BorderSide(
                          color: SciColors.borderControl,
                        ),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(
                          SciRadius.rowButton,
                        ),
                        borderSide: const BorderSide(
                          color: SciColors.borderControl,
                        ),
                      ),
                    ),
                  ),
                  if (count > maxLength) const SizedBox.shrink(),
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(_error!, style: SciText.body),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  SizedBox(
                    height: 50,
                    child: FilledButton(
                      key: const Key('sci-publish'),
                      onPressed: _complete && !_busy
                          ? () => unawaited(_publish())
                          : null,
                      style: FilledButton.styleFrom(
                        backgroundColor: SciColors.primary,
                        foregroundColor: Colors.white,
                        disabledBackgroundColor: SciColors.borderCard,
                        disabledForegroundColor: SciColors.inkSecondary,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(
                            SciRadius.fullButton,
                          ),
                        ),
                        textStyle: const TextStyle(
                          fontFamily: SciText.sans,
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      child: _busy
                          ? const SizedBox.square(
                              dimension: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Text('Publicar comentario'),
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Los comentarios con estudio se revisan antes de aparecer '
                    'en el hilo.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontFamily: SciText.sans,
                      fontSize: 12,
                      height: 17 / 12,
                      color: SciColors.inkSecondary,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StoryField extends StatelessWidget {
  const _StoryField({required this.title, required this.onChange});

  final String? title;
  final VoidCallback onChange;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      borderRadius: BorderRadius.circular(SciRadius.rowButton),
      border: Border.all(color: SciColors.borderControl),
    ),
    child: ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 44),
      child: Padding(
        padding: const EdgeInsets.only(left: 12),
        child: Row(
          children: <Widget>[
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  title ?? 'Elige una noticia',
                  style: TextStyle(
                    fontFamily: SciText.sans,
                    fontSize: 14,
                    height: 20 / 14,
                    fontWeight: FontWeight.w500,
                    color: title == null
                        ? SciColors.inkSecondary
                        : SciColors.ink,
                  ),
                ),
              ),
            ),
            TextButton(
              key: const Key('sci-story-change'),
              style: TextButton.styleFrom(
                minimumSize: const Size(44, 44),
                foregroundColor: SciColors.primaryText,
                textStyle: const TextStyle(
                  fontFamily: SciText.sans,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              onPressed: onChange,
              child: Text(title == null ? 'Elegir' : 'Cambiar'),
            ),
          ],
        ),
      ),
    ),
  );
}

class _ClaimOption extends StatelessWidget {
  const _ClaimOption({
    required this.claim,
    required this.selected,
    required this.onTap,
  });

  final ClaimQuote claim;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final String source = <String>[
      ?claim.speaker,
      claim.outlet,
      if (claim.publishedAt != null) sciShortDate(claim.publishedAt!),
    ].join(' · ');
    return Semantics(
      inMutuallyExclusiveGroup: true,
      checked: selected,
      label: '“${claim.text}”. $source',
      excludeSemantics: true,
      child: GestureDetector(
        key: ValueKey<String>('sci-claim-${claim.id}'),
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Container(
          constraints: const BoxConstraints(minHeight: 44),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(SciRadius.rowButton),
            border: Border.all(
              color: selected ? SciColors.ink : SciColors.borderControl,
              width: selected ? 2 : 1,
            ),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Padding(
                padding: const EdgeInsets.only(top: 1),
                child: Container(
                  width: 18,
                  height: 18,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: SciColors.ink, width: 2),
                  ),
                  alignment: Alignment.center,
                  child: selected
                      ? const SizedBox.square(
                          dimension: 8,
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              color: SciColors.ink,
                              shape: BoxShape.circle,
                            ),
                          ),
                        )
                      : null,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text('“${claim.text}”', style: SciText.quote),
                    const SizedBox(height: 2),
                    Text(source, style: SciText.label),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The abstract, selectable; the chosen words become the fragment.
class _AbstractPicker extends StatelessWidget {
  const _AbstractPicker({
    required this.study,
    required this.fragment,
    required this.invalid,
    required this.onSelected,
  });

  final Study study;
  final String fragment;
  final bool invalid;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final String? abstractText = study.abstractText;
    if (abstractText == null || abstractText.trim().isEmpty) {
      return const Text('Resumen: $notInformed', style: SciText.secondary);
    }
    final Locale? locale = study.abstractLanguage == null
        ? null
        : Locale(study.abstractLanguage!);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const Text(
          'Selecciona en el resumen las palabras que muestran la relación.',
          style: SciText.label,
        ),
        const SizedBox(height: 6),
        SelectableText(
          abstractText,
          key: const Key('sci-abstract'),
          style: TextStyle(
            fontFamily: SciText.serif,
            fontSize: 13,
            height: 20 / 13,
            color: SciColors.ink,
            locale: locale,
          ),
          onSelectionChanged: (TextSelection selection, _) {
            if (!selection.isCollapsed) {
              onSelected(selection.textInside(abstractText));
            }
          },
        ),
        if (fragment.isNotEmpty) ...<Widget>[
          const SizedBox(height: 8),
          DecoratedBox(
            key: const Key('sci-fragment'),
            decoration: BoxDecoration(
              color: SciColors.bgApp,
              borderRadius: BorderRadius.circular(SciRadius.rowButton),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              child: Text(
                '“$fragment”',
                locale: locale,
                style: const TextStyle(
                  fontFamily: SciText.serif,
                  fontSize: 13,
                  height: 20 / 13,
                  color: SciColors.ink,
                ),
              ),
            ),
          ),
        ],
        if (invalid)
          const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Text(
              'El fragmento debe copiarse tal cual del resumen',
              key: Key('sci-fragment-error'),
              style: TextStyle(
                fontFamily: SciText.sans,
                fontSize: 13,
                height: 18 / 13,
                fontWeight: FontWeight.w600,
                color: SciColors.ink,
              ),
            ),
          ),
      ],
    );
  }
}
