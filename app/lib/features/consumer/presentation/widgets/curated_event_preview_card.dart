import 'dart:async';

import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/data/curated_event_preview.dart';
import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:flutter/material.dart';

/// Editorial evidence preview only. This is never a persisted or inferred Event.
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
        padding: const EdgeInsets.all(DialektikSpacing.space6),
        child: FutureBuilder<CuratedEventPreview>(
          future: future,
          builder: (BuildContext context, AsyncSnapshot<CuratedEventPreview> snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('Caso real en evaluación · Chile'),
                  SizedBox(height: DialektikSpacing.space3),
                  LinearProgressIndicator(),
                ],
              );
            }
            if (snapshot.hasError || !snapshot.hasData) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const Text(
                    'La evidencia del acontecimiento piloto no está disponible.',
                  ),
                  TextButton.icon(
                    onPressed: onRetry,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Reintentar evidencia'),
                  ),
                ],
              );
            }
            final CuratedEventPreview preview = snapshot.data!;
            final int newsroomCount = preview.publications
                .where(
                  (CuratedEventPublication item) =>
                      item.publisherKind == 'INDEPENDENT_NEWSROOM',
                )
                .length;
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  'Agrupación editorial piloto · País',
                  style: Theme.of(context).textTheme.labelLarge,
                ),
                const SizedBox(height: DialektikSpacing.space3),
                Text(
                  preview.title,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: DialektikSpacing.space3),
                Wrap(
                  spacing: DialektikSpacing.space3,
                  runSpacing: DialektikSpacing.space2,
                  children: <Widget>[
                    const _EvidenceMetadata(
                      icon: Icons.place_outlined,
                      text: 'Estación Central · Santiago',
                    ),
                    const _EvidenceMetadata(
                      icon: Icons.calendar_today_outlined,
                      text: '13/10/2026',
                    ),
                    _EvidenceMetadata(
                      icon: Icons.article_outlined,
                      text: '${preview.publications.length} publicaciones',
                    ),
                    _EvidenceMetadata(
                      icon: Icons.people_outline,
                      text: '$newsroomCount medios',
                    ),
                    const _EvidenceMetadata(
                      icon: Icons.account_balance_outlined,
                      text: '1 fuente oficial',
                    ),
                  ],
                ),
                const SizedBox(height: DialektikSpacing.space4),
                const Text('Selección editorial · no es agrupación automática'),
                const SizedBox(height: DialektikSpacing.space2),
                Text(
                  'Las publicaciones se presentan juntas porque un editor revisó '
                  'el acontecimiento. El motor de agrupación automática aún no '
                  'ha validado este caso.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: DialektikSpacing.space3),
                ExpansionTile(
                  key: const Key('chile-preview-evidence-expand'),
                  tilePadding: EdgeInsets.zero,
                  initiallyExpanded: false,
                  title: const Text('Ver fuentes y evidencia'),
                  children: <Widget>[
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: Text(
                        preview.description,
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ),
                    const SizedBox(height: DialektikSpacing.space3),
                    for (final CuratedEventPublication item
                        in preview.publications)
                      Semantics(
                        button: true,
                        label:
                            'Abrir publicación original de ${item.publisher}',
                        child: ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: Text(item.headline),
                          subtitle: Text(
                            '${item.publisher} · ${item.publishedOn == '2026-10-13' ? '13/10' : '14/10'}/2026'
                            '${item.publisherKind == 'PRIMARY_GOVERNMENT_SOURCE' ? ' · Fuente primaria' : ''}',
                          ),
                          trailing: const Icon(Icons.open_in_new, size: 18),
                          onTap: () => unawaited(
                            openExternalHttpLink(item.canonicalUrl),
                          ),
                        ),
                      ),
                    const SizedBox(height: DialektikSpacing.space3),
                    Text(
                      preview.warning,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    const SizedBox(height: DialektikSpacing.space2),
                    Text(
                      'Enlaces revisados el ${preview.reviewedOn}. '
                      'No es un Event persistido ni un agrupamiento automático.',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

final class _EvidenceMetadata extends StatelessWidget {
  const _EvidenceMetadata({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: text,
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: DialektikSpacing.space3,
          vertical: DialektikSpacing.space2,
        ),
        decoration: BoxDecoration(
          border: Border.all(color: Theme.of(context).dividerColor),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(icon, size: 15),
            const SizedBox(width: DialektikSpacing.space2),
            Flexible(
              child: Text(text, style: Theme.of(context).textTheme.bodySmall),
            ),
          ],
        ),
      ),
    );
  }
}
