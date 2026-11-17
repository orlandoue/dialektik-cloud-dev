/// Studies, story comments and their attachments, as Core serves them.
///
/// Core resolves a DOI through Crossref and OpenAlex (cached, with the
/// retraction status) and a moderator completes design, population, sample,
/// follow-up and conflicts. Until then those fields are null and the app reads
/// them as «No informado». The app never calls Crossref or OpenAlex itself.
library;

/// Peer review status of a study.
/// Peer review as the source states it. A repository (Zenodo, OSF…) or a
/// source that says nothing is «No informado», never assumed.
enum StudyReview { peerReviewed, preprint, notReported }

/// How much of the publication date the source gives.
enum DatePrecision { day, month, year }

/// What a commenter says a study does to a claim. Always the author's opinion.
enum StudyRelation {
  supports('respalda', 'Respalda', 'lo respalda'),
  contradicts('contradice', 'Contradice', 'lo contradice'),
  qualifies('matiza', 'Matiza', 'lo matiza'),
  context('contexto', 'Contexto', 'da contexto');

  const StudyRelation(this.wire, this.label, this.inSentence);
  final String wire;
  final String label;

  /// How the relation reads inside the author's own sentence.
  final String inSentence;

  static StudyRelation? parse(String? value) => StudyRelation.values
      .where((StudyRelation r) => r.wire == value)
      .firstOrNull;
}

/// Feed filters of the Science mode.
enum StudyFilter {
  connected('conectados', 'Conectados a noticias'),
  chile('chile', 'Hecha en Chile'),
  topics('temas', 'Temas en la app'),
  recent('recientes', 'Recientes');

  const StudyFilter(this.wire, this.label);
  final String wire;
  final String label;
}

/// «No informado» stands for every value Core has not verified.
const String notInformed = 'No informado';

final class Study {
  const Study({
    required this.doi,
    required this.title,
    required this.review,
    this.authors,
    this.institution,
    this.journal,
    this.publishedAt,
    this.publishedPrecision = DatePrecision.day,
    this.design,
    this.population,
    this.sampleSize,
    this.followUp,
    this.funding,
    this.conflicts,
    this.access,
    this.corrections,
    this.retractedAt,
    this.retractedFlag = false,
    this.abstractText,
    this.abstractLanguage,
    this.abstractSource,
    this.madeInChile = false,
    this.connectedStories = 0,
    this.citingComments = 0,
  });

  factory Study.fromJson(Map<String, dynamic> json) => Study(
    doi: json['doi'] as String,
    title: json['title'] as String,
    review: switch (json['review']) {
      'peer_reviewed' => StudyReview.peerReviewed,
      'preprint' => StudyReview.preprint,
      _ => StudyReview.notReported,
    },
    authors: json['authors'] as String?,
    institution: json['institution'] as String?,
    journal: json['journal'] as String?,
    publishedAt: DateTime.tryParse(json['published_at'] as String? ?? ''),
    publishedPrecision: switch (json['published_precision']) {
      'year' => DatePrecision.year,
      'month' => DatePrecision.month,
      _ => DatePrecision.day,
    },
    design: json['design'] as String?,
    population: json['population'] as String?,
    sampleSize: json['sample_size'] as int?,
    followUp: json['follow_up'] as String?,
    funding: json['funding'] as String?,
    conflicts: json['conflicts'] as String?,
    access: json['access'] as String?,
    corrections: json['corrections'] as String?,
    retractedAt: DateTime.tryParse(json['retracted_at'] as String? ?? ''),
    retractedFlag: json['retracted'] as bool? ?? false,
    abstractText: json['abstract'] as String?,
    abstractLanguage: json['abstract_language'] as String?,
    abstractSource: json['abstract_source'] as String?,
    madeInChile: json['made_in_chile'] as bool? ?? false,
    connectedStories: json['connected_stories'] as int? ?? 0,
    citingComments: json['citing_comments'] as int? ?? 0,
  );

  static List<Study> listFromJson(Object? value) => <Study>[
    for (final Object? item
        in ((value! as Map<String, dynamic>)['studies'] as List<dynamic>?) ??
            const <dynamic>[])
      Study.fromJson(item! as Map<String, dynamic>),
  ];

  final String doi;
  final String title;
  final StudyReview review;
  final String? authors;
  final String? institution;
  final String? journal;
  final DateTime? publishedAt;

  /// Only the year (or year and month) when the source gives no more.
  final DatePrecision publishedPrecision;

  /// Moderator-completed; null until reviewed.
  final String? design;
  final String? population;
  final int? sampleSize;
  final String? followUp;
  final String? funding;
  final String? conflicts;
  final String? access;
  final String? corrections;

