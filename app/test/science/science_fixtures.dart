import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/science/data/science_models.dart';
import 'package:dialektik/features/science/data/science_repository.dart';
import 'package:dialektik/features/science/presentation/study_comment_sheet.dart';

import '../arena/arena_fixtures.dart';
import '../support/public_api_fixtures.dart';

/// Three real DOIs. Only bibliographic facts are filled in; everything a
/// moderator has not completed stays null and reads «No informado».
///
/// Hviid et al., Ann Intern Med 2019 — nationwide Danish cohort.
final Study hviid = Study(
  doi: '10.7326/M18-2101',
  title:
      'Measles, Mumps, Rubella Vaccination and Autism: A Nationwide Cohort '
      'Study',
  review: StudyReview.peerReviewed,
  authors: 'Hviid A, Hansen JV, Frisch M, Melbye M',
  institution: 'Statens Serum Institut',
  journal: 'Annals of Internal Medicine',
  publishedAt: DateTime.utc(2019, 3, 5),
  design: 'Cohorte',
  population: 'Humanos (niños)',
  sampleSize: 657461,
  abstractText:
      'The study strongly supports that MMR vaccination does not increase '
      'the risk for autism, does not trigger autism in susceptible children, '
      'and is not associated with clustering of autism cases after '
      'vaccination.',
  abstractLanguage: 'en',
  connectedStories: 1,
  citingComments: 1,
);

/// Bendavid et al., medRxiv 2020 — preprint.
final Study bendavid = Study(
  doi: '10.1101/2020.04.14.20062463',
  title: 'COVID-19 Antibody Seroprevalence in Santa Clara County, California',
  review: StudyReview.preprint,
  authors: 'Bendavid E, et al.',
  institution: 'Stanford University',
  journal: 'medRxiv',
  publishedAt: DateTime.utc(2020, 4, 17),
  design: 'Transversal',
  population: 'Humanos (adultos y niños)',
  sampleSize: 3330,
  abstractText:
      'The unadjusted prevalence of antibodies to SARS-CoV-2 in Santa Clara '
      'County was 1.5% (exact binomial 95CI 1.11-1.97%).',
  abstractLanguage: 'en',
);

/// Wakefield et al., The Lancet 1998 — retracted in 2010.
final Study wakefield = Study(
  doi: '10.1016/S0140-6736(97)11096-0',
  title:
      'Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and '
      'pervasive developmental disorder in children',
  review: StudyReview.peerReviewed,
  authors: 'Wakefield AJ, et al.',
  journal: 'The Lancet',
  publishedAt: DateTime.utc(1998, 2, 28),
  design: 'Serie de casos',
  sampleSize: 12,
  retractedAt: DateTime.utc(2010, 2, 2),
);

const String vaccineEventId = '01K4W4M7R0B000000000000050';
const String vaccineTitle = 'Debate por el calendario de vacunación escolar';
const String vaccineClaimId = 'asv1';
const String calendarClaimId = 'asv2';

final EventDetailDto vaccineEvent = EventDetailDto.fromJson(<String, Object?>{
  ...eventDetailJson(
    id: vaccineEventId,
    title: vaccineTitle,
    analysisState: 'PUBLISHED',
    positionCount: 2,
    withPrimaryFact: false,
  ),
  'category': 'salud',
  'source_count': 3,
  'positions': <Object?>[
    <String, Object?>{
      'id': 'pv1',
      'title': 'Dudas sobre las vacunas',
      'assertions': <Object?>[
        _assertion(
          vaccineClaimId,
          'Las vacunas provocan autismo',
          'artv1',
          t13,
        ),
      ],
    },
    <String, Object?>{
      'id': 'pv2',
      'title': 'El calendario sigue igual',
      'assertions': <Object?>[
        _assertion(
          calendarClaimId,
          'El calendario de vacunación se mantiene sin cambios',
          'artv2',
          tercera,
        ),
      ],
    },
  ],
  'articles': <Object?>[
    _article('artv1', 'Debate en televisión por las vacunas', t13),
    _article('artv2', 'Minsal: el calendario escolar no cambia', tercera),
    _article('artv3', 'Colegios recuerdan la vacunación escolar', biobio),
  ],
});

