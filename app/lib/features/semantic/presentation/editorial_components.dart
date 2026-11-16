import 'dart:async';
import 'dart:math' as math;

import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/semantic/data/semantic_models.dart';
import 'package:dialektik/features/semantic/presentation/editorial_vocabulary.dart';
import 'package:flutter/foundation.dart' show listEquals;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

// dialektik:epistemic-component

/// Shared reader rhythm, derived from the existing Dialektik scale.
abstract final class EditorialLayout {
  static const SystemUiOverlayStyle systemUiOverlayStyle = SystemUiOverlayStyle(
    statusBarColor: DialektikColors.nocturne,
    statusBarIconBrightness: Brightness.light,
    statusBarBrightness: Brightness.dark,
    systemNavigationBarColor: DialektikColors.offWhite,
    systemNavigationBarIconBrightness: Brightness.dark,
  );
  static const double contentMaxWidth = 960;
  static const double readerMaxWidth = DialektikSizing.maxReadingWidth;
  static const double pageInset = DialektikSpacing.space8;
  static const double pageTop = DialektikSpacing.space6 * 2;
  static const double sectionGap = DialektikSpacing.space6 * 2;
  static const double cardPadding = DialektikSpacing.space6;
  static const double cardGap = DialektikSpacing.space4;
  static const double detailGap = DialektikSpacing.space3;
  static const int timelineBatchSize = 8;
  static const int coverageBatchSize = 10;
  static const int sourcePreviewCount = 6;
  static const int historyBatchSize = 10;
  static const double storyMetadataWidth = 200;
  static const double publisherRailWidth = 224;
  static const double storyWideMinimum = 700;
  static const double detailWideMinimum = 850;
  static const double maxTwoColumnTextSize = 20;
  static const double sourceHeaderInlineMinimum =
      DialektikSizing.wideBreakpoint / 2;
  static const double timelineSpineInset = DialektikSpacing.space8;
  static const double timelineContentInset = DialektikSpacing.space8 * 2;
  static const double timelineNodeRadius = DialektikSpacing.space3;
  static const double timelineStrokeWidth = DialektikBorders.anchorWidth;
  static const double timelineNodeGap = DialektikSpacing.space6;
  static const double navigationInlineMinimum =
      DialektikSizing.wideBreakpoint - DialektikSpacing.space6 * 2;
}

ThemeData _editorialTheme({bool navigation = false}) {
  final ThemeData base = navigation
      ? DialektikTheme.nocturne(loadInterFromDependency: false)
      : DialektikTheme.offWhite(loadInterFromDependency: false);
  return base.copyWith(
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        minimumSize: const Size(
          DialektikSizing.touchPreferred,
          DialektikSizing.touchPreferred,
        ),
        textStyle: base.textTheme.bodyMedium,
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        minimumSize: const Size(
          DialektikSizing.touchPreferred,
          DialektikSizing.touchPreferred,
        ),
      ),
    ),
  );
}

/// The fixture reader's navigation and disclosure live in one shared place.
/// Content remains on Off White; Nocturne carries only navigation and identity.
final class EditorialScaffold extends StatelessWidget {
  const EditorialScaffold({
    required this.title,
    required this.child,
    this.isRoot = false,
    this.eyebrow,
    this.actions,
    this.location,
    this.scrollKey,
    this.fixtureProfile,
    this.dataIndicator,
    this.stackDataIndicatorOnNarrow = false,
    this.homeRoute = '/threads',
    this.homeLabel = 'Historias',
    super.key,
  });

  final String title;
  final Widget child;
  final bool isRoot;
  final String? eyebrow;
  final List<Widget>? actions;
  final String? location;
  final Key? scrollKey;
  final EditorialFixtureProfile? fixtureProfile;
  final Widget? dataIndicator;
  final bool stackDataIndicatorOnNarrow;
  final String homeRoute;
  final String homeLabel;

