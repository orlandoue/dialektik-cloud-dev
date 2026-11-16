import 'package:dialektik/core/accessibility/contrast_ratio.dart';
import 'package:dialektik/design_system/epistemic/epistemic_presentation.dart';
import 'package:dialektik/design_system/foundations/borders.dart';
import 'package:dialektik/design_system/foundations/colors.dart';
import 'package:dialektik/design_system/foundations/opacity.dart';
import 'package:dialektik/design_system/foundations/radii.dart';
import 'package:dialektik/design_system/foundations/sizing.dart';
import 'package:dialektik/design_system/foundations/spacing.dart';
import 'package:dialektik/design_system/theme/dialektik_theme.dart';
import 'package:dialektik/design_system/theme/dialektik_theme_extensions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('authoritative token values', () {
    test('spacing, radius, size, and opacity values are exact', () {
      expect(
        <double>[
          DialektikSpacing.space1,
          DialektikSpacing.space2,
          DialektikSpacing.space3,
          DialektikSpacing.space4,
          DialektikSpacing.space6,
          DialektikSpacing.space8,
        ],
        <double>[2.8, 5.6, 8.4, 11.2, 16.8, 22.4],
      );
      expect(DialektikRadii.small, 4);
      expect(DialektikRadii.medium, 8);
      expect(DialektikSizing.touchMinimum, 44);
      expect(DialektikSizing.touchPreferred, 48);
      expect(DialektikSizing.maxReadingWidth, 680);
      expect(DialektikOpacity.disabled, 0.45);
      expect(DialektikOpacity.full, 1);
      final int offWhiteArgb = DialektikColors.offWhite.toARGB32();
      expect((offWhiteArgb >> 16) & 0xff, greaterThan(offWhiteArgb & 0xff));
      final int nocturneArgb = DialektikColors.nocturne.toARGB32();
      expect((nocturneArgb >> 16) & 0xff, lessThan(nocturneArgb & 0xff));
    });

    test(
      'measured light and immersive contrast pairs meet their contracts',
      () {
        expect(
          contrastRatio(DialektikColors.inkBlack, DialektikColors.offWhite),
          greaterThanOrEqualTo(18),
        );
        expect(
          contrastRatio(
            DialektikColors.electricViolet,
            DialektikColors.offWhite,
          ),
          greaterThanOrEqualTo(DialektikContrastThreshold.bodyText),
        );
        expect(
          contrastRatio(
            DialektikColors.correctedCoolGray,
            DialektikColors.offWhite,
          ),
          greaterThanOrEqualTo(DialektikContrastThreshold.bodyText),
        );
        expect(
          contrastRatio(DialektikColors.coolGray, DialektikColors.offWhite),
          lessThan(DialektikContrastThreshold.largeTextAndChrome),
        );
        expect(
          contrastRatio(
            DialektikColors.electricViolet,
            DialektikColors.nocturne,
          ),
          lessThan(DialektikContrastThreshold.largeTextAndChrome),
        );
        expect(
          contrastRatio(DialektikColors.offWhite, DialektikColors.inkBlack),
          greaterThanOrEqualTo(18),
        );
        expect(
          contrastRatio(DialektikColors.coolGray, DialektikColors.inkBlack),
          greaterThanOrEqualTo(DialektikContrastThreshold.bodyText),
        );
      },
    );
  });

  group('function-bound themes', () {
    test('Off White uses the measured reading palette', () {
      final ThemeData theme = DialektikTheme.offWhite(
        loadInterFromDependency: false,
      );
      final DialektikSurfaceColors surface = theme
          .extension<DialektikSurfaceColors>()!;

      expect(surface.base, DialektikColors.offWhite);
      expect(surface.foreground, DialektikColors.inkBlack);
      expect(surface.muted, DialektikColors.correctedCoolGray);
      expect(surface.interactionAccent, DialektikColors.electricViolet);
    });

    test('Nocturne never uses brand violet as its interaction accent', () {
      final ThemeData theme = DialektikTheme.nocturne(
        loadInterFromDependency: false,
      );
      final DialektikSurfaceColors surface = theme
          .extension<DialektikSurfaceColors>()!;

      expect(surface.base, DialektikColors.nocturne);
      expect(surface.interactionAccent, DialektikColors.nocturneAccent);
      expect(surface.interactionAccent, isNot(DialektikColors.electricViolet));
    });

    test('Ink Black uses only the documented immersive text pairing', () {
      final ThemeData theme = DialektikTheme.inkBlack(
        loadInterFromDependency: false,
      );
      final DialektikSurfaceColors surface = theme
          .extension<DialektikSurfaceColors>()!;

      expect(surface.base, DialektikColors.inkBlack);
      expect(surface.foreground, DialektikColors.offWhite);
      expect(surface.muted, DialektikColors.coolGray);
    });

    test('epistemic and operational palettes are separate extensions', () {
      final ThemeData theme = DialektikTheme.offWhite(
        loadInterFromDependency: false,
      );
      expect(theme.extension<DialektikEpistemicColors>(), isNotNull);
      expect(theme.extension<DialektikOperationalColors>(), isNotNull);
      expect(
        theme.extension<DialektikEpistemicColors>(),
        isNot(isA<DialektikOperationalColors>()),
      );
    });

    test('Inter theme never exceeds weight 500', () {
      final TextTheme textTheme = DialektikTheme.offWhite(
        loadInterFromDependency: false,
      ).textTheme;
      final Iterable<TextStyle> styles = <TextStyle?>[
        textTheme.displayLarge,
        textTheme.displayMedium,
        textTheme.displaySmall,
        textTheme.headlineLarge,
        textTheme.headlineMedium,
        textTheme.headlineSmall,
        textTheme.titleLarge,
        textTheme.titleMedium,
        textTheme.titleSmall,
        textTheme.bodyLarge,
        textTheme.bodyMedium,
        textTheme.bodySmall,
        textTheme.labelLarge,
        textTheme.labelMedium,
        textTheme.labelSmall,
      ].whereType<TextStyle>();
      for (final TextStyle style in styles) {
        expect(style.fontFamily, contains('Inter'));
        expect(
          style.fontWeight?.value ?? FontWeight.w400.value,
          lessThanOrEqualTo(FontWeight.w500.value),
        );
      }
    });
  });

  test('all nine epistemic roles preserve their normative literal', () {
    const Map<EpistemicVisualRole, String> expected =
        <EpistemicVisualRole, String>{
          EpistemicVisualRole.primaryFact: 'Base común, publicado por',
          EpistemicVisualRole.citableSpan: 'Cita de',
          EpistemicVisualRole.assertion: 'Afirmación',
          EpistemicVisualRole.position: 'Posición',
          EpistemicVisualRole.supports: 'Apoya',
          EpistemicVisualRole.contradicts: 'Contradice',
          EpistemicVisualRole.contextualizes: 'Contextualiza',
          EpistemicVisualRole.notEvaluable: 'No evaluable',
          EpistemicVisualRole.nonComparable: 'No comparable',
        };

    expect(EpistemicVisualRole.values, hasLength(9));
    for (final MapEntry<EpistemicVisualRole, String> entry
        in expected.entries) {
      expect(EpistemicPresentation.forRole(entry.key).label.text, entry.value);
    }
  });

  test('all nine roles retain their authoritative structural treatment', () {
    final Map<EpistemicVisualRole, EpistemicPresentation> presentations =
        <EpistemicVisualRole, EpistemicPresentation>{
          for (final EpistemicVisualRole role in EpistemicVisualRole.values)
            role: EpistemicPresentation.forRole(role),
        };

    expect(
      presentations[EpistemicVisualRole.primaryFact]!.borderPattern,
      DialektikBorderPattern.anchor,
    );
    expect(
      presentations[EpistemicVisualRole.citableSpan]!.borderPattern,
      DialektikBorderPattern.hairline,
    );
    for (final EpistemicVisualRole role in <EpistemicVisualRole>[
      EpistemicVisualRole.assertion,
      EpistemicVisualRole.position,
      EpistemicVisualRole.supports,
      EpistemicVisualRole.contradicts,
      EpistemicVisualRole.contextualizes,
    ]) {
      expect(presentations[role]!.borderPattern, DialektikBorderPattern.none);
    }
    for (final EpistemicVisualRole role in <EpistemicVisualRole>[
      EpistemicVisualRole.notEvaluable,
      EpistemicVisualRole.nonComparable,
    ]) {
      expect(
        presentations[role]!.borderPattern,
        DialektikBorderPattern.provisional,
      );
      expect(presentations[role]!.marker, EpistemicMarker.absenceOfConclusion);
    }

    expect(
      presentations[EpistemicVisualRole.primaryFact]!.marker,
      EpistemicMarker.sourceAnchor,
    );
    expect(
      presentations[EpistemicVisualRole.citableSpan]!.marker,
      EpistemicMarker.literalQuotation,
    );
    expect(
      presentations[EpistemicVisualRole.assertion]!.marker,
      EpistemicMarker.assertionExtent,
    );
    expect(
      presentations[EpistemicVisualRole.position]!.marker,
      EpistemicMarker.ordinal,
    );
    for (final EpistemicVisualRole role in <EpistemicVisualRole>[
      EpistemicVisualRole.supports,
      EpistemicVisualRole.contradicts,
      EpistemicVisualRole.contextualizes,
    ]) {
      expect(presentations[role]!.marker, EpistemicMarker.literalLabel);
    }
  });
}