Map<String, Object?> _article(String id, String title, LiveSourceDto source) =>
    <String, Object?>{
      'id': id,
      'title': title,
      'source_name': source.name,
      'source_id': source.id,
      'published_at': '2026-11-14T12:00:00.000Z',
      'url': 'https://${source.canonicalDomain}/nota/$id',
    };

Map<String, Object?> _assertion(
  String id,
  String quote,
  String articleId,
  LiveSourceDto source,
) => <String, Object?>{
  'id': id,
  'assertion_text': 'Según ${source.name}: $quote',
  'quoted_text': quote,
  'article_id': articleId,
  'source_name': source.name,
  'source_id': source.id,
};

ClaimQuote get vaccineClaim => const ClaimQuote(
  id: vaccineClaimId,
  text: 'Las vacunas provocan autismo',
  outlet: 'T13',
);

/// A thread like the C3 mockup, relative to [now].
List<StoryComment> sampleThread(DateTime now) => <StoryComment>[
  StoryComment(
    id: 'c1',
    author: 'camila_r',
    body:
        'Mi hijo tiene las vacunas al día y el pediatra nos explicó todo el '
        'calendario. Me preocupa que esto se discuta sin datos.',
    createdAt: now.subtract(const Duration(hours: 2)),
    reactions: 12,
  ),
  StoryComment(
    id: 'c2',
    author: 'lectora_vina',
    body:
        'Esto ya se estudió con una cohorte nacional enorme. Según el '
        'estudio, lo contradice. Se los dejo para que lo lean.',
    createdAt: now.subtract(const Duration(hours: 1)),
    reactions: 28,
    attachment: StudyAttachmentData(
      study: hviid,
      claim: vaccineClaim,
      relation: StudyRelation.contradicts,
      abstractFragment: 'MMR vaccination does not increase the risk for autism',
    ),
  ),
  StoryComment(
    id: 'c3',
    author: 'jpablo',
    parentId: 'c2',
    body: '¿Hay estudios hechos en Chile sobre esto?',
    createdAt: now.subtract(const Duration(minutes: 40)),
  ),
];

