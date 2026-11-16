/// Decodes the HTML entities commonly found in publisher RSS headlines.
///
/// This is deliberately limited to a small entity set; it is not an HTML
/// sanitizer and must only be used for plain text fields.
String decodeHeadlineHtmlEntities(String value) {
  const Map<String, String> entities = <String, String>{
    '&amp;': '&',
    '&quot;': '"',
    '&#34;': '"',
    '&#39;': "'",
    '&ndash;': '–',
    '&#8220;': '“',
    '&#8221;': '”',
  };
  return value.replaceAllMapped(
    RegExp(r'&(amp|quot|ndash|#34|#39|#8220|#8221);', caseSensitive: false),
    (Match match) => entities[match[0]!.toLowerCase()] ?? match[0]!,
  );
}
