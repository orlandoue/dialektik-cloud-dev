import 'dart:async';

import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/data/story_follow_store.dart';
import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/consumer/presentation/widgets/consumer_scaffold.dart';
import 'package:dialektik/features/consumer/presentation/widgets/share_synthesis.dart';
import 'package:dialektik/features/consumer/presentation/widgets/story_follow_button.dart';
import 'package:dialektik/features/consumer/presentation/widgets/synthesis_transparency.dart';
import 'package:dialektik/features/live/data/chile_seismic_observations.dart';
import 'package:dialektik/features/live/data/youtube_video.dart';
import 'package:dialektik/features/live/presentation/chile_seismic_observations_panel.dart';
import 'package:dialektik/features/live/presentation/widgets/youtube_thumbnail.dart';
import 'package:flutter/material.dart';

class SynthesisScreen extends StatefulWidget {
  const SynthesisScreen({required this.repository, required this.onOpenEvent, this.seismicRepository, this.externalLinkOpener=openExternalHttpLink, this.navigationActions=const [], this.refreshSignal, this.isVisible, super.key});
  final ConsumerRepository repository;
  final ValueChanged<String> onOpenEvent;
  final SeismicObservationRepository? seismicRepository;
  final ExternalLinkOpener externalLinkOpener;
  final List<Widget> navigationActions;
  final Listenable? refreshSignal;
  final bool Function()? isVisible;
  @override State<SynthesisScreen> createState()=>_SynthesisScreenState();
}
class _SynthesisScreenState extends State<SynthesisScreen> {
  late final StoryFollowStore stories=StoryFollowStore.forRepository(widget.repository);
  List<EventCardDto> events=[];
  Map<String,ContradictionDto> contrasts={};
  String filter='all';
  bool loading=true;
  Object? error;
  int generation=0;
  @override void initState(){super.initState();stories.addListener(_storyChanged);widget.refreshSignal?.addListener(_tabChanged);unawaited(stories.load().catchError((Object _) {}));unawaited(_load());}
  void _tabChanged(){if(widget.isVisible?.call() == true) unawaited(_load());}
  void _storyChanged(){if(mounted)setState((){});}
  @override void dispose(){widget.refreshSignal?.removeListener(_tabChanged);stories.removeListener(_storyChanged);super.dispose();}
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
      if(!mounted || run!=generation)return;
      stories.rememberRelations(allEvents);
      setState((){allEvents.sort((a,b)=>b.detectedAt.compareTo(a.detectedAt));events=allEvents;contrasts={for(final c in allContrasts)c.eventId:c};loading=false;});
    } on Exception catch(e){if(mounted && run==generation)setState((){error=e;loading=false;});}
  }
  @override Widget build(BuildContext context){
    final filtered=events.where((e)=>filter=='all' || (filter=='FOLLOWING' ? stories.contains(e.id) : e.synthesisRelation==filter)).toList();
    return ConsumerScaffold(title:'Síntesis',navigationActions:widget.navigationActions,body:ColoredBox(color:const Color(0xfffaf8f3),child:RefreshIndicator(onRefresh:_load,child:ListView(physics:const AlwaysScrollableScrollPhysics(),padding:const EdgeInsets.all(20),children:[
      SingleChildScrollView(scrollDirection:Axis.horizontal, padding:const EdgeInsets.symmetric(horizontal:16), clipBehavior:Clip.none, child:Row(children:[
        for(final choice in [('all','Todo'),('CONTRADICTION','Contradicción'),('DIFFERENT_FOCUS','Distinto enfoque'),('DEVELOPING','En desarrollo'),('TREND','Tendencia'),('FOLLOWING','Siguiendo')])
          Padding(padding:const EdgeInsets.only(right:8),child:ChoiceChip(label:Text(choice.$2),selected:filter==choice.$1,onSelected:(_)=>setState(()=>filter=choice.$1))),
      ])),
      if(widget.seismicRepository case final SeismicObservationRepository seismic) ChileSeismicObservationsPanel(repository:seismic),
      if(loading && events.isEmpty) const Center(child:CircularProgressIndicator())
      else if(error!=null && events.isEmpty) TextButton(onPressed:_reload,child:const Text('No se pudieron cargar los acontecimientos. Reintentar'))
      else if(filtered.isEmpty) const Padding(padding:EdgeInsets.all(16),child:Text('No hay acontecimientos en este filtro.'))
      else for(final event in filtered) _SynthesisCard(event:event, contrast:contrasts[event.id],repository:widget.repository,externalLinkOpener:widget.externalLinkOpener,onOpen:()=>widget.onOpenEvent(event.id)),
    ]))));
  }
}
class _SynthesisCard extends StatefulWidget {
  const _SynthesisCard({required this.event,required this.contrast,required this.repository,required this.externalLinkOpener,required this.onOpen});
  final EventCardDto event; final ContradictionDto? contrast; final ConsumerRepository repository;final ExternalLinkOpener externalLinkOpener;final VoidCallback onOpen;
  @override State<_SynthesisCard> createState()=>_SynthesisCardState();
}
class _SynthesisCardState extends State<_SynthesisCard> {
  late Future<EventDetailDto> detail=widget.repository.getEvent(widget.event.id);
  @override void didUpdateWidget(covariant _SynthesisCard oldWidget){super.didUpdateWidget(oldWidget);if(oldWidget.event != widget.event)detail=widget.repository.getEvent(widget.event.id,refresh:true);}
  Widget badge(String text, Color background, Color foreground) => Container(
    padding:const EdgeInsets.symmetric(horizontal:10,vertical:4),
    decoration:BoxDecoration(color:background,borderRadius:BorderRadius.circular(6)),
    child:Text(text,style:TextStyle(fontSize:11,fontWeight:FontWeight.w700,color:foreground)),
  );
  @override Widget build(BuildContext context)=>Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
    badge(switch(widget.event.synthesisRelation) {
      'CONTRADICTION' => 'CONTRADICCIÓN · ${widget.event.sourceCount} MEDIOS',
      'DIFFERENT_FOCUS' => 'DISTINTO ENFOQUE · ${widget.event.sourceCount} MEDIOS',
      'DEVELOPING' => 'EN DESARROLLO · ${widget.event.sourceCount} MEDIOS',
      'TREND' => 'TENDENCIA · ${widget.event.sourceCount} MEDIOS',
      _ => 'COBERTURA · ${widget.event.sourceCount} MEDIOS',
    }, switch(widget.event.synthesisRelation) {
      'CONTRADICTION' => const Color(0xfffde8e8),
      'DIFFERENT_FOCUS' => const Color(0xfffff3cd),
      'DEVELOPING' => const Color(0xffe0e7ff),
      'TREND' => const Color(0xffdef7ec),
      _ => const Color(0xffedf2f7),
    }, switch(widget.event.synthesisRelation) {
      'CONTRADICTION' => const Color(0xff9b1c1c),
      'DIFFERENT_FOCUS' => const Color(0xff7a4f08),
      'DEVELOPING' => const Color(0xff1e40af),
      'TREND' => const Color(0xff03543f),
      _ => const Color(0xff2d3748),
    }),
    const SizedBox(height:8),
    Text(widget.event.titleDescriptive,style:Theme.of(context).textTheme.titleLarge),
    const SizedBox(height:10),
    FutureBuilder<EventDetailDto>(future:detail,builder:(context,snapshot){
      final data=snapshot.data;if(data==null)return const SizedBox.shrink();
      final videos=data.articles.where((a)=>extractYouTubeVideoId(a.url.toString())!=null).toList();
      final videoRows=<Widget>[for(final article in videos) Padding(padding:const EdgeInsets.symmetric(vertical:6),child:Row(children:[
        SizedBox(width:96,child:YouTubeThumbnail(videoId:extractYouTubeVideoId(article.url.toString())!,compact:true,onTap:()=>unawaited(widget.externalLinkOpener(article.url)))),
        const SizedBox(width:10),Expanded(child:TextButton(onPressed:()=>unawaited(widget.externalLinkOpener(article.url)),child:Text('${article.sourceName.replaceAll('(YouTube)', '').trim()} · ${article.title}'))),
      ]))];
      if(widget.contrast==null || (widget.event.synthesisRelation != 'CONTRADICTION' && widget.event.synthesisRelation != 'DIFFERENT_FOCUS')) { return Column(crossAxisAlignment:CrossAxisAlignment.start,children:[...videoRows, Wrap(spacing:8,runSpacing:4,children:[
        for(final name in data.articles.where((a)=>extractYouTubeVideoId(a.url.toString())==null).map((a)=>a.sourceName).toSet())
          Text(name.contains('(YouTube)') ? '${name.replaceAll('(YouTube)', '').trim()} · ▶ Video' : name),
      ])]); }
      final c=widget.contrast!;
      final selected=data.coveragePositions.where((p)=>p.id==c.positionA.id || p.id==c.positionB.id);
      return Column(crossAxisAlignment:CrossAxisAlignment.start,children:[...videoRows,for(final p in selected)
        Container(margin:const EdgeInsets.only(bottom:8),padding:const EdgeInsets.all(10),
          decoration:BoxDecoration(color:const Color(0xfff7f5ee),border:Border.all(color:const Color(0xffe2dec9)),borderRadius:BorderRadius.circular(8)),
          child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
            Text(p.assertions.map((a)=>a.sourceName.replaceAll('(YouTube)', '').trim()).toSet().join(', '),style:const TextStyle(fontSize:12,fontWeight:FontWeight.w700,color:Color(0xff1e293b))),
            Text(p.title,style:const TextStyle(fontSize:13.5,color:Color(0xff334155),height:1.35)),
          ])),
      ]);
    }),
    FutureBuilder<EventDetailDto>(future:detail,builder:(context,snapshot) {
      final data=snapshot.data; if(data==null)return const SizedBox.shrink();
      final store=StoryFollowStore.forRepository(widget.repository);
      return ListenableBuilder(listenable:store,builder:(context,_) {
        final seen=store.snapshot(data.id);
        final latest=[...data.articles]..sort((a,b)=>b.publishedAt.compareTo(a.publishedAt));
        final newer=seen==null ? <EventCoverageArticleDto>[] : latest.where((article)=>article.publishedAt.isAfter(seen.seenAt)).toList();
        final updated=seen!=null && (data.sourceCount>seen.sourceCount || data.articles.length>seen.articleCount || newer.isNotEmpty);
        return Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
          if(updated) Text('Actualizado · Nuevos aportes${newer.isEmpty ? '' : ' · ${newer.first.sourceName}'}'),
          StoryFollowButton(repository:widget.repository,event:data),
        ]);
      });
    }),
    FutureBuilder<EventDetailDto>(future:detail,builder:(context,snapshot) => TextButton.icon(
      onPressed:snapshot.hasData ? () => showSynthesisSharePreview(context,snapshot.data!,relation:widget.event.synthesisRelation) : null,
      icon:const Icon(Icons.share_outlined),label:const Text('Compartir síntesis'))),
    FutureBuilder<EventDetailDto>(future:detail,builder:(context,snapshot) => snapshot.hasData
      ? SynthesisTransparency(event:snapshot.data!,relation:widget.event.synthesisRelation) : const SizedBox.shrink()),
    TextButton(onPressed:widget.onOpen,child:const Text('Ver síntesis y noticias originales →')),
  ])));
}
