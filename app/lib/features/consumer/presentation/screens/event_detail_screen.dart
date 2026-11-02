import 'dart:async';

import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/consumer/presentation/localization/consumer_strings.dart';
import 'package:dialektik/features/consumer/presentation/state/event_controller.dart';
import 'package:dialektik/features/consumer/presentation/widgets/consumer_scaffold.dart';
import 'package:dialektik/features/consumer/presentation/widgets/system_state_view.dart';
import 'package:flutter/material.dart';

final class EventDetailScreen extends StatefulWidget {
  const EventDetailScreen({
    required this.eventId,
    required this.repository,
    required this.externalLinkOpener,
    required this.onOpenEvent,
    required this.onOpenSource,
    this.isDemo = false,
    this.navigationActions = const <Widget>[],
    super.key,
  });

  final String eventId;
  final ConsumerRepository repository;
  final ExternalLinkOpener externalLinkOpener;
  final ValueChanged<String> onOpenEvent;
  final ValueChanged<String> onOpenSource;
  final bool isDemo;
  final List<Widget> navigationActions;

  @override
  State<EventDetailScreen> createState() => _EventDetailScreenState();
}

final class _EventDetailScreenState extends State<EventDetailScreen> {
  late final EventController _controller = EventController(
    eventId: widget.eventId,
    repository: widget.repository,
  );

