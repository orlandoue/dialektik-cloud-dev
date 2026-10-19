import 'dart:async';
import 'dart:convert';

import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/features/personal_owner/data/personal_owner_status.dart';
import 'package:http/http.dart' as http;

final class PersonalOwnerStatusClient implements PersonalOwnerStatusRepository {
  PersonalOwnerStatusClient({
    required ApiConfiguration configuration,
    http.Client? httpClient,
    this.timeout = const Duration(seconds: 10),
  }) : _configuration = configuration,
       _httpClient = httpClient ?? http.Client(),
       _ownsClient = httpClient == null {
    final Uri baseUri = configuration.baseUri;
    if (baseUri.scheme != 'http' ||
        !const <String>{
          '127.0.0.1',
          'localhost',
          '::1',
        }.contains(baseUri.host)) {
      throw ArgumentError(
        'Personal owner status requires a loopback HTTP API.',
      );
    }
  }

  final ApiConfiguration _configuration;
  final http.Client _httpClient;
  final bool _ownsClient;
  final Duration timeout;

  @override
  Future<PersonalOwnerStatusDto> getStatus(String ownerToken) async {
    if (!RegExp(r'^[A-Za-z0-9._~-]{32,2048}$').hasMatch(ownerToken)) {
      throw const PersonalOwnerStatusFailure();
    }
    try {
      final http.Response response = await _httpClient
          .get(
            _configuration.resolve('/personal/owner/status'),
            headers: <String, String>{
              'Accept': 'application/json',
              'Authorization': 'Bearer $ownerToken',
            },
          )
          .timeout(timeout);
      if (response.statusCode != 200) {
        throw const PersonalOwnerStatusFailure();
      }
      final Object? decoded = jsonDecode(response.body);
      return PersonalOwnerStatusDto.fromJson(decoded);
    } on TimeoutException {
      throw const PersonalOwnerStatusFailure();
    } on FormatException {
      throw const PersonalOwnerStatusFailure();
    } on http.ClientException {
      throw const PersonalOwnerStatusFailure();
    }
  }

  void close() {
    if (_ownsClient) _httpClient.close();
  }
}

final class PersonalOwnerStatusFailure implements Exception {
  const PersonalOwnerStatusFailure();
}
