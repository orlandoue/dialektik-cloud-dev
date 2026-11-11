import 'dart:convert';

import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/features/arena/presentation/arena_shell.dart';
import 'package:dialektik/features/consumer/data/public_api_client.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/social/data/arena_social_repository.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../support/public_api_fixtures.dart';
import 'arena_fixtures.dart';

void main() {
  group('cliente de Core', () {
    PublicApiClient client(MockClient mock) => PublicApiClient(
      configuration: ApiConfiguration.fromBaseUrl('https://core.test'),
      httpClient: mock,
      authorizationTokenProvider: () async => 'token',
      maxAttempts: 1,
    );
    http.Response json(Object? body, [int status = 200]) => http.Response(
      jsonEncode(body),
      status,
      headers: const <String, String>{'content-type': 'application/json'},
    );

    test('lee y envía el voto por postura con la sesión', () async {
      final List<http.Request> requests = <http.Request>[];
      final PublicApiClient api = client(
        MockClient((http.Request request) async {
          requests.add(request);
          return json(<String, Object?>{
            'total': 3,
            'mine': positionAId,
            'positions': <Object?>[
              <String, Object?>{'position_id': positionAId, 'votes': 2},
              <String, Object?>{'position_id': positionBId, 'votes': 1},
            ],
          });
        }),
      );
      final PositionVotes read = await api.positionVotes(duelEventId);
      expect(read.votesFor(positionAId), 2);
      expect(read.shareOf(positionBId), closeTo(1 / 3, 1e-9));
      expect(read.mine, positionAId);
      expect(requests.single.url.path, '/v1/social/position-votes');
      expect(requests.single.url.queryParameters['event_id'], duelEventId);

      await api.votePosition(duelEventId, null);
      expect(requests.last.method, 'POST');
      expect(requests.last.headers['authorization'], 'Bearer token');
      expect(jsonDecode(requests.last.body), <String, Object?>{
        'event_id': duelEventId,
        'position_id': null,
      });
    });

    test('publica en un canal y vota una entrada', () async {
      final List<http.Request> requests = <http.Request>[];
      final PublicApiClient api = client(
        MockClient((http.Request request) async {
          requests.add(request);
          return json(<String, Object?>{
            'entries': <Object?>[
              <String, Object?>{
                'id': 'e1',
                'channel': 'nota',
                'author': 'Lector-AB12',
                'body': 'Contexto',
                'article_id': null,
                'url': 'https://example.cl/doc.pdf',
                'created_at': '2026-11-10T12:00:00.000Z',
                'upvotes': 4,
                'downvotes': 1,
                'my_vote': 1,
                'mine': true,
              },
            ],
          });
        }),
      );
      final List<CommunityEntry> entries = await api.addCommunityEntry(
        duelEventId,
        channel: CommunityChannel.nota,
        body: 'Contexto',
        link: Uri.parse('https://example.cl/doc.pdf'),
      );
      expect(requests.single.url.path, '/v1/social/community');
      expect(jsonDecode(requests.single.body), <String, Object?>{
        'event_id': duelEventId,
        'channel': 'nota',
        'body': 'Contexto',
        'link_url': 'https://example.cl/doc.pdf',
      });
      expect(entries.single.channel, CommunityChannel.nota);
      expect(entries.single.upvotes, 4);
      expect(entries.single.myVote, 1);
      expect(entries.single.hasLink, isTrue);

      await api.voteCommunityEntry('e1', -1);
      expect(requests.last.url.path, '/v1/social/community/votes');
      expect(jsonDecode(requests.last.body), <String, Object?>{
        'entry_id': 'e1',
        'vote': -1,
      });
    });

    test('un Core sin la migración responde con un fallo tipado', () async {
      final PublicApiClient api = client(
        MockClient((_) async => json(<String, Object?>{}, 503)),
      );
      await expectLater(
        api.communityEntries(duelEventId),
        throwsA(isA<PublicApiFailure>()),
      );
    });
  });

  testWidgets('el termómetro reparte el respaldo entre las dos posturas', (
    WidgetTester tester,
  ) async {
    final ArenaFullCore core = ArenaFullCore();
    await pumpArena(tester, core);
    expect(
      find.text('La Tercera 67% · BioBioChile 33% · 3 votos'),
      findsOneWidget,
    );

    await tester.tap(find.byTooltip('Abrir duelo completo'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('arena-vote-button')));
    await tester.pumpAndSettle();
    expect(find.text('La Tercera · 2 votos'), findsOneWidget);
    expect(find.text('BioBioChile · 1 voto'), findsOneWidget);
    expect(
      find.text('no existe ni existirá un acuerdo con el imputado'),
      findsOneWidget,
    );

    await tester.tap(
      find.byKey(const ValueKey<String>('arena-vote-position-$positionBId')),
    );
    await tester.pumpAndSettle();
    expect(core.positionVoteCalls, <String?>[positionBId]);
    expect(find.text('✓ BioBioChile · 2 votos'), findsOneWidget);
    expect(
      find.text('La Tercera 50% · BioBioChile 50% · 4 votos'),
      findsWidgets,
    );
    // Tapping the chosen side again withdraws the vote.
    await tester.tap(
      find.byKey(const ValueKey<String>('arena-vote-position-$positionBId')),
    );
    await tester.pumpAndSettle();
    expect(core.positionVoteCalls, <String?>[positionBId, null]);
    expect(find.text('BioBioChile · 1 voto'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Pantalla 5 · los tres canales persisten con autor y 👍/👎', (
    WidgetTester tester,
  ) async {
    final ArenaFullCore core = ArenaFullCore();
    final List<Uri> opened = await pumpArena(
      tester,
      core,
      initialTab: ArenaTab.vs,
    );
    await tester.tap(find.text(duelTitle));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('arena-vote-button')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Abrir comunidad del caso'));
    await tester.pumpAndSettle();

    // Aportes: author alias, relative time, PDF badge and shared counts.
    expect(find.textContaining('Ana P.'), findsOneWidget);
    expect(find.textContaining('hace\u00A03\u00A0h'), findsOneWidget);
    expect(find.text('PDF'), findsOneWidget);
    await tester.tap(find.text('https://www.pjud.cl/docs/acta-audiencia.pdf'));
    expect(opened.single.host, 'www.pjud.cl');
    final Finder up = find.byKey(const ValueKey<String>('arena-entry-up-e2'));
    final Finder down = find.byKey(
      const ValueKey<String>('arena-entry-down-e2'),
    );
    expect(find.descendant(of: up, matching: find.text('5')), findsOneWidget);
    expect(find.descendant(of: down, matching: find.text('1')), findsOneWidget);
    await tester.tap(up);
    await tester.pumpAndSettle();
    expect(find.descendant(of: up, matching: find.text('6')), findsOneWidget);
    await tester.tap(down);
    await tester.pumpAndSettle();
    expect(find.descendant(of: up, matching: find.text('5')), findsOneWidget);
    expect(find.descendant(of: down, matching: find.text('2')), findsOneWidget);

    // An Aporte needs a source: a pasted link is accepted.
    await tester.enterText(
      find.byKey(const Key('arena-community-input')),
      'Comunicado oficial de la fiscalía.',
    );
    await tester.tap(find.byKey(const Key('arena-community-send')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('arena-attach-link')),
      'javascript:alert(1)',
    );
    await tester.tap(find.byKey(const Key('arena-attach-link-use')));
    await tester.pumpAndSettle();
    expect(find.textContaining('enlace completo'), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('arena-attach-link')),
      'https://www.fiscaliadechile.cl/comunicado',
    );
    await tester.tap(find.byKey(const Key('arena-attach-link-use')));
    await tester.pumpAndSettle();
    expect(core.entries.first.channel, CommunityChannel.aporte);
    expect(
      core.entries.first.url.toString(),
      'https://www.fiscaliadechile.cl/comunicado',
    );
    expect(find.textContaining('Lector-AB12 (tú)'), findsOneWidget);
    expect(find.text('Enlace'), findsOneWidget);

    // Debate: opinions without a source, with the posture thermometer.
    await tester.tap(find.byKey(const ValueKey<String>('arena-pill-Debate')));
    await tester.pumpAndSettle();
    expect(
      find.text('Para mí ambos medios dicen cosas compatibles.'),
      findsOneWidget,
    );
    expect(find.textContaining('hace\u00A04\u00A0d'), findsOneWidget);
    expect(
      find.text('La Tercera 67% · BioBioChile 33% · 3 votos'),
      findsOneWidget,
    );
    await tester.enterText(
      find.byKey(const Key('arena-community-input')),
      'Yo lo leo como distinto enfoque.',
    );
    await tester.tap(find.byKey(const Key('arena-community-send')));
    await tester.pumpAndSettle();
    expect(core.entries.first.channel, CommunityChannel.debate);
    expect(core.entries.first.url, isNull);
    expect(find.text('Yo lo leo como distinto enfoque.'), findsOneWidget);

    // Notas: verifiable context with its source.
    await tester.tap(find.byKey(const ValueKey<String>('arena-pill-Notas')));
    await tester.pumpAndSettle();
    expect(
      find.text('El procedimiento abreviado exige aceptar los hechos.'),
      findsOneWidget,
    );
    expect(find.text('Comunicado oficial de la fiscalía.'), findsNothing);
    await tester.tap(find.text('Responder'));
    await tester.pump();
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('arena-community-input')))
          .controller!
          .text,
      '@Lector-77C2 ',
    );
    expect(tester.takeException(), isNull);
  });

  for (final Size size in const <Size>[Size(360, 740), Size(412, 915)]) {
    testWidgets('fuente 1.45 sin desbordes · voto por postura y canales · '
        '${size.width.toInt()}x${size.height.toInt()}', (
      WidgetTester tester,
    ) async {
      await pumpArena(
        tester,
        ArenaFullCore(),
        textScale: 1.45,
        size: size,
        initialTab: ArenaTab.vs,
      );
      expect(tester.takeException(), isNull);
      await reveal(tester, find.text(duelTitle), 'arena-vs-scroll');
      await tester.tap(find.text(duelTitle));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('arena-vote-button')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final Finder side = find.byKey(
        const ValueKey<String>('arena-vote-position-$positionAId'),
      );
      await tester.ensureVisible(side);
      await tester.pumpAndSettle();
      await tester.tap(side);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.text('Abrir comunidad del caso'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Abrir comunidad del caso'));
      await tester.pumpAndSettle();
      for (final String pill in <String>['Debate', 'Notas', 'Aportes']) {
        await tester.tap(find.byKey(ValueKey<String>('arena-pill-$pill')));
        await tester.pumpAndSettle();
        for (int i = 0; i < 6; i++) {
          await tester.drag(
            find.byKey(const Key('arena-community-scroll')),
            const Offset(0, -400),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull, reason: '$pill paso $i');
        }
      }
      await tester.tap(find.byKey(const Key('arena-community-attach')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  }
}
