/// Rules mechanically enforced in epistemic presentation source.
enum DesignInvariantRule {
  operationalStatePaletteIsolation,
  noDirectReducedOpacity,
  noRawEpistemicColor,
  noForbiddenEpistemicIcon,
  noSelectedPositionSemantics,
  noQuantitativeVisualEmphasis,
  noComparativePositionScore,
  noEpistemicShadowOrElevation,
  noDynamicFontWeight,
  noDynamicSize,
  noConditionalRaisedPresentation,
}

/// Source unit consumed by the design invariant checker.
final class DesignSourceFile {
  const DesignSourceFile({required this.logicalPath, required this.contents});

  final String logicalPath;
  final String contents;

  bool get isEpistemic {
    return DesignInvariantChecker.classifiesAsEpistemic(this);
  }
}

/// A single actionable source violation.
final class DesignInvariantViolation {
  const DesignInvariantViolation({
    required this.rule,
    required this.logicalPath,
    required this.line,
    required this.message,
  });

  final DesignInvariantRule rule;
  final String logicalPath;
  final int line;
  final String message;

  @override
  String toString() {
    return '$logicalPath:$line '
        '[${rule.name}] $message';
  }
}

final class _InvariantPattern {
  const _InvariantPattern({
    required this.rule,
    required this.expression,
    required this.message,
  });

  final DesignInvariantRule rule;
  final RegExp expression;
  final String message;
}

/// Deterministic Phase 0 source check for epistemic design boundaries.
///
/// A source is protected through any of four independent routes: an
/// authoritative component declaration, use of the typed epistemic API, an
/// epistemic directory, or the explicit marker. The first two routes ensure a
/// forgotten marker cannot silently unprotect a known or correctly composed
/// epistemic component.
abstract final class DesignInvariantChecker {
  static const String epistemicSourceMarker =
      'dialektik:'
      'epistemic-component';

  /// Component names explicitly protected by the authoritative lint contract.
  static const Set<String> authoritativeEpistemicComponentNames = <String>{
    'PositionCard',
    'EvidenceCard',
    'ContradictionCard',
    'ClaimRow',
    'RelationshipIndicator',
    'EquivalenceQueueCard',
  };

  static final RegExp _authoritativeDeclaration = RegExp(
    '\\b(?:class|enum|mixin|extension\\s+type)\\s+(?:'
    '${authoritativeEpistemicComponentNames.join('|')})\\b',
  );

  static final RegExp _epistemicApiUse = RegExp(
    r'\b(?:EpistemicVisualRole|EpistemicNormativeLabel|EpistemicPresentation|'
    r'EpistemicMarker|DialektikEpistemicColors)\b|\.\s*epistemicColors\b',
  );

  static final RegExp _widgetDeclaration = RegExp(
    r'\bclass\s+[A-Za-z_]\w*\s+extends\s+'
    r'(?:[A-Za-z_]\w*\.)?[A-Za-z_]\w*Widget\b|'
    r'\bWidget\s+[A-Za-z_]\w*\s*\(',
  );

