import 'dart:async';
import 'package:dialektik/features/consumer/data/following_repository.dart';
import 'package:dialektik/features/consumer/presentation/widgets/consumer_responsive_shell.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:flutter/material.dart';

class MirrorScreen extends StatefulWidget {
  const MirrorScreen({required this.repository, required this.onOpenArticle, required this.onOpenSources, this.navigationActions=const [], super.key});
  final LiveNewsRepository repository;
  final ValueChanged<String> onOpenArticle;
  final VoidCallback onOpenSources;
  final List<Widget> navigationActions;
  @override State<MirrorScreen> createState() => _MirrorScreenState();
}
class _MirrorScreenState extends State<MirrorScreen> {
  static const background = Color(0xff111622);
  static const panel = Color(0xff1a2234);
  static const ivory = Color(0xfff9f7f1);
  static const gold = Color(0xffd4a359);
  Set<String> followed = {};
  List<LiveNewsItemDto> items = [];
  String? cursor, format, topic;
  bool loading = true, busy = false;
  Object? error;
  int generation = 0;
  FollowingRepository? get following => widget.repository is FollowingRepository && (widget.repository as FollowingRepository).followingAvailable ? widget.repository as FollowingRepository : null;
  List<LiveNewsItemDto> _diverse(List<LiveNewsItemDto> news) {
    final groups=<String,List<LiveNewsItemDto>>{};
    for(final item in news) { groups.putIfAbsent(item.source.id,()=>[]).add(item); }
    final result=<LiveNewsItemDto>[];
    while(groups.isNotEmpty) {
      for(final key in groups.keys.toList()) {
        final group=groups[key]!; result.add(group.removeAt(0)); if(group.isEmpty)groups.remove(key);
      }
    }
    return result;
  }
  @override void initState() { super.initState(); following?.followingChanges.addListener(_changed); unawaited(_reload()); }
  @override void dispose() { following?.followingChanges.removeListener(_changed); super.dispose(); }
  void _changed() => unawaited(_reload());
  Future<void> _reload() async {
    final run = ++generation;
    setState(() { loading = true; error = null; cursor = null; });
    try {
      final f = following;
      if (f == null || widget.repository is! ScopedLiveNewsRepository) throw const FormatException('Personalización no disponible');
      final ids = await f.listFollowedSources();
      final page = await (widget.repository as ScopedLiveNewsRepository).listScopedLiveNews(scope:'outside', format:format, topic:topic, refresh:true);
      if (!mounted || run != generation) return;
      setState(() {followed=ids; items=ids.isEmpty ? _diverse(page.items) : page.items; cursor=page.nextCursor; loading=false;});
    } on Exception catch (e) { if (mounted && run == generation) setState(() {error=e;loading=false;}); }
  }
  Future<void> _more() async {
    if (cursor == null || busy || widget.repository is! ScopedLiveNewsRepository) return;
    final next=cursor!, run=generation;
    setState(() => busy=true);
    try {
      final page=await (widget.repository as ScopedLiveNewsRepository).listScopedLiveNews(scope:'outside',cursor:next,format:format,topic:topic);
      if (!mounted || run != generation) return;
      setState(() { final ids=items.map((e)=>e.id).toSet(); items=[...items,...page.items.where((e)=>ids.add(e.id))]; cursor=page.nextCursor==next ? null : page.nextCursor; });
    } on Exception catch(e) { if (mounted) setState(() => error=e); }
    finally { if (mounted && run==generation) setState(() => busy=false); }
  }
  Future<void> _follow(String id) async {
    try { await following!.setFollowing(id,following:true); }
    on Exception { if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('No se pudo seguir esta fuente.'))); }
  }
  @override Widget build(BuildContext context) => ConsumerResponsiveShell(
    title:'Dialektik', location:'Espejo', navigationActions:widget.navigationActions,
    body: ColoredBox(color:background, child: Theme(data:ThemeData.dark().copyWith(
      colorScheme:const ColorScheme.dark(primary:gold, surface:panel),
      textTheme:ThemeData.dark().textTheme.apply(bodyColor:ivory,displayColor:ivory),
    ), child: ListView(padding:const EdgeInsets.all(20), children:[
      const Text('ANTÍTESIS · FUERA DE TU ALGORITMO', style:TextStyle(color:gold)),
      const SizedBox(height:12),
      if (followed.length < 2) ...[
        const Text('Elige al menos 2 medios en Fuentes para personalizar tu espejo. Aquí puedes explorar otras publicaciones.'),
        TextButton(onPressed:widget.onOpenSources, child:const Text('Elegir fuentes')),
      ],
      SingleChildScrollView(scrollDirection:Axis.horizontal, child:Row(children:[
        for (final choice in const [(null,'Todo'),('press','Prensa'),('videos','Videos')])
          Padding(padding:const EdgeInsets.only(right:8),child:ChoiceChip(label:Text(choice.$2),selected:format==choice.$1,onSelected:(_) {format=choice.$1;unawaited(_reload());})),
      ])),
      SingleChildScrollView(scrollDirection:Axis.horizontal, child:Row(children:[
        for (final choice in const [(null,'Todos'),('politica','Política'),('justicia','Justicia'),('economia','Economía'),('seguridad','Seguridad'),('deportes','Deportes'),('sociedad','Sociedad')])
          Padding(padding:const EdgeInsets.only(right:8),child:ChoiceChip(label:Text(choice.$2),selected:topic==choice.$1,onSelected:(_) {topic=choice.$1;unawaited(_reload());})),
      ])),
      if (loading) const Center(child:CircularProgressIndicator())
      else if (error != null && items.isEmpty) TextButton(onPressed:_reload,child:const Text('No se pudo cargar Espejo. Reintentar'))
      else if (items.isEmpty) const Text('No hay publicaciones con estos filtros.')
      else ...[
        for (final item in items) Card(color:panel, child:Padding(padding:const EdgeInsets.all(16), child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
          Text('${item.source.name.toUpperCase()} · FUERA DE TUS FUENTES',style:const TextStyle(color:gold)),
          const SizedBox(height:8),
          Text(item.headline,style:const TextStyle(color:ivory,fontFamily:'serif',fontSize:20)),
          Row(children:[TextButton(onPressed:()=>widget.onOpenArticle(item.id),child:const Text('Abrir noticia')), TextButton(onPressed:()=>_follow(item.source.id),child:const Text('+ Seguir medio'))]),
        ]))),
        if (cursor != null) TextButton(onPressed:busy ? null : _more,child:const Text('Ver más noticias')),
        if (error != null) TextButton(onPressed:_more,child:const Text('Reintentar')),
      ],
    ]))),
  );
}
