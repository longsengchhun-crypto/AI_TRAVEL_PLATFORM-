import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/providers.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/theme.dart';
import '../../core/widgets/widgets.dart';
import '../auth/auth_controller.dart';

/// Server-authorised admin console. The API enforces roles; this UI merely reflects 401/403 responses.
class AdminScreen extends ConsumerStatefulWidget {
  const AdminScreen({super.key});
  @override
  ConsumerState<AdminScreen> createState() => _AdminScreenState();
}

class _AdminScreenState extends ConsumerState<AdminScreen> {
  int tab = 0;
  static const tabs = [
    ('Overview', Icons.dashboard_outlined),
    ('Bookings', Icons.luggage_outlined),
    ('Payments', Icons.payments_outlined),
    ('Users', Icons.people_outline),
    ('Reviews', Icons.rate_review_outlined),
    ('Audit log', Icons.fact_check_outlined),
    ('Content', Icons.edit_location_alt_outlined),
  ];

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    if (!auth.isStaff) {
      return const EmptyState(icon: Icons.lock_outline, title: 'Admin access required', message: 'This area is only available to staff and administrators. Access is enforced by the server.');
    }
    final isAdmin = auth.role == 'admin';
    final body = switch (tab) {
      0 => const _Overview(),
      1 => const _Bookings(),
      2 => const _Payments(),
      3 => _Users(canChangeRole: isAdmin),
      4 => const _Reviews(),
      5 => const _Audit(),
      _ => const _Content(),
    };
    final wide = isWide(context);
    return Column(children: [
      if (!wide)
        SizedBox(
          height: 52,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.all(8),
            itemCount: tabs.length,
            separatorBuilder: (_, _) => const SizedBox(width: 8),
            itemBuilder: (_, i) => ChoiceChip(avatar: Icon(tabs[i].$2, size: 18), label: Text(tabs[i].$1), selected: tab == i, onSelected: (_) => setState(() => tab = i)),
          ),
        ),
      Expanded(
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (wide)
            NavigationRail(
              selectedIndex: tab,
              onDestinationSelected: (i) => setState(() => tab = i),
              labelType: NavigationRailLabelType.all,
              destinations: [for (final t in tabs) NavigationRailDestination(icon: Icon(t.$2), label: Text(t.$1))],
            ),
          Expanded(child: Padding(padding: const EdgeInsets.all(16), child: body)),
        ]),
      ),
    ]);
  }
}

class _Page<T> extends StatelessWidget {
  const _Page({required this.title, required this.child, this.actions = const []});
  final String title;
  final Widget child;
  final List<Widget> actions;
  @override
  Widget build(BuildContext context) => ListView(children: [
        Row(children: [Expanded(child: Text(title, style: Theme.of(context).textTheme.headlineSmall)), ...actions]),
        const SizedBox(height: 16),
        child,
      ]);
}

class _Pager extends StatelessWidget {
  const _Pager({required this.page, required this.total, required this.size, required this.onPage});
  final int page, total, size;
  final ValueChanged<int> onPage;
  @override
  Widget build(BuildContext context) {
    final pages = (total / size).ceil().clamp(1, 9999);
    return Row(mainAxisAlignment: MainAxisAlignment.end, children: [
      Text('$total total', style: const TextStyle(color: Tokens.inkMuted)),
      const SizedBox(width: 12),
      IconButton(tooltip: 'Previous page', onPressed: page > 1 ? () => onPage(page - 1) : null, icon: const Icon(Icons.chevron_left)),
      Text('$page / $pages'),
      IconButton(tooltip: 'Next page', onPressed: page < pages ? () => onPage(page + 1) : null, icon: const Icon(Icons.chevron_right)),
    ]);
  }
}

typedef _Loader = Future<Json> Function(int page);

/// Generic paginated list backed by an admin endpoint.
class _PagedList extends ConsumerStatefulWidget {
  const _PagedList({required this.load, required this.row, this.reloadKey});
  final _Loader load;
  final Widget Function(BuildContext, Json, VoidCallback reload) row;
  final Object? reloadKey;
  @override
  ConsumerState<_PagedList> createState() => _PagedListState();
}

class _PagedListState extends ConsumerState<_PagedList> {
  int page = 1;
  Future<Json>? _f;

  @override
  void initState() {
    super.initState();
    _f = widget.load(page);
  }

