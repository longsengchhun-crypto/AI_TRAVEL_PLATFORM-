import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/providers.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/theme.dart';
import '../../core/widgets/widgets.dart';

class BookingsScreen extends ConsumerWidget {
  const BookingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final res = ref.watch(bookingsProvider);
    final money = ref.watch(moneyProvider);
    return RefreshIndicator(
      onRefresh: () async => ref.refresh(bookingsProvider.future),
      child: ListView(children: [
        Constrained(
          maxWidth: 900,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const SizedBox(height: 24),
            Text('My bookings', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 16),
            AsyncView<Json>(
              value: res,
              onRetry: () => ref.invalidate(bookingsProvider),
              data: (r) {
                final items = (r['items'] as List).cast<Json>();
                if (items.isEmpty) {
                  return EmptyState(
                    icon: Icons.luggage_outlined,
                    title: 'No bookings yet',
                    message: 'When you book a stay it will appear here with its status and receipt.',
                    action: FilledButton(onPressed: () => context.go('/stays'), child: const Text('Find a stay')),
                  );
                }
                return Column(children: [
                  for (final b in items)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Card(
                        child: InkWell(
                          borderRadius: BorderRadius.circular(Tokens.radius),
                          onTap: () => context.push('/bookings/${b['id']}'),
                          child: Padding(
                            padding: const EdgeInsets.all(14),
                            child: Row(children: [
                              ClipRRect(borderRadius: BorderRadius.circular(8), child: WImage(b['cover_image'] as String?, width: 72, height: 72, fallbackIcon: Icons.hotel_outlined)),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Text(b['accommodation_name'] as String, style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                                  Text('${fmtDate(b['check_in'] as String)} → ${fmtDate(b['check_out'] as String)} · ${b['nights']} night${b['nights'] == 1 ? '' : 's'}', style: const TextStyle(color: Tokens.inkMuted, fontSize: 13)),
                                  const SizedBox(height: 6),
                                  Wrap(spacing: 8, children: [StatusPill(b['status'] as String), Text(b['reference'] as String, style: const TextStyle(fontSize: 12, color: Tokens.inkMuted))]),
                                ]),
                              ),
                              Text(money(b['total_usd'] as num), style: Theme.of(context).textTheme.titleMedium),
                            ]),
                          ),
                        ),
                      ),
                    ),
                ]);
              },
            ),
            const SizedBox(height: 48),
          ]),
        ),
      ]),
    );
  }
}

class BookingDetailScreen extends ConsumerStatefulWidget {
  const BookingDetailScreen({super.key, required this.id, this.justPaid = false});
  final String id;
  final bool justPaid;
  @override
  ConsumerState<BookingDetailScreen> createState() => _BookingDetailScreenState();
}

class _BookingDetailScreenState extends ConsumerState<BookingDetailScreen> {
  bool busy = false;

  Future<void> _cancel(Json b) async {
    final free = b['freeCancellation'] == true;
    final paid = (b['payments'] as List).any((p) => p['status'] == 'SUCCESS');
    final ok = await confirm(
      context,
      title: 'Cancel this booking?',
      message: free
          ? 'You are within the free-cancellation window. ${paid ? 'A simulated refund will be recorded.' : ''} The room will be released.'
          : 'The free-cancellation window has passed, so this booking is non-refundable. The room will be released.',
      confirmLabel: 'Cancel booking',
      destructive: true,
    );
    if (!ok) return;
    setState(() => busy = true);
    try {
      await ref.read(apiProvider).postJson('/bookings/${widget.id}/cancel');
      ref.invalidate(bookingDetailProvider(widget.id));
      ref.invalidate(bookingsProvider);
      if (mounted) showInfo(context, 'Booking cancelled.');
    } catch (e) {
      if (mounted) showError(context, e);
    }
    if (mounted) setState(() => busy = false);
  }

