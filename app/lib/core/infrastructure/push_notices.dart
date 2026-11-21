import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

/// Push notices (Firebase Cloud Messaging): the «Duelo del día».
///
/// The permission is asked only when the reader accepts the notice (after
/// their first vote, or in Ajustes), never at startup.
abstract interface class PushGateway {
  /// Whether this build and platform can receive notices at all.
  bool get available;

  /// Asks Android for the notification permission; true if granted.
  Future<bool> requestPermission();

  /// This phone's FCM token, or null if it cannot be read.
  Future<String?> token();

  Stream<String> get tokenRefresh;

  /// Case ids of notices the reader tapped while the app was running or in
  /// the background.
  Stream<String> get openedEventIds;

  /// The case id of the notice that launched the app, if any.
  Future<String?> initialEventId();
}

class NoPushGateway implements PushGateway {
  const NoPushGateway();

  @override
  bool get available => false;

  @override
  Future<bool> requestPermission() async => false;

  @override
  Future<String?> token() async => null;

  @override
  Stream<String> get tokenRefresh => const Stream<String>.empty();

  @override
  Stream<String> get openedEventIds => const Stream<String>.empty();

  @override
  Future<String?> initialEventId() async => null;
}

String? _eventIdOf(RemoteMessage message) {
  final Object? id = message.data['event_id'];
  return id is String && id.isNotEmpty ? id : null;
}

class FirebasePushGateway implements PushGateway {
  FirebasePushGateway(this._messaging);

  final FirebaseMessaging _messaging;

  @override
  bool get available => true;

  @override
  Future<bool> requestPermission() async {
    final NotificationSettings settings = await _messaging.requestPermission();
    return settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional;
  }

  @override
  Future<String?> token() => _messaging.getToken();

  @override
  Stream<String> get tokenRefresh => _messaging.onTokenRefresh;

  @override
  Stream<String> get openedEventIds => FirebaseMessaging.onMessageOpenedApp
      .map(_eventIdOf)
      .where((String? id) => id != null)
      .cast<String>();

  @override
  Future<String?> initialEventId() async {
    final RemoteMessage? message = await _messaging.getInitialMessage();
    return message == null ? null : _eventIdOf(message);
  }
}

/// The app's push gateway; [NoPushGateway] until Firebase starts.
PushGateway pushGateway = const NoPushGateway();

/// The case of the last notice the reader tapped, until the app opens it.
/// Firebase may start after the first frame, so the shell listens to this
/// instead of the gateway's streams.
final ValueNotifier<String?> tappedNoticeEventId = ValueNotifier<String?>(null);

/// Called once Firebase is initialized.
Future<void> startPushNotices([PushGateway? gateway]) async {
  final PushGateway started =
      gateway ?? FirebasePushGateway(FirebaseMessaging.instance);
  pushGateway = started;
  started.openedEventIds.listen((String id) => tappedNoticeEventId.value = id);
  final String? launch = await started.initialEventId();
  if (launch != null) tappedNoticeEventId.value = launch;
}
