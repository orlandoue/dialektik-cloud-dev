import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:flutter/foundation.dart';

enum FeedPhase { initial, loading, content, empty, error }

final class FeedController extends ChangeNotifier {
  FeedController({required ConsumerRepository repository})
    : _repository = repository;

  final ConsumerRepository _repository;
  final List<EventCardDto> _items = <EventCardDto>[];
  final Set<String> _requestedCursors = <String>{};
  PublicRequestToken? _requestToken;
  int _generation = 0;

  FeedPhase phase = FeedPhase.initial;
  String? category;
  String? topic;
  String? nextCursor;
  PublicApiFailure? failure;
  PublicApiFailure? transientFailure;
  bool isRefreshing = false;
  bool isPaginating = false;

  List<EventCardDto> get items => List<EventCardDto>.unmodifiable(_items);
  bool get hasFilter => category != null || topic != null;
  bool get canLoadMore =>
      phase == FeedPhase.content &&
      nextCursor != null &&
      !isPaginating &&
      !isRefreshing;

  Future<void> loadInitial() async {
    if (phase != FeedPhase.initial) return;
    await _replace(showLoading: true);
  }

  Future<void> setCategory(String? value) async {
    if (category == value) return;
    category = value;
    await _replace(showLoading: true);
  }

  Future<void> setTopic(String? value) async {
    final String? normalized = value?.trim().isEmpty ?? true
        ? null
        : value!.trim().toLowerCase();
    if (topic == normalized) return;
    topic = normalized;
    await _replace(showLoading: true);
  }

  Future<void> clearFilters() async {
    if (!hasFilter) return;
    category = null;
    topic = null;
    await _replace(showLoading: true);
  }

  Future<void> refresh() async {
    if (isRefreshing) return;
    await _replace(showLoading: _items.isEmpty, refresh: true);
  }

  Future<void> loadNext() async {
    final String? cursor = nextCursor;
    if (!canLoadMore || cursor == null) return;
    if (!_requestedCursors.add(cursor)) {
      nextCursor = null;
      notifyListeners();
      return;
    }
    final int generation = _generation;
    final PublicRequestToken token = PublicRequestToken();
    _requestToken = token;
    isPaginating = true;
    transientFailure = null;
    notifyListeners();
    try {
      final PublicPage<EventCardDto> page = await _repository.listFeed(
        category: category,
        topic: topic,
        cursor: cursor,
        requestToken: token,
      );
      if (generation != _generation || token.isCancelled) return;
      final Set<String> existing = _items
          .map((EventCardDto item) => item.id)
          .toSet();
      _items.addAll(
        page.items.where((EventCardDto item) => existing.add(item.id)),
      );
      nextCursor = page.nextCursor == cursor ? null : page.nextCursor;
    } on PublicApiFailure catch (error) {
      if (error.kind != PublicFailureKind.cancelled &&
          generation == _generation) {
        transientFailure = error;
      }
    } finally {
      if (generation == _generation) {
        isPaginating = false;
        notifyListeners();
      }
    }
  }

  Future<void> _replace({
    required bool showLoading,
    bool refresh = false,
  }) async {
    _generation += 1;
    final int generation = _generation;
    _requestToken?.cancel();
    final PublicRequestToken token = PublicRequestToken();
    _requestToken = token;
    failure = null;
    transientFailure = null;
    isPaginating = false;
    isRefreshing = !showLoading && _items.isNotEmpty;
    if (showLoading) phase = FeedPhase.loading;
    notifyListeners();
    try {
      final PublicPage<EventCardDto> page = await _repository.listFeed(
        category: category,
        topic: topic,
        refresh: refresh,
        requestToken: token,
      );
      if (generation != _generation || token.isCancelled) return;
      _items
        ..clear()
        ..addAll(page.items);
      nextCursor = page.nextCursor;
      _requestedCursors.clear();
      phase = _items.isEmpty ? FeedPhase.empty : FeedPhase.content;
    } on PublicApiFailure catch (error) {
      if (error.kind == PublicFailureKind.cancelled ||
          generation != _generation) {
        return;
      }
      if (_items.isNotEmpty && isRefreshing) {
        transientFailure = error;
        phase = FeedPhase.content;
      } else {
        failure = error;
        phase = FeedPhase.error;
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