  @override
  void didUpdateWidget(covariant _PagedList old) {
    super.didUpdateWidget(old);
    if (old.reloadKey != widget.reloadKey) {
      page = 1;
      _reload();
    }
  }

  void _reload() => setState(() => _f = widget.load(page));

  @override
  Widget build(BuildContext context) => FutureBuilder<Json>(
        future: _f,
        builder: (c, s) {
          if (s.connectionState != ConnectionState.done) return const SkeletonList(count: 4, itemHeight: 64);
          if (s.hasError) return ErrorState(error: s.error!, onRetry: _reload);
          final r = s.data!;
          final items = (r['items'] as List).cast<Json>();
          return Column(children: [
            if (items.isEmpty) const EmptyState(title: 'Nothing here yet') else for (final it in items) widget.row(c, it, _reload),
            const SizedBox(height: 8),
            _Pager(page: page, total: (r['total'] ?? items.length) as int, size: (r['pageSize'] ?? 20) as int, onPage: (p) => setState(() { page = p; _f = widget.load(p); })),
          ]);
        },
      );
}

class _Overview extends ConsumerWidget {
  const _Overview();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final api = ref.watch(apiProvider);
    return _Page<void>(
      title: 'Overview',
      child: FutureBuilder<Json>(
        future: api.getJson('/admin/overview'),
        builder: (c, s) {
          if (s.connectionState != ConnectionState.done) return const SkeletonList(count: 2);
          if (s.hasError) return ErrorState(error: s.error!);
          final o = s.data!;
          final counts = (o['counts'] as Map).cast<String, dynamic>();
          final by = (o['bookingsByStatus'] as List).cast<Json>();
          final ai = (o['aiUsage'] as List).cast<Json>();
          final rev = (o['revenueSimulatedUsd'] as Map);
          return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Wrap(spacing: 12, runSpacing: 12, children: [
              for (final e in counts.entries) _Stat(e.key.replaceAll('_', ' '), '${e.value}'),
              _Stat('simulated net revenue', '\$${(rev['usd'] as num).toStringAsFixed(2)}'),
            ]),
            const SizedBox(height: 8),
            Text(o['note'] as String, style: const TextStyle(fontSize: 12, color: Tokens.inkMuted)),
            const SectionHeader('Bookings by status'),
            Wrap(spacing: 8, runSpacing: 8, children: [for (final b in by) Row(mainAxisSize: MainAxisSize.min, children: [StatusPill(b['status'] as String), Text('  ${b['count']}')])]),
            const SectionHeader('AI usage'),
            if (ai.isEmpty) const Text('No AI calls recorded yet.', style: TextStyle(color: Tokens.inkMuted)) else
              for (final a in ai) ListTile(dense: true, contentPadding: EdgeInsets.zero, title: Text('${a['kind']} · ${a['mode']}'), trailing: Text('${a['calls']} calls · avg ${a['avg_ms']} ms')),
          ]);
        },
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat(this.label, this.value);
  final String label, value;
  @override
  Widget build(BuildContext context) => SizedBox(
        width: 168,
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(value, style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 4),
              Text(label, style: const TextStyle(fontSize: 12, color: Tokens.inkMuted)),
            ]),
          ),
        ),
      );
}

class _Bookings extends ConsumerStatefulWidget {
  const _Bookings();
  @override
  ConsumerState<_Bookings> createState() => _BookingsState();
}