/// In-memory Core for the Science mode, enforcing the same rules as the
/// server: retracted studies and duplicates are refused, fragments must be
/// literal, study comments enter review.
class FakeScienceRepository
    implements ScienceRepository, ScienceModerationRepository {
  FakeScienceRepository({
    List<Study>? studies,
    Map<String, List<StoryComment>>? comments,
    this.failStudies = false,
    this.scienceAccess = const ScienceAccess(enabled: true),
  }) : studies = studies ?? <Study>[hviid, bendavid, wakefield],
       comments = comments ?? <String, List<StoryComment>>{};

  final List<Study> studies;
  final Map<String, List<StoryComment>> comments;
  bool failStudies;

  /// The remote flag; on by default so the Science tests see the mode.
  ScienceAccess scienceAccess;
  int _next = 100;
  final List<String> studyCalls = <String>[];

  @override
  Future<List<Study>> listStudies(StudyFilter filter) async {
    if (failStudies) throw StateError('requires API');
    return switch (filter) {
      StudyFilter.connected =>
        studies.where((Study s) => s.connectedStories > 0).toList(),
      StudyFilter.chile => studies.where((Study s) => s.madeInChile).toList(),
      _ => studies,
    };
  }

  @override
  Future<Study> study(String doi) async =>
      studies.firstWhere((Study s) => s.doi.toLowerCase() == doi.toLowerCase());

  @override
  Future<List<StoryComment>> storyComments(String eventId) async =>
      List<StoryComment>.of(comments[eventId] ?? const <StoryComment>[]);

  @override
  Future<StoryComment> addComment(
    String eventId, {
    required String body,
    String? parentId,
  }) async {
    final StoryComment created = StoryComment(
      id: 'n${_next++}',
      author: 'Lector-AB12',
      body: body,
      createdAt: DateTime.now(),
      parentId: parentId,
      mine: true,
    );
    (comments[eventId] ??= <StoryComment>[]).add(created);
    return created;
  }

  @override
  Future<StoryComment> addStudyComment(
    String eventId, {
    required String doi,
    required String claimQuoteId,
    required StudyRelation relation,
    required String abstractFragment,
    required String body,
  }) async {
    studyCalls.add(doi);
    final Study s = await study(doi);
    if (s.retracted) throw const StudyCommentRejected('retracted');
    for (final StoryComment c in comments[eventId] ?? const <StoryComment>[]) {
      if (c.attachment?.study.doi == doi &&
          c.attachment?.claim.id == claimQuoteId) {
        // Like Core: only a published comment is pointed to.
        throw c.status == CommentStatus.published
            ? StudyCommentRejected('duplicate', existingCommentId: c.id)
            : const StudyCommentRejected('duplicate_in_review');
      }
    }
    if (!isLiteralFragment(abstractFragment, s.abstractText ?? '')) {
      throw const StudyCommentRejected('not_literal');
    }
    final StoryComment created = StoryComment(
      id: 's${_next++}',
      author: 'Lector-AB12',
      body: body,
      createdAt: DateTime.now(),
      status: CommentStatus.inReview,
      mine: true,
      attachment: StudyAttachmentData(
        study: s,
        claim: claimQuotesOf(vaccineEvent).firstWhere(
          (ClaimQuote q) => q.id == claimQuoteId,
          orElse: () => ClaimQuote(id: claimQuoteId, text: '', outlet: ''),
        ),
        relation: relation,
        abstractFragment: abstractFragment,
      ),
    );
    (comments[eventId] ??= <StoryComment>[]).add(created);
    return created;
  }

  @override
  Future<StoryComment> react(String commentId, {required bool reacted}) async {
    for (final List<StoryComment> list in comments.values) {
      for (int i = 0; i < list.length; i++) {
        if (list[i].id == commentId) {
          final StoryComment c = list[i];
          if (c.reacted == reacted) return c;
          list[i] = c.copyWith(
            reacted: reacted,
            reactions: c.reactions + (reacted ? 1 : -1),
          );
          return list[i];
        }
      }
    }
    throw StateError('unknown comment');
  }

  @override
  Future<ScienceAccess> access() async => scienceAccess;

  /// Reports filed, by comment id.
  final Map<String, List<CommentReport>> reports =
      <String, List<CommentReport>>{};

  /// Decisions taken: «approve», «reject:reason», «hide:reason», «dismiss».
  final Map<String, String> decisions = <String, String>{};

  List<ApiUsageDay> usageDays = <ApiUsageDay>[];

  @override
  Future<void> report(
    String commentId,
    ReportReason reason, {
    String? note,
  }) async {
    (reports[commentId] ??= <CommentReport>[]).add(
      CommentReport(reason: reason, note: note, createdAt: DateTime.now()),
    );
  }

  StoryComment? _find(String id) {
    for (final List<StoryComment> list in comments.values) {
      for (final StoryComment c in list) {
        if (c.id == id) return c;
      }
    }
    return null;
  }

  String _eventOf(String id) => comments.entries
      .firstWhere(
        (MapEntry<String, List<StoryComment>> e) =>
            e.value.any((StoryComment c) => c.id == id),
      )
      .key;

  @override
  Future<ModerationQueue> moderationQueue() async => ModerationQueue(
    review: <ModerationItem>[
      for (final MapEntry<String, List<StoryComment>> e in comments.entries)
        for (final StoryComment c in e.value)
          if (c.status == CommentStatus.inReview &&
              !decisions.containsKey(c.id))
            ModerationItem(comment: c, eventId: e.key),
    ],
    reports: <ModerationItem>[
      for (final MapEntry<String, List<CommentReport>> r in reports.entries)
        if (!decisions.containsKey(r.key) && _find(r.key) != null)
          ModerationItem(
            comment: _find(r.key)!,
            eventId: _eventOf(r.key),
            reports: r.value,
          ),
    ],
  );

  @override
  Future<void> decide(
    String commentId, {
    required bool approve,
    String? reason,
  }) async {
    decisions[commentId] = approve ? 'approve' : 'reject:$reason';
  }

  @override
  Future<void> resolveReports(
    String commentId, {
    required bool hide,
    String? reason,
  }) async {
    decisions[commentId] = hide ? 'hide:$reason' : 'dismiss';
  }

  @override
  Future<Study> moderateStudy(String doi, StudyModeration fields) async {
    final int i = studies.indexWhere((Study s) => s.doi == doi);
    final Study updated = studies[i].moderated(fields.fields);
    studies[i] = updated;
    return updated;
  }

  @override
  Future<List<ApiUsageDay>> usage() async => usageDays;

  @override
  Future<List<StoryComment>> commentsCitingStudy(String doi) async =>
      <StoryComment>[
        for (final List<StoryComment> list in comments.values)
          ...list.where((StoryComment c) => c.attachment?.study.doi == doi),
      ];
}

