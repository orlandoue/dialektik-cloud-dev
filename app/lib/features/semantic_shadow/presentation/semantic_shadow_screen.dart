import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/live/presentation/live_components.dart';
import 'package:dialektik/features/semantic/presentation/editorial_components.dart';
import 'package:dialektik/features/semantic_shadow/data/semantic_shadow_models.dart';
import 'package:dialektik/features/semantic_shadow/data/semantic_shadow_repository.dart';
import 'package:flutter/material.dart';

// dialektik:epistemic-component

final class SemanticShadowScreen extends StatefulWidget {
  const SemanticShadowScreen({
    required this.repository,
    required this.onOpenArticle,
    required this.onOpenSource,
    super.key,
  });
  final SemanticShadowRepository repository;
  final ValueChanged<String> onOpenArticle;
  final ValueChanged<String> onOpenSource;
  @override
  State<SemanticShadowScreen> createState() => _SemanticShadowScreenState();
}

final class _SemanticShadowScreenState extends State<SemanticShadowScreen> {
  late PublicRequestToken _token;
  late Future<SemanticShadowPreflightDto> _future;
  void _load(bool refresh) {
    _token = PublicRequestToken();
    _future = widget.repository.getSemanticShadowPreflight(
      refresh: refresh,
      requestToken: _token,
    );
  }

  @override
  void initState() {
    super.initState();
    _load(false);
  }