class _BookingsState extends ConsumerState<_Bookings> {
  String? status;
  String q = '';
  final _c = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final api = ref.watch(apiProvider);
    final money = ref.watch(moneyProvider);
    return _Page<void>(
      title: 'Bookings',
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Wrap(spacing: 8, runSpacing: 8, children: [
          SizedBox(width: 260, child: TextField(controller: _c, decoration: const InputDecoration(hintText: 'Reference, guest, email', prefixIcon: Icon(Icons.search)), onSubmitted: (v) => setState(() => q = v.trim()))),
          for (final s in const ['PENDING_CONFIRMATION', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'EXPIRED'])
            FilterChip(label: Text(s.replaceAll('_', ' ').toLowerCase()), selected: status == s, onSelected: (on) => setState(() => status = on ? s : null)),
        ]),
        const SizedBox(height: 12),
        _PagedList(
          reloadKey: '$status|$q',
          load: (p) => api.getJson('/admin/bookings', query: {'page': p, 'status': status, 'q': q}),
          row: (c, b, reload) => Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              title: Text('${b['reference']} · ${b['guest_name']}'),
              subtitle: Text('${b['accommodation_name']}\n${fmtDate(b['check_in'] as String)} → ${fmtDate(b['check_out'] as String)} · ${money(b['total_usd'] as num)}${b['is_demo'] == true ? ' · demo' : ''}'),
              isThreeLine: true,
              trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                StatusPill(b['status'] as String),
                PopupMenuButton<String>(
                  tooltip: 'Actions',
                  onSelected: (a) async {
                    try {
                      if (a == 'cancel') {
                        final ok = await confirm(c, title: 'Cancel booking ${b['reference']}?', message: 'The room is released and the guest is notified. Refund rules follow the booking policy.', confirmLabel: 'Cancel booking', destructive: true);
                        if (!ok) return;
                        await api.postJson('/admin/bookings/${b['id']}/cancel');
                      } else {
                        await api.postJson('/admin/bookings/${b['id']}/transition', body: {'to': a});
                      }
                      reload();
                    } catch (e) {
                      if (c.mounted) showError(c, e);
                    }
                  },
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'CHECKED_IN', child: Text('Mark checked in')),
                    PopupMenuItem(value: 'COMPLETED', child: Text('Mark completed')),
                    PopupMenuItem(value: 'cancel', child: Text('Cancel booking')),
                  ],
                ),
              ]),
              onTap: () => showDialog<void>(context: c, builder: (d) => _BookingDialog(id: b['id'] as String)),
            ),
          ),
        ),
      ]),
    );
  }
}

class _BookingDialog extends ConsumerWidget {
  const _BookingDialog({required this.id});
  final String id;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return AlertDialog(
      title: const Text('Booking detail'),
      content: SizedBox(
        width: 460,
        child: FutureBuilder<Json>(
          future: ref.read(apiProvider).getJson('/admin/bookings/$id'),
          builder: (c, s) {
            if (s.connectionState != ConnectionState.done) return const SizedBox(height: 80, child: Center(child: CircularProgressIndicator()));
            if (s.hasError) return ErrorState(error: s.error!);
            final b = s.data!;
            final ev = (b['events'] as List).cast<Json>();
            final pay = (b['payments'] as List).cast<Json>();
            return SingleChildScrollView(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${b['reference']} · ${b['accommodation_name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                Text('${b['guest_name']} · ${b['guest_email']}'),
                Text('${b['check_in']} → ${b['check_out']} · ${b['nights']} nights · \$${b['total_usd']}'),
                const SizedBox(height: 12),
                const Text('Status history', style: TextStyle(fontWeight: FontWeight.w600)),
                for (final e in ev) Text('• ${e['to_status']} — ${fmtDate(e['created_at'] as String, pattern: 'd MMM y HH:mm')}${e['note'] != null ? ' (${e['note']})' : ''}', style: const TextStyle(fontSize: 13)),
                const SizedBox(height: 12),
                const Text('Payments', style: TextStyle(fontWeight: FontWeight.w600)),
                for (final p in pay) Text('• ${p['status']} \$${p['amount_usd']} ${p['provider_ref']}${p['simulated'] == true ? ' (simulated)' : ''}', style: const TextStyle(fontSize: 13)),
              ]),
            );
          },
        ),
      ),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close'))],
    );
  }
}

class _Payments extends ConsumerWidget {
  const _Payments();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final api = ref.watch(apiProvider);
    return _Page<void>(
      title: 'Payments and transactions',
      child: _PagedList(
        load: (p) => api.getJson('/admin/payments', query: {'page': p}),
        row: (c, p, _) => Card(
          margin: const EdgeInsets.only(bottom: 8),
          child: ListTile(
            title: Text('\$${p['amount_usd']} · ${p['reference']}'),
            subtitle: Text('${p['provider_ref']} · ${p['provider']}${p['simulated'] == true ? ' (simulated)' : ''}${p['failure_reason'] != null ? ' · ${p['failure_reason']}' : ''}'),
            trailing: StatusPill(p['status'] as String),
          ),
        ),
      ),
    );
  }
}

class _Users extends ConsumerStatefulWidget {
  const _Users({required this.canChangeRole});
  final bool canChangeRole;
  @override
  ConsumerState<_Users> createState() => _UsersState();
}

