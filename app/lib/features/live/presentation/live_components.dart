import 'dart:async';
import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/consumer/presentation/widgets/consumer_responsive_shell.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/semantic/presentation/editorial_components.dart';
import 'package:dialektik/features/semantic/presentation/editorial_vocabulary.dart';
import 'package:flutter/material.dart';

// dialektik:epistemic-component

final class LiveReaderScaffold extends StatelessWidget {
  const LiveReaderScaffold({
    required this.title,
    required this.child,
    this.isRoot = false,
    this.location,
    this.scrollKey,
    this.navigationActions = const <Widget>[],
    super.key,
  });
  final String title;
  final Widget child;
  final bool isRoot;
  final String? location;
  final Key? scrollKey;
  final List<Widget> navigationActions;
  @override
  Widget build(BuildContext context) => ConsumerResponsiveShell(
    title: title,
    body: child,
    location: location,
    navigationActions: navigationActions,
    scrollBody: true,
    scrollKey: scrollKey,
    showBack: !isRoot,
  );
}

final class LiveUnassignedContext extends StatelessWidget {
  const LiveUnassignedContext({super.key});
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(EditorialLayout.cardPadding),
    decoration: BoxDecoration(
      border: Border.all(
        color: context.surfaceColors.divider,
        width: DialektikBorders.hairlineWidth,
      ),
      borderRadius: DialektikRadii.mediumBorderRadius,
    ),
    child: const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        SectionHeading(title: 'Historia aún no determinada'),
        Text(
          'Dialektik aún no ha vinculado esta noticia a una historia o a un evento.',
        ),
      ],
    ),
  );
}

final class LiveSourceLink extends StatelessWidget {
  const LiveSourceLink({
    required this.source,
    required this.onPressed,
    super.key,
  });
  final LiveSourceDto source;
  final VoidCallback onPressed;
  @override
  Widget build(BuildContext context) => EditorialTextButton(
    semanticLabel: 'Consultar fuente: ${source.name}',
    onPressed: onPressed,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(source.name),
        Text(
          source.canonicalDomain,
          style: Theme.of(
            context,
          ).textTheme.bodyMedium?.copyWith(color: context.surfaceColors.muted),
        ),
      ],
    ),
  );
}

final class LiveExternalAction extends StatefulWidget {
  const LiveExternalAction({
    required this.uri,
    required this.opener,
    this.label = 'Abrir en la fuente',
    super.key,
  });
  final Uri uri;
  final ExternalLinkOpener opener;
  final String label;
  @override
  State<LiveExternalAction> createState() => _LiveExternalActionState();
}

final class _LiveExternalActionState extends State<LiveExternalAction> {
  bool _busy = false;
  bool _failed = false;
  Future<void> _open() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _failed = false;
    });
    bool opened = false;
    try {
      opened = await widget.opener(widget.uri);
    } on Exception {
      opened = false;
    }
    if (!mounted) return;
    setState(() {
      _busy = false;
      _failed = !opened;
    });
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: <Widget>[
      EditorialTextButton(
        onPressed: () => unawaited(_open()),
        semanticLabel: widget.label,
        child: Text(_busy ? 'Abriendo…' : widget.label),
      ),
      if (_failed) ...<Widget>[
        const SizedBox(height: DialektikSpacing.space3),
        Semantics(
          liveRegion: true,
          child: const Text(
            'No se pudo abrir el enlace. Puedes copiar esta dirección:',
          ),
        ),
        Semantics(
          container: true,
          label: 'Dirección original: ${widget.uri}',
          child: ExcludeSemantics(
            child: SelectableText(
              widget.uri.toString(),
              key: const PageStorageKey<String>('live-failed-external-url'),
            ),
          ),
        ),
      ],
    ],
  );
}

final class LiveTechnicalDetails extends StatelessWidget {
  const LiveTechnicalDetails({
    required this.child,
    this.title = 'Detalles técnicos',
    this.disclosureKey = const PageStorageKey<String>(
      'live-technical-disclosure',
    ),
    super.key,
  });
  final Widget child;
  final String title;
  final Key disclosureKey;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: EditorialLayout.sectionGap),
    child: ExpansionTile(
      key: disclosureKey,
      title: Text(title),
      tilePadding: EdgeInsets.zero,
      childrenPadding: const EdgeInsets.only(bottom: DialektikSpacing.space6),
      expandedAlignment: Alignment.centerLeft,
      children: <Widget>[child],
    ),
  );
}

