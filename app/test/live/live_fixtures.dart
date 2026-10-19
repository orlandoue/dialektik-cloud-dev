import 'dart:convert';
import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/features/consumer/data/public_api_client.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const String liveTestArticleId = '01K6MYH0000000000000000001';
const String liveTestArticleId2 = '01K6MYH0000000000000000002';
const String liveTestSourceId = '01K6MYH0000000000000000010';

Map<String, Object?> liveTestSource({bool longText = false}) =>
    <String, Object?>{
      'id': liveTestSourceId,
      'name': longText
          ? List<String>.filled(
              6,
              'Editorial de pruebas con un nombre extraordinariamente largo',
            ).join(' ')
          : 'Editorial de pruebas · sintético',
      'source_type': 'other',
      'canonical_domain': 'news.dialektik.invalid',
      'publisher_family': null,
      'category': null,
      'origin': 'LIVE_REAL',
    };
Map<String, Object?> liveTestSourceDetail({
  bool longText = false,
}) => <String, Object?>{
  ...liveTestSource(longText: longText),
  'rights_class': 'LIVE_READY',
  'storage_policy': 'METADATA_AND_FEED_EXCERPT',
  'rights_evidence_url': 'https://news.dialektik.invalid/rights',
  'discovery_channel': 'rss_atom',
  'discovery_url': 'https://news.dialektik.invalid/rss.xml',
  'attribution':
      'Datos escritos para pruebas locales; no proceden de un publisher real.',
};
Map<String, Object?> liveTestArticle({
  String id = liveTestArticleId,
  bool longText = false,
}) => <String, Object?>{
  'id': id,
  'headline': longText
      ? List<String>.filled(
          6,
          'Noticia escrita para pruebas: océano, atmósfera y “señales” — actualización',
        ).join(' ')
      : 'Noticia escrita para pruebas: océano & atmósfera — señales',
  'excerpt':
      'Un extracto de prueba con acentos y “comillas”.\nUna segunda línea.',
  'canonical_url': 'https://news.dialektik.invalid/news/$id',
  'published_at': '2026-10-03T02:00:00.000Z',
  'modified_at': '2026-10-03T03:00:00.000Z',
  'first_seen_at': '2026-10-03T04:00:00.000Z',
  'source': liveTestSource(longText: longText),
  'origin': 'LIVE_REAL',
  'semantic_assignment': 'UNASSIGNED',
  'version_count': 2,
};
Map<String, Object?> liveTestProvenance() => <String, Object?>{
  'discovery_channel': 'rss_atom',
  'discovery_url': 'https://news.dialektik.invalid/rss.xml',
  'canonical_url': 'https://news.dialektik.invalid/news/$liveTestArticleId',
  'source_item_id': 'authored-contract-1',
  'published_at': '2026-10-03T02:00:00.000Z',
  'modified_at': '2026-10-03T03:00:00.000Z',
  'original_published_at': 'Fri, 02 Oct 2026 23:00:00 -0300',
  'original_modified_at': 'Sat, 03 Oct 2026 00:00:00 -0300',
  'first_seen_at': '2026-10-03T04:00:00.000Z',
  'last_seen_at': '2026-10-03T04:30:00.000Z',
  'adapter_version': 'authored-live-contract-v1',
  'rights_class': 'LIVE_READY',
  'rights_evidence_url': 'https://news.dialektik.invalid/rights',
  'exclusion_status': 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2',
  'receipt_count': 2,
};
Map<String, Object?> liveTestDetail({bool longText = false}) =>
    <String, Object?>{
      ...liveTestArticle(longText: longText),
      'author': null,
      'content': <String, Object?>{
        'representation': 'feed_excerpt',
        'text': liveTestArticle()['excerpt'],
        'body': null,
        'storage_policy': 'METADATA_AND_FEED_EXCERPT',
      },
      'provenance': liveTestProvenance(),
      'declared_upstream': null,
    };
Map<String, Object?> liveTestPage({
  List<Object?>? items,
  String? cursor,
  bool longText = false,
}) => <String, Object?>{
  'origin': 'LIVE_REAL',
  'semantic_mode': 'unassigned',
  'items': items ?? <Object?>[liveTestArticle(longText: longText)],
  'next_cursor': cursor,
};
Map<String, Object?> liveTestResponses({
  bool longText = false,
}) => <String, Object?>{
  '/live/news': liveTestPage(longText: longText),
  '/live/news/$liveTestArticleId': liveTestDetail(longText: longText),
  '/live/news/$liveTestArticleId/provenance': liveTestProvenance(),
  '/live/sources': <String, Object?>{
    'items': <Object?>[liveTestSource(longText: longText)],
  },
  '/live/sources/$liveTestSourceId': liveTestSourceDetail(longText: longText),
};
http.Response liveJsonResponse(Object? value, [int status = 200]) =>
    http.Response(
      jsonEncode(value),
      status,
      headers: <String, String>{
        'content-type': 'application/json; charset=utf-8',
      },
    );

PublicApiClient liveTestClient({
  bool longText = false,
  List<Uri>? calls,
  Map<String, Object?>? responses,
  Future<http.Response> Function(http.Request)? responder,
}) {
  final Map<String, Object?> bodies =
      responses ?? liveTestResponses(longText: longText);
  return PublicApiClient(
    configuration: ApiConfiguration.fromBaseUrl('http://127.0.0.1:3102'),
    httpClient: MockClient((http.Request request) async {
      calls?.add(request.url);
      if (responder != null) return responder(request);
      return liveJsonResponse(
        bodies[request.url.path] ?? <String, Object?>{},
        bodies.containsKey(request.url.path) ? 200 : 404,
      );
    }),
  );
}
