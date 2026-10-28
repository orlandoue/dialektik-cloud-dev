import 'dart:async';

import 'package:dialektik/app/dialektik_app.dart';
import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/design_system/theme/dialektik_theme.dart';
import 'package:dialektik/features/consumer/data/public_api_client.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/private_beta/data/supabase_auth_client.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

typedef PrivateBetaSignIn =
    Future<void> Function(String email, String password);

/// Keeps the production consumer tree behind Supabase Auth and Core allowlisting.
final class PrivateBetaGate extends StatefulWidget {
  const PrivateBetaGate({
    required this.apiConfiguration,
    required this.supabaseUrl,
    required this.publishableKey,
    required this.initialRoute,
    this.readOnlyNewsReaderEnabled = false,
    this.authHttpClient,
    this.apiHttpClient,
    this.authClock,
    super.key,
  });

  final ApiConfiguration apiConfiguration;
  final String supabaseUrl;
  final String publishableKey;
  final String initialRoute;
  final bool readOnlyNewsReaderEnabled;
  final http.Client? authHttpClient;
  final http.Client? apiHttpClient;
  final DateTime Function()? authClock;

  @override
  State<PrivateBetaGate> createState() => _PrivateBetaGateState();
}

final class _PrivateBetaGateState extends State<PrivateBetaGate> {
  SupabaseAuthClient? _auth;
  bool _signedIn = false;
  bool _busy = false;
  String? _notice;

  @override
  void initState() {
    super.initState();
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
    _auth?.close();
    super.dispose();
  }

  Future<void> _signIn(String email, String password) async {
    final SupabaseAuthClient? auth = _auth;
    if (auth == null) return;
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      await auth.signInWithPassword(email: email, password: password);
      final PublicApiClient preflight = _createApiClient(auth);
      try {
        // An empty authorized feed is valid; a 401 means the account is not
        // allowlisted. Do not mount private navigation before this check.
        await preflight.listFeed(limit: 1, refresh: true);
      } on PublicApiFailure catch (failure) {
        if (failure.kind == PublicFailureKind.unauthorized) {
          auth.clearSession();
        }
        if (!mounted) return;
        setState(() {
          _busy = false;
          _notice = switch (failure.kind) {
            PublicFailureKind.unauthorized =>
              'La cuenta no está habilitada para la beta privada.',
            PublicFailureKind.network || PublicFailureKind.serviceUnavailable =>
              'La sesión se inició, pero Core no responde. Comprueba la conexión y vuelve a intentarlo.',
            _ =>
              'No se pudo comprobar el acceso privado. Inténtalo nuevamente.',
          };
        });
        return;
      } finally {
        preflight.close();
      }
      if (!mounted) return;
      setState(() {
        _signedIn = true;
        _busy = false;
      });
    } on SupabaseAuthNetworkFailure {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _notice =
            'No se pudo conectar con el inicio de sesión. Inténtalo nuevamente.';
      });
    } on SupabaseAuthFailure {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _notice =
            'No se pudo iniciar sesión. Revisa la cuenta invitada y la conexión.';
      });
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
    _auth?.clearSession();
    if (!mounted) return;
    setState(() {
      _signedIn = false;
      _busy = false;
      _notice =
          'La sesión venció o esta cuenta no está habilitada para la beta privada.';
    });
  }

  Future<void> _signOut() async {
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
        initialRoute: widget.initialRoute,
        apiAccessTokenProvider: () => _accessToken(_auth!),
        onAuthorizationRejected: _authorizationRejected,
        betaNavigationActions: <Widget>[
          IconButton(
            tooltip: 'Cerrar sesión',
            onPressed: () => unawaited(_signOut()),
            icon: const Icon(Icons.logout),
          ),
        ],
      );
    }
    return MaterialApp(
      title: 'Dialektik',
      theme: DialektikTheme.offWhite(loadInterFromDependency: false),
      home: _PrivateBetaLoginScreen(
        isLoading: _busy,
        notice: _notice,
        enabled: _auth != null,
        onSubmit: _signIn,
      ),
    );
  }
}

final class _PrivateBetaLoginScreen extends StatefulWidget {
  const _PrivateBetaLoginScreen({
    required this.isLoading,
    required this.enabled,
    required this.onSubmit,
    this.notice,
  });

  final bool isLoading;
  final bool enabled;
  final String? notice;
  final PrivateBetaSignIn onSubmit;

  @override
  State<_PrivateBetaLoginScreen> createState() =>
      _PrivateBetaLoginScreenState();
}

final class _PrivateBetaLoginScreenState
    extends State<_PrivateBetaLoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  void _submit() {
    if (!widget.enabled ||
        widget.isLoading ||
        !_formKey.currentState!.validate()) {
      return;
    }
    unawaited(widget.onSubmit(_email.text, _password.text));
    _password.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 440),
            child: ListView(
              shrinkWrap: true,
              padding: const EdgeInsets.all(24),
              children: <Widget>[
                Text(
                  'Dialéktik',
                  style: Theme.of(context).textTheme.headlineLarge,
                ),
                const SizedBox(height: 12),
                Text(
                  'Beta privada',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 8),
                const Text(
                  'Inicia sesión con una cuenta invitada y habilitada por el responsable de la beta.',
                ),
                const SizedBox(height: 24),
                Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      TextFormField(
                        controller: _email,
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const <String>[AutofillHints.username],
                        decoration: const InputDecoration(labelText: 'Correo'),
                        validator: (String? value) =>
                            value != null && value.contains('@')
                            ? null
                            : 'Ingresa un correo válido.',
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _password,
                        obscureText: true,
                        autofillHints: const <String>[AutofillHints.password],
                        onFieldSubmitted: (_) => _submit(),
                        decoration: const InputDecoration(
                          labelText: 'Contraseña',
                        ),
                        validator: (String? value) =>
                            value != null && value.isNotEmpty
                            ? null
                            : 'Ingresa tu contraseña.',
                      ),
                      if (widget.notice != null) ...<Widget>[
                        const SizedBox(height: 12),
                        Text(
                          widget.notice!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ],
                      const SizedBox(height: 20),
                      FilledButton(
                        onPressed: widget.enabled && !widget.isLoading
                            ? _submit
                            : null,
                        child: widget.isLoading
                            ? const SizedBox.square(
                                dimension: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Text('Iniciar sesión'),
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
