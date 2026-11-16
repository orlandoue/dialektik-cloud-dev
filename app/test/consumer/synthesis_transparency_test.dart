import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/widgets/synthesis_transparency.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../support/public_api_fixtures.dart';

void main() {
  testWidgets('transparency describes only the sources and types in coverage', (tester) async {
    final event=EventDetailDto.fromJson({...eventDetailJson(id:publishedEventId,analysisState:'PUBLISHED',positionCount:2),
      'positions':<Object?>[], 'contrasts':<Object?>[], 'articles':<Object?>[
        {'id':'a','title':'Nota','source_name':'Medio','published_at':'2026-10-30T12:00:00Z','url':'https://example.com/a'},
        {'id':'b','title':'Video','source_name':'Canal','published_at':'2026-10-30T13:00:00Z','url':'https://youtu.be/aB3_deF-123'},
      ]});
    await tester.pumpWidget(MaterialApp(home:Scaffold(body:SynthesisTransparency(event:event,relation:'DIFFERENT_FOCUS'))));
    await tester.tap(find.text('¿Cómo se construyó esta síntesis?'));
    await tester.pumpAndSettle();
    expect(find.textContaining('2 medios distintos'),findsOneWidget);
    expect(find.textContaining('Prensa y Video'),findsOneWidget);
    expect(find.textContaining('enfoques distintos'),findsOneWidget);
  });
}
