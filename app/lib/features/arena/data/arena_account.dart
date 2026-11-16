import 'package:flutter/foundation.dart';

/// The signed-in reader as the Arena shows it: alias, email and the two
/// account actions. The sign-in screen owns the session; the Arena only
/// displays it and asks for changes.
abstract class ArenaAccount extends ChangeNotifier {
  /// Email of the account; null for providers that do not share one.
  String? get email;

  /// Public alias shown on community entries.
  String get alias;

  /// Saves a new public alias. Throws when it is not accepted.
  Future<void> updateAlias(String alias);

  Future<void> signOut();
}
