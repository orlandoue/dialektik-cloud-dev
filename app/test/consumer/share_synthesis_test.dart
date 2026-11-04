import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/widgets/share_synthesis.dart';
import 'package:flutter_test/flutter_test.dart';
import '../support/public_api_fixtures.dart';

void main() {
  test('share preview contains the reviewed coverage and original link', () {
    final event = EventDetailDto.fromJson({
      ...eventDetailJson(id:publishedEventId,analysisState:'PUBLISHED',positionCount:2),
      'positions': <Object?>[],
      'contrasts': <Object?>[],
      'articles': <Object?>[{'id':'a','title':'Nota','source_name':'Medio',
        'published_at':'2026-10-30T12:00:00Z','url':'https://example.com/noticia'}],
    });
    final text = synthesisShareText(event, relation:'DIFFERENT_FOCUS');
    expect(text, contains('Distinto enfoque'));
    expect(text, contains('https://example.com/noticia'));
    expect(text, contains('Síntesis verificable generada en Dialektik'));
  });
}
