import 'dart:async';
import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/following_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/widgets/consumer_scaffold.dart';
import 'package:dialektik/features/live/data/chile_seismic_observations.dart';
import 'package:dialektik/features/live/presentation/chile_seismic_observations_panel.dart';
import 'package:flutter/material.dart';

class SynthesisScreen extends StatefulWidget {
  const SynthesisScreen({required this.repository, required this.onOpenEvent, this.seismicRepository, this.navigationActions=const [], super.key});
  final ConsumerRepository repository;
  final ValueChanged<String> onOpenEvent;
  final SeismicObservationRepository? seismicRepository;
  final List<Widget> navigationActions;
  @override State<SynthesisScreen> createState()=>_SynthesisScreenState();
}
class _SynthesisScreenState extends State<SynthesisScreen> {
  List<EventCardDto> events=[];
  Map<String,ContradictionDto> contrasts={};
  int followingCount=0;
  String filter='all';
  bool loading=true;
  Object? error;
  int generation=0;
  FollowingRepository? get following => widget.repository is FollowingRepository && (widget.repository as FollowingRepository).followingAvailable ? widget.repository as FollowingRepository : null;
  @override void initState(){super.initState();following?.followingChanges.addListener(_reload);unawaited(_load());}
  @override void dispose(){following?.followingChanges.removeListener(_reload);super.dispose();}
  void _reload()=>unawaited(_load());
  Future<void> _load() async {
    final run=++generation;setState((){loading=true;error=null;});
    try {
      final allEvents=<EventCardDto>[], allContrasts=<ContradictionDto>[];
      String? cursor;
      final seen=<String>{};
      do { final page=await widget.repository.listFeed(cursor:cursor,limit:50,refresh:true); allEvents.addAll(page.items);cursor=page.nextCursor;if(cursor!=null && !seen.add(cursor)) throw const FormatException('Invalid feed cursor'); } while(cursor!=null);
      seen.clear();
      do { final page=await widget.repository.listContradictions(cursor:cursor,limit:50,refresh:true); allContrasts.addAll(page.items);cursor=page.nextCursor;if(cursor!=null && !seen.add(cursor)) throw const FormatException('Invalid contrast cursor'); } while(cursor!=null);
      final followed=await following?.listFollowedSources() ?? <String>{};
      if(!mounted || run!=generation)return;
      setState((){events=allEvents;contrasts={for(final c in allContrasts)c.eventId:c};followingCount=followed.length;loading=false;});
    } on Exception catch(e){if(mounted && run==generation)setState((){error=e;loading=false;});}
  }
  @override Widget build(BuildContext context){
    final filtered=events.where((e)=>switch(filter){
      'contrast'=>contrasts.containsKey(e.id),
      'followed'=>e.isFollowedSourceMatch,
      'blind'=>followingCount>0 && !e.isFollowedSourceMatch && (e.sourceCount>=2 || contrasts.containsKey(e.id)),
      _=>true,
    }).toList();
    return ConsumerScaffold(title:'Síntesis',navigationActions:widget.navigationActions,body:ListView(padding:const EdgeInsets.all(20),children:[
      const Text('SÍNTESIS · ACONTECIMIENTOS Y CONTRASTES ENTRE MEDIOS'),
      SingleChildScrollView(scrollDirection:Axis.horizontal,child:Row(children:[
        for(final choice in [('all','Todo (${events.length})'),('contrast','Con contraste (${contrasts.length})'),('followed','En tus fuentes'),('blind','Punto ciego')])
          Padding(padding:const EdgeInsets.only(right:8),child:ChoiceChip(label:Text(choice.$2),selected:filter==choice.$1,onSelected:(_)=>setState(()=>filter=choice.$1))),
      ])),
      if(widget.seismicRepository case final SeismicObservationRepository seismic) ChileSeismicObservationsPanel(repository:seismic),
      if(loading) const Center(child:CircularProgressIndicator())
      else if(error!=null) TextButton(onPressed:_reload,child:const Text('No se pudieron cargar los acontecimientos. Reintentar'))
      else if(filtered.isEmpty) const Padding(padding:EdgeInsets.all(16),child:Text('No hay acontecimientos en este filtro.'))
      else for(final event in filtered) _SynthesisCard(event:event, contrast:contrasts[event.id],repository:widget.repository,onOpen:()=>widget.onOpenEvent(event.id)),
    ]));
  }
}
class _SynthesisCard extends StatefulWidget {
  const _SynthesisCard({required this.event,required this.contrast,required this.repository,required this.onOpen});
  final EventCardDto event; final ContradictionDto? contrast; final ConsumerRepository repository;final VoidCallback onOpen;
  @override State<_SynthesisCard> createState()=>_SynthesisCardState();
}
class _SynthesisCardState extends State<_SynthesisCard> {
  late Future<EventDetailDto> detail=widget.repository.getEvent(widget.event.id);
  @override void didUpdateWidget(covariant _SynthesisCard oldWidget){super.didUpdateWidget(oldWidget);if(oldWidget.event.id!=widget.event.id)detail=widget.repository.getEvent(widget.event.id);}
  @override Widget build(BuildContext context)=>Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
    Text(widget.contrast==null ? 'COBERTURA · ${widget.event.sourceCount} MEDIOS' : 'CONTRASTE DETECTADO · 2 POSTURAS'),
    if(widget.event.isFollowedSourceMatch) const Text('En tus fuentes'),
    Text(widget.event.titleDescriptive,style:Theme.of(context).textTheme.titleLarge),
    FutureBuilder<EventDetailDto>(future:detail,builder:(context,snapshot){
      final data=snapshot.data;if(data==null)return const SizedBox.shrink();
      if(widget.contrast==null)return Text(data.articles.map((a)=>a.sourceName).toSet().join(' · '));
      final c=widget.contrast!;
      final selected=data.coveragePositions.where((p)=>p.id==c.positionA.id || p.id==c.positionB.id);
      return Column(crossAxisAlignment:CrossAxisAlignment.start,children:[for(final p in selected) Text('${p.assertions.map((a)=>a.sourceName).toSet().join(', ')}: ${p.title}')]);
    }),
    TextButton(onPressed:widget.onOpen,child:const Text('Ver síntesis y noticias originales →')),
  ])));
}
