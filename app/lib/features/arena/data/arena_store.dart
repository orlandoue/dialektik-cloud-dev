import 'dart:async';
import 'dart:convert';

import 'package:dialektik/core/infrastructure/startup_snapshot_client.dart';
import 'package:dialektik/features/arena/data/arena_account.dart';
import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/data/story_groups.dart';
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
import 'package:dialektik/features/live/data/publisher_market_selection.dart';
import 'package:dialektik/features/science/data/science_models.dart';
import 'package:dialektik/features/science/data/science_repository.dart';
import 'package:dialektik/features/social/data/arena_social_repository.dart';
import 'package:dialektik/features/social/data/social_repository.dart';
import 'package:flutter/foundation.dart';

/// The two reading modes of the app.
enum ArenaMode { general, ciencia }

/// One published contrast joined with the coverage of its event.
/// A stable fair coin from a text (FNV-1a), for the order of the versions.
bool arenaCoinFlip(String text) {
  int hash = 0x811c9dc5;
  for (final int unit in text.codeUnits) {
    hash = ((hash ^ unit) * 0x01000193) & 0xffffffff;
  }
  return hash.isOdd;
}

final class ArenaDuel {
  ArenaDuel({required this.contrast, required this.event, this.seed = ''});

  EventCoveragePositionDto? _position(String id) {
    for (final EventCoveragePositionDto position in event.coveragePositions) {
      if (position.id == id) return position;
    }
    return null;
  }

  final ContradictionDto contrast;
  final EventDetailDto event;

  /// The reader's key: with one, which outlet is A is drawn per reader and
  /// case (stable across openings), so neither the alphabet nor Core's
  /// order gives one outlet the first place for everybody. Without one,
  /// alphabetical.
  final String seed;

  late final bool _swapped = seed.isEmpty
      ? nameOf(_position(contrast.positionB.id)).toLowerCase().compareTo(
              nameOf(_position(contrast.positionA.id)).toLowerCase(),
            ) <
            0
      : arenaCoinFlip('$seed:${event.id}');

  /// Position shown first (left) and second (right).
  String get idA => _swapped ? contrast.positionB.id : contrast.positionA.id;
  String get idB => _swapped ? contrast.positionA.id : contrast.positionB.id;