  @override
  void initState() {
    super.initState();
    unawaited(_controller.load());
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _openArticle(Uri uri) async {
    final bool opened = await widget.externalLinkOpener(uri);
    if (!opened && mounted) {
      final ConsumerStrings strings = ConsumerStrings.of(context);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(strings.externalLinkFailed)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final ConsumerStrings strings = ConsumerStrings.of(context);
    return ConsumerScaffold(
      title: strings.feedTitle,
      isDemo: widget.isDemo,
      navigationActions: widget.navigationActions,
      showBack: true,
      body: AnimatedBuilder(
        animation: _controller,
        builder: (BuildContext context, Widget? child) {
          return switch (_controller.phase) {
            EventPhase.initial || EventPhase.loading => SystemStateView(
              message: strings.loadingEvent,
              isLoading: true,
            ),
            EventPhase.error => SystemStateView(
              message: strings.errorForName(_controller.failure!.kind.name),
              actionLabel: strings.retry,
              onAction: () => unawaited(_controller.refresh()),
            ),
            EventPhase.gone => _GoneEvent(
              tombstone: _controller.tombstone!,
              onOpenEvent: widget.onOpenEvent,
            ),
            EventPhase.content => _EventContent(
              controller: _controller,
              onOpenArticle: (Uri value) => unawaited(_openArticle(value)),
              onOpenSource: widget.onOpenSource,
            ),
          };
        },
      ),
    );
  }
}

final class _EventContent extends StatelessWidget {
  const _EventContent({required this.controller, required this.onOpenArticle, required this.onOpenSource});
  final EventController controller;
  final ValueChanged<Uri> onOpenArticle;
  final ValueChanged<String> onOpenSource;

  @override
  Widget build(BuildContext context) {
    final strings = ConsumerStrings.of(context);
    final event = controller.event!;
    final assertions = <PublicAssertionDto>[
      for (final position in controller.positions)
        ...?controller.positionDetails[position.id]?.assertions,
    ];
    final articles = <String, PublicAssertionDto>{};
    for (final assertion in assertions) {
      articles.putIfAbsent(assertion.span.article.id, () => assertion);
    }
    return RefreshIndicator(
      onRefresh: controller.refresh,
      child: ListView(
        key: const Key('event-detail-list'),
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(DialektikSpacing.space6),
        children: [Center(child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: DialektikSizing.maxReadingWidth),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (controller.isRefreshing) const LinearProgressIndicator(),
            Text(strings.categoryName(event.category), style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: DialektikSpacing.space2),
            Text(event.titleDescriptive, style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: DialektikSpacing.space4),
            Text(strings.detected(event.detectedAt)),
            Text(strings.sourceCount(event.sourceCount)),
            if (event.primaryFact != null) ...[
              Text(event.primaryFact!.statement),
              TextButton(onPressed: () => onOpenSource(event.primaryFact!.primarySource.id),
                child: Text('Fuente: ${event.primaryFact!.primarySource.name}')),
              TextButton(onPressed: () => onOpenArticle(event.primaryFact!.primaryPublicationUrl),
                child: const Text('Abrir publicación original')),
            ],
            if (event.analysisState == AnalysisState.analysisPending)
              for (final assertion in controller.assertions)
                Card(child: Padding(padding: const EdgeInsets.all(16),
                  child: Text('“${assertion.span.quotedText}”'))),
            const SizedBox(height: DialektikSpacing.space8),
            Text('Posturas por medio', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: DialektikSpacing.space4),
            if (event.coveragePositions.isNotEmpty)
              for (final position in event.coveragePositions)
                for (final assertion in position.assertions)
                  Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(assertion.sourceName, style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8), Text(position.title),
                      const SizedBox(height: 8), Text(assertion.assertionText),
                      const SizedBox(height: 8), Text('“${assertion.quotedText}”'),
                    ],
                  )))
            else if (controller.analysisUnavailable)
              const Text('No se pudieron cargar las posturas. Vuelve a intentarlo.')
            else if (event.analysisState == AnalysisState.analysisPending)
              const Text('Las posturas aún no están disponibles.')
            else if (controller.positions.isEmpty)
              const Text('No hay posturas disponibles.')
            else
              for (final position in controller.positions) ...[
                if (controller.failedPositionIds.contains(position.id))
                  TextButton(onPressed: () => unawaited(controller.retryPosition(position.id)),
                    child: const Text('Reintentar postura'))
                else for (final assertion in controller.positionDetails[position.id]?.assertions ?? <PublicAssertionDto>[])
                  Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(assertion.span.article.source.name, style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8), Text(position.title),
                      const SizedBox(height: 8), Text('“${assertion.span.quotedText}”'),
                    ],
                  ))),
              ],
            if (event.contrasts.isNotEmpty) ...[
              const SizedBox(height: DialektikSpacing.space8),
              for (final contrast in event.contrasts)
                Text(contrast.kind == 'contrast' ? 'Contraste de enfoques' : 'Contradicción',
                  style: Theme.of(context).textTheme.titleMedium),
            ],
            if (event.articles.isNotEmpty) ...[
              const SizedBox(height: DialektikSpacing.space8),
              Text('Noticias originales', style: Theme.of(context).textTheme.headlineSmall),
              for (final article in event.articles)
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${article.sourceName} · ${article.title}'),
                  TextButton.icon(onPressed: () => onOpenArticle(article.url),
                    icon: const Icon(Icons.open_in_new), label: const Text('Abrir noticia original ↗')),
                ]),
            ] else if (articles.isNotEmpty) ...[
              const SizedBox(height: DialektikSpacing.space8),
              Text('Noticias originales', style: Theme.of(context).textTheme.headlineSmall),
              for (final assertion in articles.values)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(assertion.span.article.source.name),
                  subtitle: Text('“${assertion.span.quotedText}”'),
                  trailing: const Icon(Icons.open_in_new),
                  onTap: () => onOpenArticle(assertion.span.article.urlCanonical),
                ),
            ],
          ]),
        ))],
      ),
    );
  }
}

final class _GoneEvent extends StatelessWidget {
  const _GoneEvent({required this.tombstone, required this.onOpenEvent});

  final TombstoneDto tombstone;
  final ValueChanged<String> onOpenEvent;

  @override
  Widget build(BuildContext context) {
    final ConsumerStrings strings = ConsumerStrings.of(context);
    final List<TombstoneSuccessorDto> successors = tombstone.successors
        .where(
          (TombstoneSuccessorDto item) =>
              item.type == TombstoneSuccessorType.event,
        )
        .toList();
    return SystemStateView(
      message:
          '${strings.historicalEvent}. ${strings.historicalExplanation} '
          '${tombstone.reason}',
      actionLabel: successors.isEmpty ? null : strings.openSuccessor,
      onAction: successors.isEmpty
          ? null
          : () => onOpenEvent(successors.first.id),
    );
  }
}
