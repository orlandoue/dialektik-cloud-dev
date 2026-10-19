import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/semantic/data/semantic_models.dart';
import 'package:dialektik/features/semantic/presentation/editorial_components.dart';
import 'package:dialektik/features/semantic/presentation/editorial_vocabulary.dart';
import 'package:flutter/material.dart';

// dialektik:epistemic-component

/// Reader-facing context derived solely from the returned story and observation.
final class StoryContextCard extends StatelessWidget {
  const StoryContextCard({
    required this.occurrence,
    required this.thread,
    this.articleId,
    this.membership,
    this.onOpenStory,
    this.onOpenEvent,
    super.key,
  });

  final SemanticOccurrenceDto occurrence;
  final SemanticThreadDetailDto thread;
  final String? articleId;
  final SemanticMembershipDto? membership;
  final VoidCallback? onOpenStory;
  final VoidCallback? onOpenEvent;

  @override
  Widget build(BuildContext context) {
    final SemanticMembershipDto? association = membership ?? _membership;
    final SemanticArticleDto? article = _article;
    final SemanticDecision decision = articleId == null
        ? occurrence.state.decision
        : association?.decision ??
              article?.decision ??
              SemanticDecision.unknown;
    final SemanticApplicability applicability = articleId == null
        ? occurrence.state.applicability
        : association?.applicability ??
              article?.applicability ??
              SemanticApplicability.unknown;
    final int stageIndex = thread.occurrences.indexWhere(
      (SemanticOccurrenceDto item) => item.id == occurrence.id,
    );
    final bool knownStage =
        stageIndex >= 0 &&
        occurrence.eventAt != null &&
        decision != SemanticDecision.unknown &&
        applicability == SemanticApplicability.applicable &&
        (articleId == null || decision == SemanticDecision.match);
    final Map<String, SemanticSourceDto> otherSources =
        <String, SemanticSourceDto>{
          for (final SemanticSourceDto source in occurrence.sources)
            if (source.id != article?.source.id) source.id: source,
        };
    final DialektikEpistemicColors palette = Theme.of(
      context,
    ).extension<DialektikEpistemicColors>()!;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(DialektikSpacing.space6),
      decoration: BoxDecoration(
        border: Border.all(
          color: palette.line,
          width: DialektikBorders.hairlineWidth,
        ),
        borderRadius: DialektikRadii.mediumBorderRadius,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Semantics(
            header: true,
            child: Text(
              articleId == null
                  ? 'Este evento en la historia'
                  : 'Dónde encaja esta noticia',
              style: Theme.of(context).textTheme.titleLarge,
            ),
          ),
          const SizedBox(height: DialektikSpacing.space6),
          if (articleId != null)
            Text('Historia', style: Theme.of(context).textTheme.bodyLarge),
          Text(
            editorialTitle(thread.thread.title),
            style: Theme.of(context).textTheme.titleLarge,
          ),
          if (articleId != null) ...<Widget>[
            const SizedBox(height: DialektikSpacing.space6),
            Text('Evento', style: Theme.of(context).textTheme.bodyLarge),
            Text(
              editorialTitle(occurrence.title),
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ],
          const SizedBox(height: DialektikSpacing.space4),
          if (knownStage)
            Text('Etapa ${stageIndex + 1} de ${thread.occurrences.length}')
          else if (decision == SemanticDecision.unknown)
            UnknownRelationshipCard(
              description: articleId == null
                  ? 'La relación de este evento con la historia está sin resolver. Todavía no se puede situar en una etapa.'
                  : 'La asociación con este evento está sin resolver. Todavía no se puede situar esta noticia en una etapa de la historia.',
            )
          else if (occurrence.eventAt == null)
            const Text(
              'Fecha del evento sin determinar; su lugar temporal aún no está definido.',
            )
          else
            Text(
              articleId == null
                  ? 'La etapa de este evento no está determinada.'
                  : 'La asociación no sitúa esta noticia en una etapa.',
            ),
          if (articleId != null &&
              (decision != SemanticDecision.match ||
                  applicability != SemanticApplicability.applicable))
            SemanticStatusLabel(
              state: SemanticStateValueDto(
                description: switch (decision) {
                  SemanticDecision.match => 'Asociación registrada',
                  SemanticDecision.distinct => 'Asociación distinta',
                  SemanticDecision.unknown => 'Asociación sin resolver',
                },
                decision: decision,
                applicability: applicability,
              ),
              showApplicability: true,
            ),
          if (articleId != null) ...<Widget>[
            const SizedBox(height: DialektikSpacing.space6),
            const Text('Otras fuentes disponibles en este evento'),
            if (otherSources.isEmpty)
              const Text('No hay otras fuentes disponibles en este evento.')
            else ...<Widget>[
              SourceCollection(
                sources: otherSources.values.toList(growable: false),
                onOpenSource: (String id) => Navigator.of(
                  context,
                ).pushNamed('/sources/${Uri.encodeComponent(id)}'),
              ),
            ],
          ],
          const SizedBox(height: DialektikSpacing.space4),
          Wrap(
            spacing: DialektikSpacing.space4,
            children: <Widget>[
              EditorialTextButton(
                onPressed:
                    onOpenStory ??
                    () => Navigator.of(context).pushNamed(
                      '/threads/${Uri.encodeComponent(thread.thread.id)}',
                    ),
                child: const Text('Ver historia completa'),
              ),
              if (articleId != null)
                EditorialTextButton(
                  onPressed:
                      onOpenEvent ??
                      () => Navigator.of(context).pushNamed(
                        '/occurrences/${Uri.encodeComponent(occurrence.id)}',
                      ),
                  child: const Text('Ver evento y noticias'),
                ),
            ],
          ),
        ],
      ),
    );
  }

  SemanticMembershipDto? get _membership {
    for (final SemanticMembershipDto item in thread.timeline.arrivals) {
      if (item.articleId == articleId && item.occurrenceId == occurrence.id) {
        return item;
      }
    }
    return null;
  }

  SemanticArticleDto? get _article {
    for (final SemanticArticleDto item in occurrence.articles) {
      if (item.id == articleId) return item;
    }
    for (final SemanticOccurrenceDto event in thread.occurrences) {
      for (final SemanticArticleDto item in event.articles) {
        if (item.id == articleId) return item;
      }
    }
    return null;
  }
}
