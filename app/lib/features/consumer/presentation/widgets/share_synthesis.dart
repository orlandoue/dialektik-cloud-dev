import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

String synthesisShareText(EventDetailDto event, {String? relation}) {
  final label = switch (relation) {
    'CONTRADICTION' => 'Contradicción',
    'DIFFERENT_FOCUS' => 'Distinto enfoque',
    'DEVELOPING' => 'En desarrollo',
    'TREND' => 'Tendencia',
    _ => 'Cobertura',
  };
  final lines = <String>['$label · ${event.titleDescriptive}', ''];
  for (final position in event.coveragePositions) {
    final names = position.assertions.map((a) => a.sourceName).toSet().join(', ');
    if (names.isNotEmpty) lines.add('• $names: ${position.title}');
  }
  if (event.articles.isNotEmpty) {
    lines.addAll(['', 'Noticias originales:']);
    for (final article in event.articles) {
      lines.add('• ${article.sourceName}: ${article.url}');
    }
  }
  lines.addAll(['', 'Síntesis verificable generada en Dialektik']);
  return lines.join('\n');
}

Future<void> showSynthesisSharePreview(BuildContext context, EventDetailDto event, {String? relation}) async {
  final text = synthesisShareText(event, relation: relation);
  await showDialog<void>(context: context, builder: (dialogContext) => AlertDialog(
    title: const Text('Compartir síntesis'),
    content: SingleChildScrollView(child: SelectableText(text)),
    actions: [
      TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Cerrar')),
      TextButton(onPressed: () async {
        await Clipboard.setData(ClipboardData(text: text));
        if (dialogContext.mounted) Navigator.of(dialogContext).pop();
      }, child: const Text('Copiar texto')),
    ],
  ));
}
