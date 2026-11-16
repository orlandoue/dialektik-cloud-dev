import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/live/data/youtube_video.dart';
import 'package:flutter/material.dart';

/// Describes only information present in the public coverage response.
class SynthesisTransparency extends StatelessWidget {
  const SynthesisTransparency({required this.event, this.relation, super.key});
  final EventDetailDto event;
  final String? relation;

  @override
  Widget build(BuildContext context) {
    final articles = [...event.articles]..sort((a,b) => a.publishedAt.compareTo(b.publishedAt));
    if (articles.isEmpty) return const SizedBox.shrink();
    final sources = articles.map((a) => a.sourceId ?? a.sourceName).toSet().length;
    final types = articles.map((a) => extractYouTubeVideoId(a.url.toString()) != null ? 'Video' : 'Prensa').toSet().join(' y ');
    String date(DateTime d) => d.toLocal().toString().substring(0,16);
    final description = switch(relation) {
      'CONTRADICTION' => 'La clasificación editorial indica versiones incompatibles.',
      'DIFFERENT_FOCUS' => 'La clasificación editorial indica enfoques distintos sobre el hecho.',
      'DEVELOPING' => 'La clasificación editorial indica que la cobertura incorpora actualizaciones.',
      'TREND' => 'La clasificación editorial indica cobertura convergente.',
      _ => 'Consulta las fuentes para conocer sus enfoques.',
    };
    return ExpansionTile(title:const Text('¿Cómo se construyó esta síntesis?'),children:[
      Padding(padding:const EdgeInsets.all(12),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        Text('$sources medios distintos · $types\nCobertura: ${date(articles.first.publishedAt)} – ${date(articles.last.publishedAt)}\n$description'),
        for (final position in event.coveragePositions)
          if (position.assertions.isNotEmpty)
            Text('${position.assertions.map((assertion)=>assertion.sourceName).toSet().join(', ')}: ${position.title}'),
        const Text('Las citas y enlaces originales están en el detalle.'),
      ])),
    ]);
  }
}
