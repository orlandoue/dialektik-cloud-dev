import 'package:dialektik/design_system/design_system.dart';
import 'package:flutter/material.dart';

final class ContradictionsEmptyState extends StatelessWidget {
  const ContradictionsEmptyState({super.key});

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (BuildContext context, BoxConstraints constraints) =>
        SingleChildScrollView(
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 620),
                child: Padding(
                  padding: const EdgeInsets.all(DialektikSpacing.space6),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: <Widget>[
                      const ExcludeSemantics(
                        child: CustomPaint(
                          size: Size(144, 112),
                          painter: _ConversationPainter(),
                        ),
                      ),
                      const SizedBox(height: DialektikSpacing.space6),
                      Semantics(
                        header: true,
                        child: Text(
                          'Contradicciones publicadas',
                          textAlign: TextAlign.center,
                          style: DialektikTypography.editorialHeading(
                            color: DialektikColors.inkBlack,
                            size: 28,
                          ),
                        ),
                      ),
                      const SizedBox(height: DialektikSpacing.space3),
                      Text(
                        'Aún no hay contradicciones publicadas.',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: DialektikSpacing.space4),
                      Text(
                        'Se muestran cuando hay evidencia suficiente y atribuible sobre posiciones distintas en un mismo acontecimiento.',
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: DialektikSpacing.space4),
                      Container(
                        padding: const EdgeInsets.all(DialektikSpacing.space4),
                        decoration: BoxDecoration(
                          color: DialektikColors.raisedReading,
                          border: Border.all(
                            color: DialektikColors.readingLine,
                          ),
                          borderRadius: DialektikRadii.mediumBorderRadius,
                        ),
                        child: const Text(
                          'Que no haya contradicciones publicadas no significa que exista acuerdo.',
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
  );
}

final class _ConversationPainter extends CustomPainter {
  const _ConversationPainter();

  static const Color _blue = Color(0xFF2255A4);
  static const Color _red = Color(0xFFB74A4A);

  @override
  void paint(Canvas canvas, Size size) {
    final Paint blue = Paint()
      ..color = _blue
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.7;
    final Paint red = Paint()
      ..color = _red
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.7;
    final Rect leftBubble = Rect.fromLTWH(10, 14, 72, 62);
    final Rect rightBubble = Rect.fromLTWH(60, 36, 72, 62);
    canvas.drawOval(leftBubble, blue);
    canvas.drawOval(rightBubble, red);
    canvas.drawPath(
      Path()
        ..moveTo(28, 70)
        ..lineTo(19, 88)
        ..lineTo(43, 77),
      blue,
    );
    canvas.drawPath(
      Path()
        ..moveTo(112, 88)
        ..lineTo(124, 103)
        ..lineTo(125, 80),
      red,
    );
  }

  @override
  bool shouldRepaint(_ConversationPainter oldDelegate) => false;
}
