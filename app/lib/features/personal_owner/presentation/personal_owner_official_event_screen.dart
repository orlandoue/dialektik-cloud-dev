import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/live/presentation/live_components.dart';
import 'package:dialektik/features/semantic/presentation/editorial_components.dart';
import 'package:flutter/material.dart';

typedef OfficialEventRecord = Map<String, Object?>;

OfficialEventRecord _object(Object? value) =>
    value is Map<String, Object?> ? value : <String, Object?>{};

String _value(Object? value, [String fallback = 'No indicado por la fuente']) =>
    value is String && value.isNotEmpty ? value : fallback;

String _total(Object? value) => value is num ? value.toString() : 'No indicado';

final class PersonalOwnerOfficialEventScreen extends StatelessWidget {
  const PersonalOwnerOfficialEventScreen({
    required this.record,
    required this.externalLinkOpener,
    this.navigationActions = const <Widget>[],
    super.key,
  });

  final OfficialEventRecord? record;
  final ExternalLinkOpener externalLinkOpener;
  final List<Widget> navigationActions;

  @override
  Widget build(BuildContext context) {
    final OfficialEventRecord item = _object(record);
    final OfficialEventRecord occurrence = _object(item['occurrence']);
    final OfficialEventRecord evidence = _object(item['evidence']);
    final OfficialEventRecord totals = _object(evidence['totals']);
    final OfficialEventRecord thread = _object(item['thread']);
    final OfficialEventRecord provenance = _object(item['provenance']);
    final String sourceRecordUrl = _value(evidence['source_record_url'], '');
    final Uri? sourceUri = Uri.tryParse(sourceRecordUrl);
    final bool validSourceUri =
        sourceUri != null &&
        sourceUri.scheme == 'https' &&
        sourceUri.host == 'opendata.camara.cl';

    return LiveReaderScaffold(
      title: 'Acontecimiento oficial',
      location: 'Acontecimientos',
      navigationActions: navigationActions,
      child: record == null
          ? const EditorialEmptyState(
              title: 'Abre el registro desde Administración.',
              description:
                  'Los datos oficiales se consultan dentro de la sesión local autorizada.',
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  'Votación de la Cámara de Diputadas y Diputados',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: DialektikSpacing.space3),
                Text(_value(evidence['description'])),
                const SizedBox(height: DialektikSpacing.space6),
                Text('Fuente · ${_value(evidence['source_name'])}'),
                const SizedBox(height: DialektikSpacing.space2),
                Text(
                  'Fecha indicada por la fuente · ${_value(occurrence['source_date_raw'])}',
                ),
                const SizedBox(height: DialektikSpacing.space2),
                Text(
                  'La fecha se conserva en el formato original; la fuente no indica zona horaria.',
                ),
                const SizedBox(height: DialektikSpacing.space6),
                const SectionHeading(
                  title: 'Resultado informado por la fuente',
                ),
                Wrap(
                  spacing: DialektikSpacing.space6,
                  runSpacing: DialektikSpacing.space3,
                  children: <Widget>[
                    Text('Sí · ${_total(totals['yes'])}'),
                    Text('No · ${_total(totals['no'])}'),
                    Text('Abstención · ${_total(totals['abstention'])}'),
                    Text('Dispensados · ${_total(totals['excused'])}'),
                  ],
                ),
                if (evidence['result'] is String) ...<Widget>[
                  const SizedBox(height: DialektikSpacing.space3),
                  Text('Resultado · ${_value(evidence['result'])}'),
                ],
                const SizedBox(height: EditorialLayout.sectionGap),
                const SectionHeading(title: 'Identidad del acontecimiento'),
                Text(
                  'Occurrence · ${_value(occurrence['kind'])}',
                  semanticsLabel:
                      'Tipo de acontecimiento: ${_value(occurrence['kind'])}',
                ),
                const SizedBox(height: DialektikSpacing.space3),
                const Text(
                  'La identidad procede del registro de votación de la fuente; el identificador de un boletín no se usa como identidad del acontecimiento.',
                ),
                const SizedBox(height: DialektikSpacing.space6),
                const SectionHeading(title: 'Historia relacionada'),
                Text(
                  _value(thread['decision']) == 'UNKNOWN'
                      ? 'Sin historia asociada · relación aún desconocida'
                      : 'Estado de relación · ${_value(thread['decision'])}',
                ),
                const SizedBox(height: DialektikSpacing.space3),
                const Text(
                  'No se ha establecido una relación con otras votaciones o publicaciones.',
                ),
                const SizedBox(height: EditorialLayout.sectionGap),
                if (validSourceUri)
                  LiveExternalAction(
                    uri: sourceUri,
                    opener: externalLinkOpener,
                    label: 'Abrir registro original de la Cámara',
                  )
                else
                  const Text(
                    'El enlace al registro original no está disponible.',
                  ),
                const SizedBox(height: DialektikSpacing.space3),
                const Text(
                  'La Cámara es la fuente de este registro. Dialektik no lo presenta como verificación independiente.',
                ),
                LiveTechnicalDetails(
                  title: 'Procedencia técnica',
                  disclosureKey: const PageStorageKey<String>(
                    'official-vote-technical-provenance',
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      LiveDetailLine(
                        'ID de votación en la fuente',
                        _value(occurrence['source_record_id']),
                      ),
                      LiveDetailLine(
                        'Base de identidad',
                        _value(occurrence['identity_basis']),
                      ),
                      LiveDetailLine(
                        'Captura de evidencia',
                        _value(evidence['fetched_at']),
                      ),
                      LiveDetailLine(
                        'Método de adquisición',
                        _value(provenance['acquisition_method']),
                      ),
                      LiveDetailLine(
                        'Versión del adaptador',
                        _value(provenance['adapter_version']),
                      ),
                      LiveDetailLine(
                        'SHA-256 de evidencia',
                        _value(evidence['response_sha256']),
                      ),
                      LiveDetailLine(
                        'Corroboración independiente',
                        _value(provenance['independent_corroboration']),
                      ),
                    ],
                  ),
                ),
              ],
            ),
    );
  }
}
