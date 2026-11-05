import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/widgets/dialectical_thread.dart';
import 'package:dialektik/features/consumer/presentation/widgets/share_synthesis.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../support/public_api_fixtures.dart';

void main() {
  final event = EventDetailDto.fromJson({
    ...eventDetailJson(id: publishedEventId, analysisState: 'PUBLISHED', positionCount: 2),
    'positions': [
      {'id':'a','title':'Resumen A','assertions':[{'id':'aa','assertion_text':'A','quoted_text':'Cita literal A','article_id':'1','source_name':'Medio A'}]},
      {'id':'b','title':'Resumen B','assertions':[{'id':'bb','assertion_text':'B','quoted_text':'Cita literal B','article_id':'2','source_name':'Medio B'}]},
    ],
    'articles': <Object?>[], 'contrasts': <Object?>[],
  });
  testWidgets('muestra citas, voto local y nota sin atribuir respaldo comunitario', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: SingleChildScrollView(child: DialecticalThread(event:event,positions:event.coveragePositions,relation:'CONTRADICTION')))));
    await tester.pump();
    expect(find.text('“Cita literal A”'), findsOneWidget);
    expect(find.text('“Cita literal B”'), findsOneWidget);
    expect(find.text('Termómetro de evidencia'), findsOneWidget);
    await tester.tap(find.text('Faltan datos')); await tester.pump();
    expect(find.text('✓ Tu elección'), findsOneWidget);
    await tester.ensureVisible(find.text('📝 Contexto (0)'));
    await tester.tap(find.text('📝 Contexto (0)')); await tester.pump();
    expect(find.textContaining('TU APORTE LOCAL'), findsOneWidget);
    expect(find.text('+ Aportar enlace o documento verificable'), findsOneWidget);
  });
  testWidgets('presenta la tarjeta capturable para compartir', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (context) => Scaffold(body: TextButton(onPressed: () => showSynthesisSharePreview(context,event),child: const Text('Abrir'))))));
    await tester.tap(find.text('Abrir')); await tester.pumpAndSettle();
    expect(find.text('Compartir tarjeta para X y WhatsApp'), findsOneWidget);
    expect(find.byType(RepaintBoundary), findsWidgets);
    expect(find.text('Guardar imagen PNG'), findsOneWidget);
  });
}
