import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../network/api_client.dart';
import '../theme/theme.dart';
import 'widgets.dart';

class DestinationCard extends ConsumerWidget {
  const DestinationCard(this.d, {super.key, this.aspect = 1.25});
  final Json d;
  final double aspect;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final money = ref.watch(moneyProvider);
    final budget = d['daily_budget_usd'] as num?;
    return Semantics(
      button: true,
      label: '${d['name']}, ${d['country']}',
      child: InkWell(
        borderRadius: BorderRadius.circular(Tokens.radius),
        onTap: () => context.push('/destinations/${d['slug']}'),
        child: Card(
          clipBehavior: Clip.antiAlias,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            AspectRatio(aspectRatio: aspect, child: WImage(d['cover_image'] as String?, label: 'Photo of ${d['name']}', width: double.infinity, height: double.infinity)),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(d['name'] as String, style: Theme.of(context).textTheme.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 2),
                Text('${d['country']}${budget == null ? '' : '  ·  from ${money(budget)}/day'}',
                    style: const TextStyle(color: Tokens.inkMuted, fontSize: 13), maxLines: 1, overflow: TextOverflow.ellipsis),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}

class StayCard extends ConsumerWidget {
  const StayCard(this.s, {super.key, this.nights, this.query = const {}, this.compact = false});
  final Json s;
  final int? nights;
  final Map<String, String> query;
  final bool compact;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final money = ref.watch(moneyProvider);
    final price = (s['price_from'] ?? s['from_price_usd']) as num?;
    final total = s['total_for_stay_usd'] as num?;
    final dist = s['distance_km'] as num?;
    final image = WImage(s['cover_image'] as String?, label: 'Photo for ${s['name']}', width: compact ? 120 : double.infinity, height: compact ? 120 : 190, fallbackIcon: Icons.hotel_outlined);

    final info = Padding(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          if (s['stars'] != null) StarRow(s['stars'] as int),
          const SizedBox(width: 8),
          Flexible(child: Text(_typeLabel(s['type'] as String?), style: const TextStyle(color: Tokens.inkMuted, fontSize: 12))),
          if (s['is_demo'] == true) ...[const SizedBox(width: 8), const DemoBadge()],
        ]),
        const SizedBox(height: 6),
        Text(s['name'] as String, style: Theme.of(context).textTheme.titleMedium, maxLines: 2, overflow: TextOverflow.ellipsis),
        const SizedBox(height: 2),
        Text('${s['destination_name'] ?? ''}${dist != null ? '  ·  $dist km away' : ''}', style: const TextStyle(color: Tokens.inkMuted, fontSize: 13)),
        const SizedBox(height: 8),
        Wrap(spacing: 6, runSpacing: 4, children: [
          if ((s['free_cancel_hours'] ?? 0) > 0) const Pill('Free cancellation', icon: Icons.event_available_outlined),
          if (s['breakfast_included'] == true) const Pill('Breakfast', color: Tokens.terracotta, icon: Icons.free_breakfast_outlined),
          if (s['family_friendly'] == true) const Pill('Family friendly', color: Tokens.forestDeep, icon: Icons.family_restroom_outlined),
        ]),
        const SizedBox(height: 10),
        Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          RatingBadge(rating: (s['rating_avg'] ?? 0) as num, count: (s['review_count'] ?? 0) as int),
          const Spacer(),
          if (price != null)
            Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text(money(price), style: Theme.of(context).textTheme.titleLarge),
              Text(total != null && nights != null && nights! > 0 ? '${money(total)} for $nights night${nights == 1 ? '' : 's'}' : 'per night, before taxes',
                  style: const TextStyle(fontSize: 12, color: Tokens.inkMuted)),
            ]),
        ]),
      ]),
    );

    return Semantics(
      button: true,
      label: '${s['name']}, ${s['stars']} star ${s['type']}',
      child: InkWell(
        borderRadius: BorderRadius.circular(Tokens.radius),
        onTap: () => context.push(Uri(path: '/stays/${s['slug']}', queryParameters: query.isEmpty ? null : query).toString()),
        child: Card(
          clipBehavior: Clip.antiAlias,
          child: compact
              ? Row(crossAxisAlignment: CrossAxisAlignment.start, children: [image, Expanded(child: info)])
              : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [image, info]),
        ),
      ),
    );
  }
}

String _typeLabel(String? t) => switch (t) {
      'hotel' => 'Hotel',
      'guesthouse' => 'Guesthouse',
      'resort' => 'Resort',
      'hostel' => 'Hostel',
      'boutique' => 'Boutique hotel',
      'villa' => 'Villa',
      'apartment' => 'Apartment',
      _ => t ?? '',
    };

String typeLabel(String? t) => _typeLabel(t);

IconData categoryIcon(String? c) => switch (c) {
      'temple' => Icons.temple_buddhist_outlined,
      'museum' => Icons.museum_outlined,
      'market' => Icons.storefront_outlined,
      'nature' => Icons.forest_outlined,
      'beach' => Icons.beach_access_outlined,
      'food' => Icons.restaurant_outlined,
      'cafe' => Icons.local_cafe_outlined,
      'culture' => Icons.theater_comedy_outlined,
      'tour' => Icons.directions_boat_outlined,
      'outdoor' => Icons.hiking_outlined,
      'family' => Icons.family_restroom_outlined,
      'landmark' => Icons.account_balance_outlined,
      'history' => Icons.history_edu_outlined,
      _ => Icons.place_outlined,
    };

class PlaceTile extends ConsumerWidget {
  const PlaceTile(this.p, {super.key, this.trailing, this.onTap});
  final Json p;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final money = ref.watch(moneyProvider);
    final price = p['price_usd'] as num?;
    final cat = p['category'] as String?;
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(Tokens.radius),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Row(children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: SizedBox(
                width: 72,
                height: 72,
                child: p['image'] != null ? WImage(p['image'] as String?, width: 72, height: 72, fallbackIcon: categoryIcon(cat)) : Container(color: Tokens.sand, child: Icon(categoryIcon(cat), color: Tokens.forest)),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(p['name'] as String, style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600), maxLines: 2, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 2),
                Text(
                  [
                    (cat ?? '').isEmpty ? null : cat![0].toUpperCase() + cat.substring(1),
                    price == null ? null : (price == 0 ? 'Free' : money(price)),
                    if (p['duration_min'] != null) '${p['duration_min']} min',
                  ].whereType<String>().join('  ·  '),
                  style: const TextStyle(color: Tokens.inkMuted, fontSize: 13),
                ),
                if (p['is_demo'] == true) const Padding(padding: EdgeInsets.only(top: 4), child: DemoBadge()),
              ]),
            ),
            ?trailing,
          ]),
        ),
      ),
    );
  }
}

class ResponsiveGrid extends StatelessWidget {
  const ResponsiveGrid({super.key, required this.children, this.minTile = 280, this.spacing = 16});
  final List<Widget> children;
  final double minTile;
  final double spacing;

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, c) {
        final cols = (c.maxWidth / minTile).floor().clamp(1, 4);
        final w = (c.maxWidth - spacing * (cols - 1)) / cols;
        return Wrap(spacing: spacing, runSpacing: spacing, children: [for (final ch in children) SizedBox(width: w, child: ch)]);
      });
}
