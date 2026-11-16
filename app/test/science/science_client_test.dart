import 'dart:convert';

import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/features/consumer/data/public_api_client.dart';
import 'package:dialektik/features/science/data/science_models.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  PublicApiClient client(MockClient mock) => PublicApiClient(
    configuration: ApiConfiguration.fromBaseUrl('https://core.test'),
    httpClient: mock,
    authorizationTokenProvider: () async => 'token',
    maxAttempts: 1,
  );

  Future<String?> refusal(int status, String code) async {
    final PublicApiClient api = client(
      MockClient(
        (_) async => http.Response(
          jsonEncode(<String, Object>{
            'error': 'refused',
            'requestId': 'r',
            'statusCode': status,
            'code': code,
          }),
          status,
          headers: <String, String>{'content-type': 'application/json'},
        ),
      ),
    );
    try {
      await api.addStudyComment(
        '01JEVENT0000000000000000000',
        doi: '10.7326/m18-2101',
        claimQuoteId: '01JQUOTE0000000000000000000',
        relation: StudyRelation.contradicts,
        abstractFragment: 'does not increase the risk',
        body: 'Lo contradice.',
      );
    } on StudyCommentRejected catch (rejected) {
      return rejected.reason;
    }
    return null;
  }

  test('Core refusals become typed reasons', () async {
    expect(await refusal(410, 'PUBLIC_SCIENCE_RETRACTED'), 'retracted');
    expect(await refusal(409, 'PUBLIC_SCIENCE_DUPLICATE'), 'duplicate');
    expect(await refusal(422, 'PUBLIC_SCIENCE_NOT_LITERAL'), 'not_literal');
    expect(
      await refusal(403, 'PUBLIC_SCIENCE_ACCOUNT_TOO_NEW'),
      'account_too_new',
    );
  });

  test('the alias and the study fields travel as Core expects', () async {
    late Map<String, dynamic> sent;
    final PublicApiClient api = client(
      MockClient((http.Request request) async {
        sent = jsonDecode(request.body) as Map<String, dynamic>;
        expect(
          request.url.path,
          '/v1/stories/01JEVENT0000000000000000000/comments',
        );
        return http.Response(
          jsonEncode(<String, Object?>{
            'id': 'c1',
            'author': 'Ana',
            'body': 'Hola',
            'created_at': '2026-11-16T12:00:00Z',
            'parent_id': null,
            'status': 'published',
            'reactions': 0,
            'reacted': false,
            'mine': true,
            'attachment': null,
          }),
          201,
          headers: <String, String>{'content-type': 'application/json'},
        );
      }),
    );
    final StoryComment created = await api.addComment(
      '01JEVENT0000000000000000000',
      body: 'Hola',
      alias: 'Ana',
    );
    expect(sent, <String, Object>{'body': 'Hola', 'alias': 'Ana'});
    expect(created.author, 'Ana');

    final Study retracted = Study.fromJson(<String, dynamic>{
      'doi': '10.1/x',
      'title': 'T',
      'review': 'peer_reviewed',
      'retracted': true,
      'retracted_at': null,
    });
    expect(retracted.retracted, isTrue);
  });
}
