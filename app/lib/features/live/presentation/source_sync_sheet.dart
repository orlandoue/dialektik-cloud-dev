import 'package:dialektik/features/consumer/data/source_sync_repository.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:flutter/material.dart';

class SourceSyncSelection {
  const SourceSyncSelection(this.ids,this.truncated);
  final Set<String> ids;
  final bool truncated;
}
/// X accounts are entered explicitly; a username alone cannot reveal follows.
Set<String> matchPastedXHandles(String input,List<LiveSourceDto> sources) {
  const aliases=<String,List<String>>{
    'biobio':['biobiochile'], 'latercera':['la tercera'], 'elmostrador':['el mostrador'],
    'ciper':['ciper'], 'cooperativa':['cooperativa'], 'adnradiochile':['adn chile'],
    't13':['t13'], 'meganoticiascl':['meganoticias'], '24horascl':['24 horas'],
    'chvnoticias':['chv noticias'], 'cnnchile':['cnn chile'], 'sinfiltrostv':['sin filtros'],
    'vozdelosquesobran':['voz de los que sobran'], 'elliberocl':['el líbero','el libero'],
    'thecliniccl':['the clinic'], 'eldesconcierto':['el desconcierto'],
    'el_ciudadano':['el ciudadano'], 'fastcheckcl':['fast check'], 'eldia_cl':['diario el día','diario el dia'],
  };
  final handles=RegExp(r'@[A-Za-z0-9_]{1,15}').allMatches(input).map((m)=>m.group(0)!.substring(1).toLowerCase()).toSet();
  final names=handles.expand((handle)=>aliases[handle] ?? const <String>[]).toSet();
  return sources.where((source)=>names.any((name)=>source.name.toLowerCase().contains(name))).map((source)=>source.id).toSet();
}
class SourceSyncSheet extends StatefulWidget {
  const SourceSyncSheet({required this.sources,required this.lookup,super.key});
  final List<LiveSourceDto> sources;
  final SourceSyncRepository? lookup;
  @override State<SourceSyncSheet> createState()=>_SourceSyncSheetState();
}
class _SourceSyncSheetState extends State<SourceSyncSheet> {
  final input=TextEditingController();
  String? choice,error;
  bool loading=false;
  @override void dispose(){input.dispose();super.dispose();}
  Future<void> submit() async {
    if(loading)return;
    setState((){loading=true;error=null;});
    try {
      if(choice=='youtube') {
        final service=widget.lookup;
        if(service==null) {setState(()=>error='La consulta de YouTube no está disponible en esta versión.');return;}
        final result=await service.lookupPublicYouTubeSubscriptions(input.text.trim());
        if(!mounted)return;
        if(result.sourceIds.isEmpty) {setState(()=>error='No se encontraron canales del catálogo en las suscripciones públicas.');return;}
        Navigator.of(context).pop(SourceSyncSelection(result.sourceIds,result.truncated));
      } else {
        final ids=matchPastedXHandles(input.text,widget.sources);
        if(ids.isEmpty) {setState(()=>error='No encontramos cuentas del catálogo. Pega los @usuarios de los medios, no tu propio usuario.');return;}
        Navigator.of(context).pop(SourceSyncSelection(ids,false));
      }
    } on Exception {
      if(mounted)setState(()=>error=choice=='youtube' ? 'No se pudo consultar YouTube. Comprueba el canal y que sus suscripciones sean públicas.' : 'No se pudo completar la consulta.');
    } finally {if(mounted)setState(()=>loading=false);}
  }
  @override Widget build(BuildContext context)=>SafeArea(child:Padding(padding:EdgeInsets.fromLTRB(20,20,20,20+MediaQuery.viewInsetsOf(context).bottom),child:SingleChildScrollView(child:Column(mainAxisSize:MainAxisSize.min,crossAxisAlignment:CrossAxisAlignment.stretch,children:[
    Text('¿Desde dónde quieres sincronizar tus fuentes?',style:Theme.of(context).textTheme.titleLarge),const SizedBox(height:12),
    if(choice==null) ...[
      ListTile(leading:const Icon(Icons.play_circle_outline),title:const Text('Sincronizar con YouTube'),subtitle:const Text('Busca suscripciones públicas de un canal.'),onTap:()=>setState(()=>choice='youtube')),
      ListTile(leading:const Text('𝕏',style:TextStyle(fontSize:24)),title:const Text('Sincronizar con X'),subtitle:const Text('Pega las cuentas de medios que sigues.'),onTap:()=>setState(()=>choice='x')),
    ] else ...[
      Text(choice=='youtube' ? 'Ingresa el @handle o ID de canal. Solo se pueden consultar suscripciones públicas; no conectamos tu cuenta.' : 'Pega los @usuarios de los medios que sigues. No accedemos a tu cuenta de X.'),
      TextField(controller:input,maxLength:choice=='youtube' ? 32 : 3000,maxLines:choice=='youtube' ? 1 : 4,decoration:InputDecoration(labelText:choice=='youtube' ? '@handle o ID de canal' : '@biobio, @ciper, …')),
      if(error!=null) Text(error!,style:TextStyle(color:Theme.of(context).colorScheme.error)),
      FilledButton(onPressed:loading ? null : submit,child:Text(loading ? 'Consultando…' : 'Buscar y seguir coincidencias')),
      TextButton(onPressed:loading ? null : ()=>setState((){choice=null;error=null;input.clear();}),child:const Text('Volver')),
    ],
  ]))));
}
