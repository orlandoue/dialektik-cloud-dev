import 'dart:async';

import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/data/home_edition.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:flutter/material.dart';

String _hhmm(DateTime time) {
  final DateTime local = time.toLocal();
  return '${local.hour.toString().padLeft(2, '0')}:'
      '${local.minute.toString().padLeft(2, '0')}';
}

/// «Edición de las 14:00 · Ordenada por medios que lo cubren y novedad…».
String arenaEditionCaption(HomeEdition edition) {
  final String kind = edition.trigger == 'breaking'
      ? 'Edición extraordinaria de las'
      : 'Edición de las';
  return '$kind ${_hhmm(edition.generatedAt)} · ${edition.rules}';
}

/// The feed's cases in the edition's order (a story's newest case first,
/// its other cases right after, so it stays one card), then the cases the
/// edition does not name, newest first. Hidden cases are left out.
List<EventCardDto> arenaEditionEvents(ArenaStore store, HomeEdition edition) {
  final Map<String, EventCardDto> loaded = <String, EventCardDto>{
    for (final EventCardDto event in store.events) event.id: event,
  };
  final Set<String> hidden = <String>{
    for (final HomeEditionHidden h in edition.hidden)
      if (h.kind == 'event') h.id,
  };
  final Set<String> seen = <String>{};
  final List<EventCardDto> ordered = <EventCardDto>[];
  for (final HomeEditionItem item in edition.items) {
    for (final String id in <String>[
      item.leadEventId,
      ...item.eventIds.where((String id) => id != item.leadEventId),
    ]) {
      final EventCardDto? card = loaded[id] ?? edition.cards[id];
      if (card != null && seen.add(id)) ordered.add(card);
    }
  }
  final List<EventCardDto> rest =
      store.events
          .where(
            (EventCardDto e) => !seen.contains(e.id) && !hidden.contains(e.id),
          )
          .toList()
        ..sort(
          (EventCardDto a, EventCardDto b) =>
              b.detectedAt.compareTo(a.detectedAt),
        );
  return <EventCardDto>[...ordered, ...rest];
}

/// Moderation › «Edición»: the hour's edition with its reasons, and the
/// moderator's pins, hides and duel choice (each with a reason and expiry).
class EditionModerationView extends StatefulWidget {
  const EditionModerationView({required this.store, super.key});

  final ArenaStore store;

  @override
  State<EditionModerationView> createState() => _EditionModerationViewState();
}

class _EditionModerationViewState extends State<EditionModerationView> {
  HomeEdition? _edition;
  List<HomeEditionPin> _pins = const <HomeEditionPin>[];
  bool _loading = true;
  bool _failed = false;

