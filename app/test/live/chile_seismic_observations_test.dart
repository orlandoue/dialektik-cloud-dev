import 'package:dialektik/features/live/data/chile_seismic_observations.dart';
import 'package:dialektik/features/live/presentation/chile_seismic_observations_panel.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, Object?> event(String id) => <String, Object?>{
  'observation_id': id,
  'occurrence_key': 'usgs:earthquake:$id',
  'publisher': 'U.S. Geological Survey',
  'publisher_market': 'US',
  'location_context': 'CHILE_USGS_LABEL_AND_BOUNDS',
  'description': '50 km W of Valparaíso, Chile',
  'magnitude': 4.2,
  'longitude': -72.17,
  'latitude': -33.06,
  'depth_km': 19,
  'occurred_at': '2026-10-26T19:00:00.000Z',
  'revised_at': '2026-10-26T19:05:00.000Z',
  'source_status': 'reviewed',
  'canonical_url': 'https://earthquake.usgs.gov/earthquakes/eventpage/$id',
  'independent_publisher_count': 1,
  'contradiction_count': 0,
};
Map<String, Object?> payload(List<Map<String, Object?>> items) =>
    <String, Object?>{
  'mode': 'OFFICIAL_LIVE_SEISMIC_OBSERVATIONS',
  'source': 'U.S. Geological Survey',
  'rights_url':
      'https://www.usgs.gov/information-policies-and-instructions/acknowledging-or-crediting-usgs',
  'source_feed_url':
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson',
  'market_country': 'CL',
  'category': 'OFFICIAL_OBSERVATIONS_NOT_NEWS',
  'inspected_at': '2026-10-26T21:00:00.000Z',
  'persisted': false,
  'automatic_same_id_grouping': true,
  'cross_publisher_grouping': false,
  'contradictions_generated': false,
  'is_emergency_alert': false,
  'items': items,
};
final class FakeSeismicRepository implements SeismicObservationRepository {
  FakeSeismicRepository(this.data);
  final ChileSeismicObservations data;
  @override
  Future<ChileSeismicObservations> loadChileSeismicObservations({
    bool refresh = false,
  }) async => data;
}
void main() {
  test('official observations retain original identity and are not press stories', () {
    final ChileSeismicObservations data =
        ChileSeismicObservations.fromJson(payload(<Map<String, Object?>>[
      event('us6000u4x2'),
    ]));
    expect(data.items, hasLength(1));
    expect(data.items.single.occurrenceKey,
        'usgs:earthquake:us6000u4x2');
    expect(data.items.single.canonicalUrl.host, 'earthquake.usgs.gov');
    expect(data.items.single.magnitude, 4.2);
  });
  test('cannot spoof source, contradict claims or duplicate event identities', () {
    final Map<String, Object?> spoof =
        payload(<Map<String, Object?>>[event('us6000u4x2')]);
    spoof['contradictions_generated'] = true;
    expect(() => ChileSeismicObservations.fromJson(spoof),
        throwsFormatException);
    final Map<String, Object?> duplicate =
        payload(<Map<String, Object?>>[
      event('us6000u4x2'), event('us6000u4x2'),
    ]);
    expect(() => ChileSeismicObservations.fromJson(duplicate),
        throwsFormatException);
    final Map<String, Object?> poisoned =
        payload(<Map<String, Object?>>[event('us6000u4x2')]);
    final Map<String, Object?> poisonedItem =
        (poisoned['items'] as List<Object?>).first! as Map<String, Object?>;
    poisonedItem['canonical_url'] = 'https://evil.example/story';
    expect(() => ChileSeismicObservations.fromJson(poisoned),
        throwsFormatException);
  });
  testWidgets('Chile panel shows real-source status and external links', (tester) async {
    final data=ChileSeismicObservations.fromJson(
      payload(<Map<String, Object?>>[event('us6000u4x2')]));
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: ChileSeismicObservationsPanel(
            repository: FakeSeismicRepository(data),
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Observaciones sísmicas · Chile'),findsOneWidget);
    expect(find.textContaining('Valparaíso, Chile'),findsOneWidget);
    expect(find.text('Ver observación original'),findsOneWidget);
    expect(find.textContaining('No son artículos de prensa'),
        findsOneWidget);
  });
}
