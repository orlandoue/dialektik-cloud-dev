import 'dart:async';

import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/curated_event_preview.dart';
import 'package:dialektik/features/consumer/presentation/localization/consumer_strings.dart';
import 'package:dialektik/features/consumer/presentation/state/feed_controller.dart';
import 'package:dialektik/features/consumer/presentation/widgets/consumer_scaffold.dart';
import 'package:dialektik/features/consumer/presentation/widgets/curated_event_preview_card.dart';
import 'package:dialektik/features/consumer/presentation/widgets/event_card.dart';
import 'package:dialektik/features/consumer/presentation/widgets/filter_bar.dart';
import 'package:dialektik/features/consumer/presentation/widgets/system_state_view.dart';
import 'package:flutter/material.dart';

final class FeedScreen extends StatefulWidget {
  const FeedScreen({
    required this.repository,
    required this.onOpenEvent,
    required this.onOpenContradictions,
    this.onOpenThreads,
    this.curatedEventPreviewLoader,
    this.navigationActions = const <Widget>[],
    super.key,
  });

  final ConsumerRepository repository;
  final ValueChanged<String> onOpenEvent;
  final VoidCallback onOpenContradictions;
  final VoidCallback? onOpenThreads;
  final CuratedEventPreviewLoader? curatedEventPreviewLoader;
  final List<Widget> navigationActions;

  @override
  State<FeedScreen> createState() => _FeedScreenState();
}

final class _FeedScreenState extends State<FeedScreen> {
  Future<CuratedEventPreview>? _curatedPreviewFuture;
  late final FeedController _controller = FeedController(
    repository: widget.repository,
  );

  @override
  void initState() {
    super.initState();
    _curatedPreviewFuture = widget.curatedEventPreviewLoader?.call(
      refresh: true,
    );
    unawaited(_controller.loadInitial());
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Widget? get _editorialPreview {
    // A country-scoped preview is not a real persistent feed record; do not
    // imply it matches other categories or free-text topic filters.
    if (widget.curatedEventPreviewLoader == null ||
        (_controller.category != null && _controller.category != 'pais') ||
        _controller.topic != null) {
      return null;
    }
    return CuratedEventPreviewCard(
      future: _curatedPreviewFuture,
      onRetry: () => setState(() {
        _curatedPreviewFuture = widget.curatedEventPreviewLoader!.call(
          refresh: true,
        );
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ConsumerStrings strings = ConsumerStrings.of(context);
    return ConsumerScaffold(
      title: strings.appName,
      showContradictionsAction: true,
      onOpenContradictions: widget.onOpenContradictions,
      onOpenThreads: widget.onOpenThreads,
      navigationActions: widget.navigationActions,
      isDemo: widget.onOpenThreads != null,
      body: AnimatedBuilder(
        animation: _controller,
        builder: (BuildContext context, Widget? child) {
          return switch (_controller.phase) {
            FeedPhase.initial || FeedPhase.loading => _FeedListFrame(
              controller: _controller,
              preview: _editorialPreview,
              child: SystemStateView(message: strings.loading, isLoading: true),
            ),
            FeedPhase.error => _FeedListFrame(
              controller: _controller,
              preview: _editorialPreview,
              child: SystemStateView(
                message: strings.errorForName(_controller.failure!.kind.name),
                actionLabel: strings.retry,
                onAction: () => unawaited(_controller.refresh()),
              ),
            ),
            FeedPhase.empty => _FeedListFrame(
              controller: _controller,
              preview: _editorialPreview,
              child: SystemStateView(
                message: _controller.hasFilter
                    ? strings.filteredFeedEmpty
                    : strings.feedEmpty,
                actionLabel: _controller.hasFilter ? strings.clearFilter : null,
                onAction: _controller.hasFilter
                    ? () => unawaited(_controller.clearFilters())
                    : null,
              ),
            ),
            FeedPhase.content => _FeedContent(
              controller: _controller,
              preview: _editorialPreview,
              onOpenEvent: widget.onOpenEvent,
            ),
          };
        },
      ),
    );
  }
}

final class _FeedListFrame extends StatelessWidget {
  const _FeedListFrame({
    required this.controller,
    required this.child,
    this.preview,
  });

  final FeedController controller;
  final Widget child;
  final Widget? preview;

  @override
  Widget build(BuildContext context) {
    return ListView(
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
                const _FeedHeading(),
                const SizedBox(height: DialektikSpacing.space8),
                FilterBar(
                  category: controller.category,
                  topic: controller.topic,
                  onCategoryChanged: (String? value) =>
                      unawaited(controller.setCategory(value)),
                  onTopicChanged: (String? value) =>
                      unawaited(controller.setTopic(value)),
                ),
                if (preview != null) ...<Widget>[
                  const SizedBox(height: DialektikSpacing.space4),
                  preview!,
                ],
                const SizedBox(height: DialektikSpacing.space8),
                child,
              ],
            ),
          ),
        ),
      ],
    );
  }
}

