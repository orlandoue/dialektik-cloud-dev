/// Registers this phone for the «Duelo del día» notice in Core.
abstract interface class PushDeviceRepository {
  Future<void> registerPushDevice(
    String token, {
    required bool dailyEnabled,
    required int dailyHour,
    required String country,
  });

  Future<void> removePushDevice(String token);
}
