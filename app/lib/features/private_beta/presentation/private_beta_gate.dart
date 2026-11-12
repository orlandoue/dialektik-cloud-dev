import 'dart:async';

import 'package:dialektik/app/dialektik_app.dart';
import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/design_system/theme/dialektik_theme.dart';
import 'package:dialektik/features/arena/data/arena_account.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/consumer/data/public_api_client.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/editorial/data/editorial_api.dart';
import 'package:dialektik/features/editorial/presentation/editorial_review_screen.dart';
import 'package:dialektik/features/private_beta/data/supabase_auth_client.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

typedef PrivateBetaSignIn =
    Future<void> Function(String email, String password);
typedef PrivateBetaSignUp =
    Future<void> Function(String email, String password, String? alias);

/// Keeps the production consumer tree behind Supabase Auth and Core allowlisting.
final class PrivateBetaGate extends StatefulWidget {
  const PrivateBetaGate({
    required this.apiConfiguration,
    required this.supabaseUrl,
    required this.publishableKey,
    required this.initialRoute,
    this.readOnlyNewsReaderEnabled = false,
    this.arenaEnabled = true,
    this.authHttpClient,
    this.apiHttpClient,
    this.authClock,
    this.deepLinks,
    this.openBrowser = openExternalHttpLink,
    super.key,
  });

  final ApiConfiguration apiConfiguration;
  final String supabaseUrl;
  final String publishableKey;
  final String initialRoute;
  final bool readOnlyNewsReaderEnabled;

  /// Opens «Dialektik Arena» after sign-in instead of the classic reader.
  final bool arenaEnabled;
  final http.Client? authHttpClient;
  final http.Client? apiHttpClient;
  final DateTime Function()? authClock;

  /// Incoming app links; the Google sign-in callback arrives here.
  final Stream<Uri>? deepLinks;

  /// Opens the Google sign-in page in the browser.
  final ExternalLinkOpener openBrowser;

  @override
  State<PrivateBetaGate> createState() => _PrivateBetaGateState();
}

final class _PrivateBetaGateState extends State<PrivateBetaGate> {
  SupabaseAuthClient? _auth;
  bool _signedIn = false;
  bool _busy = false;
  String? _notice;
  final ValueNotifier<EditorialSession?> _editorialSession =
      ValueNotifier<EditorialSession?>(null);
  int _sessionGeneration = 0;
  _GateAccount? _account;
  StreamSubscription<Uri>? _links;

  @override
  void initState() {
    super.initState();
    _links = widget.deepLinks?.listen(
      (Uri uri) => unawaited(_handleDeepLink(uri)),
      onError: (Object _) {},
    );
    try {
      _auth = SupabaseAuthClient(
        supabaseUrl: widget.supabaseUrl,
        publishableKey: widget.publishableKey,
        httpClient: widget.authHttpClient,
        clock: widget.authClock,
      );
    } on Object {
      _notice = 'La configuración de acceso privado no está disponible.';
    }
  }

  @override
  void dispose() {
    unawaited(_links?.cancel());
    _auth?.close();
    _editorialSession.dispose();
    super.dispose();
  }

  Future<void> _signIn(String email, String password) => _authenticate(
    (SupabaseAuthClient auth) =>
        auth.signInWithPassword(email: email, password: password),
    action: _AuthAction.password,
  );

