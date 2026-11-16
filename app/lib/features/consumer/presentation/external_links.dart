import 'package:url_launcher/url_launcher.dart';

typedef ExternalLinkOpener = Future<bool> Function(Uri uri);

Future<bool> openExternalHttpLink(Uri uri) {
  if (uri.scheme != 'http' && uri.scheme != 'https') {
    return Future<bool>.value(false);
  }
  return launchUrl(uri, mode: LaunchMode.externalApplication);
}
