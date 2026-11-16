import 'package:web/web.dart' as web;

Future<String?> readStories(String userId) async => web.window.localStorage.getItem('dialektik_stories_$userId');
Future<void> writeStories(String userId, String value) async => web.window.localStorage.setItem('dialektik_stories_$userId', value);