  @override
  Widget build(BuildContext context) => Theme(
    data: _editorialTheme(),
    child: Builder(
      builder: (BuildContext context) => AnnotatedRegion<SystemUiOverlayStyle>(
        value: EditorialLayout.systemUiOverlayStyle,
        child: Scaffold(
          backgroundColor: context.surfaceColors.base,
          body: Column(
            children: <Widget>[
              Theme(
                data: _editorialTheme(navigation: true),
                child: _EditorialNavigation(
                  isRoot: isRoot,
                  actions: actions,
                  location: location ?? (isRoot ? homeLabel : null),
                  indicator:
                      dataIndicator ??
                      EditorialFixtureIndicator(
                        profile:
                            fixtureProfile ?? editorialConfiguredFixtureProfile,
                      ),
                  homeRoute: homeRoute,
                  stackIndicatorWhenNarrow: dataIndicator != null,
                  stackDataIndicatorOnNarrow: stackDataIndicatorOnNarrow,
                  homeLabel: homeLabel,
                ),
              ),
              Expanded(
                child: SafeArea(
                  top: false,
                  child: Scrollbar(
                    child: SingleChildScrollView(
                      key: scrollKey,
                      child: Center(
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(
                            maxWidth: EditorialLayout.contentMaxWidth,
                          ),
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(
                              EditorialLayout.pageInset,
                              EditorialLayout.pageTop,
                              EditorialLayout.pageInset,
                              EditorialLayout.sectionGap,
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                if (eyebrow != null) ...<Widget>[
                                  Text(
                                    eyebrow!,
                                    style: Theme.of(context)
                                        .textTheme
                                        .bodyMedium
                                        ?.copyWith(
                                          color: context.surfaceColors.muted,
                                        ),
                                  ),
                                  const SizedBox(
                                    height: DialektikSpacing.space3,
                                  ),
                                ],
                                Semantics(
                                  header: true,
                                  child: Text(
                                    title,
                                    style: Theme.of(
                                      context,
                                    ).textTheme.displaySmall,
                                  ),
                                ),
                                const SizedBox(height: DialektikSpacing.space8),
                                child,
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

final class _EditorialNavigation extends StatelessWidget {
  const _EditorialNavigation({
    required this.isRoot,
    required this.actions,
    required this.location,
    required this.indicator,
    required this.stackIndicatorWhenNarrow,
    required this.stackDataIndicatorOnNarrow,
    required this.homeRoute,
    required this.homeLabel,
  });

  final bool isRoot;
  final List<Widget>? actions;
  final String? location;
  final Widget indicator;
  final bool stackIndicatorWhenNarrow;
  final bool stackDataIndicatorOnNarrow;
  final String homeRoute;
  final String homeLabel;

  Widget _locationLabel(BuildContext context) => location == null
      ? const SizedBox()
      : Semantics(
          label: 'Ubicación actual: $location',
          excludeSemantics: true,
          child: Text(
            location!,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: context.surfaceColors.muted,
            ),
          ),
        );

  void _openRoot(BuildContext context) {
    unawaited(
      Navigator.of(context).pushNamedAndRemoveUntil(
        homeRoute,
        (Route<dynamic> route) => route.isFirst,
      ),
    );
  }

  @override
  Widget build(BuildContext context) => ColoredBox(
    color: context.surfaceColors.base,
    child: SafeArea(
      bottom: false,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: EditorialLayout.contentMaxWidth,
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: DialektikSpacing.space6,
              vertical: DialektikSpacing.space3,
            ),
            child: LayoutBuilder(
              builder: (BuildContext context, BoxConstraints constraints) {
                final bool inlineActions =
                    constraints.maxWidth >=
                        EditorialLayout.navigationInlineMinimum &&
                    MediaQuery.textScalerOf(
                          context,
                        ).scale(DialektikTypography.publicBodyMinimum) <=
                        DialektikTypography.publicBodyMinimum;
                final bool hasActions = actions != null && actions!.isNotEmpty;
                final bool inlineIndicator =
                    constraints.maxWidth >=
                        EditorialLayout.navigationInlineMinimum ||
                    (!stackDataIndicatorOnNarrow &&
                        MediaQuery.textScalerOf(
                              context,
                            ).scale(DialektikTypography.publicBodyMinimum) <=
                            EditorialLayout.maxTwoColumnTextSize);
                final Widget actionList = Wrap(
                  spacing: DialektikSpacing.space3,
                  runSpacing: DialektikSpacing.space3,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: actions ?? const <Widget>[],
                );
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        if (!isRoot) ...<Widget>[
                          Tooltip(
                            message: 'Volver',
                            excludeFromSemantics: true,
                            child: _EditorialTarget(
                              semanticLabel: 'Volver',
                              onTap: () {
                                if (Navigator.of(context).canPop()) {
                                  unawaited(Navigator.of(context).maybePop());
                                } else {
                                  _openRoot(context);
                                }
                              },
                              child: const DialektikIcon(
                                icon: DialektikFunctionalIcon.back,
                              ),
                            ),
                          ),
                          const SizedBox(width: DialektikSpacing.space3),
                        ],
                        Expanded(
                          child: Align(
                            alignment: Alignment.centerLeft,
                            child: isRoot
                                ? Padding(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: DialektikSpacing.space3,
                                      vertical: DialektikSpacing.space4,
                                    ),
                                    child: Text(
                                      'dialektik',
                                      style: Theme.of(
                                        context,
                                      ).textTheme.titleLarge,
                                    ),
                                  )
                                : _EditorialTarget(
                                    semanticLabel:
                                        'dialektik · Ir a $homeLabel',
                                    onTap: () => _openRoot(context),
                                    child: Text(
                                      'dialektik',
                                      style: Theme.of(
                                        context,
                                      ).textTheme.titleLarge,
                                    ),
                                  ),
                          ),
                        ),
                        if (inlineActions && hasActions) ...<Widget>[
                          Flexible(child: actionList),
                          const SizedBox(width: DialektikSpacing.space6),
                        ],
                        if (inlineIndicator) ...<Widget>[
                          const SizedBox(width: DialektikSpacing.space3),
                          indicator,
                        ],
                      ],
                    ),
                    if (location != null || !inlineIndicator)
                      Padding(
                        padding: const EdgeInsets.only(
                          left: DialektikSpacing.space3,
                          top: DialektikSpacing.space2,
                        ),
                        child: stackIndicatorWhenNarrow && !inlineIndicator
                            ? Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: <Widget>[
                                  _locationLabel(context),
                                  const SizedBox(
                                    height: DialektikSpacing.space3,
                                  ),
                                  indicator,
                                ],
                              )
                            : Row(
                                children: <Widget>[
                                  Expanded(child: _locationLabel(context)),
                                  if (!inlineIndicator) indicator,
                                ],
                              ),
                      ),

                    if (!inlineActions && hasActions)
                      Padding(
                        padding: const EdgeInsets.only(
                          top: DialektikSpacing.space3,
                        ),
                        child: actionList,
                      ),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    ),
  );
}

final class EditorialFixtureIndicator extends StatelessWidget {
  const EditorialFixtureIndicator({required this.profile, super.key});

  final EditorialFixtureProfile profile;

  String get _label =>
      profile == EditorialFixtureProfile.stress ? 'STRESS' : 'DEMO';
  String get _disclosure => profile == EditorialFixtureProfile.stress
      ? 'Este perfil de prueba usa historias, eventos, noticias y fuentes '
            'ficticias. Los datos son estáticos y deterministas, preparados para '
            'explorar la experiencia a gran escala. No son noticias en vivo.'
      : 'Esta demostración usa historias, eventos, noticias y fuentes ficticias. '
            'Los datos son estáticos y fueron preparados para explorar la experiencia. '
            'No son noticias en vivo.';

  @override
  Widget build(BuildContext context) => Tooltip(
    message: 'Datos ficticios y estáticos · $_label',
    excludeFromSemantics: true,
    child: _EditorialTarget(
      semanticLabel: '$_label · Información de los datos ficticios',
      onTap: () {
        unawaited(
          showDialog<void>(
            context: context,
            builder: (BuildContext context) => Theme(
              data: _editorialTheme(),
              child: AlertDialog(
                elevation: 0,
                shape: const RoundedRectangleBorder(
                  borderRadius: DialektikRadii.mediumBorderRadius,
                ),
                title: Text(
                  profile == EditorialFixtureProfile.stress
                      ? 'Un perfil de prueba de Dialektik'
                      : 'Una demostración de Dialektik',
                ),
                content: Text(_disclosure),
                actions: <Widget>[
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(),
                    style: TextButton.styleFrom(
                      minimumSize: const Size(
                        DialektikSizing.touchPreferred,
                        DialektikSizing.touchPreferred,
                      ),
                    ),
                    child: const Text('Entendido'),
                  ),
                ],
              ),
            ),
          ),
        );
      },
      child: Text(
        _label,
        style: Theme.of(
          context,
        ).textTheme.bodyMedium?.copyWith(color: context.surfaceColors.muted),
      ),
    ),
  );
}

final class SectionHeading extends StatelessWidget {
  const SectionHeading({
    required this.title,
    this.subtitle,
    this.trailing,
    super.key,
  });

  final String title;
  final String? subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(
      top: EditorialLayout.sectionGap,
      bottom: DialektikSpacing.space6,
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Wrap(
          spacing: DialektikSpacing.space6,
          runSpacing: DialektikSpacing.space3,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: <Widget>[
            Semantics(
              header: true,
              child: Text(
                title,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
            ),
            ?trailing,
          ],
        ),
        if (subtitle != null) ...<Widget>[
          const SizedBox(height: DialektikSpacing.space3),
          ConstrainedBox(
            constraints: const BoxConstraints(
              maxWidth: EditorialLayout.readerMaxWidth,
            ),
            child: Text(
              subtitle!,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: context.surfaceColors.muted,
              ),
            ),
          ),
        ],
      ],
    ),
  );
}

/// A publisher identity. Logos are optional caller-supplied legitimate assets;
/// absence and image errors both retain the same neutral initials fallback.
final class SourceIdentity extends StatelessWidget {
  const SourceIdentity({
    required this.name,
    this.logo,
    this.domain,
    this.publisherType,
    this.header = false,
    this.stacked = false,
    this.showName = true,
    super.key,
  });

  final String name;
  final ImageProvider<Object>? logo;
  final String? domain;
  final String? publisherType;
  final bool header;
  final bool stacked;
  final bool showName;

  static String _initials(String name) {
    final List<String> meaningful = name
        .trim()
        .split(RegExp(r'\s+'))
        .where(
          (String word) => !const <String>{
            'de',
            'del',
            'la',
            'el',
            'las',
            'los',
          }.contains(word.toLowerCase()),
        )
        .toList();
    if (meaningful.isEmpty || meaningful.first.isEmpty) {
      return 'F';
    }
    return meaningful
        .take(2)
        .map((String word) => word.characters.first)
        .join()
        .toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final Widget fallback = Text(
      _initials(name),
      style: Theme.of(context).textTheme.titleMedium,
    );
    final Widget badge = ExcludeSemantics(
      child: Container(
        constraints: const BoxConstraints(
          minWidth: DialektikSizing.touchPreferred,
          minHeight: DialektikSizing.touchPreferred,
        ),
        padding: const EdgeInsets.all(DialektikSpacing.space3),
        decoration: BoxDecoration(
          border: Border.all(
            color: context.epistemicColors.line,
            width: DialektikBorders.hairlineWidth,
          ),
          borderRadius: DialektikRadii.smallBorderRadius,
        ),
        alignment: Alignment.center,
        child: logo == null
            ? fallback
            : Image(
                image: logo!,
                width: DialektikSizing.iconLarge,
                height: DialektikSizing.iconLarge,
                fit: BoxFit.contain,
                errorBuilder: (_, _, _) => fallback,
              ),
      ),
    );
    final Widget text = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        if (showName)
          Semantics(
            container: header,
            header: header,
            child: Text(
              name,
              style:
                  (header
                          ? Theme.of(context).textTheme.headlineMedium
                          : Theme.of(context).textTheme.bodyMedium)
                      ?.copyWith(color: context.epistemicColors.ink),
            ),
          ),
        if (publisherType != null)
          Text(
            publisherType!,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: context.epistemicColors.muted,
            ),
          ),
        if (domain != null)
          Text(
            domain!,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: context.epistemicColors.muted,
            ),
          ),
      ],
    );
    if (stacked) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          IntrinsicWidth(child: badge),
          const SizedBox(height: DialektikSpacing.space4),
          SizedBox(width: double.infinity, child: text),
        ],
      );
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        badge,
        const SizedBox(width: DialektikSpacing.space4),
        Flexible(fit: FlexFit.loose, child: text),
      ],
    );
  }
}

