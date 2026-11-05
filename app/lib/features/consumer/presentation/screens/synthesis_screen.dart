import 'dart:async';
import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_client.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/consumer/presentation/widgets/consumer_scaffold.dart';
import 'package:dialektik/features/consumer/presentation/widgets/dialectical_thread.dart';
import 'package:dialektik/features/live/data/chile_seismic_observations.dart';
import 'package:dialektik/features/live/data/youtube_video.dart';
import 'package:dialektik/features/live/presentation/chile_seismic_observations_panel.dart';
import 'package:dialektik/features/live/presentation/widgets/youtube_thumbnail.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

class SynthesisScreen extends StatefulWidget {
  const SynthesisScreen({required this.repository, required this.onOpenEvent, this.development=false, this.seismicRepository, this.externalLinkOpener=openExternalHttpLink, this.navigationActions=const [], this.refreshSignal, this.isVisible, super.key});
  final ConsumerRepository repository;
  final ValueChanged<String> onOpenEvent;
  final bool development;
  final SeismicObservationRepository? seismicRepository;
  final ExternalLinkOpener externalLinkOpener;
  final List<Widget> navigationActions;
  final Listenable? refreshSignal;
  final bool Function()? isVisible;
  @override State<SynthesisScreen> createState()=>_SynthesisScreenState();
}
class _SynthesisScreenState extends State<SynthesisScreen> {
  List<EventCardDto> events=[];
  Map<String,ContradictionDto> contrasts={};
  List<_ContrastEntry> contrastEntries=[];
  String topic='Todos';
  bool loading=true;
  Object? error;
  int generation=0;
  @override void initState(){super.initState();widget.refreshSignal?.addListener(_tabChanged);unawaited(_load());}
  void _tabChanged(){if(widget.isVisible?.call() == true) unawaited(_load());}
  @override void dispose(){widget.refreshSignal?.removeListener(_tabChanged);super.dispose();}
  Future<void> _load() async {
    final run=++generation;setState((){loading=true;error=null;});
    try {
      final allEvents=<EventCardDto>[], allContrasts=<ContradictionDto>[];
      String? cursor; final seen=<String>{};
      do { final repo=widget.repository; final page=await (repo is PublicApiClient ? repo.listFeed(cursor:cursor,limit:50,refresh:true,personalized:false) : repo.listFeed(cursor:cursor,limit:50,refresh:true)); allEvents.addAll(page.items);cursor=page.nextCursor;if(cursor!=null && !seen.add(cursor)) throw const FormatException('Invalid feed cursor'); } while(cursor!=null);
      seen.clear();
      do { final repo=widget.repository; final page=await (repo is PublicApiClient ? repo.listContradictions(cursor:cursor,limit:50,refresh:true,personalized:false) : repo.listContradictions(cursor:cursor,limit:50,refresh:true)); allContrasts.addAll(page.items);cursor=page.nextCursor;if(cursor!=null && !seen.add(cursor)) throw const FormatException('Invalid contrast cursor'); } while(cursor!=null);
      final byId={for(final e in allEvents)e.id:e};
      final missing=allContrasts.map((c)=>c.eventId).where((id)=>!byId.containsKey(id)).toSet();
      await Future.wait(missing.map((id) async { try { byId[id]=await _getUniversalEvent(widget.repository,id); } on Exception { /* Keep the publication visible even if its event cannot be loaded. */ } }));
      final entries=< _ContrastEntry >[for(final c in allContrasts) _ContrastEntry(byId[c.eventId],c)];
      final publishedIds=allContrasts.map((c)=>c.eventId).toSet();
      entries.addAll(allEvents.where((e)=>(e.synthesisRelation=='CONTRADICTION' || e.synthesisRelation=='DIFFERENT_FOCUS') && !publishedIds.contains(e.id)).map((e)=>_ContrastEntry(e,null)));
      if(!mounted || run!=generation)return;
      setState((){allEvents.sort((a,b)=>b.detectedAt.compareTo(a.detectedAt));events=allEvents;contrasts={for(final c in allContrasts)c.eventId:c};contrastEntries=entries;loading=false;});
    } on Exception catch(e){if(mounted && run==generation)setState((){error=e;loading=false;});}
  }
  bool isContrast(EventCardDto e)=>e.synthesisRelation=='CONTRADICTION' || e.synthesisRelation=='DIFFERENT_FOCUS' || contrasts.containsKey(e.id);
  @override Widget build(BuildContext context){
    final filtered=events.where((e)=>widget.development ? !isContrast(e) && (topic=='Todos' || _eventTopic(e)==topic) : isContrast(e)).toList();
    return ConsumerScaffold(title:widget.development ? 'Desarrollo' : 'VS',navigationActions:widget.navigationActions,body:ColoredBox(color:const Color(0xfffaf8f3),child:RefreshIndicator(onRefresh:_load,child:ListView(physics:const AlwaysScrollableScrollPhysics(),padding:const EdgeInsets.fromLTRB(20,12,20,20),children:[
      if(widget.development) ...[
        SingleChildScrollView(scrollDirection:Axis.horizontal, child:Row(children:[for(final choice in ['Todos','Política','Justicia','Economía','Seguridad','Deportes','Sociedad']) Padding(padding:const EdgeInsets.only(right:8),child:ChoiceChip(label:Text(choice),selected:topic==choice,onSelected:(_)=>setState(()=>topic=choice)))])),
        if(widget.seismicRepository case final SeismicObservationRepository seismic) ChileSeismicObservationsPanel(repository:seismic),
      ],
      if(loading && events.isEmpty) const Center(child:CircularProgressIndicator())
      else if(error!=null && events.isEmpty) TextButton(onPressed:()=>unawaited(_load()),child:const Text('No se pudieron cargar los acontecimientos. Reintentar'))
      else if(widget.development ? filtered.isEmpty : contrastEntries.isEmpty) const Padding(padding:EdgeInsets.all(16),child:Text('No hay acontecimientos en este filtro.'))
      else if(widget.development) for(final event in filtered) _DevelopmentCard(event:event,repository:widget.repository,opener:widget.externalLinkOpener)
      else for(final entry in contrastEntries) if(entry.event case final event?) _ContrastCard(event:event,contrast:entry.contrast,repository:widget.repository,onOpen:()=>widget.onOpenEvent(event.id))
        else Card(child:ListTile(title:Text(entry.contrast!.eventTitle),subtitle:const Text('No se pudo cargar el detalle de este contraste.'),onTap:()=>widget.onOpenEvent(entry.contrast!.eventId))),
    ]))));
  }
}
Future<EventDetailDto> _getUniversalEvent(ConsumerRepository repo,String id,{bool refresh=false}) => repo is PublicApiClient ? repo.getEvent(id,refresh:refresh,personalized:false) : repo.getEvent(id,refresh:refresh);
class _ContrastEntry {
  const _ContrastEntry(this.event,this.contrast);
  final EventCardDto? event; final ContradictionDto? contrast;
}
String _topic(String category) => switch(category.toLowerCase()) {
  'politica' || 'política' => 'Política', 'justicia' => 'Justicia', 'economia' || 'economía' => 'Economía',
  'seguridad' => 'Seguridad', 'deportes' => 'Deportes', 'sociedad' => 'Sociedad',
  _ => category.isEmpty ? 'Actualidad' : category,
};
String _eventTopic(EventCardDto event) {
  final category=_topic(event.category);
  if(const ['Política','Justicia','Economía','Seguridad','Deportes','Sociedad'].contains(category)) return category;
  final title=event.titleDescriptive.toLowerCase();
  final patterns=<String,String>{
    'Justicia':r'justicia|judicial|tribunal|corte|fiscal|condena',
    'Seguridad':r'seguridad|delito|polic|carabinero|crimen|migratori|robo',
    'Deportes':r'deporte|fútbol|futbol|tenis|colo.colo|campeonato|liga',
    'Economía':r'econom|inflación|inflacion|empleo|afp|banco|codelco|despido',
    'Política':r'polític|politic|gobierno|ministro|congreso|diputad|senador|elecci|presidente',
    'Sociedad':r'sociedad|salud|educaci|vivienda|familia|cultura|ambiente',
  };
  for(final entry in patterns.entries) { if(RegExp(entry.value).hasMatch(title)) return entry.key; }
  return category;
}
class _ContrastCard extends StatefulWidget {
  const _ContrastCard({required this.event,required this.contrast,required this.repository,required this.onOpen});
  final EventCardDto event; final ContradictionDto? contrast; final ConsumerRepository repository; final VoidCallback onOpen;
  @override State<_ContrastCard> createState()=>_ContrastCardState();
}
class _ContrastCardState extends State<_ContrastCard> {
  late Future<EventDetailDto> detail=_getUniversalEvent(widget.repository,widget.event.id);
  @override void didUpdateWidget(covariant _ContrastCard oldWidget){super.didUpdateWidget(oldWidget);if(oldWidget.event != widget.event)detail=_getUniversalEvent(widget.repository,widget.event.id,refresh:true);}
  @override Widget build(BuildContext context)=>Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
    Container(padding:const EdgeInsets.symmetric(horizontal:10,vertical:4),decoration:BoxDecoration(color:widget.event.synthesisRelation=='CONTRADICTION' ? const Color(0xffc86446) : const Color(0xffb47814),borderRadius:BorderRadius.circular(6)),child:Text('${widget.event.sourceCount} MEDIOS · ${widget.event.synthesisRelation=='CONTRADICTION' ? 'CONTRADICCIÓN' : widget.event.synthesisRelation=='DIFFERENT_FOCUS' ? 'DISTINTO ENFOQUE' : 'CONTRASTE'}',style:const TextStyle(fontSize:11,fontWeight:FontWeight.w700,color:Colors.white))),
    const SizedBox(height:8),Text(widget.event.titleDescriptive,style:Theme.of(context).textTheme.titleLarge),const SizedBox(height:10),
    FutureBuilder<EventDetailDto>(future:detail,builder:(context,snapshot){
      final data=snapshot.data;
      if(data==null) return snapshot.hasError ? const Text('No se pudieron cargar las fuentes.') : const SizedBox.shrink();
      final c=widget.contrast;
      final positions=(c == null ? data.coveragePositions.take(2) : data.coveragePositions.where((p)=>p.id==c.positionA.id || p.id==c.positionB.id)).toList();
      return DialecticalThread(event:data,positions:positions,relation:widget.event.synthesisRelation);
    }),
    TextButton(onPressed:widget.onOpen,style:TextButton.styleFrom(foregroundColor:const Color(0xff162032)),child:const Text('Ver fuentes originales →',style:TextStyle(fontWeight:FontWeight.w600))),
  ])));
}
class _DevelopmentCard extends StatefulWidget {
  const _DevelopmentCard({required this.event,required this.repository,required this.opener});
  final EventCardDto event; final ConsumerRepository repository; final ExternalLinkOpener opener;
  @override State<_DevelopmentCard> createState()=>_DevelopmentCardState();
}
class _DevelopmentCardState extends State<_DevelopmentCard> {
  late Future<EventDetailDto> detail=_getUniversalEvent(widget.repository,widget.event.id);
  @override void didUpdateWidget(covariant _DevelopmentCard oldWidget){super.didUpdateWidget(oldWidget);if(oldWidget.event != widget.event)detail=_getUniversalEvent(widget.repository,widget.event.id,refresh:true);}
  @override Widget build(BuildContext context)=>FutureBuilder<EventDetailDto>(future:detail,builder:(context,snapshot){
    final data=snapshot.data;
    final articles=[...?data?.articles]..sort((a,b)=>b.publishedAt.compareTo(a.publishedAt));
    return Card(child:ExpansionTile(title:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
      Text('${_eventTopic(widget.event)} · ${widget.event.sourceCount} fuentes',style:Theme.of(context).textTheme.labelMedium),
      const SizedBox(height:6),Text(widget.event.titleDescriptive,style:const TextStyle(fontWeight:FontWeight.w700)),
      if(data?.primaryFact?.statement case final String fact) Padding(padding:const EdgeInsets.only(top:6),child:Text(fact,maxLines:2,overflow:TextOverflow.ellipsis,style:Theme.of(context).textTheme.bodyMedium)),
    ]),childrenPadding:const EdgeInsets.fromLTRB(16,0,16,16),children:[
      if(snapshot.connectionState!=ConnectionState.done) const CircularProgressIndicator()
      else if(snapshot.hasError) const Text('No se pudieron cargar las noticias originales.')
      else if(articles.isEmpty) const Text('No hay noticias originales disponibles.')
      else for(final article in articles) Padding(padding:const EdgeInsets.only(top:12),child:InkWell(onTap:()=>unawaited(widget.opener(article.url)),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        if(extractYouTubeVideoId(article.url.toString()) case final String id) Padding(padding:const EdgeInsets.only(bottom:8),child:YouTubeThumbnail(videoId:id,onTap:()=>unawaited(widget.opener(article.url)))),
        Text('${DateFormat('dd/MM HH:mm').format(article.publishedAt.toLocal())} · ${article.sourceName}',style:const TextStyle(fontWeight:FontWeight.w700)),
        Text(article.title,style:const TextStyle(color:Color(0xff1a1a1a),fontWeight:FontWeight.w600)),
      ]))),
    ]));
  });
}
