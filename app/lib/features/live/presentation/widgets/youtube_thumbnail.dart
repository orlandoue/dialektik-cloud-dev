import 'package:dialektik/features/live/data/youtube_video.dart';
import 'package:flutter/material.dart';

/// Displays official YouTube artwork; tapping opens the original video.
class YouTubeThumbnail extends StatelessWidget {
  const YouTubeThumbnail({required this.videoId, this.onTap, this.compact=false, super.key});
  final String videoId;
  final VoidCallback? onTap;
  final bool compact;
  @override Widget build(BuildContext context) {
    final artwork = ClipRRect(borderRadius:BorderRadius.circular(compact ? 8 : 12), child:AspectRatio(aspectRatio:16/9,child:Stack(fit:StackFit.expand,children:[
      Image.network(youTubeThumbnailUrl(videoId),fit:BoxFit.cover,
        loadingBuilder:(context,child,progress)=>progress==null ? child : const ColoredBox(color:Color(0xff111622),child:Center(child:CircularProgressIndicator())),
        errorBuilder:(context,error,stack)=>const ColoredBox(color:Color(0xff111622),child:Center(child:Icon(Icons.ondemand_video,color:Colors.white70)))),
      const DecoratedBox(decoration:BoxDecoration(gradient:LinearGradient(begin:Alignment.topCenter,end:Alignment.bottomCenter,colors:[Color(0x26000000),Color(0x8c000000)]))),
      Center(child:Container(width:compact ? 28 : 54,height:compact ? 28 : 54,decoration:BoxDecoration(color:const Color(0xd9111622),shape:BoxShape.circle,border:Border.all(color:Colors.white24)),
        child:Icon(Icons.play_arrow_rounded,color:Colors.white,size:compact ? 20 : 34))),
      if(!compact) Positioned(left:10,bottom:10,child:DecoratedBox(decoration:BoxDecoration(color:const Color(0xcc0f172a),borderRadius:BorderRadius.circular(6)),child:const Padding(padding:EdgeInsets.symmetric(horizontal:8,vertical:4),child:Row(mainAxisSize:MainAxisSize.min,children:[Icon(Icons.play_circle_fill,color:Color(0xffff0000),size:16),SizedBox(width:5),Text('Ver en YouTube',style:TextStyle(color:Colors.white,fontSize:12))])))),
    ])));
    return onTap == null ? artwork : Semantics(button:true,label:'Abrir video en YouTube',onTap:onTap,excludeSemantics:true,child:InkWell(onTap:onTap,child:artwork));
  }
}

class YouTubeNewsCard extends StatelessWidget {
  const YouTubeNewsCard({required this.videoId,required this.title,required this.source,required this.published,required this.onTap,this.followed=false,this.compact=false,super.key});
  final String videoId,title,source,published;
  final bool followed, compact;
  final VoidCallback onTap;
  @override Widget build(BuildContext context)=>Semantics(button:true,onTap:onTap,excludeSemantics:true,label:'Abrir video en YouTube: $title. $source. Publicado $published',child:Card(clipBehavior:Clip.antiAlias,child:InkWell(onTap:onTap,child:Padding(padding:const EdgeInsets.all(12),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
    if (compact) Row(crossAxisAlignment:CrossAxisAlignment.start,children:[
      SizedBox(width:128,child:YouTubeThumbnail(videoId:videoId,compact:true)),
      const SizedBox(width:10),
      Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        if(followed) const Text('En tus fuentes'),
        Text(source,style:Theme.of(context).textTheme.labelLarge),
        Text(title,style:Theme.of(context).textTheme.titleMedium),Text(published),
      ])),
    ]) else ...[
    YouTubeThumbnail(videoId:videoId), const SizedBox(height:10),
    if(followed) const Text('En tus fuentes'),
    Text(source,style:Theme.of(context).textTheme.labelLarge),const SizedBox(height:4),
    Text(title,style:Theme.of(context).textTheme.titleLarge),const SizedBox(height:4),Text(published),
    ],
  ])))));
}
