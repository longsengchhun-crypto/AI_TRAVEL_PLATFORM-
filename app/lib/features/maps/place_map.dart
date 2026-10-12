import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/theme/theme.dart';

class MapPoint {
  const MapPoint({required this.lat, required this.lng, required this.title, this.subtitle, this.kind = 'place', this.index, this.onTap});
  final double lat, lng;
  final String title;
  final String? subtitle;
  final String kind; // destination | stay | place | restaurant | user
  final int? index;
  final VoidCallback? onTap;
  LatLng get ll => LatLng(lat, lng);
}

Color _kindColor(String k) => switch (k) {
      'stay' => Tokens.terracotta,
      'destination' => Tokens.forestDeep,
      'restaurant' => Tokens.amber,
      'user' => const Color(0xFF2B6CB0),
      _ => Tokens.forest,
    };

IconData _kindIcon(String k) => switch (k) {
      'stay' => Icons.hotel_rounded,
      'restaurant' => Icons.restaurant_rounded,
      'destination' => Icons.location_city_rounded,
      'user' => Icons.my_location_rounded,
      _ => Icons.place_rounded,
    };

/// OpenStreetMap-backed map (no API key). Markers, optional day route polyline, and honest attribution.
/// The polyline is a straight-line connection between stops, not a routed road path.
class PlaceMap extends StatefulWidget {
  const PlaceMap({super.key, required this.points, this.height = 320, this.drawRoute = false, this.interactive = true, this.showDetail = true});
  final List<MapPoint> points;
  final double height;
  final bool drawRoute;
  final bool interactive;
  final bool showDetail;

  @override
  State<PlaceMap> createState() => _PlaceMapState();
}

class _PlaceMapState extends State<PlaceMap> {
  MapPoint? selected;
  final controller = MapController();

  @override
  Widget build(BuildContext context) {
    final pts = widget.points;
    if (pts.isEmpty) {
      return SizedBox(height: widget.height, child: const Center(child: Text('No locations to show')));
    }
    final bounds = LatLngBounds.fromPoints(pts.map((p) => p.ll).toList());
    final single = pts.length == 1 || (bounds.north == bounds.south && bounds.east == bounds.west);
    return ClipRRect(
      borderRadius: BorderRadius.circular(Tokens.radius),
      child: SizedBox(
        height: widget.height,
        child: Stack(children: [
          FlutterMap(
            mapController: controller,
            options: MapOptions(
              initialCenter: single ? pts.first.ll : bounds.center,
              initialZoom: single ? 14 : 12,
              initialCameraFit: single ? null : CameraFit.bounds(bounds: bounds, padding: const EdgeInsets.all(48), maxZoom: 16),
              interactionOptions: InteractionOptions(flags: widget.interactive ? InteractiveFlag.all & ~InteractiveFlag.rotate : InteractiveFlag.none),
              onTap: (_, _) => setState(() => selected = null),
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.wayfarer.wayfarer',
              ),
              if (widget.drawRoute && pts.length > 1)
                PolylineLayer(polylines: [Polyline(points: pts.map((p) => p.ll).toList(), strokeWidth: 3.5, color: Tokens.forest.withValues(alpha: 0.75), pattern: StrokePattern.dashed(segments: const [8, 6]))]),
              MarkerLayer(markers: [
                for (final p in pts)
                  Marker(
                    point: p.ll,
                    width: 40,
                    height: 40,
                    child: Semantics(
                      button: true,
                      label: p.title,
                      child: GestureDetector(
                        onTap: () {
                          setState(() => selected = p);
                          p.onTap?.call();
                        },
                        child: Container(
                          decoration: BoxDecoration(color: _kindColor(p.kind), shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 2), boxShadow: const [BoxShadow(blurRadius: 4, color: Color(0x33000000))]),
                          child: Center(
                            child: p.index != null
                                ? Text('${p.index}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700))
                                : Icon(_kindIcon(p.kind), color: Colors.white, size: 20),
                          ),
                        ),
                      ),
                    ),
                  ),
              ]),
              RichAttributionWidget(
                attributions: [
                  TextSourceAttribution('© OpenStreetMap contributors', onTap: () => launchUrl(Uri.parse('https://www.openstreetmap.org/copyright'))),
                ],
              ),
            ],
          ),
          Positioned(
            left: 8,
            top: 8,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.9), borderRadius: BorderRadius.circular(6)),
              child: const Text('OpenStreetMap · no live traffic', style: TextStyle(fontSize: 11, color: Tokens.inkMuted)),
            ),
          ),
          if (widget.showDetail && selected != null)
            Positioned(
              left: 12,
              right: 12,
              bottom: 24,
              child: Card(
                child: ListTile(
                  title: Text(selected!.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: selected!.subtitle == null ? null : Text(selected!.subtitle!, maxLines: 2, overflow: TextOverflow.ellipsis),
                  trailing: IconButton(
                    tooltip: 'Open in maps app',
                    icon: const Icon(Icons.directions_outlined),
                    onPressed: () => launchUrl(Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${selected!.lat},${selected!.lng}'), mode: LaunchMode.externalApplication),
                  ),
                ),
              ),
            ),
        ]),
      ),
    );
  }
}
