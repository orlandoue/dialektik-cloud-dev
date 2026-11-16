/// Studies, story comments and their attachments, as Core serves them.
///
/// Core resolves a DOI through Crossref and OpenAlex (cached, with the
/// retraction status) and a moderator completes design, population, sample,
/// follow-up and conflicts. Until then those fields are null and the app reads
/// them as «No informado». The app never calls Crossref or OpenAlex itself.
library;

/// Peer review status of a study.
enum StudyReview { peerReviewed, preprint }

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
    this.madeInChile = false,
    this.connectedStories = 0,
    this.citingComments = 0,
  });

  factory Study.fromJson(Map<String, dynamic> json) => Study(
    doi: json['doi'] as String,
    title: json['title'] as String,
    review: json['review'] == 'preprint'
        ? StudyReview.preprint
        : StudyReview.peerReviewed,
    authors: json['authors'] as String?,
    institution: json['institution'] as String?,
    journal: json['journal'] as String?,
    publishedAt: DateTime.tryParse(json['published_at'] as String? ?? ''),
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
  final bool madeInChile;
  final int connectedStories;
  final int citingComments;

  bool get retracted => retractedFlag || retractedAt != null;
  Uri get doiUrl => Uri.parse('https://doi.org/$doi');
  String get reviewLabel =>
      review == StudyReview.preprint ? 'Preprint' : 'Revisado por pares';
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

  StoryComment copyWith({int? reactions, bool? reacted}) => StoryComment(
    id: id,
    author: author,
    body: body,
    createdAt: createdAt,
    parentId: parentId,
    status: status,
    attachment: attachment,
    reactions: reactions ?? this.reactions,
    reacted: reacted ?? this.reacted,
    mine: mine,
  );
}

/// Why publishing a study comment was refused.
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
