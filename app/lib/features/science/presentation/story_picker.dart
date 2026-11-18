import 'dart:async';

import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/science/data/science_models.dart';
import 'package:dialektik/features/science/presentation/science_format.dart';
import 'package:dialektik/features/science/presentation/science_widgets.dart';
import 'package:flutter/material.dart';

/// Literal quotes of a story that a study comment can answer.
List<ClaimQuote> claimQuotesOf(EventDetailDto event) {
  final Map<String, EventCoverageArticleDto> articles =
      <String, EventCoverageArticleDto>{
        for (final EventCoverageArticleDto a in event.articles) a.id: a,
      };
  return <ClaimQuote>[
    for (final EventCoveragePositionDto position in event.coveragePositions)
      for (final EventCoverageAssertionDto a in position.assertions)
        if (a.quotedText.trim().isNotEmpty)
          ClaimQuote(
            id: a.id,
            text: a.quotedText.trim(),
            outlet: arenaSourceName(a.sourceName),
            publishedAt: articles[a.articleId]?.publishedAt,
          ),
  ];
}

/// «1 cita literal» / «3 citas literales».
String literalQuotesLabel(int n) =>
    n == 1 ? '1 cita literal' : '$n citas literales';

/// Lower case without accents, for the story search.
String foldForSearch(String text) {
  const String from = 'áàäâãéèëêíìïîóòöôõúùüûñç';
  const String to = 'aaaaaeeeeiiiiooooouuuunc';
  final StringBuffer out = StringBuffer();
  for (final int rune in text.toLowerCase().runes) {
    final String c = String.fromCharCode(rune);
    final int i = from.indexOf(c);
    out.write(i < 0 ? c : to[i]);
  }
  return out.toString();
}

/// The news topic closest to a study's topic, for suggestions only.
ArenaTopic? newsTopicOf(StudyTopic? topic) => switch (topic) {
  StudyTopic.environment => ArenaTopic.medioambiente,
  StudyTopic.society => ArenaTopic.sociedad,
  null || StudyTopic.all || StudyTopic.chile => null,
  _ => ArenaTopic.ciencia,
};

/// Every story the app has loaded, once.
List<EventCardDto> pickableStories(ArenaStore store) {
  final Set<String> seen = <String>{};
  return <EventCardDto>[
    for (final EventCardDto e in <EventCardDto>[
      ...store.events,
      for (final ArenaDuel d in store.duels) d.event,
    ])
      if (seen.add(e.id)) e,
  ];
}

/// Without a query: same topic as the study first, then the most recent.
/// With one: every word must appear in the title.
List<EventCardDto> storySuggestions(
  List<EventCardDto> stories, {
  StudyTopic? topic,
  String query = '',
  int limit = 8,
}) {
  final List<String> words = foldForSearch(
    query,
  ).split(RegExp(r'\s+')).where((String w) => w.isNotEmpty).toList();
  final ArenaTopic? near = newsTopicOf(topic);
  final List<EventCardDto> matches = <EventCardDto>[
    for (final EventCardDto e in stories)
      if (words.every(foldForSearch(e.arenaTitle).contains)) e,
  ];
  int rank(EventCardDto e) =>
      words.isEmpty && near != null && arenaTopicOfEvent(e) == near ? 0 : 1;
  matches.sort((EventCardDto a, EventCardDto b) {
    final int byTopic = rank(a).compareTo(rank(b));
    return byTopic != 0 ? byTopic : b.detectedAt.compareTo(a.detectedAt);
  });
  return matches.take(words.isEmpty ? limit : 20).toList();
}

/// C2 step 1: search a story, with suggestions. A story without literal
/// quotes cannot be connected and says so.
Future<EventCardDto?> showStoryPicker(
  BuildContext context,
  ArenaStore store, {
  StudyTopic? topic,
}) => showModalBottomSheet<EventCardDto>(
  context: context,
  isScrollControlled: true,
  backgroundColor: SciColors.surface,
  barrierColor: SciColors.scrim,
  shape: const RoundedRectangleBorder(
    borderRadius: BorderRadius.vertical(top: Radius.circular(SciRadius.sheet)),
  ),
  builder: (_) => FractionallySizedBox(
    heightFactor: 0.9,
    child: _StoryPicker(store: store, topic: topic),
  ),
);

