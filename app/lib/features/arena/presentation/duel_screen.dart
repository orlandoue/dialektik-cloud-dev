import 'dart:async';

import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/presentation/arena_navigation.dart';
import 'package:dialektik/features/arena/presentation/arena_widgets.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/widgets/share_synthesis.dart';
import 'package:dialektik/features/live/data/youtube_video.dart';
import 'package:dialektik/features/social/data/arena_social_repository.dart';
import 'package:dialektik/features/social/data/social_repository.dart';
import 'package:flutter/material.dart';

String? arenaVideoIdOfEvent(EventDetailDto event) {
  for (final EventCoverageArticleDto article in event.articles) {
    final String? id = extractYouTubeVideoId(article.url.toString());
    if (id != null) return id;
  }
  return null;
}

/// The three explicit classifications a published contrast can carry.
const List<({String kind, String label})> arenaDuelKinds =
    <({String kind, String label})>[
      (kind: 'CONTRADICTION', label: 'Contradicción'),
      (kind: 'DIFFERENT_FOCUS', label: 'Distinto enfoque'),
      (kind: 'COMPATIBLE', label: 'Compatible'),
    ];

String arenaKindLabel(String? kind) {
  for (final ({String kind, String label}) item in arenaDuelKinds) {
    if (item.kind == kind) return item.label;
  }
  return 'Contraste';
}

/// `[Emblema] Medio 1   VS   [Emblema] Medio 2`, always on one row.
class DuelFaceOff extends StatelessWidget {
  const DuelFaceOff({required this.duel, required this.store, super.key});

  final ArenaDuel duel;
  final ArenaStore store;

  Widget _side(BuildContext context, String name, String? sourceId) {
    final String label = arenaSourceName(name);
    const TextStyle style = TextStyle(
      fontSize: 14,
      fontWeight: FontWeight.w700,
      color: ArenaColors.ink,
    );
    // A one-word or short name shrinks to fit instead of breaking inside a
    // word; a long name wraps at its spaces.
    final bool compact = !label.contains(' ') || label.length <= 14;
    return Expanded(
      child: Semantics(
        button: sourceId != null,
        label: 'Abrir perfil de $label',
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: sourceId == null
              ? null
              : () => openArenaMedia(context, store, sourceId),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              children: <Widget>[
                MediaEmblem(name: name, size: 30),
                const SizedBox(width: 8),
                Flexible(
                  child: compact
                      ? FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerLeft,
                          child: Text(
                            label,
                            maxLines: 1,
                            softWrap: false,
                            style: style,
                          ),
                        )
                      : Text(
                          label,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: style,
                        ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Row(
    children: <Widget>[
      _side(context, duel.nameA, ArenaDuel.sourceIdOf(duel.positionA)),
      const Padding(
        padding: EdgeInsets.symmetric(horizontal: 8),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: ArenaColors.violetSoft,
            borderRadius: BorderRadius.all(Radius.circular(999)),
          ),
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            child: Text(
              'VS',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w800,
                color: ArenaColors.violet,
              ),
            ),
          ),
        ),
      ),
      _side(context, duel.nameB, ArenaDuel.sourceIdOf(duel.positionB)),
    ],
  );
}

/// Thermometer of a duel: support of each posture when Core serves
/// posture votes, otherwise the case-level support votes.
class DuelThermometer extends StatefulWidget {
  const DuelThermometer({required this.store, required this.duel, super.key});

  final ArenaStore store;
  final ArenaDuel duel;

