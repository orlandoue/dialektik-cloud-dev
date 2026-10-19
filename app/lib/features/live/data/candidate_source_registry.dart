import 'dart:collection';
import 'dart:convert';

import 'package:flutter/services.dart';

/// An inactive source candidate from the audited 50-publisher workbook.
/// This catalogue is descriptive only; it can never enable acquisition.
final class CandidateSourceInfo {
  const CandidateSourceInfo({
    required this.id,
    required this.name,
    required this.domain,
    required this.region,
    required this.category,
    required this.connectorCandidates,
    required this.technicalState,
    required this.rightsState,
    required this.operationalState,
    required this.currentTechnicalState,
    required this.currentRightsReviewState,
    required this.currentRightsSummary,
    required this.currentRightsOperations,
    required this.acquisitionAuthorizationState,
    this.endpointCandidate,
  });

  factory CandidateSourceInfo.fromJson(Object? value) {
    final Map<String, Object?> row = _object(value);
    final Map<String, Object?> identity = _object(row['identity']);
    final Map<String, Object?> discovery = _object(row['discovery']);
    final Map<String, Object?> rights = _object(row['rights']);
    final Map<String, Object?> operations = _object(rights['operations']);
    final Map<String, Object?> operational = _object(row['operational']);
    final Map<String, Object?> workbook = _object(row['sourceWorkbookRow']);
    final Map<String, Object?> assessment = _object(row['currentAssessment']);
    final Map<String, Object?> assessmentTechnical = _object(
      assessment['technical'],
    );
    final Map<String, Object?> assessmentRights = _object(assessment['rights']);
    final Map<String, Object?> assessmentOperations = _object(
      assessmentRights['operations'],
    );
    final Map<String, Object?> assessmentOperational = _object(
      assessment['operational'],
    );
    final List<String> connectors = _stringList(
      discovery['connectorCandidates'],
    );

    if (row['candidateId'] is! String ||
        (row['candidateId'] as String).isEmpty ||
        workbook['candidate_status'] != 'INACTIVE_CANDIDATE' ||
        workbook['rights_gate'] != 'DENY_NOT_CREDITED' ||
        workbook['acquisition_enabled'] != 'false' ||
        operational['acquisitionEnabled'] != false ||
        assessmentOperational['acquisitionEnabled'] != false ||
        assessmentOperational['authorizationStatus'] != 'NOT_AUTHORIZED' ||
        operations.isEmpty ||
        operations.values.any((Object? status) => status != 'NOT_CREDITED')) {
      throw const FormatException(
        'Candidate registry contains an enabled source.',
      );
    }
    const List<String> assessmentOperationKeys = <String>[
      'automatedConsultation',
      'metadataPersistence',
      'headlineExcerptDisplay',
      'automatedProcessing',
      'localSemanticInference',
      'externalAiProcessing',
      'privateAppDisplay',
      'futureCommercialUse',
    ];
    if (assessmentOperations.length != assessmentOperationKeys.length ||
        assessmentOperationKeys.any(
          (String key) => assessmentOperations[key] is! String,
        )) {
      throw const FormatException(
        'Candidate rights assessment is incomplete or invalid.',
      );
    }

    return CandidateSourceInfo(
      id: row['candidateId'] as String,
      name: _requiredString(identity, 'publisherName'),
      domain: _requiredString(identity, 'canonicalDomain'),
      region: _requiredString(identity, 'region'),
      category: _requiredString(identity, 'editorialCategory'),
      connectorCandidates: List<String>.unmodifiable(connectors),
      technicalState: _requiredString(
        discovery,
        'sourceWorkbookTechnicalState',
      ),
      rightsState: _requiredString(rights, 'sourceWorkbookStatement'),
      operationalState: _requiredString(operational, 'sourceSheetState'),
      currentTechnicalState: _requiredString(assessmentTechnical, 'status'),
      currentRightsReviewState: _requiredString(
        assessmentRights,
        'reviewStatus',
      ),
      currentRightsSummary: _requiredString(assessmentRights, 'summary'),
      currentRightsOperations: Map<String, String>.unmodifiable(
        assessmentOperations.map(
          (String key, Object? value) =>
              MapEntry<String, String>(key, value! as String),
        ),
      ),
      acquisitionAuthorizationState: _requiredString(
        assessmentOperational,
        'authorizationStatus',
      ),
      endpointCandidate: _optionalString(discovery, 'endpointCandidate'),
    );
  }