class _UsersState extends ConsumerState<_Users> {
  String q = '';
  String? role;
  @override
  Widget build(BuildContext context) {
    final api = ref.watch(apiProvider);
    return _Page<void>(
      title: 'Users',
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Wrap(spacing: 8, runSpacing: 8, children: [
          SizedBox(width: 260, child: TextField(decoration: const InputDecoration(hintText: 'Name or email', prefixIcon: Icon(Icons.search)), onSubmitted: (v) => setState(() => q = v.trim()))),
          for (final r in const ['customer', 'partner', 'staff', 'admin']) FilterChip(label: Text(r), selected: role == r, onSelected: (on) => setState(() => role = on ? r : null)),
        ]),
        const SizedBox(height: 12),
        _PagedList(
          reloadKey: '$q|$role',
          load: (p) => api.getJson('/admin/users', query: {'page': p, 'q': q, 'role': role}),
          row: (c, u, reload) => Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              leading: const CircleAvatar(child: Icon(Icons.person_outline)),
              title: Text(u['name'] as String),
              subtitle: Text('${u['email']}${u['is_demo'] == true ? ' · demo account' : ''}'),
              trailing: widget.canChangeRole
                  ? DropdownButton<String>(
                      value: u['role'] as String,
                      underline: const SizedBox.shrink(),
                      items: [for (final r in ['customer', 'partner', 'staff', 'admin']) DropdownMenuItem(value: r, child: Text(r))],
                      onChanged: (v) async {
                        if (v == null || v == u['role']) return;
                        final ok = await confirm(c, title: 'Change role?', message: 'Set ${u['email']} to "$v". This changes what the account can do.', confirmLabel: 'Change role');
                        if (!ok) return;
                        try {
                          await api.patchEmpty('/admin/users/${u['id']}/role', body: {'role': v});
                          reload();
                        } catch (e) {
                          if (c.mounted) showError(c, e);
                        }
                      },
                    )
                  : Pill(u['role'] as String),
            ),
          ),
        ),
      ]),
    );
  }
}

class _Reviews extends ConsumerWidget {
  const _Reviews();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final api = ref.watch(apiProvider);
    return _Page<void>(
      title: 'Review moderation',
      child: _PagedList(
        load: (p) => api.getJson('/admin/reviews', query: {'page': p}),
        row: (c, r, reload) => Card(
          margin: const EdgeInsets.only(bottom: 8),
          child: ListTile(
            title: Text('${'★' * (r['rating'] as int)}  ${r['title']}'),
            subtitle: Text('${r['accommodation_name']} · ${r['author']}\n${r['body']}', maxLines: 3, overflow: TextOverflow.ellipsis),
            isThreeLine: true,
            trailing: TextButton(
              onPressed: () async {
                final next = r['status'] == 'published' ? 'hidden' : 'published';
                try {
                  await api.patchEmpty('/admin/reviews/${r['id']}', body: {'status': next});
                  reload();
                } catch (e) {
                  if (c.mounted) showError(c, e);
                }
              },
              child: Text(r['status'] == 'published' ? 'Hide' : 'Publish'),
            ),
          ),
        ),
      ),
    );
  }
}

class _Audit extends ConsumerWidget {
  const _Audit();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final api = ref.watch(apiProvider);
    return _Page<void>(
      title: 'Audit log',
      child: _PagedList(
        load: (p) => api.getJson('/admin/audit-logs', query: {'page': p}),
        row: (c, l, _) => ListTile(
          dense: true,
          leading: const Icon(Icons.history, size: 18),
          title: Text('${l['action']} · ${l['entity']}'),
          subtitle: Text('${l['actor_email'] ?? 'system'} · ${fmtDate(l['created_at'] as String, pattern: 'd MMM y HH:mm')}'),
        ),
      ),
    );
  }
}

class _Content extends ConsumerStatefulWidget {
  const _Content();
  @override
  ConsumerState<_Content> createState() => _ContentState();
}

