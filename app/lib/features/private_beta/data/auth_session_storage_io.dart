import 'dart:io';

import 'package:path_provider/path_provider.dart';

Future<File> _file() async {
  final Directory dir = await getApplicationSupportDirectory();
  return File('${dir.path}/auth_session.json');
}

Future<String?> readAuthSession() async {
  final File file = await _file();
  return await file.exists() ? file.readAsString() : null;
}

Future<void> writeAuthSession(String? value) async {
  final File file = await _file();
  if (value == null) {
    if (await file.exists()) await file.delete();
    return;
  }
  final File temp = File('${file.path}.tmp');
  await temp.writeAsString(value, flush: true);
  await temp.rename(file.path);
}