  Future<void> _signUp(String email, String password, String? alias) async {
    final SupabaseAuthClient? auth = _auth;
    if (auth == null) return;
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      final SupabaseSignUpResult result = await auth.signUp(
        email: email,
        password: password,
        alias: alias,
      );
      if (result == SupabaseSignUpResult.confirmationRequired) {
        if (!mounted) return;
        setState(() {
          _busy = false;
          _notice =
              'Te enviamos un correo a ${email.trim()} para confirmar tu '
              'cuenta. Ábrelo y luego vuelve aquí a iniciar sesión.';
        });
        return;
      }
    } on SupabaseAuthNetworkFailure {
      _fail(_networkNotice);
      return;
    } on SupabaseAuthFailure catch (failure) {
      _fail(_failureNotice(failure, _AuthAction.signUp));
      return;
    }
    await _completeSignIn(auth);
  }

  Future<void> _startGoogle() async {
    final SupabaseAuthClient? auth = _auth;
    if (auth == null || _busy) return;
    setState(() => _notice = null);
    final bool opened = await widget.openBrowser(auth.googleSignInUri());
    if (!opened && mounted) {
      setState(
        () => _notice =
            'No se pudo abrir Google. Puedes entrar con tu correo mientras '
            'tanto.',
      );
    }
  }

  Future<void> _handleDeepLink(Uri uri) async {
    if (!SupabaseAuthClient.isOAuthCallback(uri) || _signedIn) return;
    await _authenticate(
      (SupabaseAuthClient auth) => auth.completeOAuth(uri),
      action: _AuthAction.google,
    );
  }

  static const String _networkNotice =
      'No se pudo conectar con el inicio de sesión. Inténtalo nuevamente.';

  String _failureNotice(SupabaseAuthFailure failure, _AuthAction action) =>
      switch (failure.code) {
        'invalid_credentials' ||
        'invalid_grant' => 'Correo o contraseña incorrectos.',
        'email_not_confirmed' =>
          'Confirma tu correo con el enlace que te enviamos y vuelve a '
              'intentarlo.',
        'user_already_exists' ||
        'email_exists' => 'Ese correo ya tiene cuenta. Toca «Iniciar sesión».',
        'weak_password' =>
          'La contraseña es muy débil: usa al menos 6 caracteres.',
        'email_address_invalid' ||
        'validation_failed' => 'Revisa el correo: no parece válido.',
        'over_email_send_rate_limit' || 'over_request_rate_limit' =>
          'Demasiados intentos seguidos. Espera un minuto.',
        'signup_disabled' =>
          'La creación de cuentas con correo está desactivada por ahora.',
        _ => switch (action) {
          _AuthAction.google =>
            'No se pudo entrar con Google. Puedes usar tu correo mientras '
                'tanto.',
          _AuthAction.signUp =>
            'No se pudo crear la cuenta. Revisa los datos y la conexión.',
          _AuthAction.password =>
            'No se pudo iniciar sesión. Revisa tus datos y la conexión.',
        },
      };

  void _fail(String notice) {
    if (!mounted) return;
    setState(() {
      _busy = false;
      _notice = notice;
    });
  }

  Future<void> _authenticate(
    Future<void> Function(SupabaseAuthClient auth) step, {
    required _AuthAction action,
  }) async {
    final SupabaseAuthClient? auth = _auth;
    if (auth == null) return;
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      await step(auth);
    } on SupabaseAuthNetworkFailure {
      _fail(_networkNotice);
      return;
    } on SupabaseAuthFailure catch (failure) {
      _fail(_failureNotice(failure, action));
      return;
    }
    await _completeSignIn(auth);
  }

  /// Mounts the app only after Core accepts the new session.
  Future<void> _completeSignIn(SupabaseAuthClient auth) async {
    final int generation = ++_sessionGeneration;
    final PublicApiClient preflight = _createApiClient(auth);
    try {
      // An empty authorized feed is valid; a 401 means the account is not
      // admitted. Do not mount private navigation before this check.
      await preflight.listFeed(limit: 1, refresh: true);
    } on PublicApiFailure catch (failure) {
      if (failure.kind == PublicFailureKind.unauthorized) {
        auth.clearSession();
      }
      _fail(switch (failure.kind) {
        PublicFailureKind.unauthorized =>
          'La cuenta no está habilitada para la beta privada.',
        PublicFailureKind.network || PublicFailureKind.serviceUnavailable =>
          'La sesión se inició, pero Core no responde. Comprueba la conexión y vuelve a intentarlo.',
        _ => 'No se pudo comprobar el acceso privado. Inténtalo nuevamente.',
      });
      return;
    } finally {
      preflight.close();
    }
    if (!mounted) return;
    setState(() {
      _account = _GateAccount(auth, _signOut);
      _signedIn = true;
      _busy = false;
    });
    unawaited(_loadEditorialSession(auth, generation));
  }

  Future<void> _loadEditorialSession(
    SupabaseAuthClient auth,
    int generation,
  ) async {
    final EditorialApi api = EditorialApi(
      configuration: widget.apiConfiguration,
      tokenProvider: () => _accessToken(auth),
      httpClient: widget.apiHttpClient,
    );
    try {
      final EditorialSession? session = await api.session();
      if (mounted && _signedIn && generation == _sessionGeneration) {
        _editorialSession.value = session;
      }
    } finally {
      api.close();
    }
  }

  Future<String?> _accessToken(SupabaseAuthClient auth) async {
    try {
      return await auth.currentAccessToken();
    } on SupabaseAuthNetworkFailure {
      throw const PublicApiFailure(kind: PublicFailureKind.network);
    } on SupabaseAuthFailure {
      throw const PublicApiFailure(kind: PublicFailureKind.unauthorized);
    }
  }

  PublicApiClient _createApiClient(SupabaseAuthClient auth) => PublicApiClient(
    configuration: widget.apiConfiguration,
    httpClient: widget.apiHttpClient,
    authorizationTokenProvider: () => _accessToken(auth),
    maxAttempts: 1,
  );

  void _authorizationRejected() {
    if (!mounted) return;
    _auth?.clearSession();
    _sessionGeneration += 1;
    _editorialSession.value = null;
    setState(() {
      _signedIn = false;
      _busy = false;
      _notice =
          'La sesión venció o esta cuenta no está habilitada para la beta privada.';
    });
  }

  Future<void> _signOut() async {
    _sessionGeneration += 1;
    _editorialSession.value = null;
    final Future<void>? remoteSignOut = _auth?.signOut();
    if (mounted) {
      setState(() {
        _signedIn = false;
        _notice = null;
      });
    }
    await remoteSignOut;
  }

  @override
  Widget build(BuildContext context) {
    if (_signedIn && _auth != null) {
      return DialektikApp(
        environment: AppEnvironment.production,
        apiConfiguration: widget.apiConfiguration,
        publicApiHttpClient: widget.apiHttpClient,
        readOnlyNewsReaderEnabled: widget.readOnlyNewsReaderEnabled,
        arenaEnabled: widget.arenaEnabled,
        account: _account,
        initialRoute: widget.initialRoute,
        apiAccessTokenProvider: () => _accessToken(_auth!),
        onAuthorizationRejected: _authorizationRejected,
        betaNavigationActions: <Widget>[
          ValueListenableBuilder<EditorialSession?>(
            valueListenable: _editorialSession,
            builder: (context, session, _) {
              if (session == null) return const SizedBox.shrink();
              return IconButton(
                tooltip: 'Revisión editorial',
                icon: const Icon(Icons.fact_check_outlined),
                onPressed: () {
                  final SupabaseAuthClient? auth = _auth;
                  if (auth == null) return;
                  final EditorialApi api = EditorialApi(
                    configuration: widget.apiConfiguration,
                    tokenProvider: () => _accessToken(auth),
                    httpClient: widget.apiHttpClient,
                  );
                  Navigator.of(context).push<void>(
                    MaterialPageRoute<void>(
                      builder: (_) =>
                          EditorialQueueScreen(api: api, session: session),
                    ),
                  );
                },
              );
            },
          ),
          // In the Arena the account card in Perfil holds this action.
          if (!widget.arenaEnabled)
            IconButton(
              tooltip: 'Cerrar sesión',
              onPressed: () => unawaited(_signOut()),
              icon: const Icon(Icons.logout),
            ),
        ],
      );
    }
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Dialektik',
      theme: DialektikTheme.offWhite(loadInterFromDependency: false),
      home: _PrivateBetaLoginScreen(
        isLoading: _busy,
        notice: _notice,
        enabled: _auth != null,
        onSubmit: _signIn,
        onSignUp: _signUp,
        onGoogle: () => unawaited(_startGoogle()),
      ),
    );
  }
}

