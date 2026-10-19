import 'dart:async';

import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/consumer/presentation/localization/consumer_strings.dart';
import 'package:dialektik/features/consumer/presentation/state/event_controller.dart';
import 'package:dialektik/features/consumer/presentation/widgets/analysis_pending_panel.dart';
import 'package:dialektik/features/consumer/presentation/widgets/claim_row.dart';
import 'package:dialektik/features/consumer/presentation/widgets/consumer_scaffold.dart';
import 'package:dialektik/features/consumer/presentation/widgets/position_card.dart';
import 'package:dialektik/features/consumer/presentation/widgets/relationship_indicator.dart';
import 'package:dialektik/features/consumer/presentation/widgets/system_state_view.dart';
import 'package:flutter/material.dart';

final class EventDetailScreen extends StatefulWidget {
  const EventDetailScreen({
    required this.eventId,
    required this.repository,
    required this.externalLinkOpener,
    required this.onOpenEvent,
    required this.onOpenSource,
    this.isDemo = false,
    this.navigationActions = const <Widget>[],
    super.key,
  });

  final String eventId;
  final ConsumerRepository repository;
  final ExternalLinkOpener externalLinkOpener;
  final ValueChanged<String> onOpenEvent;
  final ValueChanged<String> onOpenSource;
  final bool isDemo;
  final List<Widget> navigationActions;

  @override
  State<EventDetailScreen> createState() => _EventDetailScreenState();
}

