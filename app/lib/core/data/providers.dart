import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../network/api_client.dart';

/// Immutable stay-search query. Value equality lets Riverpod cache identical searches.
class StayQuery {
  const StayQuery({
    this.destination,
    this.q,
    this.checkIn,
    this.checkOut,
    this.adults = 2,
    this.children = 0,
    this.rooms = 1,
    this.minPrice,
    this.maxPrice,
    this.stars = const {},
    this.minRating,
    this.amenities = const {},
    this.types = const {},
    this.freeCancellation = false,
    this.breakfast = false,
    this.familyFriendly = false,
    this.sort = 'relevance',
    this.page = 1,
    this.lat,
    this.lng,
    this.maxDistanceKm,
  });

  final String? destination, q, checkIn, checkOut, sort;
  final int adults, children, rooms, page;
  final double? minPrice, maxPrice, minRating, lat, lng, maxDistanceKm;
  final Set<int> stars;
  final Set<String> amenities, types;
  final bool freeCancellation, breakfast, familyFriendly;

  bool get hasDates => checkIn != null && checkOut != null;

  StayQuery copyWith({
    Object? destination = _keep,
    Object? q = _keep,
    Object? checkIn = _keep,
    Object? checkOut = _keep,
    int? adults,
    int? children,
    int? rooms,
    Object? minPrice = _keep,
    Object? maxPrice = _keep,
    Set<int>? stars,
    Object? minRating = _keep,
    Set<String>? amenities,
    Set<String>? types,
    bool? freeCancellation,
    bool? breakfast,
    bool? familyFriendly,
    String? sort,
    int? page,
    Object? lat = _keep,
    Object? lng = _keep,
    Object? maxDistanceKm = _keep,
  }) {
    return StayQuery(
      destination: identical(destination, _keep) ? this.destination : destination as String?,
      q: identical(q, _keep) ? this.q : q as String?,
      checkIn: identical(checkIn, _keep) ? this.checkIn : checkIn as String?,
      checkOut: identical(checkOut, _keep) ? this.checkOut : checkOut as String?,
      adults: adults ?? this.adults,
      children: children ?? this.children,
      rooms: rooms ?? this.rooms,
      minPrice: identical(minPrice, _keep) ? this.minPrice : minPrice as double?,
      maxPrice: identical(maxPrice, _keep) ? this.maxPrice : maxPrice as double?,
      stars: stars ?? this.stars,
      minRating: identical(minRating, _keep) ? this.minRating : minRating as double?,
      amenities: amenities ?? this.amenities,
      types: types ?? this.types,
      freeCancellation: freeCancellation ?? this.freeCancellation,
      breakfast: breakfast ?? this.breakfast,
      familyFriendly: familyFriendly ?? this.familyFriendly,
      sort: sort ?? this.sort,
      page: page ?? this.page,
      lat: identical(lat, _keep) ? this.lat : lat as double?,
      lng: identical(lng, _keep) ? this.lng : lng as double?,
      maxDistanceKm: identical(maxDistanceKm, _keep) ? this.maxDistanceKm : maxDistanceKm as double?,
    );
  }

  Json toQuery() => {
        'destination': destination,
        'q': q,
        'checkIn': checkIn,
        'checkOut': checkOut,
        'adults': adults,
        'children': children,
        'rooms': rooms,
        'minPrice': minPrice,
        'maxPrice': maxPrice,
        'stars': (stars.toList()..sort()),
        'minRating': minRating,
        'amenities': amenities.toList()..sort(),
        'type': types.toList()..sort(),
        'freeCancellation': freeCancellation ? 'true' : null,
        'breakfast': breakfast ? 'true' : null,
        'familyFriendly': familyFriendly ? 'true' : null,
        'sort': sort,
        'page': page,
        'pageSize': 12,
        'lat': lat,
        'lng': lng,
        'maxDistanceKm': maxDistanceKm,
      };

  /// Query params for the URL (omits defaults and pagination).
  Map<String, String> toUrlParams() {
    final m = <String, String>{};
    if (destination != null) m['destination'] = destination!;
    if (q != null && q!.isNotEmpty) m['q'] = q!;
    if (checkIn != null) m['checkIn'] = checkIn!;
    if (checkOut != null) m['checkOut'] = checkOut!;
    m['adults'] = '$adults';
    if (children > 0) m['children'] = '$children';
    if (rooms > 1) m['rooms'] = '$rooms';
    return m;
  }

  static StayQuery fromUrl(Map<String, String> p) => StayQuery(
        destination: p['destination'],
        q: p['q'],
        checkIn: p['checkIn'],
        checkOut: p['checkOut'],
        adults: int.tryParse(p['adults'] ?? '') ?? 2,
        children: int.tryParse(p['children'] ?? '') ?? 0,
        rooms: int.tryParse(p['rooms'] ?? '') ?? 1,
        familyFriendly: p['familyFriendly'] == 'true',
        maxPrice: double.tryParse(p['maxPrice'] ?? ''),
      );

  @override
  bool operator ==(Object other) => other is StayQuery && other.toQuery().toString() == toQuery().toString();
  @override
  int get hashCode => toQuery().toString().hashCode;
}

const Object _keep = Object();

class DestQuery {
  const DestQuery({this.q, this.international, this.tag, this.sort = 'popularity', this.page = 1});
  final String? q, tag;
  final bool? international;
  final String sort;
  final int page;

