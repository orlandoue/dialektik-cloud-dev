import 'package:dialektik/features/consumer/data/curated_event_preview.dart';
import 'package:dialektik/features/consumer/presentation/widgets/curated_event_preview_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Map<String, Object?> sample() {
    final List<(String, String, String)>
    publishers = <(String, String, String)>[
      (
        'La Tercera',
        'INDEPENDENT_NEWSROOM',
        'DMC confirma tornado en Estación Central: vientos alcanzaron los 137 km/h',
      ),
      (
        'BioBioChile',
        'INDEPENDENT_NEWSROOM',
        'DMC confirma que fenómeno registrado en Estación Central sería un tornado',
      ),
      (
        'Cooperativa',
        'INDEPENDENT_NEWSROOM',
        '[VIDEO] Meteorología confirmó "evento tornádico" en Estación Central',
      ),
      (
        'T13',
        'INDEPENDENT_NEWSROOM',
        'Intentan rescatar a familia atrapada tras inédito tornado en Estación Central: árbol cayó sobre su casa',
      ),
      (
        'Gobierno de Santiago',
        'PRIMARY_GOVERNMENT_SOURCE',
        'Gobernador de Santiago y alcalde de Estación Central coordinan catastro de viviendas afectadas por tornado',
      ),
    ];
    return <String, Object?>{
      'mode': 'CURATED_REAL_EVENT_EVIDENCE_PREVIEW',
      'id': 'editorial-preview:cl:estacion-central:2026-10-13:ef0',
      'persisted': false,
      'semantic_engine_executed': false,
      'grouping_method': 'HUMAN_REVIEWED_FIXED_OCCURRENCE',
      'occurred_on': '2026-10-13',
      'category': 'País',
      'verified_on': '2026-10-19',
      'title': 'Tornado EF-0 en Estación Central, Santiago',
      'location': 'Estación Central, Región Metropolitana, Chile',
      'editorial_evidence': 'Mismo hecho descrito por fuentes independientes.',
      'warning': 'No es un Event almacenado.',
      'source_count': 5,
      'independent_newsroom_count': 4,
      'publications': <Object?>[
        for (final (String publisher, String kind, String headline)
            in publishers)
          <String, Object?>{
            'publisher': publisher,
            'publisher_kind': kind,
            'headline': headline,
            'canonical_url': CuratedEventPublication.approvedUrls[publisher],
            'published_on':
                publisher == 'Gobierno de Santiago' || publisher == 'T13'
                ? '2026-10-14'
                : '2026-10-13',
          },
      ],
    };
  }

  test('accepts a curated cross-publisher occurrence without persistence', () {
    final CuratedEventPreview preview = CuratedEventPreview.fromJson(sample());
    expect(preview.publications, hasLength(5));
    expect(preview.location, contains('Estación Central'));
  });

  test('rejects event impersonation as a persisted semantic outcome', () {
    final Map<String, Object?> forged = sample()
      ..['semantic_engine_executed'] = true;
    expect(() => CuratedEventPreview.fromJson(forged), throwsFormatException);
    final Map<String, Object?> forged2 = sample()..['persisted'] = true;
    expect(() => CuratedEventPreview.fromJson(forged2), throwsFormatException);
  });

  test('rejects unrelated Mulchén tornado and duplicated publishers', () {
    final Map<String, Object?> forged = sample();
    final List<Object?> list = forged['publications']! as List<Object?>;
    (list.first! as Map<String, Object?>)['canonical_url'] =
        'https://www.biobiochile.cl/noticias/nacional/region-del-bio-bio/2026/10/03/confirman-que-fenomeno-que-afecto-a-sector-de-mulchen-fue-un-tornado-alcanzo-hasta-los-137-km-h.shtml';
    expect(() => CuratedEventPreview.fromJson(forged), throwsFormatException);
    final Map<String, Object?> dup = sample();
    final List<Object?> dupList = dup['publications']! as List<Object?>;
    dupList[1] = dupList[0];
    expect(() => CuratedEventPreview.fromJson(dup), throwsFormatException);
  });

  testWidgets(
    'clearly distinguishes curated evidence from the live event feed',
    (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: CuratedEventPreviewCard(
                future: Future<CuratedEventPreview>.value(
                  CuratedEventPreview.fromJson(sample()),
                ),
                onRetry: () {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Agrupación editorial piloto · País'), findsOneWidget);
      expect(find.textContaining('4 medios'), findsOneWidget);
      expect(find.text('Ver fuentes y evidencia'), findsOneWidget);
      expect(find.textContaining('No es un Event almacenado'), findsNothing);
      await tester.tap(find.text('Ver fuentes y evidencia'));
      await tester.pumpAndSettle();
      expect(find.textContaining('No es un Event almacenado'), findsWidgets);
      expect(
        find.byKey(const Key('chile-preview-evidence-expand')),
        findsOneWidget,
      );
    },
  );
  testWidgets('editorial source counts and manual review are visible without opening details', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: CuratedEventPreviewCard(
              future: Future<CuratedEventPreview>.value(
                CuratedEventPreview.fromJson(sample()),
              ),
              onRetry: () {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Selección editorial · no es agrupación automática'), findsOneWidget);
    expect(find.text('5 publicaciones'), findsOneWidget);
    expect(find.text('4 medios'), findsOneWidget);
    expect(find.text('1 fuente oficial'), findsOneWidget);
    expect(find.textContaining('motor de agrupación automática aún no'), findsOneWidget);
    expect(find.byKey(const Key('chile-preview-evidence-expand')), findsOneWidget);
  });

  testWidgets('editorial preview is usable on a narrow Android screen', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 690));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: CuratedEventPreviewCard(
              future: Future<CuratedEventPreview>.value(
                CuratedEventPreview.fromJson(sample()),
              ),
              onRetry: () {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('4 medios'), findsOneWidget);
    await tester.tap(find.text('Ver fuentes y evidencia'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

}
