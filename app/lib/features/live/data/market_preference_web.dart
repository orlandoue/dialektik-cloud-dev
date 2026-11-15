import 'package:web/web.dart' as web;

const String _key = 'dialektik_market';

Future<String?> readMarket() async => web.window.localStorage.getItem(_key);

Future<void> writeMarket(String code) async =>
    web.window.localStorage.setItem(_key, code);
