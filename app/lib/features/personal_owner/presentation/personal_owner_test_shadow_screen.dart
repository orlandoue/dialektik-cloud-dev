import 'package:dialektik/features/personal_owner/data/personal_owner_test_shadow.dart';
import 'package:flutter/material.dart';

final class PersonalOwnerTestShadowScreen extends StatefulWidget {
  const PersonalOwnerTestShadowScreen({
    required this.repository,
    this.initialJobId,
    super.key,
  });

  final PersonalOwnerTestShadowRepository repository;
  final String? initialJobId;

  @override
  State<PersonalOwnerTestShadowScreen> createState() =>
      _PersonalOwnerTestShadowScreenState();
}

final class _PersonalOwnerTestShadowScreenState
    extends State<PersonalOwnerTestShadowScreen> {
  late final TextEditingController _jobController;
  final TextEditingController _tokenController = TextEditingController();
  bool _loading = false;
  String? _error;
  List<PersonalOwnerTestArticleDto> _articles =
      const <PersonalOwnerTestArticleDto>[];
  PersonalOwnerTestAuthorizationList? _authorization;
  PersonalOwnerTestShadowDto? _result;

  @override
  void initState() {
    super.initState();
    _jobController = TextEditingController(text: widget.initialJobId);
  }

  @override
  void dispose() {
    _jobController.dispose();
    _tokenController.dispose();
    super.dispose();
  }

  String? _takeToken() {
    final String value = _tokenController.text.trim();
    _tokenController.clear();
    FocusScope.of(context).unfocus();
    if (value.isEmpty) return null;
    return value;
  }

  Future<void> _withToken(Future<void> Function(String token) operation) async {
    final String? token = _takeToken();
    if (token == null) {
      setState(() => _error = 'Ingresa la credencial local para continuar.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await operation(token);
    } on PersonalOwnerTestShadowFailure {
      if (mounted) {
        setState(() => _error = 'No se pudo completar la operación local.');
      }
    } on FormatException {
      if (mounted) {
        setState(() => _error = 'Core devolvió un resultado no válido.');
      }
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
          _tokenController.clear();
        });
      }
    }
  }

  Future<void> _ingest() => _withToken((String token) async {
    final PersonalOwnerTestArticleDto article = await widget.repository
        .ingestArticle(token);
    if (mounted) {
      setState(() {
        _articles = <PersonalOwnerTestArticleDto>[article];
        _result = null;
      });
    }
  });

  Future<void> _loadArticles() => _withToken((String token) async {
    final List<PersonalOwnerTestArticleDto> articles = await widget.repository
        .listArticles(token);
    if (mounted) setState(() => _articles = articles);
  });

  Future<void> _loadAuthorizations() => _withToken((String token) async {
    final PersonalOwnerTestAuthorizationList authorization = await widget
        .repository
        .listAuthorizations(token);
    if (mounted) setState(() => _authorization = authorization);
  });

  Future<void> _startJob() => _withToken((String token) async {
    final PersonalOwnerTestArticleDto? article = _articles.isEmpty
        ? null
        : _articles.first;
    final PersonalOwnerTestAuthorizationList? authorization = _authorization;
    if (article == null || authorization == null) {
      throw const PersonalOwnerTestShadowFailure();
    }
    final String key = 'ui-${DateTime.now().microsecondsSinceEpoch.toString()}';
    PersonalOwnerTestShadowDto result = await widget.repository.startJob(
      article: article,
      authorization: authorization,
      ownerToken: token,
      idempotencyKey: key,
    );
    if (mounted) {
      _jobController.text = result.jobId;
      setState(() => _result = result);
    }
    for (int poll = 0; poll < 80; poll += 1) {
      if (<String>{
        'COMPLETED',
        'FAILED',
        'CANCELLED',
        'RECONCILIATION_REQUIRED',
      }.contains(result.state)) {
        break;
      }
      await Future<void>.delayed(const Duration(milliseconds: 250));
      result = await widget.repository.getJob(result.jobId, token);
      if (mounted) setState(() => _result = result);
    }
  });

  Future<void> _loadJob() => _withToken((String token) async {
    final String jobId = _jobController.text.trim();
    final PersonalOwnerTestShadowDto result = await widget.repository.getJob(
      jobId,
      token,
    );
    if (mounted) setState(() => _result = result);
  });

  Future<void> _cancelJob() => _withToken((String token) async {
    final String jobId = _jobController.text.trim();
    final PersonalOwnerTestShadowDto result = await widget.repository.cancelJob(
      jobId,
      token,
    );
    if (mounted) setState(() => _result = result);
  });

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Semantic shadow · trabajo personal')),
    body: ListView(
      padding: const EdgeInsets.all(24),
      children: <Widget>[
        const Text(
          'Flujo local sintético: Content API de fixture → registro hash-only → '
          'trabajo autorizado → proveedor simulado → Core. No usa noticias auténticas. '
          'LIVE permanece UNASSIGNED.',
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _tokenController,
          obscureText: true,
          enableSuggestions: false,
          autocorrect: false,
          decoration: const InputDecoration(
            labelText: 'Credencial local',
            helperText:
                'Se usa en memoria y se limpia al terminar cada acción.',
          ),
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: <Widget>[
            FilledButton(
              onPressed: _loading ? null : _ingest,
              child: const Text('Adquirir fixture sintético'),
            ),
            OutlinedButton(
              onPressed: _loading ? null : _loadArticles,
              child: const Text('Cargar Articles registrados'),
            ),
            OutlinedButton(
              onPressed: _loading ? null : _loadAuthorizations,
              child: const Text('Cargar permisos de prueba'),
            ),
            FilledButton.tonal(
              onPressed: _loading || _articles.isEmpty || _authorization == null
                  ? null
                  : _startJob,
              child: const Text('Procesar en SHADOW'),
            ),
          ],
        ),
        if (_authorization
            case final PersonalOwnerTestAuthorizationList
                authorization) ...<Widget>[
          const SizedBox(height: 20),
          _line('Operador de prueba', authorization.ownerIdentity),
          _line(
            'Proveedor / modelo',
            '${authorization.provider} / ${authorization.model}',
          ),
          _line('Permisos activos', '${authorization.authorizations.length}'),
        ],
        for (final PersonalOwnerTestArticleDto article
            in _articles) ...<Widget>[
          const SizedBox(height: 16),
          const Divider(),
          _line('Article sintético', article.title),
          _line('Publisher de fixture', article.publisher),
          _line('Publicación', article.publishedAt),
          _line('Versión Article', article.articleVersionId),
          _line('SHA proyección', article.projectionSha256),
        ],
        const SizedBox(height: 18),
        TextField(
          controller: _jobController,
          decoration: const InputDecoration(labelText: 'ID del trabajo'),
          autocorrect: false,
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          children: <Widget>[
            OutlinedButton(
              onPressed: _loading ? null : _loadJob,
              child: const Text('Consultar shadow'),
            ),
            OutlinedButton(
              onPressed: _loading || _result?.state != 'PENDING'
                  ? null
                  : _cancelJob,
              child: const Text('Cancelar trabajo pendiente'),
            ),
          ],
        ),
        if (_loading) ...<Widget>[
          const SizedBox(height: 16),
          const LinearProgressIndicator(),
          const SizedBox(height: 8),
          const Text('Consultando el estado del trabajo local…'),
        ],
        if (_error case final String error) ...<Widget>[
          const SizedBox(height: 16),
          Text(
            error,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ],
        if (_result case final PersonalOwnerTestShadowDto result) ...<Widget>[
          const SizedBox(height: 24),
          const Divider(),
          _line('Estado del trabajo', result.state),
          _line('LIVE', 'UNASSIGNED'),
          if (result.errorCategory case final String error)
            _line('Categoría de error', error),
          if (result.observation
              case final PersonalOwnerTestShadowObservation
                  observation) ...<Widget>[
            _line('Aplicabilidad Core', observation.applicability),
            _line('EventNuggets', '${observation.eventNuggetCount}'),
            _line(
              'Hechos grounded',
              '${observation.groundedFactCount}/${observation.factCount}',
            ),
            _line(
              'Hechos no soportados',
              '${observation.unsupportedFactCount}',
            ),
            _line(
              'Referencias válidas / inválidas',
              '${observation.validEvidenceReferenceCount} / ${observation.invalidEvidenceReferenceCount}',
            ),
            _line(
              'Candidato de evento (no autoritativo)',
              observation.semanticDerivatives.eventCandidate,
            ),
            _line(
              'Campos faltantes / inciertos',
              '${observation.semanticDerivatives.missingOrUncertainCount}',
            ),
            _line('SHA de proyección', observation.projectionSha256),
            _line('SHA del derivado', observation.derivativeSha256),
            for (final PersonalOwnerTestSafeFact fact
                in observation.semanticDerivatives.facts) ...<Widget>[
              const SizedBox(height: 8),
              _line(
                'Hecho · ${fact.kind}',
                '${fact.support} · SHA ${fact.valueSha256}',
              ),
              _line('Bloques citados', fact.evidenceBlockIds.join(', ')),
              if (fact.normalizedValue != null)
                _line(
                  'Tiempo normalizado',
                  '${fact.normalizedValue} · ${fact.timeUncertainty}',
                ),
            ],
            for (final PersonalOwnerTestEvidenceLocator item
                in observation.evidenceLocators)
              _line(
                'Localizador',
                '${item.blockId} ${item.field} [${item.start}, ${item.end}) · ${item.spanSha256}',
              ),
          ],
        ],
      ],
    ),
  );

  Widget _line(String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        SizedBox(width: 190, child: Text(label)),
        Expanded(child: SelectableText(value)),
      ],
    ),
  );
}