final class SourceBadge extends StatelessWidget {
  const SourceBadge({
    required this.source,
    this.onPressed,
    this.compact = false,
    this.logo,
    this.publisherType,
    super.key,
  });

  final SemanticSourceDto source;
  final VoidCallback? onPressed;
  final bool compact;
  final ImageProvider<Object>? logo;
  final String? publisherType;

  @override
  Widget build(BuildContext context) {
    final String name = editorialSourceName(source.name);
    final Widget identity = SourceIdentity(
      name: name,
      logo: logo,
      publisherType: publisherType,
      domain: compact ? null : source.canonicalDomain,
    );
    if (onPressed == null) {
      return identity;
    }
    return _EditorialTarget(
      semanticLabel: 'Abrir fuente: $name',
      onTap: onPressed!,
      child: identity,
    );
  }
}

/// Source inventory with bounded initial work. Identity is deduplicated by ID,
/// while the repository's supplied ordering remains intact.
final class SourceCollection extends StatefulWidget {
  const SourceCollection({
    required this.sources,
    this.onOpenSource,
    this.initialLimit = EditorialLayout.sourcePreviewCount,
    this.label,
    super.key,
  }) : assert(initialLimit > 0);

  final List<SemanticSourceDto> sources;
  final ValueChanged<String>? onOpenSource;
  final int initialLimit;
  final String? label;