final class LiveDetailLine extends StatelessWidget {
  const LiveDetailLine(this.label, this.value, {super.key});
  final String label;
  final String? value;
  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    label: '$label: ${value ?? 'No indicado por la fuente'}',
    child: ExcludeSemantics(
      child: Padding(
        padding: const EdgeInsets.only(bottom: DialektikSpacing.space6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              label,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: context.surfaceColors.muted,
              ),
            ),
            const SizedBox(height: DialektikSpacing.space2),
            SelectableText(
              value ?? 'No indicado por la fuente',
              key: PageStorageKey<String>('live-detail-$label'),
            ),
          ],
        ),
      ),
    ),
  );
}

String liveLocalDate(DateTime value) => editorialDate(value, includeTime: true);
String liveExactDate(DateTime value) => editorialDate(value, exact: true);
String liveAcquisitionChannel(String value) => switch (value) {
  'rss_atom' => 'RSS / Atom',
  _ => value,
};
String liveSourceType(String value) => switch (value) {
  'NEWS_MEDIA' => 'Medio de comunicación',
  'news_agency' => 'Agencia de noticias',
  'other' => 'Otra',
  'PRIMARY_INSTITUTION' => 'Institución',
  'PRIMARY_DOCUMENT' => 'Documento primario',
  _ => value.replaceAll('_', ' '),
};

String liveFailureTitle(
  Object? error, {
  String notFoundTitle = 'Este registro ya no está disponible.',
}) {
  if (error is! PublicApiFailure) return 'No pudimos cargar esta información.';
  return switch (error.kind) {
    PublicFailureKind.notFound => notFoundTitle,
    PublicFailureKind.gone => 'Esta noticia ya no está disponible.',
    PublicFailureKind.unauthorized =>
      'Tu sesión ya no está autorizada. Inicia sesión nuevamente.',
    PublicFailureKind.network =>
      'No pudimos conectar con Dialektik. Revisa tu conexión e inténtalo otra vez.',
    PublicFailureKind.serviceUnavailable =>
      'El servicio no está disponible en este momento.',
    PublicFailureKind.rateLimited =>
      'Hay muchas solicitudes. Espera un momento y vuelve a intentar.',
    PublicFailureKind.invalidRequest => 'La solicitud no es válida.',
    PublicFailureKind.analysisUnavailable =>
      'Esta función no está disponible en este momento.',
    PublicFailureKind.invalidResponse =>
      'El servicio devolvió una respuesta que no pudimos validar.',
    PublicFailureKind.cancelled => 'La carga fue cancelada.',
  };
}

final class LiveReader<T> extends StatefulWidget {
  const LiveReader({
    required this.title,
    this.notFoundTitle = 'Este registro ya no está disponible.',
    required this.identity,
    required this.load,
    required this.content,
    this.titleOf,
    this.location,
    this.navigationActions = const <Widget>[],
    super.key,
  });
  final String title;
  final String notFoundTitle;
  final Object identity;
  final Future<T> Function(PublicRequestToken token, bool refresh) load;
  final Widget Function(BuildContext context, T value) content;
  final String Function(T value)? titleOf;
  final String? location;
  final List<Widget> navigationActions;
  @override
  State<LiveReader<T>> createState() => _LiveReaderState<T>();
}

final class _LiveReaderState<T> extends State<LiveReader<T>> {
  late PublicRequestToken _token;
  late Future<T> _future;
  void _load(bool refresh) {
    _token = PublicRequestToken();
    _future = widget.load(_token, refresh);
  }

  @override
  void initState() {
    super.initState();
    _load(false);
  }

  @override
  void didUpdateWidget(covariant LiveReader<T> oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.identity != widget.identity) {
      _token.cancel();
      _load(false);
    }
  }

  @override
  void dispose() {
    _token.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<T>(
    future: _future,
    builder: (BuildContext context, AsyncSnapshot<T> snapshot) {
      final T? value = snapshot.connectionState == ConnectionState.done
          ? snapshot.data
          : null;
      return LiveReaderScaffold(
        title: value == null
            ? widget.title
            : widget.titleOf?.call(value) ?? widget.title,
        location: widget.location,
        navigationActions: widget.navigationActions,
        scrollKey: PageStorageKey<Object>(widget.identity),
        child: snapshot.hasError
            ? EditorialEmptyState(
                title: liveFailureTitle(
                  snapshot.error,
                  notFoundTitle: widget.notFoundTitle,
                ),
                description:
                    'Puedes volver a intentarlo o regresar a las noticias.',
                action: EditorialTextButton(
                  onPressed: () => setState(() {
                    _token.cancel();
                    _load(true);
                  }),
                  child: const Text('Reintentar'),
                ),
              )
            : value == null
            ? const EditorialLoading()
            : widget.content(context, value),
      );
    },
  );
}
