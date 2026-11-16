import 'dart:async';
import 'dart:convert';

import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/data/story_storage_io.dart'
    if (dart.library.js_interop) 'package:dialektik/features/consumer/data/story_storage_web.dart' as storage;
import 'package:dialektik/features/consumer/presentation/widgets/share_synthesis.dart';
import 'package:flutter/material.dart';

/// Local preferences, not community-wide votes or editorial verification.
class DialecticalThread extends StatefulWidget {
  const DialecticalThread({required this.event, required this.positions, required this.relation, this.onOpenSource, super.key});
  final EventDetailDto event;
  final List<EventCoveragePositionDto> positions;
  final String? relation;
  final ValueChanged<String>? onOpenSource;
  @override State<DialecticalThread> createState() => _DialecticalThreadState();
}
class _DialecticalThreadState extends State<DialecticalThread> {
  int? vote;
  String? usefulness;
  final notes = <Map<String, String>>[];
  bool showNotes = false;
  bool dirty = false;
  Future<void> writes = Future.value();
  String get storageKey => 'dialektik_x_${base64Url.encode(utf8.encode(widget.event.id)).replaceAll('=', '')}';
  @override void initState() { super.initState(); unawaited(_load()); }
  Future<void> _load() async {
    try {
      final raw = await storage.readStories(storageKey);
      if (raw == null || !mounted || dirty) return;
      final data = jsonDecode(raw) as Map<String, dynamic>;
      setState(() {
        vote = data['vote'] as int?;
        usefulness = data['usefulness'] as String?;
        for (final item in (data['notes'] as List<dynamic>? ?? [])) {
          if (item is Map && item['url'] is String && item['text'] is String) notes.add({'url': item['url'] as String, 'text': item['text'] as String});
        }
      });
    } on Exception { /* Keep the card usable when local storage is unavailable. */ }
  }
  void _save() {
    dirty = true;
    final value = jsonEncode({'vote': vote, 'usefulness': usefulness, 'notes': notes});
    writes = writes.catchError((Object _) {}).then((_) => storage.writeStories(storageKey, value));
    unawaited(writes.catchError((Object _) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No se pudo guardar tu selección en este dispositivo.'))); }));
  }
  Future<void> _addNote() async {
    final url = TextEditingController(), text = TextEditingController();
    final result = await showDialog<Map<String,String>>(context: context, builder: (context) => AlertDialog(
      title: const Text('Aportar contexto'), content: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: url, keyboardType: TextInputType.url, decoration: const InputDecoration(labelText: 'URL de la fuente')),
        TextField(controller: text, maxLength: 500, decoration: const InputDecoration(labelText: 'Nota breve')),
        const Text('Tu aporte se guarda solo en este dispositivo y no está verificado.'),
      ]), actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
        FilledButton(onPressed: () { final uri = Uri.tryParse(url.text.trim()); if (uri == null || !['http','https'].contains(uri.scheme) || !uri.hasAuthority || text.text.trim().isEmpty) return; Navigator.pop(context, {'url': uri.toString(), 'text': text.text.trim()}); }, child: const Text('Guardar'))],
    ));
    url.dispose(); text.dispose();
    if (result != null && mounted) { setState(() => notes.add(result)); _save(); }
  }
  @override Widget build(BuildContext context) {
    if (widget.positions.length < 2) return const SizedBox.shrink();
    final a = widget.positions[0], b = widget.positions[1];
    String name(EventCoveragePositionDto p) => p.assertions.isEmpty ? 'Medio no disponible' : p.assertions.first.sourceName.replaceAll('(YouTube)', '').trim();
    String initials(String name) { final parts = name.split(RegExp(r'\s+')).where((e) => e.isNotEmpty).take(2); return parts.map((e) => e[0].toUpperCase()).join(); }
    Widget position(EventCoveragePositionDto p, double size) {
      final source = name(p); final quote = p.assertions.isEmpty ? null : p.assertions.first.quotedText.trim();
      final matching = widget.event.articles.where((article) => p.assertions.any((assertion) => assertion.articleId == article.id));
      final age = matching.isEmpty ? null : DateTime.now().difference(matching.first.publishedAt);
      final time = age == null || age.isNegative ? '' : age.inHours < 1 ? ' · hace menos de 1 h' : age.inHours < 24 ? ' · hace ${age.inHours}\u00a0h' : ' · hace ${age.inDays}\u00a0d';
      return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [InkWell(onTap:p.assertions.firstOrNull?.sourceId == null ? null : () => widget.onOpenSource?.call(p.assertions.first.sourceId!),child:CircleAvatar(radius: size / 2, backgroundColor: const Color(0xff22252a), child: Text(initials(source), style: const TextStyle(color: Colors.white, fontFamily: 'Merriweather', fontSize: 12)))), const SizedBox(width: 8), Expanded(child: InkWell(onTap:p.assertions.firstOrNull?.sourceId == null ? null : () => widget.onOpenSource?.call(p.assertions.first.sourceId!),child:Text(source, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)))), Flexible(child: Text(time, maxLines: 1, softWrap: false, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: Colors.grey)))]),
        const SizedBox(height: 8), Text(quote == null || quote.isEmpty ? p.title : '“${RegExp(r"^[a-záéíóúñü]").hasMatch(quote) ? "[...] " : ""}$quote”', style: const TextStyle(fontFamily: 'Merriweather', fontSize: 16.5, fontWeight: FontWeight.w700, height: 1.28, color: Color(0xff141619))),
        if (quote == null || quote.isEmpty) const Text('Resumen de la postura', style: TextStyle(fontSize: 11)),
      ]);
    }
    final labels = [name(a), name(b), 'Faltan datos'];
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      position(a, 36),
      ConstrainedBox(constraints: const BoxConstraints(minHeight: 38), child: CustomPaint(painter: _ThreadPainter(), child: Padding(padding: const EdgeInsets.only(left: 28, top: 5), child: Align(alignment: Alignment.centerLeft, child: DecoratedBox(decoration: BoxDecoration(color: const Color(0xffebe6d8), borderRadius: BorderRadius.circular(14)), child: const Padding(padding: EdgeInsets.symmetric(horizontal: 10, vertical: 4), child: Text('⚡ CONTRASTE ENTRE FUENTES', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)))))))),
      Container(margin: const EdgeInsets.only(left: 28), padding: const EdgeInsets.all(14), decoration: BoxDecoration(color: Colors.white, border: Border.all(color: const Color(0xff1e293b), width: 1.5), borderRadius: BorderRadius.circular(14)), child: position(b, 28)),
      const Divider(color: Color(0xffe6e2d8), height: 28),
      const Text('Termómetro de evidencia', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
      const Text('¿Qué postura aporta pruebas más sólidas?', style: TextStyle(fontSize: 13, color: Color(0xff4a4d52))),
      const Text('Tu elección es privada en este dispositivo; no mide la opinión de la comunidad.', style: TextStyle(fontSize: 11)),
      const SizedBox(height: 8),
      ClipRRect(borderRadius: BorderRadius.circular(10), child: IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [for (var i=0;i<3;i++) Expanded(child: InkWell(onTap: () { setState(() => vote=i); _save(); }, child: Container(constraints: const BoxConstraints(minHeight:56), padding: const EdgeInsets.symmetric(vertical:10,horizontal:6), decoration: BoxDecoration(color: [const Color(0xffdad3c5),const Color(0xffe9e4d8),const Color(0xffe2e4e8)][i], border: vote==i ? Border.all(color: const Color(0xff162032), width: 2) : null), child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [Text(labels[i], textAlign: TextAlign.center, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11)), Text(vote==i ? '✓ Tu elección' : 'Elegir', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12))]))))]))),
      Wrap(spacing: 8, runSpacing: 8, children: [
        FilledButton.tonal(style:FilledButton.styleFrom(backgroundColor:const Color(0xffede9df),foregroundColor:const Color(0xff162032)),onPressed: () => setState(() => showNotes=!showNotes), child: Text('📝 Contexto (${notes.length})')),
        FilledButton.tonal(style:FilledButton.styleFrom(backgroundColor:const Color(0xffede9df),foregroundColor:const Color(0xff162032)),onPressed: () => showSynthesisSharePreview(context, widget.event, relation: widget.relation), child: const Text('📤 Compartir')),
      ]),
      if (showNotes) Container(decoration: BoxDecoration(color: const Color(0xfffcf5e5), border: Border.all(color: const Color(0xffc69c6d), width: 1.2), borderRadius: BorderRadius.circular(12)), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(width: double.infinity, padding: const EdgeInsets.symmetric(horizontal: 12,vertical: 8), decoration: const BoxDecoration(color: Color(0xfff3e2c3), borderRadius: BorderRadius.vertical(top: Radius.circular(11))), child: const Text('🛡 NOTA DE CONTEXTO · TU APORTE LOCAL', style: TextStyle(fontSize: 11,fontWeight: FontWeight.w800,color: Color(0xff5a3711)))),
        Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Cobertura de ${name(a)} y ${name(b)}. Consulta las noticias originales para verificar el contexto.', style: const TextStyle(fontSize: 13.5, height: 1.35)),
          for(final note in notes) Padding(padding: const EdgeInsets.only(top: 8), child: SelectableText('${note['text']}\n${note['url']}')),
          const SizedBox(height: 8), const Text('¿Es útil y neutral esta nota?', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
          Wrap(spacing: 8, children: [for(final option in ['Sí, tiene fuentes', 'Falta precisión']) TextButton(onPressed: () { setState(() => usefulness=option); _save(); }, child: Text('${usefulness==option ? '✓ ' : ''}$option'))]),
          OutlinedButton(onPressed: _addNote, child: const Text('+ Aportar enlace o documento verificable')),
        ])),
      ])),
    ]);
  }
}
class _ThreadPainter extends CustomPainter {
  @override void paint(Canvas canvas, Size size) { final paint=Paint()..color=const Color(0xff2d3139)..strokeWidth=1.5..style=PaintingStyle.stroke; canvas.drawPath(Path()..moveTo(18,0)..lineTo(18,17)..quadraticBezierTo(18,24,25,24)..lineTo(28,24),paint); }
  @override bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