  @override
  State<SourceCollection> createState() => _SourceCollectionState();
}

final class _SourceCollectionState extends State<SourceCollection> {
  late int _visible = widget.initialLimit;

  @override
  void didUpdateWidget(covariant SourceCollection oldWidget) {
    super.didUpdateWidget(oldWidget);
    final Iterable<String> oldIds = oldWidget.sources.map(
      (source) => source.id,
    );
    final Iterable<String> newIds = widget.sources.map((source) => source.id);
    if (oldWidget.initialLimit != widget.initialLimit ||
        !listEquals(oldIds.toList(), newIds.toList())) {
      _visible = widget.initialLimit;
    }
  }

  @override
  Widget build(BuildContext context) {
    final Set<String> ids = <String>{};
    final List<SemanticSourceDto> sources = widget.sources
        .where((source) => ids.add(source.id))
        .toList(growable: false);
    final int shown = math.min(_visible, sources.length);
    final int remaining = sources.length - shown;
    final int next = math.min(remaining, widget.initialLimit);
    final String count = editorialCount(sources.length, 'fuente', 'fuentes');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Semantics(
          header: widget.label != null,
          child: Text(
            widget.label == null ? count : '${widget.label} · $count',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ),
        if (sources.isEmpty)
          Padding(
            padding: const EdgeInsets.only(top: EditorialLayout.detailGap),
            child: Text(
              'No hay fuentes disponibles.',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
        for (final SemanticSourceDto source in sources.take(shown))
          Padding(
            padding: const EdgeInsets.only(top: EditorialLayout.detailGap),
            child: SourceBadge(
              source: source,
              compact: true,
              onPressed: widget.onOpenSource == null
                  ? null
                  : () => widget.onOpenSource!(source.id),
            ),
          ),
        if (remaining > 0)
          EditorialTextButton(
            semanticLabel: 'Ver $next fuentes más · $remaining restantes',
            onPressed: () => setState(() => _visible += next),
            child: Text('Ver $next fuentes más ($remaining restantes)'),
          ),
        if (shown > widget.initialLimit)
          EditorialTextButton(
            onPressed: () => setState(() => _visible = widget.initialLimit),
            child: const Text('Mostrar menos fuentes'),
          ),
      ],
    );
  }
}

final class SemanticStatusLabel extends StatelessWidget {
  const SemanticStatusLabel({
    required this.state,
    this.showApplicability = false,
    super.key,
  });

