import 'package:dialektik/design_system/design_system.dart';
import 'package:flutter/material.dart';

final class SystemStateView extends StatelessWidget {
  const SystemStateView({
    required this.message,
    this.isLoading = false,
    this.actionLabel,
    this.onAction,
    super.key,
  });

  final String message;
  final bool isLoading;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(
          maxWidth: DialektikSizing.maxReadingWidth,
        ),
        child: Padding(
          padding: const EdgeInsets.all(DialektikSpacing.space8),
          child: Semantics(
            container: true,
            liveRegion: true,
            label: message,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                if (isLoading &&
                    !MediaQuery.disableAnimationsOf(context)) ...<Widget>[
                  const ExcludeSemantics(
                    child: SizedBox(
                      width: DialektikSizing.iconMedium,
                      height: DialektikSizing.iconMedium,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  ),
                  const SizedBox(height: DialektikSpacing.space4),
                ],
                ExcludeSemantics(
                  child: Text(message, textAlign: TextAlign.center),
                ),
                if (actionLabel != null && onAction != null) ...<Widget>[
                  const SizedBox(height: DialektikSpacing.space6),
                  FilledButton(onPressed: onAction, child: Text(actionLabel!)),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
