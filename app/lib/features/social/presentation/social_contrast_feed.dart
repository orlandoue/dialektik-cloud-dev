import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/social/presentation/social_contrast_post.dart';
import 'package:flutter/material.dart';

/// A short selection of actual published contrasts for the news feed.
class SocialContrastFeed extends StatefulWidget {
  const SocialContrastFeed({
    required this.repository,
    required this.sourcesRepository,
    required this.onOpenEvent,
    this.contrastsFuture,
    super.key,
  });
  final ConsumerRepository repository;
  final LiveNewsRepository sourcesRepository;
  final ValueChanged<String> onOpenEvent;
  final Future<PublicPage<ContradictionDto>>? contrastsFuture;
  @override
  State<SocialContrastFeed> createState() => _SocialContrastFeedState();
}

class _SocialContrastFeedState extends State<SocialContrastFeed> {
  late Future<List<(ContradictionDto, EventDetailDto)>> items = _load();
  Future<List<(ContradictionDto, EventDetailDto)>> _load() async {
    final page =
        await (widget.contrastsFuture ??
            widget.repository.listContradictions(limit: 3));
    final found = await Future.wait(
      page.items.take(3).map((item) async {
        try {
          return (item, await widget.repository.getEvent(item.eventId));
        } on Exception {
          return null;
        }
      }),
    );
    return found.whereType<(ContradictionDto, EventDetailDto)>().toList();
  }

  @override
  Widget build(BuildContext context) =>
      FutureBuilder<List<(ContradictionDto, EventDetailDto)>>(
        future: items,
        builder: (context, snapshot) {
          final found =
              snapshot.data ?? const <(ContradictionDto, EventDetailDto)>[];
          return Column(
            children: [
              for (final entry in found)
                SocialContrastPost(
                  event: entry.$2,
                  title: entry.$1.eventTitle,
                  positions: entry.$2.coveragePositions
                      .where(
                        (p) =>
                            p.id == entry.$1.positionA.id ||
                            p.id == entry.$1.positionB.id,
                      )
                      .toList(),
                  onOpenEvent: () => widget.onOpenEvent(entry.$1.eventId),
                  sourcesRepository: widget.sourcesRepository,
                ),
            ],
          );
        },
      );
}