  @override
  State<DuelThermometer> createState() => _DuelThermometerState();
}

class _DuelThermometerState extends State<DuelThermometer> {
  @override
  void initState() {
    super.initState();
    final ArenaStore store = widget.store;
    final String eventId = widget.duel.event.id;
    if (store.cachedPositionVotes(eventId) == null) {
      unawaited(store.positionVotes(eventId));
    }
    if (store.cachedSummary(eventId) == null) {
      unawaited(
        store.summary(eventId).then<void>((_) {}).catchError((Object _) {}),
      );
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.store,
    builder: (BuildContext context, _) =>
        arenaDuelThermometer(widget.store, widget.duel),
  );
}

Widget arenaDuelThermometer(ArenaStore store, ArenaDuel duel) {
  final PositionVotes? votes = store.cachedPositionVotes(duel.event.id);
  if (votes == null) {
    return EvidenceThermometer(summary: store.cachedSummary(duel.event.id));
  }
  return PostureThermometer(
    nameA: duel.nameA,
    nameB: duel.nameB,
    votesA: votes.votesFor(duel.contrast.positionA.id),
    votesB: votes.votesFor(duel.contrast.positionB.id),
  );
}

/// Protagonist card of the Coliseo: the most recent published contrast.
class DuelOfTheDayCard extends StatelessWidget {
  const DuelOfTheDayCard({required this.duel, required this.store, super.key});

  final ArenaDuel duel;
  final ArenaStore store;

  @override
  Widget build(BuildContext context) => ArenaCard(
    key: const Key('arena-duel-of-the-day'),
    padding: EdgeInsets.zero,
    onTap: () => openArenaDuel(context, store, duel),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        ArenaCover(
          topic: arenaTopicOfEvent(duel.event),
          videoId: arenaVideoIdOfEvent(duel.event),
          radius: 0,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: <Widget>[
                const ArenaBadge.fire('DUELO DEL DÍA'),
                const SizedBox(height: 48),
                Text(
                  duel.title,
                  style: const TextStyle(
                    fontFamily: ArenaText.serif,
                    fontSize: 20,
                    height: 1.25,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                  ),
                ),
              ],
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              DuelFaceOff(duel: duel, store: store),
              const SizedBox(height: 12),
              DuelThermometer(store: store, duel: duel),
              DuelActions(duel: duel, store: store),
            ],
          ),
        ),
      ],
    ),
  );
}

/// Share, save and open actions of a duel card.
class DuelActions extends StatelessWidget {
  const DuelActions({required this.duel, required this.store, super.key});

  final ArenaDuel duel;
  final ArenaStore store;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: store,
    builder: (BuildContext context, _) {
      final bool saved = store.saved.contains(duel.event.id);
      return Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: <Widget>[
          IconButton(
            tooltip: 'Compartir duelo',
            color: ArenaColors.muted,
            onPressed: () => showSynthesisSharePreview(
              context,
              duel.event,
              relation: duel.kind,
            ),
            icon: const Icon(Icons.ios_share),
          ),
          IconButton(
            tooltip: saved ? 'Quitar de guardados' : 'Guardar duelo',
            color: saved ? ArenaColors.violet : ArenaColors.muted,
            onPressed: () => store.toggleSaved(duel.event.id),
            icon: Icon(saved ? Icons.bookmark : Icons.bookmark_border),
          ),
          IconButton(
            tooltip: 'Abrir duelo completo',
            color: ArenaColors.violet,
            onPressed: () => openArenaDuel(context, store, duel),
            icon: const Icon(Icons.arrow_forward),
          ),
        ],
      );
    },
  );
}

/// Compact duel used in the VS tab and in media profiles.
class DuelListCard extends StatelessWidget {
  const DuelListCard({required this.duel, required this.store, super.key});

  final ArenaDuel duel;
  final ArenaStore store;

  @override
  Widget build(BuildContext context) => ArenaCard(
    key: ValueKey<String>('arena-duel-${duel.contrast.id}'),
    onTap: () => openArenaDuel(context, store, duel),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Wrap(
          spacing: 8,
          runSpacing: 6,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: <Widget>[
            ArenaBadge(
              label: arenaKindLabel(duel.kind).toUpperCase(),
              background: ArenaColors.violetSoft,
              foreground: ArenaColors.violetDeep,
            ),
            Text(
              '${arenaTopicOfEvent(duel.event).label} · '
              '${arenaAgo(duel.contrast.confirmedAt)}',
              style: ArenaText.meta,
            ),
          ],
        ),
        const SizedBox(height: 10),
        Text(
          duel.title,
          style: const TextStyle(
            fontFamily: ArenaText.serif,
            fontSize: 17,
            height: 1.3,
            fontWeight: FontWeight.w700,
            color: ArenaColors.ink,
          ),
        ),
        const SizedBox(height: 10),
        DuelFaceOff(duel: duel, store: store),
      ],
    ),
  );
}

