import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/editorial/data/editorial_api.dart';
import 'package:flutter/material.dart';

/// Review surface for the authenticated editorial account.
final class EditorialQueueScreen extends StatefulWidget {
  const EditorialQueueScreen({
    required this.api,
    required this.session,
    super.key,
  });

  final EditorialApi api;
  final EditorialSession session;

  @override
  State<EditorialQueueScreen> createState() => _EditorialQueueScreenState();
}

final class _EditorialQueueScreenState extends State<EditorialQueueScreen> {
  List<Map<String, Object?>> _tasks = const <Map<String, Object?>>[];
  List<Map<String, Object?>>? _headlines;
  List<Map<String, Object?>> _headlineSources = const <Map<String, Object?>>[];
  bool _loading = true;
  bool _busyHeadline = false;
  String? _error;
  String? _headlineError;
  String? _headlineNotice;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    widget.api.close();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final List<Map<String, Object?>> tasks = await widget.api.tasks();
      List<Map<String, Object?>>? headlines;
      List<Map<String, Object?>> headlineSources =
          const <Map<String, Object?>>[];
      String? headlineError;
      if (widget.session.canConfirm && widget.session.singleEditorEnabled) {
        try {
          headlines = await widget.api.headlineReviews();
          if (headlines != null) {
            headlineSources = await widget.api.headlineSources();
          }
        } on EditorialFailure catch (failure) {
          headlineError = failure.message;
        }
      }
      if (!mounted) return;
      setState(() {
        _tasks = tasks;
        _headlines = headlines;
        _headlineSources = headlineSources;
        _headlineError = headlineError;
        _loading = false;
      });
    } on EditorialFailure catch (failure) {
      if (!mounted) return;
      setState(() {
        _error = failure.message;
        _loading = false;
      });
    }
  }

  Future<void> _analyzeHeadline() async {
    if (_busyHeadline) return;
    setState(() {
      _busyHeadline = true;
      _headlineNotice = null;
      _headlineError = null;
    });
    try {
      final Map<String, Object?> result = await widget.api.analyzeHeadline();
      if (!mounted) return;
      setState(
        () => _headlineNotice = result['status'] == 'NO_ELIGIBLE'
            ? 'No hay titulares pendientes de fuentes autorizadas.'
            : 'Análisis listo para revisión.',
      );
      await _load();
    } on EditorialFailure catch (failure) {
      if (mounted) setState(() => _headlineError = failure.message);
    } finally {
      if (mounted) setState(() => _busyHeadline = false);
    }
  }

  Future<void> _decideHeadline(String attemptId, String decision) async {
    if (_busyHeadline) return;
    setState(() {
      _busyHeadline = true;
      _headlineError = null;
      _headlineNotice = null;
    });
    try {
      await widget.api.decideHeadline(attemptId, decision);
      if (mounted) await _load();
    } on EditorialFailure catch (failure) {
      if (mounted) setState(() => _headlineError = failure.message);
    } finally {
      if (mounted) setState(() => _busyHeadline = false);
    }
  }

  Future<void> _setHeadlineSource(Map<String, Object?> source) async {
    final Object? rawId = source['sourceId'];
    if (_busyHeadline || rawId is! String) return;
    final bool enable = source['grantId'] == null;
    if (enable) {
      final bool? confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Habilitar análisis de titulares'),
          content: Text(
            'Para ${_text(source['sourceName'], 'esta fuente')}, se enviarán titulares a Cloudflare para revisión editorial. No se enviarán cuerpos de artículos ni se publicarán contradicciones automáticamente.',
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Habilitar'),
            ),
          ],
        ),
      );
      if (confirmed != true || !mounted) return;
    }
    setState(() {
      _busyHeadline = true;
      _headlineError = null;
      _headlineNotice = null;
    });
    try {
      await widget.api.setHeadlineSource(rawId, enabled: enable);
      if (mounted) await _load();
    } on EditorialFailure catch (failure) {
      if (mounted) setState(() => _headlineError = failure.message);
    } finally {
      if (mounted) setState(() => _busyHeadline = false);
    }
  }

  Future<void> _open(Map<String, Object?> task) async {
    final Object? taskId = task['taskId'];
    if (taskId is! String) return;
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => EditorialTaskScreen(
          api: widget.api,
          session: widget.session,
          taskId: taskId,
        ),
      ),
    );
    if (mounted) await _load();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Revisión editorial')),
    body: _loading
        ? const Center(child: CircularProgressIndicator())
        : _error != null
        ? _EditorialMessage(message: _error!, onRetry: _load)
        : RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              children: <Widget>[
                if (_headlines != null) ...<Widget>[
                  Text(
                    'Titulares para revisar',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Revisa la fuente antes de permitir comparaciones. Esta decisión no publica acontecimientos ni contradicciones.',
                  ),
                  const SizedBox(height: 8),
                  ExpansionTile(
                    title: const Text('Fuentes para análisis de titulares'),
                    subtitle: const Text(
                      'Habilita o retira cada fuente por separado.',
                    ),
                    children: <Widget>[
                      if (_headlineSources.isEmpty)
                        const ListTile(
                          title: Text(
                            'No hay fuentes disponibles para revisión.',
                          ),
                        ),
                      ..._headlineSources.map((source) {
                        final bool active = source['current'] == true;
                        final bool hasGrant = source['grantId'] is String;
                        final Object? rawEvidence = source['rightsEvidenceUrl'];
                        final Uri? evidence = rawEvidence is String
                            ? Uri.tryParse(rawEvidence)
                            : null;
                        return ListTile(
                          title: Text(_text(source['sourceName'], 'Fuente')),
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Text(
                                active
                                    ? 'Habilitada'
                                    : hasGrant
                                    ? 'Necesita actualizar su autorización'
                                    : 'Sin habilitar',
                              ),
                              Text(
                                'Referencia: ${_text(source['authorizationReference'], 'No disponible')}',
                              ),
                              if (evidence != null &&
                                  evidence.scheme == 'https' &&
                                  evidence.hasAuthority &&
                                  evidence.userInfo.isEmpty)
                                TextButton(
                                  onPressed: () =>
                                      openExternalHttpLink(evidence),
                                  child: const Text('Revisar fundamento'),
                                ),
                            ],
                          ),
                          trailing: TextButton(
                            onPressed: _busyHeadline
                                ? null
                                : () => _setHeadlineSource(source),
                            child: Text(hasGrant ? 'Retirar' : 'Habilitar'),
                          ),
                        );
                      }),
                    ],
                  ),
                  OutlinedButton.icon(
                    onPressed: _busyHeadline ? null : _analyzeHeadline,
                    icon: const Icon(Icons.manage_search),
                    label: Text(
                      _busyHeadline
                          ? 'Procesando…'
                          : 'Analizar siguiente titular',
                    ),
                  ),
                  if (_headlineNotice != null) Text(_headlineNotice!),
                  if (_headlineError != null)
                    Text(
                      _headlineError!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  if (_headlines!.isEmpty)
                    const Text('No hay análisis de titulares pendientes.'),
                  ..._headlines!.map((item) {
                    final Object? rawId = item['attemptId'];
                    final String? attemptId = rawId is String ? rawId : null;
                    final Map<String, Object?> extraction =
                        item['extraction'] is Map<String, Object?>
                        ? item['extraction']! as Map<String, Object?>
                        : const <String, Object?>{};
                    final bool comparable =
                        extraction['status'] == 'OBSERVATION_AVAILABLE';
                    final Object? rawUrl = item['canonicalUrl'];
                    final Uri? url = rawUrl is String
                        ? Uri.tryParse(rawUrl)
                        : null;
                    return Card(
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(
                              _text(item['headline'], 'Sin título'),
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            Text(
                              '${_text(item['sourceName'], 'Fuente')} · ${_date(item['publishedAt'])}',
                            ),
                            Text(
                              comparable
                                  ? 'Puede evaluarse para comparación.'
                                  : 'Necesita más evidencia.',
                            ),
                            if (url != null &&
                                url.scheme == 'https' &&
                                url.hasAuthority &&
                                url.userInfo.isEmpty)
                              TextButton.icon(
                                onPressed: () => openExternalHttpLink(url),
                                icon: const Icon(Icons.open_in_new),
                                label: const Text('Abrir fuente original'),
                              ),
                            Wrap(
                              spacing: 8,
                              children: <Widget>[
                                if (comparable)
                                  OutlinedButton(
                                    onPressed:
                                        _busyHeadline || attemptId == null
                                        ? null
                                        : () => _decideHeadline(
                                            attemptId,
                                            'ACCEPT_FOR_GROUPING',
                                          ),
                                    child: const Text('Permitir comparar'),
                                  ),
                                OutlinedButton(
                                  onPressed: _busyHeadline || attemptId == null
                                      ? null
                                      : () => _decideHeadline(
                                          attemptId,
                                          'NEEDS_EVIDENCE',
                                        ),
                                  child: const Text('Necesita evidencia'),
                                ),
                                TextButton(
                                  onPressed: _busyHeadline || attemptId == null
                                      ? null
                                      : () => _decideHeadline(
                                          attemptId,
                                          'REJECT',
                                        ),
                                  child: const Text('Descartar'),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                  const SizedBox(height: 20),
                  Text(
                    'Revisiones de afirmaciones',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ],
                if (_headlines == null && _headlineError != null)
                  Text(
                    _headlineError!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                if (_tasks.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 16),
                    child: Text('No hay revisiones pendientes.'),
                  ),
                ..._tasks.map((task) {
                  final String title = _text(
                    task['eventTitle'],
                    'Acontecimiento',
                  );
                  final bool current = task['isCurrentSnapshot'] == true;
                  return Card(
                    child: ListTile(
                      title: Text(title),
                      subtitle: Text(
                        current
                            ? 'Revisión de afirmaciones'
                            : 'Requiere actualización',
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => _open(task),
                    ),
                  );
                }),
              ],
            ),
          ),
  );
}

final class EditorialTaskScreen extends StatefulWidget {
  const EditorialTaskScreen({
    required this.api,
    required this.session,
    required this.taskId,
    super.key,
  });

  final EditorialApi api;
  final EditorialSession session;
  final String taskId;

  @override
  State<EditorialTaskScreen> createState() => _EditorialTaskScreenState();
}

final class _EditorialTaskScreenState extends State<EditorialTaskScreen> {
  Map<String, Object?>? _task;
  final Set<String> _selected = <String>{};
  bool _loading = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final Map<String, Object?> task = await widget.api.task(widget.taskId);
      if (!mounted) return;
      setState(() {
        _task = task;
        _selected.clear();
        _loading = false;
      });
    } on EditorialFailure catch (failure) {
      if (!mounted) return;
      setState(() {
        _error = failure.message;
        _loading = false;
      });
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
      if (mounted) await _load();
    } on EditorialFailure catch (failure) {
      if (!mounted) return;
      setState(() => _error = failure.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirm(Map<String, Object?> proposal) async {
    final Object? proposalId = proposal['proposalId'];
    if (proposalId is! String) return;
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Confirmar revisión'),
        content: const Text(
          'Confirma esta decisión después de revisar las afirmaciones y sus fuentes.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Confirmar'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await _run(() => widget.api.confirm(widget.taskId, proposalId));
    }
  }

  Future<void> _refuse(Map<String, Object?> proposal) async {
    final Object? proposalId = proposal['proposalId'];
    if (proposalId is! String) return;
    final TextEditingController reason = TextEditingController();
    final String? result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Rechazar propuesta'),
        content: TextField(
          controller: reason,
          maxLength: 500,
          maxLines: 3,
          decoration: const InputDecoration(labelText: 'Motivo'),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () {
              final String value = reason.text.trim();
              if (value.isNotEmpty) Navigator.pop(context, value);
            },
            child: const Text('Rechazar'),
          ),
        ],
      ),
    );
    reason.dispose();
    if (result != null) {
      await _run(() => widget.api.refuse(widget.taskId, proposalId, result));
    }
  }

  Future<void> _split(List<Map<String, Object?>> assertions) async {
    final List<String> ids = assertions
        .map((item) => item['assertionId'])
        .whereType<String>()
        .toList(growable: false);
    if (ids.length != assertions.length || ids.length < 2) return;
    final Map<String, int> groups = <String, int>{};
    final List<List<String>>? result = await showDialog<List<List<String>>>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Separar afirmaciones'),
          content: SizedBox(
            width: 500,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: assertions
                    .map((item) {
                      final String id = item['assertionId']! as String;
                      return DropdownButtonFormField<int>(
                        initialValue: groups[id],
                        decoration: InputDecoration(
                          labelText: _text(item['sourceName'], 'Fuente'),
                          helperText: _text(item['articleTitle'], 'Sin título'),
                          helperMaxLines: 3,
                        ),
                        items: List<DropdownMenuItem<int>>.generate(
                          ids.length,
                          (index) => DropdownMenuItem<int>(
                            value: index + 1,
                            child: Text('Grupo ${index + 1}'),
                          ),
                        ),
                        onChanged: (value) {
                          if (value != null) {
                            setDialogState(() => groups[id] = value);
                          }
                        },
                      );
                    })
                    .toList(growable: false),
              ),
            ),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed:
                  groups.length == ids.length &&
                      groups.values.toSet().length >= 2
                  ? () {
                      final List<int> labels = groups.values.toSet().toList()
                        ..sort();
                      Navigator.pop(
                        context,
                        labels
                            .map(
                              (label) => ids
                                  .where((id) => groups[id] == label)
                                  .toList(growable: false),
                            )
                            .toList(growable: false),
                      );
                    }
                  : null,
              child: const Text('Proponer separación'),
            ),
          ],
        ),
      ),
    );
    if (result != null) {
      await _run(() => widget.api.split(widget.taskId, result));
    }
  }

  @override
  Widget build(BuildContext context) {
    final Map<String, Object?>? task = _task;
    final List<Map<String, Object?>> assertions = _objects(task?['assertions']);
    final List<Map<String, Object?>> proposals = _objects(task?['proposals']);
    final List<Map<String, Object?>> pending = proposals
        .where((p) => p['state'] == 'submitted')
        .toList();
    final Map<String, Map<String, Object?>> assertionsById =
        <String, Map<String, Object?>>{
          for (final Map<String, Object?> assertion in assertions)
            if (assertion['assertionId'] is String)
              (assertion['assertionId']! as String): assertion,
        };
    final bool allQuotesAvailable =
        assertions.isNotEmpty &&
        assertions.every((assertion) => assertion['quotedText'] is String);
    final bool current = task?['isCurrentSnapshot'] == true;
    final bool assigned = task?['assignedTo'] == widget.session.userId;
    final bool canPropose =
        current &&
        assigned &&
        widget.session.canPropose &&
        pending.isEmpty &&
        !_busy;
    return Scaffold(
      appBar: AppBar(title: const Text('Revisión de afirmaciones')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : task == null
          ? _EditorialMessage(
              message: _error ?? 'No se encontró la revisión.',
              onRetry: _load,
            )
          : ListView(
              padding: const EdgeInsets.all(16),
              children: <Widget>[
                Text(
                  _text(task['eventTitle'], 'Acontecimiento'),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 8),
                const Text(
                  'Comprueba cada fragmento en la fuente original antes de decidir.',
                ),
                if (!current)
                  const Padding(
                    padding: EdgeInsets.only(top: 8),
                    child: Text(
                      'Esta revisión necesita actualizarse antes de continuar.',
                    ),
                  ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                const SizedBox(height: 12),
                if (current &&
                    task['taskState'] == 'pending' &&
                    task['assignedTo'] == null &&
                    widget.session.canPropose)
                  OutlinedButton(
                    onPressed: _busy
                        ? null
                        : () => _run(() => widget.api.claim(widget.taskId)),
                    child: const Text('Tomar revisión'),
                  ),
                if (current && assigned && pending.isEmpty)
                  OutlinedButton(
                    onPressed: _busy
                        ? null
                        : () => _run(() => widget.api.release(widget.taskId)),
                    child: const Text('Liberar revisión'),
                  ),
                ...assertions.map((assertion) {
                  final Object? rawId = assertion['assertionId'];
                  final String? id = rawId is String ? rawId : null;
                  final bool quoteAvailable = assertion['quotedText'] is String;
                  final String quote = _text(
                    assertion['quotedText'],
                    'Fragmento no disponible.',
                  );
                  final Object? rawUrl = assertion['articleUrl'];
                  final Uri? url = rawUrl is String
                      ? Uri.tryParse(rawUrl)
                      : null;
                  return Card(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          CheckboxListTile(
                            contentPadding: EdgeInsets.zero,
                            value: id != null && _selected.contains(id),
                            onChanged:
                                canPropose && id != null && quoteAvailable
                                ? (selected) => setState(() {
                                    if (selected == true) {
                                      _selected.add(id);
                                    } else {
                                      _selected.remove(id);
                                    }
                                  })
                                : null,
                            title: Text(
                              _text(assertion['sourceName'], 'Fuente'),
                            ),
                            subtitle: Text(quote),
                          ),
                          if (quoteAvailable) ...<Widget>[
                            Text(
                              'Título: ${_text(assertion['articleTitle'], 'No disponible')}',
                            ),
                            Text(
                              'Autor: ${_text(assertion['articleAuthor'], 'No disponible')}',
                            ),
                            Text(
                              'Fecha: ${_date(assertion['articlePublishedAt'])}',
                            ),
                          ],
                          if (url != null &&
                              url.scheme == 'https' &&
                              url.hasAuthority &&
                              url.userInfo.isEmpty)
                            TextButton.icon(
                              onPressed: () => openExternalHttpLink(url),
                              icon: const Icon(Icons.open_in_new),
                              label: const Text('Abrir fuente original'),
                            ),
                        ],
                      ),
                    ),
                  );
                }),
                if (canPropose) ...<Widget>[
                  FilledButton(
                    onPressed: _selected.length < 2
                        ? null
                        : () => _run(
                            () => widget.api.acceptSubset(
                              widget.taskId,
                              _selected.toList(growable: false),
                            ),
                          ),
                    child: const Text('Proponer agrupación'),
                  ),
                  OutlinedButton(
                    onPressed: assertions.length < 2 || !allQuotesAvailable
                        ? null
                        : () => _split(assertions),
                    child: const Text('Proponer separación'),
                  ),
                ],
                ...pending.map((proposal) {
                  final bool own =
                      proposal['proposerId'] == widget.session.userId;
                  final List<Map<String, Object?>> members = _objects(
                    proposal['members'],
                  );
                  final bool membersReviewable =
                      members.isNotEmpty &&
                      members.every((member) {
                        final Object? id = member['assertionId'];
                        return id is String &&
                            assertionsById[id]?['quotedText'] is String;
                      });
                  final bool mayReject =
                      widget.session.canConfirm &&
                      (!own || widget.session.singleEditorEnabled) &&
                      current &&
                      !_busy;
                  final bool mayConfirm = mayReject && membersReviewable;
                  final String outcome = proposal['outcome'] == 'split'
                      ? 'Separación'
                      : 'Agrupación';
                  return Card(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: <Widget>[
                          Text(
                            'Propuesta pendiente: $outcome',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          ...members.map((member) {
                            final Object? id = member['assertionId'];
                            final Map<String, Object?>? assertion = id is String
                                ? assertionsById[id]
                                : null;
                            final Object? group = member['partitionOrdinal'];
                            return Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Text(
                                '${_text(assertion?['sourceName'], 'Fuente')}'
                                '${group is int ? ' · Grupo $group' : ''}: '
                                '${_text(assertion?['articleTitle'], 'Sin título')}',
                              ),
                            );
                          }),
                          const SizedBox(height: 8),
                          FilledButton(
                            onPressed: mayConfirm
                                ? () => _confirm(proposal)
                                : null,
                            child: const Text('Confirmar'),
                          ),
                          TextButton(
                            onPressed: mayReject
                                ? () => _refuse(proposal)
                                : null,
                            child: const Text('Rechazar'),
                          ),
                        ],
                      ),
                    ),
                  );
                }),
              ],
            ),
    );
  }
}

final class _EditorialMessage extends StatelessWidget {
  const _EditorialMessage({required this.message, required this.onRetry});
  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(message, textAlign: TextAlign.center),
          const SizedBox(height: 12),
          OutlinedButton(onPressed: onRetry, child: const Text('Actualizar')),
        ],
      ),
    ),
  );
}

String _text(Object? value, String fallback) =>
    value is String && value.isNotEmpty ? value : fallback;

String _date(Object? value) {
  final DateTime? date = value is String ? DateTime.tryParse(value) : null;
  if (date == null) return 'No disponible';
  final DateTime utc = date.toUtc();
  return '${utc.day.toString().padLeft(2, '0')}/'
      '${utc.month.toString().padLeft(2, '0')}/${utc.year}';
}

List<Map<String, Object?>> _objects(Object? value) => value is List
    ? value.whereType<Map<String, Object?>>().toList(growable: false)
    : const <Map<String, Object?>>[];
