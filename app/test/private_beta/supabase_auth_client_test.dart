import 'dart:convert';

import 'package:dialektik/features/private_beta/data/supabase_auth_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test(
    'password sign-in uses the public key and retains session only in memory',
    () async {
      late http.Request request;
      final SupabaseAuthClient client = SupabaseAuthClient(
        supabaseUrl: 'https://project.supabase.co',
        publishableKey: 'sb_publishable_public_test_key',
        httpClient: MockClient((http.Request value) async {
          request = value;
          return _sessionResponse('access-one', 'refresh-one', 3600);
        }),
        clock: () => DateTime.utc(2026, 10, 13),
      );

      await client.signInWithPassword(
        email: 'tester@example.test',
        password: 'temporary-test-password',
      );

      expect(request.url.path, '/auth/v1/token');
      expect(request.url.queryParameters['grant_type'], 'password');
      expect(request.headers['apikey'], 'sb_publishable_public_test_key');
      expect(jsonDecode(request.body), <String, String>{
        'email': 'tester@example.test',
        'password': 'temporary-test-password',
      });
      expect(await client.currentAccessToken(), 'access-one');
      await client.signOut();
      expect(await client.currentAccessToken(), isNull);
    },
  );

  test('expired access session refreshes over HTTPS', () async {
    var now = DateTime.utc(2026, 10, 13);
    var calls = 0;
    final SupabaseAuthClient client = SupabaseAuthClient(
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_public_test_key',
      httpClient: MockClient((http.Request request) async {
        calls += 1;
        if (calls == 1) {
          return _sessionResponse('short-token', 'refresh-one', 10);
        }
        expect(request.url.queryParameters['grant_type'], 'refresh_token');
        expect(jsonDecode(request.body), <String, String>{
          'refresh_token': 'refresh-one',
        });
        return _sessionResponse('refreshed-token', 'refresh-two', 3600);
      }),
      clock: () => now,
    );

    await client.signInWithPassword(
      email: 'tester@example.test',
      password: 'password',
    );
    now = now.add(const Duration(seconds: 20));
    expect(await client.currentAccessToken(), 'refreshed-token');
    expect(calls, 2);
  });

  test('rejected refresh clears the session and fails closed', () async {
    var now = DateTime.utc(2026, 10, 13);
    var calls = 0;
    final SupabaseAuthClient client = SupabaseAuthClient(
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_public_test_key',
      httpClient: MockClient((http.Request request) async {
        calls += 1;
        if (calls == 1) {
          return _sessionResponse('short-token', 'refresh-one', 10);
        }
        expect(request.url.queryParameters['grant_type'], 'refresh_token');
        return http.Response('{"msg":"refresh rejected"}', 401);
      }),
      clock: () => now,
    );

    await client.signInWithPassword(
      email: 'tester@example.test',
      password: 'password',
    );
    now = now.add(const Duration(seconds: 20));
    await expectLater(
      client.currentAccessToken(),
      throwsA(isA<SupabaseAuthFailure>()),
    );
    expect(await client.currentAccessToken(), isNull);
    expect(calls, 2);
  });

  test(
    'transient refresh transport failure preserves session for retry',
    () async {
      var now = DateTime.utc(2026, 10, 13);
      var calls = 0;
      final SupabaseAuthClient client = SupabaseAuthClient(
        supabaseUrl: 'https://project.supabase.co',
        publishableKey: 'sb_publishable_public_test_key',
        httpClient: MockClient((http.Request request) async {
          calls += 1;
          if (calls == 1) {
            return _sessionResponse('short-token', 'refresh-one', 10);
          }
          if (calls == 2) throw http.ClientException('offline');
          return _sessionResponse('refreshed-token', 'refresh-two', 3600);
        }),
        clock: () => now,
      );

      await client.signInWithPassword(
        email: 'tester@example.test',
        password: 'password',
      );
      now = now.add(const Duration(seconds: 20));
      await expectLater(
        client.currentAccessToken(),
        throwsA(isA<SupabaseAuthNetworkFailure>()),
      );
      expect(await client.currentAccessToken(), 'refreshed-token');
      expect(calls, 3);
    },
  );

  test('Auth error response does not expose provider details', () async {
    final SupabaseAuthClient client = SupabaseAuthClient(
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_public_test_key',
      httpClient: MockClient(
        (_) async =>
            http.Response('{"message":"sensitive provider detail"}', 400),
      ),
    );
    await expectLater(
      client.signInWithPassword(
        email: 'tester@example.test',
        password: 'wrong',
      ),
      throwsA(isA<SupabaseAuthFailure>()),
    );
  });
}

http.Response _sessionResponse(String access, String refresh, int seconds) =>
    http.Response(
      jsonEncode(<String, Object?>{
        'access_token': access,
        'refresh_token': refresh,
        'expires_in': seconds,
      }),
      200,
      headers: const <String, String>{'content-type': 'application/json'},
    );
