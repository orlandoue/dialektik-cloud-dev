import 'dart:async';
import 'dart:convert';

import 'package:dialektik/features/arena/data/arena_account.dart';
import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/following_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_client.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/data/source_sync_repository.dart';
import 'package:dialektik/features/consumer/data/story_follow_store.dart';
import 'package:dialektik/features/consumer/data/story_storage_io.dart'
    if (dart.library.js_interop) 'package:dialektik/features/consumer/data/story_storage_web.dart'
    as storage;
import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/live/data/chile_seismic_observations.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/social/data/arena_social_repository.dart';
import 'package:dialektik/features/social/data/social_repository.dart';
import 'package:flutter/foundation.dart';

/// One published contrast joined with the coverage of its event.
final class ArenaDuel {
  ArenaDuel({required this.contrast, required this.event});

  final ContradictionDto contrast;
  final EventDetailDto event;

  EventCoveragePositionDto? _position(String id) {
    for (final EventCoveragePositionDto position in event.coveragePositions) {
      if (position.id == id) return position;
    }
    return null;
  }

  EventCoveragePositionDto? get positionA => _position(contrast.positionA.id);
  EventCoveragePositionDto? get positionB => _position(contrast.positionB.id);

  /// `CONTRADICTION`, `DIFFERENT_FOCUS` or `COMPATIBLE`.
  ///
  /// Core names the relation of a published contrast `contrast` or
  /// `contradiction`; a publication without one is read from its rule.
  String get kind {
    String? raw;
    for (final EventContrastDto item in event.contrasts) {
      final Set<String> pair = <String>{item.positionAId, item.positionBId};
      if (pair.contains(contrast.positionA.id) &&
          pair.contains(contrast.positionB.id)) {
        raw = item.kind;
      }
    }
    switch ((raw ?? event.synthesisRelation)?.toUpperCase()) {
      case 'CONTRAST' || 'DIFFERENT_FOCUS':
        return 'DIFFERENT_FOCUS';
      case 'CONTRADICTION' || 'CONFLICTING':
        return 'CONTRADICTION';
      case 'COMPATIBLE':
        return 'COMPATIBLE';
    }
    final bool focus =
        contrast.thresholdRule == 'v1:editorial_focus_contrast' ||
        contrast.eventTitle.trimLeft().toLowerCase().startsWith(
          'contraste de enfoques',
        );
    return focus ? 'DIFFERENT_FOCUS' : 'CONTRADICTION';
  }

  String get title => arenaTitle(contrast.eventTitle);

  static String nameOf(EventCoveragePositionDto? position) =>
      position == null || position.assertions.isEmpty
      ? 'Medio no disponible'
      : arenaSourceName(position.assertions.first.sourceName);

  static String? sourceIdOf(EventCoveragePositionDto? position) =>
      position == null || position.assertions.isEmpty
      ? null
      : position.assertions.first.sourceId;

  String get nameA => nameOf(positionA);
  String get nameB => nameOf(positionB);
}

/// In-memory state shared by the five Arena tabs.
///
/// Every value comes from Core; nothing here invents coverage, votes or
/// people. Tabs read the same loaded lists, so switching pills is immediate.
final class ArenaStore extends ChangeNotifier {
  ArenaStore({
    required this.consumer,
    required this.live,
    this.openLink = openExternalHttpLink,
    this.account,
  }) {
    following?.followingChanges.addListener(_followsChanged);
  }

  final ConsumerRepository consumer;
  final LiveNewsRepository live;
  final ExternalLinkOpener openLink;

  /// The signed-in reader, when the app runs behind the sign-in screen.
  final ArenaAccount? account;

  /// Alias sent with community entries; null lets Core derive one.
  String? get alias => account?.alias;

  static const String _savedKey = 'dialektik_arena_saved';