  EventCoveragePositionDto? get positionA => _position(idA);
  EventCoveragePositionDto? get positionB => _position(idB);

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
    this.market,
    ScienceRepository? science,
  }) : _science = science {
    following?.followingChanges.addListener(_followsChanged);
    _country = market?.value ?? 'CL';
    market?.addListener(_marketChanged);
    startupSnapshotFreshness.addListener(_snapshotRefreshed);
  }

  /// Inicio was painted from the copy saved on the phone; the fresh answer
  /// is here, so load again (now from the network, without a spinner).
  void _snapshotRefreshed() {
    if (!_disposed) unawaited(load());
  }

  /// Selected country (CL, ES, AR, US); shared with the API client, which
  /// sends it to Core. Null in tests and in the classic reader: Chile.
  final PublisherMarketSelection? market;
  String _country = 'CL';

  /// Country whose Coliseo, VS, Historias, Explorar and Medios are shown.
  String get country => _country;

  /// Changes the country for every tab and remembers it on the device.
  void chooseCountry(String code) {
    if (code == _country) return;
    final PublisherMarketSelection? selection = market;
    if (selection == null) {
      _country = code;
      _resetForCountry();
      return;
    }
    selection.choose(code);
  }

  void _marketChanged() {
    final String code = market?.value ?? 'CL';
    if (code == _country) return;
    _country = code;
    _resetForCountry();
  }

  /// Another country is another set of outlets, events and duels.
  void _resetForCountry() {
    events = const <EventCardDto>[];
    duels = const <ArenaDuel>[];
    duelsLoading = false;
    sources = const <LiveSourceDto>[];
    videos = const <LiveNewsItemDto>[];
    loaded = false;
    error = null;
    _notify();
    final Future<void>? running = _running;
    if (running == null) {
      unawaited(load(refresh: true));
    } else {
      unawaited(running.whenComplete(() => load(refresh: true)));
    }
  }

  final ConsumerRepository consumer;
  final LiveNewsRepository live;
  final ExternalLinkOpener openLink;

  /// The signed-in reader, when the app runs behind the sign-in screen.
  final ArenaAccount? account;

  /// Alias sent with community entries; null lets Core derive one.
  String? get alias => account?.alias;

  static const String _savedKey = 'dialektik_arena_saved';
  static const String _modeKey = 'dialektik_arena_mode';

  final ScienceRepository? _science;

  /// Studies and story comments (Core). Requires API for the new routes.
  ScienceRepository? get science =>
      _science ??
      (consumer is ScienceRepository
          ? consumer as ScienceRepository
          : live is ScienceRepository
          ? live as ScienceRepository
          : null);

  /// Stories (several events of one topic) and their moderation.
  StoryGroupsRepository? get storyRepository =>
      consumer is StoryGroupsRepository
      ? consumer as StoryGroupsRepository
      : live is StoryGroupsRepository
      ? live as StoryGroupsRepository
      : null;

  List<StoryGroup> _storyGroups = const <StoryGroup>[];
  Map<String, StoryGroup> _storyByEvent = const <String, StoryGroup>{};

  /// Approved stories of the last 30 days; empty until Core serves them.
  List<StoryGroup> get storyGroups => _storyGroups;

  /// The story an event belongs to, if a moderator grouped it.
  StoryGroup? storyOf(String eventId) => _storyByEvent[eventId];

  Future<void> _loadStoryGroups() async {
    final StoryGroupsRepository? repository = storyRepository;
    if (repository == null) return;
    try {
      final List<StoryGroup> groups = await repository.storyGroups();
      _storyGroups = groups;
      _storyByEvent = <String, StoryGroup>{
        for (final StoryGroup group in groups)
          for (final String id in group.eventIds) id: group,
      };
      _notify();
    } on Object {
      // Without stories every event is shown on its own, as before.
    }
  }

  /// The queue of link contributions, for moderator accounts.
  CommunityModerationRepository? get communityModeration =>
      consumer is CommunityModerationRepository
      ? consumer as CommunityModerationRepository
      : live is CommunityModerationRepository
      ? live as CommunityModerationRepository
      : null;

  /// Moderation calls, for moderator accounts (DIALEKTIK_SCIENCE_MODERATORS).
  ScienceModerationRepository? get moderation {
    final Object? source = science;
    return source is ScienceModerationRepository ? source : null;
  }

  ArenaMode _mode = ArenaMode.general;

  /// General news or Science (studies with DOI); remembered on the device.
  /// Always General while Science is not enabled for this account.
  ArenaMode get mode => _scienceEnabled ? _mode : ArenaMode.general;

  bool _scienceEnabled = false;
  bool _scienceModerator = false;

  /// Science mode and story comments, behind a remote flag that Core turns
  /// on per account. Off until Core says otherwise, and on any error.
  bool get scienceEnabled => _scienceEnabled;

  /// The account may moderate Science (DIALEKTIK_SCIENCE_MODERATORS).
  bool get scienceModerator => _scienceEnabled && _scienceModerator;

  Future<void> _loadScienceAccess() async {
    final ScienceRepository? repository = science;
    if (repository == null) return;
    try {
      final ScienceAccess access = await repository.access();
      if (access.enabled == _scienceEnabled &&
          access.moderator == _scienceModerator) {
        return;
      }
      _scienceEnabled = access.enabled;
      _scienceModerator = access.moderator;
      _notify();
    } on Object {
      /* Fail closed: Science stays hidden. */
    }
  }

  void setMode(ArenaMode value) {
    if (value == _mode) return;
    _mode = value;
    _notify();
    unawaited(
      storage.writeStories(_modeKey, value.name).catchError((Object _) {}),
    );
  }

  Future<void> _loadMode() async {
    try {
      final String? raw = (await storage.readStories(_modeKey))?.trim();
      final ArenaMode? stored = ArenaMode.values
          .where((ArenaMode m) => m.name == raw)
          .firstOrNull;
      if (stored != null && stored != _mode) {
        _mode = stored;
        _notify();
      }
    } on Object {
      /* The mode is a device convenience only. */
    }
  }

  List<EventCardDto> events = const <EventCardDto>[];
  List<ArenaDuel> duels = const <ArenaDuel>[];
  List<LiveSourceDto> sources = const <LiveSourceDto>[];
  List<LiveNewsItemDto> videos = const <LiveNewsItemDto>[];
  Set<String> followed = <String>{};
  final Set<String> saved = <String>{};
  bool loading = false;
  bool loaded = false;

  /// The first carousel duels are still joining their event details.
  bool duelsLoading = false;
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

  /// Core's media group when known, otherwise the medium's name.
  static String brandKeyOf(LiveSourceDto source) =>
      source.mediaGroupSlug ?? brandKey(source.name);

  /// Every registered source of the same medium, [source] included.
  List<LiveSourceDto> brandOf(LiveSourceDto source) {
    final String key = brandKeyOf(source);
    final List<LiveSourceDto> same = sources
        .where((LiveSourceDto s) => brandKeyOf(s) == key)
        .toList();
    return same.isEmpty ? <LiveSourceDto>[source] : same;
  }

  /// Sources grouped by medium, in directory order.
  List<List<LiveSourceDto>> brands(Iterable<LiveSourceDto> from) {
    final Map<String, List<LiveSourceDto>> grouped =
        <String, List<LiveSourceDto>>{};
    for (final LiveSourceDto source in from) {
      grouped
          .putIfAbsent(brandKeyOf(source), () => <LiveSourceDto>[])
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
    // One outlet can be registered several times (web, YouTube…). Core may
    // refuse one of them (rights not approved yet): the outlet counts as
    // followed when at least one record is, and only a total failure is
    // reported.
    Object? failure;
    StackTrace? trace;
    var changed = 0;
    var tried = 0;
    for (final LiveSourceDto source in brand) {
      if (followed.contains(source.id) == value) continue;
      tried += 1;
      try {
        await setFollowing(source.id, value: value);
        changed += 1;
      } on Object catch (error, stack) {
        failure = error;
        trace = stack;
      }
    }
    if (tried > 0 && changed == 0 && failure != null) {
      Error.throwWithStackTrace(failure, trace!);
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
    unawaited(_loadMode());
    unawaited(_loadAlwaysBlind());
    unawaited(_loadScienceAccess());
    unawaited(stories.load().catchError((Object _) {}));
    final Future<void> secondary = Future.wait(<Future<void>>[
      _loadSources(refresh: refresh),
      _loadFollowed(),
      _loadVideos(refresh: refresh),
      _loadStoryGroups(),
    ]);
    try {
      // Inicio paints with the first page of each list; the next pages are
      // fetched behind it instead of keeping the whole tab on a spinner.
      final _Paged<EventCardDto> eventPages = _paged<EventCardDto>(
        (String? cursor) => _feedPage(cursor, refresh: refresh),
      );
      final _Paged<ContradictionDto> contrastPages = _paged<ContradictionDto>(
        (String? cursor) => _contrastPage(cursor, refresh: refresh),
      );
      final List<Object> primary = await Future.wait(<Future<Object>>[
        eventPages.first,
        contrastPages.first,
      ]);
      final List<EventCardDto> allEvents = _sortedEvents(
        primary[0] as List<EventCardDto>,
      );
      final List<ContradictionDto> contrasts = _sortedContrasts(
        primary[1] as List<ContradictionDto>,
      );
      stories.rememberRelations(allEvents);
      events = allEvents;
      unawaited(
        eventPages.rest.then((List<EventCardDto> more) {
          if (_disposed || more.isEmpty) return;
          final Set<String> known = events
              .map((EventCardDto e) => e.id)
              .toSet();
          final List<EventCardDto> merged = _sortedEvents(<EventCardDto>[
            ...events,
            for (final EventCardDto e in more)
              if (known.add(e.id)) e,
          ]);
          stories.rememberRelations(merged);
          events = merged;
          _notify();
        }),
      );
      // The Coliseo can show its stories now; duels fill in as their
      // details arrive instead of keeping the whole tab behind a spinner.
      loaded = true;
      duelsLoading = contrasts.isNotEmpty;
      _notify();
      // The carousel only needs its first pages: paint the Coliseo as soon
      // as those details arrive, then join the remaining contrasts in small
      // waves so a long backlog never blocks the first frame nor floods the
      // Core with one event-detail request per contrast at once.
      final List<ArenaDuel> joined = await _joinDuels(
        contrasts.take(firstDuelWave),
        refresh: refresh,
      );
      duels = joined;
      duelsLoading = false;
      _notify();
      final List<ContradictionDto> rest = _sortedContrasts(<ContradictionDto>[
        ...contrasts.skip(firstDuelWave),
        ...await contrastPages.rest.catchError(
          (Object _) => const <ContradictionDto>[],
        ),
      ]);
      for (var start = 0; start < rest.length; start += backgroundDuelWave) {
        if (_disposed) break;
        final List<ArenaDuel> more = await _joinDuels(
          rest.skip(start).take(backgroundDuelWave),
          refresh: refresh,
        );
        if (more.isEmpty) continue;
        duels = List<ArenaDuel>.unmodifiable(<ArenaDuel>[...duels, ...more]);
        _notify();
      }
    } on Object catch (failure) {
      // Whatever fails, the spinner must stop: the tab shows a retry.
      error = failure;
    } finally {
      duelsLoading = false;
    }
    try {
      await secondary;
    } on Object {
      /* Sources, follows and videos show their own empty states. */
    }
    loading = false;
    _notify();
  }

  /// Contrasts joined before the Coliseo is shown (the carousel pages).
  static const int firstDuelWave = 5;

  /// Contrasts joined per background wave once the Coliseo is visible.
  static const int backgroundDuelWave = 4;

  Future<List<ArenaDuel>> _joinDuels(
    Iterable<ContradictionDto> contrasts, {
    required bool refresh,
  }) async {
    final List<ArenaDuel?> joined = await Future.wait(
      contrasts.map((ContradictionDto contrast) async {
        try {
          return ArenaDuel(
            contrast: contrast,
            event: await detail(contrast.eventId, refresh: refresh),
            seed: account?.email ?? '',
          );
        } on Exception {
          return null;
        }
      }),
    );
    return joined.whereType<ArenaDuel>().toList(growable: false);
  }

  /// At most this many pages of each list are read on opening.
  static const int maxListPages = 6;

  Future<PublicPage<EventCardDto>> _feedPage(
    String? cursor, {
    required bool refresh,
  }) {
    final ConsumerRepository repository = consumer;
    // VS and Historias are universal: never narrowed to followed sources.
    return repository is PublicApiClient
        ? repository.listFeed(
            cursor: cursor,
            limit: 50,
            refresh: refresh,
            personalized: false,
          )
        : repository.listFeed(cursor: cursor, limit: 50, refresh: refresh);
  }

  Future<PublicPage<ContradictionDto>> _contrastPage(
    String? cursor, {
    required bool refresh,
  }) {
    final ConsumerRepository repository = consumer;
    return repository is PublicApiClient
        ? repository.listContradictions(
            cursor: cursor,
            limit: 50,
            refresh: refresh,
            personalized: false,
          )
        : repository.listContradictions(
            cursor: cursor,
            limit: 50,
            refresh: refresh,
          );
  }

  /// The first page as soon as it arrives, and the following pages (up to
  /// [maxListPages] in all) in order behind it.
  _Paged<T> _paged<T>(Future<PublicPage<T>> Function(String? cursor) fetch) {
    final Future<PublicPage<T>> firstPage = fetch(null);
    Future<List<T>> rest() async {
      final List<T> more = <T>[];
      try {
        final Set<String> seen = <String>{};
        String? cursor = (await firstPage).nextCursor;
        var pages = 1;
        while (cursor != null && seen.add(cursor) && pages < maxListPages) {
          final PublicPage<T> page = await fetch(cursor);
          more.addAll(page.items);
          cursor = page.nextCursor;
          pages++;
        }
      } on Object {
        // The first page already shows; a later page that fails keeps
        // what was read (the first-page failure is reported there).
      }
      return more;
    }

    return _Paged<T>(
      firstPage.then((PublicPage<T> page) => page.items.toList()),
      rest(),
    );
  }

  static List<EventCardDto> _sortedEvents(List<EventCardDto> list) => list
    ..sort(
      (EventCardDto a, EventCardDto b) => b.detectedAt.compareTo(a.detectedAt),
    );

  static List<ContradictionDto> _sortedContrasts(List<ContradictionDto> list) =>
      list..sort(
        (ContradictionDto a, ContradictionDto b) =>
            b.confirmedAt.compareTo(a.confirmedAt),
      );

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

  final Set<String> _blind = <String>{};
  final Set<String> _unblinded = <String>{};
  bool _alwaysBlind = false;
  static const String _alwaysBlindKey = 'dialektik_arena_always_blind';

  /// «Leer siempre a ciegas»: every duel opens without the outlets' names,
  /// in Inicio, VS and the duel itself, until the reader votes. Remembered
  /// on the device.
  bool get alwaysBlind => _alwaysBlind;

  Future<void> setAlwaysBlind({required bool value}) async {
    if (value == _alwaysBlind) return;
    _alwaysBlind = value;
    _unblinded.clear();
    _notify();
    try {
      await storage.writeStories(_alwaysBlindKey, value ? '1' : '0');
    } on Object {
      /* A device convenience only. */
    }
  }

  Future<void> _loadAlwaysBlind() async {
    try {
      final bool stored =
          (await storage.readStories(_alwaysBlindKey))?.trim() == '1';
      if (stored != _alwaysBlind) {
        _alwaysBlind = stored;
        _notify();
      }
    } on Object {
      /* A device convenience only. */
    }
  }

  /// «Duelo a ciegas»: the reader chose to read both versions without the
  /// outlets' names until they vote on this case.
  bool isBlind(String eventId) =>
      _alwaysBlind ? !_unblinded.contains(eventId) : _blind.contains(eventId);

  /// Whether the outlets are hidden right now: blind and not yet voted.
  bool hidesOutlets(String eventId) =>
      isBlind(eventId) && cachedPositionVotes(eventId)?.mine == null;

  void setBlind(String eventId, {required bool value}) {
    final bool changed = _alwaysBlind
        ? (value ? _unblinded.remove(eventId) : _unblinded.add(eventId))
        : (value ? _blind.add(eventId) : _blind.remove(eventId));
    if (changed) _notify();
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
    startupSnapshotFreshness.removeListener(_snapshotRefreshed);
    following?.followingChanges.removeListener(_followsChanged);
    market?.removeListener(_marketChanged);
    super.dispose();
  }
}

/// The first page of a list, and the rest of its pages.
final class _Paged<T> {
  const _Paged(this.first, this.rest);

  final Future<List<T>> first;
  final Future<List<T>> rest;
}
