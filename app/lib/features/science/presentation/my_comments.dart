import 'dart:async';

import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/presentation/arena_navigation.dart';
import 'package:dialektik/features/arena/presentation/arena_widgets.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/science/data/science_models.dart';
import 'package:dialektik/features/science/presentation/science_widgets.dart';
import 'package:flutter/material.dart';

/// The label of each state a reader's comment can be in.
String myCommentStatusLabel(CommentStatus status) => switch (status) {
  CommentStatus.published => 'Publicado',
  CommentStatus.inReview => 'En revisión',
  CommentStatus.hidden => 'Oculto',
};

/// «Tus comentarios» in Perfil while Science is on: each comment, its story
/// and its state. Hidden ones are seen only here, by their author.
class MyCommentsSection extends StatefulWidget {
  const MyCommentsSection({required this.store, super.key});

  final ArenaStore store;

  @override
  State<MyCommentsSection> createState() => _MyCommentsSectionState();
}

class _MyCommentsSectionState extends State<MyCommentsSection> {
  List<MyComment>? _comments;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final science = widget.store.science;
    if (science == null) return;
    try {
      final List<MyComment> comments = await science.myComments();
      if (mounted) setState(() => _comments = comments);
    } on Object {
      if (mounted) setState(() => _failed = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final List<MyComment>? comments = _comments;
    return Column(
      key: const Key('sci-my-comments'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        ArenaSectionTitle(
          comments == null
              ? 'Tus comentarios'
              : 'Tus comentarios · ${comments.length}',
        ),
        if (_failed)
          const Text(
            'No se pudieron cargar tus comentarios.',
            style: ArenaText.body,
          )
        else if (comments == null)
          const SizedBox.shrink()
        else if (comments.isEmpty)
          const Text(
            'Cuando comentes un acontecimiento en modo Ciencia, tu '
            'comentario y su estado aparecerán aquí.',
            style: ArenaText.body,
          )
        else
          for (final MyComment item in comments)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: ArenaCard(
                key: Key('sci-my-comment-${item.comment.id}'),
                onTap: item.eventId.isEmpty
                    ? null
                    : () => unawaited(
                        openArenaEvent(context, widget.store, item.eventId),
                      ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      item.eventTitle ?? 'Acontecimiento',
                      style: ArenaText.cardTitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      item.comment.body,
                      style: ArenaText.body,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 8),
                    StudyTag(
                      myCommentStatusLabel(item.comment.status),
                      key: Key('sci-my-comment-status-${item.comment.id}'),
                    ),
                  ],
                ),
              ),
            ),
      ],
    );
  }
}
