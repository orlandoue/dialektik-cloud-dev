import 'dart:async';

import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/presentation/arena_widgets.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:flutter/material.dart';

/// Hours offered for the «Duelo del día» notice (Chile time).
const List<int> dailyNoticeHours = <int>[8, 9, 13, 19, 21];

String dailyNoticeHourLabel(int hour) =>
    '${hour.toString().padLeft(2, '0')}:00';

/// Offered once, after the reader's first vote: the notice is opt-in and
/// Android's permission is asked only if they accept.
Future<void> offerDailyNotice(BuildContext context, ArenaStore store) async {
  if (!store.shouldOfferDailyNotice) return;
  await showModalBottomSheet<void>(
    context: context,
    backgroundColor: ArenaColors.background,
    builder: (BuildContext context) => _DailyNoticeOffer(store: store),
  );
  // Closed without choosing: not asked again.
  if (store.dailyNotice == null) await store.declineDailyNotice();
}

class _DailyNoticeOffer extends StatefulWidget {
  const _DailyNoticeOffer({required this.store});

  final ArenaStore store;

  @override
  State<_DailyNoticeOffer> createState() => _DailyNoticeOfferState();
}

class _DailyNoticeOfferState extends State<_DailyNoticeOffer> {
  late int _hour = widget.store.dailyHour;
  bool _busy = false;

  Future<void> _accept() async {
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    final NavigatorState navigator = Navigator.of(context);
    setState(() => _busy = true);
    final bool ok = await widget.store.setDailyNotice(value: true, hour: _hour);
    if (!mounted) return;
    navigator.pop();
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          ok
              ? 'Listo: te avisaremos a las ${dailyNoticeHourLabel(_hour)}.'
              : 'No se pudo activar el aviso. Puedes intentarlo en Ajustes.',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: Padding(
      key: const Key('arena-daily-notice-offer'),
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const Text(
            '¿Te avisamos del Duelo del día?',
            style: ArenaText.cardTitle,
          ),
          const SizedBox(height: 6),
          const Text(
            'Un aviso al día con el duelo nuevo, sin los nombres de los medios. '
            'Puedes cambiarlo o apagarlo en Ajustes.',
            style: ArenaText.body,
          ),
          const SizedBox(height: 12),
          DailyNoticeHourChips(
            hour: _hour,
            onChanged: (int hour) => setState(() => _hour = hour),
          ),
          const SizedBox(height: 16),
          FilledButton(
            key: const Key('arena-daily-notice-accept'),
            style: FilledButton.styleFrom(
              backgroundColor: ArenaColors.violet,
              minimumSize: const Size.fromHeight(48),
            ),
            onPressed: _busy ? null : () => unawaited(_accept()),
            child: Text('Avisarme a las ${dailyNoticeHourLabel(_hour)}'),
          ),
          TextButton(
            key: const Key('arena-daily-notice-decline'),
            style: TextButton.styleFrom(minimumSize: const Size.fromHeight(44)),
            onPressed: _busy
                ? null
                : () {
                    unawaited(widget.store.declineDailyNotice());
                    Navigator.of(context).pop();
                  },
            child: const Text('Ahora no'),
          ),
        ],
      ),
    ),
  );
}

class DailyNoticeHourChips extends StatelessWidget {
  const DailyNoticeHourChips({
    required this.hour,
    required this.onChanged,
    super.key,
  });

  final int hour;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final List<int> options = <int>{...dailyNoticeHours, hour}.toList()..sort();
    return ArenaPillBar(
      key: const Key('arena-daily-hours'),
      padding: EdgeInsets.zero,
      labels: <String>[
        for (final int option in options) dailyNoticeHourLabel(option),
      ],
      selected: options.indexOf(hour),
      onSelected: (int index) => onChanged(options[index]),
    );
  }
}

/// Ajustes: the notice on or off, and its hour.
class DailyNoticeSettings extends StatelessWidget {
  const DailyNoticeSettings({required this.store, super.key});

  final ArenaStore store;

  @override
  Widget build(BuildContext context) => ArenaCard(
    key: const Key('arena-daily-notice'),
    padding: const EdgeInsets.fromLTRB(4, 2, 4, 12),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        SwitchListTile(
          value: store.dailyNotice ?? false,
          activeThumbColor: ArenaColors.violet,
          onChanged: (bool value) =>
              unawaited(store.setDailyNotice(value: value)),
          title: const Text(
            'Aviso del Duelo del día',
            style: ArenaText.cardTitle,
          ),
          subtitle: Text(
            store.dailyNotice == true
                ? 'Cada día a las ${dailyNoticeHourLabel(store.dailyHour)}.'
                : 'Un aviso al día con el duelo nuevo.',
            style: ArenaText.meta,
          ),
        ),
        if (store.dailyNotice == true)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: DailyNoticeHourChips(
              hour: store.dailyHour,
              onChanged: (int hour) =>
                  unawaited(store.setDailyNotice(value: true, hour: hour)),
            ),
          ),
      ],
    ),
  );
}