  List<EventCardDto> events = const <EventCardDto>[];
  List<ArenaDuel> duels = const <ArenaDuel>[];
  List<LiveSourceDto> sources = const <LiveSourceDto>[];
  List<LiveNewsItemDto> videos = const <LiveNewsItemDto>[];
  Set<String> followed = <String>{};
  final Set<String> saved = <String>{};
  bool loading = false;
  bool loaded = false;
  Object? error;
  bool _disposed = false;
  Future<void>? _running;
  final Map<String, EventDetailDto> _details = <String, EventDetailDto>{};
  final Map<String, Future<EventDetailDto>> _pendingDetails =
      <String, Future<EventDetailDto>>{};
  final Map<String, SocialSummary> _summaries = <String, SocialSummary>{};

  T? _capability<T>() {
    final Object liveRepository = live;
    if (liveRepository is T) return liveRepository as T;
    final Object consumerRepository = consumer;
    if (consumerRepository is T) return consumerRepository as T;
    return null;
  }

  FollowingRepository? get following {
    final FollowingRepository? repository = _capability<FollowingRepository>();
    return repository != null && repository.followingAvailable
        ? repository
        : null;
  }

  SocialRepository? get social => _capability<SocialRepository>();
  ArenaSocialRepository? get arenaSocial =>
      _capability<ArenaSocialRepository>();
  ScopedLiveNewsRepository? get scoped =>
      _capability<ScopedLiveNewsRepository>();
  SeismicObservationRepository? get seismic =>
      _capability<SeismicObservationRepository>();
  SourceSyncRepository? get sourceSync => _capability<SourceSyncRepository>();
  StoryFollowStore get stories => StoryFollowStore.forRepository(consumer);

  final Map<String, PositionVotes> _positionVotes = <String, PositionVotes>{};
  final Map<String, List<CommunityEntry>> _community =
      <String, List<CommunityEntry>>{};

  PositionVotes? cachedPositionVotes(String eventId) => _positionVotes[eventId];
  List<CommunityEntry>? cachedCommunity(String eventId) => _community[eventId];

  /// Posture votes of a case, or null while Core does not serve them yet
  /// (the screens then fall back to the case-level support votes).
  Future<PositionVotes?> positionVotes(
    String eventId, {
    bool refresh = false,
  }) async {
    final ArenaSocialRepository? repository = arenaSocial;
    if (repository == null) return null;
    final PositionVotes? cached = _positionVotes[eventId];
    if (cached != null && !refresh) return cached;
    try {
      final PositionVotes value = await repository.positionVotes(eventId);
      rememberPositionVotes(eventId, value);
      return value;
    } on Exception {
      return cached;
    }
  }

  void rememberPositionVotes(String eventId, PositionVotes value) {
    _positionVotes[eventId] = value;
    _notify();
  }

  /// The three community channels, or null while Core lacks them.
  Future<List<CommunityEntry>?> community(String eventId) async {
    final ArenaSocialRepository? repository = arenaSocial;
    if (repository == null) return null;
    try {
      final List<CommunityEntry> value = await repository.communityEntries(
        eventId,
      );
      rememberCommunity(eventId, value);
      return value;
    } on Exception {
      return _community[eventId];
    }
  }

  void rememberCommunity(String eventId, List<CommunityEntry> value) {
    _community[eventId] = value;
    _notify();
  }

  EventDetailDto? cachedDetail(String id) => _details[id];
  SocialSummary? cachedSummary(String eventId) => _summaries[eventId];

  LiveSourceDto? source(String id) {
    for (final LiveSourceDto item in sources) {
      if (item.id == id) return item;
    }
    return null;
  }

  /// A medium registered twice (press feed and YouTube channel) is one brand.
  static String brandKey(String name) =>
      arenaSourceName(name).toLowerCase().replaceAll(RegExp(r'\s+'), ' ');

  /// Every registered source of the same medium, [source] included.
  List<LiveSourceDto> brandOf(LiveSourceDto source) {
    final String key = brandKey(source.name);
    final List<LiveSourceDto> same = sources
        .where((LiveSourceDto s) => brandKey(s.name) == key)
        .toList();
    return same.isEmpty ? <LiveSourceDto>[source] : same;
  }

