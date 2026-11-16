import 'dart:async';

import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/science/data/science_models.dart';
import 'package:dialektik/features/science/data/science_repository.dart';
import 'package:dialektik/features/science/presentation/science_format.dart';
import 'package:dialektik/features/science/presentation/science_widgets.dart';
import 'package:dialektik/features/science/presentation/study_comment_sheet.dart';
import 'package:dialektik/features/science/presentation/study_label_screen.dart';
import 'package:flutter/material.dart';

enum CommentFilter { all, withStudy }

enum CommentOrder { recent, useful }

/// The thread of one story: loading, posting, reacting and filters.
class StoryCommentsController extends ChangeNotifier {
  StoryCommentsController({required this.store, required this.eventId});

  final ArenaStore store;
  final String eventId;

  List<StoryComment> comments = const <StoryComment>[];
  bool loading = true;
  bool failed = false;
  CommentFilter filter = CommentFilter.all;
  CommentOrder order = CommentOrder.recent;

  /// Comment being answered from the composer.
  StoryComment? replyingTo;

  /// Ids added in this session, which fade in once.
  final Set<String> fresh = <String>{};
  bool _disposed = false;

  ScienceRepository? get _repository => store.science;

  int get total => comments.length;
  int get withStudyCount =>
      comments.where((StoryComment c) => c.withStudy).length;

  Future<void> load() async {
    final ScienceRepository? repository = _repository;
    if (repository == null) {
      loading = false;
      failed = true;
      _notify();
      return;
    }
    try {
      comments = await repository.storyComments(eventId);
      failed = false;
    } on Object {
      failed = true;
    }
    loading = false;
    _notify();
  }

  void setFilter(CommentFilter value) {
    filter = value;
    _notify();
  }

  void setOrder(CommentOrder value) {
    order = value;
    _notify();
  }

  void replyTo(StoryComment? comment) {
    replyingTo = comment;
    _notify();
  }

  /// Top-level comments for the current filter and order.
  List<StoryComment> get topLevel {
    final List<StoryComment> items = comments
        .where(
          (StoryComment c) =>
              c.parentId == null &&
              (filter == CommentFilter.all || c.withStudy),
        )
        .toList();
    items.sort(
      (StoryComment a, StoryComment b) => order == CommentOrder.useful
          ? b.reactions.compareTo(a.reactions)
          : b.createdAt.compareTo(a.createdAt),
    );
    return items;
  }

  List<StoryComment> repliesOf(String id) =>
      comments.where((StoryComment c) => c.parentId == id).toList()..sort(
        (StoryComment a, StoryComment b) => a.createdAt.compareTo(b.createdAt),
      );

  Future<bool> post(String body) async {
    final ScienceRepository? repository = _repository;
    final String text = body.trim();
    if (repository == null || text.isEmpty) return false;
    try {
      final StoryComment created = await repository.addComment(
        eventId,
        body: text,
        parentId: replyingTo?.id,
      );
      add(created);
      replyingTo = null;
      _notify();
      return true;
    } on Object {
      return false;
    }
  }

  void add(StoryComment comment) {
    fresh.add(comment.id);
    comments = <StoryComment>[...comments, comment];
    _notify();
  }

  Future<void> react(StoryComment comment) async {
    final ScienceRepository? repository = _repository;
    if (repository == null) return;
    final bool next = !comment.reacted;
    _replace(
      comment.copyWith(
        reacted: next,
        reactions: comment.reactions + (next ? 1 : -1),
      ),
    );
    try {
      _replace(await repository.react(comment.id, reacted: next));
    } on Object {
      _replace(comment);
    }
  }

