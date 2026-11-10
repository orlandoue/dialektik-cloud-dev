import 'dart:async';

import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/presentation/arena_widgets.dart';
import 'package:dialektik/features/arena/presentation/duel_screen.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/social/data/social_repository.dart';
import 'package:flutter/material.dart';

/// Pantalla 5 — participation of one case, separated by nature.
///
/// Core stores evidence contributions (a note tied to one original
/// publication of the case) and the support votes. Nothing here invents
/// authors or counts that the server does not return.
class CommunityScreen extends StatefulWidget {
  const CommunityScreen({required this.event, required this.store, super.key});

  final EventDetailDto event;
  final ArenaStore store;

  @override
  State<CommunityScreen> createState() => _CommunityScreenState();
}

class _CommunityScreenState extends State<CommunityScreen> {
  final TextEditingController _input = TextEditingController();
  final FocusNode _focus = FocusNode();
  final Map<String, int> _marks = <String, int>{};
  int _pill = 1;
  bool _loading = true;
  bool _sending = false;
  EventCoverageArticleDto? _attached;

  ArenaStore get store => widget.store;
  EventDetailDto get event => widget.event;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _input.dispose();
    _focus.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      await store.summary(event.id, refresh: true);
    } on Exception {
      /* The empty state explains that nothing could be read. */
    }
    if (mounted) setState(() => _loading = false);
  }

  void _say(String message) => ScaffoldMessenger.of(
    context,
  ).showSnackBar(SnackBar(content: Text(message)));

  Future<void> _attach() async {
    final EventCoverageArticleDto? chosen =
        await showModalBottomSheet<EventCoverageArticleDto>(
          context: context,
          isScrollControlled: true,
          backgroundColor: ArenaColors.card,
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          builder: (BuildContext sheetContext) => SafeArea(
            child: ListView(
              shrinkWrap: true,
              padding: const EdgeInsets.all(16),
              children: <Widget>[
                const Text(
                  'Adjunta la publicación original que respalda tu aporte',
                  style: ArenaText.section,
                ),
                const SizedBox(height: 8),
                for (final EventCoverageArticleDto article in event.articles)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: MediaEmblem(name: article.sourceName, size: 32),
                    title: Text(article.title, style: ArenaText.cardTitle),
                    subtitle: Text(
                      arenaSourceName(article.sourceName),
                      style: ArenaText.meta,
                    ),
                    onTap: () => Navigator.of(sheetContext).pop(article),
                  ),
              ],
            ),
          ),
        );
    if (chosen != null && mounted) setState(() => _attached = chosen);
  }

  Future<void> _send() async {
    final SocialRepository? social = store.social;
    final String body = _input.text.trim();
    if (_sending) return;
    if (social == null) {
      _say('Inicia sesión para participar en la comunidad.');
      return;
    }
    if (body.isEmpty) {
      _say('Escribe tu aporte antes de enviarlo.');
      return;
    }
    if (body.length > 600) {
      _say('El aporte admite hasta 600 caracteres.');
      return;
    }
    if (_attached == null) {
      await _attach();
      if (_attached == null) return;
    }
    setState(() => _sending = true);
    try {
      final SocialSummary updated = await social.addSocialComment(
        event.id,
        _attached!.id,
        body,
      );
      store.rememberSummary(event.id, updated);
      if (!mounted) return;
      _input.clear();
      setState(() {
        _attached = null;
        _pill = 1;
      });
    } on Exception {
      if (mounted) _say('No se pudo publicar tu aporte.');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
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
          'Comunidad del caso',
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
        ),
      ),
    ),
    body: Column(
      children: <Widget>[
        Expanded(
          child: ListenableBuilder(
            listenable: store,
            builder: (BuildContext context, _) => ListView(
              key: const Key('arena-community-scroll'),
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
              children: <Widget>[
                Text(event.titleDescriptive, style: ArenaText.cardTitle),
                const SizedBox(height: 12),
                ArenaPillBar(
                  padding: EdgeInsets.zero,
                  labels: const <String>['Debate', 'Aportes', 'Notas'],
                  selected: _pill,
                  onSelected: (int value) => setState(() => _pill = value),
                ),
                const SizedBox(height: 14),
                ..._body(context),
              ],
            ),
          ),
        ),
        _composer(context),
      ],
    ),
  );

  List<Widget> _body(BuildContext context) {
    final SocialSummary? summary = store.cachedSummary(event.id);
    if (_loading && summary == null) {
      return const <Widget>[
        Padding(
          padding: EdgeInsets.all(24),
          child: Center(
            child: CircularProgressIndicator(color: ArenaColors.violet),
          ),
        ),
      ];
    }
    final List<SocialComment> comments =
        summary?.comments ?? const <SocialComment>[];
    switch (_pill) {
      case 0:
        return <Widget>[
          ArenaCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                const Text(
                  'Opiniones e interpretaciones',
                  style: ArenaText.section,
                ),
                const SizedBox(height: 10),
                EvidenceThermometer(summary: summary),
                const SizedBox(height: 12),
                ArenaPrimaryButton(
                  label: 'Votar en el termómetro',
                  onPressed: () => showArenaVoteSheet(context, store, event),
                ),
              ],
            ),
          ),
          const ArenaMessage(
            'El debate abierto de opiniones todavía no está habilitado en el '
            'servidor. Por ahora puedes votar el respaldo del caso y publicar '
            'aportes con su fuente en «Aportes».',
          ),
        ];
      case 2:
        return const <Widget>[
          ArenaMessage(
            'Todavía no hay notas de contexto verificadas para este caso. '
            'Las notas se publicarán aquí cuando un aporte con fuente sea '
            'revisado.',
          ),
        ];
      default:
        if (comments.isEmpty) {
          return const <Widget>[
            ArenaMessage(
              'Aún no hay aportes. Sé la primera persona en sumar contexto '
              'con una fuente original.',
            ),
          ];
        }
        return <Widget>[
          for (int i = 0; i < comments.length; i++)
            _ContributionCard(
              comment: comments[i],
              event: event,
              mark: _marks['$i'] ?? 0,
              onMark: (int value) => setState(
                () => _marks['$i'] = _marks['$i'] == value ? 0 : value,
              ),
              onReply: () {
                _focus.requestFocus();
                setState(() => _pill = 1);
              },
              onOpen: () => unawaited(store.openLink(comments[i].url)),
            ),
        ];
    }
  }

  Widget _composer(BuildContext context) => Material(
    color: ArenaColors.card,
    child: SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          12,
          8,
          12,
          8 + MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            if (_attached != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  children: <Widget>[
                    const Icon(Icons.link, size: 16, color: ArenaColors.violet),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        'Adjunto: ${_attached!.title}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: ArenaText.meta,
                      ),
                    ),
                    IconButton(
                      tooltip: 'Quitar adjunto',
                      onPressed: () => setState(() => _attached = null),
                      icon: const Icon(Icons.close, size: 18),
                    ),
                  ],
                ),
              ),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: <Widget>[
                IconButton(
                  key: const Key('arena-community-attach'),
                  tooltip: 'Adjuntar enlace de la cobertura',
                  color: ArenaColors.violet,
                  onPressed: _attach,
                  icon: const Icon(Icons.link),
                ),
                Expanded(
                  child: TextField(
                    key: const Key('arena-community-input'),
                    controller: _input,
                    focusNode: _focus,
                    minLines: 1,
                    maxLines: 4,
                    maxLength: 600,
                    textInputAction: TextInputAction.newline,
                    decoration: InputDecoration(
                      counterText: '',
                      hintText: 'Aporta contexto, evidencia o tu análisis...',
                      hintMaxLines: 2,
                      filled: true,
                      fillColor: ArenaColors.background,
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 10,
                      ),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(20),
                        borderSide: const BorderSide(color: ArenaColors.border),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(20),
                        borderSide: const BorderSide(color: ArenaColors.border),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                IconButton.filled(
                  key: const Key('arena-community-send'),
                  tooltip: 'Enviar aporte',
                  style: IconButton.styleFrom(
                    backgroundColor: ArenaColors.violet,
                    foregroundColor: Colors.white,
                  ),
                  onPressed: _sending ? null : _send,
                  icon: const Icon(Icons.send),
                ),
              ],
            ),
          ],
        ),
      ),
    ),
  );
}