/// Pantalla 2 — `VS · Duelo de Medios`.
class DuelScreen extends StatefulWidget {
  const DuelScreen({required this.duel, required this.store, super.key});

  final ArenaDuel duel;
  final ArenaStore store;

  @override
  State<DuelScreen> createState() => _DuelScreenState();
}

class _DuelScreenState extends State<DuelScreen> {
  int _tab = 0;

  ArenaDuel get duel => widget.duel;
  ArenaStore get store => widget.store;

  @override
  void initState() {
    super.initState();
    unawaited(
      store.summary(duel.event.id).then<void>((_) {}).catchError((Object _) {}),
    );
    unawaited(store.positionVotes(duel.event.id));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: ArenaColors.background,
    appBar: AppBar(
      backgroundColor: ArenaColors.background,
      surfaceTintColor: Colors.transparent,
      foregroundColor: ArenaColors.ink,
      titleSpacing: 0,
      title: const FittedBox(
        fit: BoxFit.scaleDown,
        child: Text(
          'VS · Duelo de Medios',
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
        ),
      ),
      actions: <Widget>[
        IconButton(
          tooltip: 'Compartir duelo',
          onPressed: () => showSynthesisSharePreview(
            context,
            duel.event,
            relation: duel.kind,
          ),
          icon: const Icon(Icons.ios_share),
        ),
      ],
    ),
    bottomNavigationBar: SafeArea(
      minimum: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      child: ArenaPrimaryButton(
        key: const Key('arena-vote-button'),
        label: '🗳️ ¿Qué postura tiene más respaldo?',
        onPressed: () => showArenaVoteSheet(context, store, duel.event),
      ),
    ),
    body: ListView(
      key: const Key('arena-duel-scroll'),
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
      children: <Widget>[
        Text(
          '${arenaTopicOfEvent(duel.event).label.toUpperCase()} · '
          '${arenaDate(duel.contrast.confirmedAt)}',
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.4,
            color: ArenaColors.violet,
          ),
        ),
        const SizedBox(height: 8),
        Semantics(
          header: true,
          child: Text(
            duel.title,
            style: const TextStyle(
              fontSize: 22,
              height: 1.25,
              fontWeight: FontWeight.w800,
              color: ArenaColors.ink,
            ),
          ),
        ),
        const SizedBox(height: 12),
        _KindPills(kind: duel.kind),
        const SizedBox(height: 14),
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Expanded(child: _PostureCard(duel.event, duel.positionA, store)),
              const SizedBox(width: 8),
              Expanded(child: _PostureCard(duel.event, duel.positionB, store)),
            ],
          ),
        ),
        const SizedBox(height: 16),
        ArenaSubTabs(
          labels: const <String>['Evidencia', 'Contexto', 'Análisis IA'],
          selected: _tab,
          onSelected: (int value) => setState(() => _tab = value),
        ),
        const SizedBox(height: 14),
        if (_tab == 0) ..._evidence(context),
        if (_tab == 1) ..._context(context),
        if (_tab == 2) ..._analysis(),
      ],
    ),
  );

  List<Widget> _evidence(BuildContext context) {
    final EventDetailDto event = duel.event;
    final Set<String> quoted = <String>{
      for (final EventCoveragePositionDto position in event.coveragePositions)
        for (final EventCoverageAssertionDto a in position.assertions)
          arenaSourceName(a.sourceName),
    };
    final List<String> unquoted = event.articles
        .map((EventCoverageArticleDto a) => arenaSourceName(a.sourceName))
        .toSet()
        .difference(quoted)
        .toList();
    final Set<String> names = event.articles
        .map((EventCoverageArticleDto a) => arenaSourceName(a.sourceName))
        .toSet();
    return <Widget>[
      for (final EventCoverageArticleDto article in event.articles)
        _EvidenceTile(
          icon: Icons.check_circle,
          color: ArenaColors.emerald,
          title: article.title,
          subtitle:
              '${arenaSourceName(article.sourceName)} · '
              '${arenaAgo(article.publishedAt)} · Abrir original',
          onTap: () => unawaited(store.openLink(article.url)),
        ),
      _EvidenceTile(
        icon: Icons.description_outlined,
        color: ArenaColors.violet,
        title: 'Cobertura comparada',
        subtitle:
            '${names.length} ${names.length == 1 ? 'fuente cubre' : 'fuentes cubren'} '
            'este caso: ${names.join(', ')}. Ver acontecimiento completo.',
        onTap: () => openArenaEvent(context, store, event.id),
      ),
      _EvidenceTile(
        icon: Icons.help_outline,
        color: ArenaColors.muted,
        title: '¿Qué falta por saber?',
        subtitle: unquoted.isEmpty
            ? 'Todas las fuentes del caso tienen al menos una cita literal '
                  'verificada. Si conoces un documento que falte, apórtalo '
                  'en la comunidad del caso.'
            : 'Aún no hay cita literal verificada de: ${unquoted.join(', ')}. '
                  'Puedes aportar un enlace o documento en la comunidad del '
                  'caso.',
        onTap: () => openArenaCommunity(context, store, event),
      ),
    ];
  }

  List<Widget> _context(BuildContext context) {
    final EventDetailDto event = duel.event;
    final SocialSummary? summary = store.cachedSummary(event.id);
    final List<SocialComment> notes =
        summary?.comments.take(3).toList() ?? const <SocialComment>[];
    return <Widget>[
      ArenaCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text(
              'Antecedentes del acontecimiento',
              style: ArenaText.section,
            ),
            const SizedBox(height: 8),
            Text(
              event.primaryFact?.statement ?? event.arenaTitle,
              style: ArenaText.body,
            ),
            const SizedBox(height: 8),
            Text(
              'Cobertura registrada desde el ${arenaDate(event.window.from)}'
              '${event.window.to == null ? '' : ' hasta el ${arenaDate(event.window.to!)}'}'
              ' · ${event.sourceCount} fuentes · ${event.articles.length} '
              'publicaciones.',
              style: ArenaText.meta,
            ),
            const SizedBox(height: 6),
            TextButton(
              style: TextButton.styleFrom(
                foregroundColor: ArenaColors.violet,
                padding: EdgeInsets.zero,
              ),
              onPressed: () => openArenaEvent(context, store, event.id),
              child: const Text('Abrir acontecimiento vivo →'),
            ),
          ],
        ),
      ),
      ArenaCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text(
              'Notas de contexto de la comunidad',
              style: ArenaText.section,
            ),
            const SizedBox(height: 8),
            if (notes.isEmpty)
              const Text(
                'Todavía no hay notas de contexto para este caso.',
                style: ArenaText.body,
              )
            else
              for (final SocialComment note in notes)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text('• ${note.body}', style: ArenaText.body),
                ),
            TextButton(
              style: TextButton.styleFrom(
                foregroundColor: ArenaColors.violet,
                padding: EdgeInsets.zero,
              ),
              onPressed: () => openArenaCommunity(context, store, event),
              child: const Text('Ver comunidad del caso →'),
            ),
          ],
        ),
      ),
    ];
  }

  List<Widget> _analysis() {
    final String explanation = switch (duel.kind) {
      'CONTRADICTION' =>
        'Las dos posturas describen el mismo hecho con afirmaciones que no '
            'pueden ser ciertas a la vez. Dialektik lo clasifica como '
            'contradicción y no declara cuál es la correcta: la evidencia '
            'original está enlazada para que la revises.',
      'DIFFERENT_FOCUS' =>
        'Ambos medios informan sobre el mismo acontecimiento, pero ponen el '
            'acento en aspectos distintos. Sus afirmaciones no se excluyen: '
            'la diferencia es de enfoque, no de hechos.',
      'COMPATIBLE' =>
        'Las posturas de ambos medios son compatibles entre sí: describen '
            'el mismo acontecimiento sin afirmaciones que se opongan.',
      _ =>
        'Los dos medios cubren el mismo acontecimiento desde ángulos '
            'distintos. Revisa las citas y los originales enlazados.',
    };
    Widget posture(EventCoveragePositionDto? position) => Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            ArenaDuel.nameOf(position),
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: ArenaColors.violetDeep,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            position == null
                ? 'Postura no disponible.'
                : position.assertions.isNotEmpty &&
                      position.assertions.first.assertionText.trim().length >=
                          arenaMinimumQuoteLength
                ? position.assertions.first.assertionText
                : arenaPostureText(duel.event, position).text,
            style: ArenaText.body,
          ),
        ],
      ),
    );
    return <Widget>[
      ArenaCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text('En qué coinciden', style: ArenaText.section),
            const SizedBox(height: 8),
            Text(
              'Los dos medios cubren el mismo acontecimiento: '
              '«${duel.event.arenaTitle}».',
              style: ArenaText.body,
            ),
          ],
        ),
      ),
      ArenaCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              'Por qué es ${arenaKindLabel(duel.kind).toLowerCase()}',
              style: ArenaText.section,
            ),
            const SizedBox(height: 8),
            Text(explanation, style: ArenaText.body),
            posture(duel.positionA),
            posture(duel.positionB),
            const SizedBox(height: 10),
            const Text(
              'Resumen generado por IA a partir de las citas literales. '
              'No reemplaza la lectura de las fuentes originales.',
              style: ArenaText.meta,
            ),
          ],
        ),
      ),
    ];
  }
}

