# Maps and location

- **Provider:** OpenStreetMap tiles through `flutter_map`; no API key. A permanent label reads "OpenStreetMap - no live traffic" and attribution is shown. This is a real tile provider, not a mock. Google Maps (`MAPS_API_KEY`) is **not** integrated.
- **Markers:** destinations, stays, places, restaurants, user position; tapping shows a detail card with an external directions link.
- **Itinerary route:** dashed polyline between ordered stops (straight lines, labelled as such).
- **Location:** Geolocator with explicit handling for services disabled, denied, denied-forever and timeouts; nearby stays use a server haversine query.
- **Estimates:** `POST /routes/estimate` returns great-circle x1.35 and 22 km/h, `liveTraffic:false`, plus external navigation links. Tile usage must respect the OSM tile policy; use a commercial tile provider for production traffic.
- **Search:** `/locations/search` queries WAYFARER's own gazetteer (not a global geocoder).
