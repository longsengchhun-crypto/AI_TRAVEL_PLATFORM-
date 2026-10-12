import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/data/providers.dart';
import '../core/theme/theme.dart';
import '../core/widgets/widgets.dart';
import '../features/account/account_screens.dart';
import '../features/admin/admin_screens.dart';
import '../features/assistant/assistant_screen.dart';
import '../features/auth/auth_controller.dart';
import '../features/bookings/bookings_screen.dart';
import '../features/bookings/checkout_screen.dart';
import '../features/destinations/destinations_screen.dart';
import '../features/destinations/places_screen.dart';
import '../features/home/home_screen.dart';
import '../features/maps/map_screen.dart';
import '../features/stays/stay_detail_screen.dart';
import '../features/stays/stays_screen.dart';
import '../features/trips/trips_screen.dart';

const _protectedPrefixes = ['/bookings', '/book/', '/account', '/wishlist', '/notifications', '/admin', '/partner'];

class _AuthRefresh extends ChangeNotifier {
  _AuthRefresh(Ref ref) {
    ref.listen(authProvider, (_, _) => notifyListeners());
  }
}

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = _AuthRefresh(ref);
  final shellKey = GlobalKey<NavigatorState>();

  return GoRouter(
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authProvider);
      final path = state.uri.path;
      final needsAuth = path != '/account' ? _protectedPrefixes.any(path.startsWith) : false;
      if (auth.isLoading) return null;
      final tripsListNeedsAuth = path == '/trips';
      if ((needsAuth || tripsListNeedsAuth) && !auth.signedIn) {
        return '/login?next=${Uri.encodeComponent(state.uri.toString())}';
      }
      return null;
    },
    routes: [
      ShellRoute(
        navigatorKey: shellKey,
        builder: (context, state, child) => AppShell(location: state.uri.path, child: child),
        routes: [
          GoRoute(path: '/', pageBuilder: (_, s) => _fade(s, const HomeScreen())),
          GoRoute(path: '/destinations', pageBuilder: (_, s) => _fade(s, DestinationsScreen(key: ValueKey(s.uri.toString()), initialTag: s.uri.queryParameters['tag']))),
          GoRoute(path: '/destinations/:slug', pageBuilder: (_, s) => _fade(s, DestinationDetailScreen(key: ValueKey(s.pathParameters['slug']), slug: s.pathParameters['slug']!))),
          GoRoute(path: '/places', pageBuilder: (_, s) => _fade(s, PlacesScreen(key: ValueKey(s.uri.toString()), category: s.uri.queryParameters['category'], kind: s.uri.queryParameters['kind']))),
          GoRoute(path: '/stays', pageBuilder: (_, s) => _fade(s, StaysScreen(key: ValueKey(s.uri.toString()), initial: StayQuery.fromUrl(s.uri.queryParameters)))),
          GoRoute(path: '/stays/:slug', pageBuilder: (_, s) => _fade(s, StayDetailScreen(key: ValueKey(s.uri.toString()), slug: s.pathParameters['slug']!, params: s.uri.queryParameters))),
          GoRoute(path: '/book/:roomTypeId', pageBuilder: (_, s) => _fade(s, CheckoutScreen(key: ValueKey(s.uri.toString()), roomTypeId: s.pathParameters['roomTypeId']!, params: s.uri.queryParameters))),
          GoRoute(path: '/bookings', pageBuilder: (_, s) => _fade(s, const BookingsScreen())),
          GoRoute(path: '/bookings/:id', pageBuilder: (_, s) => _fade(s, BookingDetailScreen(key: ValueKey(s.pathParameters['id']), id: s.pathParameters['id']!, justPaid: s.uri.queryParameters['paid'] == '1'))),
          GoRoute(path: '/trips', pageBuilder: (_, s) => _fade(s, const TripsScreen())),
          GoRoute(path: '/trips/new', pageBuilder: (_, s) => _fade(s, PlannerScreen(key: ValueKey(s.uri.toString()), destination: s.uri.queryParameters['destination']))),
          GoRoute(path: '/trips/:id', pageBuilder: (_, s) => _fade(s, ItineraryScreen(key: ValueKey(s.pathParameters['id']), id: s.pathParameters['id']!))),
          GoRoute(path: '/assistant', pageBuilder: (_, s) => _fade(s, AssistantScreen(key: ValueKey(s.uri.toString()), initialQuestion: s.uri.queryParameters['q'], destination: s.uri.queryParameters['destination']))),
          GoRoute(path: '/map', pageBuilder: (_, s) => _fade(s, const MapScreen())),
          GoRoute(path: '/login', pageBuilder: (_, s) => _fade(s, AuthScreen(register: false, next: s.uri.queryParameters['next']))),
          GoRoute(path: '/register', pageBuilder: (_, s) => _fade(s, AuthScreen(register: true, next: s.uri.queryParameters['next']))),
          GoRoute(path: '/account', pageBuilder: (_, s) => _fade(s, const AccountScreen())),
          GoRoute(path: '/wishlist', pageBuilder: (_, s) => _fade(s, const WishlistScreen())),
          GoRoute(path: '/notifications', pageBuilder: (_, s) => _fade(s, const NotificationsScreen())),
          GoRoute(path: '/admin', pageBuilder: (_, s) => _fade(s, const AdminScreen())),
          GoRoute(path: '/partner', pageBuilder: (_, s) => _fade(s, const PartnerScreen())),
        ],
      ),
    ],
    errorBuilder: (context, state) => Scaffold(
      appBar: AppBar(title: const Text('WAYFARER')),
      body: EmptyState(
        icon: Icons.explore_off_outlined,
        title: 'We could not find that page',
        message: state.uri.toString(),
        action: FilledButton(onPressed: () => context.go('/'), child: const Text('Back to home')),
      ),
    ),
  );
});

