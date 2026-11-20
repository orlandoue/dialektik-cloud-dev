// Phase 0 of the audit: the signature never exposes the account and the vote
// question fits the kind of duel.
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
}