class _ContentState extends ConsumerState<_Content> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController(), _country = TextEditingController(text: 'Cambodia');
  final _short = TextEditingController(), _long = TextEditingController();
  final _lat = TextEditingController(), _lng = TextEditingController(), _budget = TextEditingController(text: '40');
  bool busy = false;

  @override
  Widget build(BuildContext context) {
    String? req(String? v) => (v ?? '').trim().isEmpty ? 'Required' : null;
    String? num_(String? v, double lo, double hi) {
      final d = double.tryParse((v ?? '').trim());
      return d == null || d < lo || d > hi ? 'Enter a number between $lo and $hi' : null;
    }

    return _Page<void>(
      title: 'Create destination',
      child: Form(
        key: _form,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 620),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            TextFormField(controller: _name, decoration: const InputDecoration(labelText: 'Name'), validator: (v) => (v ?? '').trim().length < 2 ? 'At least 2 characters' : null),
            const SizedBox(height: 12),
            TextFormField(controller: _country, decoration: const InputDecoration(labelText: 'Country'), validator: req),
            const SizedBox(height: 12),
            TextFormField(controller: _short, decoration: const InputDecoration(labelText: 'Short description (10+ chars)'), validator: (v) => (v ?? '').trim().length < 10 ? 'At least 10 characters' : null),
            const SizedBox(height: 12),
            TextFormField(controller: _long, maxLines: 4, decoration: const InputDecoration(labelText: 'Long description (20+ chars)'), validator: (v) => (v ?? '').trim().length < 20 ? 'At least 20 characters' : null),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: TextFormField(controller: _lat, decoration: const InputDecoration(labelText: 'Latitude'), keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), validator: (v) => num_(v, -90, 90))),
              const SizedBox(width: 12),
              Expanded(child: TextFormField(controller: _lng, decoration: const InputDecoration(labelText: 'Longitude'), keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), validator: (v) => num_(v, -180, 180))),
            ]),
            const SizedBox(height: 12),
            TextFormField(controller: _budget, decoration: const InputDecoration(labelText: 'Daily budget (USD)'), keyboardType: TextInputType.number, validator: (v) => num_(v, 0, 5000)),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: busy ? null : () async {
                if (!_form.currentState!.validate()) return;
                setState(() => busy = true);
                try {
                  await ref.read(apiProvider).postJson('/admin/destinations', body: {
                    'name': _name.text.trim(), 'country': _country.text.trim(), 'shortDescription': _short.text.trim(), 'longDescription': _long.text.trim(),
                    'lat': double.parse(_lat.text), 'lng': double.parse(_lng.text), 'dailyBudgetUsd': double.parse(_budget.text), 'currency': 'USD',
                  });
                  if (mounted) {
                    showInfo(context, 'Destination created and audited.');
                    _form.currentState!.reset();
                    ref.invalidate(metaProvider);
                  }
                } catch (e) {
                  if (mounted) showError(context, e);
                }
                if (mounted) setState(() => busy = false);
              },
              child: const Text('Create destination'),
            ),
            const SizedBox(height: 8),
            const Text('Hotel, room and inventory management are available through the API (/admin/accommodations, /admin/room-types/:id/inventory) and the partner portal.', style: TextStyle(fontSize: 12, color: Tokens.inkMuted)),
          ]),
        ),
      ),
    );
  }
}

/* ---------------------------------------------------------------- partner portal */

class PartnerScreen extends ConsumerStatefulWidget {
  const PartnerScreen({super.key});
  @override
  ConsumerState<PartnerScreen> createState() => _PartnerScreenState();
}

