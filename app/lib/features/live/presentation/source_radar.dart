import 'dart:async';

import 'package:dialektik/features/consumer/data/following_repository.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
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
  static const navy=Color(0xff162032);
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
  Future<void> _toggle(LiveSourceDto source) async {
    final repo=following;
    if(repo==null || busy.contains(source.id))return;
    final next=!followed.contains(source.id);
    setState(() {busy.add(source.id);if(next){followed.add(source.id);}else{followed.remove(source.id);}});
    try { await repo.setFollowing(source.id,following:next); }
    on Exception { if(mounted){setState((){if(next){followed.remove(source.id);}else{followed.add(source.id);}});ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('No se pudo actualizar el seguimiento.')));} }
    finally {if(mounted)setState(()=>busy.remove(source.id));}
  }
  int _group(LiveSourceDto source) {
    final name=source.name.toLowerCase();
    if (['sin filtros','voz de los que sobran','vía x','via x','el líbero','el libero','turno','the clinic','el ciudadano','el desconcierto'].any(name.contains)) return 0;
    if (['ciper','el mostrador','la tercera','fast check','radio u. de chile','radio universidad de chile','diario el día','diario el dia'].any(name.contains)) return 1;
    return 2;
  }
  @override Widget build(BuildContext context) {
    final selected=sources.where((s)=>followed.contains(s.id)).length;
    final visible=sources.where((s)=>s.name.toLowerCase().contains(query.trim().toLowerCase())).toList();
    return ColoredBox(color:const Color(0xfffaf8f3),child:Column(children:[
      Expanded(child:loading ? const Center(child:Column(mainAxisSize:MainAxisSize.min,children:[CircularProgressIndicator(),Text('Cargando fuentes…')])) : failed ? Center(child:Column(mainAxisSize:MainAxisSize.min,children:[const Text('El servicio de fuentes no está disponible.'),TextButton(onPressed:_load,child:const Text('Reintentar'))])) : ListView(key:const Key('radar-scroll'),padding:const EdgeInsets.fromLTRB(16,18,16,20),children:[
        if(sources.isEmpty) const Text('Todavía no hay fuentes operativas.'),
        const Text('Personaliza tu radar',textAlign:TextAlign.center,style:TextStyle(fontFamily:'serif',fontSize:26,fontWeight:FontWeight.w700,color:navy)),
        const SizedBox(height:14),TextField(onChanged:(value)=>setState(()=>query=value),decoration:InputDecoration(hintText:'Buscar medios...',prefixIcon:const Icon(Icons.search),filled:true,fillColor:Colors.white,border:OutlineInputBorder(borderRadius:BorderRadius.circular(12),borderSide:const BorderSide(color:Color(0xffe2dec9))),enabledBorder:OutlineInputBorder(borderRadius:BorderRadius.circular(12),borderSide:const BorderSide(color:Color(0xffe2dec9))))),
        const SizedBox(height:20),const Text('Carruseles por estilo',textAlign:TextAlign.center,style:TextStyle(fontFamily:'serif',fontSize:18,fontWeight:FontWeight.w600,color:navy)),
        for(final group in [(0,'1  🎬 Debate y tensión en video'),(1,'2  🔍 Investigación y análisis'),(2,'3  ⚡ Minuto a minuto')]) ...[
          const SizedBox(height:18),Text('${group.$2}  ›',style:const TextStyle(fontWeight:FontWeight.w700,color:navy)),const SizedBox(height:8),
          if(!visible.any((s)=>_group(s)==group.$1)) const Padding(padding:EdgeInsets.all(8),child:Text('Sin resultados'))
          else SizedBox(key:ValueKey('radar-group-${group.$1}'),height:158,child:ListView.separated(scrollDirection:Axis.horizontal,itemCount:visible.where((s)=>_group(s)==group.$1).length,separatorBuilder:(_,_)=>const SizedBox(width:10),itemBuilder:(context,index){
            final source=visible.where((s)=>_group(s)==group.$1).elementAt(index);
            return _SourceRadarCard(source:source,selected:followed.contains(source.id),busy:busy.contains(source.id),enabled:following!=null,onTap:()=>unawaited(_toggle(source)));
          })),
        ],
      ])),
      Container(padding:const EdgeInsets.fromLTRB(16,12,16,12),decoration:const BoxDecoration(color:Color(0xfffaf8f3),border:Border(top:BorderSide(color:Color(0xffe2dec9)))),child:SafeArea(top:false,child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,mainAxisSize:MainAxisSize.min,children:[
        Text('Tu mezcla: $selected fuentes en Actualidad · ${sources.length-selected} en tu Espejo',style:const TextStyle(fontSize:12,color:navy)),
        const SizedBox(height:8),ClipRRect(borderRadius:BorderRadius.circular(4),child:LinearProgressIndicator(minHeight:7,value:sources.isEmpty ? 0 : selected/sources.length,backgroundColor:const Color(0xffd8d4c8),valueColor:const AlwaysStoppedAnimation<Color>(navy))),
        const SizedBox(height:12),SizedBox(height:48,child:FilledButton(style:FilledButton.styleFrom(backgroundColor:navy,foregroundColor:Colors.white,shape:RoundedRectangleBorder(borderRadius:BorderRadius.circular(12))),onPressed:busy.isEmpty ? widget.onContinue : null,child:const Text('Comenzar →',style:TextStyle(fontWeight:FontWeight.w700)))),
      ]))),
    ]));
  }
}

