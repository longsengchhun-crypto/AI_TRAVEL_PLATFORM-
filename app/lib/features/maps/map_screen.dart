import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/providers.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/theme.dart';
import '../../core/widgets/widgets.dart';
import 'place_map.dart';

/// Explore map: destinations, optionally stays near a chosen point (destination or the user's own location).
class MapScreen extends ConsumerStatefulWidget {
  const MapScreen({super.key});
  @override
  ConsumerState<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends ConsumerState<MapScreen> {
  Position? me;
  String? permissionMsg;
  bool locating = false;
  Json? nearby;
  Object? error;

  Future<void> _locate() async {
    setState(() { locating = true; permissionMsg = null; });
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        setState(() => permissionMsg = 'Location services are turned off on this device.');
        return;
      }
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied) {
        setState(() => permissionMsg = 'Location permission was declined. You can still explore the map and search by destination.');
        return;
      }
      if (perm == LocationPermission.deniedForever) {
        setState(() => permissionMsg = 'Location permission is blocked. Enable it in your device or browser settings to use this feature.');
        return;
      }
      final p = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium, timeLimit: Duration(seconds: 12)));
      me = p;
      nearby = await ref.read(apiProvider).getJson('/accommodations', query: {'lat': p.latitude, 'lng': p.longitude, 'sort': 'distance', 'pageSize': 8, 'maxDistanceKm': 60});
      setState(() {});
    } catch (e) {
      setState(() => permissionMsg = 'We could not get your location (${e is ApiException ? e.message : 'timeout or unsupported'}).');
    } finally {
      if (mounted) setState(() => locating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final dests = ref.watch(destinationsProvider(const DestQuery().copyWith(sort: 'popularity')));
    final money = ref.watch(moneyProvider);
    final stays = (nearby?['items'] as List?)?.cast<Json>() ?? const [];

    return ListView(children: [
      Constrained(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Map', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 8),
            const Text('Destinations across the region. Use your location to find stays nearby. Distances are straight-line estimates.', style: TextStyle(color: Tokens.inkMuted)),
            const SizedBox(height: 16),
            Wrap(spacing: 12, runSpacing: 8, children: [
              FilledButton.icon(onPressed: locating ? null : _locate, icon: locating ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.my_location), label: const Text('Use my location')),
            ]),
            if (permissionMsg != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(permissionMsg!, style: const TextStyle(color: Tokens.terracotta))),
            const SizedBox(height: 16),
            AsyncView<Json>(
              value: dests,
              onRetry: () => ref.invalidate(destinationsProvider(const DestQuery().copyWith(sort: 'popularity'))),
              loading: const SkeletonBox(height: 520, radius: 10),
              data: (r) {
                final items = (r['items'] as List).cast<Json>();
                return PlaceMap(
                  height: 520,
                  points: [
                    for (final d in items) MapPoint(lat: (d['lat'] as num).toDouble(), lng: (d['lng'] as num).toDouble(), title: d['name'] as String, subtitle: d['country'] as String?, kind: 'destination'),
                    for (final s in stays) MapPoint(lat: (s['lat'] as num).toDouble(), lng: (s['lng'] as num).toDouble(), title: s['name'] as String, subtitle: '${money(s['price_from'] as num)} / night · ${s['distance_km']} km away', kind: 'stay'),
                    if (me != null) MapPoint(lat: me!.latitude, lng: me!.longitude, title: 'You are here', kind: 'user'),
                  ],
                );
              },
            ),
            if (stays.isNotEmpty) ...[
              const SectionHeader('Stays near you'),
              for (final s in stays)
                Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                    leading: const Icon(Icons.hotel_outlined, color: Tokens.terracotta),
                    title: Text(s['name'] as String),
                    subtitle: Text('${s['destination_name']} · ${s['distance_km']} km · ${money(s['price_from'] as num)} / night'),
                    onTap: () => context.push('/stays/${s['slug']}'),
                  ),
                ),
            ],
            if (nearby != null && stays.isEmpty) const EmptyState(title: 'No stays within 60 km', message: 'Our listings currently cover specific destinations. Try exploring a destination instead.'),
            if (error != null) ErrorState(error: error!),
          ]),
        ),
      ),
    ]);
  }
}
