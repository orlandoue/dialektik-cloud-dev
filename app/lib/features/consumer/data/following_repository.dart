import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:flutter/foundation.dart';

final class BlindspotsResult {
  const BlindspotsResult({required this.items, required this.total, required this.followedSourceCount});
  final List<EventCardDto> items;
  final int total;
  final int followedSourceCount;
}

abstract interface class FollowingRepository {
  bool get followingAvailable;
  Listenable get followingChanges;
  Future<Set<String>> listFollowedSources();
  Future<void> setFollowing(String sourceId, {required bool following});
  Future<BlindspotsResult> listBlindspots();
}
