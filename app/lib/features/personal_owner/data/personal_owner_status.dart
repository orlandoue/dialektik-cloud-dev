final class PersonalOwnerStatusDto {
  const PersonalOwnerStatusDto({
    required this.ownershipMode,
    required this.ownerIdentity,
    required this.authentication,
    required this.deployment,
    required this.selectedProvider,
    required this.selectedModel,
    required this.cloudflareTransport,
    required this.generalCloudflareJob,
    required this.articleProcessing,
    required this.derivedShadowPersistence,
    required this.liveAssignment,
    required this.v10_11Executions,
    required this.finalHoldoutV2Executions,
  });

  factory PersonalOwnerStatusDto.fromJson(Object? value) {
    if (value is! Map<String, Object?>) {
      throw const FormatException('Invalid personal owner status.');
    }
    const Set<String> expectedKeys = <String>{
      'ownership_mode',
      'owner_identity',
      'authentication',
      'deployment',
      'selected_provider',
      'selected_model',
      'cloudflare_transport',
      'general_cloudflare_job',
      'article_processing',
      'derived_shadow_persistence',
      'live_assignment',
      'v10_11_executions',
      'final_holdout_v2_executions',
    };
    if (value.keys.toSet().difference(expectedKeys).isNotEmpty ||
        expectedKeys.difference(value.keys.toSet()).isNotEmpty) {
      throw const FormatException('Invalid personal owner status.');
    }
    String text(String key) {
      final Object? item = value[key];
      if (item is! String || item.isEmpty) {
        throw const FormatException('Invalid personal owner status.');
      }
      return item;
    }

    int count(String key) {
      final Object? item = value[key];
      if (item is! int || item < 0) {
        throw const FormatException('Invalid personal owner status.');
      }
      return item;
    }

    final PersonalOwnerStatusDto status = PersonalOwnerStatusDto(
      ownershipMode: text('ownership_mode'),
      ownerIdentity: text('owner_identity'),
      authentication: text('authentication'),
      deployment: text('deployment'),
      selectedProvider: text('selected_provider'),
      selectedModel: text('selected_model'),
      cloudflareTransport: text('cloudflare_transport'),
      generalCloudflareJob: text('general_cloudflare_job'),
      articleProcessing: text('article_processing'),
      derivedShadowPersistence: text('derived_shadow_persistence'),
      liveAssignment: text('live_assignment'),
      v10_11Executions: count('v10_11_executions'),
      finalHoldoutV2Executions: count('final_holdout_v2_executions'),
    );
    if (status.ownershipMode != 'personal' ||
        status.authentication != 'OWNER_BEARER_VERIFIED' ||
        status.deployment != 'LOCAL_UNASSIGNED_DEVELOPMENT' ||
        status.liveAssignment != 'UNASSIGNED' ||
        status.v10_11Executions != 0 ||
        status.finalHoldoutV2Executions != 0) {
      throw const FormatException('Invalid personal owner status.');
    }
    return status;
  }

  final String ownershipMode;
  final String ownerIdentity;
  final String authentication;
  final String deployment;
  final String selectedProvider;
  final String selectedModel;
  final String cloudflareTransport;
  final String generalCloudflareJob;
  final String articleProcessing;
  final String derivedShadowPersistence;
  final String liveAssignment;
  final int v10_11Executions;
  final int finalHoldoutV2Executions;
}

abstract interface class PersonalOwnerStatusRepository {
  Future<PersonalOwnerStatusDto> getStatus(String ownerToken);
}
