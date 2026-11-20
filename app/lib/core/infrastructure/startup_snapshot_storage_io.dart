import 'dart:io';

import 'package:path_provider/path_provider.dart';

Future<File> _file(String key) async {
  final Directory dir = await getApplicationSupportDirectory();
  return File('${dir.path}/snapshot_$key.json');
}

Future<String?> readSnapshot(String key) async {
  final File file = await _file(key);
  return await file.exists() ? file.readAsString() : null;
}

Future<void> writeSnapshot(String key, String value) async {
  final File file = await _file(key);
  final File temp = File('${file.path}.tmp');
  await temp.writeAsString(value, flush: true);
  await temp.rename(file.path);
}
