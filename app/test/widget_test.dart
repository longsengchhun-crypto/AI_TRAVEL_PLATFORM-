import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wayfarer/core/data/providers.dart';
import 'package:wayfarer/core/network/api_client.dart';
import 'package:wayfarer/core/widgets/widgets.dart';
import 'package:wayfarer/features/bookings/bookings_screen.dart';

Widget host(Widget child) => ProviderScope(child: MaterialApp(home: Scaffold(body: SingleChildScrollView(child: child))));

void main() {
  group('StayQuery', () {
    test('serialises only meaningful filters and sorts list params', () {
      const q = StayQuery(destination: 'phnom-penh', stars: {5, 4}, amenities: {'pool', 'gym'}, freeCancellation: true);
      final m = q.toQuery();
      expect(m['destination'], 'phnom-penh');
      expect(m['stars'], [4, 5]);
      expect(m['amenities'], ['gym', 'pool']);
      expect(m['freeCancellation'], 'true');
      expect(m['breakfast'], isNull);
    });

    test('equal queries are equal (cache key) and copyWith can clear values', () {
      const a = StayQuery(destination: 'kampot', maxPrice: 80);
      expect(a, equals(const StayQuery(destination: 'kampot', maxPrice: 80)));
      expect(a.copyWith(maxPrice: null).maxPrice, isNull);
      expect(a.copyWith(adults: 3).adults, 3);
    });

    test('round-trips through URL params', () {
      const q = StayQuery(destination: 'siem-reap', checkIn: '2026-11-01', checkOut: '2026-11-04', adults: 2, children: 2, rooms: 2);
      final back = StayQuery.fromUrl(q.toUrlParams());
      expect(back.destination, 'siem-reap');
      expect(back.hasDates, isTrue);
      expect(back.children, 2);
      expect(back.rooms, 2);
    });
  });

  group('formatting helpers', () {
    test('nights between dates', () {
      expect(nightsBetween('2026-11-01', '2026-11-04'), 3);
      expect(nightsBetween(null, '2026-11-04'), 0);
      expect(nightsBetween('bad', 'dates'), 0);
    });
    test('minutes to clock time', () {
      expect(fmtMinutes(9 * 60), '9:00 am');
      expect(fmtMinutes(13 * 60 + 5), '1:05 pm');
      expect(fmtMinutes(0), '12:00 am');
    });
  });

  group('API errors', () {
    test('ApiException exposes network flag', () {
      final e = ApiException('offline', code: 'NETWORK');
      expect(e.isNetwork, isTrue);
      expect(ApiException('x', status: 401).isUnauthorized, isTrue);
    });
  });

  group('state widgets', () {
    testWidgets('ErrorState shows a retry action and calls it', (tester) async {
      var retried = 0;
      await tester.pumpWidget(host(ErrorState(error: ApiException('Server unreachable', code: 'NETWORK'), onRetry: () => retried++)));
      expect(find.text('Connection problem'), findsOneWidget);
      expect(find.text('Server unreachable'), findsOneWidget);
      await tester.tap(find.text('Try again'));
      expect(retried, 1);
    });

    testWidgets('EmptyState renders title, message and action', (tester) async {
      await tester.pumpWidget(host(const EmptyState(title: 'No stays match', message: 'Try fewer filters', action: Text('Clear'))));
      expect(find.text('No stays match'), findsOneWidget);
      expect(find.text('Try fewer filters'), findsOneWidget);
      expect(find.text('Clear'), findsOneWidget);
    });

    testWidgets('AsyncView shows skeleton, then data, then error with retry', (tester) async {
      var retry = 0;
      Widget build(AsyncValue<String> v) => host(AsyncView<String>(value: v, data: (d) => Text('data:$d'), onRetry: () => retry++));
      await tester.pumpWidget(build(const AsyncLoading()));
      expect(find.byType(SkeletonList), findsOneWidget);
      await tester.pumpWidget(build(const AsyncData('hello')));
      expect(find.text('data:hello'), findsOneWidget);
      await tester.pumpWidget(build(AsyncError(ApiException('boom'), StackTrace.empty)));
      expect(find.text('boom'), findsOneWidget);
      await tester.tap(find.text('Try again'));
      expect(retry, 1);
    });

    testWidgets('StatusPill maps booking states to human labels', (tester) async {
      await tester.pumpWidget(host(const Column(children: [StatusPill('PENDING_CONFIRMATION'), StatusPill('CONFIRMED'), StatusPill('REFUNDED')])));
      expect(find.text('Awaiting payment'), findsOneWidget);
      expect(find.text('Confirmed'), findsOneWidget);
      expect(find.text('Refunded'), findsOneWidget);
    });

    testWidgets('DemoBadge is visible for sample data', (tester) async {
      await tester.pumpWidget(host(const DemoBadge()));
      expect(find.text('Demo listing'), findsOneWidget);
    });
  });

  group('money formatting', () {
    testWidgets('formats whole USD without decimals and others with two', (tester) async {
      late String Function(num) money;
      await tester.pumpWidget(ProviderScope(
        overrides: [metaProvider.overrideWith((ref) async => <String, dynamic>{'currencies': []})],
        child: MaterialApp(home: Consumer(builder: (c, ref, _) {
          money = ref.watch(moneyProvider);
          return const SizedBox();
        })),
      ));
      expect(money(45), r'$45');
      expect(money(45.5), r'$45.50');
    });
  });

  testWidgets('BookingsScreen shows sign-in-free empty state when there are no bookings', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        bookingsProvider.overrideWith((ref) async => <String, dynamic>{'items': []}),
        metaProvider.overrideWith((ref) async => <String, dynamic>{'currencies': []}),
      ],
      child: const MaterialApp(home: Scaffold(body: BookingsScreen())),
    ));
    await tester.pump();
    await tester.pump();
    expect(find.text('No bookings yet'), findsOneWidget);
    expect(find.text('Find a stay'), findsOneWidget);
  });
}
