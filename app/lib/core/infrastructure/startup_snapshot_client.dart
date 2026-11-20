import 'dart:async';
import 'dart:convert';

import 'package:dialektik/core/infrastructure/startup_snapshot_storage_io.dart'
    if (dart.library.js_interop) 'package:dialektik/core/infrastructure/startup_snapshot_storage_web.dart'
    as storage;
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

/// Reads and writes snapshot bodies by key. Errors are swallowed by the
/// client: a missing disk never blocks a request.
abstract interface class SnapshotStorage {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
}

/// The device's application-support directory (localStorage on the web).
final class DeviceSnapshotStorage implements SnapshotStorage {
  const DeviceSnapshotStorage();

  @override
  Future<String?> read(String key) => storage.readSnapshot(key);

  @override
  Future<void> write(String key, String value) =>
      storage.writeSnapshot(key, value);
}

/// Bumped whenever a saved copy was shown and the fresh answer has now
/// arrived: screens that loaded from the copy reload.
final ValueNotifier<int> startupSnapshotFreshness = ValueNotifier<int>(0);

/// Opens the app on the last common Inicio the device saw.
///
/// Only common reads are kept (the feed, the duels, a story and the latest
/// news, never a personalized, searched or paged request), so nothing of the
/// reader is stored. The first request of each such URL in a session waits
/// for the server at most [patience]; if Core is still waking up (free
/// Render) or the phone is offline, the saved copy answers instead and the
/// fresh answer, when it arrives, is saved and announced through
/// [freshAvailable] so the screen reloads. Later requests go to the network
/// as usual. Every fresh 200 of a common read replaces its copy.
class StartupSnapshotClient extends http.BaseClient {
  StartupSnapshotClient({
    required http.Client inner,
    this.storage = const DeviceSnapshotStorage(),
    this.patience = const Duration(milliseconds: 1200),
  }) : _inner = inner;

  final http.Client _inner;
  final SnapshotStorage storage;
  final Duration patience;

  /// Bumped when a fresh answer replaced a copy that was shown.
  ValueNotifier<int> get freshAvailable => startupSnapshotFreshness;

  final Set<String> _firstServed = <String>{};

  static final RegExp _eventPath = RegExp(r'/v1/events/[^/]+$');

  /// A request every reader gets alike.
  static bool isCommonRead(http.BaseRequest request) {
    if (request.method != 'GET') return false;
    final Uri uri = request.url;
    final String path = uri.path;
    final bool commonPath =
        path.endsWith('/v1/feed') ||
        path.endsWith('/v1/contradictions') ||
        path.endsWith('/live/news') ||
        _eventPath.hasMatch(path);
    if (!commonPath) return false;
    const Set<String> personal = <String>{
      'personalized',
      'q',
      'cursor',
      'source_id',
      'scope',
    };
    return !uri.queryParameters.keys.any(personal.contains);
  }

  /// Stable key of a URL (path and sorted query, never the host or token).
  static String keyOf(Uri uri) {
    final List<String> query =
        uri.queryParameters.entries
            .map((MapEntry<String, String> e) => '${e.key}=${e.value}')
            .toList()
          ..sort();
    final String text = '${uri.path}?${query.join('&')}';
    int hash = 0x811c9dc5;
    for (final int unit in utf8.encode(text)) {
      hash = ((hash ^ unit) * 0x01000193) & 0xffffffff;
    }
    return hash.toRadixString(16).padLeft(8, '0');
  }

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (!isCommonRead(request)) return _inner.send(request);
    final String key = keyOf(request.url);
    final Future<http.Response> network = _inner
        .send(request)
        .then(http.Response.fromStream);
    if (!_firstServed.add(key)) return _streamed(await _saved(key, network));
    final String? copy = await _read(key);
    if (copy == null) return _streamed(await _saved(key, network));

    final Completer<http.Response> answer = Completer<http.Response>();
    bool servedCopy = false;
    final Timer timer = Timer(patience, () {
      if (answer.isCompleted) return;
      servedCopy = true;
      answer.complete(_copyResponse(copy, request));
    });
    unawaited(
      _saved(key, network).then(
        (http.Response fresh) {
          timer.cancel();
          if (!answer.isCompleted) {
            answer.complete(fresh);
          } else if (servedCopy && fresh.statusCode == 200) {
            freshAvailable.value += 1;
          }
        },
        onError: (Object error, StackTrace stack) {
          timer.cancel();
          // Offline: the saved copy is better than an error.
          if (!answer.isCompleted) {
            servedCopy = true;
            answer.complete(_copyResponse(copy, request));
          }
        },
      ),
    );
    return _streamed(await answer.future);
  }

  Future<http.Response> _saved(String key, Future<http.Response> network) =>
      network.then((http.Response response) {
        if (response.statusCode == 200 && response.bodyBytes.isNotEmpty) {
          unawaited(_write(key, utf8.decode(response.bodyBytes)));
        }
        return response;
      });

  Future<String?> _read(String key) async {
    try {
      return await storage.read(key);
    } on Object {
      return null;
    }
  }

  Future<void> _write(String key, String value) async {
    try {
      await storage.write(key, value);
    } on Object {
      // A full or missing disk only means no copy next time.
    }
  }

  static http.Response _copyResponse(String body, http.BaseRequest request) =>
      http.Response.bytes(
        utf8.encode(body),
        200,
        request: request,
        headers: const <String, String>{
          'content-type': 'application/json; charset=utf-8',
          'x-dialektik-snapshot': '1',
        },
      );

  static http.StreamedResponse _streamed(http.Response response) =>
      http.StreamedResponse(
        Stream<List<int>>.value(response.bodyBytes),
        response.statusCode,
        contentLength: response.bodyBytes.length,
        request: response.request,
        headers: response.headers,
        reasonPhrase: response.reasonPhrase,
      );

  @override
  void close() => _inner.close();
}
