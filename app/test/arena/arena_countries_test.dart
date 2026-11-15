import 'dart:convert';

import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/presentation/arena_shell.dart';
import 'package:dialektik/features/consumer/data/public_api_client.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/publisher_market_selection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'arena_fixtures.dart';

/// Counts the loads the store makes, to see a country switch reload it.
class _CountingCore extends ArenaFullCore {
  int feedLoads = 0;

  @override
  Future<PublicPage<EventCardDto>> listFeed({
    String? category,
    String? topic,
    String? cursor,
    int limit = 20,
    bool refresh = false,
    dynamic requestToken,
  }) {
    feedLoads += 1;
    return super.listFeed(
      category: category,
      topic: topic,
      cursor: cursor,
      limit: limit,
      refresh: refresh,
      requestToken: requestToken,
    );
  }
}

void main() {
  test(
    'Core receives ?country for ES, AR and US; Chile keeps its request',
    () async {
      final List<Uri> requests = <Uri>[];
      final PublisherMarketSelection market = PublisherMarketSelection();
      final PublicApiClient client = PublicApiClient(
        configuration: ApiConfiguration.fromBaseUrl(
          'https://core.example.test',
        ),
        httpClient: MockClient((http.Request request) async {
          requests.add(request.url);
          return http.Response(
            jsonEncode(<String, Object?>{
              'items': <Object?>[],
              'next_cursor': null,
            }),
            200,
            headers: const <String, String>{'content-type': 'application/json'},
          );
        }),
        publisherMarketSelection: market,
      );
      await client.listFeed(personalized: false);
      await client.listContradictions(personalized: false);
      expect(
        requests.map((Uri uri) => uri.queryParameters['country']),
        <String?>[null, null],
      );

      for (final String code in <String>['ES', 'AR', 'US']) {
        market.select(code);
        await client.listFeed(personalized: false);
        await client.listContradictions(personalized: false);
        expect(
          requests.reversed
              .take(2)
              .map((Uri uri) => uri.queryParameters['country']),
          <String>[code, code],
        );
      }

      // Markets outside the verified catalog answer empty, without a request.
      market.select('PE');
      final int before = requests.length;
      expect((await client.listFeed(personalized: false)).items, isEmpty);
      expect(requests.length, before);
      client.close();
      market.dispose();
    },
  );

  test('switching country reloads every tab from that country', () async {
    final _CountingCore core = _CountingCore();
    final PublisherMarketSelection market = PublisherMarketSelection();
    final ArenaStore store = ArenaStore(
      consumer: core,
      live: core,
      market: market,
    );
    await store.load();
    expect(store.country, 'CL');
    expect(core.feedLoads, greaterThan(0));
    final int loads = core.feedLoads;

    market.select('ES');
    expect(store.country, 'ES');
    expect(
      store.loaded,
      isFalse,
      reason: 'old country content is cleared at once',
    );
    await pumpEventQueue();
    await store.load();
    expect(core.feedLoads, greaterThan(loads));
    expect(store.loaded, isTrue);
    store.dispose();
    market.dispose();
  });

  test(
    'a press feed and a YouTube channel of one media group are one medium',
    () {
      final ArenaFullCore core = ArenaFullCore();
      final ArenaStore store = ArenaStore(consumer: core, live: core)
        ..sources = const <LiveSourceDto>[
          LiveSourceDto(
            id: '1',
            name: 'La Nación',
            sourceType: 'daily_newspaper',
            canonicalDomain: 'lanacion.com.ar',
            countryCode: 'AR',
            mediaGroupSlug: 'ar-la-nacion',
          ),
          LiveSourceDto(
            id: '2',
            name: 'La Nación (YouTube)',
            sourceType: 'daily_newspaper',
            canonicalDomain: 'youtube.com',
            countryCode: 'AR',
            mediaGroupSlug: 'ar-la-nacion',
          ),
          LiveSourceDto(
            id: '3',
            name: 'Clarín (YouTube)',
            sourceType: 'daily_newspaper',
            canonicalDomain: 'youtube.com',
            countryCode: 'AR',
            mediaGroupSlug: 'ar-clarin',
          ),
        ];
      final List<List<LiveSourceDto>> brands = store.brands(store.sources);
      expect(brands.map((List<LiveSourceDto> b) => b.length), <int>[2, 1]);
      expect(
        store.brandOf(store.sources[1]).map((LiveSourceDto s) => s.id),
        <String>['1', '2'],
      );
      store.dispose();
    },
  );

  for (final double scale in <double>[1, 1.45]) {
    testWidgets(
      'the header selector offers the four countries · escala $scale',
      (WidgetTester tester) async {
        final ArenaFullCore core = ArenaFullCore();
        final PublisherMarketSelection market = PublisherMarketSelection();
        final ArenaStore store = ArenaStore(
          consumer: core,
          live: core,
          market: market,
        );
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.pumpWidget(
          MaterialApp(
            builder: (BuildContext context, Widget? child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: TextScaler.linear(scale)),
              child: child!,
            ),
            home: ArenaShell(
              consumer: core,
              live: core,
              store: store,
              offerWelcomeRadar: false,
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('🇨🇱 Chile'), findsOneWidget);

        await tester.tap(find.byKey(const Key('arena-country')));
        await tester.pumpAndSettle();
        for (final String code in <String>['CL', 'ES', 'AR', 'US']) {
          expect(
            find.byKey(ValueKey<String>('arena-country-option-$code')),
            findsOneWidget,
          );
        }
        await tester.tap(
          find.byKey(const ValueKey<String>('arena-country-option-ES')),
        );
        await tester.pumpAndSettle();
        expect(market.value, 'ES');
        expect(find.text('🇪🇸 España'), findsOneWidget);
        expect(tester.takeException(), isNull);
        market.dispose();
      },
    );
  }
}
