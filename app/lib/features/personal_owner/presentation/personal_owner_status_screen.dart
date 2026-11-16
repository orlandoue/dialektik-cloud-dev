import 'package:dialektik/features/personal_owner/data/personal_owner_status.dart';
import 'package:dialektik/features/personal_owner/data/personal_owner_status_client.dart';
import 'package:flutter/material.dart';

final class PersonalOwnerStatusScreen extends StatefulWidget {
  const PersonalOwnerStatusScreen({
    required this.repository,
    this.onOpenTestShadow,
    this.onOpenOperations,
    this.onReturnToConsumer,
    super.key,
  });

  final PersonalOwnerStatusRepository repository;
  final VoidCallback? onOpenTestShadow;
  final ValueChanged<String>? onOpenOperations;
  final VoidCallback? onReturnToConsumer;

  @override
  State<PersonalOwnerStatusScreen> createState() =>
      _PersonalOwnerStatusScreenState();
}

final class _PersonalOwnerStatusScreenState
    extends State<PersonalOwnerStatusScreen> {
  final TextEditingController _tokenController = TextEditingController();
  bool _loading = false;
  String? _error;
  PersonalOwnerStatusDto? _status;
  String? _sessionOwnerToken;

  @override
  void dispose() {
    _tokenController.clear();
    _tokenController.dispose();
    super.dispose();
  }

  Future<void> _loadStatus() async {
    final String token = _tokenController.text.trim();
    _tokenController.clear();
    FocusScope.of(context).unfocus();
    setState(() {
      _loading = true;
      _error = null;
      _status = null;
    });
    try {
      final PersonalOwnerStatusDto status = await widget.repository.getStatus(
        token,
      );
      if (mounted) {
        setState(() {
          _status = status;
          _sessionOwnerToken = token;
        });
      }
    } on PersonalOwnerStatusFailure {
      if (mounted) {
        setState(
          () => _error =
              'No se pudo autenticar o consultar el estado local. Verifica el servicio y vuelve a intentarlo.',
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Administración · estado local'),
      actions: <Widget>[
        if (widget.onReturnToConsumer case final VoidCallback onReturn)
          IconButton(
            onPressed: onReturn,
            tooltip: 'Volver a Actualidad',
            icon: const Icon(Icons.home_outlined),
          ),
      ],
    ),
    body: ListView(
      padding: const EdgeInsets.all(24),
      children: <Widget>[
        const Text(
          'Panel local de configuración. Consultar este estado no ejecuta inferencia, no activa permisos y no cambia LIVE.',
        ),
        if (widget.onOpenTestShadow
            case final VoidCallback openTestShadow) ...<Widget>[
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: openTestShadow,
            icon: const Icon(Icons.science_outlined),
            label: const Text('Flujo sintético de semantic shadow'),
          ),
        ],
        const SizedBox(height: 20),
        TextField(
          controller: _tokenController,
          obscureText: true,
          enableSuggestions: false,
          autocorrect: false,
          keyboardType: TextInputType.visiblePassword,
          decoration: const InputDecoration(
            labelText: 'Credencial local del responsable',
            helperText:
                'Se usa una vez en memoria y se limpia del campo. No se guarda en la app.',
          ),
          onSubmitted: (_) => _loading ? null : _loadStatus(),
        ),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: _loading ? null : _loadStatus,
          child: Text(_loading ? 'Consultando…' : 'Consultar estado local'),
        ),
        if (_error case final String error) ...<Widget>[
          const SizedBox(height: 16),
          Text(
            error,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ],
        if (_status case final PersonalOwnerStatusDto status) ...<Widget>[
          const SizedBox(height: 24),
          _StatusLine(label: 'Modo', value: status.ownershipMode),
          _StatusLine(label: 'Responsable', value: status.ownerIdentity),
          _StatusLine(label: 'Perfil', value: status.deployment),
          _StatusLine(
            label: 'Proveedor configurado',
            value: '${status.selectedProvider} / ${status.selectedModel}',
          ),
          _StatusLine(
            label: 'Transporte Cloudflare',
            value: status.cloudflareTransport,
          ),
          _StatusLine(
            label: 'Job Cloudflare general',
            value: status.generalCloudflareJob,
          ),
          _StatusLine(
            label: 'Procesamiento de artículos',
            value: status.articleProcessing,
          ),
          _StatusLine(
            label: 'Persistencia SHADOW derivada',
            value: status.derivedShadowPersistence,
          ),
          _StatusLine(label: 'LIVE', value: status.liveAssignment),
          _StatusLine(
            label: 'Ejecuciones V10.11 / Final Holdout V2',
            value:
                '${status.v10_11Executions} / ${status.finalHoldoutV2Executions}',
          ),
          const Padding(
            padding: EdgeInsets.only(top: 12),
            child: Text(
              'Este panel informa estado; no crea grants ni inicia trabajos de inferencia.',
            ),
          ),
          if (widget.onOpenOperations
              case final ValueChanged<String> openOperations)
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: FilledButton.icon(
                onPressed: _sessionOwnerToken == null
                    ? null
                    : () => openOperations(_sessionOwnerToken!),
                icon: const Icon(Icons.dashboard_outlined),
                label: const Text('Abrir flujo operativo personal'),
              ),
            ),
        ],
      ],
    ),
  );
}

final class _StatusLine extends StatelessWidget {
  const _StatusLine({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 5),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        SizedBox(width: 190, child: Text(label)),
        Expanded(child: SelectableText(value)),
      ],
    ),
  );
}