class _ContributionCard extends StatelessWidget {
  const _ContributionCard({
    required this.comment,
    required this.event,
    required this.mark,
    required this.onMark,
    required this.onReply,
    required this.onOpen,
  });

  final SocialComment comment;
  final EventDetailDto event;
  final int mark;
  final ValueChanged<int> onMark;
  final VoidCallback onReply;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final bool pdf = comment.url.path.toLowerCase().endsWith('.pdf');
    String title = comment.url.host;
    for (final EventCoverageArticleDto article in event.articles) {
      if (article.id == comment.articleId || article.url == comment.url) {
        title = article.title;
      }
    }
    return ArenaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              const CircleAvatar(
                radius: 16,
                backgroundColor: ArenaColors.violetSoft,
                child: Icon(
                  Icons.person,
                  size: 18,
                  color: ArenaColors.violetDeep,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Integrante de la comunidad'
                  '${comment.createdAt == null ? '' : ' · ${arenaAgo(comment.createdAt!)}'}',
                  style: ArenaText.meta,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(comment.body, style: ArenaText.body),
          const SizedBox(height: 10),
          Semantics(
            button: true,
            label: 'Abrir fuente adjunta: $title',
            child: InkWell(
              onTap: onOpen,
              borderRadius: BorderRadius.circular(12),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: ArenaColors.background,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: ArenaColors.border),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      DecoratedBox(
                        decoration: BoxDecoration(
                          color: pdf
                              ? const Color(0xFFDC2626)
                              : const Color(0xFF2563EB),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 7,
                            vertical: 4,
                          ),
                          child: Text(
                            pdf ? 'PDF' : 'Enlace',
                            style: const TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(title, style: ArenaText.cardTitle),
                            Text(
                              comment.url.toString(),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 12,
                                color: ArenaColors.violet,
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
          ),
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              IconButton(
                tooltip: 'Me sirve (solo en este dispositivo)',
                color: mark == 1 ? ArenaColors.violet : ArenaColors.muted,
                onPressed: () => onMark(1),
                icon: Icon(
                  mark == 1 ? Icons.thumb_up : Icons.thumb_up_outlined,
                  size: 20,
                ),
              ),
              IconButton(
                tooltip: 'No me sirve (solo en este dispositivo)',
                color: mark == 2 ? ArenaColors.violet : ArenaColors.muted,
                onPressed: () => onMark(2),
                icon: Icon(
                  mark == 2 ? Icons.thumb_down : Icons.thumb_down_outlined,
                  size: 20,
                ),
              ),
              TextButton(
                style: TextButton.styleFrom(
                  foregroundColor: ArenaColors.violet,
                ),
                onPressed: onReply,
                child: const Text('Responder'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
