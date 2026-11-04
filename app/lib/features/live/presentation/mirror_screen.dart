import 'dart:async';
import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/following_repository.dart';
import 'package:dialektik/features/consumer/data/story_follow_store.dart';
import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/consumer/presentation/widgets/consumer_responsive_shell.dart';
import 'package:dialektik/features/consumer/presentation/widgets/horizontal_choice_strip.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/live/data/youtube_video.dart';
import 'package:dialektik/features/live/presentation/widgets/youtube_thumbnail.dart';
import 'package:flutter/material.dart';

class MirrorScreen extends StatefulWidget {
  const MirrorScreen({required this.repository, required this.onOpenArticle, required this.onOpenSources, this.externalLinkOpener=openExternalHttpLink, this.navigationActions=const [], this.consumerRepository, this.onOpenEvent, super.key});
  final LiveNewsRepository repository;
  final ConsumerRepository? consumerRepository;
  final ValueChanged<String>? onOpenEvent;
  final ValueChanged<String> onOpenArticle;
  final VoidCallback onOpenSources;
  final ExternalLinkOpener externalLinkOpener;
  final List<Widget> navigationActions;
  @override State<MirrorScreen> createState() => _MirrorScreenState();
}
class _MirrorScreenState extends State<MirrorScreen> {
  static const background = Color(0xfffaf8f3);
  static const panel = Color(0xffffffff);
  static const ivory = Color(0xff1a1a1a);
  static const gold = Color(0xff3b49df);
  Set<String> followed = {};
  List<LiveNewsItemDto> items = [];
  String? cursor, format, topic;
  bool loading = true, busy = false;
  Object? error;
  int generation = 0;
  bool _checkingEvents = false;
  DateTime? _eventLookupAt;
  final Map<String,({String id,String title})> _eventByArticle = {};
  Future<void> _findEvents() async {
    final repo=widget.consumerRepository;
    if (_checkingEvents || repo==null || !items.any((item)=>item.isEventLinked)) return;
    if (_eventLookupAt != null && DateTime.now().difference(_eventLookupAt!) < const Duration(minutes:5)) return;
    _checkingEvents=true;
    final wanted=items.where((item)=>item.isEventLinked && !_eventByArticle.containsKey(item.id)).map((item)=>item.id).toSet();
    try {
      String? cursor;
      final seen=<String>{};
      var inspected=0;
      do {
        final page=await repo.listFeed(cursor:cursor,limit:50);
        StoryFollowStore.forRepository(repo).rememberRelations(page.items);
        for (final event in page.items) {
          if (wanted.isEmpty || inspected++ >= 50) break;
          try {
            final detail=await repo.getEvent(event.id);
            var changed=false;
            for(final article in detail.articles) {
              if (wanted.remove(article.id)) {
                _eventByArticle[article.id]=(id:event.id,title:event.titleDescriptive);
                changed=true;
              }
            }
            if (changed && mounted) setState(() {});
          } on Exception { /* Keep the source explanation when a detail is unavailable. */ }
        }
        cursor=page.nextCursor;
      } while(wanted.isNotEmpty && inspected<50 && cursor!=null && seen.add(cursor));
      _eventLookupAt=DateTime.now();
    } on Exception { /* News remains available if event lookup fails. */ }
    finally { _checkingEvents=false; }

  }

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
  @override void initState() {
    super.initState();
    following?.followingChanges.addListener(_changed);
    final memory = widget.repository is MirrorNewsMemory ? widget.repository as MirrorNewsMemory : null;
    final cached = memory?.cachedMirrorNews;
    final ids = memory?.cachedFollowedSources;
    if (cached != null && ids != null) {
      followed=ids; items=ids.isEmpty ? _diverse(cached.items) : cached.items;
      cursor=cached.nextCursor; loading=false;
      unawaited(_findEvents());
    } else { unawaited(_reload()); }
  }
  @override void dispose() { following?.followingChanges.removeListener(_changed); super.dispose(); }
  void _changed() {
    final memory = widget.repository is MirrorNewsMemory ? widget.repository as MirrorNewsMemory : null;
    final latest = memory?.cachedFollowedSources;
    if (latest != null && mounted) setState(() => followed=latest);
    unawaited(_reload());
  }
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
      unawaited(_findEvents());
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
      unawaited(_findEvents());
    } on Exception catch(e) { if (mounted) setState(() => error=e); }
    finally { if (mounted && run==generation) setState(() => busy=false); }
  }
  Future<void> _follow(String id) async {
    try { await following!.setFollowing(id,following:true); if(mounted) setState(()=>followed={...followed,id}); }
    on Exception { if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('No se pudo seguir esta fuente.'))); }
  }
  String _explanation(LiveNewsItemDto item) {
    if (extractYouTubeVideoId(item.canonicalUrl.toString()) != null) {
      return 'Video de un canal que no sigues';
    }
    final category = (item.source.category ?? '').toLowerCase();
    if (category.contains('investig')) return 'Cobertura de investigación de una fuente que no sigues';
    if (category.contains('regional')) return 'Cobertura regional de una fuente que no sigues';
    return 'Cobertura de un medio que no sigues';
  }
  void _openItem(LiveNewsItemDto item) {
    if (extractYouTubeVideoId(item.canonicalUrl.toString()) != null) { unawaited(widget.externalLinkOpener(item.canonicalUrl)); }
    else { widget.onOpenArticle(item.id); }
  }
  @override Widget build(BuildContext context) => ConsumerResponsiveShell(
    title:'Dialektik', location:'Espejo', navigationActions:widget.navigationActions,
    body: ColoredBox(color:background, child: RefreshIndicator(onRefresh:_reload,child:ListView(padding:const EdgeInsets.fromLTRB(16,8,16,24), children:[
      if (followed.length < 2) ...[
        const Text('Elige al menos 2 medios en Fuentes para personalizar tu espejo. Aquí puedes explorar otras publicaciones.'),
        TextButton(onPressed:widget.onOpenSources, child:const Text('Elegir fuentes')),
      ],
      HorizontalChoiceStrip<String>(semanticsLabel:'Filtrar por formato', allLabel:'Todo', selectedValue:format,
        options:const [HorizontalChoiceOption(value:'press',label:'Prensa'),HorizontalChoiceOption(value:'videos',label:'Videos')],
        onSelected:(value){format=value;items=[];unawaited(_reload());}),
      const SizedBox(height:8),
      HorizontalChoiceStrip<String>(semanticsLabel:'Filtrar por tema', allLabel:'Todos', selectedValue:topic,
        options:const [HorizontalChoiceOption(value:'politica',label:'Política'),HorizontalChoiceOption(value:'justicia',label:'Justicia'),HorizontalChoiceOption(value:'economia',label:'Economía'),HorizontalChoiceOption(value:'seguridad',label:'Seguridad'),HorizontalChoiceOption(value:'deportes',label:'Deportes'),HorizontalChoiceOption(value:'sociedad',label:'Sociedad')],
        onSelected:(value){topic=value;items=[];unawaited(_reload());}),
      const SizedBox(height:8),
      if (loading && items.isEmpty) const Center(child:CircularProgressIndicator())
      else if (error != null && items.isEmpty) TextButton(onPressed:_reload,child:const Text('No se pudo cargar Espejo. Reintentar'))
      else if (items.isEmpty) const Text('No hay publicaciones con estos filtros.')
      else ...[
        for (final item in items.where((item)=>!followed.contains(item.source.id)))
          Container(margin:const EdgeInsets.only(bottom:12),decoration:BoxDecoration(color:panel,border:Border.all(color:const Color(0xffe5e0d5)),borderRadius:BorderRadius.circular(12)),
            child:IntrinsicHeight(child:Row(crossAxisAlignment:CrossAxisAlignment.stretch,children:[
              Container(width:3,decoration:const BoxDecoration(color:gold,borderRadius:BorderRadius.horizontal(left:Radius.circular(12)))),
              Expanded(child:Padding(padding:const EdgeInsets.all(14),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
                Container(padding:const EdgeInsets.symmetric(horizontal:8,vertical:4),decoration:BoxDecoration(color:const Color(0xffe6e4f8),borderRadius:BorderRadius.circular(6)),
                  child:Text('FUERA DE TUS FUENTES · ${item.source.name.toUpperCase()}',style:const TextStyle(color:Color(0xff162032),fontSize:11,fontWeight:FontWeight.w700))),
                const SizedBox(height:8),
                if (extractYouTubeVideoId(item.canonicalUrl.toString()) case final String id) ...[
                  YouTubeThumbnail(videoId:id,onTap:()=>_openItem(item)), const SizedBox(height:8),
                ],
                GestureDetector(onTap:()=>_openItem(item),child:Text(item.headline,style:const TextStyle(color:ivory,fontFamily:'serif',fontSize:20,height:1.3))),
                if (extractYouTubeVideoId(item.canonicalUrl.toString()) != null)
                  Text('${item.source.name} · ${item.publishedAt.toLocal().toString().substring(0,16)}'),
                const SizedBox(height:8),
                if (_eventByArticle[item.id] case final event?)
                  TextButton(onPressed:widget.onOpenEvent == null ? null : () => widget.onOpenEvent!(event.id),
                    child:Text('Aporta otra mirada sobre: ${event.title} → Ver síntesis'))
                else Text(_explanation(item),style:const TextStyle(color:Color(0xff475569),fontSize:12)),
                Wrap(alignment:WrapAlignment.spaceBetween,spacing:8,runSpacing:4,children:[
                  TextButton(onPressed:()=>_openItem(item),child:const Text('Abrir noticia ↗')),
                  OutlinedButton.icon(onPressed:()=>_follow(item.source.id),icon:const Icon(Icons.add,size:16),label:const Text('Seguir medio')),
                ]),
              ]))),
            ]))),
        if (cursor != null) TextButton(onPressed:busy ? null : _more,child:const Text('Ver más noticias')),
        if (error != null) TextButton(onPressed:_more,child:const Text('Reintentar')),
      ],
    ]))),
  );
}
