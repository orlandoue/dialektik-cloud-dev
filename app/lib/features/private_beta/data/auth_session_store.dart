import 'package:dialektik/features/private_beta/data/auth_session_storage_io.dart'
    if (dart.library.js_interop) 'package:dialektik/features/private_beta/data/auth_session_storage_web.dart'
    as storage;

/// Where the signed-in session survives app restarts. The value is an opaque
/// JSON string owned by [SupabaseAuthClient]; `null` deletes it.
abstract interface class AuthSessionStore {
  Future<String?> read();
  Future<void> write(String? value);
}

/// The app's private storage: the support directory on the device (only this
/// app can read it) and localStorage on the web.
final class DeviceAuthSessionStore implements AuthSessionStore {
  const DeviceAuthSessionStore();

  @override
  Future<String?> read() => storage.readAuthSession();

  @override
  Future<void> write(String? value) => storage.writeAuthSession(value);
}

/// Keeps the session in memory only (tests, or when storage is unwanted).
final class MemoryAuthSessionStore implements AuthSessionStore {
  MemoryAuthSessionStore([this.value]);

  String? value;

  @override
  Future<String?> read() async => value;

  @override
  Future<void> write(String? value) async => this.value = value;
}
