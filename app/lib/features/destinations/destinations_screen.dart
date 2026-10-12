import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/providers.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/theme.dart';
import '../../core/widgets/cards.dart';
import '../../core/widgets/widgets.dart';
import '../auth/auth_controller.dart';
import '../maps/place_map.dart';
import 'places_screen.dart';

class DestinationsScreen extends ConsumerStatefulWidget {
  const DestinationsScreen({super.key, this.initialTag});
  final String? initialTag;
  @override
  ConsumerState<DestinationsScreen> createState() => _DestinationsScreenState();
}

class _DestinationsScreenState extends ConsumerState<DestinationsScreen> {
  late DestQuery q = DestQuery(tag: widget.initialTag);
  final _search = TextEditingController();

  static const tags = ['culture', 'food', 'temples', 'beach', 'nature', 'family', 'relaxed', 'city'];

  @override
  Widget build(BuildContext context) {
    final res = ref.watch(destinationsProvider(q));
    return ListView(children: [
      Constrained(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const SizedBox(height: 24),
          Semantics(header: true, child: Text('Destinations', style: Theme.of(context).textTheme.headlineMedium)),
          const SizedBox(height: 16),
          TextField(
            controller: _search,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Search destinations',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _search.text.isEmpty ? null : IconButton(tooltip: 'Clear', icon: const Icon(Icons.close), onPressed: () => setState(() { _search.clear(); q = q.copyWith(q: null, page: 1); })),
            ),
            onSubmitted: (v) => setState(() => q = q.copyWith(q: v.trim().isEmpty ? null : v.trim(), page: 1)),
          ),
          const SizedBox(height: 12),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(children: [
              FilterChip(label: const Text('Cambodia'), selected: q.international == false, onSelected: (s) => setState(() => q = q.copyWith(international: s ? false : null, page: 1))),
              const SizedBox(width: 8),
              FilterChip(label: const Text('International'), selected: q.international == true, onSelected: (s) => setState(() => q = q.copyWith(international: s ? true : null, page: 1))),
              const SizedBox(width: 16),
              for (final t in tags) ...[
                FilterChip(label: Text(t[0].toUpperCase() + t.substring(1)), selected: q.tag == t, onSelected: (s) => setState(() => q = q.copyWith(tag: s ? t : null, page: 1))),
                const SizedBox(width: 8),
              ],
            ]),
          ),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(
              child: AsyncView<Json>(value: res, loading: const SizedBox(height: 20), data: (r) => Text('${r['total']} destinations', style: const TextStyle(color: Tokens.inkMuted)), onRetry: null),
            ),
            DropdownButton<String>(
              value: q.sort,
              underline: const SizedBox.shrink(),
              items: const [
                DropdownMenuItem(value: 'popularity', child: Text('Most popular')),
                DropdownMenuItem(value: 'name', child: Text('Name A–Z')),
                DropdownMenuItem(value: 'budget_asc', child: Text('Budget: low to high')),
                DropdownMenuItem(value: 'budget_desc', child: Text('Budget: high to low')),
              ],
              onChanged: (v) => setState(() => q = q.copyWith(sort: v, page: 1)),
            ),
          ]),
          const SizedBox(height: 12),
          AsyncView<Json>(
            value: res,
            onRetry: () => ref.invalidate(destinationsProvider(q)),
            loading: const SkeletonList(count: 3, itemHeight: 200),
            data: (r) {
              final items = (r['items'] as List).cast<Json>();
              if (items.isEmpty) {
                return EmptyState(
                  title: 'No destinations match',
                  message: 'Try removing a filter or searching for a different name.',
                  action: OutlinedButton(onPressed: () => setState(() { _search.clear(); q = const DestQuery(); }), child: const Text('Clear filters')),
                );
              }
              final pages = r['totalPages'] as int;
              return Column(children: [
                ResponsiveGrid(minTile: 260, children: [for (final d in items) DestinationCard(d)]),
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
          const SizedBox(height: 32),
        ]),
      ),
    ]);
  }
}

class DestinationDetailScreen extends ConsumerStatefulWidget {
  const DestinationDetailScreen({super.key, required this.slug});
  final String slug;
  @override
  ConsumerState<DestinationDetailScreen> createState() => _DestinationDetailScreenState();
}

