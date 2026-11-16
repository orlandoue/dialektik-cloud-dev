import 'dart:io';

import 'package:path_provider/path_provider.dart';

Future<File> _file() async {
  final Directory dir = await getApplicationSupportDirectory();
  return File('${dir.path}/market.txt');
}

Future<String?> readMarket() async {
  final File file = await _file();
  return await file.exists() ? (await file.readAsString()).trim() : null;
}

Future<void> writeMarket(String code) async {
  final File file = await _file();
  await file.writeAsString(code, flush: true);
}
