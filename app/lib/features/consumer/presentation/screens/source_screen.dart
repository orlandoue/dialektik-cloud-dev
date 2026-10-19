import 'dart:async';

import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/localization/consumer_strings.dart';
import 'package:dialektik/features/consumer/presentation/state/source_controller.dart';
import 'package:dialektik/features/consumer/presentation/widgets/consumer_scaffold.dart';
import 'package:dialektik/features/consumer/presentation/widgets/system_state_view.dart';
import 'package:dialektik/features/semantic/presentation/editorial_components.dart';
import 'package:dialektik/features/semantic/presentation/editorial_vocabulary.dart';
import 'package:flutter/material.dart';

final class SourceScreen extends StatefulWidget {
  const SourceScreen({
    required this.sourceId,
    required this.repository,
    this.isDemo = false,
    this.fixtureProfile,
    this.logo,
    this.navigationActions = const <Widget>[],
    super.key,
  });

  final String sourceId;
  final ConsumerRepository repository;
  final bool isDemo;
  final EditorialFixtureProfile? fixtureProfile;

  /// An optional legitimate publisher asset, never inferred from its name.
  final ImageProvider<Object>? logo;
  final List<Widget> navigationActions;

  @override
  State<SourceScreen> createState() => _SourceScreenState();
}

final class _SourceScreenState extends State<SourceScreen> {
  late final SourceController _controller = SourceController(
    sourceId: widget.sourceId,
    repository: widget.repository,
  );

  @override
  void initState() {
    super.initState();
    unawaited(_controller.load());
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ConsumerStrings strings = ConsumerStrings.of(context);
    return ConsumerScaffold(
      title: strings.source,
      isDemo: widget.isDemo,
      fixtureProfile: widget.fixtureProfile,
      navigationActions: widget.navigationActions,
      showBack: true,
      onOpenThreads: widget.isDemo || widget.fixtureProfile != null
          ? () => Navigator.of(context).pushNamedAndRemoveUntil(
              '/threads',
              (Route<dynamic> route) => false,
            )
          : null,
      body: AnimatedBuilder(
        animation: _controller,
        builder: (BuildContext context, Widget? child) {
          return switch (_controller.phase) {
            SourcePhase.initial || SourcePhase.loading => SystemStateView(
              message: strings.loadingSource,
              isLoading: true,
            ),
            SourcePhase.error => SystemStateView(
              message: strings.errorForName(_controller.failure!.kind.name),
              actionLabel: strings.retry,
              onAction: () => unawaited(_controller.retry()),
            ),
            SourcePhase.content => _SourceContent(
              source: _controller.source!,
              isDemo: widget.isDemo || widget.fixtureProfile != null,
              logo: widget.logo,
            ),
          };
        },
      ),
    );
  }
}

final class _SourceContent extends StatelessWidget {
  const _SourceContent({required this.source, required this.isDemo, this.logo});

  final SourceDto source;
  final bool isDemo;
  final ImageProvider<Object>? logo;

  @override
  Widget build(BuildContext context) {
    final ConsumerStrings strings = ConsumerStrings.of(context);
    final String name = isDemo ? editorialSourceName(source.name) : source.name;
    return ListView(
      key: PageStorageKey<String>('source-${source.id}'),
      padding: const EdgeInsets.all(DialektikSpacing.space6),
      children: <Widget>[
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              maxWidth: DialektikSizing.maxReadingWidth,
            ),
            child: DialektikSurface(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  LayoutBuilder(
                    builder:
                        (
                          BuildContext context,
                          BoxConstraints constraints,
                        ) => SourceIdentity(
                          name: name,
                          header: true,
                          logo: logo,
                          stacked:
                              constraints.maxWidth <
                                  EditorialLayout.sourceHeaderInlineMinimum ||
                              MediaQuery.textScalerOf(context).scale(
                                    DialektikTypography.publicBodyMinimum,
                                  ) >
                                  EditorialLayout.maxTwoColumnTextSize,
                          publisherType:
                              '${strings.sourceType}: ${strings.sourceTypeLabel(source.sourceType)}',
                        ),
                  ),
                  const SizedBox(height: DialektikSpacing.space4),
                  Text(strings.sourceLimit),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}
