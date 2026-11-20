import 'package:web/web.dart' as web;

Future<String?> readSnapshot(String key) async =>
    web.window.localStorage.getItem('dialektik_snapshot_$key');

Future<void> writeSnapshot(String key, String value) async =>
    web.window.localStorage.setItem('dialektik_snapshot_$key', value);
