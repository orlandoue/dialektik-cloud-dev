import 'dart:async';

import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/presentation/arena_widgets.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/consumer/data/following_repository.dart';
import 'package:dialektik/features/consumer/data/source_sync_repository.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/live/presentation/source_sync_sheet.dart';
import 'package:dialektik/features/social/presentation/media_public_profile.dart';
import 'package:flutter/material.dart';

/// A shared source selector for the welcome sheet and Sources tab.
class SourceRadar extends StatefulWidget {
  const SourceRadar({required this.repository, required this.onContinue, this.includeSource, super.key});
  final LiveNewsRepository repository;
  final VoidCallback onContinue;
  final bool Function(LiveSourceDto)? includeSource;
  @override State<SourceRadar> createState() => _SourceRadarState();
}
class _SourceRadarState extends State<SourceRadar> {
  List<LiveSourceDto> sources=[];
  Set<String> followed={};
  final Set<String> busy={};
  String query='';
  bool loading=true;
  bool failed=false;
  FollowingRepository? get following => widget.repository is FollowingRepository &&
    (widget.repository as FollowingRepository).followingAvailable ? widget.repository as FollowingRepository : null;
  @override void initState(){super.initState();following?.followingChanges.addListener(_refreshFollows);unawaited(_load());}
  @override void dispose(){following?.followingChanges.removeListener(_refreshFollows);super.dispose();}
  Future<void> _refreshFollows() async {
    try { final result=await following?.listFollowedSources(); if(mounted && result!=null && busy.isEmpty)setState(()=>followed=result); }
    on Exception { /* Keep the last known selection. */ }
  }
  Future<void> _load() async {
    if(mounted)setState((){loading=true;failed=false;});
    try {
      final all=await widget.repository.listLiveSources();
      final ids=await following?.listFollowedSources() ?? <String>{};
      if(!mounted)return;
      setState((){sources=all.where((s)=>widget.includeSource?.call(s) ?? true).toList();followed=ids;loading=false;});
    } on Exception { if(mounted)setState((){loading=false;failed=true;}); }
  }
  String _brandKey(String name) => name.replaceAll(RegExp(r'\s*\(youtube\)\s*',caseSensitive:false),' ').trim().toLowerCase().replaceAll(RegExp(r'\s+'),' ');
  Future<void> _toggle(List<LiveSourceDto> brand) async {
    final repo=following; final key=_brandKey(brand.first.name);
    if(repo==null || busy.contains(key))return;
    final next=!brand.every((source)=>followed.contains(source.id));
    final previous=Set<String>.of(followed); final confirmed=<String>[];
    setState(() {busy.add(key);for(final source in brand) { if(next) {followed.add(source.id);} else {followed.remove(source.id);} }});
    try {
      for(final source in brand) { if(previous.contains(source.id)==next) continue; await repo.setFollowing(source.id,following:next); confirmed.add(source.id); }
    } on Exception {
      Set<String>? actual;
      try { actual=await repo.listFollowedSources(); } on Exception { /* Retain the known successful updates. */ }
      if(mounted) { setState(() {followed=actual ?? previous; if(actual==null) {for(final id in confirmed) {if(next) {followed.add(id);} else {followed.remove(id);}}}}); ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('No se pudo actualizar el seguimiento completo.'))); }
    } finally {if(mounted)setState(()=>busy.remove(key));}
  }
  String _associatedBrand(String name) {
    final key=_brandKey(name);
    return switch(key) {
      'biobiochile tv' => 'biobiochile',
      'cooperativa fm' || 'cooperativa.cl' => 'cooperativa',
      'el mostrador tv' => 'el mostrador',
      'la tercera tv' => 'la tercera',
      _ => key,
    };
  }
  Future<void> _openSourceSync() async {
    final selected=await showModalBottomSheet<SourceSyncSelection>(context:context,isScrollControlled:true,backgroundColor:ArenaColors.card,shape:const RoundedRectangleBorder(borderRadius:BorderRadius.vertical(top:Radius.circular(24))),builder:(_)=>SourceSyncSheet(sources:sources,lookup:widget.repository is SourceSyncRepository ? widget.repository as SourceSyncRepository : null));
    if(!mounted || selected==null)return;
    final repo=following;
    if(repo==null)return;
    final related=sources.where((s)=>selected.ids.contains(s.id)).map((s)=>_associatedBrand(s.name)).toSet();
    final ids=sources.where((s)=>selected.ids.contains(s.id) || related.contains(_associatedBrand(s.name))).map((s)=>s.id).where((id)=>!followed.contains(id)).toList();
    setState(()=>busy.add('sync'));
    var done=0;
    try {
      for(final id in ids) {await repo.setFollowing(id,following:true);done++;if(mounted)setState(()=>followed.add(id));}
      if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('$done fuentes seguidas.${selected.truncated ? ' La lista de YouTube era demasiado extensa y se consultó parcialmente.' : ''}')));
    } on Exception {
      if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('Se siguieron $done fuentes; no se pudieron guardar todas.')));
    } finally {if(mounted)setState(()=>busy.remove('sync'));}
  }
  @override Widget build(BuildContext context) {
    final brands=<String,List<LiveSourceDto>>{};
    for(final source in sources) { brands.putIfAbsent(_brandKey(source.name),()=>[]).add(source); }
    final followedBrands=brands.values.where((brand)=>brand.every((s)=>followed.contains(s.id))).length;
    final needle=query.trim().toLowerCase();
    final visible=brands.values.where((brand)=>brand.any((s)=>s.name.toLowerCase().contains(needle))).toList()
      ..sort((a,b)=>arenaSourceName(a.first.name).toLowerCase().compareTo(arenaSourceName(b.first.name).toLowerCase()));
    return ColoredBox(color:ArenaColors.background,child:Column(children:[
      Expanded(child:loading ? const Center(child:Column(mainAxisSize:MainAxisSize.min,children:[CircularProgressIndicator(color:ArenaColors.violet),SizedBox(height:8),Text('Cargando fuentes…')])) : failed ? Center(child:Column(mainAxisSize:MainAxisSize.min,children:[const Text('El servicio de fuentes no está disponible.'),TextButton(onPressed:_load,child:const Text('Reintentar'))])) : ListView(key:const Key('radar-scroll'),padding:const EdgeInsets.fromLTRB(0,18,0,20),children:[
        Padding(padding:const EdgeInsets.symmetric(horizontal:16),child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[
          if(sources.isEmpty) const Text('Todavía no hay fuentes operativas.'),
          const Text('Personaliza tu radar',style:TextStyle(fontSize:24,fontWeight:FontWeight.w800,color:ArenaColors.ink)),
          const SizedBox(height:4),
          const Text('Elige los medios que quieres ver primero. Puedes cambiarlo cuando quieras en Medios.',style:ArenaText.body),
          if(brands.length>=15) ...[
            const SizedBox(height:14),
            TextField(onChanged:(value)=>setState(()=>query=value),decoration:InputDecoration(hintText:'Buscar medios…',prefixIcon:const Icon(Icons.search),filled:true,fillColor:ArenaColors.card,border:OutlineInputBorder(borderRadius:BorderRadius.circular(14),borderSide:const BorderSide(color:ArenaColors.border)),enabledBorder:OutlineInputBorder(borderRadius:BorderRadius.circular(14),borderSide:const BorderSide(color:ArenaColors.border)))),
          ],
          const SizedBox(height:12),
          OutlinedButton.icon(style:arenaSecondaryButtonStyle(),onPressed:following!=null && busy.isEmpty ? _openSourceSync : null,icon:const Icon(Icons.download_rounded),label:const Text('Importar los medios que sigues en YouTube o X')),
        ])),
        // Objective format groups; a group without outlets is not shown.
        for(var group=0;group<_formats.length;group++)
          if(visible.any((brand)=>_format(brand)==group)) Column(key:ValueKey('radar-group-$group'),crossAxisAlignment:CrossAxisAlignment.stretch,children:[
            Padding(padding:const EdgeInsets.fromLTRB(16,18,16,4),child:Text(_formats[group],style:ArenaText.section)),
            for(final brand in visible.where((brand)=>_format(brand)==group))
              _SourceRadarRow(source:brand.first,selected:brand.every((source)=>followed.contains(source.id)),busy:busy.contains(_brandKey(brand.first.name)),enabled:following!=null,onTap:()=>unawaited(_toggle(brand)),onOpenProfile:()=>Navigator.of(context).push(MaterialPageRoute<void>(builder:(_)=>MediaPublicProfileScreen(source:brand.first,repository:widget.repository)))),
          ]),
        if(sources.isNotEmpty && visible.isEmpty) const Padding(padding:EdgeInsets.all(16),child:Text('Sin resultados para esta búsqueda.',style:ArenaText.body)),
      ])),
      Container(padding:const EdgeInsets.fromLTRB(16,12,16,12),decoration:const BoxDecoration(color:ArenaColors.card,border:Border(top:BorderSide(color:ArenaColors.border))),child:SafeArea(top:false,child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,mainAxisSize:MainAxisSize.min,children:[
        Text('Sigues $followedBrands de ${brands.length} ${brands.length==1 ? 'medio' : 'medios'}',key:const Key('radar-summary'),style:ArenaText.meta),
        const SizedBox(height:8),
        SizedBox(height:48,child:FilledButton(style:FilledButton.styleFrom(backgroundColor:ArenaColors.violet,foregroundColor:Colors.white,shape:RoundedRectangleBorder(borderRadius:BorderRadius.circular(14))),onPressed:busy.isEmpty ? widget.onContinue : null,child:const Text('Comenzar',style:TextStyle(fontWeight:FontWeight.w700)))),
      ]))),
    ]));
  }
  static const _formats=['Prensa escrita y digital','Radio','Canales de video'];
  int _format(List<LiveSourceDto> brand) {
    bool video(LiveSourceDto s) => s.canonicalDomain.contains('youtube') || s.name.toLowerCase().contains('youtube');
    if(brand.any((s)=>s.name.toLowerCase().contains('radio'))) return 1;
    return brand.every(video) ? 2 : 0;
  }
}

/// One outlet per row with the same emblem and follow button as Medios.
class _SourceRadarRow extends StatelessWidget {
  const _SourceRadarRow({required this.source,required this.selected,required this.busy,required this.enabled,required this.onTap,required this.onOpenProfile});
  final LiveSourceDto source;
  final bool selected,busy,enabled;
  final VoidCallback onTap,onOpenProfile;
  @override Widget build(BuildContext context)=>InkWell(onTap:onOpenProfile,child:ConstrainedBox(constraints:const BoxConstraints(minHeight:64),child:Padding(padding:const EdgeInsets.symmetric(horizontal:16,vertical:8),child:Row(children:[
    MediaEmblem(name:source.name,size:40),
    const SizedBox(width:12),
    Expanded(child:Text(arenaSourceName(source.name),style:ArenaText.cardTitle)),
    const SizedBox(width:8),
    ArenaFollowButton(compact:true,following:selected,onPressed:enabled && !busy ? onTap : null),
  ]))));
}