final class _EventDetailScreenState extends State<EventDetailScreen> {
  late final EventController _controller = EventController(
    eventId: widget.eventId,
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

  Future<void> _openArticle(Uri uri) async {
    final bool opened = await widget.externalLinkOpener(uri);
    if (!opened && mounted) {
      final ConsumerStrings strings = ConsumerStrings.of(context);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(strings.externalLinkFailed)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final ConsumerStrings strings = ConsumerStrings.of(context);
    return ConsumerScaffold(
      title: strings.feedTitle,
      isDemo: widget.isDemo,
      navigationActions: widget.navigationActions,
      showBack: true,
      body: AnimatedBuilder(
        animation: _controller,
        builder: (BuildContext context, Widget? child) {
          return switch (_controller.phase) {
            EventPhase.initial || EventPhase.loading => SystemStateView(
              message: strings.loadingEvent,
              isLoading: true,
            ),
            EventPhase.error => SystemStateView(
              message: strings.errorForName(_controller.failure!.kind.name),
              actionLabel: strings.retry,
              onAction: () => unawaited(_controller.refresh()),
            ),
            EventPhase.gone => _GoneEvent(
              tombstone: _controller.tombstone!,
              onOpenEvent: widget.onOpenEvent,
            ),
            EventPhase.content => _EventContent(
              controller: _controller,
              onOpenArticle: (Uri value) => unawaited(_openArticle(value)),
              onOpenSource: widget.onOpenSource,
            ),
          };
        },
      ),
    );
  }
}

final class _EventContent extends StatelessWidget {
  const _EventContent({
    required this.controller,
    required this.onOpenArticle,
    required this.onOpenSource,
  });

  final EventController controller;
  final ValueChanged<Uri> onOpenArticle;
  final ValueChanged<String> onOpenSource;

  @override
  Widget build(BuildContext context) {
    final ConsumerStrings strings = ConsumerStrings.of(context);
    final EventDetailDto event = controller.event!;
    return RefreshIndicator(
      onRefresh: controller.refresh,
      child: ListView(
        key: const Key('event-detail-list'),
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(DialektikSpacing.space6),
        children: <Widget>[
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                maxWidth: DialektikSizing.maxReadingWidth,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  if (controller.isRefreshing)
                    LinearProgressIndicator(semanticsLabel: strings.refreshing),
                  if (controller.transientFailure != null) ...<Widget>[
                    const SizedBox(height: DialektikSpacing.space4),
                    OperationalNotice(
                      kind: OperationalNoticeKind.warning,
                      message: strings.errorForName(
                        controller.transientFailure!.kind.name,
                      ),
                    ),
                  ],
                  Text(
                    strings.categoryName(event.category),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: DialektikSpacing.space2),
                  Text(
                    event.titleDescriptive,
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: DialektikSpacing.space4),
                  Text(strings.detected(event.detectedAt)),
                  Text(strings.window(event.window.from, event.window.to)),
                  Text(strings.sourceCount(event.sourceCount)),
                  const SizedBox(height: DialektikSpacing.space8),
                  if (event.primaryFact
                      case final PrimaryFactDto fact) ...<Widget>[
                    _PrimaryFact(
                      fact: fact,
                      onOpenArticle: onOpenArticle,
                      onOpenSource: onOpenSource,
                    ),
                    const SizedBox(height: DialektikSpacing.space8),
                  ],
                  if (event.analysisState == AnalysisState.analysisPending ||
                      controller.analysisUnavailable) ...<Widget>[
                    const AnalysisPendingPanel(),
                    const SizedBox(height: DialektikSpacing.space8),
                    Text(
                      strings.assertions,
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: DialektikSpacing.space4),
                    if (controller.assertions.isEmpty)
                      Text(strings.noAssertions)
                    else
                      for (
                        var index = 0;
                        index < controller.assertions.length;
                        index += 1
                      ) ...<Widget>[
                        ClaimRow(
                          assertion: controller.assertions[index],
                          onOpenArticle: onOpenArticle,
                          onOpenSource: onOpenSource,
                        ),
                        if (index < controller.assertions.length - 1)
                          const SizedBox(
                            height: DialektikSpacing.evidenceItemGap,
                          ),
                      ],
                  ] else ...<Widget>[
                    Text(
                      strings.positions,
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: DialektikSpacing.space4),
                    if (controller.positions.isEmpty)
                      Text(strings.noPositions)
                    else
                      for (
                        var index = 0;
                        index < controller.positions.length;
                        index += 1
                      ) ...<Widget>[
                        PositionCard(
                          position: controller.positions[index],
                          expanded:
                              controller.expandedPositionId ==
                              controller.positions[index].id,
                          loading: controller.loadingPositionIds.contains(
                            controller.positions[index].id,
                          ),
                          failed: controller.failedPositionIds.contains(
                            controller.positions[index].id,
                          ),
                          detail: controller
                              .positionDetails[controller.positions[index].id],
                          onToggle: () => unawaited(
                            controller.togglePosition(
                              controller.positions[index].id,
                            ),
                          ),
                          onRetry: () => unawaited(
                            controller.retryPosition(
                              controller.positions[index].id,
                            ),
                          ),
                          onOpenArticle: onOpenArticle,
                          onOpenSource: onOpenSource,
                        ),
                        if (index < controller.positions.length - 1)
                          const SizedBox(
                            height: DialektikSpacing.positionStackGap,
                          ),
                      ],
                  ],
                  const SizedBox(height: DialektikSpacing.space8),
                  Text(
                    strings.relationships,
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: DialektikSpacing.space4),
                  if (controller.relationships.isEmpty)
                    Text(strings.noRelationships)
                  else
                    for (
                      var index = 0;
                      index < controller.relationships.length;
                      index += 1
                    ) ...<Widget>[
                      RelationshipIndicator(
                        relationship: controller.relationships[index],
                      ),
                      if (index < controller.relationships.length - 1)
                        const SizedBox(height: DialektikSpacing.space4),
                    ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

final class _PrimaryFact extends StatelessWidget {
  const _PrimaryFact({
    required this.fact,
    required this.onOpenArticle,
    required this.onOpenSource,
  });

  final PrimaryFactDto fact;
  final ValueChanged<Uri> onOpenArticle;
  final ValueChanged<String> onOpenSource;

  @override
  Widget build(BuildContext context) {
    final ConsumerStrings strings = ConsumerStrings.of(context);
    return DialektikSurface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            strings.primaryFact,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: DialektikSpacing.space3),
          Text(fact.statement),
          const SizedBox(height: DialektikSpacing.space3),
          Wrap(
            spacing: DialektikSpacing.space3,
            runSpacing: DialektikSpacing.space2,
            children: <Widget>[
              TextButton.icon(
                onPressed: () => onOpenArticle(fact.primaryPublicationUrl),
                icon: const DialektikIcon(
                  icon: DialektikFunctionalIcon.externalLink,
                  size: DialektikIconSize.small,
                ),
                label: Text(strings.openOriginal),
              ),
              TextButton(
                onPressed: () => onOpenSource(fact.primarySource.id),
                child: Text('${strings.source}: ${fact.primarySource.name}'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

final class _GoneEvent extends StatelessWidget {
  const _GoneEvent({required this.tombstone, required this.onOpenEvent});

  final TombstoneDto tombstone;
  final ValueChanged<String> onOpenEvent;

  @override
  Widget build(BuildContext context) {
    final ConsumerStrings strings = ConsumerStrings.of(context);
    final List<TombstoneSuccessorDto> successors = tombstone.successors
        .where(
          (TombstoneSuccessorDto item) =>
              item.type == TombstoneSuccessorType.event,
        )
        .toList();
    return SystemStateView(
      message:
          '${strings.historicalEvent}. ${strings.historicalExplanation} '
          '${tombstone.reason}',
      actionLabel: successors.isEmpty ? null : strings.openSuccessor,
      onAction: successors.isEmpty
          ? null
          : () => onOpenEvent(successors.first.id),
    );
  }
}
