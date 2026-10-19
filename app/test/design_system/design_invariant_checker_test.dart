import 'dart:io';

import 'package:dialektik/design_system/safety/design_invariant_checker.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final Directory packageRoot = Directory.current;
  final Directory fixtureRoot = Directory(
    '${packageRoot.path}/test/fixtures/design_invariants',
  );

  test('all current production Dart files satisfy design invariants', () {
    final Directory libraryRoot = Directory('${packageRoot.path}/lib');
    final List<DesignSourceFile> sources = libraryRoot
        .listSync(recursive: true, followLinks: false)
        .whereType<File>()
        .where((File file) => file.path.endsWith('.dart'))
        .map((File file) {
          final String logicalPath = file.path
              .replaceAll('\\', '/')
              .substring(packageRoot.path.replaceAll('\\', '/').length + 1);
          return DesignSourceFile(
            logicalPath: logicalPath,
            contents: file.readAsStringSync(),
          );
        })
        .toList(growable: false);

    expect(sources, isNotEmpty);
    expect(DesignInvariantChecker.inspect(sources), isEmpty);
  });

  test('valid epistemic design usage passes', () {
    final File fixture = File(
      '${fixtureRoot.path}/valid/epistemic_component.dart.txt',
    );
    final List<DesignInvariantViolation> violations =
        DesignInvariantChecker.inspect(<DesignSourceFile>[
          DesignSourceFile(
            logicalPath: fixture.path,
            contents: fixture.readAsStringSync(),
          ),
        ]);

    expect(violations, isEmpty);
  });

  test(
    'authoritative component names are protected without opt-in markers',
    () {
      const Map<String, String> protectedFixtures = <String, String>{
        'PositionCard': 'unmarked_position_card.dart.txt',
        'EvidenceCard': 'unmarked_evidence_card.dart.txt',
        'ContradictionCard': 'unmarked_contradiction_card.dart.txt',
        'ClaimRow': 'unmarked_claim_row.dart.txt',
        'RelationshipIndicator': 'unmarked_relationship_indicator.dart.txt',
        'EquivalenceQueueCard': 'unmarked_equivalence_queue_card.dart.txt',
      };

      expect(
        DesignInvariantChecker.authoritativeEpistemicComponentNames,
        protectedFixtures.keys.toSet(),
      );
      for (final MapEntry<String, String> entry in protectedFixtures.entries) {
        final File fixture = File('${fixtureRoot.path}/invalid/${entry.value}');
        final String contents = fixture.readAsStringSync();
        expect(
          contents,
          isNot(contains(DesignInvariantChecker.epistemicSourceMarker)),
        );
        expect(
          DesignSourceFile(
            logicalPath: 'lib/components/${entry.value}',
            contents: contents,
          ).isEpistemic,
          isTrue,
          reason: '${entry.key} must never depend on a marker or directory.',
        );
      }
    },
  );

  final Map<String, DesignInvariantRule> invalidCases =
      <String, DesignInvariantRule>{
        'operational_state_color.dart.txt':
            DesignInvariantRule.operationalStatePaletteIsolation,
        'operational_state_class.dart.txt':
            DesignInvariantRule.operationalStatePaletteIsolation,
        'context_operational_colors.dart.txt':
            DesignInvariantRule.operationalStatePaletteIsolation,
        'theme_color_scheme_error.dart.txt':
            DesignInvariantRule.operationalStatePaletteIsolation,
        'theme_error_container.dart.txt':
            DesignInvariantRule.operationalStatePaletteIsolation,
        'theme_on_error.dart.txt':
            DesignInvariantRule.operationalStatePaletteIsolation,
        'theme_on_error_container.dart.txt':
            DesignInvariantRule.operationalStatePaletteIsolation,
        'aliased_color_scheme_error.dart.txt':
            DesignInvariantRule.operationalStatePaletteIsolation,
        'operational_notice.dart.txt':
            DesignInvariantRule.operationalStatePaletteIsolation,
        'unmarked_position_card.dart.txt':
            DesignInvariantRule.operationalStatePaletteIsolation,
        'unmarked_evidence_card.dart.txt':
            DesignInvariantRule.operationalStatePaletteIsolation,
        'unmarked_contradiction_card.dart.txt':
            DesignInvariantRule.operationalStatePaletteIsolation,
        'unmarked_claim_row.dart.txt':
            DesignInvariantRule.operationalStatePaletteIsolation,
        'unmarked_relationship_indicator.dart.txt':
            DesignInvariantRule.operationalStatePaletteIsolation,
        'epistemic_api_classified.dart.txt':
            DesignInvariantRule.operationalStatePaletteIsolation,
        'reduced_opacity.dart.txt': DesignInvariantRule.noDirectReducedOpacity,
        'color_alpha.dart.txt': DesignInvariantRule.noDirectReducedOpacity,
        'raw_color.dart.txt': DesignInvariantRule.noRawEpistemicColor,
        'forbidden_icon.dart.txt': DesignInvariantRule.noForbiddenEpistemicIcon,
        'selected_position.dart.txt':
            DesignInvariantRule.noSelectedPositionSemantics,
        'quantitative_emphasis.dart.txt':
            DesignInvariantRule.noQuantitativeVisualEmphasis,
        'source_count_ordering.dart.txt':
            DesignInvariantRule.noQuantitativeVisualEmphasis,
        'winner_score.dart.txt': DesignInvariantRule.noComparativePositionScore,
        'box_shadow.dart.txt': DesignInvariantRule.noEpistemicShadowOrElevation,
        'dynamic_box_shadow.dart.txt':
            DesignInvariantRule.noEpistemicShadowOrElevation,
        'nonzero_elevation.dart.txt':
            DesignInvariantRule.noEpistemicShadowOrElevation,
        'dynamic_elevation.dart.txt':
            DesignInvariantRule.noEpistemicShadowOrElevation,
        'dynamic_font_weight.dart.txt': DesignInvariantRule.noDynamicFontWeight,
        'dynamic_font_size.dart.txt': DesignInvariantRule.noDynamicSize,
        'dynamic_marker_width.dart.txt': DesignInvariantRule.noDynamicSize,
        'dynamic_scale.dart.txt': DesignInvariantRule.noDynamicSize,
        'conditional_raised_surface.dart.txt':
            DesignInvariantRule.noConditionalRaisedPresentation,
      };

  for (final MapEntry<String, DesignInvariantRule> invalidCase
      in invalidCases.entries) {
    test('detects ${invalidCase.key}', () {
      final File fixture = File(
        '${fixtureRoot.path}/invalid/${invalidCase.key}',
      );
      final List<DesignInvariantViolation> violations =
          DesignInvariantChecker.inspect(<DesignSourceFile>[
            DesignSourceFile(
              logicalPath: fixture.path,
              contents: fixture.readAsStringSync(),
            ),
          ]);

      expect(
        violations.map((DesignInvariantViolation item) => item.rule),
        contains(invalidCase.value),
      );
    });
  }

  test('production Dart sources pass all Phase 0 design invariants', () {
    final List<DesignSourceFile> sources = Directory('${packageRoot.path}/lib')
        .listSync(recursive: true)
        .whereType<File>()
        .where((File file) {
          return file.path.endsWith('.dart');
        })
        .map((File file) {
          return DesignSourceFile(
            logicalPath: file.path,
            contents: file.readAsStringSync(),
          );
        })
        .toList(growable: false);

    expect(DesignInvariantChecker.inspect(sources), isEmpty);
  });
}