  /// Set when the journal retracted the article (from Crossref).
  final DateTime? retractedAt;

  /// Retracted even when the notice gives no date (OpenAlex flag).
  final bool retractedFlag;
  final String? abstractText;

  /// BCP-47 code of the abstract, e.g. `en`.
  final String? abstractLanguage;

  /// Where the abstract came from: Crossref, OpenAlex, or the publisher a
  /// moderator copied it from. Never a generated summary.
  final String? abstractSource;

  bool get hasAbstract => abstractText?.trim().isNotEmpty ?? false;

  /// The same study with the fields a moderator completed.
  Study moderated(Map<String, Object?> f) {
    T? pick<T>(String key, T? current) =>
        f.containsKey(key) ? f[key] as T? : current;
    final bool sets = f.containsKey('abstract');
    final Map<String, Object?> given =
        (f['abstract'] as Map<String, Object?>?) ?? const <String, Object?>{};
    return Study(
      doi: doi,
      title: title,
      review: review,
      authors: authors,
      institution: institution,
      journal: journal,
      publishedAt: publishedAt,
      publishedPrecision: publishedPrecision,
      design: pick<String>('design', design),
      population: pick<String>('population', population),
      sampleSize: pick<int>('sample_size', sampleSize),
      followUp: pick<String>('follow_up', followUp),
      funding: pick<String>('funding', funding),
      conflicts: pick<String>('conflicts', conflicts),
      access: pick<String>('access', access),
      corrections: pick<String>('corrections', corrections),
      retractedAt: retractedAt,
      retractedFlag: retractedFlag,
      abstractText: sets ? given['text'] as String? : abstractText,
      abstractLanguage: sets ? given['language'] as String? : abstractLanguage,
      abstractSource: sets ? given['source'] as String? : abstractSource,
      madeInChile: madeInChile,
      connectedStories: connectedStories,
      citingComments: citingComments,
    );
  }

  final bool madeInChile;
  final int connectedStories;
  final int citingComments;

  bool get retracted => retractedFlag || retractedAt != null;
  Uri get doiUrl => Uri.parse('https://doi.org/$doi');
  String get reviewLabel => switch (review) {
    StudyReview.peerReviewed => 'Revisado por pares',
    StudyReview.preprint => 'Preprint',
    StudyReview.notReported => 'Revisión no informada',
  };
}

/// The claim a study comment answers: a literal quote from the story.
final class ClaimQuote {
  const ClaimQuote({
    required this.id,
    required this.text,
    required this.outlet,
    this.speaker,
    this.publishedAt,
  });

  final String id;
  final String text;
  final String outlet;
  final String? speaker;
  final DateTime? publishedAt;
}

final class StudyAttachmentData {
  const StudyAttachmentData({
    required this.study,
    required this.claim,
    required this.relation,
    required this.abstractFragment,
  });

  final Study study;
  final ClaimQuote claim;
  final StudyRelation relation;
  final String abstractFragment;
}

enum CommentStatus { published, inReview }

final class StoryComment {
  const StoryComment({
    required this.id,
    required this.author,
    required this.body,
    required this.createdAt,
    this.parentId,
    this.status = CommentStatus.published,
    this.attachment,
    this.reactions = 0,
    this.reacted = false,
    this.mine = false,
  });

  factory StoryComment.fromJson(Map<String, dynamic> json) {
    final Object? attachment = json['attachment'];
    return StoryComment(
      id: json['id'] as String,
      author: json['author'] as String,
      body: json['body'] as String,
      createdAt:
          DateTime.tryParse(json['created_at'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0),
      parentId: json['parent_id'] as String?,
      status: json['status'] == 'in_review'
          ? CommentStatus.inReview
          : CommentStatus.published,
      reactions: json['reactions'] as int? ?? 0,
      reacted: json['reacted'] as bool? ?? false,
      mine: json['mine'] as bool? ?? false,
      attachment: attachment is Map<String, dynamic>
          ? StudyAttachmentData(
              study: Study.fromJson(
                attachment['study'] as Map<String, dynamic>,
              ),
              claim: ClaimQuote(
                id: attachment['claim_quote_id'] as String,
                text: attachment['claim_text'] as String,
                outlet: attachment['claim_outlet'] as String,
                speaker: attachment['claim_speaker'] as String?,
              ),
              relation:
                  StudyRelation.parse(attachment['relation'] as String?) ??
                  StudyRelation.context,
              abstractFragment: attachment['abstract_fragment'] as String,
            )
          : null,
    );
  }

  static List<StoryComment> listFromJson(Object? value) => <StoryComment>[
    for (final Object? item
        in ((value! as Map<String, dynamic>)['comments'] as List<dynamic>?) ??
            const <dynamic>[])
      StoryComment.fromJson(item! as Map<String, dynamic>),
  ];

  final String id;
  final String author;
  final String body;
  final DateTime createdAt;
  final String? parentId;
  final CommentStatus status;
  final StudyAttachmentData? attachment;

  /// «Útil» for a normal comment, «Pertinente» for one with a study.
  final int reactions;
  final bool reacted;
  final bool mine;

  bool get withStudy => attachment != null;

  StoryComment copyWith({
    int? reactions,
    bool? reacted,
    CommentStatus? status,
  }) => StoryComment(
    id: id,
    author: author,
    body: body,
    createdAt: createdAt,
    parentId: parentId,
    status: status ?? this.status,
    attachment: attachment,
    reactions: reactions ?? this.reactions,
    reacted: reacted ?? this.reacted,
    mine: mine,
  );
}

/// Why publishing a study comment was refused.
/// Remote flag for Science mode and story comments (`GET /v1/science/access`).
final class ScienceAccess {
  const ScienceAccess({this.enabled = false, this.moderator = false});