  final SemanticStateValueDto state;
  final bool showApplicability;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: <Widget>[
      Text(
        state.description,
        style: Theme.of(
          context,
        ).textTheme.bodyMedium?.copyWith(color: context.epistemicColors.ink),
      ),
      if (showApplicability) ...<Widget>[
        const SizedBox(height: DialektikSpacing.space3),
        Text(
          '${editorialDecisionLabel(state.decision)} · '
          '${editorialApplicabilityLabel(state.applicability)}',
          style: Theme.of(
            context,
          ).textTheme.bodyMedium?.copyWith(color: context.epistemicColors.ink),
        ),
      ] else if (state.applicability !=
          SemanticApplicability.applicable) ...<Widget>[
        const SizedBox(height: DialektikSpacing.space3),
        Text(
          editorialApplicabilityLabel(state.applicability),
          style: Theme.of(
            context,
          ).textTheme.bodyMedium?.copyWith(color: context.epistemicColors.ink),
        ),
      ],
    ],
  );
}

String editorialDecisionLabel(SemanticDecision value) => switch (value) {
  SemanticDecision.match => 'Vinculado',
  SemanticDecision.distinct => 'Eventos distintos',
  SemanticDecision.unknown =>
    'Relación sin resolver · información insuficiente',
};

String editorialApplicabilityLabel(SemanticApplicability value) =>
    switch (value) {
      SemanticApplicability.applicable => 'Comparación disponible',
      SemanticApplicability.inapplicable => 'No comparable',
      SemanticApplicability.unknown => 'Comparabilidad sin resolver',
    };

