import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/presentation/localization/consumer_strings.dart';
import 'package:dialektik/features/consumer/presentation/widgets/horizontal_choice_strip.dart';
import 'package:flutter/material.dart';

final class FilterBar extends StatefulWidget {
  const FilterBar({
    required this.category,
    required this.topic,
    required this.onCategoryChanged,
    required this.onTopicChanged,
    super.key,
  });

  final String? category;
  final String? topic;
  final ValueChanged<String?> onCategoryChanged;
  final ValueChanged<String?> onTopicChanged;

  @override
  State<FilterBar> createState() => _FilterBarState();
}

final class _FilterBarState extends State<FilterBar> {
  late final TextEditingController _topicController = TextEditingController(
    text: _displayTopic(widget.topic),
  );
  bool _topicExpanded = false;
  String? _inputError;

  @override
  void initState() {
    super.initState();
    _topicExpanded = widget.topic != null;
  }

  @override
  void didUpdateWidget(FilterBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.topic != widget.topic &&
        _topicController.text != _displayTopic(widget.topic)) {
      _topicController.text = _displayTopic(widget.topic);
      _inputError = null;
      if (widget.topic != null) _topicExpanded = true;
    }
  }

  @override
  void dispose() {
    _topicController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ConsumerStrings strings = ConsumerStrings.of(context);
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final bool compact = constraints.maxWidth < 640;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              strings.categoryFilter,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: DialektikSpacing.space3),
            HorizontalChoiceStrip<String>(
              semanticsLabel: strings.categoryFilter,
              scrollHint: strings.horizontalScrollHint,
              allLabel: strings.allCategories,
              selectedValue: widget.category,
              keyPrefix: 'category-filter',
              options: <HorizontalChoiceOption<String>>[
                for (final String slug in consumerCategorySlugs)
                  HorizontalChoiceOption<String>(
                    value: slug,
                    label: strings.categoryName(slug),
                  ),
              ],
              onSelected: widget.onCategoryChanged,
            ),
            SizedBox(
              height: compact
                  ? DialektikSpacing.space2
                  : DialektikSpacing.space6,
            ),
            if (compact)
              _FilterFocusOutline(
                child: TextButton.icon(
                  key: const Key('topic-search-toggle'),
                  style: TextButton.styleFrom(
                    minimumSize: const Size(
                      DialektikSizing.touchMinimum,
                      DialektikSizing.touchMinimum,
                    ),
                  ),
                  onPressed: () =>
                      setState(() => _topicExpanded = !_topicExpanded),
                  icon: Icon(_topicExpanded ? Icons.expand_less : Icons.tune),
                  label: Text(
                    _topicExpanded
                        ? strings.hideTopicSearch
                        : strings.topicSearch,
                  ),
                ),
              ),
            if (!compact || _topicExpanded)
              ..._topicControls(strings, compact: compact),
          ],
        );
      },
    );
  }

  List<Widget> _topicControls(
    ConsumerStrings strings, {
    required bool compact,
  }) => <Widget>[
    if (!compact) ...<Widget>[
      Text(strings.topicSearch, style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: DialektikSpacing.space3),
    ],
    Text(strings.topicSearchScope),
    const SizedBox(height: DialektikSpacing.space4),
    LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final Widget input = _FilterFocusOutline(
          child: TextField(
            key: const Key('topic-search-input'),
            controller: _topicController,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              border: const OutlineInputBorder(),
              focusedBorder: OutlineInputBorder(
                borderSide: BorderSide(
                  color: context.surfaceColors.interactionAccent,
                  width: DialektikSizing.focusRingWidth,
                ),
              ),
              labelText: strings.topicName,
              hintText: strings.topicHint,
              labelStyle: Theme.of(context).textTheme.bodyMedium,
              hintStyle: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: context.surfaceColors.muted,
              ),
            ),
            onChanged: (_) {
              if (_inputError != null) setState(() => _inputError = null);
            },
            onSubmitted: (_) => _submitTopic(strings),
          ),
        );
        final Widget submit = _FilterFocusOutline(
          child: FilledButton(
            key: const Key('topic-search-submit'),
            onPressed: () => _submitTopic(strings),
            child: Text(strings.search),
          ),
        );
        final double textScale =
            MediaQuery.textScalerOf(
              context,
            ).scale(DialektikTypography.publicBodyMinimum) /
            DialektikTypography.publicBodyMinimum;
        if (constraints.maxWidth >= DialektikSizing.baseViewport * textScale) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: <Widget>[
              Expanded(child: input),
              const SizedBox(width: DialektikSpacing.space3),
              submit,
            ],
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            input,
            const SizedBox(height: DialektikSpacing.space3),
            submit,
          ],
        );
      },
    ),
    if (_inputError != null) ...<Widget>[
      const SizedBox(height: DialektikSpacing.space3),
      Semantics(liveRegion: true, child: Text(_inputError!)),
    ],
    if (widget.topic != null) ...<Widget>[
      const SizedBox(height: DialektikSpacing.space3),
      Wrap(
        spacing: DialektikSpacing.space3,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: <Widget>[
          Text(strings.activeTopic(_displayTopic(widget.topic))),
          _FilterFocusOutline(
            child: TextButton(
              style: TextButton.styleFrom(
                minimumSize: const Size(
                  DialektikSizing.touchMinimum,
                  DialektikSizing.touchMinimum,
                ),
              ),
              onPressed: () {
                _topicController.clear();
                setState(() => _inputError = null);
                widget.onTopicChanged(null);
              },
              child: Text(strings.clearTopic),
            ),
          ),
        ],
      ),
    ],
  ];

  void _submitTopic(ConsumerStrings strings) {
    final String value = _normalizeTopic(_topicController.text);
    if (value.length > 80) {
      setState(() => _inputError = strings.topicTooLong);
      return;
    }
    if ((_topicController.text.trim().isNotEmpty && value.isEmpty) ||
        (value.isNotEmpty &&
            !RegExp(
              r'^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$',
            ).hasMatch(value))) {
      setState(() => _inputError = strings.topicInputError);
      return;
    }
    setState(() => _inputError = null);
    widget.onTopicChanged(value.isEmpty ? null : value);
  }

  static String _displayTopic(String? value) => value == null
      ? ''
      : value.contains('--')
      ? value
      : value.replaceAll('-', ' ');

  /// Adapts familiar topic spelling to the existing exact-slug API filter.
  /// It does not search titles, infer Topics, or add a new backend query.
  static String _normalizeTopic(String input) {
    final String exact = input.trim();
    if (RegExp(r'^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$').hasMatch(exact)) {
      return exact;
    }
    const Map<String, String> accents = <String, String>{
      'á': 'a',
      'à': 'a',
      'ä': 'a',
      'â': 'a',
      'é': 'e',
      'è': 'e',
      'ë': 'e',
      'ê': 'e',
      'í': 'i',
      'ì': 'i',
      'ï': 'i',
      'î': 'i',
      'ó': 'o',
      'ò': 'o',
      'ö': 'o',
      'ô': 'o',
      'ú': 'u',
      'ù': 'u',
      'ü': 'u',
      'û': 'u',
      'ñ': 'n',
      'ç': 'c',
    };
    var value = input.trim().toLowerCase();
    for (final MapEntry<String, String> entry in accents.entries) {
      value = value.replaceAll(entry.key, entry.value);
    }
    return value
        .replaceAll(RegExp(r'[\u0300-\u036f]'), '')
        .replaceAll(RegExp(r'[\s_–—]+'), '-')
        .replaceAll(RegExp('-+'), '-')
        .replaceAll(RegExp(r'^-+|-+$'), '');
  }
}

final class _FilterFocusOutline extends StatefulWidget {
  const _FilterFocusOutline({required this.child});

  final Widget child;

  @override
  State<_FilterFocusOutline> createState() => _FilterFocusOutlineState();
}

final class _FilterFocusOutlineState extends State<_FilterFocusOutline> {
  bool _hasFocus = false;

  @override
  Widget build(BuildContext context) => Focus(
    canRequestFocus: false,
    onFocusChange: (bool value) => setState(() => _hasFocus = value),
    child: DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(
          color: _hasFocus
              ? context.surfaceColors.interactionAccent
              : DialektikColors.transparent,
          width: DialektikSizing.focusRingWidth,
        ),
        borderRadius: DialektikRadii.smallBorderRadius,
      ),
      child: Padding(
        padding: const EdgeInsets.all(DialektikSizing.focusRingGap),
        child: widget.child,
      ),
    ),
  );
}