  HomeEditionModerationRepository? get _repository =>
      widget.store.editionModeration;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final HomeEditionModerationRepository? repository = _repository;
    if (repository == null) {
      setState(() {
        _loading = false;
        _failed = true;
      });
      return;
    }
    try {
      final (HomeEdition?, List<HomeEditionPin>) loaded = await repository
          .moderationEdition(widget.store.country);
      if (!mounted) return;
      setState(() {
        _edition = loaded.$1;
        _pins = loaded.$2;
        _loading = false;
        _failed = false;
      });
    } on Object {
      if (mounted) {
        setState(() {
          _loading = false;
          _failed = true;
        });
      }
    }
  }

  String _titleOf(HomeEditionItem item) => item.kind == 'story'
      ? (_edition?.storyTitles[item.id] ?? 'Historia')
      : arenaHeadline(_edition?.cards[item.id]?.titleDescriptive ?? item.id);

  String _titleOfTarget(String kind, String id) {
    final HomeEdition? edition = _edition;
    if (kind == 'story') return edition?.storyTitles[id] ?? 'Historia';
    return arenaHeadline(edition?.cards[id]?.titleDescriptive ?? id);
  }

  Future<void> _change({
    required String kind,
    required String id,
    required String action,
  }) async {
    final (String, int)? answer = await askEditionReason(context, action);
    if (answer == null || !mounted) return;
    final HomeEditionModerationRepository repository = _repository!;
    try {
      final HomeEdition? edition = await repository.pinEdition(
        country: widget.store.country,
        targetKind: kind,
        targetId: id,
        action: action,
        reason: answer.$1,
        hours: answer.$2,
      );
      widget.store.rememberEdition(edition);
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Edición actualizada')));
      await _load();
    } on Object {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('No se pudo guardar. Inténtalo de nuevo.'),
        ),
      );
    }
  }

  Future<void> _remove(HomeEditionPin pin) async {
    try {
      widget.store.rememberEdition(await _repository!.unpinEdition(pin.id));
      await _load();
    } on Object {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No se pudo quitar. Inténtalo de nuevo.')),
      );
    }
  }

  static const Map<String, String> _actionLabels = <String, String>{
    'pin': 'Destacado arriba',
    'hide': 'Oculto',
    'duel': 'Duelo del día',
  };

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    final HomeEdition? edition = _edition;
    if (_failed || edition == null) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          Text(
            _failed
                ? 'No pudimos cargar la edición.'
                : 'Core aún no ha compuesto la primera edición.',
            style: ArenaText.body,
          ),
          TextButton(
            onPressed: () => unawaited(_load()),
            child: const Text('Reintentar'),
          ),
        ],
      );
    }
    final String? duel = edition.duelEventId;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        key: const Key('arena-edition-moderation'),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: <Widget>[
          Text(arenaEditionCaption(edition), style: ArenaText.meta),
          Text(
            'Próxima edición: ${_hhmm(edition.nextAt)} · reglas ${edition.rulesVersion}',
            style: ArenaText.meta,
          ),
          const SizedBox(height: 12),
          const Text('Duelo del día', style: ArenaText.cardTitle),
          Text(
            duel == null
                ? 'Ninguno: no hay un duelo de menos de 36 h en la edición.'
                : '${_titleOfTarget('event', duel)} · '
                      '${edition.duelReason == 'moderation' ? 'elegido por moderación: ${edition.duelPinReason ?? ''}' : 'el caso con más puntaje que tiene duelo'}',
            style: ArenaText.body,
          ),
          if (_pins.isNotEmpty) ...<Widget>[
            const SizedBox(height: 16),
            const Text(
              'Cambios de moderación vigentes',
              style: ArenaText.cardTitle,
            ),
            for (final HomeEditionPin pin in _pins)
              ListTile(
                key: ValueKey<String>('arena-edition-pin-${pin.id}'),
                contentPadding: EdgeInsets.zero,
                title: Text(
                  '${_actionLabels[pin.action] ?? pin.action}: '
                  '${_titleOfTarget(pin.targetKind, pin.targetId)}',
                ),
                subtitle: Text('${pin.reason} · hasta ${_hhmm(pin.expiresAt)}'),
                trailing: TextButton(
                  onPressed: () => unawaited(_remove(pin)),
                  child: const Text('Quitar'),
                ),
              ),
          ],
          const SizedBox(height: 16),
          Text(
            'Orden de la edición · ${edition.items.length}',
            style: ArenaText.cardTitle,
          ),
          for (final (int index, HomeEditionItem item) in edition.items.indexed)
            ListTile(
              key: ValueKey<String>('arena-edition-item-${item.id}'),
              contentPadding: EdgeInsets.zero,
              leading: Text('${index + 1}', style: ArenaText.meta),
              title: Text(
                _titleOf(item),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              subtitle: Text(
                '${item.kind == 'story' ? 'Historia · ' : ''}'
                '${item.outlets} ${item.outlets == 1 ? 'medio' : 'medios'} · '
                'última cobertura ${arenaAgo(item.lastCoverageAt)} · '
                'puntaje ${item.score.toStringAsFixed(2)}'
                '${item.pinned ? ' · destacado: ${item.pinReason ?? ''}' : ''}',
              ),
              trailing: PopupMenuButton<String>(
                key: ValueKey<String>('arena-edition-actions-${item.id}'),
                onSelected: (String action) => unawaited(
                  _change(
                    kind: action == 'duel' ? 'event' : item.kind,
                    id: action == 'duel' ? item.leadEventId : item.id,
                    action: action,
                  ),
                ),
                itemBuilder: (BuildContext context) => <PopupMenuEntry<String>>[
                  const PopupMenuItem<String>(
                    value: 'pin',
                    child: Text('Destacar arriba'),
                  ),
                  const PopupMenuItem<String>(
                    value: 'hide',
                    child: Text('Ocultar de la edición'),
                  ),
                  const PopupMenuItem<String>(
                    value: 'duel',
                    child: Text('Elegir su duelo como Duelo del día'),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// The reason (required) and how long the change lasts.
Future<(String, int)?> askEditionReason(BuildContext context, String action) {
  final TextEditingController reason = TextEditingController();
  int hours = 12;
  return showDialog<(String, int)>(
    context: context,
    builder: (BuildContext context) => StatefulBuilder(
      builder: (BuildContext context, StateSetter setState) => AlertDialog(
        title: Text(switch (action) {
          'pin' => 'Destacar arriba',
          'hide' => 'Ocultar de la edición',
          _ => 'Elegir el Duelo del día',
        }),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            TextField(
              key: const Key('arena-edition-reason'),
              controller: reason,
              maxLength: 200,
              decoration: const InputDecoration(
                labelText: 'Motivo (se muestra en la edición)',
              ),
            ),
            DropdownButton<int>(
              key: const Key('arena-edition-hours'),
              value: hours,
              onChanged: (int? value) => setState(() => hours = value ?? 12),
              items: const <DropdownMenuItem<int>>[
                DropdownMenuItem<int>(value: 2, child: Text('Por 2 horas')),
                DropdownMenuItem<int>(value: 12, child: Text('Por 12 horas')),
                DropdownMenuItem<int>(value: 24, child: Text('Por 1 día')),
                DropdownMenuItem<int>(value: 72, child: Text('Por 3 días')),
              ],
            ),
          ],
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            key: const Key('arena-edition-confirm'),
            onPressed: () {
              final String text = reason.text.trim();
              if (text.length < 3) return;
              Navigator.of(context).pop((text, hours));
            },
            child: const Text('Guardar'),
          ),
        ],
      ),
    ),
  );
}