final class UnknownRelationshipCard extends StatelessWidget {
  const UnknownRelationshipCard({this.description, super.key});

  final String? description;

  @override
  Widget build(BuildContext context) => CustomPaint(
    painter: _UnresolvedBorder(color: context.epistemicColors.line),
    child: Padding(
      padding: const EdgeInsets.all(EditorialLayout.cardPadding),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            'Relación sin resolver',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
              color: context.epistemicColors.ink,
            ),
          ),
          const SizedBox(height: DialektikSpacing.space3),
          Text(
            description ??
                'La información disponible no permite establecer esta relación. '
                    'Puedes consultar las noticias y su procedencia.',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: context.epistemicColors.ink,
            ),
          ),
        ],
      ),
    ),
  );
}

final class _UnresolvedBorder extends CustomPainter {
  const _UnresolvedBorder({required this.color});

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final Paint paint = Paint()
      ..color = color
      ..strokeWidth = DialektikBorders.hairlineWidth
      ..style = PaintingStyle.stroke;
    final Path outline = Path()
      ..addRRect(
        RRect.fromRectAndRadius(
          (Offset.zero & size).deflate(DialektikBorders.hairlineWidth),
          const Radius.circular(DialektikRadii.medium),
        ),
      );
    for (final metric in outline.computeMetrics()) {
      double offset = 0;
      while (offset < metric.length) {
        canvas.drawPath(
          metric.extractPath(
            offset,
            math.min(offset + DialektikSpacing.space3, metric.length),
          ),
          paint,
        );
        offset += DialektikSpacing.space3 + DialektikSpacing.space2;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _UnresolvedBorder oldDelegate) =>
      color != oldDelegate.color;
}

/// One full-card target. Its interaction treatment is independent of content.
final class EditorialActionCard extends StatelessWidget {
  const EditorialActionCard({
    required this.child,
    required this.onTap,
    required this.semanticLabel,
    this.outlined = true,
    super.key,
  });

