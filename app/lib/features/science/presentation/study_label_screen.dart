import 'dart:async';

import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/science/data/science_models.dart';
import 'package:dialektik/features/science/presentation/science_format.dart';
import 'package:dialektik/features/science/presentation/science_widgets.dart';
import 'package:flutter/material.dart';

Future<void> openStudyLabel(
  BuildContext context,
  ArenaStore store,
  Study study,
) => Navigator.of(context).push(
  MaterialPageRoute<void>(
    builder: (_) => StudyLabelScreen(store: store, study: study),
  ),
);

String _valueOr(String? value) =>
    value == null || value.trim().isEmpty ? notInformed : value;

/// One labelled value of a study; «No informado» when unverified.
typedef StudyRow = ({String label, String? value, bool tabular});

List<(String, List<StudyRow>)> studyLabelSections(
  Study study,
) => <(String, List<StudyRow>)>[
  (
    'Identidad',
    <StudyRow>[
      (label: 'Revista', value: study.journal, tabular: false),
      (
        label: 'Publicado',
        value: study.publishedAt == null
            ? null
            : sciStudyDate(study, long: true),
        tabular: false,
      ),
      (label: 'DOI', value: study.doi, tabular: true),
    ],
  ),
  (
    'Diseño',
    <StudyRow>[
      (label: 'Tipo', value: study.design, tabular: false),
      (label: 'Población', value: study.population, tabular: false),
      (
        label: 'Muestra',
        value: study.sampleSize == null ? null : sampleLabel(study.sampleSize),
        tabular: false,
      ),
      (label: 'Seguimiento', value: study.followUp, tabular: false),
    ],
  ),
  (
    'Transparencia',
    <StudyRow>[
      (label: 'Financiamiento', value: study.funding, tabular: false),
      (label: 'Conflictos de interés', value: study.conflicts, tabular: false),
      (label: 'Acceso', value: study.access, tabular: false),
    ],
  ),
  (
    'Estado',
    <StudyRow>[
      (
        label: 'Revisión por pares',
        value: switch (study.review) {
          StudyReview.peerReviewed => 'Sí',
          StudyReview.preprint => 'No (preprint)',
          StudyReview.notReported => null,
        },
        tabular: false,
      ),
      (label: 'Correcciones', value: study.corrections, tabular: false),
      // Same style as every row: a retraction is a fact, not an alarm.
      (
        label: 'Retractación',
        value: study.retracted
            ? (study.retractedAt == null
                  ? 'Sí'
                  : 'Sí, ${sciLongDate(study.retractedAt!)}')
            : 'No',
        tabular: false,
      ),
    ],
  ),
];

/// C4 · the full study label, in the style of a nutrition label.
class StudyLabel extends StatelessWidget {
  const StudyLabel({required this.study, super.key});

  final Study study;