  factory ScienceAccess.fromJson(Object? value) {
    if (value is! Map<String, Object?>) return const ScienceAccess();
    return ScienceAccess(
      enabled: value['enabled'] == true,
      moderator: value['moderator'] == true,
    );
  }

  /// Hidden by default.
  static const ScienceAccess off = ScienceAccess();

  final bool enabled;
  final bool moderator;
}

final class StudyCommentRejected implements Exception {
  const StudyCommentRejected(this.reason, {this.existingCommentId});

  /// `retracted`, `duplicate`, `not_literal`, `account_too_new`.
  final String reason;
  final String? existingCommentId;
}

/// Literal check shared with Core: spaces and quotation marks normalised.
String normalizeLiteral(String text) => text
    .replaceAll(RegExp('[“”„«»"]'), '"')
    .replaceAll(RegExp('[‘’‚`´]'), "'")
    .replaceAll(RegExp(r'\s+'), ' ')
    .trim();

bool isLiteralFragment(String fragment, String abstractText) {
  final String needle = normalizeLiteral(fragment);
  return needle.isNotEmpty && normalizeLiteral(abstractText).contains(needle);
}

/// Why a reader reports a comment (`POST /v1/comments/{id}/reports`).
enum ReportReason {
  spam('spam', 'Spam o publicidad'),
  offensive('ofensivo', 'Insulto u ofensa'),
  misinformation('desinformacion', 'Desinformación'),
  personalData('datos_personales', 'Datos personales de alguien'),
  other('otro', 'Otro motivo');

  const ReportReason(this.wire, this.label);

  final String wire;
  final String label;

  static ReportReason? fromWire(Object? value) =>
      values.where((ReportReason r) => r.wire == value).firstOrNull;
}

/// One report of a comment, as the moderation queue shows it.
final class CommentReport {
  const CommentReport({required this.reason, this.note, this.createdAt});

  factory CommentReport.fromJson(Map<String, dynamic> json) => CommentReport(
    reason: ReportReason.fromWire(json['reason']) ?? ReportReason.other,
    note: json['note'] as String?,
    createdAt: DateTime.tryParse(json['created_at'] as String? ?? ''),
  );

  final ReportReason reason;
  final String? note;
  final DateTime? createdAt;
}

/// A comment waiting for a moderator: a study comment in review, or a
/// published comment with open reports.
final class ModerationItem {
  const ModerationItem({
    required this.comment,
    required this.eventId,
    this.reports = const <CommentReport>[],
  });

  factory ModerationItem.fromJson(Map<String, dynamic> json) => ModerationItem(
    comment: StoryComment.fromJson(json),
    eventId: json['event_id'] as String? ?? '',
    reports: <CommentReport>[
      for (final Object? r
          in (json['reports'] as List<dynamic>?) ?? const <dynamic>[])
        CommentReport.fromJson(r! as Map<String, dynamic>),
    ],
  );

  final StoryComment comment;
  final String eventId;
  final List<CommentReport> reports;
}

final class ModerationQueue {
  const ModerationQueue({
    this.review = const <ModerationItem>[],
    this.reports = const <ModerationItem>[],
  });

  factory ModerationQueue.fromJson(Object? value) {
    final Map<String, dynamic> json = value! as Map<String, dynamic>;
    List<ModerationItem> list(String key) => <ModerationItem>[
      for (final Object? item
          in (json[key] as List<dynamic>?) ?? const <dynamic>[])
        ModerationItem.fromJson(item! as Map<String, dynamic>),
    ];
    return ModerationQueue(review: list('review'), reports: list('reports'));
  }

