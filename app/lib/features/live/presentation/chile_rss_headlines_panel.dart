import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/live/data/chile_rss_links.dart';
import 'package:dialektik/features/live/presentation/live_components.dart';
import 'package:flutter/material.dart';

/// First source-backed RSS discovery, separate from persisted and analyzed news.
final class ChileRssHeadlinesPanel extends StatefulWidget {
  const ChileRssHeadlinesPanel({required this.repository,super.key});
  final ChileRssLinksRepository repository;

  @override
  State<ChileRssHeadlinesPanel> createState()=>_ChileRssHeadlinesPanelState();
}
final class _ChileRssHeadlinesPanelState extends State<ChileRssHeadlinesPanel>{
  late Future<ChileRssLinksPreview> _load;
  bool _showAll=false;

  @override
  void initState(){
    super.initState();
    _load=widget.repository.loadChileRssLinks(refresh:true);
  }
  void _refresh(){
    setState((){
      _showAll=false;
      _load=widget.repository.loadChileRssLinks(refresh:true);
    });
  }

  @override
  Widget build(BuildContext context)=>Card(
    key:const Key('chile-rss-live-links'),
    child:Padding(
      padding:const EdgeInsets.all(16),
      child:Column(
        crossAxisAlignment:CrossAxisAlignment.start,
        children:<Widget>[
          Row(children:<Widget>[
            const Icon(Icons.rss_feed,size:23),
            const SizedBox(width:10),
            Expanded(
              child:Text('Titulares RSS en vivo',
                style:Theme.of(context).textTheme.titleMedium),
            ),
            IconButton(
              tooltip:'Actualizar titulares RSS',
              onPressed:_refresh,
              icon:const Icon(Icons.refresh),
            ),
          ]),
          Text(
            'Enlaces originales · Cooperativa.cl · Vista beta no archivada',
            style:Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height:12),
          FutureBuilder<ChileRssLinksPreview>(
            future:_load,
            builder:(context,snapshot){
              if(snapshot.connectionState!=ConnectionState.done){
                return const LinearProgressIndicator();
              }
              if(snapshot.hasError||!snapshot.hasData){
                return Column(
                  crossAxisAlignment:CrossAxisAlignment.start,
                  children:<Widget>[
                    const Text('No se pudieron consultar los titulares RSS.'),
                    TextButton(
                      onPressed:_refresh,
                      child:const Text('Reintentar RSS'),
                    ),
                  ],
                );
              }
              final ChileRssLinksPreview data=snapshot.data!;
              final Iterable<ChileRssLink> shown=_showAll
                  ?data.items:data.items.take(3);
              return Column(
                crossAxisAlignment:CrossAxisAlignment.start,
                children:<Widget>[
                  for(final ChileRssLink item in shown)
                    Padding(
                      padding:const EdgeInsets.only(bottom:14),
                      child:Column(
                        crossAxisAlignment:CrossAxisAlignment.start,
                        children:<Widget>[
                          Text(item.headline,
                            style:Theme.of(context).textTheme.titleSmall),
                          const SizedBox(height:4),
                          Text(
                            'Cooperativa · ${_localDate(item.publishedAt)}',
                            style:Theme.of(context).textTheme.bodySmall,
                          ),
                          LiveExternalAction(
                            uri:item.canonicalUrl,
                            opener:openExternalHttpLink,
                            label:'Leer en Cooperativa',
                          ),
                        ],
                      ),
                    ),
                  if(data.items.length>3)
                    TextButton(
                      onPressed:()=>setState(()=>_showAll=!_showAll),
                      child:Text(_showAll
                          ?'Mostrar menos titulares'
                          :'Ver los ${data.items.length} titulares RSS'),
                    ),
                  Text(
                    'RSS obtenido del medio original. No se almacena el artículo ni se infieren acontecimientos o contradicciones.',
                    style:Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              );
            },
          ),
        ],
      ),
    ),
  );

  String _localDate(DateTime at){
    final DateTime d=at.toLocal();
    String two(int n)=>n.toString().padLeft(2,'0');
    return '${two(d.day)}/${two(d.month)}/${d.year} '
        '${two(d.hour)}:${two(d.minute)}';
  }
}
