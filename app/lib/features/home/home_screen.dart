import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/providers.dart';
import '../../core/theme/theme.dart';
import '../../core/widgets/cards.dart';
import '../../core/widgets/widgets.dart';
import '../stays/search_panel.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final home = ref.watch(homeProvider);
    final recent = ref.watch(recentProvider);
    final t = Theme.of(context).textTheme;
    final wide = isWide(context);

    return ListView(
      padding: EdgeInsets.zero,
      children: [
        // Hero: compact so the search tool is immediately usable above the fold.
        Container(
          color: Tokens.sand,
          child: Constrained(
            padding: EdgeInsets.fromLTRB(wide ? 32 : 16, wide ? 40 : 24, wide ? 32 : 16, 28),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Plan the trip.\nBook the stay.', style: wide ? t.displaySmall : t.headlineMedium),
              const SizedBox(height: 8),
              Text(
                'Hotels, places and day-by-day itineraries across Cambodia and Southeast Asia, built on real stored listings.',
                style: t.bodyLarge?.copyWith(color: Tokens.inkMuted),
              ),
              const SizedBox(height: 20),
              const SearchPanel(),
              const SizedBox(height: 12),
              Wrap(spacing: 8, runSpacing: 8, children: [
                ActionChip(avatar: const Icon(Icons.auto_awesome_outlined, size: 18), label: const Text('Plan with the AI trip planner'), onPressed: () => context.go('/trips/new')),
                ActionChip(avatar: const Icon(Icons.map_outlined, size: 18), label: const Text('Explore on the map'), onPressed: () => context.go('/map')),
                ActionChip(avatar: const Icon(Icons.chat_bubble_outline, size: 18), label: const Text('Ask the travel guide'), onPressed: () => context.go('/assistant')),
              ]),
            ]),
          ),
        ),
        Constrained(
          child: AsyncView<Map<String, dynamic>>(
            value: home,
            onRetry: () => ref.invalidate(homeProvider),
            data: (h) {
              final featured = (h['featured'] as List).cast<Map<String, dynamic>>();
              final trending = (h['trending'] as List).cast<Map<String, dynamic>>();
              final hotels = (h['hotels'] as List).cast<Map<String, dynamic>>();
              final trips = (h['itineraries'] as List).cast<Map<String, dynamic>>();
              final cats = (h['categories'] as List).cast<Map<String, dynamic>>();
              final money = ref.watch(moneyProvider);
              return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (recent.isNotEmpty) ...[
                  const SectionHeader('Recently viewed'),
                  SizedBox(
                    height: 44,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: recent.length,
                      separatorBuilder: (_, _) => const SizedBox(width: 8),
                      itemBuilder: (_, i) {
                        final r = recent[i];
                        return ActionChip(
                          avatar: Icon(r['kind'] == 'stay' ? Icons.hotel_outlined : Icons.place_outlined, size: 18),
                          label: Text(r['name']!),
                          onPressed: () => context.push(r['kind'] == 'stay' ? '/stays/${r['slug']}' : '/destinations/${r['slug']}'),
                        );
                      },
                    ),
                  ),
                ],
                SectionHeader('Featured destinations', subtitle: 'Where travellers are heading next', action: 'See all', onAction: () => context.go('/destinations')),
                ResponsiveGrid(minTile: 260, children: [for (final d in featured) DestinationCard(d)]),
                SectionHeader('Browse by interest', subtitle: 'Over ${h['counts']['places']} places, activities and restaurants'),
                Wrap(spacing: 8, runSpacing: 8, children: [
                  for (final c in cats.where((c) => c['category'] != 'food').take(10))
                    ActionChip(
                      avatar: Icon(categoryIcon(c['category'] as String), size: 18),
                      label: Text('${(c['category'] as String)[0].toUpperCase()}${(c['category'] as String).substring(1)} · ${c['count']}'),
                      onPressed: () => context.go('/destinations?tag=${c['category']}'),
                    ),
                ]),
                const SectionHeader('Top-rated stays', subtitle: 'Sample demo listings, rated by demo reviewers'),
                ResponsiveGrid(minTile: 300, children: [
                  for (final s in hotels)
                    StayCard({
                      ...s,
                      'cover_image': s['cover_image'],
                      'price_from': s['from_price_usd'],
                      'destination_name': s['destination_name'],
                    }),
                ]),
                SectionHeader('Ready-made itineraries', subtitle: 'Generated from stored places; copy one and make it yours'),
                ResponsiveGrid(minTile: 300, children: [
                  for (final it in trips)
                    Card(
                      child: InkWell(
                        borderRadius: BorderRadius.circular(Tokens.radius),
                        onTap: () => context.push('/trips/${it['id']}'),
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Pill('${it['num_days']} day${it['num_days'] == 1 ? '' : 's'} · ${it['destination_name']}', icon: Icons.route_outlined),
                            const SizedBox(height: 10),
                            Text(it['title'] as String, style: t.titleMedium),
                            const SizedBox(height: 6),
                            Text('Estimated ${money(it['est_total_usd'] as num)}', style: const TextStyle(color: Tokens.inkMuted)),
                          ]),
                        ),
                      ),
                    ),
                ]),
                const SectionHeader('Trending'),
                SizedBox(
                  height: 44,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: trending.length,
                    separatorBuilder: (_, _) => const SizedBox(width: 8),
                    itemBuilder: (_, i) => ActionChip(label: Text(trending[i]['name'] as String), onPressed: () => context.push('/destinations/${trending[i]['slug']}')),
                  ),
                ),
                const SizedBox(height: 40),
                const _Honesty(),
                const SizedBox(height: 40),
              ]);
            },
          ),
        ),
      ],
    );
  }
}

class _Honesty extends StatelessWidget {
  const _Honesty();
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Tokens.sand, borderRadius: BorderRadius.circular(Tokens.radius)),
        child: const Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(Icons.info_outline, size: 20, color: Tokens.inkMuted),
          SizedBox(width: 12),
          Expanded(
            child: Text(
              'WAYFARER is an academic capstone demo. Landmarks are real places with indicative prices and hours; hotels, restaurants, reviews, bookings and payments are educational sample data. Payments are simulated and no money moves.',
              style: TextStyle(color: Tokens.inkMuted, fontSize: 13, height: 1.4),
            ),
          ),
        ]),
      );
}
