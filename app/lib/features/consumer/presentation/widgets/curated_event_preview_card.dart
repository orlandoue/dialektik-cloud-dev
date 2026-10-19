import 'dart:async';

import 'package:dialektik/features/consumer/data/curated_event_preview.dart';
import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:flutter/material.dart';

/// Distinct from persisted Events and the semantic engine. Never insert into feed.
final class CuratedEventPreviewCard extends StatelessWidget {
  const CuratedEventPreviewCard({
    required this.future,
    required this.onRetry,
    super.key,
  });

  final Future<CuratedEventPreview>? future;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Card(
      key: const Key('chile-curated-event-preview'),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: FutureBuilder<CuratedEventPreview>(
          future: future,
          builder: (BuildContext context, AsyncSnapshot<CuratedEventPreview> snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('Caso real en evaluación · Chile'),
                  LinearProgressIndicator(),
                ],
              );
            }
            if (snapshot.hasError || !snapshot.hasData) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const Text('La evidencia del acontecimiento piloto no está disponible.'),
                  TextButton.icon(
                    onPressed: onRetry,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Reintentar evidencia'),
                  ),
                ],
              );
            }
            final CuratedEventPreview preview = snapshot.data!;
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  'Agrupación editorial piloto · País',
                  style: Theme.of(context).textTheme.labelLarge,
                ),
                const SizedBox(height: 8),
                Text(preview.title, style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 4),
                Text('13 de octubre de 2026 · ${preview.location}'),
                const SizedBox(height: 8),
                Text(
                  '${preview.publications.length} publicaciones · ${preview.publications.where((CuratedEventPublication p) => p.publisherKind == 'INDEPENDENT_NEWSROOM').length} medios independientes y 1 fuente oficial',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 8),
                Text(preview.warning, style: Theme.of(context).textTheme.bodySmall),
                ExpansionTile(
                  key: const Key('chile-preview-evidence-expand'),
                  tilePadding: EdgeInsets.zero,
                  initiallyExpanded: true,
                  title: const Text('Comparar publicaciones originales'),
                  children: <Widget>[
                    Text(preview.description),
                    const SizedBox(height: 8),
                    for (final CuratedEventPublication item in preview.publications)
                      ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        title: Text(item.headline),
                        subtitle: Text(
                          '${item.publisher} · ${item.publishedOn == '2026-10-13' ? '13/10' : '14/10'}/2026'
                          '${item.publisherKind == 'PRIMARY_GOVERNMENT_SOURCE' ? ' · Fuente primaria' : ''}',
                        ),
                        trailing: const Icon(Icons.open_in_new, size: 18),
                        onTap: () => unawaited(openExternalHttpLink(item.canonicalUrl)),
                      ),
                  ],
                ),
                Text(
                  'Enlaces revisados el ${preview.reviewedOn}. No es un Event persistido ni un agrupamiento automático.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
