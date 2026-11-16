import 'package:dialektik/features/live/data/publisher_market_selection.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('market defaults Chile and notifies all listening tabs', () {
    final PublisherMarketSelection selection = PublisherMarketSelection();
    final List<String> observed = <String>[];
    selection.addListener(() => observed.add(selection.value));
    expect(selection.value, 'CL');
    selection.select('PE');
    selection.select('ES');
    selection.select('CL');
    expect(observed, <String>['PE', 'ES', 'CL']);
    selection.dispose();
  });

  test('only supported country codes are accepted', () {
    final PublisherMarketSelection selection = PublisherMarketSelection();
    expect(() => selection.select('UK'), throwsArgumentError);
    expect(() => selection.select('cl'), throwsArgumentError);
    expect(() => selection.select('ZZ'), throwsArgumentError);
    expect(selection.value, 'CL');
    selection.dispose();
  });
}
