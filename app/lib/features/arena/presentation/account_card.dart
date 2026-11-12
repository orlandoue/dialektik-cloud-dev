import 'dart:async';

import 'package:dialektik/features/arena/data/arena_account.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:flutter/material.dart';

/// Top of Perfil for a signed-in reader: alias, email and account actions.
class ArenaAccountCard extends StatelessWidget {
  const ArenaAccountCard({required this.account, super.key});

  final ArenaAccount account;

  Future<void> _editAlias(BuildContext context) async {
    final String? saved = await showDialog<String>(
      context: context,
      builder: (BuildContext dialogContext) => _AliasDialog(account: account),
    );
    if (saved != null && context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Tu alias ahora es «$saved».')));
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: account,
    builder: (BuildContext context, _) {
      final String alias = account.alias;
      final String initials = alias
          .split(RegExp(r'[\s._-]+'))
          .where((String part) => part.isNotEmpty)
          .take(2)
          .map((String part) => part.characters.first.toUpperCase())
          .join();
      return DecoratedBox(
        key: const Key('arena-account-card'),
        decoration: arenaCardDecoration(),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Row(
                children: <Widget>[
                  SizedBox.square(
                    dimension: 48,
                    child: DecoratedBox(
                      decoration: const BoxDecoration(
                        color: ArenaColors.violet,
                        shape: BoxShape.circle,
                      ),
                      child: Center(
                        child: MediaQuery.withNoTextScaling(
                          child: FittedBox(
                            fit: BoxFit.scaleDown,
                            child: Padding(
                              padding: const EdgeInsets.all(8),
                              child: Text(
                                initials.isEmpty ? '?' : initials,
                                style: const TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.w800,
                                  color: Colors.white,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(alias, style: ArenaText.section),
                        if (account.email != null)
                          Text(account.email!, style: ArenaText.meta),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              const Text(
                'Tu alias firma tus votos, aportes y comentarios en la '
                'comunidad.',
                style: ArenaText.meta,
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 4,
                children: <Widget>[
                  OutlinedButton.icon(
                    key: const Key('arena-account-edit-alias'),
                    onPressed: () => _editAlias(context),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: ArenaColors.violet,
                      side: const BorderSide(color: Color(0xFFD9D0FD)),
                      minimumSize: const Size(48, 44),
                    ),
                    icon: const Icon(Icons.edit_outlined, size: 18),
                    label: const Text('Editar alias'),
                  ),
                  TextButton.icon(
                    key: const Key('arena-account-sign-out'),
                    onPressed: () => unawaited(account.signOut()),
                    style: TextButton.styleFrom(
                      foregroundColor: ArenaColors.muted,
                      minimumSize: const Size(48, 44),
                    ),
                    icon: const Icon(Icons.logout, size: 18),
                    label: const Text('Cerrar sesión'),
                  ),
                ],
              ),
            ],
          ),
        ),
      );
    },
  );
}

class _AliasDialog extends StatefulWidget {
  const _AliasDialog({required this.account});

  final ArenaAccount account;

  @override
  State<_AliasDialog> createState() => _AliasDialogState();
}

class _AliasDialogState extends State<_AliasDialog> {
  late final TextEditingController _alias = TextEditingController(
    text: widget.account.alias,
  );
  String? _error;
  bool _saving = false;

  @override
  void dispose() {
    _alias.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final String value = _alias.text.trim();
    if (value.length < 2 || value.length > 30) {
      setState(() => _error = 'Usa entre 2 y 30 caracteres.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.account.updateAlias(value);
      if (mounted) Navigator.of(context).pop(widget.account.alias);
    } on Object {
      if (mounted) {
        setState(
          () => _error =
              'No se pudo guardar. Usa letras, números, espacios, punto o '
              'guion.',
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Editar alias'),
    content: TextField(
      key: const Key('arena-alias-input'),
      controller: _alias,
      autofocus: true,
      maxLength: 30,
      onSubmitted: (_) => unawaited(_save()),
      decoration: InputDecoration(
        labelText: 'Alias público',
        errorText: _error,
        errorMaxLines: 3,
      ),
    ),
    actions: <Widget>[
      TextButton(
        onPressed: _saving ? null : () => Navigator.of(context).pop(),
        child: const Text('Cancelar'),
      ),
      FilledButton(
        key: const Key('arena-alias-save'),
        onPressed: _saving ? null : () => unawaited(_save()),
        style: FilledButton.styleFrom(backgroundColor: ArenaColors.violet),
        child: const Text('Guardar'),
      ),
    ],
  );
}