  static final List<_InvariantPattern> _patterns = <_InvariantPattern>[
    _InvariantPattern(
      rule: DesignInvariantRule.operationalStatePaletteIsolation,
      expression: RegExp(
        r'\b(?:DialektikOperationalColors|'
        r'DialektikOperationalStateColors|OperationalNotice(?:Kind)?)\b|'
        r'\.\s*operationalColors\b|'
        r'\bcolorScheme\s*\.\s*'
        r'(?:error|errorContainer|onError|onErrorContainer)\b',
      ),
      message: 'Operational state styling entered an epistemic component.',
    ),
    _InvariantPattern(
      rule: DesignInvariantRule.noDirectReducedOpacity,
      expression: RegExp(
        r'\b(?:AnimatedOpacity|FadeTransition|Opacity)\s*\(|'
        r'DialektikOpacity\s*\.\s*(?!full\b)[A-Za-z_]\w*|'
        r'\.\s*(?:withOpacity|withAlpha)\s*\(|'
        r'\.\s*withValues\s*\([^)]*\balpha\s*:',
        dotAll: true,
      ),
      message: 'Reduced opacity is not an epistemic presentation channel.',
    ),
    _InvariantPattern(
      rule: DesignInvariantRule.noRawEpistemicColor,
      expression: RegExp(
        r'\b(?:Color|MaterialColor|ColorSwatch)\s*(?:\.|\()|'
        r'\bColors\s*\.[A-Za-z_]\w*',
      ),
      message: 'Use the shared epistemic palette; raw color is prohibited.',
    ),
    _InvariantPattern(
      rule: DesignInvariantRule.noForbiddenEpistemicIcon,
      expression: RegExp(
        r'\b(?:sealCheck|shield(?:Check)?|warning|thumbs(?:Up|Down)|'
        r'trophy|medal|crown|scales)\b',
        caseSensitive: false,
      ),
      message: 'Verdict, status-badge, or superiority icon is prohibited.',
    ),
    _InvariantPattern(
      rule: DesignInvariantRule.noSelectedPositionSemantics,
      expression: RegExp(
        r'\b(?:selectedPosition|isPositionSelected|preferredPosition|'
        r'favoritePosition)\b',
        caseSensitive: false,
      ),
      message: 'A public position cannot have a selected/preferred state.',
    ),
    _InvariantPattern(
      rule: DesignInvariantRule.noQuantitativeVisualEmphasis,
      expression: RegExp(
        r'(?:\b(?:color|backgroundColor|foregroundColor|border|boxShadow|'
        r'fontSize|fontWeight|height|width|opacity|elevation|padding|margin|'
        r'flex|scale|transform|shape)\s*:\s*[^,;]{0,320}|'
        r'\.\s*sort\s*\([^;]{0,320})'
        r'\b(?:sourceCount|evidenceCount|evidenceTotal|source_count|'
        r'evidence_count|evidence_total)\b',
        caseSensitive: false,
        dotAll: true,
      ),
      message: 'Source/evidence quantity cannot drive presentation or order.',
    ),
    _InvariantPattern(
      rule: DesignInvariantRule.noComparativePositionScore,
      expression: RegExp(
        r'\b(?:truthScore|truth_score|positionScore|position_score|'
        r'isWinner|winningPosition|winnerPosition)\b',
        caseSensitive: false,
      ),
      message: 'Comparative score or hidden winner semantics are prohibited.',
    ),
    _InvariantPattern(
      rule: DesignInvariantRule.noEpistemicShadowOrElevation,
      expression: RegExp(
        r'\bBoxShadow\s*\(|'
        r'\bDialektikElevation\s*\.\s*(?:small|medium|large)\b|'
        r'\bboxShadow\s*:'
        r'(?!\s*(?:null\b|DialektikElevation\s*\.\s*none\b|'
        r'(?:const\s*)?(?:<BoxShadow>\s*)?\[\s*\]))\s*[^;\n}]+|'
        r'\b(?:elevation|shadowColor)\s*:'
        r'(?!\s*(?:0(?:\.0)?\b|null\b))\s*[^,;\n}]+',
      ),
      message: 'Shadow or non-zero elevation cannot rank epistemic content.',
    ),
    _InvariantPattern(
      rule: DesignInvariantRule.noDynamicFontWeight,
      expression: RegExp(
        r'\bfontWeight\s*:'
        r'(?!\s*FontWeight\s*\.\s*w(?:400|500)\b)\s*[^,;\n}]+',
      ),
      message: 'Epistemic font weight must be the static 400/500 token value.',
    ),
    _InvariantPattern(
      rule: DesignInvariantRule.noDynamicSize,
      expression: RegExp(
        r'\bfontSize\s*:(?=[^,;\n}]*[?+*/])\s*[^,;\n}]+|'
        r'\bfontSize\s*:'
        r'(?!\s*(?:\d+(?:\.\d+)?|DialektikTypography\s*\.\s*'
        r'[A-Za-z_]\w*)\b)\s*[^,;\n}]+|'
        r'\b(?:height|width|scale|flex|padding|margin)\s*:'
        r'(?!\s*(?:\d+(?:\.\d+)?|Dialektik(?:Sizing|Borders|Spacing)\s*'
        r'\.\s*[A-Za-z_]\w*)\b)\s*'
        r'[^,;\n}]*(?:\?|\b(?:role|source|evidence|count|score|winner|'
        r'preferred|selected|primary)\w*\b)',
        caseSensitive: false,
      ),
      message: 'Dynamic epistemic size cannot create comparative hierarchy.',
    ),
    _InvariantPattern(
      rule: DesignInvariantRule.noConditionalRaisedPresentation,
      expression: RegExp(
        r'\b(?:color|backgroundColor|surfaceTintColor)\s*:'
        r'(?=[^,;}]{0,320}\?)'
        r'(?=[^,;}]{0,320}\b[A-Za-z_]\w*(?:role|position|source|evidence|'
        r'score|count|winner|preferred|selected|primary)\w*\b)'
        r'[^,;}]{0,320}(?:\bsurfaceColors\s*\.\s*raised\b|'
        r'\braised[A-Za-z_]\w*\b)',
        caseSensitive: false,
      ),
      message: 'Raised surface cannot be selected by epistemic significance.',
    ),
  ];

  static bool classifiesAsEpistemic(DesignSourceFile source) {
    final String normalized = source.logicalPath
        .replaceAll('\\', '/')
        .toLowerCase();
    if (normalized.contains('/epistemic/') ||
        source.contents.contains(epistemicSourceMarker)) {
      return true;
    }

    final String code = _maskNonCode(source.contents);
    return _authoritativeDeclaration.hasMatch(code) ||
        (_widgetDeclaration.hasMatch(code) && _epistemicApiUse.hasMatch(code));
  }

