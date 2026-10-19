import 'package:dialektik/design_system/assets/dialektik_asset_catalog.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'asset catalog keeps missing branding blocked and bundles licensed fonts',
    () async {
      final DialektikAssetCatalog catalog = await DialektikAssetCatalog.load(
        rootBundle,
      );
      final DialektikAssetEntry master = catalog.entries.singleWhere((
        DialektikAssetEntry entry,
      ) {
        return entry.path == DialektikAssetCatalog.missingMasterVector;
      });

      expect(master.availability, DialektikAssetAvailability.blocked);
      expect(
        catalog.entries
            .where((DialektikAssetEntry entry) {
              return entry.availability == DialektikAssetAvailability.bundled;
            })
            .map((DialektikAssetEntry entry) => entry.path),
        unorderedEquals(<String>[
          'assets/fonts/Inter-Regular.ttf',
          'assets/fonts/Inter-Medium.ttf',
          'assets/fonts/OFL.txt',
          'assets/fonts/Merriweather-Regular.ttf',
          'assets/fonts/Merriweather-OFL.txt',
        ]),
      );
      for (final String font in <String>[
        'assets/fonts/Inter-Regular.ttf',
        'assets/fonts/Inter-Medium.ttf',
      ]) {
        final ByteData data = await rootBundle.load(font);
        expect(data.lengthInBytes, greaterThan(300000));
        expect(data.getUint32(0), 0x00010000);
      }
      expect(
        await rootBundle.loadString('assets/fonts/OFL.txt'),
        contains('SIL OPEN FONT LICENSE'),
      );
      final ByteData editorialFont = await rootBundle.load(
        'assets/fonts/Merriweather-Regular.ttf',
      );
      expect(editorialFont.lengthInBytes, greaterThan(150000));
      expect(editorialFont.getUint32(0), 0x00010000);
      expect(
        await rootBundle.loadString('assets/fonts/Merriweather-OFL.txt'),
        contains('SIL OPEN FONT LICENSE'),
      );
    },
  );
}