/// The Arena fake Core plus the Science routes and the vaccination story.
class ArenaScienceCore extends ArenaFullCore
    implements ScienceRepository, ScienceModerationRepository {
  ArenaScienceCore({FakeScienceRepository? science})
    : science = science ?? FakeScienceRepository();

  final FakeScienceRepository science;

  @override
  Future<PublicPage<EventCardDto>> listFeed({
    String? category,
    String? topic,
    String? cursor,
    int limit = 20,
    bool refresh = false,
    dynamic requestToken,
  }) async => PublicPage<EventCardDto>(
    items: <EventCardDto>[vaccineEvent, storyEvent, duelEvent],
    nextCursor: null,
  );

  @override
  Future<EventDetailDto> getEvent(
    String eventId, {
    bool refresh = false,
    dynamic requestToken,
  }) async => eventId == vaccineEventId
      ? vaccineEvent
      : super.getEvent(eventId, refresh: refresh);

  @override
  Future<List<Study>> listStudies(StudyFilter filter) =>
      science.listStudies(filter);
  @override
  Future<Study> study(String doi) => science.study(doi);
  @override
  Future<List<StoryComment>> storyComments(String eventId) =>
      science.storyComments(eventId);
  @override
  Future<StoryComment> addComment(
    String eventId, {
    required String body,
    String? parentId,
  }) => science.addComment(eventId, body: body, parentId: parentId);
  @override
  Future<StoryComment> addStudyComment(
    String eventId, {
    required String doi,
    required String claimQuoteId,
    required StudyRelation relation,
    required String abstractFragment,
    required String body,
  }) => science.addStudyComment(
    eventId,
    doi: doi,
    claimQuoteId: claimQuoteId,
    relation: relation,
    abstractFragment: abstractFragment,
    body: body,
  );
  @override
  Future<StoryComment> react(String commentId, {required bool reacted}) =>
      science.react(commentId, reacted: reacted);
  @override
  Future<List<StoryComment>> commentsCitingStudy(String doi) =>
      science.commentsCitingStudy(doi);
  @override
  Future<ScienceAccess> access() => science.access();
  @override
  Future<void> report(String commentId, ReportReason reason, {String? note}) =>
      science.report(commentId, reason, note: note);
  @override
  Future<ModerationQueue> moderationQueue() => science.moderationQueue();
  @override
  Future<void> decide(
    String commentId, {
    required bool approve,
    String? reason,
  }) => science.decide(commentId, approve: approve, reason: reason);
  @override
  Future<void> resolveReports(
    String commentId, {
    required bool hide,
    String? reason,
  }) => science.resolveReports(commentId, hide: hide, reason: reason);
  @override
  Future<Study> moderateStudy(String doi, StudyModeration fields) =>
      science.moderateStudy(doi, fields);
  @override
  Future<List<ApiUsageDay>> usage() => science.usage();
}