  DestQuery copyWith({Object? q = _keep, Object? international = _keep, Object? tag = _keep, String? sort, int? page}) => DestQuery(
        q: identical(q, _keep) ? this.q : q as String?,
        international: identical(international, _keep) ? this.international : international as bool?,
        tag: identical(tag, _keep) ? this.tag : tag as String?,
        sort: sort ?? this.sort,
        page: page ?? this.page,
      );

  Json toQuery() => {
        'q': q,
        'tag': tag,
        'international': international?.toString(),
        'sort': sort,
        'page': page,
        'pageSize': 12,
      };
  @override
  bool operator ==(Object other) => other is DestQuery && other.toQuery().toString() == toQuery().toString();
  @override
  int get hashCode => toQuery().toString().hashCode;
}

/// Records are used as family keys so equal arguments hit the same cache entry.
typedef StayKey = ({String slug, String? checkIn, String? checkOut, int rooms});

final metaProvider = FutureProvider<Json>((ref) => ref.watch(apiProvider).getJson('/meta'));
final homeProvider = FutureProvider.autoDispose<Json>((ref) => ref.watch(apiProvider).getJson('/home'));

final destinationsProvider = FutureProvider.autoDispose.family<Json, DestQuery>(
    (ref, q) => ref.watch(apiProvider).getJson('/destinations', query: q.toQuery()));

final destinationProvider = FutureProvider.autoDispose.family<Json, String>(
    (ref, slug) => ref.watch(apiProvider).getJson('/destinations/$slug'));

final destinationPlacesProvider = FutureProvider.autoDispose.family<Json, ({String slug, String? kind})>(
    (ref, a) => ref.watch(apiProvider).getJson('/destinations/${a.slug}/attractions', query: {'kind': a.kind, 'pageSize': 50}));

final staySearchProvider = FutureProvider.autoDispose.family<Json, StayQuery>(
    (ref, q) => ref.watch(apiProvider).getJson('/accommodations', query: q.toQuery()));

final stayDetailProvider = FutureProvider.autoDispose.family<Json, StayKey>((ref, k) => ref
    .watch(apiProvider)
    .getJson('/accommodations/${k.slug}', query: {'checkIn': k.checkIn, 'checkOut': k.checkOut, 'rooms': k.rooms}));

final reviewsProvider = FutureProvider.autoDispose.family<Json, String>(
    (ref, slug) => ref.watch(apiProvider).getJson('/accommodations/$slug/reviews', query: {'pageSize': 20}));

final bookingsProvider = FutureProvider.autoDispose<Json>((ref) => ref.watch(apiProvider).getJson('/bookings'));
final bookingDetailProvider =
    FutureProvider.autoDispose.family<Json, String>((ref, id) => ref.watch(apiProvider).getJson('/bookings/$id'));

final itinerariesProvider = FutureProvider.autoDispose<Json>((ref) => ref.watch(apiProvider).getJson('/itineraries'));
final itineraryProvider =
    FutureProvider.autoDispose.family<Json, String>((ref, id) => ref.watch(apiProvider).getJson('/itineraries/$id'));

final notificationsProvider = FutureProvider.autoDispose<Json>((ref) => ref.watch(apiProvider).getJson('/notifications'));
final wishlistProvider = FutureProvider.autoDispose<Json>((ref) => ref.watch(apiProvider).getJson('/wishlist'));
final searchHistoryProvider = FutureProvider.autoDispose<Json>((ref) => ref.watch(apiProvider).getJson('/search-history'));
final aiStatusProvider = FutureProvider<Json>((ref) => ref.watch(apiProvider).getJson('/ai/status'));

/// Selected display currency (persisted). Amounts are stored in USD; conversion uses documented sample rates.
class CurrencyController extends StateNotifier<String> {
  CurrencyController() : super('USD') {
    _load();
  }
  Future<void> _load() async {
    try {
      final p = await SharedPreferences.getInstance();
      state = p.getString('currency') ?? 'USD';
    } catch (_) {}
  }

  Future<void> set(String code) async {
    state = code;
    try {
      final p = await SharedPreferences.getInstance();
      await p.setString('currency', code);
    } catch (_) {}
  }
}

final currencyProvider = StateNotifierProvider<CurrencyController, String>((ref) => CurrencyController());

/// Recently viewed destinations/stays (per device, local only).
class RecentController extends StateNotifier<List<Map<String, String>>> {
  RecentController() : super(const []) {
    _load();
  }
  Future<void> _load() async {
    try {
      final p = await SharedPreferences.getInstance();
      final raw = p.getStringList('recent') ?? [];
      state = raw.map((s) {
        final i = s.split('|');
        return {'kind': i[0], 'slug': i[1], 'name': i.length > 2 ? i[2] : i[1]};
      }).toList();
    } catch (_) {}
  }

  Future<void> add(String kind, String slug, String name) async {
    final next = [
      {'kind': kind, 'slug': slug, 'name': name},
      ...state.where((e) => !(e['kind'] == kind && e['slug'] == slug)),
    ].take(8).toList();
    state = next;
    try {
      final p = await SharedPreferences.getInstance();
      await p.setStringList('recent', next.map((e) => '${e['kind']}|${e['slug']}|${e['name']}').toList());
    } catch (_) {}
  }
}

final recentProvider = StateNotifierProvider<RecentController, List<Map<String, String>>>((ref) => RecentController());
