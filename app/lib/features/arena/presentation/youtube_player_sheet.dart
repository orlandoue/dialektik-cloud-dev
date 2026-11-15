import 'dart:async';

import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/live/data/youtube_video.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

/// Privacy-enhanced embed of one video, autoplaying inline.
Uri youTubeEmbedUri(String videoId) => Uri.https(
  'www.youtube-nocookie.com',
  '/embed/$videoId',
  <String, String>{'autoplay': '1', 'playsinline': '1', 'rel': '0'},
);

Uri youTubeWatchUri(String videoId) =>
    Uri.https('www.youtube.com', '/watch', <String, String>{'v': videoId});

/// Opens a piece of evidence: YouTube videos play inside Dialektik (the
/// reader keeps their place in the duel or story); anything else opens the
/// original publication in the browser, as before.
Future<void> openArenaPiece(
  BuildContext context,
  ArenaStore store,
  Uri url, {
  required String title,
  String? channel,
}) async {
  final String? videoId = extractYouTubeVideoId(url.toString());
  // Platform web views are unavailable on the web build: open YouTube there.
  if (videoId == null || kIsWeb) {
    await store.openLink(url);
    return;
  }
  await showYouTubePlayerSheet(
    context,
    videoId: videoId,
    title: title,
    channel: channel == null ? null : arenaSourceName(channel),
    openExternal: store.openLink,
  );
}

/// Builds the player; tests replace it because platform views do not run
/// in widget tests.
@visibleForTesting
Widget Function(String videoId)? debugYouTubePlayerBuilder;

Future<void> showYouTubePlayerSheet(
  BuildContext context, {
  required String videoId,
  required String title,
  required Future<bool> Function(Uri uri) openExternal,
  String? channel,
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  backgroundColor: ArenaColors.card,
  shape: const RoundedRectangleBorder(
    borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
  ),
  builder: (BuildContext sheetContext) => _YouTubePlayerSheet(
    videoId: videoId,
    title: title,
    channel: channel,
    openExternal: openExternal,
  ),
);

class _YouTubePlayerSheet extends StatelessWidget {
  const _YouTubePlayerSheet({
    required this.videoId,
    required this.title,
    required this.channel,
    required this.openExternal,
  });

  final String videoId;
  final String title;
  final String? channel;
  final Future<bool> Function(Uri uri) openExternal;

  @override
  Widget build(BuildContext context) => Padding(
    key: const Key('arena-youtube-player-sheet'),
    padding: const EdgeInsets.fromLTRB(16, 12, 8, 20),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  if (channel != null)
                    Text(
                      channel!,
                      key: const Key('arena-youtube-channel'),
                      style: ArenaText.meta,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  Text(
                    title,
                    key: const Key('arena-youtube-title'),
                    style: ArenaText.cardTitle,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            IconButton(
              key: const Key('arena-youtube-close'),
              tooltip: 'Cerrar',
              color: ArenaColors.ink,
              onPressed: () => Navigator.of(context).pop(),
              icon: const Icon(Icons.close),
            ),
          ],
        ),
        const SizedBox(height: 10),
        ClipRRect(
          borderRadius: BorderRadius.circular(14),
          child: AspectRatio(
            aspectRatio: 16 / 9,
            child: ColoredBox(
              color: Colors.black,
              child:
                  debugYouTubePlayerBuilder?.call(videoId) ??
                  _EmbeddedPlayer(videoId: videoId, openExternal: openExternal),
            ),
          ),
        ),
        const SizedBox(height: 8),
        // Some TV channels forbid embedding; YouTube itself always works.
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(
            key: const Key('arena-youtube-open-external'),
            onPressed: () => unawaited(openExternal(youTubeWatchUri(videoId))),
            child: const Text('Abrir en YouTube ↗'),
          ),
        ),
      ],
    ),
  );
}

class _EmbeddedPlayer extends StatefulWidget {
  const _EmbeddedPlayer({required this.videoId, required this.openExternal});

  final String videoId;
  final Future<bool> Function(Uri uri) openExternal;

  @override
  State<_EmbeddedPlayer> createState() => _EmbeddedPlayerState();
}

class _EmbeddedPlayerState extends State<_EmbeddedPlayer> {
  late final WebViewController _controller = _build();

  WebViewController _build() {
    final WebViewController controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.black)
      ..setNavigationDelegate(
        NavigationDelegate(
          // Only the embed itself loads inside the app; a tap on the YouTube
          // logo or a related link opens YouTube outside Dialektik.
          onNavigationRequest: (NavigationRequest request) {
            final Uri? uri = Uri.tryParse(request.url);
            final bool embed =
                uri != null &&
                (uri.host == 'www.youtube-nocookie.com' ||
                    uri.host == 'www.youtube.com') &&
                uri.path.startsWith('/embed/');
            if (embed || request.url == 'about:blank') {
              return NavigationDecision.navigate;
            }
            if (uri != null &&
                (uri.scheme == 'https' || uri.scheme == 'http')) {
              unawaited(widget.openExternal(uri));
            }
            return NavigationDecision.prevent;
          },
        ),
      );
    final Object platform = controller.platform;
    if (platform is AndroidWebViewController) {
      unawaited(platform.setMediaPlaybackRequiresUserGesture(false));
    }
    // An iframe page with an https origin: YouTube refuses embeds that come
    // without a referrer, which a bare request from a web view would be.
    unawaited(
      controller.loadHtmlString('''
<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%}</style>
</head><body><iframe src="${youTubeEmbedUri(widget.videoId)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></body></html>
''', baseUrl: 'https://dialektik.app'),
    );
    return controller;
  }

  @override
  Widget build(BuildContext context) => WebViewWidget(controller: _controller);
}

/// Thumbnail of a YouTube piece with a ▶ over it, for evidence cards.
class YouTubeThumbnail extends StatelessWidget {
  const YouTubeThumbnail({required this.videoId, super.key});

  final String videoId;

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(12),
    child: AspectRatio(
      aspectRatio: 16 / 9,
      child: Stack(
        fit: StackFit.expand,
        children: <Widget>[
          Image.network(
            youTubeThumbnailUrl(videoId),
            fit: BoxFit.cover,
            errorBuilder:
                (BuildContext context, Object error, StackTrace? stack) =>
                    const ColoredBox(color: Color(0xFF1A1A1A)),
          ),
          const Center(
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: Color(0xCC000000),
                shape: BoxShape.circle,
              ),
              child: Padding(
                padding: EdgeInsets.all(10),
                child: Icon(
                  Icons.play_arrow_rounded,
                  color: Colors.white,
                  size: 34,
                ),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}