  final Widget child;
  final VoidCallback onTap;
  final String semanticLabel;
  final bool outlined;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: double.infinity,
    child: _EditorialTarget(
      semanticLabel: semanticLabel,
      onTap: onTap,
      card: true,
      outlined: outlined,
      child: child,
    ),
  );
}

/// A reader link with the same minimum target and visible keyboard focus as cards.
final class EditorialTextButton extends StatelessWidget {
  const EditorialTextButton({
    required this.child,
    required this.onPressed,
    this.semanticLabel,
    super.key,
  });

  final Widget child;
  final VoidCallback onPressed;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) => _EditorialTarget(
    semanticLabel: semanticLabel,
    onTap: onPressed,
    child: DefaultTextStyle.merge(
      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
        color: context.surfaceColors.interactionAccent,
      ),
      child: child,
    ),
  );
}

final class _EditorialTarget extends StatefulWidget {
  const _EditorialTarget({
    required this.semanticLabel,
    required this.onTap,
    required this.child,
    this.card = false,
    this.outlined = true,
  });

  final String? semanticLabel;
  final VoidCallback onTap;
  final Widget child;
  final bool card;
  final bool outlined;

  @override
  State<_EditorialTarget> createState() => _EditorialTargetState();
}

final class _EditorialTargetState extends State<_EditorialTarget> {
  final FocusNode _focusNode = FocusNode();
  bool _hasFocus = false;
  bool _focused = false;
  bool _hovered = false;
  bool _pressed = false;

  @override
  void dispose() {
    _focusNode.dispose();
    super.dispose();
  }

  void _setPressed(bool pressed) {
    if (_pressed != pressed) {
      setState(() => _pressed = pressed);
    }
  }

