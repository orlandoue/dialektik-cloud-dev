import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/live/data/chile_rss_chronology.dart';
import 'package:dialektik/features/live/presentation/live_components.dart';
import 'package:flutter/material.dart';

/// A single chronological list of publisher RSS links; never Article records.
final class ChileRssChronologyPanel extends StatefulWidget {
  const ChileRssChronologyPanel({required this.repository, super.key});
  final ChileRssChronologyRepository repository;
  @override
  State<ChileRssChronologyPanel> createState() =>
      _ChileRssChronologyPanelState();
}

final class _ChileRssChronologyPanelState
    extends State<ChileRssChronologyPanel> {
  late Future<ChileRssChronology> _future;
  bool _expanded = false;

  @override
  void initState() {
    super.initState();
    _future = widget.repository.loadChileRssChronology(refresh: true);
  }

  void _reload() => setState(() {
    _expanded = false;
    _future = widget.repository.loadChileRssChronology(refresh: true);
  });

  @override
  Widget build(BuildContext context) => Card(
    key: const Key('chile-unified-rss-headlines'),
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              const Icon(Icons.rss_feed, size: 23),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Noticias RSS · Chile',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              IconButton(
                tooltip: 'Actualizar noticias RSS',
                onPressed: _reload,
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
          Text(
            'Titulares y enlaces originales de los medios. No son artículos guardados ni acontecimientos analizados.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 10),
          FutureBuilder<ChileRssChronology>(
            future: _future,
            builder: (
              BuildContext context,
              AsyncSnapshot<ChileRssChronology> snapshot,
            ) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const LinearProgressIndicator();
              }
              if (snapshot.hasError || !snapshot.hasData) {
                return TextButton.icon(
                  onPressed: _reload,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Reintentar noticias RSS'),
                );
              }
              final ChileRssChronology data = snapshot.data!;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    '${data.items.length} enlaces recientes · ${data.sources.where((s) => s.status == 'AVAILABLE').length} medios disponibles',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  if (data.sources.any((s) => s.status == 'UNAVAILABLE'))
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        'Al menos un canal RSS no respondió. Se mantienen visibles los titulares de los otros medios.',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                  const SizedBox(height: 8),
                  for (final ChileRssChronologyItem item in (_expanded
                      ? data.items
                      : data.items.take(6)))
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 9),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            item.title,
                            style: Theme.of(context).textTheme.titleSmall,
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '${item.publisher} · ${_date(item.publishedAt)}',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                          LiveExternalAction(
                            uri: item.originalUrl,
                            opener: openExternalHttpLink,
                            label: 'Leer en medio original',
                          ),
                        ],
                      ),
                    ),
                  if (data.items.length > 6)
                    TextButton(
                      onPressed: () =>
                          setState(() => _expanded = !_expanded),
                      child: Text(
                        _expanded ? 'Mostrar menos' : 'Ver todos los titulares RSS',
                      ),
                    ),
                ],
              );
            },
          ),
        ],
      ),
    ),
  );

  String _date(DateTime raw) {
    final DateTime d = raw.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(d.day)}/${two(d.month)} ${two(d.hour)}:${two(d.minute)}';
  }
}
