import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/live/data/chile_seismic_observations.dart';
import 'package:dialektik/features/live/presentation/live_components.dart';
import 'package:flutter/material.dart';

/// Secondary, collapsible official data rather than a second full news feed.
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
  bool _showAll = false;

  @override
  void initState() {
    super.initState();
    _load = widget.repository.loadChileSeismicObservations(refresh: true);
  }

  void _refresh() {
    setState(() {
      _showAll = false;
      _load = widget.repository.loadChileSeismicObservations(refresh: true);
    });
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<ChileSeismicObservations>(
    future: _load,
    builder: (
      BuildContext context,
      AsyncSnapshot<ChileSeismicObservations> snapshot,
    ) {
      final bool pending = snapshot.connectionState != ConnectionState.done;
      final ChileSeismicObservations? data = snapshot.data;
      final String subtitle = pending
          ? 'USGS · Consultando observaciones'
          : snapshot.hasError || data == null
              ? 'USGS · Consulta no disponible'
              : '${data.items.length} registros oficiales · USGS';
      return Card(
        key: const Key('chile-usgs-real-observations'),
        clipBehavior: Clip.antiAlias,
        child: ExpansionTile(
          key: const Key('chile-usgs-expand'),
          initiallyExpanded: false,
          leading: const Icon(Icons.waves_outlined),
          title: Text(
            'Actividad sísmica',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          subtitle: Text(
            subtitle,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          expandedCrossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              'Observaciones del U.S. Geological Survey. No son noticias ni alertas de emergencia.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: _refresh,
                icon: const Icon(Icons.refresh, size: 18),
                label: const Text('Actualizar sismos'),
              ),
            ),
            if (pending)
              const LinearProgressIndicator()
            else if (snapshot.hasError || data == null)
              const Text('No fue posible consultar el origen oficial.')
            else if (data.items.isEmpty)
              const Text('Sin registros recientes etiquetados como Chile.')
            else ...<Widget>[
              for (final SeismicObservation item in (_showAll
                  ? data.items
                  : data.items.take(3)))
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        'M ${item.magnitude.toStringAsFixed(1)} · ${item.description}',
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${_formatLocal(item.occurredAt)} · USGS ${item.status == 'reviewed' ? 'revisado' : 'automático'}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      LiveExternalAction(
                        uri: item.canonicalUrl,
                        opener: openExternalHttpLink,
                        label: 'Ver registro original',
                      ),
                    ],
                  ),
                ),
              if (data.items.length > 3)
                TextButton(
                  onPressed: () => setState(() => _showAll = !_showAll),
                  child: Text(
                    _showAll ? 'Ver menos' : 'Mostrar todos los sismos',
                  ),
                ),
              Text(
                'Cada sismo conserva el ID original del USGS. No se infieren contradicciones.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ],
        ),
      );
    },
  );

  String _formatLocal(DateTime date) {
    final DateTime value = date.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(value.day)}/${two(value.month)}/${value.year} '
        '${two(value.hour)}:${two(value.minute)}';
  }
}
