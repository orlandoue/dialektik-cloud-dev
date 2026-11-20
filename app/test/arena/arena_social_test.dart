import 'dart:convert';

import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/features/arena/presentation/arena_shell.dart';
import 'package:dialektik/features/arena/presentation/arena_widgets.dart';
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

  testWidgets(
    'la opinión de la comunidad se oculta hasta votar y con pocos votos',
    (WidgetTester tester) async {
      final ArenaFullCore core = ArenaFullCore();
      await pumpArena(tester, core);
      // The card of the day shows no tally at all.
      expect(find.textContaining('67%'), findsNothing);

      await tester.tap(find.text(duelTitle).first);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('arena-vote-button')));
      await tester.pumpAndSettle();
      // The options name the outlets, never their tallies, before voting.
      expect(find.text('La Tercera'), findsWidgets);
      expect(find.text('BioBioChile'), findsWidgets);
      expect(find.textContaining('votos'), findsNothing);
      expect(
        find.text('no existe ni existirá un acuerdo con el imputado'),
        findsOneWidget,
      );

      await tester.tap(
        find.byKey(const ValueKey<String>('arena-vote-position-$positionBId')),
      );
      await tester.pumpAndSettle();
      expect(core.positionVoteCalls, <String?>[positionBId]);
      expect(find.textContaining('✓ BioBioChile'), findsOneWidget);
      // In the beta the split shows from the first vote, once voted.
      expect(find.textContaining('50%'), findsWidgets);
      // Tapping the chosen side again withdraws the vote.
      await tester.tap(
        find.byKey(const ValueKey<String>('arena-vote-position-$positionBId')),
      );
      await tester.pumpAndSettle();
      expect(core.positionVoteCalls, <String?>[positionBId, null]);
      expect(find.textContaining('✓ BioBioChile'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('con 30 opiniones y tras votar, el reparto usa grises neutros', (
    WidgetTester tester,
  ) async {
    Future<void> pump({required bool voted}) => tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PostureThermometer(
            nameA: 'BioBioChile',
            nameB: 'La Tercera',
            votesA: 20,
            votesB: 10,
            voted: voted,
          ),
        ),
      ),
    );
    await pump(voted: false);
    expect(find.textContaining('67%'), findsNothing);
    expect(
      find.text('30 opiniones · el reparto se muestra después de votar.'),
      findsOneWidget,
    );

    await pump(voted: true);
    expect(
      find.text('BioBioChile 67% · La Tercera 33% · 30 opiniones'),
      findsOneWidget,
    );
    expect(
      find.text('Es opinión, no indica qué versión es correcta.'),
      findsOneWidget,
    );
    final List<Color> tones = tester
        .widgetList<ColoredBox>(find.byType(ColoredBox))
        .map((ColoredBox box) => box.color)
        .where(
          (Color c) =>
              c == const Color(0xFF64748B) || c == const Color(0xFF94A3B8),
        )
        .toList();
    // Two neutral greys: never the brand violet or an alert orange.
    expect(tones, <Color>[const Color(0xFF64748B), const Color(0xFF94A3B8)]);
    expect(
      tester
          .widgetList<ColoredBox>(find.byType(ColoredBox))
          .where(
            (ColoredBox box) =>
                box.color == const Color(0xFF5B3DF5) ||
                box.color == const Color(0xFFF59E0B),
          ),
      isEmpty,
    );
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
      find.text('3 opiniones · el reparto se muestra después de votar.'),
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

  testWidgets('community entries are signed with the account alias', (
    WidgetTester tester,
  ) async {
    final ArenaFullCore core = ArenaFullCore();
    await pumpArena(
      tester,
      core,
      initialTab: ArenaTab.vs,
      account: FakeArenaAccount(alias: 'Ana P.'),
    );
    await tester.tap(find.text(duelTitle));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('arena-vote-button')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Abrir comunidad del caso'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Abrir comunidad del caso'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey<String>('arena-pill-Debate')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('arena-community-input')),
      'Lo leo como distinto enfoque.',
    );
    await tester.tap(find.byKey(const Key('arena-community-send')));
    await tester.pumpAndSettle();
    expect(core.aliases, <String?>['Ana P.']);
  });
}