  final String id;
  final String name;
  final String domain;
  final String region;
  final String category;
  final List<String> connectorCandidates;
  final String technicalState;
  final String rightsState;
  final String operationalState;
  final String currentTechnicalState;
  final String currentRightsReviewState;
  final String currentRightsSummary;
  final Map<String, String> currentRightsOperations;
  final String acquisitionAuthorizationState;
  final String? endpointCandidate;
}

abstract final class CandidateSourceRegistry {
  static const String assetPath =
      'assets/source-universe/candidate-registry.v1.json';

  static List<CandidateSourceInfo>? _rootBundleValue;
  static Future<List<CandidateSourceInfo>>? _rootBundleLoad;

  /// Shares the immutable root asset load across route instances.
  ///
  /// Explicit bundles stay isolated so tests can supply their own assets.
  static Future<List<CandidateSourceInfo>> load({AssetBundle? bundle}) {
    if (bundle != null) return _load(bundle);
    final List<CandidateSourceInfo>? cachedValue = _rootBundleValue;
    if (cachedValue != null) {
      return Future<List<CandidateSourceInfo>>.value(cachedValue);
    }
    final Future<List<CandidateSourceInfo>>? pending = _rootBundleLoad;
    if (pending != null) return pending;
    final Future<List<CandidateSourceInfo>> pendingLoad = _loadDefaultBundle();
    _rootBundleLoad = pendingLoad;
    return pendingLoad;
  }

  static Future<List<CandidateSourceInfo>> _loadDefaultBundle() async {
    try {
      final List<CandidateSourceInfo> loaded = await _load(rootBundle);
      _rootBundleValue = loaded;
      return loaded;
    } finally {
      _rootBundleLoad = null;
    }
  }

  static Future<List<CandidateSourceInfo>> _load(AssetBundle bundle) async {
    final Object? decoded = jsonDecode(await bundle.loadString(assetPath));
    final Map<String, Object?> registry = _object(decoded);
    final Object? rawCandidates = registry['candidates'];
    if (registry['schemaVersion'] != 1 ||
        registry['candidateCount'] != 50 ||
        registry['distinctDomainCount'] != 50 ||
        rawCandidates is! List<Object?> ||
        rawCandidates.length != 50) {
      throw const FormatException('Candidate registry is incomplete.');
    }
    final List<CandidateSourceInfo> candidates = rawCandidates
        .map(CandidateSourceInfo.fromJson)
        .toList(growable: false);
    if (candidates
            .map((CandidateSourceInfo item) => item.domain)
            .toSet()
            .length !=
        50) {
      throw const FormatException('Candidate registry domains are not unique.');
    }
    return UnmodifiableListView<CandidateSourceInfo>(candidates);
  }
}

Map<String, Object?> _object(Object? value) {
  if (value is Map<String, Object?>) return value;
  throw const FormatException('Candidate registry object is invalid.');
}

String _requiredString(Map<String, Object?> value, String key) {
  final Object? field = value[key];
  if (field is String && field.trim().isNotEmpty) return field;
  throw FormatException('Candidate registry field $key is invalid.');
}

String? _optionalString(Map<String, Object?> value, String key) {
  final Object? field = value[key];
  if (field == null) return null;
  if (field is String && field.trim().isNotEmpty) return field;
  throw FormatException('Candidate registry field $key is invalid.');
}

List<String> _stringList(Object? value) {
  if (value is! List<Object?> || value.any((Object? item) => item is! String)) {
    throw const FormatException('Candidate registry connectors are invalid.');
  }
  return value.cast<String>();
}