  final List<ModerationItem> review;
  final List<ModerationItem> reports;

  bool get isEmpty => review.isEmpty && reports.isEmpty;
}

/// Calls to one metadata API on one day (`GET /v1/science/moderation/usage`).
final class ApiUsageDay {
  const ApiUsageDay({
    required this.source,
    required this.day,
    required this.calls,
    required this.errors,
  });

  factory ApiUsageDay.fromJson(Map<String, dynamic> json) => ApiUsageDay(
    source: json['source'] as String? ?? '',
    day: DateTime.tryParse(json['day'] as String? ?? '') ?? DateTime(1970),
    calls: (json['calls'] as num?)?.toInt() ?? 0,
    errors: (json['errors'] as num?)?.toInt() ?? 0,
  );

  static List<ApiUsageDay> listFromJson(Object? value) => <ApiUsageDay>[
    for (final Object? item
        in ((value! as Map<String, dynamic>)['days'] as List<dynamic>?) ??
            const <dynamic>[])
      ApiUsageDay.fromJson(item! as Map<String, dynamic>),
  ];

  final String source;
  final DateTime day;
  final int calls;
  final int errors;
}

/// The daily harvest as Core last saw it (`harvest` in the usage answer).
final class HarvestStatus {
  const HarvestStatus({
    this.lastRunAt,
    this.lastStatus,
    this.stale = true,
    this.added = 0,
    this.deleted = 0,
  });

  factory HarvestStatus.fromJson(Object? value) {
    if (value is! Map<String, dynamic>) return const HarvestStatus();
    return HarvestStatus(
      lastRunAt: DateTime.tryParse(value['last_run_at'] as String? ?? ''),
      lastStatus: value['last_status'] as String?,
      stale: value['stale'] != false,
      added: (value['added'] as num?)?.toInt() ?? 0,
      deleted: (value['deleted'] as num?)?.toInt() ?? 0,
    );
  }

  final DateTime? lastRunAt;

  /// ok, partial or failed.
  final String? lastStatus;

  /// No run finished in the last 48 hours.
  final bool stale;
  final int added;
  final int deleted;
}

/// Calls per metadata API and day, and the harvest state.
final class ApiUsage {
  const ApiUsage({
    this.days = const <ApiUsageDay>[],
    this.harvest = const HarvestStatus(),
  });

  factory ApiUsage.fromJson(Object? value) => ApiUsage(
    days: ApiUsageDay.listFromJson(value),
    harvest: HarvestStatus.fromJson(
      (value! as Map<String, dynamic>)['harvest'],
    ),
  );

  final List<ApiUsageDay> days;
  final HarvestStatus harvest;
}

/// Fields a moderator completes on a study. Only the keys present are sent;
/// a null value clears the field back to «No informado».
final class StudyModeration {
  const StudyModeration(this.fields);

  final Map<String, Object?> fields;
}

/// A possible match for what the reader wrote in C2 (DOI, link or title).
final class LookupCandidate {
  const LookupCandidate({
    required this.doi,
    required this.title,
    this.authors,
    this.journal,
    this.year,
    this.review = StudyReview.peerReviewed,
  });

  factory LookupCandidate.fromJson(Map<String, dynamic> json) =>
      LookupCandidate(
        doi: json['doi'] as String,
        title: json['title'] as String,
        authors: json['authors'] as String?,
        journal: json['journal'] as String?,
        year: (json['year'] as num?)?.toInt(),
        review: json['review'] == 'preprint'
            ? StudyReview.preprint
            : StudyReview.peerReviewed,
      );

  final String doi;
  final String title;
  final String? authors;
  final String? journal;
  final int? year;
  final StudyReview review;
}

/// Answer of `GET /v1/science/lookup`: up to three candidates, or why none.
final class LookupResult {
  const LookupResult({
    this.candidates = const <LookupCandidate>[],
    this.linkWithoutDoi = false,
  });

  factory LookupResult.fromJson(Object? value) {
    final Map<String, dynamic> json = value! as Map<String, dynamic>;
    return LookupResult(
      candidates: <LookupCandidate>[
        for (final Object? c
            in (json['candidates'] as List<dynamic>?) ?? const <dynamic>[])
          LookupCandidate.fromJson(c! as Map<String, dynamic>),
      ],
      linkWithoutDoi: json['reason'] == 'no_doi_in_link',
    );
  }

  final List<LookupCandidate> candidates;

  /// A link was written, but it carries no DOI; it is never downloaded.
  final bool linkWithoutDoi;
}