class _KindPills extends StatelessWidget {
  const _KindPills({required this.kind});

  final String? kind;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 8,
    runSpacing: 8,
    children: <Widget>[
      for (final ({String kind, String label}) item in arenaDuelKinds)
        Semantics(
          selected: item.kind == kind,
          label: item.kind == kind
              ? 'Clasificación: ${item.label}'
              : '${item.label}, no aplica',
          child: ExcludeSemantics(
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: item.kind == kind
                    ? ArenaColors.violet
                    : ArenaColors.card,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(
                  color: item.kind == kind
                      ? ArenaColors.violet
                      : ArenaColors.border,
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 7,
                ),
                child: Text(
                  item.label,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: item.kind == kind ? Colors.white : ArenaColors.muted,
                  ),
                ),
              ),
            ),
          ),
        ),
    ],
  );
}

class _PostureCard extends StatelessWidget {
  const _PostureCard(this.event, this.position, this.store);

  final EventDetailDto event;
  final EventCoveragePositionDto? position;
  final ArenaStore store;

  @override
  Widget build(BuildContext context) {
    final String? sourceId = ArenaDuel.sourceIdOf(position);
    final ({String text, bool literal}) posture = arenaPostureText(
      event,
      position,
    );
    final String quote = posture.literal ? arenaQuote(posture.text) : '';
    return DecoratedBox(
      decoration: arenaCardDecoration(),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            // A Wrap lets a long name drop under its emblem as a whole word
            // instead of breaking inside the narrow half-width card.
            Semantics(
              button: sourceId != null,
              label: 'Abrir perfil de ${ArenaDuel.nameOf(position)}',
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: sourceId == null
                    ? null
                    : () => openArenaMedia(context, store, sourceId),
                child: Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: <Widget>[
                    MediaEmblem(name: ArenaDuel.nameOf(position), size: 30),
                    Text(
                      ArenaDuel.nameOf(position),
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: ArenaColors.ink,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 10),
            Text(
              quote.isNotEmpty ? quote : posture.text,
              style: const TextStyle(
                fontFamily: ArenaText.serif,
                fontSize: 13,
                height: 1.4,
                color: ArenaColors.ink,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              quote.isNotEmpty
                  ? 'Cita literal verificada'
                  : 'Titular de su publicación',
              style: ArenaText.meta,
            ),
          ],
        ),
      ),
    );
  }
}

