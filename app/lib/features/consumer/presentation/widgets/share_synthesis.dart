import 'dart:ui' as ui;

import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

String synthesisShareText(EventDetailDto event, {String? relation}) {
  final label = switch (relation) { 'CONTRADICTION' => 'Contradicción', 'DIFFERENT_FOCUS' => 'Distinto enfoque', 'DEVELOPING' => 'En desarrollo', 'TREND' => 'Tendencia', _ => 'Cobertura' };
  final lines = <String>['$label · ${event.titleDescriptive}', ''];
  for (final position in event.coveragePositions) {
    final names = position.assertions.map((a) => a.sourceName).toSet().join(', ');
    if (names.isNotEmpty) lines.add('• $names: ${position.title}');
  }
  if (event.articles.isNotEmpty) {
    lines.addAll(['', 'Noticias originales:']);
    for (final article in event.articles) { lines.add('• ${article.sourceName}: ${article.url}'); }
  }
  lines.addAll(['', 'Síntesis de Dialektik']);
  return lines.join('\n');
}
Future<void> showSynthesisSharePreview(BuildContext context, EventDetailDto event, {String? relation}) => showModalBottomSheet<void>(
  context: context, isScrollControlled: true, backgroundColor: const Color(0xff14171f), shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
  builder: (_) => _ShareSheet(event: event, relation: relation),
);
class _ShareSheet extends StatefulWidget {
  const _ShareSheet({required this.event, this.relation});
  final EventDetailDto event; final String? relation;
  @override State<_ShareSheet> createState() => _ShareSheetState();
}
class _ShareSheetState extends State<_ShareSheet> {
  final key = GlobalKey();
  bool busy = false;
  Future<void> _open(Uri uri) async {
    try { if (!await launchUrl(uri, mode: LaunchMode.externalApplication) && mounted) _message('No se pudo abrir la aplicación.'); }
    on Exception { if (mounted) _message('No se pudo abrir la aplicación.'); }
  }
  void _message(String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  Future<void> _save() async {
    setState(() => busy=true);
    try {
      final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      final image = await boundary.toImage(pixelRatio: 3);
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      image.dispose();
      if (data == null) throw StateError('PNG unavailable');
      final Uint8List bytes = data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
      await const MethodChannel('dialektik/image_export').invokeMethod<void>('savePng', bytes);
    } on Exception { if (mounted) _message('No se pudo guardar la imagen en este dispositivo.'); }
    finally { if (mounted) setState(() => busy=false); }
  }
  @override Widget build(BuildContext context) {
    final event=widget.event;
    final text=synthesisShareText(event,relation:widget.relation);
    final positions=event.coveragePositions.take(2).toList();
    return SafeArea(child: SingleChildScrollView(padding: const EdgeInsets.all(20), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [const Expanded(child: Text('Compartir tarjeta para X y WhatsApp', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold))), TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cerrar'))]),
      const SizedBox(height: 12), RepaintBoundary(key: key, child: Container(padding: const EdgeInsets.all(20), decoration: BoxDecoration(color: const Color(0xff0b192c), borderRadius: BorderRadius.circular(18)), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('DIALEKTIK · EL ÁRBITRO DE LA DISCUSIÓN', style: TextStyle(color: Color(0xffaec2d6), fontSize: 11, letterSpacing: .8)),
        const SizedBox(height: 20), Text(event.titleDescriptive, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 20,fontWeight: FontWeight.w800)),
        const SizedBox(height: 20), Row(crossAxisAlignment: CrossAxisAlignment.start,children: [for (var i=0;i<positions.length;i++) ...[if(i>0) const SizedBox(width: 10), Expanded(child: Container(padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: const Color(0xff112239), border: Border.all(color: const Color(0xff3a4f6a)), borderRadius: BorderRadius.circular(10)),child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(positions[i].assertions.map((a) => a.sourceName).toSet().join(', '), style: const TextStyle(color: Colors.white,fontWeight: FontWeight.bold)), const SizedBox(height: 8), Text(positions[i].title,style: const TextStyle(color: Color(0xffd4dce7),fontSize: 12.5))])))]]),
        const SizedBox(height: 20), Align(alignment: Alignment.centerLeft,child: Container(padding: const EdgeInsets.symmetric(horizontal: 10,vertical: 5),decoration: BoxDecoration(color: const Color(0xffd6ebf2),borderRadius: BorderRadius.circular(6)),child: Text('${event.sourceCount} fuentes · consulta las noticias originales',style: const TextStyle(color: Color(0xff162032),fontSize: 11)))),
        const SizedBox(height: 10), const Align(alignment: Alignment.centerRight, child: Text('Dialektik',style: TextStyle(color: Colors.white))),
      ]))),
      const SizedBox(height: 16), FilledButton(style: FilledButton.styleFrom(backgroundColor: Colors.white,foregroundColor: Colors.black,minimumSize: const Size.fromHeight(48)),onPressed: () => _open(Uri.https('twitter.com','/intent/tweet',{'text': text})),child: const Text('𝕏  Publicar en X')),
      const SizedBox(height: 8), FilledButton(style: FilledButton.styleFrom(backgroundColor: const Color(0xff284334),foregroundColor: Colors.white,minimumSize: const Size.fromHeight(48)),onPressed: () => _open(Uri.https('wa.me','/',{'text': text})),child: const Text('Enviar por WhatsApp')),
      const SizedBox(height: 8), FilledButton(style: FilledButton.styleFrom(backgroundColor: const Color(0xff262932),foregroundColor: Colors.white,minimumSize: const Size.fromHeight(48)),onPressed: busy ? null : _save,child: const Text('Guardar imagen PNG')),
    ])));
  }
}
