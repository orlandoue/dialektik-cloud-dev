import 'dart:io';
import 'package:path_provider/path_provider.dart';

Future<String?> readStories(String userId) async {
  final dir = await getApplicationSupportDirectory();
  final file = File('${dir.path}/stories_$userId.json');
  return await file.exists() ? file.readAsString() : null;
}

Future<void> writeStories(String userId, String value) async {
  final dir = await getApplicationSupportDirectory();
  final file = File('${dir.path}/stories_$userId.json');
  final temp = File('${file.path}.tmp');
  await temp.writeAsString(value, flush:true);
  await temp.rename(file.path);
}
