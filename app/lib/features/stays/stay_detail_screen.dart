import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/providers.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/theme.dart';
import '../../core/widgets/cards.dart';
import '../../core/widgets/widgets.dart';
import '../auth/auth_controller.dart';
import '../destinations/destinations_screen.dart';
import '../maps/place_map.dart';

IconData amenityIcon(String code) => switch (code) {
      'wifi' => Icons.wifi,
      'pool' => Icons.pool,
      'ac' => Icons.ac_unit,
      'breakfast' => Icons.free_breakfast_outlined,
      'parking' => Icons.local_parking,
      'airport-shuttle' => Icons.airport_shuttle_outlined,
      'gym' => Icons.fitness_center,
      'spa' => Icons.spa_outlined,
      'restaurant' => Icons.restaurant_outlined,
      'family-room' => Icons.family_restroom,
      'kids-pool' => Icons.child_care,
      'accessible' => Icons.accessible,
      'bar' => Icons.local_bar_outlined,
      'laundry' => Icons.local_laundry_service_outlined,
      'kitchen' => Icons.kitchen_outlined,
      _ => Icons.check_circle_outline,
    };

class StayDetailScreen extends ConsumerStatefulWidget {
  const StayDetailScreen({super.key, required this.slug, required this.params});
  final String slug;
  final Map<String, String> params;
  @override
  ConsumerState<StayDetailScreen> createState() => _StayDetailScreenState();
}

class _StayDetailScreenState extends ConsumerState<StayDetailScreen> {
  late String? ci = widget.params['checkIn'];
  late String? co = widget.params['checkOut'];
  late int rooms = int.tryParse(widget.params['rooms'] ?? '') ?? 1;
  late int adults = int.tryParse(widget.params['adults'] ?? '') ?? 2;
  late int children = int.tryParse(widget.params['children'] ?? '') ?? 0;
  bool recorded = false;

  StayKey get key => (slug: widget.slug, checkIn: ci, checkOut: co, rooms: rooms);

  Future<void> _pickDates() async {
    final now = DateTime.now();
    final r = await showDateRangePicker(
      context: context,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: now.add(const Duration(days: 119)),
      initialDateRange: ci != null && co != null ? DateTimeRange(start: DateTime.parse(ci!), end: DateTime.parse(co!)) : null,
    );
    if (r != null) setState(() { ci = iso(r.start); co = iso(r.end); });
  }

  @override
  Widget build(BuildContext context) {
    final res = ref.watch(stayDetailProvider(key));
    final money = ref.watch(moneyProvider);
    final t = Theme.of(context).textTheme;
    final wide = isWide(context);

    return AsyncView<Json>(
      value: res,
      onRetry: () => ref.invalidate(stayDetailProvider(key)),
      data: (a) {
        if (!recorded) {
          recorded = true;
          Future.microtask(() => ref.read(recentProvider.notifier).add('stay', a['slug'] as String, a['name'] as String));
        }
        final images = (a['images'] as List).cast<Json>();
        final amenities = (a['amenities'] as List).cast<Json>();
        final roomsList = (a['room_types'] as List).cast<Json>();
        final nights = nightsBetween(ci, co);
        final lat = (a['lat'] as num).toDouble(), lng = (a['lng'] as num).toDouble();
        final gallery = <String>[if (a['cover_image'] != null) a['cover_image'] as String, ...images.map((i) => i['url'] as String)];

        final header = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [StarRow(a['stars'] as int), const SizedBox(width: 8), Text(typeLabel(a['type'] as String?), style: const TextStyle(color: Tokens.inkMuted)), const SizedBox(width: 8), if (a['is_demo'] == true) const DemoBadge()]),
          const SizedBox(height: 8),
          Text(a['name'] as String, style: wide ? t.displaySmall : t.headlineMedium),
          const SizedBox(height: 6),
          Row(children: [
            const Icon(Icons.place_outlined, size: 16, color: Tokens.inkMuted),
            const SizedBox(width: 4),
            Expanded(child: Text('${a['address']}', style: const TextStyle(color: Tokens.inkMuted))),
          ]),
          const SizedBox(height: 8),
          RatingBadge(rating: (a['rating_avg'] ?? 0) as num, count: (a['review_count'] ?? 0) as int),
        ]);

