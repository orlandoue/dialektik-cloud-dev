import 'dart:convert';

import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/features/consumer/data/public_api_client.dart';
import 'package:dialektik/features/science/data/science_models.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../arena/arena_fixtures.dart';
import 'science_fixtures.dart';

Future<void> _openPicker(WidgetTester tester) async {
  await tester.tap(
    find.descendant(
      of: find.byKey(const Key('arena-bottom-navigation')),
      matching: find.text('En desarrollo'),
    ),
  );
  await tester.pumpAndSettle();
  await tester.ensureVisible(find.text(vaccineTitle).first);
  await tester.pumpAndSettle();
  await tester.tap(find.text(vaccineTitle).first);
  await tester.pumpAndSettle();
  final Finder tab = find.byKey(
    const ValueKey<String>('arena-subtab-Comentarios'),
  );
  await tester.ensureVisible(tab);
  await tester.pumpAndSettle();
  await tester.tap(tab);
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('sci-composer-study')));
  await tester.pumpAndSettle();
}

Future<void> _search(WidgetTester tester, String text) async {
  await tester.enterText(find.byKey(const Key('sci-doi-input')), text);
  await tester.testTextInput.receiveAction(TextInputAction.search);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('C2 · a title finds the study and opens the sheet with it', (
    WidgetTester tester,
  ) async {
    final ArenaScienceCore core = ArenaScienceCore();
    await pumpArena(tester, core);
    await _openPicker(tester);
    expect(find.text('DOI, enlace o título'), findsOneWidget);
    await _search(tester, 'rubella autism');
    expect(core.science.lookups, <String>['rubella autism']);
    expect(find.text('1 coincidencia'), findsOneWidget);
    final Finder result = find.byKey(
      ValueKey<String>('sci-lookup-${hviid.doi}'),
    );
    expect(
      find.descendant(
        of: result,
        matching: find.textContaining('Annals of Internal Medicine · 2019'),
      ),
      findsOneWidget,
    );
    expect(tester.getSize(result).height, greaterThanOrEqualTo(44));
    await tester.tap(result);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('sci-comment-sheet')), findsOneWidget);
  });

  testWidgets('C2 · a link without a DOI asks for the title', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, ArenaScienceCore());
    await _openPicker(tester);
    await _search(tester, 'https://www.nature.com/articles/s41586-024-00001-x');
    expect(
      find.text('Este enlace no trae un DOI. Escribe el título del estudio.'),
      findsOneWidget,
    );
    await _search(tester, 'palabras que no coinciden');
    expect(
      find.textContaining('No encontramos coincidencias.'),
      findsOneWidget,
    );
  });

  testWidgets('C2 · a link with a DOI shows that study, marked as preprint', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, ArenaScienceCore());
    await _openPicker(tester);
    await _search(tester, 'https://doi.org/${bendavid.doi}');
    final Finder result = find.byKey(
      ValueKey<String>('sci-lookup-${bendavid.doi}'),
    );
    expect(result, findsOneWidget);
    expect(
      find.descendant(of: result, matching: find.textContaining('Preprint')),
      findsOneWidget,
    );
  });

  test('the client sends the query encoded and reads the candidates', () async {
    late Uri asked;
    final PublicApiClient api = PublicApiClient(
      configuration: ApiConfiguration.fromBaseUrl('https://core.test'),
      httpClient: MockClient((http.Request request) async {
        asked = request.url;
        return http.Response(
          jsonEncode(<String, Object?>{
            'candidates': <Object>[
              <String, Object?>{
                'doi': '10.7326/m18-2101',
                'title': 'MMR and autism',
                'authors': 'Hviid A',
                'journal': 'Annals of Internal Medicine',
                'year': 2019,
                'review': 'peer_reviewed',
              },
            ],
            'reason': null,
          }),
          200,
          headers: <String, String>{'content-type': 'application/json'},
        );
      }),
      authorizationTokenProvider: () async => 'token',
      maxAttempts: 1,
    );
    final LookupResult result = await api.lookup('MMR & autism?');
    expect(asked.path, '/v1/science/lookup');
    expect(asked.queryParameters['q'], 'MMR & autism?');
    expect(result.candidates.single.year, 2019);
    expect(result.linkWithoutDoi, isFalse);
    expect(
      LookupResult.fromJson(<String, Object?>{
        'candidates': <Object>[],
        'reason': 'no_doi_in_link',
      }).linkWithoutDoi,
      isTrue,
    );
  });
}