class _EvidenceTile extends StatelessWidget {
  const _EvidenceTile({
    required this.icon,
    required this.color,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => ArenaCard(
    onTap: onTap,
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Icon(icon, color: color, size: 22),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(title, style: ArenaText.cardTitle),
              const SizedBox(height: 4),
              Text(subtitle, style: ArenaText.meta),
            ],
          ),
        ),
      ],
    ),
  );
}

/// Bottom sheet where a signed-in reader rates the support of a case.
Future<void> showArenaVoteSheet(
  BuildContext context,
  ArenaStore store,
  EventDetailDto event,
) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  backgroundColor: ArenaColors.card,
  shape: const RoundedRectangleBorder(
    borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
  ),
  builder: (BuildContext sheetContext) =>
      _VoteSheet(store: store, event: event, hostContext: context),
);

class _VoteSheet extends StatefulWidget {
  const _VoteSheet({
    required this.store,
    required this.event,
    required this.hostContext,
  });

  final ArenaStore store;
  final EventDetailDto event;
  final BuildContext hostContext;

  @override
  State<_VoteSheet> createState() => _VoteSheetState();
}

class _VoteSheetState extends State<_VoteSheet> {
  bool _busy = false;
  String? _error;

  ArenaDuel? get _duel => widget.store.duelForEvent(widget.event.id);

