import 'dart:async';

import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/science/data/science_models.dart';
import 'package:dialektik/features/science/data/science_repository.dart';
import 'package:dialektik/features/science/presentation/science_format.dart';
import 'package:dialektik/features/science/presentation/science_widgets.dart';
import 'package:dialektik/features/science/presentation/study_comment_sheet.dart';
import 'package:dialektik/features/science/presentation/study_label_screen.dart';
import 'package:flutter/material.dart';

/// C1 · Science feed: studies with a DOI and the stories they are linked to.
class ScienceFeed extends StatefulWidget {
  const ScienceFeed({required this.store, super.key});

  final ArenaStore store;

  @override
  State<ScienceFeed> createState() => _ScienceFeedState();
}

class _ScienceFeedState extends State<ScienceFeed> {
  StudyFilter _filter = StudyFilter.connected;
  List<Study>? _studies;
  bool _failed = false;
  int _run = 0;

  ScienceRepository? get _repository => widget.store.science;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final int run = ++_run;
    setState(() {
      _studies = null;
      _failed = false;
    });
    final ScienceRepository? repository = _repository;
    if (repository == null) {
      setState(() => _failed = true);
      return;
    }
    try {
      final List<Study> studies = await repository.listStudies(_filter);
      if (mounted && run == _run) setState(() => _studies = studies);
    } on Object {
      if (mounted && run == _run) setState(() => _failed = true);
    }
  }

  void _choose(StudyFilter filter) {
    if (filter == _filter) return;
    setState(() => _filter = filter);
    unawaited(_load());
  }

  @override
  Widget build(BuildContext context) => ColoredBox(
    color: SciColors.bgApp,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        SingleChildScrollView(
          key: const Key('sci-filters'),
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(20, 6, 20, 12),
          child: Row(
            children: <Widget>[
              for (final StudyFilter filter in StudyFilter.values) ...<Widget>[
                if (filter != StudyFilter.values.first)
                  const SizedBox(width: 8),
                SelectChip(
                  key: ValueKey<String>('sci-filter-${filter.wire}'),
                  label: filter.label,
                  selected: filter == _filter,
                  onTap: () => _choose(filter),
                ),
              ],
            ],
          ),
        ),
        Expanded(child: _body(context)),
      ],
    ),
  );

  Widget _body(BuildContext context) {
    if (_failed) {
      return _StateMessage(
        key: const Key('sci-feed-error'),
        text: 'No pudimos cargar los estudios',
        action: 'Reintentar',
        onAction: () => unawaited(_load()),
      );
    }
    final List<Study>? studies = _studies;
    if (studies == null) {
      return ListView(
        key: const Key('sci-feed-loading'),
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        children: const <Widget>[
          _SkeletonCard(),
          SizedBox(height: 12),
          _SkeletonCard(),
          SizedBox(height: 12),
          _SkeletonCard(),
        ],
      );
    }
    if (studies.isEmpty) {
      return _StateMessage(
        key: const Key('sci-feed-empty'),
        text: 'Aún no hay estudios con este filtro',
        action: 'Ver recientes',
        onAction: () => _choose(StudyFilter.recent),
      );
    }
    return RefreshIndicator(
      color: SciColors.primary,
      onRefresh: _load,
      child: ListView.separated(
        key: const Key('sci-feed'),
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        itemCount: studies.length,
        separatorBuilder: (_, _) => const SizedBox(height: 12),
        itemBuilder: (BuildContext context, int i) => StudyCard(
          study: studies[i],
          onOpen: () => openStudyLabel(context, widget.store, studies[i]),
          onConnect: () => unawaited(
            showStudyCommentSheet(context, widget.store, study: studies[i]),
          ),
        ),
      ),
    );
  }
}

/// One study of the feed: tags, title, origin, stories and two actions.
class StudyCard extends StatelessWidget {
  const StudyCard({
    required this.study,
    required this.onOpen,
    required this.onConnect,
    super.key,
  });

  final Study study;
  final VoidCallback onOpen;
  final VoidCallback onConnect;