Page<void> _fade(GoRouterState s, Widget child) => CustomTransitionPage<void>(
      key: ValueKey(s.uri.toString()),
      child: child,
      transitionDuration: const Duration(milliseconds: 180),
      transitionsBuilder: (context, animation, _, c) => FadeTransition(opacity: CurvedAnimation(parent: animation, curve: Curves.easeOut), child: c),
    );

class _Nav {
  const _Nav(this.label, this.icon, this.selectedIcon, this.path);
  final String label;
  final IconData icon, selectedIcon;
  final String path;
}

const _items = [
  _Nav('Discover', Icons.explore_outlined, Icons.explore, '/'),
  _Nav('Stays', Icons.hotel_outlined, Icons.hotel, '/stays'),
  _Nav('Trips', Icons.map_outlined, Icons.map, '/trips/new'),
  _Nav('Guide', Icons.chat_bubble_outline, Icons.chat_bubble, '/assistant'),
  _Nav('Account', Icons.person_outline, Icons.person, '/account'),
];

int _indexFor(String loc) {
  if (loc.startsWith('/stays') || loc.startsWith('/book')) return 1;
  if (loc.startsWith('/trips')) return 2;
  if (loc.startsWith('/assistant')) return 3;
  if (loc.startsWith('/account') || loc.startsWith('/login') || loc.startsWith('/register') || loc.startsWith('/bookings') ||
      loc.startsWith('/wishlist') || loc.startsWith('/notifications') || loc.startsWith('/admin') || loc.startsWith('/partner')) {
    return 4;
  }
  return 0;
}

class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.location, required this.child});
  final String location;
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wide = MediaQuery.sizeOf(context).width >= 1040;
    final idx = _indexFor(location);
    final auth = ref.watch(authProvider);
    final unread = auth.signedIn ? (ref.watch(notificationsProvider).value?['unread'] as int? ?? 0) : 0;

    final bell = auth.signedIn
        ? IconButton(
            tooltip: unread > 0 ? '$unread unread notifications' : 'Notifications',
            onPressed: () => context.go('/notifications'),
            icon: Badge(isLabelVisible: unread > 0, label: Text('$unread'), child: const Icon(Icons.notifications_none)),
          )
        : null;

    final wordmark = InkWell(
      onTap: () => context.go('/'),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.travel_explore_rounded, color: Tokens.forest),
          const SizedBox(width: 8),
          Text('WAYFARER', style: Theme.of(context).textTheme.titleMedium?.copyWith(letterSpacing: 2.2, fontWeight: FontWeight.w800)),
        ]),
      ),
    );

    if (wide) {
      return Scaffold(
        appBar: AppBar(
          toolbarHeight: 64,
          titleSpacing: 32,
          title: Row(children: [
            wordmark,
            const SizedBox(width: 40),
            for (final (i, n) in _items.indexed.where((e) => e.$2.label != 'Account'))
              Padding(
                padding: const EdgeInsets.only(right: 4),
                child: TextButton(
                  style: TextButton.styleFrom(foregroundColor: i == idx ? Tokens.forest : Tokens.ink, textStyle: TextStyle(fontWeight: i == idx ? FontWeight.w700 : FontWeight.w500)),
                  onPressed: () => context.go(n.path),
                  child: Text(n.label),
                ),
              ),
            TextButton(onPressed: () => context.go('/destinations'), child: Text('Destinations', style: TextStyle(color: location.startsWith('/destinations') ? Tokens.forest : Tokens.ink))),
            TextButton(onPressed: () => context.go('/places'), child: Text('Places', style: TextStyle(color: location.startsWith('/places') ? Tokens.forest : Tokens.ink))),
            TextButton(onPressed: () => context.go('/map'), child: Text('Map', style: TextStyle(color: location.startsWith('/map') ? Tokens.forest : Tokens.ink))),
          ]),
          actions: [
            ?bell,
            if (auth.signedIn)
              Padding(
                padding: const EdgeInsets.only(right: 24),
                child: TextButton.icon(onPressed: () => context.go('/account'), icon: const Icon(Icons.person_outline), label: Text((auth.user!['name'] as String).split(' ').first)),
              )
            else ...[
              TextButton(onPressed: () => context.go('/login'), child: const Text('Sign in')),
              Padding(padding: const EdgeInsets.only(right: 24, left: 8), child: FilledButton(onPressed: () => context.go('/register'), style: FilledButton.styleFrom(minimumSize: const Size(0, 40)), child: const Text('Join'))),
            ],
          ],
          bottom: const PreferredSize(preferredSize: Size.fromHeight(1), child: Divider(height: 1)),
        ),
        body: child,
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: wordmark,
        actions: [
          IconButton(tooltip: 'Destinations', onPressed: () => context.go('/destinations'), icon: const Icon(Icons.public)),
          IconButton(tooltip: 'Places', onPressed: () => context.go('/places'), icon: const Icon(Icons.attractions_outlined)),
          IconButton(tooltip: 'Map', onPressed: () => context.go('/map'), icon: const Icon(Icons.map_outlined)),
          ?bell,
        ],
        bottom: const PreferredSize(preferredSize: Size.fromHeight(1), child: Divider(height: 1)),
      ),
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: idx,
        onDestinationSelected: (i) => context.go(_items[i].path),
        destinations: [for (final n in _items) NavigationDestination(icon: Icon(n.icon), selectedIcon: Icon(n.selectedIcon), label: n.label)],
      ),
    );
  }
}
