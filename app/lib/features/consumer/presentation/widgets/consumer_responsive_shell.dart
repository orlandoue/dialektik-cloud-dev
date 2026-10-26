import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/presentation/widgets/consumer_navigation_action.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Shared editorial navigation for the real-data reader and public event views.
///
/// Narrow layouts keep primary destinations visible and put secondary routes
/// behind one accessible More menu. Wide layouts use an identity rail and a
/// separate reading canvas.
final class ConsumerResponsiveShell extends StatelessWidget {
  const ConsumerResponsiveShell({
    required this.title,
    required this.body,
    this.location,
    this.navigationActions = const <Widget>[],
    this.scrollBody = false,
    this.scrollKey,
    this.showBack = false,
    super.key,
  });

  static const double desktopBreakpoint = 1120;
  static const double sidebarWidth = 232;

  final String title;
  final Widget body;
  final String? location;
  final List<Widget> navigationActions;
  final bool scrollBody;
  final Key? scrollKey;
  final bool showBack;

  List<ConsumerNavigationAction> get _sections => navigationActions
      .whereType<ConsumerNavigationAction>()
      .toList(growable: false);

  @override
  Widget build(BuildContext context) => AnnotatedRegion<SystemUiOverlayStyle>(
    value: const SystemUiOverlayStyle(
      statusBarColor: DialektikColors.offWhite,
      statusBarIconBrightness: Brightness.dark,
      statusBarBrightness: Brightness.light,
      systemNavigationBarColor: DialektikColors.offWhite,
      systemNavigationBarIconBrightness: Brightness.dark,
    ),
    child: LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        if (constraints.maxWidth >= desktopBreakpoint) {
          return Scaffold(
            backgroundColor: DialektikColors.offWhite,
            body: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                SizedBox(
                  width: sidebarWidth,
                  child: _DesktopSidebar(actions: _sections),
                ),
                Expanded(child: _content(context, wide: true)),
              ],
            ),
          );
        }
        return Scaffold(
          backgroundColor: DialektikColors.offWhite,
          body: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              _MobileHeader(
                actions: _sections,
                location: location,
                showBack: showBack,
              ),
              Expanded(child: _content(context, wide: false)),
            ],
          ),
        );
      },
    ),
  );

  Widget _content(BuildContext context, {required bool wide}) {
    if (!scrollBody) {
      return SafeArea(top: false, child: body);
    }
    return SafeArea(
      top: false,
      child: Scrollbar(
        child: SingleChildScrollView(
          key: scrollKey,
          child: Center(
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: wide ? 1240 : 900),
              child: Padding(
                padding: EdgeInsets.fromLTRB(
                  wide ? 48 : DialektikSpacing.space6,
                  wide ? 38 : DialektikSpacing.space6,
                  wide ? 48 : DialektikSpacing.space6,
                  wide ? 56 : DialektikSpacing.space8,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    if (title != location && title != 'Dialektik') ...<Widget>[
                      Semantics(
                        header: true,
                        child: Text(
                          title,
                          style: DialektikTypography.editorialHeading(
                            color: DialektikColors.inkBlack,
                            size: wide ? 38 : 31,
                          ),
                        ),
                      ),
                      const SizedBox(height: DialektikSpacing.space6),
                    ],
                    body,
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

final class _MobileHeader extends StatelessWidget {
  const _MobileHeader({
    required this.actions,
    required this.showBack,
    this.location,
  });

  final List<ConsumerNavigationAction> actions;
  final String? location;
  final bool showBack;

  @override
  Widget build(BuildContext context) {
    final List<ConsumerNavigationAction> primary = actions
        .where(
          (ConsumerNavigationAction action) => const <String>{
            'Actualidad',
            'Acontecimientos',
            'Fuentes,' 'Contradicciones', 'Historias',,
          }.contains(action.label),
        )
        .toList(growable: false);
    final List<ConsumerNavigationAction> secondary = actions
        .where((ConsumerNavigationAction action) => !primary.contains(action))
        .toList(growable: false);
    return Material(
      color: DialektikColors.offWhite,
      child: SafeArea(
        bottom: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(
                DialektikSpacing.space4,
                DialektikSpacing.space2,
                DialektikSpacing.space4,
                DialektikSpacing.space1,
              ),
              child: Row(
                children: <Widget>[
                  if (showBack) ...<Widget>[
                    Semantics(
                      button: true,
                      label: 'Volver',
                      child: ExcludeSemantics(
                        child: IconButton(
                          tooltip: 'Volver',
                          onPressed: () => Navigator.of(context).maybePop(),
                          icon: const Icon(Icons.arrow_back),
                        ),
                      ),
                    ),
                    const SizedBox(width: DialektikSpacing.space1),
                  ],
                  Expanded(
                    child: Text(
                      'Dialektik',
                      style: DialektikTypography.editorialBrand(
                        color: DialektikColors.inkBlack,
                      ),
                    ),
                  ),
                  if (location != null && location != 'Dialektik')
                    Semantics(
                      label: 'Ubicación actual: $location',
                      excludeSemantics: true,
                      child: Text(
                        location!,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: DialektikColors.correctedCoolGray,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            _MobilePrimaryNavigation(primary: primary, secondary: secondary),
            const Divider(height: 1),
          ],
        ),
      ),
    );
  }
}

List<PopupMenuEntry<ConsumerNavigationAction>> _moreMenuItems(
  List<ConsumerNavigationAction> actions,
) {
  final List<PopupMenuEntry<ConsumerNavigationAction>> entries =
      <PopupMenuEntry<ConsumerNavigationAction>>[];
  for (final ConsumerNavigationAction action in actions) {
    if (action.label == 'Administración' && entries.isNotEmpty) {
      entries.add(const PopupMenuDivider());
    }
    entries.add(
      PopupMenuItem<ConsumerNavigationAction>(
        value: action,
        child: Text(action.label),
      ),
    );
  }
  return entries;
}

final class _MobilePrimaryNavigation extends StatelessWidget {
  const _MobilePrimaryNavigation({
    required this.primary,
    required this.secondary,
  });

  final List<ConsumerNavigationAction> primary;
  final List<ConsumerNavigationAction> secondary;

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    key: const Key('consumer-primary-navigation-scroll'),
    scrollDirection: Axis.horizontal,
    child: Row(
      children: <Widget>[
        for (final ConsumerNavigationAction action in primary)
          _PrimaryTab(action: action),
        if (secondary.isNotEmpty)
          _MoreTab(
            actions: secondary,
            selected: secondary.any(
              (ConsumerNavigationAction action) => action.selected,
            ),
          ),
      ],
    ),
  );
}

final class _PrimaryTab extends StatelessWidget {
  const _PrimaryTab({required this.action});

  final ConsumerNavigationAction action;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    selected: action.selected,
    label: action.selected
        ? '${action.label}, sección actual'
        : 'Abrir ${action.label}',
    child: InkWell(
      onTap: action.onPressed,
      child: Container(
        constraints: const BoxConstraints(minHeight: 48),
        padding: const EdgeInsets.symmetric(horizontal: 10),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: action.selected
                  ? DialektikColors.nocturne
                  : DialektikColors.transparent,
              width: 2,
            ),
          ),
        ),
        alignment: Alignment.center,
        child: Text(
          action.label,
          maxLines: 1,
          softWrap: false,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
            color: DialektikColors.inkBlack,
            fontWeight: action.selected ? FontWeight.w500 : FontWeight.w400,
            fontSize: 13,
            letterSpacing: 0.1,
          ),
        ),
      ),
    ),
  );
}

final class _MoreTab extends StatelessWidget {
  const _MoreTab({required this.actions, required this.selected});

  final List<ConsumerNavigationAction> actions;
  final bool selected;

  @override
  Widget build(BuildContext context) =>
      PopupMenuButton<ConsumerNavigationAction>(
        tooltip: 'Más opciones',
        onSelected: (ConsumerNavigationAction action) => action.onPressed(),
        itemBuilder: (BuildContext context) => _moreMenuItems(actions),
        child: Semantics(
          button: true,
          selected: selected,
          label: selected ? 'Más, sección actual' : 'Más secciones',
          child: Container(
            constraints: const BoxConstraints(minHeight: 48),
            padding: const EdgeInsets.symmetric(horizontal: 10),
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(
                  color: selected
                      ? DialektikColors.nocturne
                      : DialektikColors.transparent,
                  width: 2,
                ),
              ),
            ),
            alignment: Alignment.center,
            child: Text(
              'Más',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: DialektikColors.inkBlack,
                fontWeight: selected ? FontWeight.w500 : FontWeight.w400,
                fontSize: 13,
                letterSpacing: 0.1,
              ),
            ),
          ),
        ),
      );
}

