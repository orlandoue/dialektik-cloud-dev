import 'dart:convert';

import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_client.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/data/story_storage_io.dart'
    if (dart.library.js_interop) 'package:dialektik/features/consumer/data/story_storage_web.dart' as storage;
import 'package:flutter/foundation.dart';

class StorySnapshot {
  const StorySnapshot({required this.seenAt,required this.sourceCount,required this.articleCount});
  final DateTime seenAt;
  final int sourceCount,articleCount;
  Map<String,Object> toJson() => {'seen_at':seenAt.toUtc().toIso8601String(),'source_count':sourceCount,'article_count':articleCount};
  static StorySnapshot fromJson(Map<String,dynamic> json) => StorySnapshot(seenAt:DateTime.parse(json['seen_at'] as String),sourceCount:json['source_count'] as int,articleCount:json['article_count'] as int);
}

/// Preferences are local to a device and separated by the signed-in account.
class StoryFollowStore extends ChangeNotifier {
  StoryFollowStore._(this.repository) : _testUserId=null, _read=storage.readStories, _write=storage.writeStories;
  @visibleForTesting
  StoryFollowStore.forTesting({required String userId,required Future<String?> Function(String) read,required Future<void> Function(String,String) write})
      : repository=null, _testUserId=userId, _read=read, _write=write;
  static final Expando<StoryFollowStore> _stores = Expando<StoryFollowStore>();
  static StoryFollowStore forRepository(ConsumerRepository repository) => _stores[repository] ??= StoryFollowStore._(repository);
  final ConsumerRepository? repository;
  final String? _testUserId;
  final Future<String?> Function(String) _read;
  final Future<void> Function(String,String) _write;
  final Map<String,StorySnapshot> _items = {};
  Future<void>? _loading;
  Future<void> _writes = Future<void>.value();
  String? _userId;
  bool get available => _userId != null;
  bool contains(String id) => _items.containsKey(id);
  StorySnapshot? snapshot(String id) => _items[id];
  Future<void> load() => _loading ??= _load();
  Future<void> _load() async {
    var id = _testUserId;
    if (id == null) {
      if (repository is! PublicApiClient) return;
      final token = await (repository as PublicApiClient).authorizationTokenProvider?.call();
      if (token == null) return;
      final parts = token.split('.');
      if (parts.length != 3) return;
      final payload = jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))));
      final subject = payload is Map ? payload['sub'] : null;
      if (subject is! String || !RegExp(r'^[0-9a-fA-F-]{36}$').hasMatch(subject)) return;
      id=subject;
    }
    _userId=id;
    final raw = await _read(id);
    if (raw != null) {
      final data = jsonDecode(raw);
      if (data is Map<String,dynamic>) {
        for (final e in data.entries) {
          if (e.value is Map<String,dynamic>) _items[e.key]=StorySnapshot.fromJson(e.value as Map<String,dynamic>);
        }
      }
    }
    notifyListeners();
  }
  Future<void> setFollowing(EventDetailDto event, {required bool following}) async {
    await load();
    if (_userId == null) throw StateError('No hay una sesión disponible.');
    final previous = _items[event.id];
    if (following) {
      _items[event.id] = StorySnapshot(seenAt:DateTime.now(),sourceCount:event.sourceCount,articleCount:event.articles.length);
    } else { _items.remove(event.id); }
    try { await _persist(); } on Object {
      if (previous == null) { _items.remove(event.id); } else { _items[event.id] = previous; }
      notifyListeners();
      rethrow;
    }
    notifyListeners();
  }
  Future<void> markSeen(EventDetailDto event) async {
    await load();
    if (!_items.containsKey(event.id)) return;
    _items[event.id] = StorySnapshot(seenAt:DateTime.now(),sourceCount:event.sourceCount,articleCount:event.articles.length);
    notifyListeners();
    await _persist();
  }
  Future<void> _persist() {
    final user = _userId!;
    final json = jsonEncode(_items.map((key,value) => MapEntry(key,value.toJson())));
    _writes = _writes.catchError((Object _) {}).then((_) => _write(user,json));
    return _writes;
  }
}
