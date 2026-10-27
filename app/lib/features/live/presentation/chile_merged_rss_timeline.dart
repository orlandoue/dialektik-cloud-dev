import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/live/data/chile_rss_linked_news.dart' as dia;
import 'package:dialektik/features/live/data/chile_rss_links.dart' as coop;
import 'package:dialektik/features/live/presentation/live_components.dart';
import 'package:flutter/material.dart';

/// One chronological, source-attributed reader over two independently
/// verified RSS original-link preview contracts. NOT persisted Articles.
final class ChileUnifiedRssItem {
  const ChileUnifiedRssItem({
    required this.headline,
    required this.publisher,
    required this.originalUrl,
    required this.publishedAt,
  });

  final String headline;
  final String publisher;
  final Uri originalUrl;
  final DateTime publishedAt;
}

/// Pure composition: never labels two publisher feeds as corroboration,
/// same-occurrence grouping, editorial analysis or contradictions.
List<ChileUnifiedRssItem> mergeChileRssSources({
  dia.ChileRssLinkedNews? elDia,
  coop.ChileRssLinksPreview? cooperativa,
}) {
  final Map<String, ChileUnifiedRssItem> unique =
      <String, ChileUnifiedRssItem>{};
  if (elDia != null) {
    for (final dia.ChileRssLink item in elDia.items) {
      unique.putIfAbsent(
        item.originalUrl.toString(),
        () => ChileUnifiedRssItem(
          headline: item.headline,
          publisher: item.publisher,
          originalUrl: item.originalUrl,
          publishedAt: item.publishedAt,
        ),
      );
    }
  }
  if (cooperativa != null) {
    for (final coop.ChileRssLink item in cooperativa.items) {
      unique.putIfAbsent(
        item.canonicalUrl.toString(),
        () => ChileUnifiedRssItem(
          headline: item.headline,
          publisher: 'Cooperativa.cl',
          originalUrl: item.canonicalUrl,
          publishedAt: item.publishedAt,
        ),
      );
    }
  }
  final List<ChileUnifiedRssItem> chronological = unique.values.toList();
  chronological.sort((ChileUnifiedRssItem a, ChileUnifiedRssItem b) {
    final int date = b.publishedAt.compareTo(a.publishedAt);
    return date != 0 ? date : a.originalUrl.toString().compareTo(
      b.originalUrl.toString(),
    );
  });
  return List<ChileUnifiedRssItem>.unmodifiable(chronological);
}

final class _SourceResult {
  const _SourceResult({this.elDia, this.cooperativa, this.failed = false});
  final dia.ChileRssLinkedNews? elDia;
  final coop.ChileRssLinksPreview? cooperativa;
  final bool failed;
}
final class _CombinedResult {
  const _CombinedResult({
    required this.items,
    required this.workingSources,
    required this.failedSources,
  });
  final List<ChileUnifiedRssItem> items;
  final int workingSources;
  final int failedSources;
}

/// If one publisher becomes temporarily unavailable, the other stays visible.
final class ChileMergedRssTimeline extends StatefulWidget {
  const ChileMergedRssTimeline({
    required this.elDiaRepository,
    required this.cooperativaRepository,
    super.key,
  });
  final dia.ChileRssLinkedNewsRepository elDiaRepository;
  final coop.ChileRssLinksRepository cooperativaRepository;

  @override
  State<ChileMergedRssTimeline> createState() => _ChileMergedRssTimelineState();
}
final class _ChileMergedRssTimelineState extends State<ChileMergedRssTimeline> {
  late Future<_CombinedResult> _future;
  bool _showAll = false;

  @override
  void initState() {
    super.initState();
    _future = _load(refresh: true);
  }

  Future<_SourceResult> _fetchElDia(bool refresh) async {
    try {
      return _SourceResult(
        elDia: await widget.elDiaRepository.loadChileRssLinkedNews(
          refresh: refresh,
        ),
      );
    } on Exception {
      return const _SourceResult(failed: true);
    }
  }

