import 'dart:async';
import 'dart:convert';

import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/curated_event_preview.dart';
import 'package:dialektik/features/consumer/data/following_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/live/data/chile_rss_chronology.dart';
import 'package:dialektik/features/live/data/chile_rss_linked_news.dart';
import 'package:dialektik/features/live/data/chile_rss_links.dart';
import 'package:dialektik/features/live/data/chile_seismic_observations.dart';
import 'package:dialektik/features/live/data/govuk_preview.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/live/data/publisher_market_selection.dart';
import 'package:dialektik/features/live/data/registered_source_directory.dart';
import 'package:dialektik/features/semantic/data/semantic_models.dart';
import 'package:dialektik/features/semantic/data/semantic_repository.dart';
import 'package:dialektik/features/semantic_shadow/data/ephemeral_semantic_models.dart';
import 'package:dialektik/features/semantic_shadow/data/ephemeral_semantic_repository.dart';
import 'package:dialektik/features/semantic_shadow/data/semantic_graph_models.dart';
import 'package:dialektik/features/semantic_shadow/data/semantic_graph_repository.dart';
import 'package:dialektik/features/semantic_shadow/data/semantic_shadow_models.dart';
import 'package:dialektik/features/semantic_shadow/data/semantic_shadow_repository.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

typedef JsonDecoder<T> = T Function(Object? value);
typedef AccessTokenProvider = Future<String?> Function();
typedef AuthorizationRejectedHandler = void Function();

