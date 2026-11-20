// Inicio opens on the copy saved on the phone while Core wakes up, and
// nothing personal is ever saved.
import 'dart:async';
import 'dart:convert';

import 'package:dialektik/core/infrastructure/startup_snapshot_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

final class MemoryStorage implements SnapshotStorage {
  final Map<String, String> values = <String, String>{};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;
}

final Uri feed = Uri.parse('https://core.test/v1/feed?limit=20&country=CL');

void main() {
  test('only common reads are kept', () {
    http.Request get(String url) => http.Request('GET', Uri.parse(url));
    expect(
      StartupSnapshotClient.isCommonRead(get('https://c/v1/feed?limit=5')),
      isTrue,
    );
    expect(
      StartupSnapshotClient.isCommonRead(
        get('https://c/v1/events/E1?include=coverage'),
      ),
      isTrue,
    );
    expect(
      StartupSnapshotClient.isCommonRead(get('https://c/live/news?limit=6')),
      isTrue,
    );
    expect(
      StartupSnapshotClient.isCommonRead(
        get('https://c/v1/feed?personalized=1'),
      ),
      isFalse,
    );
    expect(
      StartupSnapshotClient.isCommonRead(get('https://c/v1/feed?cursor=x')),
      isFalse,
    );
    expect(
      StartupSnapshotClient.isCommonRead(get('https://c/live/news?q=boric')),
      isFalse,
    );
    expect(
      StartupSnapshotClient.isCommonRead(
        get('https://c/live/news/personalized?scope=following'),
      ),
      isFalse,
    );
    expect(
      StartupSnapshotClient.isCommonRead(
        get('https://c/v1/events/E1/positions'),
      ),
      isFalse,
    );
    expect(
      StartupSnapshotClient.isCommonRead(
        get('https://c/v1/social/position-votes?event_id=E1'),
      ),
      isFalse,
    );
    expect(
      StartupSnapshotClient.isCommonRead(
        http.Request('POST', Uri.parse('https://c/v1/feed')),
      ),
      isFalse,
    );
  });

  test(
    'a fresh answer is saved; with Core asleep the copy answers first',
    () async {
      final MemoryStorage storage = MemoryStorage();
      // First session: Core answers and the body is saved.
      final StartupSnapshotClient first = StartupSnapshotClient(
        inner: MockClient((_) async => http.Response('{"v":1}', 200)),
        storage: storage,
      );
      expect((await first.get(feed)).body, '{"v":1}');
      await Future<void>.delayed(Duration.zero);
      expect(storage.values.values, <String>['{"v":1}']);

      // Next session: Core takes longer than the patience.
      final Completer<http.Response> slow = Completer<http.Response>();
      final StartupSnapshotClient second = StartupSnapshotClient(
        inner: MockClient((_) => slow.future),
        storage: storage,
        patience: const Duration(milliseconds: 20),
      );
      final int before = startupSnapshotFreshness.value;
      final http.Response shown = await second.get(feed);
      expect(shown.body, '{"v":1}');
      expect(shown.headers['x-dialektik-snapshot'], '1');
      slow.complete(http.Response('{"v":2}', 200));
      await Future<void>.delayed(const Duration(milliseconds: 5));
      expect(storage.values.values, <String>['{"v":2}']);
      expect(
        startupSnapshotFreshness.value,
        before + 1,
        reason: 'the screen reloads',
      );
    },
  );

  test(
    'a quick Core answers itself, and later requests never use the copy',
    () async {
      final MemoryStorage storage = MemoryStorage()
        ..values[StartupSnapshotClient.keyOf(feed)] = '{"v":"old"}';
      int calls = 0;
      final StartupSnapshotClient client = StartupSnapshotClient(
        inner: MockClient((_) async => http.Response('{"v":${++calls}}', 200)),
        storage: storage,
      );
      expect((await client.get(feed)).body, '{"v":1}');
      expect((await client.get(feed)).body, '{"v":2}');
    },
  );

  test('offline, the saved copy beats an error', () async {
    final MemoryStorage storage = MemoryStorage()
      ..values[StartupSnapshotClient.keyOf(feed)] = jsonEncode(<String, int>{
        'v': 0,
      });
    final StartupSnapshotClient client = StartupSnapshotClient(
      inner: MockClient((_) async => throw http.ClientException('offline')),
      storage: storage,
    );
    expect((await client.get(feed)).body, '{"v":0}');
  });

  test('personal requests pass through and are never saved', () async {
    final MemoryStorage storage = MemoryStorage();
    final StartupSnapshotClient client = StartupSnapshotClient(
      inner: MockClient((_) async => http.Response('{"mine":true}', 200)),
      storage: storage,
    );
    await client.get(Uri.parse('https://core.test/v1/feed?personalized=1'));
    await client.get(
      Uri.parse('https://core.test/live/news/personalized?scope=following'),
    );
    await Future<void>.delayed(Duration.zero);
    expect(storage.values, isEmpty);
  });
}
