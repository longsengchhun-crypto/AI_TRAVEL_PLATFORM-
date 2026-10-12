import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/providers.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/theme.dart';
import '../../core/widgets/cards.dart';
import '../../core/widgets/widgets.dart';

/// Bottom sheet with full place details, hours (flagged indicative) and photo credit.
void showPlaceSheet(BuildContext context, WidgetRef ref, Json p) {
  final money = ref.read(moneyProvider);
  showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (c) => SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (p['image'] != null) WImage(p['image'] as String?, full: true, height: 180, width: double.infinity, radius: 10, label: 'Photo of ${p['name']}'),
          if (p['image_credit'] != null)
            Padding(padding: const EdgeInsets.only(top: 4), child: Text(p['image_credit'] as String, style: const TextStyle(fontSize: 11, color: Tokens.inkMuted))),
          const SizedBox(height: 12),
          Text(p['name'] as String, style: Theme.of(c).textTheme.titleLarge),
          const SizedBox(height: 6),
          Wrap(spacing: 8, runSpacing: 6, children: [
            if (p['price_usd'] != null) Pill((p['price_usd'] as num) == 0 ? 'Free' : money(p['price_usd'] as num), icon: Icons.payments_outlined),
            Pill('${p['duration_min']} min', icon: Icons.schedule),
            if (p['opens_min'] != null)
              Pill('${fmtMinutes(p['opens_min'] as int)} – ${fmtMinutes((p['closes_min'] as int) % 1440)}${p['hours_verified'] == true ? '' : ' (indicative)'}', icon: Icons.access_time, color: Tokens.terracotta),
            if (p['is_demo'] == true) const DemoBadge(),
          ]),
          const SizedBox(height: 12),
          Text(p['description'] as String, style: const TextStyle(height: 1.5)),
          if (p['tips'] != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(p['tips'] as String, style: const TextStyle(color: Tokens.inkMuted, fontSize: 13))),
          if (p['destination_slug'] != null)
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: OutlinedButton.icon(
                onPressed: () {
                  Navigator.pop(c);
                  context.push('/destinations/${p['destination_slug']}');
                },
                icon: const Icon(Icons.place_outlined),
                label: Text('More in ${p['destination_name']}'),
              ),
            ),
        ]),
      ),
    ),
  );
}

class PlacesScreen extends ConsumerStatefulWidget {
  const PlacesScreen({super.key, this.category, this.kind});
  final String? category, kind;
  @override
  ConsumerState<PlacesScreen> createState() => _PlacesScreenState();
}

class _PlacesScreenState extends ConsumerState<PlacesScreen> {
  late PlaceQuery q = PlaceQuery(category: widget.category, kind: widget.kind);
  final _search = TextEditingController();
  static const cats = ['temple', 'museum', 'landmark', 'market', 'nature', 'beach', 'culture', 'tour', 'outdoor', 'family', 'cafe', 'food'];

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final res = ref.watch(placesProvider(q));
    return ListView(children: [
      Constrained(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const SizedBox(height: 24),
          Semantics(header: true, child: Text('Places and experiences', style: Theme.of(context).textTheme.headlineMedium)),
          const SizedBox(height: 16),
          TextField(
            controller: _search,
            textInputAction: TextInputAction.search,
            decoration: const InputDecoration(hintText: 'Search places, e.g. Angkor, market, museum', prefixIcon: Icon(Icons.search)),
            onSubmitted: (v) => setState(() => q = q.copyWith(q: v.trim().isEmpty ? null : v.trim(), page: 1)),
          ),
          const SizedBox(height: 12),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(children: [
              for (final (label, v) in const [('Attractions', 'attraction'), ('Activities', 'activity'), ('Restaurants', 'restaurant')]) ...[
                FilterChip(label: Text(label), selected: q.kind == v, onSelected: (s) => setState(() => q = q.copyWith(kind: s ? v : null, page: 1))),
                const SizedBox(width: 8),
              ],
              const SizedBox(width: 12),
              for (final c in cats) ...[
                FilterChip(
                  avatar: Icon(categoryIcon(c), size: 16),
                  label: Text(c[0].toUpperCase() + c.substring(1)),
                  selected: q.category == c,
                  onSelected: (s) => setState(() => q = q.copyWith(category: s ? c : null, page: 1)),
                ),
                const SizedBox(width: 8),
              ],
            ]),
          ),
          const SizedBox(height: 16),
          AsyncView<Json>(
            value: res,
            onRetry: () => ref.invalidate(placesProvider(q)),
            loading: const SkeletonList(count: 3, itemHeight: 90),
            data: (r) {
              final items = (r['items'] as List).cast<Json>();
              if (items.isEmpty) {
                return EmptyState(
                  title: 'No places match',
                  message: 'Try a different category or search term.',
                  action: OutlinedButton(onPressed: () => setState(() { _search.clear(); q = const PlaceQuery(); }), child: const Text('Clear filters')),
                );
              }
              final pages = r['totalPages'] as int;
              return Column(children: [
                Align(alignment: Alignment.centerLeft, child: Padding(padding: const EdgeInsets.only(bottom: 8), child: Text('${r['total']} places', style: const TextStyle(color: Tokens.inkMuted)))),
                ResponsiveGrid(minTile: 360, spacing: 12, children: [
                  for (final it in items)
                    PlaceTile(
                      it,
                      onTap: () => showPlaceSheet(context, ref, it),
                      trailing: it['destination_name'] == null ? null : Text(it['destination_name'] as String, style: const TextStyle(fontSize: 11, color: Tokens.inkMuted)),
                    ),
                ]),
                if (pages > 1)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 24),
                    child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                      IconButton.outlined(tooltip: 'Previous page', onPressed: q.page > 1 ? () => setState(() => q = q.copyWith(page: q.page - 1)) : null, icon: const Icon(Icons.chevron_left)),
                      Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Text('Page ${q.page} of $pages')),
                      IconButton.outlined(tooltip: 'Next page', onPressed: q.page < pages ? () => setState(() => q = q.copyWith(page: q.page + 1)) : null, icon: const Icon(Icons.chevron_right)),
                    ]),
                  ),
              ]);
            },
          ),
          const SizedBox(height: 40),
        ]),
      ),
    ]);
  }
}