class _SourceRadarCard extends StatelessWidget {
  const _SourceRadarCard({required this.source,required this.selected,required this.busy,required this.enabled,required this.onTap});
  final LiveSourceDto source;
  final bool selected,busy,enabled;
  final VoidCallback onTap;
  @override Widget build(BuildContext context) {
    final name=source.name.replaceAll('(YouTube)','').trim();
    final palette=[const Color(0xffa82929),const Color(0xff173b70),const Color(0xff29354c),const Color(0xff6e3f79),const Color(0xff1b695f)];
    final lower=name.toLowerCase();
    final defaultColor=palette[name.codeUnits.fold<int>(0,(sum,c)=>sum+c)%palette.length];
    final viaX=lower.contains('vía x') || lower.contains('via x');
    final voice=lower.contains('voz de los que sobran');
    final ciper=lower.contains('ciper');
    final tercera=lower.contains('la tercera');
    final color=voice || ciper || tercera ? Colors.white : lower.contains('sin filtros') || lower.contains('cnn') || lower.contains('24 horas') ? const Color(0xffc21f2b) : lower.contains('cooperativa') ? const Color(0xff16488a) : lower.contains('ciper') ? const Color(0xffb2272a) : lower.contains('biobio') ? const Color(0xff15578e) : lower.contains('vía x') || lower.contains('via x') ? const Color(0xffba2132) : lower.contains('adn') ? const Color(0xff203a79) : lower.contains('la tercera') || lower.contains('el mostrador') ? const Color(0xff1e2430) : defaultColor;
    final initials=name.split(RegExp(r'\s+')).where((w)=>w.isNotEmpty).take(3).map((w)=>w.characters.first.toUpperCase()).join();
    final words=voice ? 'la voz' : lower.contains('sin filtros') ? 'SIN\nFILTROS' : ciper ? 'CiPER' : lower.contains('biobio') ? 'RBB' : lower.contains('cooperativa') ? 'COOP' : lower.contains('vía x') || lower.contains('via x') ? 'X' : lower.contains('la tercera') ? 'LA\nTERCERA' : lower.contains('el mostrador') ? 'MOSTRADOR' : lower.contains('adn') ? 'ADN' : lower.contains('24 horas') ? '24H' : lower.contains('cnn') ? 'CNN' : lower.contains('t13') ? 'T13' : lower.contains('mega') ? 'MEGA' : lower.contains('chv') ? 'CHV' : initials;
    return Semantics(button:true,toggled:selected,label:'${source.name}, ${selected ? 'siguiendo' : 'no sigues'}',child:Material(color:Colors.white,borderRadius:BorderRadius.circular(14),elevation:1,child:InkWell(borderRadius:BorderRadius.circular(14),onTap:enabled && !busy ? onTap : null,child:Container(width:132,height:158,padding:const EdgeInsets.all(8),decoration:BoxDecoration(border:Border.all(color:const Color(0xffe4e0d4)),borderRadius:BorderRadius.circular(14)),child:Column(children:[
      Container(height:48,width:viaX ? 48 : 64,alignment:Alignment.center,decoration:BoxDecoration(color:color,shape:viaX ? BoxShape.circle : BoxShape.rectangle,borderRadius:viaX ? null : BorderRadius.circular(lower.contains('cooperativa') ? 24 : 8)),child:Column(mainAxisAlignment:MainAxisAlignment.center,children:[Text(words.isEmpty ? '?' : words,textAlign:TextAlign.center,style:TextStyle(color:voice || ciper || tercera ? const Color(0xff162032) : lower.contains('cooperativa') ? const Color(0xffffd34d) : Colors.white,fontFamily:tercera ? 'serif' : null,fontWeight:FontWeight.bold,fontSize:words.contains('\n') || words.length>7 ? 11 : 19,height:1)),if(voice) Container(width:48,height:3,color:const Color(0xffffcf18)),if(ciper || lower.contains('el mostrador')) const Text('●',style:TextStyle(color:Color(0xffc21f2b),fontSize:10,height:0.8)),if(lower.contains('biobio')) Container(width:36,height:3,color:const Color(0xffffa326)),if(lower.contains('adn')) Container(width:36,height:3,color:const Color(0xffe22b35))])),
      const SizedBox(height:4),Expanded(child:Center(child:Text(name,textAlign:TextAlign.center,maxLines:2,overflow:TextOverflow.ellipsis,style:const TextStyle(fontSize:13,fontWeight:FontWeight.w600,color:Color(0xff1a1a1a))))),
      const SizedBox(height:4),AnimatedContainer(duration:MediaQuery.disableAnimationsOf(context) ? Duration.zero : const Duration(milliseconds:180),height:30,width:double.infinity,decoration:BoxDecoration(color:selected ? const Color(0xffede9df) : Colors.white,borderRadius:BorderRadius.circular(15)),child:OutlinedButton(style:OutlinedButton.styleFrom(padding:EdgeInsets.zero,backgroundColor:Colors.transparent,foregroundColor:const Color(0xff162032),side:const BorderSide(color:Color(0xff162032)),shape:RoundedRectangleBorder(borderRadius:BorderRadius.circular(15))),onPressed:enabled && !busy ? onTap : null,child:FittedBox(child:Text(selected ? '✓ Siguiendo' : '+ Seguir',style:const TextStyle(fontSize:12))))),
    ])))));
  }
}
