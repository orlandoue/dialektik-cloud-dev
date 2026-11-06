import 'package:flutter/material.dart';

abstract final class DialektikSocialTheme {
  static const paper = Color(0xfffaf8f3);
  static const card = Colors.white;
  static const border = Color(0xffe8e4d9);
  static const navy = Color(0xff0f1b2d);
  static const storyGradient = LinearGradient(
    colors: [Color(0xffe11d48), Color(0xfff59e0b), Color(0xff991b1b)],
  );
  static const sourceGradient = LinearGradient(
    colors: [Color(0xff1e3a8a), Color(0xff0284c7)],
  );
  static const shadow = BoxShadow(
    color: Color(0x0d000000),
    blurRadius: 14,
    offset: Offset(0, 4),
  );
}