        final dateBar = Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Wrap(spacing: 12, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
              OutlinedButton.icon(
                onPressed: _pickDates,
                icon: const Icon(Icons.calendar_month_outlined),
                label: Text(ci != null && co != null ? '${fmtDate(ci)} → ${fmtDate(co)} · $nights night${nights == 1 ? '' : 's'}' : 'Choose dates to see prices'),
              ),
              Text('$adults adult${adults > 1 ? 's' : ''}${children > 0 ? ', $children child${children > 1 ? 'ren' : ''}' : ''} · $rooms room${rooms > 1 ? 's' : ''}', style: const TextStyle(color: Tokens.inkMuted)),
              IconButton(tooltip: 'Add a room', onPressed: rooms < 6 ? () => setState(() => rooms++) : null, icon: const Icon(Icons.add_circle_outline)),
              IconButton(tooltip: 'Remove a room', onPressed: rooms > 1 ? () => setState(() => rooms--) : null, icon: const Icon(Icons.remove_circle_outline)),
            ]),
          ),
        );

        final roomsSection = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const SectionHeader('Choose your room'),
          dateBar,
          const SizedBox(height: 12),
          for (final r in roomsList)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _RoomCard(
                room: r,
                money: money,
                nights: nights,
                guestsFit: adults <= (r['max_adults'] as int) * rooms && children <= (r['max_children'] as int) * rooms,
                onReserve: () {
                  final qp = {'checkIn': ci!, 'checkOut': co!, 'rooms': '$rooms', 'adults': '$adults', 'children': '$children', 'stay': a['slug'] as String};
                  context.push(Uri(path: '/book/${r['id']}', queryParameters: qp).toString());
                },
                onNeedDates: _pickDates,
              ),
            ),
        ]);

        final body = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(a['description'] as String, style: t.bodyLarge?.copyWith(height: 1.5)),
          const SectionHeader('Amenities'),
          Wrap(spacing: 8, runSpacing: 8, children: [for (final m in amenities) Chip(avatar: Icon(amenityIcon(m['code'] as String), size: 18), label: Text(m['label'] as String))]),
          const SectionHeader('Policies'),
          _policy(Icons.event_available_outlined, 'Cancellation', a['cancellation_policy'] as String),
          _policy(Icons.login, 'Check-in', 'From ${a['check_in_from']}'),
          _policy(Icons.logout, 'Check-out', 'By ${a['check_out_until']}'),
          _policy(Icons.receipt_long_outlined, 'Taxes and fees', '${((a['tax_rate'] as num) * 100).toStringAsFixed(0)}% tax and ${((a['service_fee_rate'] as num) * 100).toStringAsFixed(0)}% service fee are added to the room rate and shown before you pay.'),
        ]);

        return ListView(children: [
          Constrained(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const SizedBox(height: 16),
              _Gallery(urls: gallery, name: a['name'] as String),
              if (a['image_credit'] != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(a['image_credit'] as String, style: const TextStyle(fontSize: 11, color: Tokens.inkMuted))),
              const SizedBox(height: 20),
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: header), SaveButton(kind: 'accommodation', id: a['id'] as String)]),
              if (a['data_notice'] != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: Tokens.amber.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(8)),
                    child: Text(a['data_notice'] as String, style: const TextStyle(fontSize: 13)),
                  ),
                ),
              const SizedBox(height: 12),
              if (wide)
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Expanded(flex: 3, child: body),
                  const SizedBox(width: 32),
                  Expanded(flex: 2, child: Padding(padding: const EdgeInsets.only(top: 32), child: PlaceMap(height: 320, points: [MapPoint(lat: lat, lng: lng, title: a['name'] as String, subtitle: a['address'] as String?, kind: 'stay')]))),
                ])
              else ...[
                body,
                const SectionHeader('Location'),
                PlaceMap(height: 240, points: [MapPoint(lat: lat, lng: lng, title: a['name'] as String, subtitle: a['address'] as String?, kind: 'stay')]),
              ],
              roomsSection,
              _Reviews(slug: a['slug'] as String, accId: a['id'] as String),
              if ((a['related'] as List).isNotEmpty) ...[
                const SectionHeader('Similar stays nearby'),
                ResponsiveGrid(minTile: 240, children: [for (final r in (a['related'] as List).cast<Json>()) StayCard({...r, 'price_from': r['from_price_usd'], 'destination_name': a['destination_name']})]),
              ],
              const SizedBox(height: 48),
            ]),
          ),
        ]);
      },
    );
  }

  Widget _policy(IconData i, String title, String body) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(i, size: 20, color: Tokens.forest),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: const TextStyle(fontWeight: FontWeight.w600)), Text(body, style: const TextStyle(color: Tokens.inkMuted, height: 1.4))])),
        ]),
      );
}