class _DestinationDetailScreenState extends ConsumerState<DestinationDetailScreen> {
  String? kind;
  bool recorded = false;

  @override
  Widget build(BuildContext context) {
    final res = ref.watch(destinationProvider(widget.slug));
    final money = ref.watch(moneyProvider);
    final t = Theme.of(context).textTheme;

    return AsyncView<Json>(
      value: res,
      onRetry: () => ref.invalidate(destinationProvider(widget.slug)),
      data: (d) {
        if (!recorded) {
          recorded = true;
          Future.microtask(() => ref.read(recentProvider.notifier).add('destination', d['slug'] as String, d['name'] as String));
        }
        final images = (d['images'] as List).cast<Json>();
        final places = ref.watch(destinationPlacesProvider((slug: widget.slug, kind: kind)));
        final related = (d['related'] as List).cast<Json>();
        final hotels = (d['top_accommodations'] as List).cast<Json>();
        final guides = (d['guides'] as List).cast<Json>();
        final wide = isWide(context);

        final info = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(d['long_description'] as String, style: t.bodyLarge?.copyWith(height: 1.5)),
          const SizedBox(height: 20),
          _fact(Icons.payments_outlined, 'Typical daily budget', '${money(d['daily_budget_usd'] as num)} per person, mid-range (indicative)'),
          if (d['best_period'] != null) _fact(Icons.wb_sunny_outlined, 'Best time to go', d['best_period'] as String),
          if (d['transport_info'] != null) _fact(Icons.directions_bus_outlined, 'Getting around', d['transport_info'] as String),
          if (d['practical_info'] != null) _fact(Icons.info_outline, 'Good to know', d['practical_info'] as String),
        ]);

        return ListView(children: [
          SizedBox(
            height: wide ? 380 : 240,
            child: Stack(fit: StackFit.expand, children: [
              WImage(d['cover_image'] as String?, label: 'Photo of ${d['name']}', height: double.infinity, width: double.infinity, full: true),
              Container(decoration: const BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0x00000000), Color(0xB3000000)]))),
              Positioned(
                left: 0,
                right: 0,
                bottom: 20,
                child: Constrained(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(d['name'] as String, style: (wide ? t.displaySmall : t.headlineMedium)?.copyWith(color: Colors.white)),
                    Text('${d['region'] ?? ''}${d['region'] != null ? ', ' : ''}${d['country']}', style: const TextStyle(color: Colors.white70)),
                  ]),
                ),
              ),
            ]),
          ),
          if (d['image_credit'] != null)
            Constrained(child: Padding(padding: const EdgeInsets.only(top: 6), child: Text(d['image_credit'] as String, style: const TextStyle(fontSize: 11, color: Tokens.inkMuted)))),
          Constrained(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const SizedBox(height: 20),
              Wrap(spacing: 12, runSpacing: 8, children: [
                FilledButton.icon(onPressed: () => context.go('/stays?destination=${d['slug']}'), icon: const Icon(Icons.hotel_outlined), label: Text('Find stays in ${d['name']}')),
                OutlinedButton.icon(onPressed: () => context.go('/trips/new?destination=${d['slug']}'), icon: const Icon(Icons.auto_awesome_outlined), label: const Text('Plan a trip')),
                SaveButton(kind: 'destination', id: d['id'] as String),
              ]),
              const SizedBox(height: 20),
              if (wide)
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Expanded(flex: 3, child: info),
                  const SizedBox(width: 32),
                  Expanded(
                    flex: 2,
                    child: PlaceMap(
                      height: 300,
                      points: [MapPoint(lat: (d['lat'] as num).toDouble(), lng: (d['lng'] as num).toDouble(), title: d['name'] as String, kind: 'destination')],
                    ),
                  ),
                ])
              else ...[
                info,
                const SizedBox(height: 16),
                PlaceMap(height: 220, points: [MapPoint(lat: (d['lat'] as num).toDouble(), lng: (d['lng'] as num).toDouble(), title: d['name'] as String, kind: 'destination')]),
              ],
              if (images.length > 1) ...[
                const SectionHeader('Gallery'),
                SizedBox(
                  height: 150,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: images.length,
                    separatorBuilder: (_, _) => const SizedBox(width: 8),
                    itemBuilder: (_, i) => WImage(images[i]['url'] as String?, width: 220, height: 150, radius: 8, label: images[i]['caption'] as String?),
                  ),
                ),
              ],
              const SectionHeader('Things to do and eat'),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(children: [
                  for (final (label, value) in const [('All', null), ('Attractions', 'attraction'), ('Activities', 'activity'), ('Restaurants', 'restaurant')]) ...[
                    ChoiceChip(label: Text(label), selected: kind == value, onSelected: (_) => setState(() => kind = value)),
                    const SizedBox(width: 8),
                  ],
                ]),
              ),
              const SizedBox(height: 12),
              AsyncView<Json>(
                value: places,
                onRetry: () => ref.invalidate(destinationPlacesProvider((slug: widget.slug, kind: kind))),
                data: (p) {
                  final items = (p['items'] as List).cast<Json>();
                  if (items.isEmpty) return const EmptyState(title: 'Nothing listed yet', message: 'We have no places of this type for this destination.');
                  return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    ResponsiveGrid(minTile: 380, spacing: 12, children: [for (final it in items) PlaceTile(it, onTap: () => _placeSheet(context, it))]),
                    const SizedBox(height: 16),
                    PlaceMap(
                      height: 320,
                      points: [
                        for (final it in items.where((i) => i['lat'] != null))
                          MapPoint(lat: (it['lat'] as num).toDouble(), lng: (it['lng'] as num).toDouble(), title: it['name'] as String, subtitle: it['category'] as String?, kind: it['kind'] == 'restaurant' ? 'restaurant' : 'place'),
                      ],
                    ),
                  ]);
                },
              ),
              if (hotels.isNotEmpty) ...[
                SectionHeader('Where to stay', action: 'See all', onAction: () => context.go('/stays?destination=${d['slug']}')),
                ResponsiveGrid(minTile: 280, children: [for (final h in hotels) StayCard({...h, 'price_from': h['from_price_usd'], 'destination_name': d['name']})]),
              ],
              if (related.isNotEmpty) ...[
                const SectionHeader('Nearby and related'),
                ResponsiveGrid(minTile: 240, children: [
                  for (final r in related)
                    Stack(children: [
                      DestinationCard(r),
                      Positioned(right: 8, top: 8, child: Pill('${r['distance_km']} km away', icon: Icons.near_me_outlined)),
                    ]),
                ]),
              ],
              if (guides.isNotEmpty) ...[
                const SectionHeader('Travel guides'),
                Wrap(spacing: 8, runSpacing: 8, children: [
                  for (final g in guides) ActionChip(avatar: const Icon(Icons.menu_book_outlined, size: 18), label: Text(g['title'] as String), onPressed: () => context.go('/assistant?q=${Uri.encodeComponent(g['title'] as String)}&destination=${d['slug']}')),
                ]),
              ],
              const SizedBox(height: 48),
            ]),
          ),
        ]);
      },
    );
  }

  Widget _fact(IconData icon, String title, String body) => Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, size: 20, color: Tokens.forest),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: const TextStyle(fontWeight: FontWeight.w600)), const SizedBox(height: 2), Text(body, style: const TextStyle(color: Tokens.inkMuted, height: 1.4))])),
        ]),
      );

  void _placeSheet(BuildContext context, Json p) => showPlaceSheet(context, ref, p);
}

class SaveButton extends ConsumerWidget {
  const SaveButton({super.key, required this.kind, required this.id});
  final String kind, id;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final signedIn = ref.watch(authProvider).signedIn;
    final wish = signedIn ? ref.watch(wishlistProvider).value : null;
    final saved = (wish?['items'] as List?)?.any((i) => i['ref_id'] == id) ?? false;
    return OutlinedButton.icon(
      onPressed: () async {
        if (!signedIn) {
          context.push('/login?next=${Uri.encodeComponent(GoRouterState.of(context).uri.toString())}');
          return;
        }
        try {
          final api = ref.read(apiProvider);
          if (saved) {
            await api.delete('/wishlist/$kind/$id');
          } else {
            await api.putEmpty('/wishlist/$kind/$id');
          }
          ref.invalidate(wishlistProvider);
        } catch (e) {
          if (context.mounted) showError(context, e);
        }
      },
      icon: Icon(saved ? Icons.favorite : Icons.favorite_border, color: saved ? Tokens.terracotta : null),
      label: Text(saved ? 'Saved' : 'Save'),
    );
  }
}
