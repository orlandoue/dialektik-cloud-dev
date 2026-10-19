import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

/// Real loopback HTTP transport used only by the provider-free E2E.
///
/// The widget-test binding replaces dart:io HttpClient. Direct TCP lets the
/// production PublicApiClient cross the actual Core HTTP boundary while the
/// call is executed through WidgetTester.runAsync.
final class LoopbackSocketClient extends http.BaseClient {
  final List<String> _safeOutcomes = <String>[];
  final List<int> _safeLatenciesMs = <int>[];

  List<String> get safeOutcomes => List<String>.unmodifiable(_safeOutcomes);
  List<int> get safeLatenciesMs => List<int>.unmodifiable(_safeLatenciesMs);

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final Stopwatch stopwatch = Stopwatch()..start();
    if (!const <String>{'GET', 'POST'}.contains(request.method) ||
        request.url.scheme != 'http' ||
        !const <String>{
          '127.0.0.1',
          'localhost',
          '::1',
        }.contains(request.url.host)) {
      throw http.ClientException(
        'Only loopback HTTP GET/POST is supported.',
        request.url,
      );
    }
    final int port = request.url.hasPort ? request.url.port : 80;
    final Socket socket = await Socket.connect(request.url.host, port);
    try {
      final BytesBuilder requestBody = BytesBuilder(copy: false);
      var requestLength = 0;
      await for (final List<int> chunk in request.finalize()) {
        requestLength += chunk.length;
        if (requestLength > 32 * 1024) {
          throw http.ClientException(
            'Loopback request body is too large.',
            request.url,
          );
        }
        requestBody.add(chunk);
      }
      final Uint8List body = requestBody.takeBytes();
      final String target = request.url.hasQuery
          ? '${request.url.path}?${request.url.query}'
          : request.url.path;
      final StringBuffer wire = StringBuffer()
        ..write('${request.method} $target HTTP/1.1\r\n')
        ..write('Host: ${request.url.host}:$port\r\n')
        ..write('Connection: close\r\n');
      if (body.isNotEmpty &&
          !request.headers.keys.any(
            (String key) => key.toLowerCase() == 'content-length',
          )) {
        wire.write('Content-Length: ${body.length}\r\n');
      }
      request.headers.forEach((String name, String value) {
        wire.write('$name: $value\r\n');
      });
      wire.write('\r\n');
      socket.add(utf8.encode(wire.toString()));
      if (body.isNotEmpty) socket.add(body);
      await socket.flush();
      final Uint8List response = await _readCompleteResponse(
        socket,
        request.url,
      );
      final http.StreamedResponse decoded = _decode(response, request);
      final String safePath = request.url.path.replaceAll(
        RegExp(r'/jobs/[0-9A-HJKMNP-TV-Z]{26}(?=/|$)'),
        '/jobs/:id',
      );
      _safeOutcomes.add('${request.method} $safePath ${decoded.statusCode}');
      _safeLatenciesMs.add(stopwatch.elapsedMilliseconds);
      return decoded;
    } finally {
      socket.destroy();
    }
  }
}

Future<Uint8List> _readCompleteResponse(Socket socket, Uri uri) async {
  final BytesBuilder bytes = BytesBuilder(copy: false);
  final Completer<Uint8List> result = Completer<Uint8List>();
  late final StreamSubscription<Uint8List> subscription;
  subscription = socket.listen(
    (Uint8List chunk) {
      bytes.add(chunk);
      final Uint8List current = bytes.toBytes();
      final int boundary = _headerBoundary(current);
      if (boundary < 0) return;
      final String head = latin1.decode(current.sublist(0, boundary));
      final RegExpMatch? match = RegExp(
        r'^content-length:\s*([0-9]+)\s*$',
        caseSensitive: false,
        multiLine: true,
      ).firstMatch(head);
      if (match != null) {
        final int total = boundary + 4 + int.parse(match.group(1)!);
        if (current.length >= total && !result.isCompleted) {
          result.complete(Uint8List.sublistView(current, 0, total));
        }
      }
    },
    onDone: () {
      if (!result.isCompleted) result.complete(bytes.takeBytes());
    },
    onError: (Object error, StackTrace stackTrace) {
      if (!result.isCompleted) result.completeError(error, stackTrace);
    },
    cancelOnError: true,
  );
  try {
    return await result.future.timeout(
      const Duration(seconds: 10),
      onTimeout: () =>
          throw http.ClientException('Loopback response timed out.', uri),
    );
  } finally {
    await subscription.cancel();
  }
}

http.StreamedResponse _decode(Uint8List response, http.BaseRequest request) {
  final int boundary = _headerBoundary(response);
  if (boundary < 0) {
    throw http.ClientException('Malformed loopback response.', request.url);
  }
  final List<String> lines = latin1
      .decode(response.sublist(0, boundary))
      .split('\r\n');
  final RegExpMatch? status = RegExp(
    r'^HTTP/1\.[01] ([0-9]{3})',
  ).firstMatch(lines.first);
  if (status == null) {
    throw http.ClientException('Missing loopback status.', request.url);
  }
  final Map<String, String> headers = <String, String>{};
  for (final String line in lines.skip(1)) {
    final int separator = line.indexOf(':');
    if (separator <= 0) continue;
    headers[line.substring(0, separator).trim().toLowerCase()] = line
        .substring(separator + 1)
        .trim();
  }
  final Uint8List body = Uint8List.sublistView(response, boundary + 4);
  return http.StreamedResponse(
    Stream<List<int>>.value(body),
    int.parse(status.group(1)!),
    headers: headers,
    request: request,
  );
}

int _headerBoundary(Uint8List bytes) {
  for (var index = 0; index <= bytes.length - 4; index += 1) {
    if (bytes[index] == 13 &&
        bytes[index + 1] == 10 &&
        bytes[index + 2] == 13 &&
        bytes[index + 3] == 10) {
      return index;
    }
  }
  return -1;
}
