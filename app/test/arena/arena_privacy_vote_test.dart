// Phase 0 of the audit: the signature never exposes the account and the vote
// question fits the kind of duel.
import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/presentation/account_card.dart';
import 'package:dialektik/features/arena/presentation/duel_screen.dart';
import 'package:dialektik/features/private_beta/data/supabase_auth_client.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('the default signature is «Lector-NNNN», never the account name', () {
    const SupabaseAuthUser google = SupabaseAuthUser(
      email: 'ana@example.cl',
      displayName: 'Ana María Pérez',
    );
    expect(aliasFor(google), matches(RegExp(r'^Lector-\d{4}$')));
    expect(
      aliasFor(
        const SupabaseAuthUser(
          email: 'ana@example.cl',
          alias: 'Anita',
          displayName: 'Ana María Pérez',
        ),
      ),
      'Anita',
    );
  });

  test('Perfil hides most of the e-mail', () {
    expect(arenaMaskedEmail('orlando@gmail.com'), 'o•••@gmail.com');
    expect(arenaMaskedEmail('sin-arroba'), '•••');
  });

  test('only a contradiction asks which version the reader believes', () {
    expect(arenaVoteQuestion('CONTRADICTION'), '¿A qué versión le crees más?');
    expect(
      arenaVoteQuestion('DIFFERENT_FOCUS'),
      '¿Qué enfoque te ayuda más a entender el hecho?',
    );
    expect(
      arenaVoteQuestion('COMPATIBLE'),
      '¿Qué cobertura te parece más clara?',
    );
  });

  test('one outlet never has more than two items in a row', () {
    final List<String> items = <String>['A1', 'A2', 'A3', 'B1', 'A4', 'C1'];
    expect(arenaInterleaveByOutlet(items, (String s) => s[0]), <String>[
      'A1',
      'A2',
      'B1',
      'A3',
      'A4',
      'C1',
    ]);
    // With a single outlet nothing is lost.
    expect(
      arenaInterleaveByOutlet(<String>['A1', 'A2', 'A3'], (String s) => s[0]),
      hasLength(3),
    );
  });

  test('channel branding at the end of a headline is not shown', () {
    expect(arenaHeadline('Trump llega a Asia | 24'), 'Trump llega a Asia');
    expect(arenaHeadline('Qué pasa con Irán - Análisis.'), 'Qué pasa con Irán');
    expect(
      arenaHeadline('El 1 | 2 de la tabla sigue'),
      'El 1 | 2 de la tabla sigue',
    );
    expect(
      arenaQuote('Dijo “haciendo historia”'),
      '«Dijo “haciendo historia”»',
    );
  });

  test('a summit is international even with a Chilean president in it', () {
    expect(
      arenaTopicOfText('El presidente Kast asiste a la cumbre APEC en China'),
      ArenaTopic.internacional,
    );
    expect(arenaTopicOfText('Senado aprueba reforma'), ArenaTopic.politica);
  });
}
