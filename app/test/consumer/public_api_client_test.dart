import 'dart:convert';

import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/features/consumer/data/public_api_client.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../support/public_api_fixtures.dart';

void main() {
  group('PublicApiClient', () {
    test('uses exact feed filters and preserves an opaque cursor', () async {
      late Uri requested;
      final PublicApiClient client = _client((http.Request request) async {
        requested = request.url;
        return _jsonResponse(<String, Object?>{
          'items': <Object?>[eventCardJson()],
          'next_cursor': 'opaque.not-decoded',
        });
      });

      final PublicPage<EventCardDto> page = await client.listFeed(
        category: 'economia',
        topic: 'tasas',
        cursor: 'opaque/input+value',
        limit: 7,
      );

      expect(requested.path, '/v1/feed');
      expect(requested.queryParameters, <String, String>{
        'category': 'economia',
        'topic': 'tasas',
        'cursor': 'opaque/input+value',
        'limit': '7',
      });
      expect(page.items.single.analysisState, AnalysisState.analysisPending);
      expect(page.items.single.positionCount, isNull);
      expect(page.nextCursor, 'opaque.not-decoded');
    });

    test('reuses typed cache after a validator-driven 304', () async {
      var calls = 0;
      final PublicApiClient client = _client((http.Request request) async {
        calls += 1;
        if (calls == 1) {
          return _jsonResponse(
            eventDetailJson(),
            headers: <String, String>{
              'etag': '"event-v1"',
              'last-modified': 'Tue, 15 Sep 2026 12:00:00 GMT',
            },
          );
        }
        expect(request.headers['if-none-match'], '"event-v1"');
        expect(request.headers['cache-control'], 'no-cache');
        return http.Response('', 304);
      });

      final EventDetailDto first = await client.getEvent(pendingEventId);
      final EventDetailDto second = await client.getEvent(
        pendingEventId,
        refresh: true,
      );

      expect(identical(first, second), isTrue);
      expect(calls, 2);
    });

    test('maps analysis unavailable and historical tombstones', () async {
      final PublicApiClient pendingClient = _client(
        (_) async => _jsonResponse(<String, Object?>{
          'statusCode': 409,
          'error': 'Conflict',
          'code': 'PUBLIC_ANALYSIS_UNAVAILABLE',
          'requestId': 'safe-id',
        }, statusCode: 409),
      );
      await expectLater(
        pendingClient.listEventPositions(pendingEventId),
        throwsA(
          isA<PublicApiFailure>().having(
            (PublicApiFailure value) => value.kind,
            'kind',
            PublicFailureKind.analysisUnavailable,
          ),
        ),
      );

      final PublicApiClient goneClient = _client(
        (_) async => _jsonResponse(<String, Object?>{
          'statusCode': 410,
          'error': 'Gone',
          'code': 'PUBLIC_GONE',
          'requestId': 'safe-id',
          'tombstone': tombstoneJson(),
        }, statusCode: 410),
      );
      try {
        await goneClient.getEvent(pendingEventId);
        fail('Expected PUBLIC_GONE.');
      } on PublicApiFailure catch (failure) {
        expect(failure.kind, PublicFailureKind.gone);
        expect(failure.tombstone?.successors.single.id, publishedEventId);
      }
    });

    test(
      'rejects internal or unknown fields instead of leaking maps',
      () async {
        final Map<String, Object?> unsafe = eventCardJson()
          ..['similarity_score'] = 0.99;
        final PublicApiClient client = _client(
          (_) async => _jsonResponse(<String, Object?>{
            'items': <Object?>[unsafe],
            'next_cursor': null,
          }),
        );

        await expectLater(
          client.listFeed(),
          throwsA(
            isA<PublicApiFailure>().having(
              (PublicApiFailure value) => value.kind,
              'kind',
              PublicFailureKind.invalidResponse,
            ),
          ),
        );
      },
    );

    test(
      'decodes the complete provenance and public analysis shapes',
      () async {
        final List<Object?> responses = <Object?>[
          <Object?>[positionListJson()],
          <Object?>[assertionJson()],
          <Object?>[relationshipJson()],
          positionDetailJson(),
          sourceJson(),
          <String, Object?>{
            'items': <Object?>[contradictionJson()],
            'next_cursor': null,
          },
        ];
        var index = 0;
        final PublicApiClient client = _client(
          (_) async => _jsonResponse(responses[index++]),
        );

        expect((await client.listEventPositions(publishedEventId)).length, 1);
        final PublicAssertionDto assertion =
            (await client.listUnclusteredAssertions(pendingEventId)).single;
        expect(assertion.span.article.source.name, 'Agencia Uno');
        expect(assertion.span.highlightRanges.single.assertionId, assertion.id);
        expect(
          (await client.listEventRelationships(publishedEventId)).single.type,
          RelationshipType.r01a,
        );
        expect(
          (await client.getPosition(positionAId)).assertions,
          hasLength(1),
        );
        expect((await client.getSource(sourceAId)).sourceType, 'news_agency');
        expect(
          (await client.listContradictions()).items.single.needsReview,
          isTrue,
        );
      },
    );

    test('cooperatively cancels an obsolete response', () async {
      final PublicRequestToken token = PublicRequestToken()..cancel();
      final PublicApiClient client = _client(
        (_) async => throw StateError('transport should not start'),
      );

      await expectLater(
        client.listFeed(requestToken: token),
        throwsA(
          isA<PublicApiFailure>().having(
            (PublicApiFailure value) => value.kind,
            'kind',
            PublicFailureKind.cancelled,
          ),
        ),
      );
    });

    test(
      'sends only the supplied access token and retries one transient response',
      () async {
        var calls = 0;
        late String authorization;
        final PublicApiClient client = PublicApiClient(
          configuration: ApiConfiguration.fromBaseUrl(
            'https://api.example.test',
          ),
          httpClient: MockClient((http.Request request) async {
            calls += 1;
            authorization = request.headers['authorization'] ?? '';
            if (calls == 1) {
              return _jsonResponse(<String, Object?>{}, statusCode: 503);
            }
            return _jsonResponse(<String, Object?>{
              'items': <Object?>[eventCardJson()],
              'next_cursor': null,
            });
          }),
          authorizationTokenProvider: () async => 'signed-user-token',
          maxAttempts: 2,
          retryDelay: Duration.zero,
        );

        final PublicPage<EventCardDto> page = await client.listFeed();

        expect(page.items, hasLength(1));
        expect(calls, 2);
        expect(authorization, 'Bearer signed-user-token');
      },
    );

    test('does not retry 401 and notifies the private-beta gate', () async {
      var calls = 0;
      var rejected = 0;
      final PublicApiClient client = PublicApiClient(
        configuration: ApiConfiguration.fromBaseUrl('https://api.example.test'),
        httpClient: MockClient((_) async {
          calls += 1;
          return _jsonResponse(<String, Object?>{}, statusCode: 401);
        }),
        authorizationTokenProvider: () async => 'expired-token',
        onAuthorizationRejected: () => rejected += 1,
        retryDelay: Duration.zero,
      );

      await expectLater(
        client.listFeed(),
        throwsA(
          isA<PublicApiFailure>().having(
            (PublicApiFailure failure) => failure.kind,
            'kind',
            PublicFailureKind.unauthorized,
          ),
        ),
      );
      expect(calls, 1);
      expect(rejected, 1);
    });

    test(
      'distinguishes transport failure from an authorized empty feed',
      () async {
        var rejected = 0;
        final PublicApiClient offlineClient = PublicApiClient(
          configuration: ApiConfiguration.fromBaseUrl(
            'https://api.example.test',
          ),
          httpClient: MockClient(
            (_) async => throw http.ClientException('offline'),
          ),
          authorizationTokenProvider: () async => 'signed-user-token',
          onAuthorizationRejected: () => rejected += 1,
        );
        await expectLater(
          offlineClient.listFeed(),
          throwsA(
            isA<PublicApiFailure>().having(
              (PublicApiFailure failure) => failure.kind,
              'kind',
              PublicFailureKind.network,
            ),
          ),
        );
        expect(rejected, 0);

        final PublicApiClient emptyClient = _client(
          (_) async => _jsonResponse(<String, Object?>{
            'items': <Object?>[],
            'next_cursor': null,
          }),
        );
        final PublicPage<EventCardDto> emptyPage = await emptyClient.listFeed();
        expect(emptyPage.items, isEmpty);
        expect(rejected, 0);
      },
    );
  });

  group('ApiConfiguration', () {
    test('requires an absolute HTTP endpoint', () {
      expect(
        () => ApiConfiguration.fromBaseUrl('/relative'),
        throwsFormatException,
      );
      expect(
        () => ApiConfiguration.fromBaseUrl('file:///tmp/api'),
        throwsFormatException,
      );
      expect(
        ApiConfiguration.fromBaseUrl('https://api.example.test/').baseUri,
        Uri.parse('https://api.example.test'),
      );
    });

    test('requires HTTPS for production API endpoints', () {
      expect(
        () => ApiConfiguration.forBaseUrl(
          'http://api.example.test',
          AppEnvironment.production,
        ),
        throwsStateError,
      );
      expect(
        ApiConfiguration.forBaseUrl(
          'https://api.example.test',
          AppEnvironment.production,
        ).baseUri.scheme,
        'https',
      );
    });

    test('requires an explicit API endpoint in production', () {
      expect(
        () => ApiConfiguration.forEnvironment(AppEnvironment.production),
        throwsStateError,
      );
    });
  });
}

PublicApiClient _client(MockClientHandler handler) => PublicApiClient(
  configuration: ApiConfiguration.fromBaseUrl('https://api.example.test'),
  httpClient: MockClient(handler),
);

http.Response _jsonResponse(
  Object? body, {
  int statusCode = 200,
  Map<String, String> headers = const <String, String>{},
}) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  statusCode,
  headers: <String, String>{'content-type': 'application/json', ...headers},
);