  @override
  void dispose() {
    _token.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => EditorialScaffold(
    title: 'Input semántico',
    eyebrow: 'SEMANTIC SHADOW · NO AUTORITATIVO',
    location: 'Inspección de desarrollo',
    homeRoute: '/live/news',
    homeLabel: 'Noticias',
    dataIndicator: Builder(
      builder: (BuildContext navigationContext) => Text(
        'SHADOW',
        style: Theme.of(navigationContext).textTheme.bodyMedium?.copyWith(
          color: navigationContext.surfaceColors.muted,
        ),
      ),
    ),
    scrollKey: const PageStorageKey<String>('semantic-shadow-preflight'),
    child: FutureBuilder<SemanticShadowPreflightDto>(
      future: _future,
      builder:
          (
            BuildContext context,
            AsyncSnapshot<SemanticShadowPreflightDto> snapshot,
          ) {
            if (snapshot.hasError) {
              return EditorialEmptyState(
                title: 'No pudimos verificar el input.',
                description:
                    'No se muestran resultados del candidato. '
                    'Puedes reintentar o volver a las noticias.',
                action: EditorialTextButton(
                  onPressed: () => setState(() {
                    _token.cancel();
                    _load(true);
                  }),
                  child: const Text('Reintentar'),
                ),
              );
            }
            final SemanticShadowPreflightDto? receipt = snapshot.data;
            if (receipt == null) return const EditorialLoading();
            return _content(context, receipt);
          },
    ),
  );

  Widget _content(
    BuildContext context,
    SemanticShadowPreflightDto receipt,
  ) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: <Widget>[
      const SectionHeading(title: 'V10.11 no se ha ejecutado'),
      Text('0 noticias elegibles · ${receipt.articles.length} omitidas'),
      const SizedBox(height: EditorialLayout.detailGap),
      const Text(
        'Las noticias disponibles contienen un extracto RSS y no incluyen '
        'el cuerpo completo de la fuente que exige el candidato congelado. '
        'El titular o el extracto no sustituyen ese texto.',
      ),
      const SizedBox(height: EditorialLayout.sectionGap),
      const SectionHeading(title: 'No hay un grafo shadow'),
      const Text(
        'No se han propuesto eventos ni historias. No hay observaciones '
        'ni resultados MATCH, DISTINCT o UNKNOWN. Las noticias LIVE '
        'siguen sin asignación semántica (UNASSIGNED).',
      ),
      const SizedBox(height: EditorialLayout.sectionGap),
      SectionHeading(
        title: receipt.registryAuthenticated
            ? 'Exclusión permanente verificada'
            : 'Verificación de exclusión incompleta',
      ),
      Text(
        receipt.registryAuthenticated
            ? 'Los inputs inspeccionados están excluidos del futuro holdout final.'
            : 'La autenticación del registro no está completa. La ejecución '
                  'permanece bloqueada; esta vista no confirma la exclusión.',
      ),
      const SizedBox(height: EditorialLayout.sectionGap),
      const SectionHeading(title: 'Texto necesario para continuar'),
      EditorialTextButton(
        onPressed: () =>
            Navigator.of(context).pushNamed('/shadow/semantic/content'),
        child: const Text('Inspeccionar acceso y memoria semántica'),
      ),
      const Text(
        'Cuerpo original completo con autorización del publisher para este uso, '
        'junto con el titular, la identidad y dirección de la fuente, '
        'las fechas de publicación y primera disponibilidad con zona horaria, '
        'el idioma declarado o su ausencia y la exclusión permanente. '
        'Las anclas deben conservar los hashes de los campos originales '
        'y sus offsets exactos. '
        'Contar con ese input no garantiza una asociación.',
      ),
      const SizedBox(height: EditorialLayout.sectionGap),
      const SectionHeading(title: 'Noticias inspeccionadas'),
      for (final SemanticShadowArticleDto article in receipt.articles)
        Padding(
          padding: const EdgeInsets.only(bottom: EditorialLayout.cardGap),
          child: _article(context, article),
        ),
      LiveTechnicalDetails(
        disclosureKey: const PageStorageKey<String>('shadow-receipt-details'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const LiveDetailLine(
              'Commit del candidato congelado',
              SemanticShadowPreflightDto.candidateCommit,
            ),
            const LiveDetailLine(
              'Versión declarada',
              SemanticShadowPreflightDto.candidateVersion,
            ),
            const LiveDetailLine(
              'Runtime declarado · sin ejecución',
              'Python 3.11.9 · model none',
            ),
            const LiveDetailLine(
              'Contrato de input',
              'FULL_SOURCE_TEXT · campo text · title_only no permitido',
            ),
            const LiveDetailLine(
              'Ejecuciones',
              'Lotes de producto 0 · inputs del candidato 0 · '
                  'replays de determinismo 0 · holdout final 0',
            ),
            LiveDetailLine(
              'Identidad del registro de exclusión',
              receipt.registryActualSha256,
            ),
            LiveDetailLine('Filas del registro', '${receipt.registryRowCount}'),
          ],
        ),
      ),
    ],
  );

  Widget _article(
    BuildContext context,
    SemanticShadowArticleDto article,
  ) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(EditorialLayout.cardPadding),
    decoration: BoxDecoration(
      border: Border.all(
        color: context.surfaceColors.divider,
        width: DialektikBorders.hairlineWidth,
      ),
      borderRadius: DialektikRadii.mediumBorderRadius,
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        EditorialTextButton(
          semanticLabel: 'Leer noticia: ${article.headline}',
          onPressed: () => widget.onOpenArticle(article.id),
          child: Text(article.headline),
        ),
        EditorialTextButton(
          semanticLabel: 'Consultar fuente: ${article.sourceName}',
          onPressed: () => widget.onOpenSource(article.sourceId),
          child: Text(article.sourceName),
        ),
        Text(liveLocalDate(article.publishedAt)),
        const SizedBox(height: EditorialLayout.detailGap),
        const Text(
          'Omitida · falta el cuerpo completo de la fuente. '
          'Disponible: extracto RSS; cuerpo ausente.',
        ),
        LiveTechnicalDetails(
          disclosureKey: PageStorageKey<String>('shadow-article-${article.id}'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              LiveDetailLine('Article ID', article.id),
              LiveDetailLine('GUID original', article.sourceItemId),
              LiveDetailLine(
                'Dirección original',
                article.canonicalUrl.toString(),
              ),
              LiveDetailLine(
                'Publicación · UTC exacta',
                liveExactDate(article.publishedAt),
              ),
              const LiveDetailLine(
                'Clasificación del input',
                'INVALID_FOR_CANDIDATE · FULL_SOURCE_REQUIRED',
              ),
              LiveDetailLine(
                'Primera disponibilidad · UTC exacta',
                liveExactDate(article.firstAvailableAt),
              ),
              LiveDetailLine('Idioma declarado', article.language),
              LiveDetailLine(
                'SHA-256 del contenido permitido',
                article.authorizedContentSha256,
              ),
              LiveDetailLine(
                'Firma del contenido permitido',
                article.authorizedContentSignature,
              ),
              LiveDetailLine(
                'SHA-256 de la representación almacenada · no es input del candidato',
                article.permittedRepresentationSha256,
              ),
              LiveDetailLine(
                'Exclusión de esta noticia',
                article.exclusionVerified ? 'Verificada' : 'Sin verificar',
              ),
              const LiveDetailLine(
                'Asignación autoritativa LIVE',
                'UNASSIGNED',
              ),
            ],
          ),
        ),
      ],
    ),
  );
}