  static List<DesignInvariantViolation> inspect(
    Iterable<DesignSourceFile> sources,
  ) {
    final List<DesignInvariantViolation> violations =
        <DesignInvariantViolation>[];
    for (final DesignSourceFile source in sources) {
      if (!classifiesAsEpistemic(source)) {
        continue;
      }
      final String code = _maskNonCode(source.contents);
      for (final _InvariantPattern pattern in _patterns) {
        for (final RegExpMatch match in pattern.expression.allMatches(code)) {
          violations.add(
            _violation(
              source: source,
              code: code,
              offset: match.start,
              rule: pattern.rule,
              message: pattern.message,
            ),
          );
        }
      }
      violations.addAll(_colorSchemeAliasViolations(source, code));
    }
    return violations;
  }

  static Iterable<DesignInvariantViolation> _colorSchemeAliasViolations(
    DesignSourceFile source,
    String code,
  ) sync* {
    final RegExp assignments = RegExp(
      r'\b(?:(?:final|const|var)\s+(?:ColorScheme\s+)?|ColorScheme\s+)'
      r'([A-Za-z_]\w*)\s*=\s*[^;]*\bcolorScheme\b[^;]*;',
      dotAll: true,
    );
    for (final RegExpMatch assignment in assignments.allMatches(code)) {
      final String alias = assignment.group(1)!;
      final RegExp stateAccess = RegExp(
        '\\b${RegExp.escape(alias)}\\s*\\.\\s*'
        '(?:error|errorContainer|onError|onErrorContainer)\\b',
      );
      for (final RegExpMatch access in stateAccess.allMatches(code)) {
        yield _violation(
          source: source,
          code: code,
          offset: access.start,
          rule: DesignInvariantRule.operationalStatePaletteIsolation,
          message: 'An aliased ColorScheme exposed operational error styling.',
        );
      }
    }
  }

  static DesignInvariantViolation _violation({
    required DesignSourceFile source,
    required String code,
    required int offset,
    required DesignInvariantRule rule,
    required String message,
  }) {
    return DesignInvariantViolation(
      rule: rule,
      logicalPath: source.logicalPath,
      line: '\n'.allMatches(code.substring(0, offset)).length + 1,
      message: message,
    );
  }

  /// Replaces comments and string literals with spaces while preserving source
  /// length and newlines. Rules therefore inspect Dart code, not examples or
  /// normative labels embedded in documentation strings.
  static String _maskNonCode(String source) {
    final StringBuffer result = StringBuffer();
    var index = 0;
    while (index < source.length) {
      final int current = source.codeUnitAt(index);
      final int? next = index + 1 < source.length
          ? source.codeUnitAt(index + 1)
          : null;

      if (current == 47 && next == 47) {
        while (index < source.length && source.codeUnitAt(index) != 10) {
          result.write(' ');
          index += 1;
        }
        continue;
      }

      if (current == 47 && next == 42) {
        var depth = 1;
        result.write('  ');
        index += 2;
        while (index < source.length && depth > 0) {
          final int value = source.codeUnitAt(index);
          final int? following = index + 1 < source.length
              ? source.codeUnitAt(index + 1)
              : null;
          if (value == 47 && following == 42) {
            depth += 1;
            result.write('  ');
            index += 2;
          } else if (value == 42 && following == 47) {
            depth -= 1;
            result.write('  ');
            index += 2;
          } else {
            _writeMasked(result, value);
            index += 1;
          }
        }
        continue;
      }

      if (current == 39 || current == 34) {
        final int quote = current;
        final bool triple =
            index + 2 < source.length &&
            source.codeUnitAt(index + 1) == quote &&
            source.codeUnitAt(index + 2) == quote;
        final bool raw =
            index > 0 &&
            (source.codeUnitAt(index - 1) == 82 ||
                source.codeUnitAt(index - 1) == 114);
        final int delimiterLength = triple ? 3 : 1;
        for (var count = 0; count < delimiterLength; count += 1) {
          result.write(' ');
        }
        index += delimiterLength;
        while (index < source.length) {
          final int value = source.codeUnitAt(index);
          if (!raw && value == 92 && index + 1 < source.length) {
            result.write('  ');
            index += 2;
            continue;
          }
          final bool closes = triple
              ? index + 2 < source.length &&
                    source.codeUnitAt(index) == quote &&
                    source.codeUnitAt(index + 1) == quote &&
                    source.codeUnitAt(index + 2) == quote
              : value == quote;
          if (closes) {
            for (var count = 0; count < delimiterLength; count += 1) {
              result.write(' ');
            }
            index += delimiterLength;
            break;
          }
          _writeMasked(result, value);
          index += 1;
        }
        continue;
      }

      result.writeCharCode(current);
      index += 1;
    }
    return result.toString();
  }

  static void _writeMasked(StringBuffer result, int codeUnit) {
    if (codeUnit == 10 || codeUnit == 13) {
      result.writeCharCode(codeUnit);
    } else {
      result.write(' ');
    }
  }
}
