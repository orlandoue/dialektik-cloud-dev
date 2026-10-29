import 'package:dialektik/features/live/data/html_entities.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('decodes the common HTML entities used by RSS titles', () {
    expect(
      decodeHeadlineHtmlEntities(
        'Natalia: &#34;Viña&#34; &quot;2026&quot; &#39;show&#39; &#8220;sur&#8221; '
        '&amp; música &ndash; final',
      ),
      'Natalia: "Viña" "2026" \'show\' “sur” & música – final',
    );
  });

  test('does not decode unrelated or malformed entities', () {
    expect(decodeHeadlineHtmlEntities('&copy; &#34 &unknown;'), '&copy; &#34 &unknown;');
  });
}