enum _AuthAction { password, signUp, google }

/// The signed-in reader as the Arena sees it.
final class _GateAccount extends ArenaAccount {
  _GateAccount(this._auth, this._signOut);

  final SupabaseAuthClient _auth;
  final Future<void> Function() _signOut;

  @override
  String? get email => _auth.currentUser?.email;

  @override
  String get alias => aliasFor(_auth.currentUser);

  @override
  Future<void> updateAlias(String alias) async {
    await _auth.updateAlias(alias);
    notifyListeners();
  }

  @override
  Future<void> signOut() => _signOut();
}

final class _PrivateBetaLoginScreen extends StatefulWidget {
  const _PrivateBetaLoginScreen({
    required this.isLoading,
    required this.enabled,
    required this.onSubmit,
    required this.onSignUp,
    required this.onGoogle,
    this.notice,
  });

  final bool isLoading;
  final bool enabled;
  final String? notice;
  final PrivateBetaSignIn onSubmit;
  final PrivateBetaSignUp onSignUp;
  final VoidCallback onGoogle;

  @override
  State<_PrivateBetaLoginScreen> createState() =>
      _PrivateBetaLoginScreenState();
}

final class _PrivateBetaLoginScreenState
    extends State<_PrivateBetaLoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _alias = TextEditingController();
  bool _creating = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _alias.dispose();
    super.dispose();
  }

  bool get _ready => widget.enabled && !widget.isLoading;

  void _submit({required bool create}) {
    setState(() => _creating = create);
    if (!_ready || !_formKey.currentState!.validate()) return;
    final String alias = _alias.text.trim();
    if (create) {
      unawaited(
        widget.onSignUp(
          _email.text,
          _password.text,
          alias.isEmpty ? null : alias,
        ),
      );
    } else {
      unawaited(widget.onSubmit(_email.text, _password.text));
    }
    _password.clear();
  }

  InputDecoration _decoration(String label, {String? helper}) =>
      InputDecoration(
        labelText: label,
        helperText: helper,
        helperMaxLines: 3,
        errorMaxLines: 3,
        filled: true,
        fillColor: ArenaColors.card,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
      );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: ArenaColors.background,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 440),
            child: ListView(
              key: const Key('login-scroll'),
              shrinkWrap: true,
              padding: const EdgeInsets.fromLTRB(20, 24, 20, 32),
              children: <Widget>[
                const Text('Dialektik', style: ArenaText.brand),
                const SizedBox(height: 6),
                const Align(
                  alignment: Alignment.centerLeft,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: ArenaColors.violetSoft,
                      borderRadius: BorderRadius.all(Radius.circular(999)),
                    ),
                    child: Padding(
                      padding: EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 4,
                      ),
                      child: Text(
                        'Beta privada',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: ArenaColors.violetDeep,
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                const Text(
                  'Únete al Coliseo',
                  style: TextStyle(
                    fontFamily: ArenaText.serif,
                    fontSize: 24,
                    fontWeight: FontWeight.w700,
                    color: ArenaColors.ink,
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Con tu cuenta puedes votar en los duelos VS, aportar '
                  'evidencia y debatir en la comunidad.',
                  style: ArenaText.body,
                ),
                const SizedBox(height: 20),
                OutlinedButton(
                  key: const Key('login-google'),
                  onPressed: _ready ? widget.onGoogle : null,
                  style: OutlinedButton.styleFrom(
                    backgroundColor: ArenaColors.card,
                    foregroundColor: ArenaColors.ink,
                    side: const BorderSide(color: ArenaColors.border),
                    minimumSize: const Size(48, 52),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 12,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  child: const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: <Widget>[
                      Text(
                        'G',
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                          color: Color(0xFF4285F4),
                        ),
                      ),
                      SizedBox(width: 10),
                      Flexible(
                        child: Text(
                          'Continuar con Google',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),
                const Row(
                  children: <Widget>[
                    Expanded(child: Divider(color: ArenaColors.border)),
                    Padding(
                      padding: EdgeInsets.symmetric(horizontal: 10),
                      child: Text('o con tu correo', style: ArenaText.meta),
                    ),
                    Expanded(child: Divider(color: ArenaColors.border)),
                  ],
                ),
                const SizedBox(height: 14),
                Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      TextFormField(
                        key: const Key('login-email'),
                        controller: _email,
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const <String>[AutofillHints.email],
                        decoration: _decoration('Correo electrónico'),
                        validator: (String? value) =>
                            value != null && value.contains('@')
                            ? null
                            : 'Ingresa un correo válido.',
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        key: const Key('login-password'),
                        controller: _password,
                        obscureText: true,
                        autofillHints: const <String>[AutofillHints.password],
                        onFieldSubmitted: (_) => _submit(create: false),
                        decoration: _decoration('Contraseña'),
                        validator: (String? value) {
                          if (value == null || value.isEmpty) {
                            return 'Ingresa tu contraseña.';
                          }
                          if (_creating && value.length < 6) {
                            return 'Usa al menos 6 caracteres.';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        key: const Key('login-alias'),
                        controller: _alias,
                        maxLength: 30,
                        decoration: _decoration(
                          'Alias público (opcional)',
                          helper:
                              'Si lo dejas vacío usamos la parte de tu '
                              'correo antes de @. Puedes cambiarlo en '
                              'Perfil.',
                        ),
                      ),
                      if (widget.notice != null) ...<Widget>[
                        const SizedBox(height: 8),
                        Text(
                          widget.notice!,
                          key: const Key('login-notice'),
                          style: const TextStyle(color: ArenaColors.amberDeep),
                        ),
                      ],
                      const SizedBox(height: 16),
                      FilledButton(
                        key: const Key('login-submit'),
                        onPressed: _ready ? () => _submit(create: false) : null,
                        style: FilledButton.styleFrom(
                          backgroundColor: ArenaColors.violet,
                          minimumSize: const Size(48, 50),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                        child: widget.isLoading
                            ? const SizedBox.square(
                                dimension: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Text(
                                'Iniciar sesión',
                                style: TextStyle(fontWeight: FontWeight.w700),
                              ),
                      ),
                      const SizedBox(height: 10),
                      OutlinedButton(
                        key: const Key('login-sign-up'),
                        onPressed: _ready ? () => _submit(create: true) : null,
                        style: OutlinedButton.styleFrom(
                          foregroundColor: ArenaColors.violet,
                          side: const BorderSide(color: ArenaColors.violet),
                          minimumSize: const Size(48, 50),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                        child: const Text(
                          'Crear cuenta gratis',
                          style: TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
