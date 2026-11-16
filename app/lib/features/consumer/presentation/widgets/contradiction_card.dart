import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/localization/consumer_strings.dart';
import 'package:flutter/material.dart';

final class ContradictionCard extends StatefulWidget {
  const ContradictionCard({required this.contradiction, required this.onOpenEvent, this.repository, super.key});
  final ContradictionDto contradiction;
  final VoidCallback onOpenEvent;
  final ConsumerRepository? repository;
  @override
  State<ContradictionCard> createState() => _ContradictionCardState();
}

final class _ContradictionCardState extends State<ContradictionCard> {
  Future<List<PositionDetailDto>>? _details;
  @override
  void initState() {
    super.initState();
    _load();
  }
  @override
  void didUpdateWidget(ContradictionCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.contradiction.id != widget.contradiction.id || oldWidget.repository != widget.repository) _load();
  }
  void _load() {
    final repository = widget.repository;
    if (repository != null) {
      _details = Future.wait([
        repository.getPosition(widget.contradiction.positionA.id),
        repository.getPosition(widget.contradiction.positionB.id),
      ]);
    }
  }
  @override
  Widget build(BuildContext context) {
    final item = widget.contradiction;
    final strings = ConsumerStrings.of(context);
    return DialektikSurface(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (item.isFollowedSourceMatch) const Text('En tus fuentes'),
      Text(item.eventTitle, style: Theme.of(context).textTheme.titleLarge),
      const SizedBox(height: DialektikSpacing.space3),
      FutureBuilder<List<PositionDetailDto>>(
        future: _details,
        builder: (context, snapshot) {
          final details = snapshot.data;
          String source(int index) => details == null
              ? 'Medio no disponible'
              : details[index].assertions.map((a) => a.span.article.source.name).toSet().join(', ');
          return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${source(0)}: ${item.positionA.title}'),
            const SizedBox(height: 8),
            Text('${source(1)}: ${item.positionB.title}'),
          ]);
        },
      ),
      const SizedBox(height: DialektikSpacing.space3),
      TextButton(onPressed: widget.onOpenEvent, child: Text(strings.openSuccessor)),
    ]));
  }
}
