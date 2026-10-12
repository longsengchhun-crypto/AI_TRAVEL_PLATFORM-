import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/providers.dart';
import '../../core/theme/theme.dart';
import '../../core/widgets/widgets.dart';

/// Destination + dates + guests search used on the homepage and the results page.
class SearchPanel extends ConsumerStatefulWidget {
  const SearchPanel({super.key, this.initial = const StayQuery(), this.onSearch, this.embedded = false});
  final StayQuery initial;
  final void Function(StayQuery)? onSearch;
  final bool embedded;

  @override
  ConsumerState<SearchPanel> createState() => _SearchPanelState();
}

class _SearchPanelState extends ConsumerState<SearchPanel> {
  late StayQuery q = widget.initial;
  late final TextEditingController _dest = TextEditingController();
  final FocusNode _focus = FocusNode();
  String? _error;

  @override
  void initState() {
    super.initState();
    _dest.text = q.q ?? q.destination?.replaceAll('-', ' ') ?? '';
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _nameFromSlug((ref.read(metaProvider).value?['destinations'] as List?) ?? const []);
    });
  }

  /// Show the human name ("Phnom Penh") instead of the URL slug once the destination list is available.
  void _nameFromSlug(List dests) {
    if (q.destination == null || _dest.text != q.destination!.replaceAll('-', ' ')) return;
    final m = dests.cast<Map>().where((d) => d['slug'] == q.destination).firstOrNull;
    if (m != null) _dest.text = m['name'] as String;
  }

  @override
  void dispose() {
    _dest.dispose();
    _focus.dispose();
    super.dispose();
  }

  Future<void> _pickDates() async {
    final now = DateTime.now();
    final r = await showDateRangePicker(
      context: context,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: now.add(const Duration(days: 119)),
      initialDateRange: q.hasDates ? DateTimeRange(start: DateTime.parse(q.checkIn!), end: DateTime.parse(q.checkOut!)) : null,
      helpText: 'Select check-in and check-out',
      saveText: 'Done',
    );
    if (r != null) setState(() => q = q.copyWith(checkIn: iso(r.start), checkOut: iso(r.end)));
  }

  Future<void> _pickGuests() async {
    var adults = q.adults, children = q.children, rooms = q.rooms;
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (c) => StatefulBuilder(builder: (c, set) {
        Widget row(String label, String sub, int v, int min, int max, void Function(int) on) => ListTile(
              title: Text(label),
              subtitle: Text(sub),
              trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                IconButton.outlined(tooltip: 'Fewer $label', onPressed: v > min ? () => set(() => on(v - 1)) : null, icon: const Icon(Icons.remove)),
                SizedBox(width: 36, child: Text('$v', textAlign: TextAlign.center, style: Theme.of(c).textTheme.titleMedium)),
                IconButton.outlined(tooltip: 'More $label', onPressed: v < max ? () => set(() => on(v + 1)) : null, icon: const Icon(Icons.add)),
              ]),
            );
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(8, 0, 8, 16),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              row('Adults', 'Age 13 or above', adults, 1, 12, (v) => adults = v),
              row('Children', 'Age 0 to 12', children, 0, 8, (v) => children = v),
              row('Rooms', '', rooms, 1, 6, (v) => rooms = v),
              Padding(padding: const EdgeInsets.all(8), child: FilledButton(onPressed: () => Navigator.pop(c), child: const Text('Apply'))),
            ]),
          ),
        );
      }),
    );
    setState(() => q = q.copyWith(adults: adults, children: children, rooms: rooms));
  }

  void _submit(List destinations) {
    final text = _dest.text.trim();
    String? slug;
    String? free;
    if (text.isNotEmpty) {
      final match = destinations.cast<Map>().where((d) => (d['name'] as String).toLowerCase() == text.toLowerCase() || d['slug'] == text.toLowerCase()).firstOrNull;
      if (match != null) {
        slug = match['slug'] as String;
      } else {
        free = text;
      }
    }
    if (q.hasDates && q.checkIn!.compareTo(q.checkOut!) >= 0) {
      setState(() => _error = 'Check-out must be after check-in');
      return;
    }
    setState(() => _error = null);
    final next = q.copyWith(destination: slug, q: free, page: 1);
    if (widget.onSearch != null) {
      widget.onSearch!(next);
    } else {
      context.go(Uri(path: '/stays', queryParameters: next.toUrlParams()).toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final dests = (ref.watch(metaProvider).value?['destinations'] as List?) ?? const [];
    ref.listen(metaProvider, (_, next) => _nameFromSlug((next.value?['destinations'] as List?) ?? const []));
    final wide = isWide(context);
    final dateLabel = q.hasDates ? '${fmtDate(q.checkIn, pattern: 'd MMM')} – ${fmtDate(q.checkOut, pattern: 'd MMM')}  ·  ${nightsBetween(q.checkIn, q.checkOut)} nights' : 'Add dates';
    final guestLabel = '${q.adults} adult${q.adults > 1 ? 's' : ''}${q.children > 0 ? ', ${q.children} child${q.children > 1 ? 'ren' : ''}' : ''} · ${q.rooms} room${q.rooms > 1 ? 's' : ''}';

    final destField = RawAutocomplete<String>(
      textEditingController: _dest,
      focusNode: _focus,
      optionsBuilder: (v) {
        final t = v.text.trim().toLowerCase();
        return dests.cast<Map>().map((d) => d['name'] as String).where((n) => t.isEmpty || n.toLowerCase().contains(t)).take(8);
      },
      onSelected: (v) => _dest.text = v,
      fieldViewBuilder: (context, controller, focus, onSubmit) => TextField(
        controller: controller,
        focusNode: focus,
        textInputAction: TextInputAction.search,
        onSubmitted: (_) => _submit(dests),
        decoration: const InputDecoration(labelText: 'Where to?', hintText: 'City, destination or hotel', prefixIcon: Icon(Icons.search_rounded)),
      ),
      optionsViewBuilder: (context, onSelected, options) => Align(
        alignment: Alignment.topLeft,
        child: Material(
          elevation: 4,
          borderRadius: BorderRadius.circular(Tokens.radius),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 260, maxWidth: 420),
            child: ListView(
              padding: EdgeInsets.zero,
              shrinkWrap: true,
              children: [for (final o in options) ListTile(dense: true, leading: const Icon(Icons.place_outlined, size: 20), title: Text(o), onTap: () => onSelected(o))],
            ),
          ),
        ),
      ),
    );

    Widget tapField(IconData icon, String label, String value, VoidCallback onTap) => Semantics(
          button: true,
          label: '$label: $value',
          child: InkWell(
            borderRadius: BorderRadius.circular(Tokens.radius),
            onTap: onTap,
            child: InputDecorator(
              decoration: InputDecoration(labelText: label, prefixIcon: Icon(icon)),
              child: Text(value, maxLines: 1, overflow: TextOverflow.ellipsis),
            ),
          ),
        );

    final fields = [
      destField,
      tapField(Icons.calendar_month_outlined, 'Dates', dateLabel, _pickDates),
      tapField(Icons.people_outline, 'Guests', guestLabel, _pickGuests),
    ];

    final button = FilledButton.icon(
      onPressed: () => _submit(dests),
      icon: const Icon(Icons.search_rounded),
      label: const Text('Search stays'),
      style: FilledButton.styleFrom(minimumSize: const Size(0, 56)),
    );

    final content = Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (wide)
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(flex: 4, child: fields[0]),
          const SizedBox(width: 12),
          Expanded(flex: 4, child: fields[1]),
          const SizedBox(width: 12),
          Expanded(flex: 3, child: fields[2]),
          const SizedBox(width: 12),
          SizedBox(width: 170, child: button),
        ])
      else ...[
        fields[0],
        const SizedBox(height: 12),
        fields[1],
        const SizedBox(height: 12),
        fields[2],
        const SizedBox(height: 12),
        button,
      ],
      if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: const TextStyle(color: Tokens.danger))),
    ]);

    if (widget.embedded) return content;
    return Card(child: Padding(padding: const EdgeInsets.all(16), child: content));
  }
}
