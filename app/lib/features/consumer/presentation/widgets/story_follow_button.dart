import 'dart:async';

import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/data/story_follow_store.dart';
import 'package:flutter/material.dart';

class StoryFollowButton extends StatefulWidget {
  const StoryFollowButton({required this.repository,required this.event,super.key});
  final ConsumerRepository repository;
  final EventDetailDto event;
  @override State<StoryFollowButton> createState() => _StoryFollowButtonState();
}
class _StoryFollowButtonState extends State<StoryFollowButton> {
  late final StoryFollowStore store = StoryFollowStore.forRepository(widget.repository);
  bool busy = false;
  @override void initState() { super.initState(); unawaited(store.load().catchError((Object _) {})); }
  Future<void> toggle() async {
    setState(() => busy=true);
    try { await store.setFollowing(widget.event,following:!store.contains(widget.event.id)); }
    on Object { if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('No se pudo guardar el seguimiento.'))); }
    finally { if(mounted) setState(() => busy=false); }
  }
  @override Widget build(BuildContext context) => ListenableBuilder(listenable:store,builder:(context,_) => TextButton.icon(
    onPressed:store.available && !busy ? toggle : null,
    icon:Icon(store.contains(widget.event.id) ? Icons.star : Icons.star_border),
    label:Text(store.contains(widget.event.id) ? 'Siguiendo' : 'Seguir historia'),
  ));
}
