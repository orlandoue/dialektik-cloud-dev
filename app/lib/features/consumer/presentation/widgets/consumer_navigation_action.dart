import 'package:dialektik/features/semantic/presentation/editorial_components.dart';
import 'package:flutter/material.dart';

/// A responsive section link shared by the consumer and live reading surfaces.
final class ConsumerNavigationAction extends StatelessWidget {
  const ConsumerNavigationAction({
    required this.label,
    required this.selected,
    required this.onPressed,
    super.key,
  });

  final String label;
  final bool selected;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Semantics(
    selected: selected,
    child: EditorialTextButton(
      semanticLabel: selected ? '$label, sección actual' : 'Abrir $label',
      onPressed: onPressed,
      child: Text(
        label,
        style: selected
            ? Theme.of(context).textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w600,
                decoration: TextDecoration.underline,
              )
            : null,
      ),
    ),
  );
}