class _Gallery extends StatefulWidget {
  const _Gallery({required this.urls, required this.name});
  final List<String> urls;
  final String name;
  @override
  State<_Gallery> createState() => _GalleryState();
}

class _GalleryState extends State<_Gallery> {
  int i = 0;
  @override
  Widget build(BuildContext context) {
    final urls = widget.urls;
    if (urls.isEmpty) return WImage(null, height: 260, width: double.infinity, radius: 12, fallbackIcon: Icons.hotel_outlined);
    return Column(children: [
      AspectRatio(
        aspectRatio: isWide(context) ? 2.6 : 1.6,
        child: Stack(fit: StackFit.expand, children: [
          WImage(urls[i], radius: 12, label: 'Photo ${i + 1} of ${urls.length} for ${widget.name}', height: double.infinity, width: double.infinity, fallbackIcon: Icons.hotel_outlined),
          if (urls.length > 1) ...[
            Positioned(left: 8, top: 0, bottom: 0, child: Center(child: IconButton.filledTonal(tooltip: 'Previous photo', onPressed: () => setState(() => i = (i - 1 + urls.length) % urls.length), icon: const Icon(Icons.chevron_left)))),
            Positioned(right: 8, top: 0, bottom: 0, child: Center(child: IconButton.filledTonal(tooltip: 'Next photo', onPressed: () => setState(() => i = (i + 1) % urls.length), icon: const Icon(Icons.chevron_right)))),
            Positioned(right: 12, bottom: 12, child: Pill('${i + 1} / ${urls.length}', color: Colors.black)),
          ],
        ]),
      ),
    ]);
  }
}

class _RoomCard extends StatelessWidget {
  const _RoomCard({required this.room, required this.money, required this.nights, required this.guestsFit, required this.onReserve, required this.onNeedDates});
  final Json room;
  final String Function(num) money;
  final int nights;
  final bool guestsFit;
  final VoidCallback onReserve, onNeedDates;

  @override
  Widget build(BuildContext context) {
    final quote = room['quote'] as Json?;
    final available = quote?['available'] == true;
    final reason = quote?['reason'] as String?;
    Widget action;
    if (quote == null) {
      action = OutlinedButton(onPressed: onNeedDates, child: const Text('Select dates'));
    } else if (!guestsFit) {
      action = const Pill('Too small for your party', color: Tokens.danger);
    } else if (!available) {
      action = const Pill('Not available', color: Tokens.danger);
    } else {
      action = FilledButton(onPressed: onReserve, child: const Text('Reserve'));
    }
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(room['name'] as String, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 4),
                Text(room['description'] as String, style: const TextStyle(color: Tokens.inkMuted)),
                const SizedBox(height: 8),
                Wrap(spacing: 12, runSpacing: 4, children: [
                  _meta(Icons.bed_outlined, room['bed_type'] as String),
                  _meta(Icons.people_outline, 'Up to ${room['max_adults']} adults${(room['max_children'] as int) > 0 ? ' + ${room['max_children']} children' : ''}'),
                  if (room['size_sqm'] != null) _meta(Icons.square_foot, '${room['size_sqm']} m²'),
                  if (room['breakfast_included'] == true) _meta(Icons.free_breakfast_outlined, 'Breakfast included'),
                ]),
              ]),
            ),
            const SizedBox(width: 12),
            Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text(money(room['base_price_usd'] as num), style: Theme.of(context).textTheme.titleLarge),
              const Text('base / night', style: TextStyle(fontSize: 12, color: Tokens.inkMuted)),
            ]),
          ]),
          if (quote != null && available && guestsFit) ...[
            const Divider(height: 24),
            PriceRow('${money((quote['subtotal_usd'] as num) / (quote['rooms'] as int) / (quote['nights'] as int))} avg × ${quote['nights']} night${quote['nights'] == 1 ? '' : 's'}${(quote['rooms'] as int) > 1 ? ' × ${quote['rooms']} rooms' : ''}', money(quote['subtotal_usd'] as num)),
            PriceRow('Taxes (${((quote['tax_rate'] as num) * 100).toStringAsFixed(0)}%)', money(quote['taxes_usd'] as num), muted: true),
            PriceRow('Service fee (${((quote['service_fee_rate'] as num) * 100).toStringAsFixed(0)}%)', money(quote['fees_usd'] as num), muted: true),
            PriceRow('Total', money(quote['total_usd'] as num), bold: true),
          ],
          if (quote != null && !available && reason != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(reason, style: const TextStyle(color: Tokens.danger))),
          const SizedBox(height: 12),
          Align(alignment: Alignment.centerRight, child: action),
        ]),
      ),
    );
  }

  Widget _meta(IconData i, String t) => Row(mainAxisSize: MainAxisSize.min, children: [Icon(i, size: 16, color: Tokens.inkMuted), const SizedBox(width: 4), Text(t, style: const TextStyle(fontSize: 13, color: Tokens.inkMuted))]);
}