final class _DesktopSidebar extends StatelessWidget {
  const _DesktopSidebar({required this.actions});

  final List<ConsumerNavigationAction> actions;

  @override
  Widget build(BuildContext context) {
    final List<ConsumerNavigationAction> editorial = actions
        .where(
          (ConsumerNavigationAction action) =>
              action.label != 'Administración' &&
              action.label != 'Contradicciones',
        )
        .toList(growable: false);
    final List<ConsumerNavigationAction> secondary = actions
        .where(
          (ConsumerNavigationAction action) =>
              action.label == 'Contradicciones' ||
              action.label == 'Administración',
        )
        .toList(growable: false);
    return Theme(
      data: DialektikTheme.nocturne(loadInterFromDependency: false),
      child: Material(
        color: DialektikColors.nocturne,
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 30, 16, 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Padding(
                  padding: const EdgeInsets.only(left: 10, bottom: 38),
                  child: Text(
                    'Dialektik',
                    style: DialektikTypography.editorialBrand(
                      color: DialektikColors.nocturneText,
                      size: 27,
                    ),
                  ),
                ),
                for (final ConsumerNavigationAction action in editorial)
                  _SidebarEntry(action: action),
                if (secondary.isNotEmpty) ...<Widget>[
                  const Spacer(),
                  Divider(color: DialektikColors.nocturneDivider),
                  for (final ConsumerNavigationAction action in secondary)
                    _SidebarEntry(action: action),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

final class _SidebarEntry extends StatelessWidget {
  const _SidebarEntry({required this.action});

  final ConsumerNavigationAction action;

  IconData get _icon => switch (action.label) {
    'Actualidad' => Icons.home_outlined,
    'Acontecimientos' => Icons.account_balance_outlined,
    'Fuentes' => Icons.source_outlined,
    'Contradicciones' => Icons.compare_arrows_outlined,
    'Administración' => Icons.settings_outlined,
    _ => Icons.circle_outlined,
  };

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Semantics(
      button: true,
      selected: action.selected,
      label: action.selected
          ? '${action.label}, sección actual'
          : 'Abrir ${action.label}',
      child: Material(
        color: action.selected
            ? DialektikColors.nocturneRaised
            : DialektikColors.transparent,
        borderRadius: DialektikRadii.mediumBorderRadius,
        child: InkWell(
          onTap: action.onPressed,
          borderRadius: DialektikRadii.mediumBorderRadius,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 46),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10),
              child: Row(
                children: <Widget>[
                  Icon(_icon, size: 19, color: DialektikColors.nocturneText),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      action.label,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: DialektikColors.nocturneText,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
