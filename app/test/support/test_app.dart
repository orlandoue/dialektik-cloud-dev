import 'package:dialektik/design_system/theme/dialektik_theme.dart';
import 'package:dialektik/features/consumer/presentation/localization/consumer_strings.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

Widget testApp({
  required Widget child,
  ThemeData? theme,
  double textScale = 1,
}) {
  return MaterialApp(
    theme: theme ?? DialektikTheme.offWhite(loadInterFromDependency: false),
    supportedLocales: consumerSupportedLocales,
    localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
      ConsumerStringsDelegate(),
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
    home: Builder(
      builder: (BuildContext context) {
        final MediaQueryData mediaQuery = MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale));
        return MediaQuery(
          data: mediaQuery,
          child: Scaffold(body: child),
        );
      },
    ),
  );
}