class _Reviews extends ConsumerWidget {
  const _Reviews({required this.slug, required this.accId});
  final String slug, accId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final res = ref.watch(reviewsProvider(slug));
    final signedIn = ref.watch(authProvider).signedIn;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SectionHeader('Guest reviews', subtitle: 'Reviews in this demo are sample data', action: 'Write a review', onAction: () {
        if (!signedIn) {
          context.push('/login?next=${Uri.encodeComponent(GoRouterState.of(context).uri.toString())}');
        } else {
          _write(context, ref);
        }
      }),
      AsyncView<Json>(
        value: res,
        onRetry: () => ref.invalidate(reviewsProvider(slug)),
        data: (r) {
          final items = (r['items'] as List).cast<Json>();
          if (items.isEmpty) return const EmptyState(title: 'No reviews yet', message: 'Be the first to share your stay.', icon: Icons.rate_review_outlined);
          return Column(children: [
            for (final v in items)
              Card(
                margin: const EdgeInsets.only(bottom: 10),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      for (var i = 0; i < (v['rating'] as int); i++) const Icon(Icons.star_rounded, size: 16, color: Tokens.amber),
                      const SizedBox(width: 8),
                      Expanded(child: Text(v['title'] as String, style: const TextStyle(fontWeight: FontWeight.w600))),
                      if (v['is_demo'] == true) const DemoBadge(text: 'Demo review') else if (v['verified_stay'] == true) const Pill('Verified stay', icon: Icons.verified_outlined),
                    ]),
                    const SizedBox(height: 6),
                    Text(v['body'] as String, style: const TextStyle(height: 1.4)),
                    const SizedBox(height: 6),
                    Text('${v['author']} · ${fmtDate(v['created_at'] as String?, pattern: 'MMM y')}', style: const TextStyle(color: Tokens.inkMuted, fontSize: 12)),
                  ]),
                ),
              ),
          ]);
        },
      ),
    ]);
  }

  Future<void> _write(BuildContext context, WidgetRef ref) async {
    var rating = 5;
    final title = TextEditingController();
    final body = TextEditingController();
    final formKey = GlobalKey<FormState>();
    await showDialog<void>(
      context: context,
      builder: (c) => StatefulBuilder(builder: (c, set) => AlertDialog(
        title: const Text('Write a review'),
        content: SizedBox(
          width: 420,
          child: Form(
            key: formKey,
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Row(children: [for (var i = 1; i <= 5; i++) IconButton(tooltip: '$i star${i > 1 ? 's' : ''}', onPressed: () => set(() => rating = i), icon: Icon(i <= rating ? Icons.star_rounded : Icons.star_border_rounded, color: Tokens.amber))]),
              TextFormField(controller: title, decoration: const InputDecoration(labelText: 'Title'), validator: (v) => (v ?? '').trim().length < 3 ? 'Add a short title' : null),
              const SizedBox(height: 12),
              TextFormField(controller: body, decoration: const InputDecoration(labelText: 'Your experience'), maxLines: 4, validator: (v) => (v ?? '').trim().length < 10 ? 'Please write at least 10 characters' : null),
              const SizedBox(height: 8),
              const Text('Only guests with a confirmed booking can review a property.', style: TextStyle(fontSize: 12, color: Tokens.inkMuted)),
            ]),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: const Text('Cancel')),
          FilledButton(
            onPressed: () async {
              if (!formKey.currentState!.validate()) return;
              try {
                await ref.read(apiProvider).postJson('/accommodations/$slug/reviews', body: {'rating': rating, 'title': title.text.trim(), 'body': body.text.trim()});
                ref.invalidate(reviewsProvider(slug));
                if (c.mounted) Navigator.pop(c);
              } catch (e) {
                if (c.mounted) showError(c, e);
              }
            },
            child: const Text('Submit'),
          ),
        ],
      )),
    );
  }
}
