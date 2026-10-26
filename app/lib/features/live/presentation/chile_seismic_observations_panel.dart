import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/live/data/chile_seismic_observations.dart';
import 'package:dialektik/features/live/presentation/live_components.dart';
import 'package:flutter/material.dart';

/// Official real USGS observations, never conflated with press Articles.
final class ChileSeismicObservationsPanel extends StatefulWidget {
  const ChileSeismicObservationsPanel({required this.repository, super.key});
  final SeismicObservationRepository repository;
  @override
  State<ChileSeismicObservationsPanel> createState() =>
      _ChileSeismicObservationsPanelState();
}
final class _ChileSeismicObservationsPanelState
    extends State<ChileSeismicObservationsPanel> {
  late Future<ChileSeismicObservations> _load;
  bool _expanded = false;

  @override
  void initState() {
    super.initState();
    _load = widget.repository.loadChileSeismicObservations(refresh: true);
  }

  void _refresh() {
    setState(() {
      _expanded = false;
      _load = widget.repository.loadChileSeismicObservations(refresh: true);
    });
  }

  @override
  Widget build(BuildContext context) => Card(
    key: const Key('chile-usgs-real-observations'),
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              const Icon(Icons.public_outlined, size: 23),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Observaciones sísmicas · Chile',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              IconButton(
                tooltip: 'Actualizar observaciones oficiales',
                onPressed: _refresh,
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'Datos oficiales del USGS · No son artículos de prensa ni alertas de emergencia. Las magnitudes pueden corregirse.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 12),
          FutureBuilder<ChileSeismicObservations>(
            future: _load,
            builder: (
              BuildContext context,
              AsyncSnapshot<ChileSeismicObservations> snapshot,
            ) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const LinearProgressIndicator();
              }
              if (snapshot.hasError || !snapshot.hasData) {
                return TextButton.icon(
                  onPressed: _refresh,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Reintentar datos sísmicos'),
                );
              }
              final ChileSeismicObservations data = snapshot.data!;
              if (data.items.isEmpty) {
                return const Text(
                  'No hay observaciones etiquetadas como Chile en la última semana del USGS.',
                );
              }
              final List<SeismicObservation> shown = _expanded
                  ? data.items
                  : data.items.take(5).toList(growable: false);
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    '${data.items.length} registros oficiales · consultado ${_formatLocal(data.inspectedAt)}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 8),
                  for (final SeismicObservation item in shown)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            'M ${item.magnitude.toStringAsFixed(1)} · ${item.description}',
                            style: Theme.of(context).textTheme.titleSmall,
                          ),
                          const SizedBox(height: 3),
                          Text(
                            '${_formatLocal(item.occurredAt)} · USGS ${item.status == 'reviewed' ? 'revisado' : 'automático, preliminar'}',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                          LiveExternalAction(
                            uri: item.canonicalUrl,
                            opener: openExternalHttpLink,
                            label: 'Ver observación original',
                          ),
                        ],
                      ),
                    ),
                  if (data.items.length > 5)
                    TextButton(
                      onPressed: () => setState(() => _expanded = !_expanded),
                      child: Text(
                        _expanded
                            ? 'Mostrar menos'
                            : 'Ver ${data.items.length} registros oficiales',
                      ),
                    ),
                  const SizedBox(height: 8),
                  Text(
                    'Fuente: U.S. Geological Survey · Una observación por identificador original. No se infieren contradicciones.',
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

  String _formatLocal(DateTime date) {
    final DateTime local = date.toLocal();
    String two(int value) => value.toString().padLeft(2, '0');
    return '${two(local.day)}/${two(local.month)}/${local.year} ${two(local.hour)}:${two(local.minute)}';
  }
}