  @override
  Widget build(BuildContext context) {
    final DialektikSurfaceColors colors = context.surfaceColors;
    final Duration duration = DialektikMotion.accessibleDuration(
      duration: DialektikMotion.fast,
      disableAnimations: MediaQuery.of(context).disableAnimations,
    );
    final Color interactiveBorder = _hovered || _pressed
        ? colors.interactionAccent
        : widget.card && widget.outlined
        ? colors.divider
        : DialektikColors.transparent;
    final Color ground = widget.card && widget.outlined && !_pressed
        ? colors.raised
        : colors.base;
    final BorderRadius radius = widget.card && widget.outlined
        ? DialektikRadii.mediumBorderRadius
        : DialektikRadii.smallBorderRadius;
    final EdgeInsets contentPadding = widget.card && widget.outlined
        ? const EdgeInsets.all(EditorialLayout.cardPadding)
        : widget.card
        ? const EdgeInsets.symmetric(
            vertical: DialektikSpacing.space6,
            horizontal: DialektikSpacing.space3,
          )
        : const EdgeInsets.all(DialektikSpacing.space3);

    return FocusableActionDetector(
      focusNode: _focusNode,
      includeFocusSemantics: false,
      onFocusChange: (bool value) => setState(() => _hasFocus = value),
      mouseCursor: SystemMouseCursors.click,
      onShowFocusHighlight: (bool value) => setState(() => _focused = value),
      onShowHoverHighlight: (bool value) => setState(() => _hovered = value),
      shortcuts: const <ShortcutActivator, Intent>{
        SingleActivator(LogicalKeyboardKey.enter): ActivateIntent(),
        SingleActivator(LogicalKeyboardKey.space): ActivateIntent(),
      },
      actions: <Type, Action<Intent>>{
        ActivateIntent: CallbackAction<ActivateIntent>(
          onInvoke: (ActivateIntent intent) {
            widget.onTap();
            return null;
          },
        ),
      },
      child: MergeSemantics(
        child: Semantics(
          container: true,
          focusable: true,
          focused: _hasFocus,
          onFocus: _focusNode.requestFocus,
          button: true,
          enabled: true,
          excludeSemantics: widget.semanticLabel != null,
          label: widget.semanticLabel,
          onTap: widget.onTap,
          child: GestureDetector(
            excludeFromSemantics: true,
            behavior: HitTestBehavior.opaque,
            onTap: widget.onTap,
            onTapDown: (TapDownDetails details) => _setPressed(true),
            onTapUp: (TapUpDetails details) => _setPressed(false),
            onTapCancel: () => _setPressed(false),
            child: AnimatedContainer(
              duration: duration,
              curve: DialektikMotion.standardCurve,
              decoration: BoxDecoration(
                border: Border.all(
                  color: _focused
                      ? colors.interactionAccent
                      : DialektikColors.transparent,
                  width: DialektikSizing.focusRingWidth,
                ),
                borderRadius: radius,
              ),
              padding: const EdgeInsets.all(DialektikSizing.focusRingGap),
              child: AnimatedContainer(
                duration: duration,
                curve: DialektikMotion.standardCurve,
                decoration: BoxDecoration(
                  color: ground,
                  border: Border.all(
                    color: interactiveBorder,
                    width: DialektikBorders.hairlineWidth,
                  ),
                  borderRadius: radius,
                ),
                constraints: const BoxConstraints(
                  minWidth: DialektikSizing.touchPreferred,
                  minHeight: DialektikSizing.touchPreferred,
                ),
                padding: contentPadding,
                child: widget.child,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

final class EditorialLoading extends StatelessWidget {
  const EditorialLoading({this.label = 'Cargando…', super.key});

  final String label;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    label: label,
    excludeSemantics: true,
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: EditorialLayout.sectionGap),
      child: Wrap(
        spacing: DialektikSpacing.space6,
        runSpacing: DialektikSpacing.space3,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: <Widget>[
          if (!MediaQuery.of(context).disableAnimations)
            SizedBox.square(
              dimension: DialektikSizing.iconMedium,
              child: CircularProgressIndicator(
                strokeWidth: DialektikBorders.anchorWidth,
                color: context.surfaceColors.muted,
              ),
            ),
          Text(label, style: Theme.of(context).textTheme.bodyMedium),
        ],
      ),
    ),
  );
}

final class EditorialEmptyState extends StatelessWidget {
  const EditorialEmptyState({
    required this.title,
    this.description,
    this.action,
    super.key,
  });

  final String title;
  final String? description;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: EditorialLayout.sectionGap),
    child: ConstrainedBox(
      constraints: const BoxConstraints(
        maxWidth: EditorialLayout.readerMaxWidth,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Semantics(
            liveRegion: true,
            child: Text(title, style: Theme.of(context).textTheme.titleLarge),
          ),
          if (description != null) ...<Widget>[
            const SizedBox(height: DialektikSpacing.space3),
            Text(
              description!,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: context.surfaceColors.muted,
              ),
            ),
          ],
          if (action != null) ...<Widget>[
            const SizedBox(height: DialektikSpacing.space6),
            action!,
          ],
        ],
      ),
    ),
  );
}
