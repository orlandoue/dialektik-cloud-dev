import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/personal_owner/data/personal_owner_operational.dart';
import 'package:flutter/material.dart';

typedef _Json = Map<String, Object?>;

_Json _json(Object? value) =>
    value is Map<String, Object?> ? value : <String, Object?>{};
List<Object?> _asList(Object? value) =>
    value is List<Object?> ? value : <Object?>[];
String _text(Object? value, [String fallback = '—']) =>
    value is String && value.isNotEmpty
    ? value
    : value is num
    ? value.toString()
    : fallback;

final class PersonalOwnerOperationalScreen extends StatefulWidget {
  const PersonalOwnerOperationalScreen({
    required this.repository,
    this.initialOwnerToken,
    this.externalLinkOpener = openExternalHttpLink,
    this.onReturnToConsumer,
    this.onOpenOfficialEvent,
    super.key,
  });

  final PersonalOwnerOperationalRepository repository;
  final String? initialOwnerToken;
  final ExternalLinkOpener externalLinkOpener;
  final VoidCallback? onReturnToConsumer;
  final ValueChanged<OwnerJson>? onOpenOfficialEvent;

  @override
  State<PersonalOwnerOperationalScreen> createState() =>
      _PersonalOwnerOperationalScreenState();
}

final class _PersonalOwnerOperationalScreenState
    extends State<PersonalOwnerOperationalScreen>
    with SingleTickerProviderStateMixin {
  final TextEditingController _tokenController = TextEditingController();
  final TextEditingController _voteIdController = TextEditingController(
    text: '90329',
  );
  late final TabController _tabs = TabController(length: 5, vsync: this);
  String? _token;
  String? _error;
  bool _loading = false;
  List<_Json> _sources = <_Json>[];
  List<_Json> _articles = <_Json>[];
  List<_Json> _officialVoteEvents = <_Json>[];
  List<_Json> _jobs = <_Json>[];
  _Json? _budget;

  @override
  void initState() {
    super.initState();
    final String? supplied = widget.initialOwnerToken;
    if (supplied != null && supplied.isNotEmpty) {
      _token = supplied;
      WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
    }
  }

  @override
  void dispose() {
    _tokenController.clear();
    _tokenController.dispose();
    _voteIdController.dispose();
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    final String token = _tokenController.text.trim();
    _tokenController.clear();
    FocusScope.of(context).unfocus();
    if (!RegExp(r'^[A-Za-z0-9._~-]{32,2048}$').hasMatch(token)) {
      setState(() => _error = 'Ingresa una credencial local válida.');
      return;
    }
    setState(() {
      _token = token;
      _error = null;
    });
    await _refresh();
  }

  Future<void> _refresh() async {
    final String? token = _token;
    if (token == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final List<_Json> sources = await widget.repository.sources(token);
      final List<_Json> articles = await widget.repository.articles(token);
      final List<_Json> officialVoteEvents = await widget.repository
          .officialVoteEvents(token);
      final _Json budget = await widget.repository.budget(token);
      final List<_Json> jobs = await widget.repository.jobs(token);
      if (mounted) {
        setState(() {
          _sources = sources;
          _articles = articles;
          _officialVoteEvents = officialVoteEvents;
          _budget = budget;
          _jobs = jobs;
        });
      }
    } on PersonalOwnerOperationalFailure catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'No se pudo consultar el estado local.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _acquireOfficialVote() async {
    final String? token = _token;
    final String voteId = _voteIdController.text.trim();
    _Json? source;
    for (final _Json candidate in _sources) {
      final _Json rights = _json(candidate['rights']);
      if (candidate['domain'] == 'opendata.camara.cl' &&
          candidate['authorization'] == 'AUTHORIZED' &&
          rights['acquisition'] == true &&
          rights['derived_semantic_persistence'] == true &&
          rights['local_processing'] == true) {
        source = candidate;
        break;
      }
    }
    final String? sourceId = source?['id'] as String?;
    if (token == null || sourceId == null) {
      _message(
        'Registra la fuente de datos abiertos de la Cámara y una autorización vigente para API oficial, procesamiento local y persistencia semántica.',
      );
      return;
    }
    if (!RegExp(r'^\d{1,12}$').hasMatch(voteId)) {
      _message('Ingresa un ID de votación oficial numérico.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await widget.repository.acquireOfficialVoteEvent(token, sourceId, voteId);
      await _refresh();
      if (mounted) {
        _tabs.animateTo(2);
        _message('Registro oficial adquirido con evidencia y procedencia.');
      }
    } on PersonalOwnerOperationalFailure catch (error) {
      if (mounted) _message(error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _message(String value) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }

  Future<void> _openOriginalSource(_Json article) async {
    final String rawUrl = _text(article['canonical_url'], '');
    final String domain = _text(article['domain'], '').toLowerCase();
    final Uri? uri = Uri.tryParse(rawUrl);
    if (uri == null ||
        !const <String>{'http', 'https'}.contains(uri.scheme) ||
        (uri.host.toLowerCase() != domain &&
            !uri.host.toLowerCase().endsWith('.$domain'))) {
      _message('El enlace original no está disponible para este Article.');
      return;
    }
    try {
      final bool opened = await widget.externalLinkOpener(uri);
      if (!opened && mounted) {
        _message('No se pudo abrir el enlace original.');
      }
    } catch (_) {
      if (mounted) _message('No se pudo abrir el enlace original.');
    }
  }

  Future<void> _openOfficialVoteSource(_Json evidence) async {
    final Uri? uri = Uri.tryParse(_text(evidence['source_record_url'], ''));
    if (uri == null ||
        uri.scheme != 'https' ||
        uri.host != 'opendata.camara.cl') {
      _message('El enlace del registro oficial no es válido.');
      return;
    }
    try {
      final bool opened = await widget.externalLinkOpener(uri);
      if (!opened && mounted) _message('No se pudo abrir el registro oficial.');
    } catch (_) {
      if (mounted) _message('No se pudo abrir el registro oficial.');
    }
  }

  Future<void> _registerSource() async {
    final String? token = _token;
    if (token == null) return;
    final TextEditingController name = TextEditingController();
    final TextEditingController domain = TextEditingController();
    String sourceType = 'other';
    final _Json? result = await showDialog<_Json>(
      context: context,
      builder: (BuildContext context) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setDialogState) =>
            AlertDialog(
              title: const Text('Registrar publisher'),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  TextField(
                    controller: name,
                    decoration: const InputDecoration(labelText: 'Nombre'),
                  ),
                  TextField(
                    controller: domain,
                    decoration: const InputDecoration(
                      labelText: 'Dominio canónico',
                    ),
                  ),
                  DropdownButtonFormField<String>(
                    initialValue: sourceType,
                    decoration: const InputDecoration(
                      labelText: 'Tipo de fuente',
                    ),
                    items: const <DropdownMenuItem<String>>[
                      DropdownMenuItem(value: 'other', child: Text('Otra')),
                      DropdownMenuItem(
                        value: 'daily_newspaper',
                        child: Text('Diario'),
                      ),
                      DropdownMenuItem(
                        value: 'official_statistics',
                        child: Text('Datos oficiales'),
                      ),
                      DropdownMenuItem(
                        value: 'wire_agency',
                        child: Text('Agencia de noticias'),
                      ),
                    ],
                    onChanged: (String? value) =>
                        setDialogState(() => sourceType = value ?? sourceType),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'El registro queda UNVERIFIED y no habilita adquisición.',
                  ),
                ],
              ),
              actions: <Widget>[
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Cancelar'),
                ),
                FilledButton(
                  onPressed: () => Navigator.pop(context, <String, Object?>{
                    'publisher_name': name.text,
                    'canonical_domain': domain.text,
                    'source_type': sourceType,
                  }),
                  child: const Text('Registrar'),
                ),
              ],
            ),
      ),
    );
    name.dispose();
    domain.dispose();
    if (result == null) return;
    try {
      await widget.repository.registerSource(token, result);
      await _refresh();
    } on PersonalOwnerOperationalFailure catch (error) {
      _message(error.message);
    }
  }

  Future<void> _recordRights(_Json source) async {
    final String? token = _token;
    final String? sourceId = source['id'] as String?;
    if (token == null || sourceId == null) return;
    final _Json? decision = await showDialog<_Json>(
      context: context,
      builder: (BuildContext context) =>
          _RightsDecisionDialog(publisher: _text(source['publisher'])),
    );
    if (decision == null) return;
    try {
      await widget.repository.recordRightsDecision(token, sourceId, decision);
      await _refresh();
    } on PersonalOwnerOperationalFailure catch (error) {
      _message(error.message);
    }
  }

  Future<void> _configureSourceConnection(_Json source) async {
    final String? token = _token;
    final String? sourceId = source['id'] as String?;
    if (token == null || sourceId == null) return;
    final TextEditingController endpoint = TextEditingController(
      text: _text(source['acquisition_endpoint'], ''),
    );
    final TextEditingController domains = TextEditingController(
      text: _text(source['domain'], ''),
    );
    final _Json? values = await showDialog<_Json>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        title: const Text('Conectar fuente RSS / Atom'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              TextField(
                controller: endpoint,
                keyboardType: TextInputType.url,
                decoration: const InputDecoration(
                  labelText: 'URL HTTPS del feed',
                ),
              ),
              TextField(
                controller: domains,
                decoration: const InputDecoration(
                  labelText: 'Dominios de Articles permitidos',
                  helperText:
                      'Separados por coma; deben pertenecer al publisher.',
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Registrar la conexión no activa adquisición externa. El modo de adquisición sigue sujeto a permisos y configuración local.',
              ),
            ],
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, <String, Object?>{
              'rss_atom_endpoint': endpoint.text.trim(),
              'allowed_article_domains': domains.text
                  .split(RegExp(r'[,\s]+'))
                  .map((String value) => value.trim().toLowerCase())
                  .where((String value) => value.isNotEmpty)
                  .toList(growable: false),
            }),
            child: const Text('Guardar conexión'),
          ),
        ],
      ),
    );
    endpoint.dispose();
    domains.dispose();
    if (values == null) return;
    try {
      await widget.repository.recordSourceConnection(token, sourceId, values);
      await _refresh();
      _message(
        'Conexión RSS registrada; adquisición externa permanece sujeta a activación.',
      );
    } on PersonalOwnerOperationalFailure catch (error) {
      _message(error.message);
    }
  }

  Future<void> _acquireSource(_Json source) async {
    final String? token = _token;
    final String? sourceId = source['id'] as String?;
    if (token == null || sourceId == null) return;
    final bool confirmed =
        await showDialog<bool>(
          context: context,
          builder: (BuildContext context) => AlertDialog(
            title: const Text('Adquirir metadatos del feed'),
            content: const Text(
              'Core consultará el feed configurado y persistirá solo los campos permitidos por los derechos registrados. La adquisición externa requiere activación explícita.',
            ),
            actions: <Widget>[
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Cancelar'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Continuar'),
              ),
            ],
          ),
        ) ??
        false;
    if (!confirmed) return;
    try {
      final _Json result = await widget.repository.acquireSource(
        token,
        sourceId,
      );
      final _Json acquisition = _json(result['acquisition']);
      _message(
        'Adquisición registrada · ${_text(acquisition['itemsDiscovered'], 'ver estado')} items detectados.',
      );
      await _refresh();
      _tabs.animateTo(1);
    } on PersonalOwnerOperationalFailure catch (error) {
      _message(error.message);
    }
  }

  Future<void> _requestProcessing(_Json article) async {
    final String? token = _token;
    final String? articleId = article['id'] as String?;
    final _Json version = _json(article['version']);
    final String? versionId = version['observed_content_version_id'] as String?;
    if (token == null || articleId == null || versionId == null) {
      _message(
        'No hay una versión de contenido completo autorizada para este Article.',
      );
      return;
    }
    final String key =
        'app-${DateTime.now().microsecondsSinceEpoch}-$articleId';
    try {
      final _Json result = await widget.repository.submitJob(
        token,
        articleId,
        <String, Object?>{
          'article_version_id': versionId,
          'idempotency_key': key,
        },
      );
      final _Json job = _json(result['job']);
      final String state = _text(job['state']);
      final String reason = _text(job['blocked_reason'], 'Job creado.');
      _message('$state · $reason');
      await _refresh();
      _tabs.animateTo(2);
    } on PersonalOwnerOperationalFailure catch (error) {
      _message(error.message);
    }
  }

  Future<void> _openJob(_Json jobSummary) async {
    final String? token = _token;
    final String? id = jobSummary['id'] as String?;
    if (token == null || id == null) return;
    try {
      final _Json response = await widget.repository.job(token, id);
      if (!mounted) return;
      final _Json job = _json(response['job']);
      final List<Object?> events = response['events'] is List<Object?>
          ? response['events']! as List<Object?>
          : <Object?>[];
      final List<Object?> observations =
          response['observations'] is List<Object?>
          ? response['observations']! as List<Object?>
          : <Object?>[];
      final _Json providerAttempt = _json(response['provider_attempt']);
      final _Json reservation = _json(response['budget_reservation']);
      await showDialog<void>(
        context: context,
        builder: (BuildContext context) => AlertDialog(
          title: Text('Job ${_text(job['state'])}'),
          content: SizedBox(
            width: 520,
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  _line('Article', _text(job['article_id'])),
                  _line('Versión', _text(job['article_version_id'])),
                  _line('Estado', _text(job['state'])),
                  _line('Bloqueo', _text(job['blocked_reason'], 'Ninguno')),
                  _line(
                    'Intento proveedor',
                    _text(providerAttempt['state'], 'Sin intento'),
                  ),
                  _line('Reserva', _text(reservation['state'], 'Sin reserva')),
                  if (reservation['reserved_microusd'] != null)
                    _line(
                      'Estimación reservada',
                      '${reservation['reserved_microusd']} micro USD',
                    ),
                  if (response['billing_reconciliation'] == 'OWNER_RECORDED')
                    const Text(
                      'Reconciliación de facturación registrada por el responsable; la evidencia no fue verificada automáticamente.',
                    ),
                  const Divider(),
                  const Text('Historial persistido'),
                  for (final Object? event in events)
                    Text(
                      '${_text(_json(event)['state'])} · ${_text(_json(event)['error_category'], '')}',
                    ),
                  const Divider(),
                  const Text('Observaciones semánticas de sombra'),
                  if (observations.isEmpty)
                    const Text('Aún no hay observaciones para esta versión.'),
                  for (final Object? observation in observations)
                    _observationCard(_json(observation)),
                ],
              ),
            ),
          ),
          actions: <Widget>[
            if (job['state'] == 'PENDING' || job['state'] == 'RUNNING')
              TextButton(
                onPressed: () async {
                  Navigator.pop(context);
                  await _cancelJob(id);
                },
                child: const Text('Cancelar'),
              ),
            if (reservation['state'] == 'RECONCILIATION_REQUIRED')
              TextButton(
                onPressed: () async {
                  Navigator.pop(context);
                  await _reconcileJob(id);
                },
                child: const Text('Reconciliar facturación'),
              ),
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cerrar'),
            ),
          ],
        ),
      );
    } on PersonalOwnerOperationalFailure catch (error) {
      _message(error.message);
    }
  }

  Widget _observationCard(_Json observation) {
    final List<Object?> evidence = observation['evidence'] is List<Object?>
        ? observation['evidence']! as List<Object?>
        : <Object?>[];
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              '${_text(observation['observation_key'])} · ${_text(observation['decision'])}',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            _line('Aplicabilidad', _text(observation['applicability'])),
            _line('Autoridad', _text(observation['authority'])),
            _line(
              'Provider / schema',
              '${_text(observation['provider_type'])} · ${_text(observation['provider_version'])}',
            ),
            _line(
              'Modo de contenido',
              _text(observation['content_access_mode']),
            ),
            _line('Procesado', _text(observation['processed_at'])),
            if (observation['proposed_occurrence_key'] != null)
              _line(
                'Asociación Occurrence propuesta',
                _text(observation['proposed_occurrence_key']),
              ),
            if (observation['proposed_thread_key'] != null)
              _line(
                'Asociación Thread propuesta',
                _text(observation['proposed_thread_key']),
              ),
            for (final Object? rawEvidence in evidence)
              Text(
                'Evidencia ${_text(_json(rawEvidence)['field'])} · span ${_text(_json(rawEvidence)['span_start'])}–${_text(_json(rawEvidence)['span_end'])} · hash ${_text(_json(rawEvidence)['span_hash'])}',
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _cancelJob(String jobId) async {
    final String? token = _token;
    if (token == null) return;
    try {
      final _Json result = await widget.repository.cancelJob(token, jobId);
      final bool uncertain =
          result['provider_outcome_may_require_reconciliation'] == true;
      _message(
        uncertain
            ? 'Cancelación solicitada; el resultado del proveedor puede requerir reconciliación.'
            : 'Trabajo cancelado antes del intento al proveedor.',
      );
      await _refresh();
    } on PersonalOwnerOperationalFailure catch (error) {
      _message(error.message);
    }
  }

  Future<void> _reconcileJob(String jobId) async {
    final String? token = _token;
    if (token == null) return;
    final TextEditingController url = TextEditingController();
    final TextEditingController hash = TextEditingController();
    final TextEditingController actual = TextEditingController();
    String outcome = 'NOT_CHARGED';
    final _Json? values = await showDialog<_Json>(
      context: context,
      builder: (BuildContext context) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setDialogState) => AlertDialog(
          title: const Text('Reconciliar facturación'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                DropdownButtonFormField<String>(
                  initialValue: outcome,
                  decoration: const InputDecoration(labelText: 'Resultado'),
                  items: const <DropdownMenuItem<String>>[
                    DropdownMenuItem(
                      value: 'NOT_CHARGED',
                      child: Text('Sin cargo'),
                    ),
                    DropdownMenuItem(
                      value: 'CHARGED',
                      child: Text('Cargo confirmado'),
                    ),
                  ],
                  onChanged: (String? value) =>
                      setDialogState(() => outcome = value ?? outcome),
                ),
                if (outcome == 'CHARGED')
                  TextField(
                    controller: actual,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Cargo real (micro USD)',
                    ),
                  ),
                TextField(
                  controller: url,
                  keyboardType: TextInputType.url,
                  decoration: const InputDecoration(
                    labelText: 'URL HTTPS de evidencia',
                  ),
                ),
                TextField(
                  controller: hash,
                  decoration: const InputDecoration(
                    labelText: 'SHA-256 de evidencia',
                  ),
                ),
                const Text(
                  'El responsable registra el resultado. Core no verifica automáticamente el comprobante.',
                ),
              ],
            ),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, <String, Object?>{
                'outcome': outcome,
                'evidence_url': url.text.trim(),
                'evidence_sha256': hash.text.trim(),
                if (outcome == 'CHARGED')
                  'actual_microusd': int.tryParse(actual.text),
              }),
              child: const Text('Registrar'),
            ),
          ],
        ),
      ),
    );
    url.dispose();
    hash.dispose();
    actual.dispose();
    if (values == null) return;
    try {
      await widget.repository.reconcileJob(token, jobId, values);
      _message('Reconciliación registrada por el responsable.');
      await _refresh();
    } on PersonalOwnerOperationalFailure catch (error) {
      _message(error.message);
    }
  }

  Future<void> _configureBudget() async {
    final String? token = _token;
    if (token == null) return;
    final _Json controls = _json(_json(_budget)['controls']);
    final TextEditingController request = TextEditingController(
      text: _dollars(controls['per_request_limit_microusd']),
    );
    final TextEditingController daily = TextEditingController(
      text: _dollars(controls['daily_limit_microusd']),
    );
    final TextEditingController total = TextEditingController(
      text: _dollars(controls['total_limit_microusd']),
    );
    final TextEditingController concurrency = TextEditingController(
      text: _text(controls['max_concurrency'], '1'),
    );
    final TextEditingController rate = TextEditingController(
      text: _text(controls['max_requests_per_minute'], '1'),
    );
    final _Json? values = await showDialog<_Json>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        title: const Text('Límites de gasto'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              _moneyField(request, 'Máximo por solicitud (USD)'),
              _moneyField(daily, 'Máximo diario (USD)'),
              _moneyField(total, 'Máximo total (USD)'),
              TextField(
                controller: concurrency,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Concurrencia máxima (1–8)',
                ),
              ),
              TextField(
                controller: rate,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Solicitudes por minuto (1–10)',
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Guardar límites no activa el proveedor; el presupuesto permanece deshabilitado y con emergencia detenida.',
              ),
            ],
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, <String, Object?>{
              'per_request_limit_microusd': _parseDollars(request.text),
              'daily_limit_microusd': _parseDollars(daily.text),
              'total_limit_microusd': _parseDollars(total.text),
              'max_concurrency': int.tryParse(concurrency.text),
              'max_requests_per_minute': int.tryParse(rate.text),
            }),
            child: const Text('Guardar límites'),
          ),
        ],
      ),
    );
    for (final TextEditingController item in <TextEditingController>[
      request,
      daily,
      total,
      concurrency,
      rate,
    ]) {
      item.dispose();
    }
    if (values == null) return;
    try {
      await widget.repository.configureBudget(token, values);
      await _refresh();
    } on PersonalOwnerOperationalFailure catch (error) {
      _message(error.message);
    } on FormatException {
      _message('Ingresa límites monetarios válidos con hasta seis decimales.');
    }
  }

  Future<void> _registerPrice() async {
    final String? token = _token;
    if (token == null) return;
    final TextEditingController model = TextEditingController(
      text: '@cf/openai/gpt-oss-20b',
    );
    final TextEditingController input = TextEditingController(text: '0');
    final TextEditingController output = TextEditingController(text: '0');
    final TextEditingController inputTokens = TextEditingController(
      text: '4096',
    );
    final TextEditingController outputTokens = TextEditingController(
      text: '4096',
    );
    final TextEditingController url = TextEditingController();
    final TextEditingController hash = TextEditingController();
    bool verified = false;
    final _Json? values = await showDialog<_Json>(
      context: context,
      builder: (BuildContext context) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setDialogState) =>
            AlertDialog(
              title: const Text('Registrar precio de modelo'),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    TextField(
                      controller: model,
                      decoration: const InputDecoration(
                        labelText: 'Modelo Cloudflare',
                      ),
                    ),
                    TextField(
                      controller: input,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Micro USD / 1.000 tokens de entrada',
                      ),
                    ),
                    TextField(
                      controller: output,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Micro USD / 1.000 tokens de salida',
                      ),
                    ),
                    TextField(
                      controller: inputTokens,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Máximo tokens de entrada',
                      ),
                    ),
                    TextField(
                      controller: outputTokens,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Máximo tokens de salida',
                      ),
                    ),
                    TextField(
                      controller: url,
                      decoration: const InputDecoration(
                        labelText: 'URL de evidencia HTTPS',
                      ),
                    ),
                    TextField(
                      controller: hash,
                      decoration: const InputDecoration(
                        labelText: 'SHA-256 de la evidencia',
                      ),
                    ),
                    CheckboxListTile(
                      value: verified,
                      onChanged: (bool? value) =>
                          setDialogState(() => verified = value ?? false),
                      title: const Text(
                        'Evidencia revisada por el responsable',
                      ),
                    ),
                  ],
                ),
              ),
              actions: <Widget>[
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Cancelar'),
                ),
                FilledButton(
                  onPressed: () => Navigator.pop(context, <String, Object?>{
                    'model_id': model.text,
                    'input_microusd_per_1k_tokens': int.tryParse(input.text),
                    'output_microusd_per_1k_tokens': int.tryParse(output.text),
                    'max_input_tokens': int.tryParse(inputTokens.text),
                    'max_output_tokens': int.tryParse(outputTokens.text),
                    'evidence_url': url.text,
                    'evidence_sha256': hash.text,
                    'decision_status': verified ? 'VERIFIED' : 'UNVERIFIED',
                  }),
                  child: const Text('Registrar'),
                ),
              ],
            ),
      ),
    );
    for (final TextEditingController item in <TextEditingController>[
      model,
      input,
      output,
      inputTokens,
      outputTokens,
      url,
      hash,
    ]) {
      item.dispose();
    }
    if (values == null) return;
    try {
      await widget.repository.recordModelPrice(token, values);
      await _refresh();
    } on PersonalOwnerOperationalFailure catch (error) {
      _message(error.message);
    }
  }

  Future<void> _registerProviderAuthorization() async {
    final String? token = _token;
    if (token == null) return;
    final TextEditingController model = TextEditingController(
      text: '@cf/openai/gpt-oss-20b',
    );
    final TextEditingController url = TextEditingController();
    final TextEditingController hash = TextEditingController();
    String status = 'UNVERIFIED';
    final _Json? values = await showDialog<_Json>(
      context: context,
      builder: (BuildContext context) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setDialogState) => AlertDialog(
          title: const Text('Autorización de proveedor y modelo'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                TextField(
                  controller: model,
                  decoration: const InputDecoration(
                    labelText: 'Modelo Cloudflare',
                  ),
                ),
                DropdownButtonFormField<String>(
                  initialValue: status,
                  decoration: const InputDecoration(labelText: 'Decisión'),
                  items: const <DropdownMenuItem<String>>[
                    DropdownMenuItem(
                      value: 'UNVERIFIED',
                      child: Text('Sin verificar'),
                    ),
                    DropdownMenuItem(
                      value: 'AUTHORIZED',
                      child: Text('Autorizado según evidencia'),
                    ),
                    DropdownMenuItem(
                      value: 'SUSPENDED',
                      child: Text('Suspendido'),
                    ),
                    DropdownMenuItem(value: 'REVOKED', child: Text('Revocado')),
                  ],
                  onChanged: (String? value) =>
                      setDialogState(() => status = value ?? status),
                ),
                if (status == 'AUTHORIZED') ...<Widget>[
                  TextField(
                    controller: url,
                    keyboardType: TextInputType.url,
                    decoration: const InputDecoration(
                      labelText: 'URL HTTPS de evidencia',
                    ),
                  ),
                  TextField(
                    controller: hash,
                    decoration: const InputDecoration(
                      labelText: 'SHA-256 de evidencia',
                    ),
                  ),
                ],
                const Text(
                  'La autorización se registra por separado. No activa llamadas externas ni reemplaza credenciales, precio verificado, presupuesto o configuración del operador.',
                ),
              ],
            ),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, <String, Object?>{
                'model_id': model.text.trim(),
                'decision_status': status,
                if (status == 'AUTHORIZED') 'evidence_url': url.text.trim(),
                if (status == 'AUTHORIZED') 'evidence_sha256': hash.text.trim(),
              }),
              child: const Text('Registrar decisión'),
            ),
          ],
        ),
      ),
    );
    model.dispose();
    url.dispose();
    hash.dispose();
    if (values == null) return;
    try {
      await widget.repository.recordProviderAuthorization(token, values);
      await _refresh();
    } on PersonalOwnerOperationalFailure catch (error) {
      _message(error.message);
    }
  }

  Future<void> _emergencyStop() async {
    final String? token = _token;
    if (token == null) return;
    try {
      await widget.repository.emergencyStop(token);
      await _refresh();
      _message('Emergencia detenida. El presupuesto está deshabilitado.');
    } on PersonalOwnerOperationalFailure catch (error) {
      _message(error.message);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Administración personal'),
      actions: <Widget>[
        if (widget.onReturnToConsumer case final VoidCallback onReturn)
          IconButton(
            onPressed: onReturn,
            tooltip: 'Volver a Actualidad',
            icon: const Icon(Icons.home_outlined),
          ),
        if (_token != null)
          IconButton(
            onPressed: _loading ? null : _refresh,
            tooltip: 'Actualizar',
            icon: const Icon(Icons.refresh),
          ),
      ],
      bottom: TabBar(
        controller: _tabs,
        isScrollable: true,
        tabs: const <Widget>[
          Tab(text: 'Fuentes'),
          Tab(text: 'Articles'),
          Tab(text: 'Eventos oficiales'),
          Tab(text: 'Jobs'),
          Tab(text: 'Presupuesto'),
        ],
      ),
    ),
    body: Column(
      children: <Widget>[
        if (_token == null) _loginCard(),
        if (_error case final String error)
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text(
              error,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        if (_loading) const LinearProgressIndicator(),
        Expanded(
          child: TabBarView(
            controller: _tabs,
            children: <Widget>[
              _sourceTab(),
              _articleTab(),
              _officialVoteTab(),
              _jobsTab(),
              _budgetTab(),
            ],
          ),
        ),
      ],
    ),
  );

  Widget _loginCard() => Card(
    margin: const EdgeInsets.all(16),
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const Text(
            'Conecta con Core local. La credencial solo permanece en memoria durante esta sesión; los permisos, Articles, trabajos y límites se recuperan desde PostgreSQL.',
          ),
          TextField(
            controller: _tokenController,
            obscureText: true,
            enableSuggestions: false,
            autocorrect: false,
            decoration: const InputDecoration(
              labelText: 'Credencial del responsable',
            ),
          ),
          const SizedBox(height: 8),
          FilledButton(
            onPressed: _loading ? null : _connect,
            child: const Text('Conectar'),
          ),
        ],
      ),
    ),
  );

  Widget _sourceTab() => ListView(
    padding: const EdgeInsets.all(12),
    children: <Widget>[
      Row(
        children: <Widget>[
          const Expanded(
            child: Text(
              'Registro de fuentes',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
            ),
          ),
          IconButton(
            onPressed: _token == null ? null : _registerSource,
            icon: const Icon(Icons.add),
            tooltip: 'Registrar source',
          ),
        ],
      ),
      const Text(
        'Los derechos de adquisición, almacenamiento, transmisión, persistencia semántica y redistribución se registran por separado.',
      ),
      for (final _Json source in _sources) _sourceCard(source),
      if (_sources.isEmpty)
        const Padding(
          padding: EdgeInsets.all(16),
          child: Text('No hay fuentes registradas en Core.'),
        ),
    ],
  );

  Widget _sourceCard(_Json source) {
    final _Json rights = _json(source['rights']);
    final List<String> enabled = rights.entries
        .where((MapEntry<String, Object?> item) => item.value == true)
        .map((MapEntry<String, Object?> item) => item.key)
        .toList(growable: false);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              _text(source['publisher']),
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            Text(
              '${_text(source['domain'])} · ${_text(source['authorization'])}',
            ),
            Text(
              'Adquisición: ${_text(source['acquisition_method'], 'sin autorización')}',
            ),
            Text(
              'Feed: ${_text(source['acquisition_endpoint'], 'sin conexión registrada')}',
            ),
            Text(
              'Scopes activos: ${enabled.isEmpty ? 'ninguno' : enabled.join(', ')}',
            ),
            if (source['evidence_url'] is String)
              SelectableText('Evidencia: ${source['evidence_url']}'),
            if (source['attribution'] is String)
              Text('Atribución: ${source['attribution']}'),
            Wrap(
              alignment: WrapAlignment.end,
              spacing: 8,
              children: <Widget>[
                TextButton.icon(
                  onPressed: _token == null
                      ? null
                      : () => _recordRights(source),
                  icon: const Icon(Icons.verified_user_outlined),
                  label: const Text('Derechos'),
                ),
                OutlinedButton.icon(
                  onPressed: _token == null
                      ? null
                      : () => _configureSourceConnection(source),
                  icon: const Icon(Icons.link),
                  label: const Text('Conectar feed'),
                ),
                FilledButton.tonalIcon(
                  onPressed:
                      _token == null || source['acquisition_endpoint'] == null
                      ? null
                      : () => _acquireSource(source),
                  icon: const Icon(Icons.download_outlined),
                  label: const Text('Adquirir'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _articleTab() => ListView(
    padding: const EdgeInsets.all(12),
    children: <Widget>[
      const Text(
        'Articles persistidos y su procedencia',
        style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
      ),
      for (final _Json article in _articles) _articleCard(article),
      if (_articles.isEmpty)
        const Padding(
          padding: EdgeInsets.all(16),
          child: Text('No hay Articles Live disponibles en el registro local.'),
        ),
    ],
  );

  Widget _officialVoteTab() => ListView(
    padding: const EdgeInsets.all(12),
    children: <Widget>[
      const Text(
        'Eventos oficiales · Cámara de Diputadas y Diputados',
        style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
      ),
      const SizedBox(height: 8),
      const Text(
        'Importación manual de un registro de votación pública. La Occurrence usa el ID propio del registro de votación; el boletín se conserva solo como descripción fuente. La fecha queda en el formato original, sin inferir zona horaria. El Thread queda UNKNOWN hasta contar con evidencia de relación.',
      ),
      const SizedBox(height: 12),
      Row(
        children: <Widget>[
          Expanded(
            child: TextField(
              controller: _voteIdController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'ID de votación de la Cámara',
                hintText: 'Ej. 90329',
              ),
            ),
          ),
          const SizedBox(width: 8),
          FilledButton.icon(
            onPressed: _loading || _token == null ? null : _acquireOfficialVote,
            icon: const Icon(Icons.download_outlined),
            label: const Text('Adquirir'),
          ),
        ],
      ),
      const SizedBox(height: 8),
      const Text(
        'La adquisición exige autorización vigente para esta API oficial. Solo se persisten descripción, fecha fuente, resultados agregados y hash de respuesta; no se guardan filas de votantes ni se transmite información a IA externa.',
      ),
      const SizedBox(height: 12),
      for (final _Json item in _officialVoteEvents) _officialVoteCard(item),
      if (_officialVoteEvents.isEmpty)
        const Padding(
          padding: EdgeInsets.all(16),
          child: Text(
            'Todavía no hay registros de votación adquiridos. Registra la fuente oficial y su decisión de derechos en Fuentes para habilitar la importación.',
          ),
        ),
    ],
  );

  Widget _officialVoteCard(_Json item) {
    final _Json occurrence = _json(item['occurrence']);
    final _Json evidence = _json(item['evidence']);
    final _Json totals = _json(evidence['totals']);
    final _Json thread = _json(item['thread']);
    final _Json provenance = _json(item['provenance']);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              _text(evidence['description']),
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            Text(
              '${_text(evidence['source_name'])} · votación ${_text(occurrence['source_record_id'])}',
            ),
            Text(
              'Fecha fuente (sin zona): ${_text(occurrence['source_date_raw'])}',
            ),
            Text(
              'Votos según la fuente · Sí ${_text(totals['yes'])} · No ${_text(totals['no'])} · Abstención ${_text(totals['abstention'])} · Dispensados ${_text(totals['excused'])}',
            ),
            Text(
              'Occurrence: ${_text(occurrence['kind'])} · identidad ${_text(occurrence['identity_basis'])}:${_text(occurrence['source_record_id'])}',
            ),
            Text(
              'Thread: ${_text(thread['decision'])} · ${_text(thread['reason'])}',
            ),
            const Text(
              'Es un registro reportado por la fuente oficial; no se presenta como verificación independiente ni se relaciona automáticamente con noticias u otros registros.',
            ),
            if (widget.onOpenOfficialEvent
                case final ValueChanged<OwnerJson> openEvent)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () => openEvent(item),
                  icon: const Icon(Icons.article_outlined),
                  label: const Text('Abrir lectura del acontecimiento'),
                ),
              ),
            ExpansionTile(
              title: const Text('Procedencia técnica'),
              tilePadding: EdgeInsets.zero,
              childrenPadding: const EdgeInsets.only(bottom: 12),
              children: <Widget>[
                ListTile(
                  dense: true,
                  title: const Text('Captura de evidencia'),
                  subtitle: Text(_text(evidence['fetched_at'])),
                ),
                ListTile(
                  dense: true,
                  title: const Text('SHA-256 de evidencia'),
                  subtitle: SelectableText(_text(evidence['response_sha256'])),
                ),
                ListTile(
                  dense: true,
                  title: const Text('Método y versión de adquisición'),
                  subtitle: Text(
                    '${_text(provenance['acquisition_method'])} · ${_text(provenance['adapter_version'])}',
                  ),
                ),
                ListTile(
                  dense: true,
                  title: const Text('Corroboración independiente'),
                  subtitle: Text(
                    _text(provenance['independent_corroboration']),
                  ),
                ),
              ],
            ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: () => _openOfficialVoteSource(evidence),
                icon: const Icon(Icons.open_in_new),
                label: const Text('Abrir registro original'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _articleCard(_Json article) {
    final _Json version = _json(article['version']);
    final _Json authorization = _json(article['processing_authorization']);
    final _Json provenance = _json(article['provenance']);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              _text(article['headline'], 'Metadata no redistribuible'),
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            Text(
              '${_text(article['publisher'])} · ${_text(article['domain'])}',
            ),
            Text(
              'Publicado: ${_text(article['published_at'])} · Capturado: ${_text(article['captured_at'])}',
            ),
            Text(
              'Versión: ${_text(version['id'])} · hash metadata: ${_text(version['metadata_hash'])}',
            ),
            Text(
              'Procesamiento: ${_processingMessage(authorization['reason'])}',
            ),
            const Text(
              'Occurrence / Thread: sin asignación en Dialektik. Las propuestas, si existen, se muestran en Jobs y no son confirmaciones.',
            ),
            Text(
              'Modo de contenido: ${_text(authorization['content_access_mode'])} · procesamiento local: ${authorization['local_processing'] == true ? 'permitido' : 'denegado'} · transmisión externa: ${authorization['external_ai_transmission'] == true ? 'permitida' : 'denegada'}',
            ),
            Text(
              'Procedencia: ${_text(provenance['discovery_channel'])} · adapter ${_text(provenance['adapter_version'])} · exclusión ${_text(provenance['exclusion_status'])}',
            ),
            if (provenance['rights_evidence_url'] is String)
              SelectableText(
                'Evidencia de derechos: ${provenance['rights_evidence_url']}',
              ),
            if (article['canonical_url'] is String)
              SelectableText('Origen: ${article['canonical_url']}'),
            Align(
              alignment: Alignment.centerRight,
              child: Wrap(
                alignment: WrapAlignment.end,
                spacing: 8,
                runSpacing: 4,
                children: <Widget>[
                  if (article['canonical_url'] is String)
                    TextButton.icon(
                      onPressed: () => _openOriginalSource(article),
                      icon: const Icon(Icons.open_in_new),
                      label: const Text('Abrir en el sitio de origen'),
                    ),
                  TextButton.icon(
                    onPressed: _token == null
                        ? null
                        : () => _requestProcessing(article),
                    icon: const Icon(Icons.play_arrow),
                    label: const Text('Solicitar o revisar procesamiento'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _jobsTab() => ListView(
    padding: const EdgeInsets.all(12),
    children: <Widget>[
      const Text(
        'Trabajos persistidos',
        style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
      ),
      for (final _Json job in _jobs)
        Card(
          child: ListTile(
            title: Text('${_text(job['state'])} · ${_text(job['model_id'])}'),
            subtitle: Text(
              _text(job['blocked_reason'], _text(job['article_id'])),
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _openJob(job),
          ),
        ),
      if (_jobs.isEmpty)
        const Padding(
          padding: EdgeInsets.all(16),
          child: Text('Aún no hay trabajos.'),
        ),
    ],
  );

  Widget _budgetTab() {
    final _Json budget = _json(_budget);
    final _Json controls = _json(budget['controls']);
    final _Json usage = _json(budget['usage']);
    final List<Object?> prices = budget['prices'] is List<Object?>
        ? budget['prices']! as List<Object?>
        : <Object?>[];
    return ListView(
      padding: const EdgeInsets.all(12),
      children: <Widget>[
        const Text(
          'Control de ejecución externa',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
        ),
        Text('Proveedor: ${_text(budget['external_activation'], 'DISABLED')}'),
        Text(
          'Modo del dispatcher: ${_text(budget['provider_mode'], 'disabled')}',
        ),
        Text(
          'Presupuesto habilitado: ${controls['enabled'] == true ? 'sí' : 'no'}',
        ),
        Text(
          'Emergency stop: ${controls['emergency_stop'] == true ? 'activo' : 'inactivo'}',
        ),
        Text(
          'Por solicitud: ${_dollars(controls['per_request_limit_microusd'])} USD',
        ),
        Text(
          'Diario: ${_dollars(controls['daily_limit_microusd'])} USD · Total: ${_dollars(controls['total_limit_microusd'])} USD',
        ),
        Text(
          'Uso asentado: diario ${_dollars(usage['daily_microusd'])} USD · total ${_dollars(usage['total_microusd'])} USD · reservado ${_dollars(usage['reserved_microusd'])} USD',
        ),
        Wrap(
          spacing: 8,
          children: <Widget>[
            OutlinedButton(
              onPressed: _token == null ? null : _configureBudget,
              child: const Text('Configurar límites'),
            ),
            OutlinedButton(
              onPressed: _token == null ? null : _registerPrice,
              child: const Text('Registrar precio de modelo'),
            ),
            OutlinedButton(
              onPressed: _token == null ? null : _registerProviderAuthorization,
              child: const Text('Autorizar proveedor/modelo'),
            ),
            FilledButton.tonal(
              onPressed: _token == null ? null : _emergencyStop,
              child: const Text('Detener emergencias'),
            ),
          ],
        ),
        const Divider(),
        const Text('Autorizaciones de proveedor'),
        for (final Object? raw in _asList(budget['provider_authorizations']))
          _providerAuthorizationLine(_json(raw)),
        if (_asList(budget['provider_authorizations']).isEmpty)
          const Text('No hay decisiones de proveedor registradas.'),
        const Divider(),
        const Text('Evidencia de precios por modelo'),
        for (final Object? raw in prices) _priceLine(_json(raw)),
        if (prices.isEmpty)
          const Text(
            'No hay precios registrados. Los costos no pueden acotarse.',
          ),
        const SizedBox(height: 12),
        const Text(
          'La configuración y el límite quedan persistidos. La activación externa sigue separada y apagada.',
        ),
      ],
    );
  }

  Widget _priceLine(_Json price) => ListTile(
    contentPadding: EdgeInsets.zero,
    title: Text(
      '${_text(price['model_id'])} · ${_text(price['decision_status'])}',
    ),
    subtitle: Text(
      'Entrada ${price['input_microusd_per_1k_tokens']} / salida ${price['output_microusd_per_1k_tokens']} micro USD por 1.000 tokens · max ${price['max_input_tokens']}/${price['max_output_tokens']} tokens',
    ),
  );

  Widget _providerAuthorizationLine(_Json authorization) => ListTile(
    contentPadding: EdgeInsets.zero,
    title: Text(
      '${_text(authorization['model_id'])} · ${_text(authorization['decision_status'])}',
    ),
    subtitle: Text(
      'Efectiva: ${authorization['effective'] == true ? 'sí' : 'no'} · ${_text(authorization['evidence_url'], 'sin evidencia')}',
    ),
  );

  Widget _line(String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Text('$label: $value'),
  );

  Widget _moneyField(TextEditingController controller, String label) =>
      TextField(
        controller: controller,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        decoration: InputDecoration(labelText: label),
      );
}

String _processingMessage(Object? value) => switch (value) {
  'SOURCE_RIGHTS_NOT_AUTHORIZED' =>
    'Bloqueado: los derechos registrados no cubren esta operación semántica.',
  'ARTICLE_PROCESSING_POLICY_DENIED' =>
    'Bloqueado por la política de procesamiento de este Article.',
  'ARTICLE_EXCERPT_VERSION_UNAVAILABLE' =>
    'Diferido: no hay una versión de extracto autorizada para procesar.',
  'PROVIDER_AUTHORIZATION_REQUIRED' =>
    'Diferido: falta una autorización vigente del proveedor.',
  'MODEL_PRICE_UNVERIFIED' =>
    'Detenido: el precio del proveedor no está verificado.',
  'OWNER_BUDGET_DISABLED' =>
    'Detenido por el control o la parada de presupuesto del propietario.',
  'PROVIDER_DISPATCHER_DISABLED' =>
    'Diferido: el proveedor está desactivado; la adquisición continúa.',
  'PROVIDER_ROUTE_NOT_AVAILABLE' =>
    'Sin una ruta de proveedor disponible; no se afirma que haya procesamiento.',
  final String status when status.isNotEmpty => status,
  _ => 'Estado de procesamiento no disponible.',
};

final class _RightsDecisionDialog extends StatefulWidget {
  const _RightsDecisionDialog({required this.publisher});
  final String publisher;

  @override
  State<_RightsDecisionDialog> createState() => _RightsDecisionDialogState();
}

final class _RightsDecisionDialogState extends State<_RightsDecisionDialog> {
  final TextEditingController _evidenceUrl = TextEditingController();
  final TextEditingController _evidenceHash = TextEditingController();
  final TextEditingController _attribution = TextEditingController();
  final Map<String, bool> _scopes = <String, bool>{
    'acquisition': false,
    'metadata_storage': false,
    'excerpt_storage': false,
    'fulltext_acquisition': false,
    'fulltext_persistence': false,
    'external_ai_transmission': false,
    'derived_semantic_persistence': false,
    'redisplay': false,
  };
  String _method = 'RSS_ATOM';
  String _status = 'UNVERIFIED';
  bool _localProcessing = false;

  @override
  void dispose() {
    _evidenceUrl.dispose();
    _evidenceHash.dispose();
    _attribution.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text('Derechos · ${widget.publisher}'),
    content: SizedBox(
      width: 560,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            DropdownButtonFormField<String>(
              initialValue: _method,
              decoration: const InputDecoration(
                labelText: 'Método de adquisición',
              ),
              items: const <DropdownMenuItem<String>>[
                DropdownMenuItem(value: 'RSS_ATOM', child: Text('RSS / Atom')),
                DropdownMenuItem(
                  value: 'OFFICIAL_API',
                  child: Text('API oficial'),
                ),
                DropdownMenuItem(
                  value: 'OWNER_PROVIDED',
                  child: Text('Contenido proporcionado por responsable'),
                ),
                DropdownMenuItem(value: 'OTHER', child: Text('Otro')),
              ],
              onChanged: (String? value) =>
                  setState(() => _method = value ?? _method),
            ),
            DropdownButtonFormField<String>(
              initialValue: _status,
              decoration: const InputDecoration(labelText: 'Decisión'),
              items: const <DropdownMenuItem<String>>[
                DropdownMenuItem(
                  value: 'UNVERIFIED',
                  child: Text('Sin verificar (todo denegado)'),
                ),
                DropdownMenuItem(
                  value: 'AUTHORIZED',
                  child: Text('Autorizado según evidencia revisada'),
                ),
                DropdownMenuItem(value: 'SUSPENDED', child: Text('Suspendido')),
                DropdownMenuItem(value: 'REVOKED', child: Text('Revocado')),
              ],
              onChanged: (String? value) =>
                  setState(() => _status = value ?? _status),
            ),
            for (final String key in _scopes.keys)
              CheckboxListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                value: _scopes[key],
                title: Text(key.replaceAll('_', ' ')),
                onChanged: _status == 'UNVERIFIED'
                    ? null
                    : (bool? value) =>
                          setState(() => _scopes[key] = value ?? false),
              ),
            CheckboxListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              value: _localProcessing,
              title: const Text('Procesamiento local de extractos'),
              subtitle: const Text(
                'Permiso separado de almacenamiento y transmisión externa.',
              ),
              onChanged: _status == 'UNVERIFIED'
                  ? null
                  : (bool? value) =>
                        setState(() => _localProcessing = value ?? false),
            ),
            TextField(
              controller: _evidenceUrl,
              decoration: const InputDecoration(
                labelText: 'URL HTTPS de evidencia',
              ),
            ),
            TextField(
              controller: _evidenceHash,
              decoration: const InputDecoration(
                labelText: 'SHA-256 de evidencia',
              ),
            ),
            TextField(
              controller: _attribution,
              decoration: const InputDecoration(
                labelText: 'Texto de atribución',
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Solo registra la decisión del responsable autenticado. Sin evidencia y scopes separados, no se habilita la adquisición.',
            ),
          ],
        ),
      ),
    ),
    actions: <Widget>[
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancelar'),
      ),
      FilledButton(
        onPressed: () => Navigator.pop(context, <String, Object?>{
          'publisher_identity': widget.publisher,
          'acquisition_method': _method,
          'decision_status': _status,
          'scopes': Map<String, bool>.from(_scopes),
          'local_processing': _localProcessing,
          'rights_evidence_url': _evidenceUrl.text,
          'rights_evidence_sha256': _evidenceHash.text,
          'attribution': _attribution.text,
        }),
        child: const Text('Registrar decisión'),
      ),
    ],
  );
}

int? _parseDollars(String value) {
  final RegExpMatch? match = RegExp(
    r'^\s*(\d{1,4})(?:\.(\d{1,6}))?\s*$',
  ).firstMatch(value);
  if (match == null) return null;
  final String fraction = (match.group(2) ?? '').padRight(6, '0');
  return int.parse(match.group(1)!) * 1000000 +
      (fraction.isEmpty ? 0 : int.parse(fraction));
}

String _dollars(Object? value) {
  final int amount = value is int ? value : 0;
  final int whole = amount ~/ 1000000;
  final String fraction = (amount % 1000000)
      .toString()
      .padLeft(6, '0')
      .substring(0, 2);
  return '$whole.$fraction';
}
