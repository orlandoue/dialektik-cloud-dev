import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:flutter/foundation.dart';

enum SourcePhase { initial, loading, content, error }

final class SourceController extends ChangeNotifier {
  SourceController({
    required this.sourceId,
    required ConsumerRepository repository,
  }) : _repository = repository;

  final String sourceId;
  final ConsumerRepository _repository;
  SourcePhase phase = SourcePhase.initial;
  SourceDto? source;
  PublicApiFailure? failure;

  Future<void> load() async {
    if (phase != SourcePhase.initial) return;
    phase = SourcePhase.loading;
    notifyListeners();
    try {
      source = await _repository.getSource(sourceId);
      phase = SourcePhase.content;
    } on PublicApiFailure catch (error) {
      failure = error;
      phase = SourcePhase.error;
    }
    notifyListeners();
  }

  Future<void> retry() async {
    phase = SourcePhase.initial;
    failure = null;
    await load();
  }
}
