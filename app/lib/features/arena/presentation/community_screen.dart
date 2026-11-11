import 'dart:async';

import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/presentation/arena_widgets.dart';
import 'package:dialektik/features/arena/presentation/duel_screen.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/social/data/arena_social_repository.dart';
import 'package:dialektik/features/social/data/social_repository.dart';
import 'package:flutter/material.dart';

/// Pantalla 5 — participation of one case, separated by nature.
///
/// Debate, Aportes and Notas are stored in Core with their author alias and
/// shared 👍/👎 counts. Against a Core that does not serve them yet, the
/// screen falls back to the earlier evidence contributions.
class CommunityScreen extends StatefulWidget {
  const CommunityScreen({required this.event, required this.store, super.key});

  final EventDetailDto event;
  final ArenaStore store;

  @override
  State<CommunityScreen> createState() => _CommunityScreenState();
}

class _CommunityScreenState extends State<CommunityScreen> {
  static const List<CommunityChannel> _channels = <CommunityChannel>[
    CommunityChannel.debate,
    CommunityChannel.aporte,
    CommunityChannel.nota,
  ];
  final TextEditingController _input = TextEditingController();
  final FocusNode _focus = FocusNode();
  final Set<String> _voting = <String>{};
  int _pill = 1;
  bool _loading = true;
  bool _sending = false;

  /// True once Core has answered with the three channels.
  bool _channelsReady = false;
  EventCoverageArticleDto? _attached;
  Uri? _attachedLink;

