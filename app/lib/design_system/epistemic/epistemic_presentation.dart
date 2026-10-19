import 'package:dialektik/design_system/foundations/borders.dart';

/// Visual roles named by the authoritative design system.
///
/// This enum does not model domain entities. It only selects a non-chromatic
/// structural marker. It cannot select color, opacity, elevation, size, order,
/// or weight.
enum EpistemicVisualRole {
  primaryFact,
  citableSpan,
  assertion,
  position,
  supports,
  contradicts,
  contextualizes,
  notEvaluable,
  nonComparable,
}

/// Authoritative literal announced or rendered for each visual role.
///
/// Dynamic attribution, ordinal, and reason text is appended by the consuming
/// component. These fixed fragments must not be reworded by individual widgets.
enum EpistemicNormativeLabel {
  baseCommon('Base común, publicado por'),
  quoteFrom('Cita de'),
  assertion('Afirmación'),
  position('Posición'),
  supports('Apoya'),
  contradicts('Contradice'),
  contextualizes('Contextualiza'),
  notEvaluable('No evaluable'),
  nonComparable('No comparable');

  const EpistemicNormativeLabel(this.text);

  final String text;
}

/// Structural channels allowed to distinguish epistemic presentation.
enum EpistemicMarker {
  sourceAnchor,
  literalQuotation,
  assertionExtent,
  ordinal,
  literalLabel,
  absenceOfConclusion,
}

/// A deliberately narrow, non-chromatic epistemic presentation contract.
final class EpistemicPresentation {
  const EpistemicPresentation._({
    required this.borderPattern,
    required this.label,
    required this.marker,
  });

  factory EpistemicPresentation.forRole(EpistemicVisualRole role) {
    return switch (role) {
      EpistemicVisualRole.primaryFact => const EpistemicPresentation._(
        borderPattern: DialektikBorderPattern.anchor,
        label: EpistemicNormativeLabel.baseCommon,
        marker: EpistemicMarker.sourceAnchor,
      ),
      EpistemicVisualRole.citableSpan => const EpistemicPresentation._(
        borderPattern: DialektikBorderPattern.hairline,
        label: EpistemicNormativeLabel.quoteFrom,
        marker: EpistemicMarker.literalQuotation,
      ),
      EpistemicVisualRole.assertion => const EpistemicPresentation._(
        borderPattern: DialektikBorderPattern.none,
        label: EpistemicNormativeLabel.assertion,
        marker: EpistemicMarker.assertionExtent,
      ),
      EpistemicVisualRole.position => const EpistemicPresentation._(
        borderPattern: DialektikBorderPattern.none,
        label: EpistemicNormativeLabel.position,
        marker: EpistemicMarker.ordinal,
      ),
      EpistemicVisualRole.supports => const EpistemicPresentation._(
        borderPattern: DialektikBorderPattern.none,
        label: EpistemicNormativeLabel.supports,
        marker: EpistemicMarker.literalLabel,
      ),
      EpistemicVisualRole.contradicts => const EpistemicPresentation._(
        borderPattern: DialektikBorderPattern.none,
        label: EpistemicNormativeLabel.contradicts,
        marker: EpistemicMarker.literalLabel,
      ),
      EpistemicVisualRole.contextualizes => const EpistemicPresentation._(
        borderPattern: DialektikBorderPattern.none,
        label: EpistemicNormativeLabel.contextualizes,
        marker: EpistemicMarker.literalLabel,
      ),
      EpistemicVisualRole.notEvaluable => const EpistemicPresentation._(
        borderPattern: DialektikBorderPattern.provisional,
        label: EpistemicNormativeLabel.notEvaluable,
        marker: EpistemicMarker.absenceOfConclusion,
      ),
      EpistemicVisualRole.nonComparable => const EpistemicPresentation._(
        borderPattern: DialektikBorderPattern.provisional,
        label: EpistemicNormativeLabel.nonComparable,
        marker: EpistemicMarker.absenceOfConclusion,
      ),
    };
  }

  final DialektikBorderPattern borderPattern;
  final EpistemicNormativeLabel label;
  final EpistemicMarker marker;
}
