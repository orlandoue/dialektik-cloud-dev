import 'package:web/web.dart' as web;

const String _key = 'dialektik_auth_session';

Future<String?> readAuthSession() async =>
    web.window.localStorage.getItem(_key);

Future<void> writeAuthSession(String? value) async => value == null
    ? web.window.localStorage.removeItem(_key)
    : web.window.localStorage.setItem(_key, value);