  ArenaStore get store => widget.store;
  EventDetailDto get event => widget.event;
  CommunityChannel get _channel => _channels[_pill];
  bool get _hasSource => _attached != null || _attachedLink != null;

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
    final List<CommunityEntry>? entries = await store.community(event.id);
    try {
      await store.summary(event.id, refresh: true);
    } on Exception {
      /* The empty state explains that nothing could be read. */
    }
    if (!mounted) return;
    setState(() {
      _channelsReady = entries != null;
      _loading = false;
    });
  }

  void _say(String message) => ScaffoldMessenger.of(
    context,
  ).showSnackBar(SnackBar(content: Text(message)));

  Future<void> _attach() async {
    final Object? chosen = await showModalBottomSheet<Object>(
      context: context,
      isScrollControlled: true,
      backgroundColor: ArenaColors.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (BuildContext sheetContext) =>
          _AttachSheet(event: event, allowExternalLink: _channelsReady),
    );
    if (!mounted || chosen == null) return;
    setState(() {
      _attached = chosen is EventCoverageArticleDto ? chosen : null;
      _attachedLink = chosen is Uri ? chosen : null;
    });
  }

  Future<void> _send() async {
    final String body = _input.text.trim();
    if (_sending) return;
    if (store.social == null && store.arenaSocial == null) {
      _say('Inicia sesión para participar en la comunidad.');
      return;
    }
    if (body.isEmpty) {
      _say('Escribe tu aporte antes de enviarlo.');
      return;
    }
    if (body.length > 600) {
      _say('El texto admite hasta 600 caracteres.');
      return;
    }
    final bool needsSource =
        !_channelsReady || _channel != CommunityChannel.debate;
    if (needsSource && !_hasSource) {
      await _attach();
      if (!_hasSource) return;
    }
    setState(() => _sending = true);
    try {
      final ArenaSocialRepository? arena = store.arenaSocial;
      if (_channelsReady && arena != null) {
        store.rememberCommunity(
          event.id,
          await arena.addCommunityEntry(
            event.id,
            channel: _channel,
            body: body,
            articleId: _attached?.id,
            link: _attachedLink,
          ),
        );
      } else {
        // Core without the three channels: an evidence contribution.
        final SocialRepository? social = store.social;
        final EventCoverageArticleDto? article = _attached;
        if (social == null || article == null) {
          throw const FormatException('Evidence required');
        }
        store.rememberSummary(
          event.id,
          await social.addSocialComment(event.id, article.id, body),
        );
        _pill = 1;
      }
      if (!mounted) return;
      _input.clear();
      setState(() {
        _attached = null;
        _attachedLink = null;
      });
    } on Exception {
      if (mounted) _say('No se pudo publicar tu aporte.');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _voteEntry(CommunityEntry entry, int vote) async {
    final ArenaSocialRepository? arena = store.arenaSocial;
    if (arena == null || _voting.contains(entry.id)) return;
    setState(() => _voting.add(entry.id));
    try {
      store.rememberCommunity(
        event.id,
        await arena.voteCommunityEntry(
          entry.id,
          entry.myVote == vote ? null : vote,
        ),
      );
    } on Exception {
      if (mounted) _say('No se pudo guardar tu voto.');
    } finally {
      if (mounted) setState(() => _voting.remove(entry.id));
    }
  }

  void _reply(CommunityEntry entry) {
    if (_input.text.trim().isEmpty) {
      _input.text = '@${entry.author} ';
      _input.selection = TextSelection.collapsed(offset: _input.text.length);
    }
    _focus.requestFocus();
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
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        // The channel pills stay pinned while the entries scroll.
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(
                event.titleDescriptive,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: ArenaText.cardTitle,
              ),
              const SizedBox(height: 10),
              ArenaPillBar(
                padding: EdgeInsets.zero,
                labels: const <String>['Debate', 'Aportes', 'Notas'],
                selected: _pill,
                onSelected: (int value) => setState(() => _pill = value),
              ),
            ],
          ),
        ),
        Expanded(
          child: ListenableBuilder(
            listenable: store,
            builder: (BuildContext context, _) => ListView(
              key: const Key('arena-community-scroll'),
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
              children: _body(context),
            ),
          ),
        ),
        _composer(context),
      ],
    ),
  );

  /// Entries of the selected channel. Without the three channels in Core,
  /// earlier evidence comments are shown as contributions.
  List<CommunityEntry> _entries() {
    if (_channelsReady) {
      return (store.cachedCommunity(event.id) ?? const <CommunityEntry>[])
          .where((CommunityEntry entry) => entry.channel == _channel)
          .toList();
    }
    if (_channel != CommunityChannel.aporte) return const <CommunityEntry>[];
    final List<SocialComment> comments =
        store.cachedSummary(event.id)?.comments ?? const <SocialComment>[];
    return <CommunityEntry>[
      for (int i = 0; i < comments.length; i++)
        CommunityEntry(
          id: 'legacy-$i',
          channel: CommunityChannel.aporte,
          author: 'Integrante de la comunidad',
          body: comments[i].body,
          articleId: comments[i].articleId,
          url: comments[i].url,
          createdAt: comments[i].createdAt,
        ),
    ];
  }

  List<Widget> _body(BuildContext context) {
    if (_loading) {
      return const <Widget>[
        Padding(
          padding: EdgeInsets.all(24),
          child: Center(
            child: CircularProgressIndicator(color: ArenaColors.violet),
          ),
        ),
      ];
    }
    final List<CommunityEntry> entries = _entries();
    final ArenaDuel? duel = store.duelForEvent(event.id);
    return <Widget>[
      if (_channel == CommunityChannel.debate)
        ArenaCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              const Text(
                'Opiniones e interpretaciones',
                style: ArenaText.section,
              ),
              const SizedBox(height: 10),
              if (duel != null)
                arenaDuelThermometer(store, duel)
              else
                EvidenceThermometer(summary: store.cachedSummary(event.id)),
              const SizedBox(height: 12),
              ArenaPrimaryButton(
                label: 'Votar en el termómetro',
                onPressed: () => showArenaVoteSheet(context, store, event),
              ),
            ],
          ),
        ),
      if (!_channelsReady && _channel != CommunityChannel.aporte)
        ArenaMessage(
          _channel == CommunityChannel.debate
              ? 'El debate abierto todavía no está habilitado en el '
                    'servidor. Por ahora puedes votar y publicar aportes con '
                    'su fuente en «Aportes».'
              : 'Las notas de contexto todavía no están habilitadas en el '
                    'servidor.',
        )
      else if (entries.isEmpty)
        ArenaMessage(switch (_channel) {
          CommunityChannel.debate =>
            'Aún no hay opiniones. Abre el debate con tu interpretación.',
          CommunityChannel.aporte =>
            'Aún no hay aportes. Sé la primera persona en sumar un enlace '
                'o documento.',
          CommunityChannel.nota =>
            'Aún no hay notas de contexto. Agrega una con su fuente '
                'verificable.',
        }),
      for (final CommunityEntry entry in entries)
        _ContributionCard(
          key: ValueKey<String>('arena-entry-${entry.id}'),
          entry: entry,
          event: event,
          votable: _channelsReady && !_voting.contains(entry.id),
          showVotes: _channelsReady,
          onVote: (int vote) => _voteEntry(entry, vote),
          onReply: () => _reply(entry),
          onOpen: entry.hasLink
              ? () => unawaited(store.openLink(entry.url!))
              : null,
        ),
    ];
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
            if (_hasSource)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  children: <Widget>[
                    const Icon(Icons.link, size: 16, color: ArenaColors.violet),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        'Adjunto: '
                        '${_attached?.title ?? _attachedLink.toString()}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: ArenaText.meta,
                      ),
                    ),
                    IconButton(
                      tooltip: 'Quitar adjunto',
                      onPressed: () => setState(() {
                        _attached = null;
                        _attachedLink = null;
                      }),
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
                  tooltip: 'Adjuntar enlace',
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
                  tooltip: 'Enviar',
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

/// Picks the source of an entry: a publication of the case or a pasted link.
class _AttachSheet extends StatefulWidget {
  const _AttachSheet({required this.event, required this.allowExternalLink});

  final EventDetailDto event;
  final bool allowExternalLink;

  @override
  State<_AttachSheet> createState() => _AttachSheetState();
}

class _AttachSheetState extends State<_AttachSheet> {
  final TextEditingController _link = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _link.dispose();
    super.dispose();
  }

  void _useLink() {
    final Uri? uri = Uri.tryParse(_link.text.trim());
    if (uri == null ||
        (uri.scheme != 'https' && uri.scheme != 'http') ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty) {
      setState(
        () => _error = 'Pega un enlace completo que empiece con https://',
      );
      return;
    }
    Navigator.of(context).pop(uri);
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          const Text(
            'Adjunta la fuente de tu aporte',
            style: ArenaText.section,
          ),
          if (widget.allowExternalLink) ...<Widget>[
            const SizedBox(height: 10),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: TextField(
                    key: const Key('arena-attach-link'),
                    controller: _link,
                    keyboardType: TextInputType.url,
                    onSubmitted: (_) => _useLink(),
                    decoration: InputDecoration(
                      hintText: 'https://… enlace o documento',
                      errorText: _error,
                      errorMaxLines: 3,
                      isDense: true,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
                  key: const Key('arena-attach-link-use'),
                  tooltip: 'Usar este enlace',
                  style: IconButton.styleFrom(
                    backgroundColor: ArenaColors.violet,
                    foregroundColor: Colors.white,
                  ),
                  onPressed: _useLink,
                  icon: const Icon(Icons.check),
                ),
              ],
            ),
          ],
          const SizedBox(height: 12),
          const Text('O elige una publicación del caso', style: ArenaText.meta),
          for (final EventCoverageArticleDto article in widget.event.articles)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: MediaEmblem(name: article.sourceName, size: 32),
              title: Text(article.title, style: ArenaText.cardTitle),
              subtitle: Text(
                arenaSourceName(article.sourceName),
                style: ArenaText.meta,
              ),
              onTap: () => Navigator.of(context).pop(article),
            ),
        ],
      ),
    ),
  );
}

