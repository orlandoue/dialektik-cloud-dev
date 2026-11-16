import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:flutter/foundation.dart';

enum ContradictionsPhase { initial, loading, content, empty, error }

final class ContradictionsController extends ChangeNotifier {
  ContradictionsController({required ConsumerRepository repository})
    : _repository = repository;

  final ConsumerRepository _repository;
  ContradictionsPhase phase = ContradictionsPhase.initial;
  List<ContradictionDto> items = const <ContradictionDto>[];
  String? nextCursor;
  PublicApiFailure? failure;
  bool isPaginating = false;

  Future<void> load() async {
    if (phase != ContradictionsPhase.initial) return;
    phase = ContradictionsPhase.loading;
    notifyListeners();
    try {
      final PublicPage<ContradictionDto> page = await _repository
          .listContradictions();
      items = page.items;
      nextCursor = page.nextCursor;
      phase = items.isEmpty
          ? ContradictionsPhase.empty
          : ContradictionsPhase.content;
    } on PublicApiFailure catch (error) {
      failure = error;
      phase = ContradictionsPhase.error;
    }
    notifyListeners();
  }

  Future<void> retry() async {
    phase = ContradictionsPhase.initial;
    failure = null;
    await load();
  }

  Future<void> loadNext() async {
    final String? cursor = nextCursor;
    if (cursor == null || isPaginating) return;
    isPaginating = true;
    notifyListeners();
    try {
      final PublicPage<ContradictionDto> page = await _repository
          .listContradictions(cursor: cursor);
      final Set<String> ids = items
          .map((ContradictionDto item) => item.id)
          .toSet();
      items = <ContradictionDto>[
        ...items,
        ...page.items.where((ContradictionDto item) => ids.add(item.id)),
      ];
      nextCursor = page.nextCursor == cursor ? null : page.nextCursor;
    } on PublicApiFailure catch (error) {
      failure = error;
    } finally {
      isPaginating = false;
      notifyListeners();
    }
  }
}
