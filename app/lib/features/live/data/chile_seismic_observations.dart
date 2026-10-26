import 'package:dialektik/features/live/data/live_news_models.dart';

abstract interface class SeismicObservationRepository {
  Future<ChileSeismicObservations> loadChileSeismicObservations({
    bool refresh = false,
  });
}
final class ChileSeismicObservations {
  const ChileSeismicObservations({
    required this.items,
    required this.inspectedAt,
    required this.rightsUrl,
  });
  factory ChileSeismicObservations.fromJson(Object? input) {
    final Map<String, Object?> data = liveObject(input);
    liveRequire(data, 'mode', 'OFFICIAL_LIVE_SEISMIC_OBSERVATIONS');
    liveRequire(data, 'source', 'U.S. Geological Survey');
    liveRequire(data, 'market_country', 'CL');
    liveRequire(data, 'category', 'OFFICIAL_OBSERVATIONS_NOT_NEWS');
    if (data['persisted'] != false ||
        data['cross_publisher_grouping'] != false ||
        data['contradictions_generated'] != false ||
        data['is_emergency_alert'] != false ||
        data['automatic_same_id_grouping'] != true) {
      throw const FormatException('Unsafe seismic publication claims.');
    }
    final Uri rightsUrl = liveHttpUri(data, 'rights_url');
    if (rightsUrl.scheme != 'https' || rightsUrl.host != 'www.usgs.gov') {
      throw const FormatException('USGS rights evidence invalid.');
    }
    final List<SeismicObservation> events =
        liveList(data['items'], SeismicObservation.fromJson);
    if (events.length > 30 ||
        events.map((e) => e.observationId).toSet().length != events.length) {
      throw const FormatException('Invalid USGS occurrence identities.');
    }
    return ChileSeismicObservations(
      items: events,
      inspectedAt: liveDate(data, 'inspected_at'),
      rightsUrl: rightsUrl,
    );
  }
  final List<SeismicObservation> items;
  final DateTime inspectedAt;
  final Uri rightsUrl;
}
final class SeismicObservation {
  const SeismicObservation({
    required this.observationId,
    required this.occurrenceKey,
    required this.description,
    required this.magnitude,
    required this.occurredAt,
    required this.revisedAt,
    required this.status,
    required this.canonicalUrl,
  });
  factory SeismicObservation.fromJson(Object? input) {
    final Map<String, Object?> d = liveObject(input);
    liveRequire(d, 'publisher', 'U.S. Geological Survey');
    liveRequire(d, 'publisher_market', 'US');
    liveRequire(d, 'location_context', 'CHILE_USGS_LABEL_AND_BOUNDS');
    final String id = liveString(d, 'observation_id');
    if (!RegExp(r'^[a-z]{2,5}[a-z0-9]{5,22}$').hasMatch(id) ||
        liveString(d, 'occurrence_key') != 'usgs:earthquake:$id' ||
        liveInt(d, 'independent_publisher_count') != 1 ||
        liveInt(d, 'contradiction_count') != 0) {
      throw const FormatException('Unverifiable USGS occurrence.');
    }
    final String description = liveString(d, 'description');
    if (!description.contains('Chile') || description.length > 180) {
      throw const FormatException('Observation is not labelled Chile.');
    }
    final Object? magnitudeRaw = d['magnitude'];
    if (magnitudeRaw is! num ||
        !magnitudeRaw.isFinite ||
        magnitudeRaw < -2 ||
        magnitudeRaw > 10) {
      throw const FormatException('Invalid magnitude.');
    }
    final DateTime occurred = liveDate(d, 'occurred_at');
    final DateTime revised = liveDate(d, 'revised_at');
    if (revised.isBefore(occurred)) {
      throw const FormatException('Invalid source revision time.');
    }
    final String status = liveString(d, 'source_status');
    if (status != 'reviewed' && status != 'automatic') {
      throw const FormatException('Invalid issuer review status.');
    }
    final Uri url = liveHttpUri(d, 'canonical_url');
    if (url.scheme != 'https' ||
        url.host != 'earthquake.usgs.gov' ||
        url.path != '/earthquakes/eventpage/$id' ||
        url.hasQuery ||
        url.hasFragment) {
      throw const FormatException('USGS source origin invalid.');
    }
    return SeismicObservation(
      observationId: id,
      occurrenceKey: 'usgs:earthquake:$id',
      description: description,
      magnitude: magnitudeRaw.toDouble(),
      occurredAt: occurred,
      revisedAt: revised,
      status: status,
      canonicalUrl: url,
    );
  }
  final String observationId;
  final String occurrenceKey;
  final String description;
  final double magnitude;
  final DateTime occurredAt;
  final DateTime revisedAt;
  final String status;
  final Uri canonicalUrl;
}