final class _FeedContent extends StatelessWidget {
  const _FeedContent({
    required this.controller,
    required this.onOpenEvent,
    this.preview,
  });

  final FeedController controller;
  final ValueChanged<String> onOpenEvent;
  final Widget? preview;

  @override
  Widget build(BuildContext context) {
    final ConsumerStrings strings = ConsumerStrings.of(context);
    return RefreshIndicator(
      onRefresh: controller.refresh,
      child: ListView(
        key: const Key('event-feed-list'),
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
                  const _FeedHeading(),
                  const SizedBox(height: DialektikSpacing.space8),
                  FilterBar(
                    category: controller.category,
                    topic: controller.topic,
                    onCategoryChanged: (String? value) =>
                        unawaited(controller.setCategory(value)),
                    onTopicChanged: (String? value) =>
                        unawaited(controller.setTopic(value)),
                  ),
                  if (controller.isRefreshing) ...<Widget>[
                    const SizedBox(height: DialektikSpacing.space4),
                    LinearProgressIndicator(semanticsLabel: strings.refreshing),
                  ],
                  if (controller.transientFailure != null) ...<Widget>[
                    const SizedBox(height: DialektikSpacing.space4),
                    OperationalNotice(
                      kind: OperationalNoticeKind.warning,
                      message: strings.errorForName(
                        controller.transientFailure!.kind.name,
                      ),
                    ),
                  ],
                  const SizedBox(height: DialektikSpacing.space8),
                  for (
                    var index = 0;
                    index < controller.items.length;
                    index += 1
                  ) ...<Widget>[
                    EventCard(
                      key: ValueKey<String>(controller.items[index].id),
                      event: controller.items[index],
                      onOpen: () => onOpenEvent(controller.items[index].id),
                    ),
                    if (index < controller.items.length - 1)
                      const SizedBox(height: DialektikSpacing.space6),
                  ],if (preview != null) ...<Widget>[ const SizedBox(height: DialektikSpacing.space6), preview!, ],
                  if (controller.nextCursor != null) ...<Widget>[
                    const SizedBox(height: DialektikSpacing.space6),
                    FilledButton(
                      onPressed: controller.isPaginating
                          ? null
                          : () => unawaited(controller.loadNext()),
                      child: Text(
                        controller.isPaginating
                            ? strings.paginating
                            : strings.loadMore,
                      ),
                    ),
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

final class _FeedHeading extends StatelessWidget {
  const _FeedHeading();

  @override
  Widget build(BuildContext context) {
    final ConsumerStrings strings = ConsumerStrings.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Semantics(
          header: true,
          child: Text(
            strings.feedTitle,
            style: Theme.of(context).textTheme.headlineMedium,
          ),
        ),
        const SizedBox(height: DialektikSpacing.space3),
        Text(strings.feedDescription),
      ],
    );
  }
}