class _ContributionCard extends StatelessWidget {
  const _ContributionCard({
    required this.entry,
    required this.event,
    required this.votable,
    required this.showVotes,
    required this.onVote,
    required this.onReply,
    required this.onOpen,
    super.key,
  });

  final CommunityEntry entry;
  final EventDetailDto event;
  final bool votable;
  final bool showVotes;
  final ValueChanged<int> onVote;
  final VoidCallback onReply;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    final Uri? url = entry.hasLink ? entry.url : null;
    final bool pdf = url != null && url.path.toLowerCase().endsWith('.pdf');
    String title = url?.host ?? '';
    for (final EventCoverageArticleDto article in event.articles) {
      if (article.id == entry.articleId || article.url == url) {
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
                child: Text.rich(
                  TextSpan(
                    text: entry.mine ? '${entry.author} (tú)' : entry.author,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: ArenaColors.ink,
                    ),
                    children: <InlineSpan>[
                      if (entry.createdAt != null)
                        TextSpan(
                          text: ' · ${arenaAgo(entry.createdAt!)}',
                          style: ArenaText.meta,
                        ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(entry.body, style: ArenaText.body),
          if (url != null) ...<Widget>[
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
                                url.toString(),
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
          ],
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              if (showVotes) ...<Widget>[
                _VoteButton(
                  key: ValueKey<String>('arena-entry-up-${entry.id}'),
                  icon: entry.myVote == 1
                      ? Icons.thumb_up
                      : Icons.thumb_up_outlined,
                  count: entry.upvotes,
                  active: entry.myVote == 1,
                  label: 'Útil',
                  onPressed: votable ? () => onVote(1) : null,
                ),
                _VoteButton(
                  key: ValueKey<String>('arena-entry-down-${entry.id}'),
                  icon: entry.myVote == -1
                      ? Icons.thumb_down
                      : Icons.thumb_down_outlined,
                  count: entry.downvotes,
                  active: entry.myVote == -1,
                  label: 'No útil',
                  onPressed: votable ? () => onVote(-1) : null,
                ),
              ],
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

class _VoteButton extends StatelessWidget {
  const _VoteButton({
    required this.icon,
    required this.count,
    required this.active,
    required this.label,
    required this.onPressed,
    super.key,
  });

  final IconData icon;
  final int count;
  final bool active;
  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: '$label, $count ${count == 1 ? 'voto' : 'votos'}',
    child: ExcludeSemantics(
      child: TextButton.icon(
        style: TextButton.styleFrom(
          foregroundColor: active ? ArenaColors.violet : ArenaColors.muted,
          minimumSize: const Size(48, 44),
        ),
        onPressed: onPressed,
        icon: Icon(icon, size: 20),
        label: Text('$count'),
      ),
    ),
  );
}