class _StoryPicker extends StatefulWidget {
  const _StoryPicker({required this.store, this.topic});

  final ArenaStore store;
  final StudyTopic? topic;

  @override
  State<_StoryPicker> createState() => _StoryPickerState();
}

class _StoryPickerState extends State<_StoryPicker> {
  final TextEditingController _query = TextEditingController();

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final String query = _query.text.trim();
    final List<EventCardDto> stories = storySuggestions(
      pickableStories(widget.store),
      topic: widget.topic,
      query: query,
    );
    return SafeArea(
      child: Column(
        key: const Key('sci-story-picker'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const SizedBox(height: 8),
          const SheetHandle(),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
            child: TextField(
              key: const Key('sci-story-search'),
              controller: _query,
              autofocus: false,
              textInputAction: TextInputAction.search,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: 'Buscar noticia',
                prefixIcon: const Icon(SciIcons.search),
                isDense: true,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(SciRadius.rowButton),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(SciRadius.rowButton),
                  borderSide: const BorderSide(color: SciColors.borderControl),
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 4),
            child: Text(
              query.isEmpty ? 'Sugerencias' : 'Resultados',
              style: SciText.cardTitle,
            ),
          ),
          Expanded(
            child: stories.isEmpty
                ? const Padding(
                    padding: EdgeInsets.all(20),
                    child: Text(
                      'Ninguna noticia reciente coincide con tu búsqueda.',
                      key: Key('sci-story-none'),
                      style: SciText.body,
                    ),
                  )
                : ListView.separated(
                    key: const Key('sci-story-list'),
                    padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
                    itemCount: stories.length,
                    separatorBuilder: (_, _) => const Divider(
                      height: 1,
                      thickness: 1,
                      color: SciColors.divider,
                    ),
                    itemBuilder: (BuildContext context, int i) =>
                        _StoryRow(story: stories[i], store: widget.store),
                  ),
          ),
        ],
      ),
    );
  }
}

class _StoryRow extends StatefulWidget {
  const _StoryRow({required this.story, required this.store});

  final EventCardDto story;
  final ArenaStore store;

  @override
  State<_StoryRow> createState() => _StoryRowState();
}

class _StoryRowState extends State<_StoryRow> {
  late final Future<int> _quotes = widget.store
      .detail(widget.story.id)
      .then((EventDetailDto d) => claimQuotesOf(d).length);

  @override
  Widget build(BuildContext context) => FutureBuilder<int>(
    future: _quotes,
    builder: (BuildContext context, AsyncSnapshot<int> snapshot) {
      final int? quotes = snapshot.data;
      final bool failed = snapshot.hasError;
      final bool enabled = quotes != null && quotes > 0;
      final String meta = <String>[
        arenaTopicOfEvent(widget.story).label,
        sciShortDate(widget.story.detectedAt),
        if (failed)
          'No se pudieron contar sus citas'
        else if (quotes == null)
          'Contando citas…'
        else if (quotes == 0)
          'Sin citas para conectar'
        else
          literalQuotesLabel(quotes),
      ].join(' · ');
      return Semantics(
        button: true,
        enabled: enabled,
        child: InkWell(
          key: ValueKey<String>('sci-story-${widget.story.id}'),
          onTap: enabled ? () => Navigator.of(context).pop(widget.story) : null,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 56),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    widget.story.arenaTitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: SciText.body.copyWith(
                      fontWeight: FontWeight.w600,
                      color: enabled ? SciColors.ink : SciColors.inkSecondary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(meta, style: SciText.meta),
                ],
              ),
            ),
          ),
        ),
      );
    },
  );
}