  @override
  Widget build(BuildContext context) {
    final List<String> origin = <String>[
      ?study.institution,
      ?study.journal,
      if (study.publishedAt != null) sciStudyDate(study),
    ];
    final String meta =
        '${origin.isEmpty ? notInformed : origin.join(' · ')}'
        '${study.connectedStories == 0 ? ' · aún sin conectar' : ''}';
    return DecoratedBox(
      key: ValueKey<String>('sci-study-${study.doi}'),
      decoration: BoxDecoration(
        color: SciColors.surface,
        borderRadius: BorderRadius.circular(SciRadius.card),
        border: Border.all(color: SciColors.borderCard),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            StudyTags(studyTagLabels(study)),
            const SizedBox(height: 10),
            Semantics(
              header: true,
              child: Text(study.title, style: SciText.cardTitle),
            ),
            const SizedBox(height: 10),
            Text(meta, style: SciText.meta),
            if (study.connectedStories > 0) ...<Widget>[
              const SizedBox(height: 10),
              Row(
                children: <Widget>[
                  const Icon(SciIcons.link, size: 16, color: SciColors.ink),
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(
                      connectedStoriesLabel(study.connectedStories),
                      style: const TextStyle(
                        fontFamily: SciText.sans,
                        fontSize: 13,
                        height: 18 / 13,
                        fontWeight: FontWeight.w600,
                        color: SciColors.ink,
                      ),
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 10),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: SciRowButton(
                    key: const Key('sci-study-open'),
                    label: 'Ver ficha',
                    onPressed: onOpen,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: SciRowButton(
                    key: const Key('sci-study-connect'),
                    label: 'Conectar a noticia',
                    primary: true,
                    onPressed: study.retracted ? null : onConnect,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Outlined button that shares a row: 44 tall, radius 12, 14 w600.
class SciRowButton extends StatelessWidget {
  const SciRowButton({
    required this.label,
    required this.onPressed,
    this.primary = false,
    this.height = 44,
    this.radius = SciRadius.rowButton,
    this.trailing,
    super.key,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool primary;
  final double height;
  final double radius;
  final IconData? trailing;

  @override
  Widget build(BuildContext context) => OutlinedButton(
    onPressed: onPressed,
    style: OutlinedButton.styleFrom(
      minimumSize: Size(44, height),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      backgroundColor: SciColors.surface,
      foregroundColor: primary ? SciColors.primaryText : SciColors.ink,
      side: BorderSide(
        color: primary ? SciColors.primary : SciColors.borderControl,
      ),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radius),
      ),
      textStyle: const TextStyle(
        fontFamily: SciText.sans,
        fontSize: 14,
        fontWeight: FontWeight.w600,
      ),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Flexible(child: Text(label, textAlign: TextAlign.center)),
        if (trailing != null) ...<Widget>[
          const SizedBox(width: 6),
          Icon(trailing, size: 16),
        ],
      ],
    ),
  );
}

class _StateMessage extends StatelessWidget {
  const _StateMessage({
    required this.text,
    required this.action,
    required this.onAction,
    super.key,
  });

  final String text;
  final String action;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(20, 24, 20, 24),
    children: <Widget>[
      Text(text, textAlign: TextAlign.center, style: SciText.body),
      const SizedBox(height: 12),
      Center(
        child: SciRowButton(label: action, onPressed: onAction),
      ),
    ],
  );
}

/// Grey blocks with a soft shimmer; still when motion is reduced.
class _SkeletonCard extends StatefulWidget {
  const _SkeletonCard();

  @override
  State<_SkeletonCard> createState() => _SkeletonCardState();
}

class _SkeletonCardState extends State<_SkeletonCard>
    with SingleTickerProviderStateMixin {
  late final AnimationController _shimmer = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _shimmer.stop();
    } else if (!_shimmer.isAnimating) {
      unawaited(_shimmer.repeat());
    }
  }

  @override
  void dispose() {
    _shimmer.dispose();
    super.dispose();
  }

  Widget _block(double width, double height) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: FractionallySizedBox(
      widthFactor: width,
      alignment: Alignment.centerLeft,
      child: Container(
        height: height,
        decoration: BoxDecoration(
          color: SciColors.divider,
          borderRadius: BorderRadius.circular(6),
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'Cargando estudios',
    child: ExcludeSemantics(
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: SciColors.surface,
          borderRadius: BorderRadius.circular(SciRadius.card),
          border: Border.all(color: SciColors.borderCard),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: AnimatedBuilder(
            animation: _shimmer,
            builder: (BuildContext context, Widget? child) => ShaderMask(
              blendMode: BlendMode.srcATop,
              shaderCallback: (Rect bounds) => LinearGradient(
                begin: Alignment(-1 + 3 * _shimmer.value - 1, 0),
                end: Alignment(3 * _shimmer.value - 1, 0),
                colors: const <Color>[
                  SciColors.divider,
                  Color(0xFFF9FAFB),
                  SciColors.divider,
                ],
              ).createShader(bounds),
              child: child,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                _block(0.5, 22),
                _block(0.9, 18),
                _block(0.7, 18),
                _block(0.6, 14),
                Row(
                  children: <Widget>[
                    Expanded(child: _block(1, 44)),
                    const SizedBox(width: 8),
                    Expanded(child: _block(1, 44)),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}
