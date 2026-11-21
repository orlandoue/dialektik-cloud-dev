import 'dart:async';

import 'package:dialektik/core/infrastructure/push_notices.dart';
import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

/// Anonymous usage statistics (Firebase Analytics, free tier).
///
/// What is never sent: the account, its e-mail or alias, the outlets of a
/// duel, the version a reader chose, what they wrote or searched. A vote is
/// counted only by the duel's kind, the place on screen of the chosen
/// version (first or second) and whether it was blind, so order bias can be
/// measured without tying anyone to a side. No advertising id is collected
/// (see AndroidManifest.xml). The reader can turn it off in Ajustes.
abstract interface class UsageAnalytics {
  Future<void> log(String name, [Map<String, Object>? parameters]);

  Future<void> screen(String name);

  Future<void> setEnabled({required bool value});
}

/// Used in tests, on platforms without Firebase and in builds without its
/// configuration: records nothing.
class NoUsageAnalytics implements UsageAnalytics {
  const NoUsageAnalytics();

  @override
  Future<void> log(String name, [Map<String, Object>? parameters]) async {}

  @override
  Future<void> screen(String name) async {}

  @override
  Future<void> setEnabled({required bool value}) async {}
}

class FirebaseUsageAnalytics implements UsageAnalytics {
  FirebaseUsageAnalytics(this._analytics);

  final FirebaseAnalytics _analytics;

  @override
  Future<void> log(String name, [Map<String, Object>? parameters]) =>
      _analytics.logEvent(name: name, parameters: parameters);

  @override
  Future<void> screen(String name) =>
      _analytics.logScreenView(screenName: name);

  @override
  Future<void> setEnabled({required bool value}) =>
      _analytics.setAnalyticsCollectionEnabled(value);
}

/// The app's analytics; [NoUsageAnalytics] until [startUsageAnalytics] works.
UsageAnalytics usageAnalytics = const NoUsageAnalytics();

/// Firebase's public project values, given at build time so the config
/// file stays out of the repository. All four are needed.
const String _apiKey = String.fromEnvironment('DIALEKTIK_FIREBASE_API_KEY');
const String _appId = String.fromEnvironment('DIALEKTIK_FIREBASE_APP_ID');
const String _senderId = String.fromEnvironment('DIALEKTIK_FIREBASE_SENDER_ID');
const String _projectId = String.fromEnvironment(
  'DIALEKTIK_FIREBASE_PROJECT_ID',
);

bool get firebaseConfigured =>
    _apiKey != '' && _appId != '' && _senderId != '' && _projectId != '';

/// Starts Firebase in the background; startup never waits for it and a
/// failure only leaves analytics off. Firebase itself remembers on the
/// device when the reader turned collection off, so it is not set here.
Future<void> startUsageAnalytics() async {
  if (!firebaseConfigured ||
      kIsWeb ||
      defaultTargetPlatform != TargetPlatform.android) {
    return;
  }
  try {
    await Firebase.initializeApp(
      options: const FirebaseOptions(
        apiKey: _apiKey,
        appId: _appId,
        messagingSenderId: _senderId,
        projectId: _projectId,
      ),
    );
    usageAnalytics = FirebaseUsageAnalytics(FirebaseAnalytics.instance);
    await startPushNotices();
  } on Object catch (error) {
    debugPrint('Analytics unavailable: $error');
  }
}

/// Fire-and-forget logging that never throws into the UI.
void logUsage(String name, [Map<String, Object>? parameters]) =>
    unawaited(usageAnalytics.log(name, parameters).catchError((Object _) {}));

void logScreen(String name) =>
    unawaited(usageAnalytics.screen(name).catchError((Object _) {}));
