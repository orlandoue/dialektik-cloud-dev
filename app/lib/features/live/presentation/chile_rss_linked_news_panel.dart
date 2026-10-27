import 'package:dialektik/features/consumer/presentation/external_links.dart';
import 'package:dialektik/features/live/data/chile_rss_linked_news.dart';
import 'package:dialektik/features/live/presentation/live_components.dart';
import 'package:flutter/material.dart';

/// Source-published RSS titles, never persisted Articles.
final class ChileRssLinkedNewsPanel extends StatefulWidget {
  const ChileRssLinkedNewsPanel({required this.repository,super.key});
  final ChileRssLinkedNewsRepository repository;
  @override
  State<ChileRssLinkedNewsPanel> createState()=>_ChileRssLinkedNewsPanelState();
}
final class _ChileRssLinkedNewsPanelState extends State<ChileRssLinkedNewsPanel> {
  late Future<ChileRssLinkedNews> _future;
  bool _showAll=false;
  @override
  void initState(){
    super.initState();
    _future=widget.repository.loadChileRssLinkedNews(refresh:true);
  }
  void _refresh()=>setState((){
    _showAll=false;
    _future=widget.repository.loadChileRssLinkedNews(refresh:true);
  });
  @override
  Widget build(BuildContext context)=>Card(
    key:const Key('chile-live-rss-linked-feed'),
    child:Padding(
      padding:const EdgeInsets.all(16),
      child:Column(
        crossAxisAlignment:CrossAxisAlignment.start,
        children:<Widget>[
          Row(children:<Widget>[
            const Icon(Icons.rss_feed,size:21),
            const SizedBox(width:10),
            Expanded(child:Text('Titulares RSS · Chile',
              style:Theme.of(context).textTheme.titleMedium)),
            IconButton(
              tooltip:'Actualizar titulares RSS',
              onPressed:_refresh,
              icon:const Icon(Icons.refresh),
            ),
          ]),
          const SizedBox(height:4),
          Text(
            'Enlaces directos al medio original · Diario El Día. Vista RSS en vivo, no incorporada ni analizada en la base.',
            style:Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height:10),
          FutureBuilder<ChileRssLinkedNews>(
            future:_future,
            builder:(BuildContext context,AsyncSnapshot<ChileRssLinkedNews> snapshot){
              if(snapshot.connectionState!=ConnectionState.done){
                return const LinearProgressIndicator();
              }
              if(snapshot.hasError||!snapshot.hasData){
                return TextButton.icon(
                  onPressed:_refresh,
                  icon:const Icon(Icons.refresh),
                  label:const Text('Reintentar titulares RSS'),
                );
              }
              final ChileRssLinkedNews data=snapshot.data!;
              if(data.items.isEmpty){
                return const Text('El canal RSS no tiene titulares recientes verificables.');
              }
              final Iterable<ChileRssLink> displayed=_showAll?
                data.items:data.items.take(3);
              return Column(
                crossAxisAlignment:CrossAxisAlignment.start,
                children:<Widget>[
                  Text('${data.items.length} enlaces originales · actualizado ${_date(data.fetchedAt)}',
                    style:Theme.of(context).textTheme.bodySmall),
                  const SizedBox(height:8),
                  for(final ChileRssLink item in displayed)
                    Padding(
                      padding:const EdgeInsets.symmetric(vertical:8),
                      child:Column(
                        crossAxisAlignment:CrossAxisAlignment.start,
                        children:<Widget>[
                          Text(item.headline,style:Theme.of(context).textTheme.titleSmall),
                          const SizedBox(height:4),
                          Text('${item.publisher} · ${_date(item.publishedAt)}',
                            style:Theme.of(context).textTheme.bodySmall),
                          LiveExternalAction(
                            uri:item.originalUrl,
                            opener:openExternalHttpLink,
                            label:'Leer en el medio original',
                          ),
                        ],
                      ),
                    ),
                  if(data.items.length>6)
                    TextButton(
                      onPressed:()=>setState(()=>_showAll=!_showAll),
                      child:Text(_showAll?'Mostrar menos':'Ver todos los titulares RSS'),
                    ),
                ],
              );
            },
          ),
        ],
      ),
    ),
  );
  String _date(DateTime d){
    final DateTime local=d.toLocal();
    String n(int v)=>v.toString().padLeft(2,'0');
    return '${n(local.day)}/${n(local.month)} ${n(local.hour)}:${n(local.minute)}';
  }
}