  Future<void> _receipt() async {
    try {
      final r = await ref.read(apiProvider).getJson('/bookings/${widget.id}/receipt');
      if (!mounted) return;
      final money = ref.read(moneyProvider);
      await showDialog<void>(
        context: context,
        builder: (c) => AlertDialog(
          title: Text('Receipt ${r['receiptNumber']}'),
          content: SizedBox(
            width: 420,
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (r['notice'] != null)
                  Container(
                    padding: const EdgeInsets.all(10),
                    margin: const EdgeInsets.only(bottom: 12),
                    decoration: BoxDecoration(color: Tokens.amber.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
                    child: Text(r['notice'] as String, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                  ),
                Text('${r['property']} · ${r['room']}'),
                Text('${fmtDate(r['checkIn'] as String)} → ${fmtDate(r['checkOut'] as String)}', style: const TextStyle(color: Tokens.inkMuted)),
                const Divider(height: 24),
                for (final l in (r['lineItems'] as List).cast<Json>()) PriceRow(l['label'] as String, money(l['amountUsd'] as num), muted: true),
                const Divider(height: 24),
                PriceRow('Total', money(r['totalUsd'] as num), bold: true),
                const SizedBox(height: 8),
                Text('Payment ref ${r['paymentReference']} · ${r['paymentStatus']}', style: const TextStyle(fontSize: 12, color: Tokens.inkMuted)),
              ]),
            ),
          ),
          actions: [TextButton(onPressed: () => Navigator.pop(c), child: const Text('Close'))],
        ),
      );
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final res = ref.watch(bookingDetailProvider(widget.id));
    final money = ref.watch(moneyProvider);
    return AsyncView<Json>(
      value: res,
      onRetry: () => ref.invalidate(bookingDetailProvider(widget.id)),
      data: (b) {
        final status = b['status'] as String;
        final events = (b['events'] as List).cast<Json>();
        final payments = (b['payments'] as List).cast<Json>();
        final hasPaid = payments.any((p) => ['SUCCESS', 'REFUNDED'].contains(p['status']));
        return ListView(children: [
          Constrained(
            maxWidth: 900,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  IconButton(tooltip: 'Back to bookings', onPressed: () => context.go('/bookings'), icon: const Icon(Icons.arrow_back)),
                  Expanded(child: Text('Booking ${b['reference']}', style: Theme.of(context).textTheme.headlineSmall)),
                  StatusPill(status),
                ]),
                if (widget.justPaid && status == 'CONFIRMED')
                  Container(
                    margin: const EdgeInsets.only(top: 16),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(color: Tokens.success.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(8)),
                    child: const Row(children: [Icon(Icons.check_circle, color: Tokens.success), SizedBox(width: 10), Expanded(child: Text('Payment verified by the server and your booking is confirmed. (Simulated payment: no real money moved.)'))]),
                  ),
                const SizedBox(height: 16),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      InkWell(onTap: () => context.push('/stays/${b['accommodation_slug']}'), child: Text(b['accommodation_name'] as String, style: Theme.of(context).textTheme.titleLarge)),
                      Text('${b['room_name']} · ${b['destination_name']}', style: const TextStyle(color: Tokens.inkMuted)),
                      const SizedBox(height: 12),
                      Text('${fmtDate(b['check_in'] as String, pattern: 'EEE d MMM y')} → ${fmtDate(b['check_out'] as String, pattern: 'EEE d MMM y')}  ·  ${b['nights']} night${b['nights'] == 1 ? '' : 's'}'),
                      Text('${b['adults']} adult${b['adults'] == 1 ? '' : 's'}${(b['children'] as int) > 0 ? ', ${b['children']} children' : ''} · ${b['rooms']} room${b['rooms'] == 1 ? '' : 's'}'),
                      Text('Guest: ${b['guest_name']} · ${b['guest_email']}', style: const TextStyle(color: Tokens.inkMuted)),
                      const Divider(height: 28),
                      PriceRow('Room subtotal', money(b['subtotal_usd'] as num)),
                      PriceRow('Taxes', money(b['taxes_usd'] as num), muted: true),
                      PriceRow('Service fee', money(b['fees_usd'] as num), muted: true),
                      PriceRow('Total', money(b['total_usd'] as num), bold: true),
                    ]),
                  ),
                ),
                const SizedBox(height: 16),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('Cancellation policy', style: Theme.of(context).textTheme.titleSmall),
                      const SizedBox(height: 4),
                      Text(b['cancellation_policy'] as String, style: const TextStyle(color: Tokens.inkMuted)),
                      if (b['free_cancel_until'] != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text('Free cancellation until ${fmtDate(b['free_cancel_until'] as String, pattern: 'EEE d MMM, HH:mm')}', style: const TextStyle(fontWeight: FontWeight.w600))),
                    ]),
                  ),
                ),
                const SizedBox(height: 16),
                Wrap(spacing: 12, runSpacing: 8, children: [
                  if (status == 'PENDING_CONFIRMATION')
                    FilledButton.icon(
                      onPressed: busy ? null : () => context.push('/book/${b['room_type_id']}?checkIn=${b['check_in']}&checkOut=${b['check_out']}&rooms=${b['rooms']}&adults=${b['adults']}&children=${b['children']}'),
                      icon: const Icon(Icons.payment),
                      label: const Text('Pay for this booking'),
                    ),
                  if (hasPaid) OutlinedButton.icon(onPressed: _receipt, icon: const Icon(Icons.receipt_long_outlined), label: const Text('View receipt')),
                  if (b['cancellable'] == true)
                    OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(foregroundColor: Tokens.danger),
                      onPressed: busy ? null : () => _cancel(b),
                      icon: const Icon(Icons.cancel_outlined),
                      label: const Text('Cancel booking'),
                    ),
                ]),
                const SectionHeader('Status history'),
                for (final e in events)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    leading: const Icon(Icons.circle, size: 10, color: Tokens.forest),
                    title: Text((e['to_status'] as String).replaceAll('_', ' ').toLowerCase()),
                    subtitle: Text('${fmtDate(e['created_at'] as String, pattern: 'd MMM y, HH:mm')}${e['note'] != null ? ' · ${e['note']}' : ''}'),
                  ),
                if (payments.isNotEmpty) ...[
                  const SectionHeader('Payments'),
                  for (final p in payments)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text('${money(p['amount_usd'] as num)} · ${p['provider']}${p['simulated'] == true ? ' (simulated)' : ''}'),
                      subtitle: Text('${p['provider_ref']}${p['failure_reason'] != null ? ' · ${p['failure_reason']}' : ''}'),
                      trailing: StatusPill(p['status'] as String),
                    ),
                ],
                const SizedBox(height: 48),
              ]),
            ),
          ),
        ]);
      },
    );
  }
}
