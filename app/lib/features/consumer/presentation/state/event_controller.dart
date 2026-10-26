import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:flutter/foundation.dart';

enum EventPhase { initial, loading, content, gone, error }

final class EventController extends ChangeNotifier {
  EventController({
    required this.eventId,
    required ConsumerRepository repository,
  }) : _repository = repository;

  final String eventId;
  final ConsumerRepository _repository;
  PublicRequestToken? _requestToken;
  int _generation = 0;

  EventPhase phase = EventPhase.initial;
  EventDetailDto? event;
  List<PositionListItemDto> positions = const <PositionListItemDto>[];
  List<PublicAssertionDto> assertions = const <PublicAssertionDto>[];
  List<RelationshipDto> relationships = const <RelationshipDto>[];
  TombstoneDto? tombstone;
  PublicApiFailure? failure;
  PublicApiFailure? transientFailure;
  bool isRefreshing = false;
  bool analysisUnavailable = false;
  String? expandedPositionId;
  final Map<String, PositionDetailDto> positionDetails =
      <String, PositionDetailDto>{};
  final Set<String> loadingPositionIds = <String>{};
  final Set<String> failedPositionIds = <String>{};

  Future<void> load() async {
    if (phase != EventPhase.initial) return;
    await _load(showLoading: true);
  }

  Future<void> refresh() async {
    if (isRefreshing) return;
    await _load(showLoading: event == null, refresh: true);
  }

  Future<void> togglePosition(String positionId) async {
    if (expandedPositionId == positionId) {
      expandedPositionId = null;
      notifyListeners();
      return;
    }
    expandedPositionId = positionId;
    notifyListeners();
    if (positionDetails.containsKey(positionId) ||
        loadingPositionIds.contains(positionId)) {
      return;
    }
    loadingPositionIds.add(positionId);
    failedPositionIds.remove(positionId);
    notifyListeners();
    try {
      positionDetails[positionId] = await _repository.getPosition(positionId);
    } on PublicApiFailure {
      failedPositionIds.add(positionId);
    } finally {
      loadingPositionIds.remove(positionId);
      notifyListeners();
    }
  }

  Future<void> retryPosition(String positionId) async {
    positionDetails.remove(positionId);
    failedPositionIds.remove(positionId);
    loadingPositionIds.remove(positionId);
    if (expandedPositionId != positionId) expandedPositionId = positionId;
    notifyListeners();
    loadingPositionIds.add(positionId);
    notifyListeners();
    try {
      positionDetails[positionId] = await _repository.getPosition(positionId);
    } on PublicApiFailure {
      failedPositionIds.add(positionId);
    } finally {
      loadingPositionIds.remove(positionId);
      notifyListeners();
    }
  }

  Future<void> _load({required bool showLoading, bool refresh = false}) async {
    _generation += 1;
    final int generation = _generation;
    _requestToken?.cancel();
    final PublicRequestToken token = PublicRequestToken();
    _requestToken = token;
    failure = null;
    transientFailure = null;
    if (showLoading) phase = EventPhase.loading;
    isRefreshing = !showLoading && event != null;
    notifyListeners();
    try {
      final EventDetailDto loaded = await _repository.getEvent(
        eventId,
        refresh: refresh,
        requestToken: token,
      );
      if (generation != _generation || token.isCancelled) return;
      final Future<List<RelationshipDto>> relationshipFuture = _repository
          .listEventRelationships(
            eventId,
            refresh: refresh,
            requestToken: token,
          );
      if (loaded.analysisState == AnalysisState.analysisPending) {
        final Future<List<PublicAssertionDto>> assertionFuture = _repository
            .listUnclusteredAssertions(
              eventId,
              refresh: refresh,
              requestToken: token,
            );
        assertions = await assertionFuture;
        positions = const <PositionListItemDto>[];
      } else {
        try {
          positions = await _repository.listEventPositions(
            eventId,
            refresh: refresh,
            requestToken: token,
          );
          analysisUnavailable = false;
        } on PublicApiFailure catch (error) {
          // Do not render structurally incomplete published positions as
          // verified analysis. The event summary remains available, but its
          // analysis is explicitly marked pending until provenance is repaired.
          if (error.kind != PublicFailureKind.analysisUnavailable &&
              error.kind != PublicFailureKind.invalidResponse) {
            rethrow;
          }
          positions = const <PositionListItemDto>[];
          analysisUnavailable = true;
        }
        assertions = const <PublicAssertionDto>[];
      }
      relationships = await relationshipFuture;
      if (generation != _generation || token.isCancelled) return;
      event = loaded;
      tombstone = null;
      phase = EventPhase.content;
    } on PublicApiFailure catch (error) {
      if (error.kind == PublicFailureKind.cancelled ||
          generation != _generation) {
        return;
      }
      if (error.kind == PublicFailureKind.gone && error.tombstone != null) {
        event = null;
        tombstone = error.tombstone;
        phase = EventPhase.gone;
      } else if (event != null && isRefreshing) {
        transientFailure = error;
        phase = EventPhase.content;
      } else {
        failure = error;
        phase = EventPhase.error;
      }
    } finally {
      if (generation == _generation) {
        isRefreshing = false;
        notifyListeners();
      }
    }
  }

  @override
  void dispose() {
    _requestToken?.cancel();
    super.dispose();
  }
}
