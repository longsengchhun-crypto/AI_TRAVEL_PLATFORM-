import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/data/providers.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/theme.dart';
import '../../core/widgets/cards.dart';
import '../../core/widgets/widgets.dart';
import '../maps/place_map.dart';
import 'search_panel.dart';

class StaysScreen extends ConsumerStatefulWidget {
  const StaysScreen({super.key, required this.initial});
  final StayQuery initial;
  @override
  ConsumerState<StaysScreen> createState() => _StaysScreenState();
}

class _StaysScreenState extends ConsumerState<StaysScreen> {
  late StayQuery q = widget.initial;
  bool showMap = false;
  Json? _last;

  void apply(StayQuery next) => setState(() => q = next.copyWith(page: next.page));
  void reset(StayQuery Function(StayQuery) f) => setState(() => q = f(q).copyWith(page: 1));

  @override
  Widget build(BuildContext context) {
    final res = ref.watch(staySearchProvider(q));
    if (res.hasValue) _last = res.value;
    final stale = !res.hasValue && res.isLoading && _last != null;
    final shown = res.hasValue ? res : (stale ? AsyncData<Json>(_last!) : res);
    final wide = isWide(context);
    final nights = nightsBetween(q.checkIn, q.checkOut);
    final urlQ = q.toUrlParams();

    final resultsView = AsyncView<Json>(
      value: shown,
      onRetry: () => ref.invalidate(staySearchProvider(q)),
      loading: const SkeletonList(count: 3, itemHeight: 280),
      data: (r) {
        final items = (r['items'] as List).cast<Json>();
        if (items.isEmpty) {
          return EmptyState(
            title: 'No stays match these filters',
            message: q.hasDates
                ? 'There may be no availability for these dates and guests. Try different dates, fewer filters, or another destination.'
                : 'Try widening your price range or removing a filter.',
            action: OutlinedButton(onPressed: () => setState(() => q = StayQuery(destination: q.destination, checkIn: q.checkIn, checkOut: q.checkOut, adults: q.adults, children: q.children, rooms: q.rooms)), child: const Text('Clear filters')),
          );
        }
        final pages = r['totalPages'] as int;
        if (showMap) {
          return PlaceMap(
            height: wide ? 640 : 480,
            points: [
              for (final s in items)
                MapPoint(
                  lat: (s['lat'] as num).toDouble(),
                  lng: (s['lng'] as num).toDouble(),
                  title: s['name'] as String,
                  subtitle: '${ref.read(moneyProvider)(s['price_from'] as num)} / night',
                  kind: 'stay',
                  onTap: () {},
                ),
            ],
          );
        }
        return Column(children: [
          for (final s in items)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: StayCard(s, nights: r['nights'] as int?, query: urlQ, compact: wide),
            ),
          if (pages > 1)
            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              IconButton.outlined(tooltip: 'Previous page', onPressed: q.page > 1 ? () => setState(() => q = q.copyWith(page: q.page - 1)) : null, icon: const Icon(Icons.chevron_left)),
              Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Text('Page ${q.page} of $pages')),
              IconButton.outlined(tooltip: 'Next page', onPressed: q.page < pages ? () => setState(() => q = q.copyWith(page: q.page + 1)) : null, icon: const Icon(Icons.chevron_right)),
            ]),
        ]);
      },
    );

    final results = AnimatedOpacity(
      duration: const Duration(milliseconds: 180),
      opacity: stale ? 0.5 : 1,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (stale) const Padding(padding: EdgeInsets.only(bottom: 8), child: LinearProgressIndicator(minHeight: 2)),
        resultsView,
      ]),
    );
    final total = shown.value?['total'];
    final header = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Expanded(
          child: Text(total == null ? 'Stays' : '$total stay${total == 1 ? '' : 's'} found', style: Theme.of(context).textTheme.titleLarge),
        ),
        DropdownButton<String>(
          value: q.sort,
          underline: const SizedBox.shrink(),
          items: [
            const DropdownMenuItem(value: 'relevance', child: Text('Recommended')),
            const DropdownMenuItem(value: 'price_asc', child: Text('Price: low to high')),
            const DropdownMenuItem(value: 'price_desc', child: Text('Price: high to low')),
            const DropdownMenuItem(value: 'rating', child: Text('Guest rating')),
            if (q.lat != null) const DropdownMenuItem(value: 'distance', child: Text('Distance')),
          ],
          onChanged: (v) => reset((s) => s.copyWith(sort: v)),
        ),
        const SizedBox(width: 8),
        SegmentedButton<bool>(
          showSelectedIcon: false,
          segments: const [ButtonSegment(value: false, icon: Icon(Icons.view_list_outlined), tooltip: 'List view'), ButtonSegment(value: true, icon: Icon(Icons.map_outlined), tooltip: 'Map view')],
          selected: {showMap},
          onSelectionChanged: (s) => setState(() => showMap = s.first),
        ),
      ]),
      if (q.hasDates)
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text('${fmtDate(q.checkIn)} – ${fmtDate(q.checkOut)} · $nights night${nights == 1 ? '' : 's'} · prices include only available room types for your party', style: const TextStyle(color: Tokens.inkMuted, fontSize: 13)),
        )
      else
        const Padding(padding: EdgeInsets.only(top: 4), child: Text('Add dates to see real availability and total prices.', style: TextStyle(color: Tokens.inkMuted, fontSize: 13))),
    ]);

    final filters = _Filters(q: q, onChanged: (n) => setState(() => q = n.copyWith(page: 1)));

    return ListView(children: [
      Container(
        color: Tokens.sand,
        child: Constrained(
          padding: EdgeInsets.symmetric(horizontal: wide ? 32 : 16, vertical: 16),
          child: SearchPanel(initial: q, onSearch: (n) => setState(() => q = n.copyWith(
                minPrice: q.minPrice, maxPrice: q.maxPrice, stars: q.stars, amenities: q.amenities, types: q.types, sort: q.sort,
                freeCancellation: q.freeCancellation, breakfast: q.breakfast, familyFriendly: q.familyFriendly, minRating: q.minRating))),
        ),
      ),
      Constrained(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 20),
          child: wide
              ? Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  SizedBox(width: 280, child: filters),
                  const SizedBox(width: 32),
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [header, const SizedBox(height: 16), results])),
                ])
              : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    OutlinedButton.icon(
                      onPressed: () => showModalBottomSheet<void>(
                        context: context,
                        isScrollControlled: true,
                        showDragHandle: true,
                        builder: (c) => StatefulBuilder(builder: (c, set) => SafeArea(
                          child: SingleChildScrollView(
                            padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                            child: _Filters(q: q, onChanged: (n) { setState(() => q = n.copyWith(page: 1)); set(() {}); }),
                          ),
                        )),
                      ),
                      icon: const Icon(Icons.tune),
                      label: Text('Filters${_activeCount(q) > 0 ? ' (${_activeCount(q)})' : ''}'),
                    ),
                  ]),
                  const SizedBox(height: 12),
                  header,
                  const SizedBox(height: 16),
                  results,
                ]),
        ),
      ),
    ]);
  }
}