  @override
  void initState() {
    super.initState();
    unawaited(widget.store.positionVotes(widget.event.id, refresh: true));
  }

  Future<void> _votePosition(String positionId) async {
    final ArenaSocialRepository? social = widget.store.arenaSocial;
    if (social == null || _busy) return;
    final String? mine = widget.store
        .cachedPositionVotes(widget.event.id)
        ?.mine;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final PositionVotes updated = await social.votePosition(
        widget.event.id,
        mine == positionId ? null : positionId,
      );
      widget.store.rememberPositionVotes(widget.event.id, updated);
    } on Exception {
      if (mounted) setState(() => _error = 'No se pudo guardar tu voto.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _vote(String reaction) async {
    final SocialRepository? social = widget.store.social;
    if (social == null || _busy) return;
    final String? mine = widget.store.cachedSummary(widget.event.id)?.mine;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final SocialSummary updated = await social.setSocialReaction(
        widget.event.id,
        mine == reaction ? null : reaction,
      );
      widget.store.rememberSummary(widget.event.id, updated);
    } on Exception {
      if (mounted) setState(() => _error = 'No se pudo guardar tu voto.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(
        20,
        20,
        20,
        20 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: ListenableBuilder(
        listenable: widget.store,
        builder: (BuildContext context, _) {
          final SocialSummary? summary = widget.store.cachedSummary(
            widget.event.id,
          );
          final ArenaDuel? duel = _duel;
          final PositionVotes? votes = widget.store.cachedPositionVotes(
            widget.event.id,
          );
          if (duel != null && votes != null) {
            return _postureVote(context, duel, votes);
          }
          final bool canVote = widget.store.social != null;
          return Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              const Text(
                '¿Qué postura tiene más respaldo?',
                style: TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w800,
                  color: ArenaColors.ink,
                ),
              ),
              const SizedBox(height: 6),
              const Text(
                'Evalúa el respaldo en evidencia de la cobertura de este '
                'caso. Tu voto se suma al termómetro de la comunidad y '
                'puedes cambiarlo cuando quieras.',
                style: ArenaText.body,
              ),
              const SizedBox(height: 14),
              EvidenceThermometer(summary: summary),
              const SizedBox(height: 14),
              for (final ({String key, String label}) option
                  in const <({String key, String label})>[
                    (key: 'SOLID', label: 'Tiene respaldo sólido'),
                    (key: 'BIASED', label: 'Le falta respaldo'),
                  ])
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: OutlinedButton(
                    key: ValueKey<String>('arena-vote-${option.key}'),
                    onPressed: canVote && !_busy
                        ? () => _vote(option.key)
                        : null,
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(48, 48),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 12,
                      ),
                      foregroundColor: summary?.mine == option.key
                          ? Colors.white
                          : ArenaColors.ink,
                      backgroundColor: summary?.mine == option.key
                          ? ArenaColors.violet
                          : ArenaColors.card,
                      side: const BorderSide(color: ArenaColors.violet),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                    child: Text(
                      '${summary?.mine == option.key ? '✓ ' : ''}'
                      '${option.label}',
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
              if (!canVote)
                const Text(
                  'Inicia sesión para votar en el termómetro.',
                  style: ArenaText.meta,
                ),
              if (_error != null)
                Text(
                  _error!,
                  style: const TextStyle(color: ArenaColors.amberDeep),
                ),
              ..._footer(context),
            ],
          );
        },
      ),
    ),
  );

  List<Widget> _footer(BuildContext context) => <Widget>[
    const Divider(height: 24, color: ArenaColors.border),
    TextButton.icon(
      style: TextButton.styleFrom(foregroundColor: ArenaColors.violet),
      onPressed: () {
        Navigator.of(context).pop();
        openArenaCommunity(widget.hostContext, widget.store, widget.event);
      },
      icon: const Icon(Icons.forum_outlined),
      label: const Text('Abrir comunidad del caso'),
    ),
    TextButton.icon(
      style: TextButton.styleFrom(foregroundColor: ArenaColors.violet),
      onPressed: () {
        Navigator.of(context).pop();
        unawaited(
          showSynthesisSharePreview(
            widget.hostContext,
            widget.event,
            relation: widget.event.synthesisRelation,
          ),
        );
      },
      icon: const Icon(Icons.ios_share),
      label: const Text('Crear tarjeta para X y WhatsApp'),
    ),
  ];

  /// One vote per reader between the two postures of the duel.
  Widget _postureVote(
    BuildContext context,
    ArenaDuel duel,
    PositionVotes votes,
  ) {
    final List<({String id, String name, String title})> sides =
        <({String id, String name, String title})>[
          (
            id: duel.contrast.positionA.id,
            name: duel.nameA,
            title: arenaPostureText(duel.event, duel.positionA).text,
          ),
          (
            id: duel.contrast.positionB.id,
            name: duel.nameB,
            title: arenaPostureText(duel.event, duel.positionB).text,
          ),
        ];
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const Text(
          '¿Qué postura tiene más respaldo?',
          style: TextStyle(
            fontSize: 19,
            fontWeight: FontWeight.w800,
            color: ArenaColors.ink,
          ),
        ),
        const SizedBox(height: 6),
        const Text(
          'Elige la postura que, según la evidencia enlazada, está mejor '
          'respaldada. Tienes un voto por caso y puedes cambiarlo.',
          style: ArenaText.body,
        ),
        const SizedBox(height: 14),
        arenaDuelThermometer(widget.store, duel),
        const SizedBox(height: 14),
        for (final ({String id, String name, String title}) side in sides)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: OutlinedButton(
              key: ValueKey<String>('arena-vote-position-${side.id}'),
              onPressed: _busy ? null : () => _votePosition(side.id),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(48, 48),
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 12,
                ),
                foregroundColor: votes.mine == side.id
                    ? Colors.white
                    : ArenaColors.ink,
                backgroundColor: votes.mine == side.id
                    ? ArenaColors.violet
                    : ArenaColors.card,
                side: const BorderSide(color: ArenaColors.violet),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Text(
                    '${votes.mine == side.id ? '✓ ' : ''}${side.name} · '
                    '${votes.votesFor(side.id)} '
                    '${votes.votesFor(side.id) == 1 ? 'voto' : 'votos'}',
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 2),
                  Text(side.title, style: const TextStyle(fontSize: 13)),
                ],
              ),
            ),
          ),
        if (_error != null)
          Text(_error!, style: const TextStyle(color: ArenaColors.amberDeep)),
        ..._footer(context),
      ],
    );
  }
}