class _PartnerScreenState extends ConsumerState<PartnerScreen> {
  int version = 0;

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    if (!(auth.isPartner || auth.role == 'admin')) {
      return const EmptyState(icon: Icons.lock_outline, title: 'Partner access required', message: 'Only partner accounts can manage properties. Access is enforced by the server.');
    }
    final api = ref.watch(apiProvider);
    final money = ref.watch(moneyProvider);
    return ListView(children: [
      Constrained(
        maxWidth: 1000,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Partner portal', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 16),
            FutureBuilder<Json>(
              key: ValueKey('an$version'),
              future: api.getJson('/partner/analytics'),
              builder: (c, s) {
                if (!s.hasData) return const SizedBox.shrink();
                final a = s.data!;
                return Wrap(spacing: 12, runSpacing: 12, children: [
                  _Stat('occupancy, next 30 days', a['occupancyPctNext30Days'] == null ? 'n/a' : '${a['occupancyPctNext30Days']}%'),
                  for (final b in (a['bookingsByStatus'] as List).cast<Json>()) _Stat((b['status'] as String).toLowerCase().replaceAll('_', ' '), '${b['count']}'),
                ]);
              },
            ),
            const SectionHeader('Your properties'),
            FutureBuilder<Json>(
              key: ValueKey('pr$version'),
              future: api.getJson('/partner/accommodations'),
              builder: (c, s) {
                if (s.connectionState != ConnectionState.done) return const SkeletonList(count: 2);
                if (s.hasError) return ErrorState(error: s.error!);
                final items = (s.data!['items'] as List).cast<Json>();
                if (items.isEmpty) return const EmptyState(title: 'No properties assigned to this partner account');
                return Column(children: [
                  for (final p in items)
                    Card(
                      margin: const EdgeInsets.only(bottom: 12),
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(p['name'] as String, style: Theme.of(context).textTheme.titleMedium),
                          for (final r in ((p['rooms'] as List?) ?? const []).cast<Json>())
                            ListTile(
                              contentPadding: EdgeInsets.zero,
                              title: Text(r['name'] as String),
                              subtitle: Text('${money(r['base_price_usd'] as num)} base · ${r['total_units']} rooms'),
                              trailing: OutlinedButton(onPressed: () => _editInventory(context, r), child: const Text('Availability')),
                            ),
                        ]),
                      ),
                    ),
                ]);
              },
            ),
            const SectionHeader('Incoming bookings'),
            _PagedList(
              reloadKey: version,
              load: (p) => api.getJson('/partner/bookings', query: {'page': p}),
              row: (c, b, reload) => Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  title: Text('${b['reference']} · ${b['guest_name']}'),
                  subtitle: Text('${b['accommodation_name']} · ${b['room_name']}\n${fmtDate(b['check_in'] as String)} → ${fmtDate(b['check_out'] as String)}'),
                  isThreeLine: true,
                  trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                    StatusPill(b['status'] as String),
                    if (b['status'] == 'CONFIRMED') TextButton(onPressed: () => _t(c, b, 'CHECKED_IN', reload), child: const Text('Check in')),
                    if (b['status'] == 'CHECKED_IN') TextButton(onPressed: () => _t(c, b, 'COMPLETED', reload), child: const Text('Complete')),
                  ]),
                ),
              ),
            ),
          ]),
        ),
      ),
    ]);
  }

  Future<void> _t(BuildContext c, Json b, String to, VoidCallback reload) async {
    try {
      await ref.read(apiProvider).postJson('/partner/bookings/${b['id']}/transition', body: {'to': to});
      reload();
    } catch (e) {
      if (c.mounted) showError(c, e);
    }
  }

  Future<void> _editInventory(BuildContext context, Json room) async {
    final units = TextEditingController(text: '${room['total_units']}');
    final price = TextEditingController();
    final now = DateTime.now();
    DateTimeRange range = DateTimeRange(start: now.add(const Duration(days: 1)), end: now.add(const Duration(days: 14)));
    await showDialog<void>(
      context: context,
      builder: (c) => StatefulBuilder(builder: (c, set) => AlertDialog(
        title: Text('Availability: ${room['name']}'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          OutlinedButton.icon(
            icon: const Icon(Icons.date_range),
            label: Text('${iso(range.start)} → ${iso(range.end)}'),
            onPressed: () async {
              final r = await showDateRangePicker(context: c, firstDate: now, lastDate: now.add(const Duration(days: 365)), initialDateRange: range);
              if (r != null) set(() => range = r);
            },
          ),
          const SizedBox(height: 12),
          TextField(controller: units, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: 'Rooms available per night (0–${room['total_units']})')),
          const SizedBox(height: 12),
          TextField(controller: price, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Nightly price USD (optional)')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: const Text('Cancel')),
          FilledButton(
            onPressed: () async {
              try {
                await ref.read(apiProvider).putJson('/partner/room-types/${room['id']}/inventory', body: {
                  'from': iso(range.start), 'to': iso(range.end), 'units': int.parse(units.text),
                  if (price.text.trim().isNotEmpty) 'priceUsd': double.parse(price.text),
                });
                if (c.mounted) Navigator.pop(c);
                if (mounted) { showInfo(context, 'Availability updated'); setState(() => version++); }
              } catch (e) {
                if (c.mounted) showError(c, e);
              }
            },
            child: const Text('Save'),
          ),
        ],
      )),
    );
  }
}

void goAdmin(BuildContext c) => c.go('/admin');
