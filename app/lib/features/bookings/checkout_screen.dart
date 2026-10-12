import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/providers.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/theme.dart';
import '../../core/widgets/widgets.dart';
import '../auth/auth_controller.dart';

/// Two-step checkout: (1) guest details + price review creates a held booking, (2) simulated payment.
class CheckoutScreen extends ConsumerStatefulWidget {
  const CheckoutScreen({super.key, required this.roomTypeId, required this.params});
  final String roomTypeId;
  final Map<String, String> params;
  @override
  ConsumerState<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends ConsumerState<CheckoutScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _notes = TextEditingController();
  Json? quote;
  Json? booking;
  Json? payment;
  Object? error;
  bool busy = false, loading = true, prefilled = false;
  Timer? _tick;
  Duration? _left;
  late final String _idem = 'wf-${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(1 << 32)}';

  String get ci => widget.params['checkIn']!;
  String get co => widget.params['checkOut']!;
  int get rooms => int.tryParse(widget.params['rooms'] ?? '') ?? 1;
  int get adults => int.tryParse(widget.params['adults'] ?? '') ?? 2;
  int get children => int.tryParse(widget.params['children'] ?? '') ?? 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _tick?.cancel();
    for (final c in [_name, _email, _phone, _notes]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      quote = await ref.read(apiProvider).postJson('/bookings/quote', body: {'roomTypeId': widget.roomTypeId, 'checkIn': ci, 'checkOut': co, 'rooms': rooms});
    } catch (e) {
      error = e;
    }
    if (mounted) setState(() => loading = false);
  }

  void _startCountdown(String? holdIso) {
    _tick?.cancel();
    if (holdIso == null) return;
    final end = DateTime.tryParse(holdIso)?.toLocal();
    if (end == null) return;
    void update() => setState(() => _left = end.difference(DateTime.now()));
    update();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) => update());
  }

  Future<void> _createBooking() async {
    if (!_form.currentState!.validate()) return;
    setState(() { busy = true; error = null; });
    try {
      booking = await ref.read(apiProvider).postJson('/bookings', body: {
        'roomTypeId': widget.roomTypeId, 'checkIn': ci, 'checkOut': co, 'rooms': rooms, 'adults': adults, 'children': children,
        'guestName': _name.text.trim(), 'guestEmail': _email.text.trim(),
        if (_phone.text.trim().isNotEmpty) 'guestPhone': _phone.text.trim(),
        if (_notes.text.trim().isNotEmpty) 'specialRequests': _notes.text.trim(),
      });
      _startCountdown(booking!['hold_expires_at'] as String?);
    } catch (e) {
      if (mounted) showError(context, e);
      if (e is ApiException && e.code == 'NO_AVAILABILITY') setState(() => error = e);
    }
    if (mounted) setState(() => busy = false);
  }

  Future<void> _pay(String outcome) async {
    setState(() { busy = true; });
    try {
      final api = ref.read(apiProvider);
      payment ??= await api.postJson('/payments/intent', body: {'bookingId': booking!['id'], 'idempotencyKey': _idem});
      final r = await api.postJson('/payments/${payment!['id']}/simulate', body: {'outcome': outcome});
      final status = (r['payment'] as Json)['status'];
      if (status == 'SUCCESS') {
        ref.invalidate(bookingsProvider);
        ref.invalidate(notificationsProvider);
        if (mounted) context.go('/bookings/${booking!['id']}?paid=1');
        return;
      }
      payment = null; // failed/cancelled: allow a retry with a fresh intent
      if (mounted) showError(context, ApiException('Payment ${status.toString().toLowerCase()} (simulated). Your booking is not confirmed — you can try again before the hold expires.'));
    } catch (e) {
      if (mounted) showError(context, e);
    }
    if (mounted) setState(() => busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final money = ref.watch(moneyProvider);
    final user = ref.watch(authProvider).user;
    if (user != null && !prefilled) {
      prefilled = true;
      _name.text = (user['name'] ?? '') as String;
      _email.text = (user['email'] ?? '') as String;
      _phone.text = (user['phone'] ?? '') as String;
    }
    final nights = nightsBetween(ci, co);

    Widget summary() {
      if (loading) return const SkeletonList(count: 1, itemHeight: 260);
      if (quote == null) return ErrorState(error: error ?? 'Unknown error', onRetry: _load);
      final q = quote!;
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(q['accommodationName'] as String, style: Theme.of(context).textTheme.titleMedium),
            Text(q['roomName'] as String, style: const TextStyle(color: Tokens.inkMuted)),
            const SizedBox(height: 12),
            Row(children: [const Icon(Icons.calendar_month_outlined, size: 18), const SizedBox(width: 8), Text('${fmtDate(ci)} → ${fmtDate(co)} · $nights night${nights == 1 ? '' : 's'}')]),
            const SizedBox(height: 6),
            Row(children: [const Icon(Icons.people_outline, size: 18), const SizedBox(width: 8), Text('$adults adult${adults > 1 ? 's' : ''}${children > 0 ? ', $children child${children > 1 ? 'ren' : ''}' : ''} · $rooms room${rooms > 1 ? 's' : ''}')]),
            const Divider(height: 28),
            for (final n in (q['nightly'] as List).cast<Json>()) PriceRow(fmtDate(n['night'] as String, pattern: 'EEE d MMM'), money((n['rate_usd'] as num) * rooms), muted: true),
            const Divider(height: 20),
            PriceRow('Room subtotal', money(q['subtotal_usd'] as num)),
            PriceRow('Taxes', money(q['taxes_usd'] as num), muted: true),
            PriceRow('Service fee', money(q['fees_usd'] as num), muted: true),
            const Divider(height: 20),
            PriceRow('Total', money(q['total_usd'] as num), bold: true),
            if (q['available'] != true)
              Padding(padding: const EdgeInsets.only(top: 12), child: Text(q['reason'] as String? ?? 'No longer available', style: const TextStyle(color: Tokens.danger))),
            const SizedBox(height: 12),
            Text(q['cancellationPolicy'] as String, style: const TextStyle(fontSize: 13, color: Tokens.inkMuted)),
          ]),
        ),
      );
    }

    Widget details() => Form(
          key: _form,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Guest details', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            TextFormField(controller: _name, textInputAction: TextInputAction.next, autofillHints: const [AutofillHints.name], decoration: const InputDecoration(labelText: 'Full name (as on ID)'), validator: (v) => (v ?? '').trim().length < 2 ? 'Enter the guest name' : null),
            const SizedBox(height: 12),
            TextFormField(controller: _email, keyboardType: TextInputType.emailAddress, autofillHints: const [AutofillHints.email], decoration: const InputDecoration(labelText: 'Email'), validator: (v) => RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch((v ?? '').trim()) ? null : 'Enter a valid email'),
            const SizedBox(height: 12),
            TextFormField(controller: _phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone (optional)')),
            const SizedBox(height: 12),
            TextFormField(controller: _notes, maxLines: 3, maxLength: 500, decoration: const InputDecoration(labelText: 'Special requests (optional)')),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: busy || quote == null || quote!['available'] != true ? null : _createBooking,
              child: busy ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Continue to payment'),
            ),
            const SizedBox(height: 8),
            const Text('Your room is held for a short time while you pay. A booking is only confirmed after payment is verified by the server.', style: TextStyle(fontSize: 12, color: Tokens.inkMuted)),
          ]),
        );

    Widget payStep() {
      final left = _left;
      final expired = left != null && left.isNegative;
      final mm = left == null ? '--' : left.inMinutes.remainder(60).toString().padLeft(2, '0');
      final ss = left == null ? '--' : left.inSeconds.remainder(60).toString().padLeft(2, '0');
      return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Payment', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        Pill(expired ? 'Hold expired' : 'Room held for $mm:$ss', color: expired ? Tokens.danger : Tokens.amber, icon: Icons.timer_outlined),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: Tokens.amber.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(8)),
          child: const Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(Icons.science_outlined, size: 20),
            SizedBox(width: 10),
            Expanded(child: Text('Simulated payment. This demo uses a mock payment provider: no card is charged and no real money moves. Choose an outcome to test how the booking reacts.')),
          ]),
        ),
        const SizedBox(height: 16),
        Text('Reference ${booking!['reference']}', style: const TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 4),
        Text('Amount due ${money(booking!['total_usd'] as num)}', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 16),
        FilledButton.icon(onPressed: busy || expired ? null : () => _pay('success'), icon: const Icon(Icons.lock_outline), label: const Text('Pay now (simulate success)')),
        const SizedBox(height: 8),
        OutlinedButton(onPressed: busy || expired ? null : () => _pay('fail'), child: const Text('Simulate a declined card')),
        const SizedBox(height: 8),
        TextButton(onPressed: busy ? null : () => context.go('/bookings/${booking!['id']}'), child: const Text('Pay later from My bookings')),
      ]);
    }

    final left = booking == null ? details() : payStep();
    final wide = isWide(context);
    return ListView(children: [
      Constrained(
        maxWidth: 1000,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              IconButton(tooltip: 'Back', onPressed: () => context.canPop() ? context.pop() : context.go('/stays'), icon: const Icon(Icons.arrow_back)),
              Text('Complete your booking', style: Theme.of(context).textTheme.headlineSmall),
            ]),
            const SizedBox(height: 16),
            if (wide)
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(flex: 3, child: left), const SizedBox(width: 32), Expanded(flex: 2, child: summary())])
            else ...[summary(), const SizedBox(height: 24), left],
          ]),
        ),
      ),
    ]);
  }
}