  void _replace(StoryComment updated) {
    comments = <StoryComment>[
      for (final StoryComment c in comments) c.id == updated.id ? updated : c,
    ];
    _notify();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

/// The author's text with the chosen relation in bold, in its own sentence.
List<InlineSpan> commentBodySpans(StoryComment comment) {
  final StudyAttachmentData? attachment = comment.attachment;
  if (attachment == null) return <InlineSpan>[TextSpan(text: comment.body)];
  final String phrase = attachment.relation.inSentence;
  final int at = comment.body.toLowerCase().indexOf(phrase);
  const TextStyle bold = TextStyle(fontWeight: FontWeight.w700);
  if (at >= 0) {
    return <InlineSpan>[
      TextSpan(text: comment.body.substring(0, at)),
      TextSpan(
        text: comment.body.substring(at, at + phrase.length),
        style: bold,
      ),
      TextSpan(text: comment.body.substring(at + phrase.length)),
    ];
  }
  return <InlineSpan>[
    TextSpan(text: '${comment.body} Según el estudio, '),
    TextSpan(text: phrase, style: bold),
    const TextSpan(text: '.'),
  ];
}

/// What a screen reader says for a comment.
String commentSemantics(StoryComment comment, {DateTime? now}) {
  final StudyAttachmentData? a = comment.attachment;
  final String when = sciAgoSpoken(comment.createdAt, now: now);
  final String review = comment.status == CommentStatus.inReview
      ? ' En revisión.'
      : '';
  if (a == null) {
    return 'Comentario de @${comment.author}, $when.$review ${comment.body}';
  }
  final String body = commentBodySpans(
    comment,
  ).map((InlineSpan s) => (s as TextSpan).text ?? '').join();
  return 'Comentario de @${comment.author}, $when, con estudio.$review '
      'Responde a: ${a.claim.text}. $body Estudio adjunto: '
      '${a.study.title}, ${(a.study.design ?? notInformed).toLowerCase()}, '
      '${a.study.reviewLabel.toLowerCase()}.';
}

/// One comment: monogram, header, optional study context, text, actions.
/// A comment with a study looks exactly like any other; only its attached
/// content differs.
class CommentTile extends StatelessWidget {
  const CommentTile({
    required this.comment,
    required this.onReply,
    required this.onReact,
    this.onOpenStudy,
    this.reply = false,
    this.now,
    super.key,
  });

  final StoryComment comment;
  final VoidCallback? onReply;
  final VoidCallback onReact;
  final VoidCallback? onOpenStudy;

  /// Smaller monogram and text inside a thread.
  final bool reply;
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final StudyAttachmentData? attachment = comment.attachment;
    final TextStyle bodyStyle = reply
        ? const TextStyle(
            fontFamily: SciText.sans,
            fontSize: 14,
            height: 20 / 14,
            color: SciColors.ink,
          )
        : SciText.body;
    return Padding(
      padding: EdgeInsets.fromLTRB(reply ? 0 : 16, 12, 16, reply ? 4 : 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Monogram(comment.author, size: reply ? 26 : 34),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Semantics(
                  container: true,
                  label: commentSemantics(comment, now: now),
                  excludeSemantics: true,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: <Widget>[
                          Text.rich(
                            TextSpan(
                              children: <InlineSpan>[
                                TextSpan(
                                  text: '@${comment.author}',
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w700,
                                    color: SciColors.ink,
                                  ),
                                ),
                                TextSpan(
                                  text:
                                      ' · ${sciAgo(comment.createdAt, now: now)}',
                                ),
                              ],
                            ),
                            style: SciText.meta,
                          ),
                          if (attachment != null)
                            const Row(
                              mainAxisSize: MainAxisSize.min,
                              children: <Widget>[
                                Icon(
                                  SciIcons.flask,
                                  size: 13,
                                  color: SciColors.tagText,
                                ),
                                SizedBox(width: 3),
                                Text(
                                  'con estudio',
                                  style: TextStyle(
                                    fontFamily: SciText.sans,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                    color: SciColors.tagText,
                                  ),
                                ),
                              ],
                            ),
                          if (comment.status == CommentStatus.inReview)
                            const StudyTag('En revisión'),
                        ],
                      ),
                      if (attachment != null) ...<Widget>[
                        const SizedBox(height: 4),
                        Text.rich(
                          TextSpan(
                            children: <InlineSpan>[
                              const TextSpan(text: 'Responde a '),
                              TextSpan(
                                text: '“${attachment.claim.text}”',
                                style: const TextStyle(
                                  fontFamily: SciText.serif,
                                  color: SciColors.ink,
                                ),
                              ),
                              TextSpan(text: ' · ${attachment.claim.outlet}'),
                            ],
                          ),
                          style: SciText.meta,
                        ),
                      ],
                      const SizedBox(height: 4),
                      Text.rich(
                        TextSpan(children: commentBodySpans(comment)),
                        style: bodyStyle,
                      ),
                    ],
                  ),
                ),
                if (attachment != null) ...<Widget>[
                  const SizedBox(height: 8),
                  StudyAttachment(
                    data: attachment,
                    onOpen: onOpenStudy ?? () {},
                  ),
                ],
                const SizedBox(height: 4),
                Transform.translate(
                  offset: const Offset(-10, 0),
                  child: Wrap(
                    children: <Widget>[
                      if (onReply != null)
                        ReactionButton(
                          icon: SciIcons.reply,
                          label: 'Responder',
                          semanticsLabel: 'Responder a @${comment.author}',
                          onTap: onReply,
                        ),
                      ReactionButton(
                        icon: attachment == null
                            ? SciIcons.useful
                            : SciIcons.pertinent,
                        activeIcon: attachment == null
                            ? SciIcons.usefulActive
                            : SciIcons.pertinentActive,
                        label:
                            '${attachment == null ? 'Útil' : 'Pertinente'} · '
                            '${comment.reactions}',
                        active: comment.reacted,
                        onTap: onReact,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A top-level comment with up to two visible replies and the thread line.
class CommentThread extends StatefulWidget {
  const CommentThread({
    required this.comment,
    required this.replies,
    required this.controller,
    this.now,
    super.key,
  });

  final StoryComment comment;
  final List<StoryComment> replies;
  final StoryCommentsController controller;
  final DateTime? now;

  @override
  State<CommentThread> createState() => _CommentThreadState();
}

class _CommentThreadState extends State<CommentThread> {
  bool _expanded = false;

  void _openStudy(StoryComment c) {
    final Study? study = c.attachment?.study;
    if (study != null) {
      unawaited(openStudyLabel(context, widget.controller.store, study));
    }
  }

  @override
  Widget build(BuildContext context) {
    final List<StoryComment> replies = widget.replies;
    final List<StoryComment> shown = _expanded
        ? replies
        : replies.take(2).toList();
    final Widget parent = CommentTile(
      comment: widget.comment,
      now: widget.now,
      onReply: () => widget.controller.replyTo(widget.comment),
      onReact: () => unawaited(widget.controller.react(widget.comment)),
      onOpenStudy: () => _openStudy(widget.comment),
    );
    if (replies.isEmpty) return parent;
    return Stack(
      children: <Widget>[
        // The 2 pt line under the parent's monogram down to the last reply.
        const Positioned(
          left: 16 + 17 - 1,
          top: 12 + 34 + 4,
          bottom: 24,
          child: SizedBox(
            width: 2,
            child: ColoredBox(color: SciColors.borderCard),
          ),
        ),
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            parent,
            for (final StoryComment reply in shown)
              Padding(
                padding: const EdgeInsets.only(left: 60),
                child: _FadeIn(
                  enabled: widget.controller.fresh.contains(reply.id),
                  child: CommentTile(
                    comment: reply,
                    reply: true,
                    now: widget.now,
                    onReply: () => widget.controller.replyTo(widget.comment),
                    onReact: () => unawaited(widget.controller.react(reply)),
                    onOpenStudy: () => _openStudy(reply),
                  ),
                ),
              ),
            if (!_expanded && replies.length > 2)
              Padding(
                padding: const EdgeInsets.only(left: 50, bottom: 8),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    key: ValueKey<String>('sci-more-${widget.comment.id}'),
                    style: TextButton.styleFrom(
                      minimumSize: const Size(44, 44),
                      foregroundColor: SciColors.primaryText,
                      textStyle: const TextStyle(
                        fontFamily: SciText.sans,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    onPressed: () => setState(() => _expanded = true),
                    child: Text(moreRepliesLabel(replies.length - 2)),
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

class _FadeIn extends StatelessWidget {
  const _FadeIn({required this.enabled, required this.child, super.key});

  final bool enabled;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (!enabled || MediaQuery.disableAnimationsOf(context)) return child;
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(begin: 0, end: 1),
      duration: const Duration(milliseconds: 200),
      builder: (BuildContext context, double value, Widget? child) =>
          Opacity(opacity: value, child: child),
      child: child,
    );
  }
}

/// C3 · the «Comentarios» tab content, inside the story's scroll view.
List<Widget> storyCommentsChildren(
  BuildContext context,
  StoryCommentsController controller,
  EventDetailDto event, {
  DateTime? now,
}) {
  if (controller.loading) {
    return const <Widget>[
      Padding(
        padding: EdgeInsets.all(24),
        child: Center(
          child: CircularProgressIndicator(color: SciColors.primary),
        ),
      ),
    ];
  }
  if (controller.failed) {
    return <Widget>[
      Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: <Widget>[
            const Text(
              'No pudimos cargar los comentarios',
              textAlign: TextAlign.center,
              style: SciText.body,
            ),
            TextButton(
              style: TextButton.styleFrom(
                minimumSize: const Size(44, 44),
                foregroundColor: SciColors.primaryText,
              ),
              onPressed: () => unawaited(controller.load()),
              child: const Text('Reintentar'),
            ),
          ],
        ),
      ),
    ];
  }
  final List<StoryComment> top = controller.topLevel;
  return <Widget>[
    _FilterBar(controller: controller),
    if (controller.comments.isEmpty)
      Padding(
        key: const Key('sci-comments-empty'),
        padding: const EdgeInsets.fromLTRB(16, 24, 16, 24),
        child: Column(
          children: <Widget>[
            const Text(
              'Sé la primera persona en comentar',
              textAlign: TextAlign.center,
              style: SciText.cardTitle,
            ),
            TextButton.icon(
              style: TextButton.styleFrom(
                minimumSize: const Size(44, 44),
                foregroundColor: SciColors.primaryText,
              ),
              onPressed: () =>
                  unawaited(_openStudySheet(context, controller, event)),
              icon: const Icon(SciIcons.flask, size: 18),
              label: const Text('También puedes aportar un estudio'),
            ),
          ],
        ),
      ),
    for (int i = 0; i < top.length; i++) ...<Widget>[
      if (i > 0)
        const Divider(height: 1, thickness: 1, color: SciColors.divider),
      _FadeIn(
        key: ValueKey<String>('sci-comment-${top[i].id}'),
        enabled: controller.fresh.contains(top[i].id),
        child: CommentThread(
          comment: top[i],
          replies: controller.repliesOf(top[i].id),
          controller: controller,
          now: now,
        ),
      ),
    ],
  ];
}

Future<void> _openStudySheet(
  BuildContext context,
  StoryCommentsController controller,
  EventDetailDto event,
) async {
  final StoryComment? created = await showStudyCommentSheet(
    context,
    controller.store,
    event: event,
    existing: controller.comments,
  );
  if (created != null) controller.add(created);
}

class _FilterBar extends StatelessWidget {
  const _FilterBar({required this.controller});

  final StoryCommentsController controller;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
    child: Row(
      children: <Widget>[
        Expanded(
          child: Wrap(
            spacing: 8,
            runSpacing: 8,
            children: <Widget>[
              SelectChip(
                key: const Key('sci-comments-all'),
                label: 'Todos ${controller.total}',
                fontSize: 13,
                selected: controller.filter == CommentFilter.all,
                onTap: () => controller.setFilter(CommentFilter.all),
              ),
              SelectChip(
                key: const Key('sci-comments-study'),
                label: 'Con estudio ${controller.withStudyCount}',
                fontSize: 13,
                selected: controller.filter == CommentFilter.withStudy,
                onTap: () => controller.setFilter(CommentFilter.withStudy),
              ),
            ],
          ),
        ),
        PopupMenuButton<CommentOrder>(
          key: const Key('sci-comments-order'),
          tooltip: 'Ordenar comentarios',
          initialValue: controller.order,
          onSelected: controller.setOrder,
          itemBuilder: (BuildContext context) =>
              const <PopupMenuEntry<CommentOrder>>[
                PopupMenuItem<CommentOrder>(
                  value: CommentOrder.recent,
                  height: 44,
                  child: Text('Recientes'),
                ),
                PopupMenuItem<CommentOrder>(
                  value: CommentOrder.useful,
                  height: 44,
                  child: Text('Más útiles'),
                ),
              ],
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 44, minWidth: 44),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  controller.order == CommentOrder.recent
                      ? 'Recientes'
                      : 'Más útiles',
                  style: const TextStyle(
                    fontFamily: SciText.sans,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: SciColors.tagText,
                  ),
                ),
                const Icon(
                  SciIcons.chevronDown,
                  size: 16,
                  color: SciColors.tagText,
                ),
              ],
            ),
          ),
        ),
      ],
    ),
  );
}

/// Fixed at the bottom of the comments tab.
class CommentComposer extends StatefulWidget {
  const CommentComposer({
    required this.controller,
    required this.event,
    super.key,
  });

  final StoryCommentsController controller;
  final EventDetailDto event;

  @override
  State<CommentComposer> createState() => _CommentComposerState();
}

class _CommentComposerState extends State<CommentComposer> {
  final TextEditingController _text = TextEditingController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _text.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_busy) return;
    setState(() => _busy = true);
    final bool ok = await widget.controller.post(_text.text);
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      _text.clear();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No pudimos publicar el comentario.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final bool typing = _text.text.trim().isNotEmpty;
    final StoryComment? replying = widget.controller.replyingTo;
    return Material(
      color: SciColors.surface,
      child: SafeArea(
        top: false,
        child: DecoratedBox(
          decoration: const BoxDecoration(
            border: Border(top: BorderSide(color: SciColors.borderCard)),
          ),
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              12,
              10,
              12,
              14 + MediaQuery.viewInsetsOf(context).bottom,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                if (replying != null)
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: Text(
                          'Respondiendo a @${replying.author}',
                          style: SciText.meta,
                        ),
                      ),
                      IconButton(
                        tooltip: 'Cancelar respuesta',
                        constraints: const BoxConstraints.tightFor(
                          width: 44,
                          height: 44,
                        ),
                        onPressed: () => widget.controller.replyTo(null),
                        icon: const Icon(Icons.close_rounded, size: 18),
                      ),
                    ],
                  ),
                Row(
                  children: <Widget>[
                    Expanded(
                      child: TextField(
                        key: const Key('sci-composer-input'),
                        controller: _text,
                        minLines: 1,
                        maxLines: 4,
                        style: SciText.body,
                        decoration: InputDecoration(
                          hintText: 'Escribe un comentario…',
                          hintStyle: const TextStyle(
                            color: SciColors.inkSecondary,
                          ),
                          filled: true,
                          fillColor: SciColors.bgApp,
                          isDense: true,
                          constraints: const BoxConstraints(minHeight: 44),
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 11,
                          ),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(SciRadius.pill),
                            borderSide: const BorderSide(
                              color: SciColors.borderControl,
                            ),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(SciRadius.pill),
                            borderSide: const BorderSide(
                              color: SciColors.borderControl,
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    if (typing)
                      IconButton(
                        key: const Key('sci-composer-send'),
                        tooltip: 'Enviar comentario',
                        constraints: const BoxConstraints.tightFor(
                          width: 44,
                          height: 44,
                        ),
                        color: SciColors.primary,
                        onPressed: _busy ? null : () => unawaited(_send()),
                        icon: const Icon(SciIcons.send, size: 22),
                      )
                    else
                      OutlinedButton.icon(
                        key: const Key('sci-composer-study'),
                        onPressed: () => unawaited(
                          _openStudySheet(
                            context,
                            widget.controller,
                            widget.event,
                          ),
                        ),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(44, 44),
                          padding: const EdgeInsets.symmetric(horizontal: 14),
                          foregroundColor: SciColors.primaryText,
                          side: const BorderSide(color: SciColors.primary),
                          shape: const StadiumBorder(),
                          textStyle: const TextStyle(
                            fontFamily: SciText.sans,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        icon: const Icon(SciIcons.flask, size: 18),
                        label: const Text('Estudio'),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Story tabs: natural widths, scrolling when they do not fit.
class StoryTabs extends StatelessWidget {
  const StoryTabs({
    required this.labels,
    required this.selected,
    required this.onSelected,
    super.key,
  });

  final List<String> labels;
  final int selected;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(
      border: Border(bottom: BorderSide(color: SciColors.borderCard)),
    ),
    child: SingleChildScrollView(
      key: const Key('sci-story-tabs'),
      scrollDirection: Axis.horizontal,
      child: Row(
        children: <Widget>[
          for (int i = 0; i < labels.length; i++)
            Semantics(
              button: true,
              selected: i == selected,
              child: InkWell(
                key: ValueKey<String>(
                  'arena-subtab-${labels[i].split(' ').first}',
                ),
                onTap: () => onSelected(i),
                child: Container(
                  constraints: const BoxConstraints(minHeight: 44),
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    border: Border(
                      bottom: BorderSide(
                        width: 3,
                        color: i == selected
                            ? SciColors.primary
                            : Colors.transparent,
                      ),
                    ),
                  ),
                  child: Text(
                    labels[i],
                    style: TextStyle(
                      fontFamily: SciText.sans,
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: i == selected
                          ? SciColors.primaryText
                          : SciColors.inkSecondary,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    ),
  );
}