  Widget _rule(double height, {double top = 0}) => Padding(
    padding: EdgeInsets.only(top: top),
    child: SizedBox(
      height: height,
      child: const ColoredBox(color: SciColors.ink),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final List<(String, List<StudyRow>)> sections = studyLabelSections(study);
    final List<String> byline = <String>[?study.authors, ?study.institution];
    return DecoratedBox(
      key: const Key('sci-study-label'),
      decoration: BoxDecoration(
        color: SciColors.surface,
        borderRadius: BorderRadius.circular(SciRadius.studyLabel),
        border: Border.all(color: SciColors.ink, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Semantics(
              header: true,
              child: Text(
                study.title,
                style: const TextStyle(
                  fontFamily: SciText.serif,
                  fontSize: 18,
                  height: 25 / 18,
                  fontWeight: FontWeight.w700,
                  color: SciColors.ink,
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(top: 4, bottom: 8),
              child: Text(
                byline.isEmpty ? notInformed : byline.join(' · '),
                style: SciText.label,
              ),
            ),
            _rule(6),
            for (int s = 0; s < sections.length; s++) ...<Widget>[
              Padding(
                padding: const EdgeInsets.only(top: 8, bottom: 2),
                child: Semantics(
                  header: true,
                  child: Text(
                    sections[s].$1.toUpperCase(),
                    style: const TextStyle(
                      fontFamily: SciText.sans,
                      fontSize: 11,
                      height: 14 / 11,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.8,
                      color: SciColors.ink,
                    ),
                  ),
                ),
              ),
              for (int r = 0; r < sections[s].$2.length; r++)
                _LabelRow(row: sections[s].$2[r], first: r == 0),
              if (s < sections.length - 1) _rule(4, top: 4),
            ],
          ],
        ),
      ),
    );
  }
}

class _LabelRow extends StatelessWidget {
  const _LabelRow({required this.row, required this.first});

  final StudyRow row;
  final bool first;

  @override
  Widget build(BuildContext context) {
    final bool missing = row.value == null || row.value!.trim().isEmpty;
    return Semantics(
      label: '${row.label}: ${_valueOr(row.value)}',
      excludeSemantics: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          border: Border(
            top: BorderSide(
              color: first ? SciColors.ink : SciColors.borderControl,
            ),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 5),
          child: SizedBox(
            width: double.infinity,
            child: Wrap(
              alignment: WrapAlignment.spaceBetween,
              spacing: 12,
              children: <Widget>[
                Text(
                  row.label,
                  style: const TextStyle(
                    fontFamily: SciText.sans,
                    fontSize: 13,
                    height: 18 / 13,
                    color: SciColors.ink,
                  ),
                ),
                Text(
                  _valueOr(row.value),
                  textAlign: TextAlign.right,
                  style: TextStyle(
                    fontFamily: SciText.sans,
                    fontSize: 13,
                    height: 18 / 13,
                    fontWeight: missing ? FontWeight.w400 : FontWeight.w600,
                    color: missing ? SciColors.inkSecondary : SciColors.ink,
                    fontFeatures: row.tabular
                        ? const <FontFeature>[FontFeature.tabularFigures()]
                        : null,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The compact label attached to a study comment. The whole card opens C4.
class StudyAttachment extends StatelessWidget {
  const StudyAttachment({required this.data, required this.onOpen, super.key});

  final StudyAttachmentData data;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final Study study = data.study;
    final bool oneColumn = MediaQuery.textScalerOf(context).scale(10) >= 15;
    final List<(String, String?)> cells = <(String, String?)>[
      ('Diseño', study.design),
      (
        'Muestra',
        study.sampleSize == null ? null : sampleLabel(study.sampleSize),
      ),
      ('Población', study.population),
      (
        'Revisión',
        switch (study.review) {
          StudyReview.peerReviewed => 'Por pares',
          StudyReview.preprint => 'Preprint',
          StudyReview.notReported => null,
        },
      ),
    ];
    Widget cell((String, String?) item, {required bool underline}) {
      final bool missing = item.$2 == null;
      return DecoratedBox(
        decoration: BoxDecoration(
          border: underline
              ? const Border(bottom: BorderSide(color: SciColors.borderControl))
              : null,
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          // The value moves under its label instead of breaking a word.
          child: SizedBox(
            width: double.infinity,
            child: Wrap(
              alignment: WrapAlignment.spaceBetween,
              spacing: 6,
              children: <Widget>[
                Text(
                  item.$1,
                  style: const TextStyle(
                    fontFamily: SciText.sans,
                    fontSize: 12,
                    height: 16 / 12,
                    color: SciColors.ink,
                  ),
                ),
                Text(
                  item.$2 ?? notInformed,
                  textAlign: TextAlign.right,
                  style: TextStyle(
                    fontFamily: SciText.sans,
                    fontSize: 12,
                    height: 16 / 12,
                    fontWeight: missing ? FontWeight.w400 : FontWeight.w700,
                    color: missing ? SciColors.inkSecondary : SciColors.ink,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Semantics(
      button: true,
      label:
          'Estudio adjunto: ${study.title}, '
          '${study.design ?? notInformed}, ${study.reviewLabel.toLowerCase()}. '
          'Ver etiqueta completa',
      excludeSemantics: true,
      child: Material(
        color: SciColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(SciRadius.studyLabel),
          side: const BorderSide(color: SciColors.ink, width: 1.5),
        ),
        child: InkWell(
          key: ValueKey<String>('sci-attachment-${study.doi}'),
          onTap: onOpen,
          borderRadius: BorderRadius.circular(SciRadius.studyLabel),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Text(
                  study.title,
                  style: const TextStyle(
                    fontFamily: SciText.serif,
                    fontSize: 14,
                    height: 20 / 14,
                    fontWeight: FontWeight.w700,
                    color: SciColors.ink,
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(top: 2, bottom: 6),
                  child: Text(
                    '${study.journal ?? notInformed}'
                    '${study.publishedAt == null ? '' : ' · ${study.publishedAt!.year}'}',
                    style: SciText.label,
                  ),
                ),
                const SizedBox(
                  height: 4,
                  child: ColoredBox(color: SciColors.ink),
                ),
                if (oneColumn)
                  for (int i = 0; i < cells.length; i++)
                    cell(cells[i], underline: i < cells.length - 1)
                else
                  for (int row = 0; row < 2; row++)
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Expanded(
                          child: cell(cells[row * 2], underline: row == 0),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: cell(cells[row * 2 + 1], underline: row == 0),
                        ),
                      ],
                    ),
                const Padding(
                  padding: EdgeInsets.only(top: 2, bottom: 8),
                  child: SizedBox(
                    height: 2,
                    child: ColoredBox(color: SciColors.ink),
                  ),
                ),
                Text(
                  '“${data.abstractFragment}”',
                  locale: study.abstractLanguage == null
                      ? null
                      : Locale(study.abstractLanguage!),
                  style: const TextStyle(
                    fontFamily: SciText.serif,
                    fontSize: 13,
                    height: 19 / 13,
                    color: SciColors.ink,
                  ),
                ),
                const SizedBox(height: 8),
                // A full 44 pt row, so the link alone is a comfortable target.
                ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: 44),
                  child: const Row(
                    children: <Widget>[
                      Flexible(
                        child: Text(
                          'Ver etiqueta completa',
                          style: TextStyle(
                            fontFamily: SciText.sans,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: SciColors.primaryText,
                          ),
                        ),
                      ),
                      SizedBox(width: 2),
                      Icon(
                        SciIcons.chevronRight,
                        size: 16,
                        color: SciColors.primaryText,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// C4 screen: the label, the note and the two actions.
class StudyLabelScreen extends StatelessWidget {
  const StudyLabelScreen({required this.store, required this.study, super.key});

  final ArenaStore store;
  final Study study;

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: SciColors.bgApp,
    appBar: AppBar(
      backgroundColor: SciColors.bgApp,
      surfaceTintColor: Colors.transparent,
      foregroundColor: SciColors.ink,
      titleSpacing: 0,
      title: const Text(
        'Etiqueta del estudio',
        style: TextStyle(
          fontFamily: SciText.sans,
          fontSize: 17,
          fontWeight: FontWeight.w600,
          color: SciColors.ink,
        ),
      ),
    ),
    body: ListView(
      key: const Key('sci-label-scroll'),
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
      children: <Widget>[
        StudyLabel(study: study),
        const SizedBox(height: 12),
        const Text(
          'Datos tomados del propio artículo y de la revista. Dialektik no '
          'califica estudios ni revistas.',
          style: TextStyle(
            fontFamily: SciText.sans,
            fontSize: 12,
            height: 17 / 12,
            color: SciColors.inkSecondary,
          ),
        ),
        const SizedBox(height: 12),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
              child: _LabelButton(
                key: const Key('sci-label-original'),
                label: 'Artículo original',
                icon: SciIcons.external,
                primary: true,
                semanticsLabel: 'Artículo original, se abre fuera de la app',
                onPressed: () => unawaited(store.openLink(study.doiUrl)),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _LabelButton(
                key: const Key('sci-label-comments'),
                label: 'Comentarios que lo citan · ${study.citingComments}',
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) =>
                        CitingCommentsScreen(store: store, study: study),
                  ),
                ),
              ),
            ),
          ],
        ),
      ],
    ),
  );
}

class _LabelButton extends StatelessWidget {
  const _LabelButton({
    required this.label,
    required this.onPressed,
    this.icon,
    this.primary = false,
    this.semanticsLabel,
    super.key,
  });

  final String label;
  final VoidCallback onPressed;
  final IconData? icon;
  final bool primary;
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: semanticsLabel ?? label,
    excludeSemantics: true,
    child: OutlinedButton(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(44, 48),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
        backgroundColor: SciColors.surface,
        foregroundColor: primary ? SciColors.primaryText : SciColors.ink,
        side: BorderSide(
          color: primary ? SciColors.primary : SciColors.borderControl,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(SciRadius.fullButton),
        ),
        textStyle: const TextStyle(
          fontFamily: SciText.sans,
          fontSize: 14,
          fontWeight: FontWeight.w600,
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Flexible(child: Text(label, textAlign: TextAlign.center)),
          if (icon != null) ...<Widget>[
            const SizedBox(width: 6),
            Icon(icon, size: 18),
          ],
        ],
      ),
    ),
  );
}

/// Comments that cite one study, across stories. Requires API.
class CitingCommentsScreen extends StatelessWidget {
  const CitingCommentsScreen({
    required this.store,
    required this.study,
    super.key,
  });

  final ArenaStore store;
  final Study study;

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: SciColors.surface,
    appBar: AppBar(
      backgroundColor: SciColors.surface,
      surfaceTintColor: Colors.transparent,
      foregroundColor: SciColors.ink,
      titleSpacing: 0,
      title: const Text(
        'Comentarios que lo citan',
        style: TextStyle(
          fontFamily: SciText.sans,
          fontSize: 17,
          fontWeight: FontWeight.w600,
        ),
      ),
    ),
    body: FutureBuilder<List<StoryComment>>(
      future: store.science?.commentsCitingStudy(study.doi),
      builder: (BuildContext context, AsyncSnapshot<List<StoryComment>> s) {
        if (s.connectionState != ConnectionState.done) {
          return const Center(
            child: CircularProgressIndicator(color: SciColors.primary),
          );
        }
        final List<StoryComment> comments = s.data ?? const <StoryComment>[];
        if (s.hasError || store.science == null) {
          return const Padding(
            padding: EdgeInsets.all(20),
            child: Text(
              'No pudimos cargar los comentarios',
              style: SciText.body,
            ),
          );
        }
        if (comments.isEmpty) {
          return const Padding(
            padding: EdgeInsets.all(20),
            child: Text(
              'Ningún comentario cita este estudio todavía',
              style: SciText.body,
            ),
          );
        }
        return ListView.separated(
          itemCount: comments.length,
          separatorBuilder: (_, _) =>
              const Divider(height: 1, color: SciColors.divider),
          itemBuilder: (BuildContext context, int i) => ListTile(
            minTileHeight: 56,
            leading: Monogram(comments[i].author, size: 28),
            title: Text('@${comments[i].author}', style: SciText.meta),
            subtitle: Text(comments[i].body, style: SciText.body),
          ),
        );
      },
    ),
  );
}
