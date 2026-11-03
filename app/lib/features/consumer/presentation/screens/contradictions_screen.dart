import 'dart:async';

import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/following_repository.dart';
import 'package:dialektik/features/consumer/presentation/localization/consumer_strings.dart';
import 'package:dialektik/features/consumer/presentation/state/contradictions_controller.dart';
import 'package:dialektik/features/consumer/presentation/widgets/consumer_scaffold.dart';
import 'package:dialektik/features/consumer/presentation/widgets/contradiction_card.dart';
import 'package:dialektik/features/consumer/presentation/widgets/contradictions_empty_state.dart';
import 'package:dialektik/features/consumer/presentation/widgets/system_state_view.dart';
import 'package:flutter/material.dart';

final class ContradictionsScreen extends StatefulWidget {
  const ContradictionsScreen({
    required this.repository,
    required this.onOpenEvent,
    this.navigationActions = const <Widget>[],
    super.key,
  });

  final ConsumerRepository repository;
  final ValueChanged<String> onOpenEvent;
  final List<Widget> navigationActions;

  @override
  State<ContradictionsScreen> createState() => _ContradictionsScreenState();
}

final class _ContradictionsScreenState extends State<ContradictionsScreen> {
  late final ContradictionsController _controller = ContradictionsController(
    repository: widget.repository,
  );

  @override
  void initState() {
    super.initState();
    unawaited(_controller.load());
    if (widget.repository case final FollowingRepository following) {
      if (following.followingAvailable) following.followingChanges.addListener(_onFollowingChanged);
    }
  }

  void _onFollowingChanged() => unawaited(_controller.retry());

  @override
  void dispose() {
    if (widget.repository case final FollowingRepository following) {
      if (following.followingAvailable) following.followingChanges.removeListener(_onFollowingChanged);
    }
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ConsumerStrings strings = ConsumerStrings.of(context);
    return ConsumerScaffold(
      title: strings.contradictionsTitle,
      navigationActions: widget.navigationActions,
      body: AnimatedBuilder(
        animation: _controller,
        builder: (BuildContext context, Widget? child) {
          return switch (_controller.phase) {
            ContradictionsPhase.initial || ContradictionsPhase.loading =>
              SystemStateView(message: strings.loading, isLoading: true),
            ContradictionsPhase.empty => const ContradictionsEmptyState(),
            ContradictionsPhase.error => SystemStateView(
              message: strings.errorForName(_controller.failure!.kind.name),
              actionLabel: strings.retry,
              onAction: () => unawaited(_controller.retry()),
            ),
            ContradictionsPhase.content => ListView(
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
                        for (
                          var index = 0;
                          index < _controller.items.length;
                          index += 1
                        ) ...<Widget>[
                          ContradictionCard(
                            contradiction: _controller.items[index],
                            repository: widget.repository,
                            onOpenEvent: () => widget.onOpenEvent(
                              _controller.items[index].eventId,
                            ),
                          ),
                          if (index < _controller.items.length - 1)
                            const SizedBox(height: DialektikSpacing.space6),
                        ],
                        if (_controller.nextCursor != null) ...<Widget>[
                          const SizedBox(height: DialektikSpacing.space6),
                          FilledButton(
                            onPressed: _controller.isPaginating
                                ? null
                                : () => unawaited(_controller.loadNext()),
                            child: Text(
                              _controller.isPaginating
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
          };
        },
      ),
    );
  }
}
