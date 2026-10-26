import 'package:dialektik/features/live/data/registered_source_directory.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('unverified technical sources stay separate from licensed feeds', () {
    final RegisteredSourceDirectory data = RegisteredSourceDirectory.fromJson({
      'mode': 'UNVERIFIED_SOURCE_REGISTRY',
      'license_status': 'NOT_ATTESTED',
      'operational_source_count': 0,
      'items': [
        {
          'id': 'src-01', 'name':'Medio chileno',
          'canonical_domain':'ejemplo.cl', 'staged_record_count':3,
          'review_status':'PENDING_INDEPENDENT_VERIFICATION',
        }
      ],
    });
    expect(data.items.single.name,'Medio chileno');
    expect(data.items.single.stagedRecordCount,3);
  });
  test('cannot mislabel review directory as authorized', () {
    expect(() => RegisteredSourceDirectory.fromJson({
      'mode':'VERIFIED_SOURCES', 'license_status':'APPROVED',
      'operational_source_count':1, 'items': <Object?>[],
    }), throwsFormatException);
    expect(() => RegisteredSourceDirectory.fromJson({
      'mode':'UNVERIFIED_SOURCE_REGISTRY', 'license_status':'NOT_ATTESTED',
      'operational_source_count':0, 'items':[{
        'id':'x', 'name':'Fuente', 'canonical_domain':'ejemplo.cl',
        'staged_record_count':1, 'review_status':'APPROVED',
      }],
    }), throwsFormatException);
  });
}