  /// Sources grouped by medium, in directory order.
  List<List<LiveSourceDto>> brands(Iterable<LiveSourceDto> from) {
    final Map<String, List<LiveSourceDto>> grouped =
        <String, List<LiveSourceDto>>{};
    for (final LiveSourceDto source in from) {
      grouped
          .putIfAbsent(brandKey(source.name), () => <LiveSourceDto>[])
          .add(source);
    }
    return grouped.values.toList();
  }

  bool followsBrand(List<LiveSourceDto> brand) =>
      brand.any((LiveSourceDto s) => followed.contains(s.id));

  /// Follows or unfollows every source of a medium together.
  Future<void> setBrandFollowing(
    List<LiveSourceDto> brand, {
    required bool value,
  }) async {
    for (final LiveSourceDto source in brand) {
      if (followed.contains(source.id) != value) {
        await setFollowing(source.id, value: value);
      }
    }
  }

  ArenaDuel? duelForEvent(String eventId) {
    for (final ArenaDuel duel in duels) {
      if (duel.event.id == eventId) return duel;
    }
    return null;
  }

  /// Events that are still developing and have no published contrast.
  List<EventCardDto> get developing {
    final Set<String> contrasted = duels
        .map((ArenaDuel duel) => duel.event.id)
        .toSet();
    return events
        .where((EventCardDto event) => !contrasted.contains(event.id))
        .toList(growable: false);
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> load({bool refresh = false}) =>
      _running ??= _load(refresh: refresh).whenComplete(() {
        _running = null;
      });

  Future<void> _load({required bool refresh}) async {
    loading = true;
    error = null;
    _notify();
    unawaited(_loadSaved());
    unawaited(stories.load().catchError((Object _) {}));
    final Future<void> secondary = Future.wait(<Future<void>>[
      _loadSources(refresh: refresh),
      _loadFollowed(),
      _loadVideos(refresh: refresh),
    ]);
    try {
      final List<Object> primary = await Future.wait(<Future<Object>>[
        _allEvents(refresh: refresh),
        _allContrasts(refresh: refresh),
      ]);
      final List<EventCardDto> allEvents = primary[0] as List<EventCardDto>
        ..sort(
          (EventCardDto a, EventCardDto b) =>
              b.detectedAt.compareTo(a.detectedAt),
        );
      final List<ContradictionDto> contrasts =
          primary[1] as List<ContradictionDto>..sort(
            (ContradictionDto a, ContradictionDto b) =>
                b.confirmedAt.compareTo(a.confirmedAt),
          );
      stories.rememberRelations(allEvents);
      events = allEvents;
      _notify();
      final List<ArenaDuel?> joined = await Future.wait(
        contrasts.map((ContradictionDto contrast) async {
          try {
            return ArenaDuel(
              contrast: contrast,
              event: await detail(contrast.eventId, refresh: refresh),
            );
          } on Exception {
            return null;
          }
        }),
      );
      duels = joined.whereType<ArenaDuel>().toList(growable: false);
      loaded = true;
    } on Exception catch (failure) {
      error = failure;
    }
    await secondary;
    loading = false;
    _notify();
  }

  Future<List<EventCardDto>> _allEvents({required bool refresh}) async {
    final List<EventCardDto> all = <EventCardDto>[];
    final Set<String> seen = <String>{};
    String? cursor;
    var pages = 0;
    do {
      final ConsumerRepository repository = consumer;
      // VS and Historias are universal: never narrowed to followed sources.
      final PublicPage<EventCardDto> page = repository is PublicApiClient
          ? await repository.listFeed(
              cursor: cursor,
              limit: 50,
              refresh: refresh,
              personalized: false,
            )
          : await repository.listFeed(
              cursor: cursor,
              limit: 50,
              refresh: refresh,
            );
      all.addAll(page.items);
      cursor = page.nextCursor;
    } while (cursor != null && seen.add(cursor) && ++pages < 6);
    return all;
  }

  Future<List<ContradictionDto>> _allContrasts({required bool refresh}) async {
    final List<ContradictionDto> all = <ContradictionDto>[];
    final Set<String> seen = <String>{};
    String? cursor;
    var pages = 0;
    do {
      final ConsumerRepository repository = consumer;
      final PublicPage<ContradictionDto> page = repository is PublicApiClient
          ? await repository.listContradictions(
              cursor: cursor,
              limit: 50,
              refresh: refresh,
              personalized: false,
            )
          : await repository.listContradictions(
              cursor: cursor,
              limit: 50,
              refresh: refresh,
            );
      all.addAll(page.items);
      cursor = page.nextCursor;
    } while (cursor != null && seen.add(cursor) && ++pages < 6);
    return all;
  }

  Future<void> _loadSources({required bool refresh}) async {
    try {
      sources = await live.listLiveSources(refresh: refresh);
      _notify();
    } on Exception {
      /* The directory shows its own retry state. */
    }
  }

  Future<void> _loadFollowed() async {
    try {
      final Set<String>? ids = await following?.listFollowedSources();
      if (ids != null) {
        followed = Set<String>.of(ids);
        _notify();
      }
    } on Exception {
      /* Keep the last known selection. */
    }
  }

  Future<void> _loadVideos({required bool refresh}) async {
    try {
      final LiveNewsPageDto page = await live.listLiveNews(
        format: 'videos',
        limit: 6,
        refresh: refresh,
      );
      videos = page.items;
      _notify();
    } on Exception {
      /* Videos are optional on the Coliseo. */
    }
  }

  void _followsChanged() => unawaited(_loadFollowed());

  /// Coverage of one event, shared by every screen that opens it.
  Future<EventDetailDto> detail(String id, {bool refresh = false}) {
    final EventDetailDto? cached = _details[id];
    if (cached != null && !refresh) {
      return Future<EventDetailDto>.value(cached);
    }
    // A block body: returning the removed future would make it wait on itself.
    return _pendingDetails[id] ??= _fetchDetail(id, refresh: refresh)
        .whenComplete(() {
          _pendingDetails.remove(id);
        });
  }

  Future<EventDetailDto> _fetchDetail(
    String id, {
    required bool refresh,
  }) async {
    final ConsumerRepository repository = consumer;
    final EventDetailDto value = repository is PublicApiClient
        ? await repository.getEvent(id, refresh: refresh, personalized: false)
        : await repository.getEvent(id, refresh: refresh);
    _details[id] = value;
    return value;
  }

  Future<SocialSummary?> summary(String eventId, {bool refresh = false}) async {
    final SocialRepository? repository = social;
    if (repository == null) return null;
    final SocialSummary? cached = _summaries[eventId];
    if (cached != null && !refresh) return cached;
    final SocialSummary value = await repository.socialSummary(
      eventId: eventId,
    );
    _summaries[eventId] = value;
    _notify();
    return value;
  }

  void rememberSummary(String eventId, SocialSummary value) {
    _summaries[eventId] = value;
    _notify();
  }

  Future<void> setFollowing(String sourceId, {required bool value}) async {
    final FollowingRepository? repository = following;
    if (repository == null) {
      throw StateError('El seguimiento requiere una sesión.');
    }
    await repository.setFollowing(sourceId, following: value);
    if (value) {
      followed.add(sourceId);
    } else {
      followed.remove(sourceId);
    }
    _notify();
  }

  Future<void> _loadSaved() async {
    try {
      final String? raw = await storage.readStories(_savedKey);
      if (raw == null) return;
      final Object? decoded = jsonDecode(raw);
      if (decoded is List) {
        saved.addAll(decoded.whereType<String>());
        _notify();
      }
    } on Object {
      /* Saved items are a device convenience only. */
    }
  }

  void toggleSaved(String eventId) {
    if (!saved.remove(eventId)) saved.add(eventId);
    _notify();
    unawaited(
      storage
          .writeStories(_savedKey, jsonEncode(saved.toList()))
          .catchError((Object _) {}),
    );
  }

  @override
  void dispose() {
    _disposed = true;
    following?.followingChanges.removeListener(_followsChanged);
    super.dispose();
  }
}
