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

  Future<StudyCommentRejected?> rejection(
    int status,
    String code, {
    String? existing,
  }) async {
    final PublicApiClient api = client(
      MockClient(
        (_) async => http.Response(
          jsonEncode(<String, Object>{
            'error': 'refused',
            'requestId': 'r',
            'statusCode': status,
            'code': code,
            'existing_comment_id': ?existing,
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
      return rejected;
    }
    return null;
  }

  test(
    'a published duplicate carries its id; one in review does not',
    () async {
      const String id = '5f0c2b1e-7a3d-4c8e-9b21-0d6e4f3a2c10';
      final StudyCommentRejected? published = await rejection(
        409,
        'PUBLIC_SCIENCE_DUPLICATE',
        existing: id,
      );
      expect(published?.reason, 'duplicate');
      expect(published?.existingCommentId, id);
      final StudyCommentRejected? inReview = await rejection(
        409,
        'PUBLIC_SCIENCE_DUPLICATE_IN_REVIEW',
      );
      expect(inReview?.reason, 'duplicate_in_review');
      expect(inReview?.existingCommentId, isNull);
      // Anything but a UUID is dropped.
      final StudyCommentRejected? odd = await rejection(
        409,
        'PUBLIC_SCIENCE_DUPLICATE',
        existing: '../admin',
      );
      expect(odd?.existingCommentId, isNull);
    },
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

  test('the author name is left to Core, which reads the profile', () async {
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
    );
    expect(sent, <String, Object>{'body': 'Hola'});
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
