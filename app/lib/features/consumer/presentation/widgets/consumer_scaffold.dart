import 'package:dialektik/features/consumer/presentation/widgets/consumer_navigation_action.dart';
import 'package:dialektik/features/consumer/presentation/widgets/consumer_responsive_shell.dart';
import 'package:dialektik/features/semantic/presentation/editorial_components.dart';
import 'package:dialektik/features/semantic/presentation/editorial_vocabulary.dart';
import 'package:flutter/material.dart';

final class ConsumerScaffold extends StatelessWidget {
  const ConsumerScaffold({
    required this.title,
    required this.body,
    this.showContradictionsAction = false,
    this.onOpenContradictions,
    this.onOpenThreads,
    this.navigationActions = const <Widget>[],
    this.isDemo = false,
    this.fixtureProfile,
    this.showBack = false,
    super.key,
  });

  final String title;
  final Widget body;
  final bool showContradictionsAction;
  final VoidCallback? onOpenContradictions;
  final VoidCallback? onOpenThreads;
  final List<Widget> navigationActions;

  /// Provided by the authorized fixture composition, never inferred from data.
  final bool isDemo;
  final EditorialFixtureProfile? fixtureProfile;
  final bool showBack;

  @override
  Widget build(BuildContext context) {
    final EditorialFixtureProfile? profile =
        fixtureProfile ?? (isDemo ? editorialConfiguredFixtureProfile : null);
    final VoidCallback? openThreads = onOpenThreads;
    final VoidCallback? openContradictions = onOpenContradictions;
    final List<Widget> actions = navigationActions.isNotEmpty
        ? navigationActions
        : <Widget>[
            if (openThreads != null)
              ConsumerNavigationAction(
                label: 'Historias',
                selected: false,
                onPressed: openThreads,
              ),
            if (showContradictionsAction && openContradictions != null)
              ConsumerNavigationAction(
                label: 'Contradicciones',
                selected: title.contains('Contradicciones'),
                onPressed: openContradictions,
              ),
          ];
    final Widget content = profile == null
        ? body
        : Column(
            children: <Widget>[
              Align(
                alignment: Alignment.centerRight,
                child: EditorialFixtureIndicator(profile: profile),
              ),
              Expanded(child: body),
            ],
          );

    return ConsumerResponsiveShell(
      title: title,
      body: content,
      location: title,
      navigationActions: actions,
      showBack: showBack,
    );
  }
}
