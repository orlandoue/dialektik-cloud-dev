/// Extracts an ID only from a genuine HTTP(S) YouTube video URL.
String? extractYouTubeVideoId(String? url) {
  if (url == null || url.isEmpty) return null;
  final uri = Uri.tryParse(url);
  if (uri == null || (uri.scheme != 'https' && uri.scheme != 'http') || uri.userInfo.isNotEmpty) return null;
  final host = uri.host.toLowerCase();
  final segments = uri.pathSegments.toList();
  if (segments.isNotEmpty && segments.last.isEmpty) segments.removeLast();
  String? id;
  if (host == 'youtu.be' || host == 'www.youtu.be') {
    if (segments.length == 1) id = segments.first;
  } else if (host == 'youtube.com' || host == 'www.youtube.com' || host == 'm.youtube.com' || host == 'music.youtube.com') {
    if (uri.path == '/watch' || uri.path == '/watch/') {
      final values = uri.queryParametersAll['v'];
      if (values?.length == 1) id = values!.single;
    } else if (segments.length == 2 && const {'live','shorts','embed'}.contains(segments.first)) {
      id = segments[1];
    }
  }
  return id != null && RegExp(r'^[A-Za-z0-9_-]{11}$').hasMatch(id) ? id : null;
}

String youTubeThumbnailUrl(String videoId) {
  if (!RegExp(r'^[A-Za-z0-9_-]{11}$').hasMatch(videoId)) throw ArgumentError.value(videoId, 'videoId');
  return 'https://i.ytimg.com/vi/$videoId/hqdefault.jpg';
}