  Future<_SourceResult> _fetchCooperativa(bool refresh) async {
    try {
      return _SourceResult(
        cooperativa: await widget.cooperativaRepository.loadChileRssLinks(
          refresh: refresh,
        ),
      );
    } on Exception {
      return const _SourceResult(failed: true);
    }
  }

  Future<_CombinedResult> _load({bool refresh = false}) async {
    final List<_SourceResult> results = await Future.wait<_SourceResult>(
      <Future<_SourceResult>>[
        _fetchElDia(refresh),
        _fetchCooperativa(refresh),
      ],
    );
    return _CombinedResult(
      items: mergeChileRssSources(
        elDia: results[0].elDia,
        cooperativa: results[1].cooperativa,
      ),
      workingSources: results.where((_SourceResult x) => !x.failed).length,
      failedSources: results.where((_SourceResult x) => x.failed).length,
    );
  }

  void _refresh() {
    setState(() {
      _showAll = false;
      _future = _load(refresh: true);
    });
  }

  @override
  Widget build(BuildContext context) => Card(
    key: const Key('chile-merged-rss-news'),
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              const Icon(Icons.rss_feed, size: 22),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Titulares recientes · Chile',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              IconButton(
                tooltip: 'Actualizar titulares de ambos medios',
                onPressed: _refresh,
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
          Text(
            'RSS de Diario El Día y Cooperativa · enlaces originales, sin copiar artículos.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 12),
          FutureBuilder<_CombinedResult>(
            future: _future,
            builder: (
              BuildContext context,
              AsyncSnapshot<_CombinedResult> snapshot,
            ) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const LinearProgressIndicator();
              }
              if (snapshot.hasError || !snapshot.hasData) {
                return TextButton(
                  onPressed: _refresh,
                  child: const Text('Reintentar titulares RSS'),
                );
              }
              final _CombinedResult data = snapshot.data!;
              if (data.workingSources == 0) {
                return TextButton(
                  onPressed: _refresh,
                  child: const Text('Los RSS no responden. Reintentar.'),
                );
              }
              final Iterable<ChileUnifiedRssItem> shown = _showAll
                  ? data.items
                  : data.items.take(8);
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    '${data.items.length} titulares · ${data.workingSources == 1 ? '1 medio disponible' : '${data.workingSources} medios disponibles'}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  if (data.failedSources > 0)
                    Text(
                      'Uno de los RSS no está disponible por ahora.',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  const SizedBox(height: 6),
                  if (data.items.isEmpty)
                    const Text('Los RSS consultados no tienen títulos recientes.')
                  else
                    for (final ChileUnifiedRssItem item in shown)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 9),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(
                              item.headline,
                              style: Theme.of(context).textTheme.titleSmall,
                            ),
                            const SizedBox(height: 3),
                            Text(
                              '${item.publisher} · ${_date(item.publishedAt)}',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                            LiveExternalAction(
                              uri: item.originalUrl,
                              opener: openExternalHttpLink,
                              label: 'Leer en el medio original',
                            ),
                          ],
                        ),
                      ),
                  if (data.items.length > 8)
                    TextButton(
                      onPressed: () => setState(() => _showAll = !_showAll),
                      child: Text(
                        _showAll ? 'Mostrar menos' : 'Ver todos los titulares',
                      ),
                    ),
                  const SizedBox(height: 8),
                  Text(
                    'Lectura RSS de dos medios independientes. No constituye agrupación de acontecimientos, verificación de afirmaciones ni detección de contradicciones.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              );
            },
          ),
        ],
      ),
    ),
  );

  String _date(DateTime date) {
    final DateTime local = date.toLocal();
    String two(int value) => value.toString().padLeft(2, '0');
    return '${two(local.day)}/${two(local.month)} ${two(local.hour)}:${two(local.minute)}';
  }
}