/// Typed Phase-7 anonymous public read client.
final class PublicApiClient
    implements
        ConsumerRepository,
        FollowingRepository,
        SemanticRepository,
        LiveNewsRepository,
        ScopedLiveNewsRepository,
        MirrorNewsMemory,
        ChileRssChronologyRepository,
        ChileRssLinkedNewsRepository,
        ChileRssLinksRepository,
        SeismicObservationRepository,
        RegisteredSourceDirectoryRepository,
        SemanticShadowRepository,
        EphemeralSemanticRepository,
        SemanticGraphRepository {
  PublicApiClient({
    required ApiConfiguration configuration,
    http.Client? httpClient,
    this.timeout = const Duration(seconds: 40),
    this.authorizationTokenProvider,
    this.onAuthorizationRejected,
    this.maxAttempts = 1,
    this.retryDelay = const Duration(milliseconds: 500),
    this.publisherMarketSelection,
  }) : _configuration = configuration,
       _httpClient = httpClient ?? http.Client(),
       _ownsClient = httpClient == null {
    if (maxAttempts < 1 || maxAttempts > 3) {
      throw ArgumentError.value(
        maxAttempts,
        'maxAttempts',
        'must be from 1 to 3',
      );
    }
  }

  final ApiConfiguration _configuration;
  final http.Client _httpClient;
  final bool _ownsClient;
  final Duration timeout;
  final AccessTokenProvider? authorizationTokenProvider;
  final AuthorizationRejectedHandler? onAuthorizationRejected;
  final int maxAttempts;
  final Duration retryDelay;
  final PublisherMarketSelection? publisherMarketSelection;
  bool get _otherMarket =>
      publisherMarketSelection != null && publisherMarketSelection!.value != 'CL';
  String? get _marketQuery => publisherMarketSelection?.value;
  final ValueNotifier<int> _followingVersion = ValueNotifier<int>(0);
  @override
  Listenable get followingChanges => _followingVersion;
  bool get _personalizationEnabled => authorizationTokenProvider != null;
  @override
  bool get followingAvailable => _personalizationEnabled;
  LiveNewsPageDto? _cachedMirrorNews;
  Set<String>? _cachedFollowedSources;
  @override LiveNewsPageDto? get cachedMirrorNews => _cachedMirrorNews;
  @override Set<String>? get cachedFollowedSources => _cachedFollowedSources == null ? null : Set.of(_cachedFollowedSources!);
  @override Future<void> prefetchMirrorNews() async {
    if (!_personalizationEnabled || _otherMarket || _cachedMirrorNews != null) return;
    final version = _followingVersion.value;
    try {
      final page = await listScopedLiveNews(scope:'outside',refresh:true);
      if (version == _followingVersion.value) _cachedMirrorNews = page;
    } on Exception { /* A failed prefetch does not block the news feed. */ }
  }

  @override
  Future<Set<String>> listFollowedSources() async {
    final result = await _get<Set<String>>(
    '/v1/sources/following', decoder: (Object? value) {
      if (value is! Map<String, Object?> || value['source_ids'] is! List<Object?>) {
        throw const FormatException('Invalid followed sources.');
      }
      final ids = value['source_ids']! as List<Object?>;
      if (ids.any((id) => id is! String)) throw const FormatException('Invalid source ID.');
      return ids.cast<String>().toSet();
    }, refresh: true, requestToken: null,
    );
    _cachedFollowedSources = Set.of(result);
    return result;
  }

  @override
  Future<void> setFollowing(String sourceId, {required bool following}) async {
    final token = await authorizationTokenProvider?.call();
    if (token == null || token.isEmpty) throw const PublicApiFailure(kind: PublicFailureKind.unauthorized);
    final uri = _configuration.resolve('/v1/sources/${Uri.encodeComponent(sourceId)}/follow');
    final headers = <String,String>{'accept':'application/json','authorization':'Bearer $token'};
    late http.Response response;
    try {
      response = await (following ? _httpClient.post(uri, headers: headers) : _httpClient.delete(uri, headers: headers)).timeout(timeout);
    } on TimeoutException { throw const PublicApiFailure(kind: PublicFailureKind.network); }
      on http.ClientException { throw const PublicApiFailure(kind: PublicFailureKind.network); }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      if (response.statusCode == 401) onAuthorizationRejected?.call();
      throw _decodeFailure(response);
    }
    _cache.clear();
    _cachedMirrorNews = null;
    final cached = _cachedFollowedSources;
    if (cached != null) {
      _cachedFollowedSources = <String>{...cached};
      if (following) { _cachedFollowedSources!.add(sourceId); }
      else { _cachedFollowedSources!.remove(sourceId); }
    }
    _followingVersion.value += 1;
  }

  @override
  Future<BlindspotsResult> listBlindspots() => _get<BlindspotsResult>(
    '/v1/feed/blindspots', query: const {'limit':'20'}, decoder: (Object? value) {
      if (value is! Map<String,Object?> || value['items'] is! List<Object?> ||
          value['total'] is! int || value['followed_source_count'] is! int) {
        throw const FormatException('Invalid blindspots.');
      }
      return BlindspotsResult(
        items: (value['items']! as List<Object?>).map(EventCardDto.fromJson).toList(growable:false),
        total: value['total']! as int, followedSourceCount: value['followed_source_count']! as int,
      );
    }, refresh:true, requestToken:null,
  );

  final Map<String, _CacheEntry<Object>> _cache =
      <String, _CacheEntry<Object>>{};

  @override
  Future<PublicPage<EventCardDto>> listFeed({
    String? category,
    String? topic,
    String? cursor,
    int limit = 20,
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) {
    if (_otherMarket) {
      return Future<PublicPage<EventCardDto>>.value(
        const PublicPage<EventCardDto>(items: <EventCardDto>[], nextCursor: null),
      );
    }
    return _get<PublicPage<EventCardDto>>(
      '/v1/feed',
      query: <String, String>{
        if (_personalizationEnabled) 'personalized': '1',
        'category': ?category,
        'topic': ?topic,
        'cursor': ?cursor,
        'limit': '$limit',
      },
      decoder: (Object? value) => _page(value, EventCardDto.fromJson),
      refresh: refresh,
      requestToken: requestToken,
    );
  }

  @override
  Future<PublicPage<ContradictionDto>> listContradictions({
    String? cursor,
    int limit = 20,
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) {
    if (_otherMarket) {
      return Future<PublicPage<ContradictionDto>>.value(
        const PublicPage<ContradictionDto>(items: <ContradictionDto>[], nextCursor: null),
      );
    }
    return _get<PublicPage<ContradictionDto>>(
      '/v1/contradictions',
      query: <String, String>{if (_personalizationEnabled) 'personalized': '1', 'cursor': ?cursor, 'limit': '$limit'},
      decoder: (Object? value) => _page(value, ContradictionDto.fromJson),
      refresh: refresh,
      requestToken: requestToken,
    );
  }

  @override
  Future<EventDetailDto> getEvent(
    String eventId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get<EventDetailDto>(
    '/v1/events/${Uri.encodeComponent(eventId)}',
    query: {'include': 'coverage', if (_personalizationEnabled) 'personalized': '1'},
    decoder: EventDetailDto.fromJson,
    refresh: refresh,
    requestToken: requestToken,
  );

  @override
  Future<List<PositionListItemDto>> listEventPositions(
    String eventId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get<List<PositionListItemDto>>(
    '/v1/events/${Uri.encodeComponent(eventId)}/positions',
    decoder: (Object? value) => _list(value, PositionListItemDto.fromJson),
    refresh: refresh,
    requestToken: requestToken,
  );

  @override
  Future<List<PublicAssertionDto>> listUnclusteredAssertions(
    String eventId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get<List<PublicAssertionDto>>(
    '/v1/events/${Uri.encodeComponent(eventId)}/unclustered-assertions',
    decoder: (Object? value) => _list(value, PublicAssertionDto.fromJson),
    refresh: refresh,
    requestToken: requestToken,
  );

  @override
  Future<List<RelationshipDto>> listEventRelationships(
    String eventId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get<List<RelationshipDto>>(
    '/v1/events/${Uri.encodeComponent(eventId)}/relationships',
    decoder: (Object? value) => _list(value, RelationshipDto.fromJson),
    refresh: refresh,
    requestToken: requestToken,
  );

  @override
  Future<PositionDetailDto> getPosition(
    String positionId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get<PositionDetailDto>(
    '/v1/positions/${Uri.encodeComponent(positionId)}',
    decoder: PositionDetailDto.fromJson,
    refresh: refresh,
    requestToken: requestToken,
  );

  @override
  Future<SourceDto> getSource(
    String sourceId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get<SourceDto>(
    '/v1/sources/${Uri.encodeComponent(sourceId)}',
    decoder: SourceDto.fromJson,
    refresh: refresh,
    requestToken: requestToken,
  );

  @override
  Future<SemanticThreadPageDto> listSemanticThreads({
    String? cursor,
    int limit = 50,
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get(
    '/semantic/threads',
    query: <String, String>{
      if (limit != 50) 'limit': '$limit',
      'cursor': ?cursor,
    },
    decoder: SemanticThreadPageDto.fromJson,
    refresh: refresh,
    requestToken: requestToken,
  );
  @override
  Future<SemanticThreadDetailDto> getSemanticThread(
    String id, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get(
    '/semantic/threads/${Uri.encodeComponent(id)}',
    decoder: SemanticThreadDetailDto.fromJson,
    refresh: refresh,
    requestToken: requestToken,
  );
  @override
  Future<SemanticTimelineDto> getSemanticTimeline(
    String id, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get(
    '/semantic/threads/${Uri.encodeComponent(id)}/timeline',
    decoder: SemanticTimelineDto.fromJson,
    refresh: refresh,
    requestToken: requestToken,
  );
  @override
  Future<SemanticOccurrenceDto> getSemanticOccurrence(
    String id, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get(
    '/semantic/occurrences/${Uri.encodeComponent(id)}',
    decoder: SemanticOccurrenceDto.fromJson,
    refresh: refresh,
    requestToken: requestToken,
  );
  @override
  Future<List<SemanticSourceDto>> getSemanticOccurrenceSources(
    String id, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get(
    '/semantic/occurrences/${Uri.encodeComponent(id)}/sources',
    decoder: (Object? value) => semanticList(value, SemanticSourceDto.fromJson),
    refresh: refresh,
    requestToken: requestToken,
  );
  @override
  Future<List<SemanticSourceDto>> getSemanticThreadSources(
    String id, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get(
    '/semantic/threads/${Uri.encodeComponent(id)}/sources',
    decoder: (Object? value) => semanticList(value, SemanticSourceDto.fromJson),
    refresh: refresh,
    requestToken: requestToken,
  );
  @override
  Future<SemanticArticleContextDto> getArticleSemanticContext(
    String id, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get(
    '/articles/${Uri.encodeComponent(id)}/semantic-context',
    decoder: SemanticArticleContextDto.fromJson,
    refresh: refresh,
    requestToken: requestToken,
  );
  @override
  Future<SemanticArticleDetailDto> getSemanticArticle(
    String id, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get(
    '/semantic/articles/${Uri.encodeComponent(id)}',
    decoder: SemanticArticleDetailDto.fromJson,
    refresh: refresh,
    requestToken: requestToken,
  );
  @override
  Future<SemanticProvenanceDto> getSemanticProvenance(
    String id, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get(
    '/semantic/provenance/${Uri.encodeComponent(id)}',
    decoder: SemanticProvenanceDto.fromJson,
    refresh: refresh,
    requestToken: requestToken,
  );

  /// Human-reviewed evidence pilot, not part of persistent Event feed or semantic Core.
  Future<CuratedEventPreview> loadChileTornadoEventPreview({
    bool refresh = false,
  }) => _get(
    '/live/preview/events/chile-tornado',
    decoder: CuratedEventPreview.fromJson,
    refresh: refresh,
    requestToken: null,
  );

  /// Authenticated USGS observations. Not a persisted newsroom Article.
  @override
  Future<ChileSeismicObservations> loadChileSeismicObservations({
    bool refresh = false,
  }) => _get(
    '/live/observations/chile/seismic',
    decoder: ChileSeismicObservations.fromJson,
    refresh: refresh,
    requestToken: null,
  );

  /// Unified RSS publisher links. Nothing stored or semantically grouped.
  @override
  Future<ChileRssChronology> loadChileRssChronology({bool refresh = false}) =>
      _get(
        '/live/preview/rss/chile/chronology',
        decoder: ChileRssChronology.fromJson,
        refresh: refresh,
        requestToken: null,
      );

  /// Authenticated second publisher original RSS links; no stored articles.
  @override
  Future<ChileRssLinksPreview> loadChileRssLinks({
    bool refresh = false,
  }) => _get(
    '/live/preview/rss/chile/cooperativa',
    decoder: ChileRssLinksPreview.fromJson,
    refresh: refresh,
    requestToken: null,
  );

  @override
  Future<ChileRssLinkedNews> loadChileRssLinkedNews({bool refresh = false}) =>
      _get(
        '/live/preview/rss/chile',
        decoder: ChileRssLinkedNews.fromJson,
        refresh: refresh,
        requestToken: null,
      );

  /// Opt-in, beta-only preview. Never included in live/news or local Article cache.
  Future<GovUkPreview> loadGovUkPreview({bool refresh = false}) => _get(
    '/live/preview/govuk',
    decoder: GovUkPreview.fromJson,
    refresh: refresh,
    requestToken: null,
  );
  /// Live official two-publisher beta preview, still without Article persistence.
  Future<GovUkPreview> loadGovUkHousingPreview({bool refresh = false}) => _get(
    '/live/preview/govuk/housing',
    decoder: GovUkPreview.fromJson,
    refresh: refresh,
    requestToken: null,
  );

  @override
  Future<LiveNewsPageDto> listLiveNews({
    String? cursor,
    int limit = 25,
    String? query,
    String? sourceId,
    String? format,
    String? topic,
    DateTime? publishedFrom,
    DateTime? publishedTo,
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get(
    '/live/news',
    query: <String, String>{
      'country': ?_marketQuery,
      'limit': '$limit',
      'cursor': ?cursor,
      'q': ?query,
      'source_id': ?sourceId,
      'format': ?format,
      'topic': ?topic,
      'published_from': ?publishedFrom?.toUtc().toIso8601String(),
      'published_to': ?publishedTo?.toUtc().toIso8601String(),
    },
    decoder: LiveNewsPageDto.fromJson,
    refresh: refresh,
    requestToken: requestToken,
  );

  @override
  Future<LiveNewsPageDto> listScopedLiveNews({required String scope, String? cursor,
    String? format, String? topic, String? query, String? sourceId, DateTime? publishedFrom,
    DateTime? publishedTo, bool refresh = false, PublicRequestToken? requestToken}) => _get(
      '/live/news/personalized', query: <String,String>{'scope':scope, 'country': ?_marketQuery,
        'cursor': ?cursor, 'format': ?format, 'topic': ?topic, 'q': ?query, 'source_id': ?sourceId,
        'published_from': ?publishedFrom?.toUtc().toIso8601String(), 'published_to': ?publishedTo?.toUtc().toIso8601String()},
      decoder: LiveNewsPageDto.fromJson, refresh:refresh, requestToken:requestToken);

  @override
  Future<RegisteredSourceDirectory> loadRegisteredSources({bool refresh = false}) =>
      _get(
        '/live/registered-sources',
        query: <String, String>{'country': ?_marketQuery},
        decoder: RegisteredSourceDirectory.fromJson,
        refresh: refresh,
        requestToken: null,
      );

  @override
  Future<List<LiveSourceDto>> listLiveSources({
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get(
    '/live/sources',
    query: <String, String>{'country': ?_marketQuery},
    decoder: (Object? value) =>
        liveList(liveObject(value)['items'], LiveSourceDto.fromJson),
    refresh: refresh,
    requestToken: requestToken,
  );

  @override
  Future<LiveNewsDetailDto> getLiveNews(
    String id, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get(
    '/live/news/${Uri.encodeComponent(id)}',
    query: <String, String>{'country': ?_marketQuery},
    decoder: LiveNewsDetailDto.fromJson,
    refresh: refresh,
    requestToken: requestToken,
  );

  @override
  Future<LiveSourceDetailDto> getLiveSource(
    String id, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get(
    '/live/sources/${Uri.encodeComponent(id)}',
    query: <String, String>{'country': ?_marketQuery},
    decoder: LiveSourceDetailDto.fromJson,
    refresh: refresh,
    requestToken: requestToken,
  );

  @override
  Future<LiveProvenanceDto> getLiveProvenance(
    String articleId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get(
    '/live/news/${Uri.encodeComponent(articleId)}/provenance',
    query: <String, String>{'country': ?_marketQuery},
    decoder: LiveProvenanceDto.fromJson,
    refresh: refresh,
    requestToken: requestToken,
  );

  @override
  Future<SemanticShadowPreflightDto> getSemanticShadowPreflight({
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get(
    '/shadow/semantic/preflight',
    decoder: SemanticShadowPreflightDto.fromJson,
    refresh: refresh,
    requestToken: requestToken,
  );

  @override
  Future<EphemeralSemanticDto> getEphemeralSemanticContent({
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get(
    '/shadow/semantic/content',
    decoder: EphemeralSemanticDto.fromJson,
    refresh: refresh,
    requestToken: requestToken,
  );

  @override
  Future<SemanticGraphDto> getSemanticGraph({
    String? runId,
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _get(
    '/shadow/semantic/graph',
    query: <String, String>{'run_id': ?runId},
    decoder: (Object? value) {
      final SemanticGraphDto graph = SemanticGraphDto.fromJson(value);
      if (runId != null && graph.selected?.run.id != runId) {
        throw const FormatException('Graph response is not the requested run.');
      }
      return graph;
    },
    refresh: refresh,
    requestToken: requestToken,
  );

  Future<T> _get<T>(
    String path, {
    Map<String, String>? query,
    required JsonDecoder<T> decoder,
    required bool refresh,
    required PublicRequestToken? requestToken,
  }) async {
    requestToken?.throwIfCancelled();
    final Uri uri = _configuration.resolve(path, query);
    final String cacheKey = uri.toString();
    final _CacheEntry<Object>? cached = _cache[cacheKey];
    String? accessToken;
    try {
      accessToken = await authorizationTokenProvider?.call();
    } on PublicApiFailure catch (failure) {
      if (failure.kind == PublicFailureKind.unauthorized) {
        onAuthorizationRejected?.call();
      }
      rethrow;
    } on Object {
      throw const PublicApiFailure(kind: PublicFailureKind.network);
    }
    final Map<String, String> headers = <String, String>{
      'accept': 'application/json',
      if (accessToken != null && accessToken.isNotEmpty)
        'authorization': 'Bearer $accessToken',
      if (cached?.etag != null) 'if-none-match': cached!.etag!,
      if (cached?.etag == null && cached?.lastModified != null)
        'if-modified-since': cached!.lastModified!,
      if (refresh) 'cache-control': 'no-cache',
    };

    late http.Response response;
    for (var attempt = 0; ; attempt += 1) {
      try {
        response = await _httpClient
            .get(uri, headers: headers)
            .timeout(timeout);
      } on TimeoutException {
        if (attempt + 1 >= maxAttempts) {
          throw const PublicApiFailure(kind: PublicFailureKind.network);
        }
        requestToken?.throwIfCancelled();
        await Future<void>.delayed(retryDelay * (attempt + 1));
        continue;
      } on http.ClientException {
        if (attempt + 1 >= maxAttempts) {
          throw const PublicApiFailure(kind: PublicFailureKind.network);
        }
        requestToken?.throwIfCancelled();
        await Future<void>.delayed(retryDelay * (attempt + 1));
        continue;
      }
      if (<int>{502, 503, 504}.contains(response.statusCode) &&
          attempt + 1 < maxAttempts) {
        requestToken?.throwIfCancelled();
        await Future<void>.delayed(retryDelay * (attempt + 1));
        continue;
      }
      break;
    }
    requestToken?.throwIfCancelled();

    if (response.statusCode == 304) {
      if (cached == null || cached.value is! T) {
        throw const PublicApiFailure(kind: PublicFailureKind.invalidResponse);
      }
      return cached.value as T;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      if (response.statusCode == 401) onAuthorizationRejected?.call();
      throw _decodeFailure(response);
    }

    try {
      final T result = decoder(jsonDecode(utf8.decode(response.bodyBytes)));
      if (response.headers['cache-control']?.contains('no-store') == true) {
        _cache.remove(cacheKey);
      } else {
        _cache[cacheKey] = _CacheEntry<Object>(
          value: result as Object,
          etag: response.headers['etag'],
          lastModified: response.headers['last-modified'],
        );
      }
      return result;
    } on FormatException {
      throw const PublicApiFailure(kind: PublicFailureKind.invalidResponse);
    }
  }

  PublicApiFailure _decodeFailure(http.Response response) {
    String? code;
    TombstoneDto? tombstone;
    try {
      final Object? decoded = jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is Map<String, Object?>) {
        final Object? rawCode = decoded['code'];
        if (rawCode is String && rawCode.startsWith('PUBLIC_')) {
          code = rawCode;
        }
        if (response.statusCode == 410 && decoded['tombstone'] != null) {
          tombstone = TombstoneDto.fromJson(decoded['tombstone']);
        }
      }
    } on FormatException {
      // Status remains authoritative; malformed details are not exposed.
    }

    final PublicFailureKind kind = switch (response.statusCode) {
      400 => PublicFailureKind.invalidRequest,
      404 => PublicFailureKind.notFound,
      409 => PublicFailureKind.analysisUnavailable,
      410 => PublicFailureKind.gone,
      429 => PublicFailureKind.rateLimited,
      401 => PublicFailureKind.unauthorized,
      _ => PublicFailureKind.serviceUnavailable,
    };
    return PublicApiFailure(
      kind: kind,
      statusCode: response.statusCode,
      code: code,
      tombstone: tombstone,
    );
  }

  void close() {
    _followingVersion.dispose();
    if (_ownsClient) _httpClient.close();
  }
}

PublicPage<T> _page<T>(Object? value, T Function(Object?) decodeItem) {
  if (value is! Map<String, Object?> ||
      value.keys.length != 2 ||
      !value.containsKey('items') ||
      !value.containsKey('next_cursor')) {
    throw const FormatException('Public page has an invalid field set.');
  }
  final Object? cursor = value['next_cursor'];
  if (cursor != null && cursor is! String) {
    throw const FormatException('Public page cursor must be null or a string.');
  }
  return PublicPage<T>(
    items: _list(value['items'], decodeItem),
    nextCursor: cursor as String?,
  );
}

List<T> _list<T>(Object? value, T Function(Object?) decodeItem) {
  if (value is! List<Object?>) {
    throw const FormatException('Expected a JSON array.');
  }
  return List<T>.unmodifiable(value.map(decodeItem));
}

final class _CacheEntry<T> {
  const _CacheEntry({
    required this.value,
    required this.etag,
    required this.lastModified,
  });

  final T value;
  final String? etag;
  final String? lastModified;
}