int _activeCount(StayQuery q) =>
    (q.minPrice != null ? 1 : 0) + (q.maxPrice != null ? 1 : 0) + q.stars.length + q.amenities.length + q.types.length + (q.freeCancellation ? 1 : 0) +
    (q.breakfast ? 1 : 0) + (q.familyFriendly ? 1 : 0) + (q.minRating != null ? 1 : 0);

class _Filters extends ConsumerWidget {
  const _Filters({required this.q, required this.onChanged});
  final StayQuery q;
  final ValueChanged<StayQuery> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final meta = ref.watch(metaProvider).value;
    final amenities = ((meta?['amenities'] as List?) ?? const []).cast<Map>();
    const types = {'hotel': 'Hotel', 'guesthouse': 'Guesthouse', 'resort': 'Resort', 'hostel': 'Hostel', 'boutique': 'Boutique', 'villa': 'Villa', 'apartment': 'Apartment'};
    final money = ref.watch(moneyProvider);
    final range = RangeValues(q.minPrice ?? 0, q.maxPrice ?? 300);

    Widget group(String title, Widget child) => Padding(
          padding: const EdgeInsets.only(bottom: 20),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: Theme.of(context).textTheme.titleSmall), const SizedBox(height: 8), child]),
        );

    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Expanded(child: Text('Filters', style: Theme.of(context).textTheme.titleMedium)),
        if (_activeCount(q) > 0)
          TextButton(
            onPressed: () => onChanged(StayQuery(destination: q.destination, q: q.q, checkIn: q.checkIn, checkOut: q.checkOut, adults: q.adults, children: q.children, rooms: q.rooms, sort: q.sort)),
            child: const Text('Clear all'),
          ),
      ]),
      const SizedBox(height: 8),
      group(
        'Price per night (${money(range.start)} – ${money(range.end)}${q.maxPrice == null ? '+' : ''})',
        RangeSlider(
          values: range,
          min: 0,
          max: 300,
          divisions: 30,
          labels: RangeLabels(money(range.start), money(range.end)),
          onChanged: (v) => onChanged(q.copyWith(minPrice: v.start <= 0 ? null : v.start, maxPrice: v.end >= 300 ? null : v.end)),
        ),
      ),
      group(
        'Star rating',
        Wrap(spacing: 8, runSpacing: 4, children: [
          for (final s in [5, 4, 3, 2, 1])
            FilterChip(
              label: Text('$s★'),
              selected: q.stars.contains(s),
              onSelected: (on) => onChanged(q.copyWith(stars: on ? {...q.stars, s} : ({...q.stars}..remove(s)))),
            ),
        ]),
      ),
      group(
        'Guest rating',
        Wrap(spacing: 8, children: [
          for (final r in [4.5, 4.0, 3.5])
            ChoiceChip(label: Text('$r+'), selected: q.minRating == r, onSelected: (on) => onChanged(q.copyWith(minRating: on ? r : null))),
        ]),
      ),
      group(
        'Property type',
        Wrap(spacing: 8, runSpacing: 4, children: [
          for (final e in types.entries)
            FilterChip(label: Text(e.value), selected: q.types.contains(e.key), onSelected: (on) => onChanged(q.copyWith(types: on ? {...q.types, e.key} : ({...q.types}..remove(e.key))))),
        ]),
      ),
      group(
        'Popular filters',
        Column(children: [
          SwitchListTile(contentPadding: EdgeInsets.zero, dense: true, title: const Text('Free cancellation'), value: q.freeCancellation, onChanged: (v) => onChanged(q.copyWith(freeCancellation: v))),
          SwitchListTile(contentPadding: EdgeInsets.zero, dense: true, title: const Text('Breakfast available'), value: q.breakfast, onChanged: (v) => onChanged(q.copyWith(breakfast: v))),
          SwitchListTile(contentPadding: EdgeInsets.zero, dense: true, title: const Text('Family friendly'), value: q.familyFriendly, onChanged: (v) => onChanged(q.copyWith(familyFriendly: v))),
        ]),
      ),
      group(
        'Amenities',
        Wrap(spacing: 8, runSpacing: 4, children: [
          for (final a in amenities)
            FilterChip(
              label: Text(a['label'] as String),
              selected: q.amenities.contains(a['code']),
              onSelected: (on) => onChanged(q.copyWith(amenities: on ? {...q.amenities, a['code'] as String} : ({...q.amenities}..remove(a['code'])))),
            ),
        ]),
      ),
    ]);
  }
}
