import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/providers.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/theme.dart';
import '../../core/widgets/cards.dart';
import '../../core/widgets/widgets.dart';
import '../auth/auth_controller.dart';

final _emailRe = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

class AuthScreen extends ConsumerStatefulWidget {
  const AuthScreen({super.key, required this.register, this.next});
  final bool register;
  final String? next;
  @override
  ConsumerState<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends ConsumerState<AuthScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _pw = TextEditingController();
  bool busy = false, hide = true;

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() => busy = true);
    try {
      final auth = ref.read(authProvider.notifier);
      if (widget.register) {
        await auth.register(_name.text.trim(), _email.text.trim(), _pw.text);
      } else {
        await auth.login(_email.text.trim(), _pw.text);
      }
      ref.invalidate(wishlistProvider);
      if (mounted) context.go(widget.next ?? '/account');
    } catch (e) {
      if (mounted) showError(context, e);
    }
    if (mounted) setState(() => busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final reg = widget.register;
    final nextQ = widget.next == null ? '' : '?next=${Uri.encodeComponent(widget.next!)}';
    return ListView(children: [
      Constrained(
        maxWidth: 440,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 40),
          child: Form(
            key: _form,
            child: AutofillGroup(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(reg ? 'Create your account' : 'Welcome back', style: Theme.of(context).textTheme.headlineMedium),
                const SizedBox(height: 8),
                Text(reg ? 'Save trips, manage bookings and keep a wishlist.' : 'Sign in to manage bookings and saved trips.', style: const TextStyle(color: Tokens.inkMuted)),
                const SizedBox(height: 24),
                if (reg) ...[
                  TextFormField(controller: _name, autofillHints: const [AutofillHints.name], textInputAction: TextInputAction.next, decoration: const InputDecoration(labelText: 'Full name'), validator: (v) => (v ?? '').trim().length < 2 ? 'Enter your name' : null),
                  const SizedBox(height: 12),
                ],
                TextFormField(controller: _email, autofillHints: const [AutofillHints.email], keyboardType: TextInputType.emailAddress, textInputAction: TextInputAction.next, decoration: const InputDecoration(labelText: 'Email'), validator: (v) => _emailRe.hasMatch((v ?? '').trim()) ? null : 'Enter a valid email address'),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _pw,
                  obscureText: hide,
                  autofillHints: [reg ? AutofillHints.newPassword : AutofillHints.password],
                  onFieldSubmitted: (_) => _submit(),
                  decoration: InputDecoration(labelText: 'Password', helperText: reg ? 'At least 10 characters, with letters and a number' : null, suffixIcon: IconButton(tooltip: hide ? 'Show password' : 'Hide password', icon: Icon(hide ? Icons.visibility_outlined : Icons.visibility_off_outlined), onPressed: () => setState(() => hide = !hide))),
                  validator: (v) {
                    final s = v ?? '';
                    if (s.isEmpty) return 'Enter your password';
                    if (reg && (s.length < 10 || !RegExp(r'\d').hasMatch(s) || !RegExp(r'[a-zA-Z]').hasMatch(s))) return 'Use 10+ characters with letters and a number';
                    return null;
                  },
                ),
                const SizedBox(height: 20),
                FilledButton(onPressed: busy ? null : _submit, child: busy ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(reg ? 'Create account' : 'Sign in')),
                const SizedBox(height: 12),
                TextButton(onPressed: () => context.go(reg ? '/login$nextQ' : '/register$nextQ'), child: Text(reg ? 'Already have an account? Sign in' : 'New here? Create an account')),
                if (!reg) TextButton(onPressed: () => _forgot(context), child: const Text('Forgot password?')),
                if (!reg) const _DemoLogins(),
              ]),
            ),
          ),
        ),
      ),
    ]);
  }

  Future<void> _forgot(BuildContext context) async {
    final email = TextEditingController(text: _email.text);
    String? message;
    await showDialog<void>(
      context: context,
      builder: (c) => StatefulBuilder(builder: (c, set) => AlertDialog(
        title: const Text('Reset password'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: email, decoration: const InputDecoration(labelText: 'Email')),
          if (message != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(message!)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: const Text('Close')),
          FilledButton(
            onPressed: () async {
              try {
                final r = await ref.read(apiProvider).postJson('/auth/forgot-password', body: {'email': email.text.trim()});
                set(() => message = '${r['message']}${r['demoResetToken'] != null ? '\n\nDemo mode (no email provider): use token ${r['demoResetToken']} via the API /auth/reset-password.' : ''}');
              } catch (e) {
                set(() => message = e.toString());
              }
            },
            child: const Text('Send reset link'),
          ),
        ],
      )),
    );
  }
}

class _DemoLogins extends StatelessWidget {
  const _DemoLogins();
  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(top: 24),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Tokens.sand, borderRadius: BorderRadius.circular(8)),
        child: const Text(
          'Demo customer account: maya@demo.wayfarer.test, password in the demo guide (docs/USER_MANUAL.md). Staff, partner and admin demo accounts are issued by the project owner.',
          style: TextStyle(fontSize: 12, color: Tokens.inkMuted, height: 1.4),
        ),
      );
}

class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authProvider);
    final user = auth.user;
    final currency = ref.watch(currencyProvider);
    final meta = ref.watch(metaProvider).value;
    final currencies = ((meta?['currencies'] as List?) ?? const []).cast<Json>();
    if (auth.isLoading) return const Padding(padding: EdgeInsets.all(24), child: SkeletonList(count: 2));
    if (user == null) {
      return ListView(children: [
        Constrained(maxWidth: 520, child: Padding(padding: const EdgeInsets.symmetric(vertical: 24), child: Column(children: [
          const EmptyState(icon: Icons.person_outline, title: 'You are not signed in', message: 'Sign in to see bookings, saved trips and your wishlist.'),
          FilledButton(onPressed: () => context.go('/login'), child: const Text('Sign in')),
          const SizedBox(height: 8),
          OutlinedButton(onPressed: () => context.go('/register'), child: const Text('Create an account')),
        ]))),
        _currencySection(context, ref, currency, currencies),
      ]);
    }
    final role = auth.role;
    Widget tile(IconData i, String t, String sub, String path) => Card(child: ListTile(leading: Icon(i, color: Tokens.forest), title: Text(t), subtitle: Text(sub), trailing: const Icon(Icons.chevron_right), onTap: () => context.push(path)));
    return ListView(children: [
      Constrained(
        maxWidth: 720,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Hello, ${(user['name'] as String).split(' ').first}', style: Theme.of(context).textTheme.headlineMedium),
            Text('${user['email']} · ${role[0].toUpperCase()}${role.substring(1)}', style: const TextStyle(color: Tokens.inkMuted)),
            const SizedBox(height: 20),
            tile(Icons.luggage_outlined, 'My bookings', 'Status, cancellation and receipts', '/bookings'),
            const SizedBox(height: 8),
            tile(Icons.map_outlined, 'My trips', 'Saved itineraries', '/trips'),
            const SizedBox(height: 8),
            tile(Icons.favorite_border, 'Wishlist', 'Saved destinations and stays', '/wishlist'),
            const SizedBox(height: 8),
            tile(Icons.notifications_none, 'Notifications', 'Booking and payment updates', '/notifications'),
            if (auth.isStaff) ...[const SizedBox(height: 8), tile(Icons.admin_panel_settings_outlined, 'Administration', 'Overview, bookings, payments, reviews, audit log', '/admin')],
            if (auth.isPartner) ...[const SizedBox(height: 8), tile(Icons.storefront_outlined, 'Partner portal', 'Your properties, bookings and availability', '/partner')],
            _currencySection(context, ref, currency, currencies),
            const SizedBox(height: 24),
            OutlinedButton.icon(
              onPressed: () async {
                await ref.read(authProvider.notifier).logout();
                if (context.mounted) context.go('/');
              },
              icon: const Icon(Icons.logout),
              label: const Text('Sign out'),
            ),
            const SizedBox(height: 8),
            TextButton(
              style: TextButton.styleFrom(foregroundColor: Tokens.danger),
              onPressed: () => _delete(context, ref),
              child: const Text('Delete my account'),
            ),
          ]),
        ),
      ),
    ]);
  }

  Widget _currencySection(BuildContext context, WidgetRef ref, String currency, List<Json> currencies) => Constrained(
        maxWidth: 720,
        child: Padding(
          padding: const EdgeInsets.only(top: 24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Display currency', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            const Text('Prices are stored in USD and converted with documented sample rates, not live market rates.', style: TextStyle(fontSize: 12, color: Tokens.inkMuted)),
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final c in currencies) ChoiceChip(label: Text(c['code'] as String), selected: currency == c['code'], onSelected: (_) => ref.read(currencyProvider.notifier).set(c['code'] as String)),
            ]),
          ]),
        ),
      );

  Future<void> _delete(BuildContext context, WidgetRef ref) async {
    final pw = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Delete your account?'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text('Your profile is anonymised and you will be signed out. Active bookings must be cancelled first. This cannot be undone.'),
          const SizedBox(height: 12),
          TextField(controller: pw, obscureText: true, decoration: const InputDecoration(labelText: 'Confirm password')),
        ]),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep account')), FilledButton(style: FilledButton.styleFrom(backgroundColor: Tokens.danger), onPressed: () => Navigator.pop(c, true), child: const Text('Delete'))],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(apiProvider).postEmpty('/users/me/delete', body: {'password': pw.text});
      await ref.read(authProvider.notifier).logout();
      if (context.mounted) context.go('/');
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }
}

class WishlistScreen extends ConsumerWidget {
  const WishlistScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final res = ref.watch(wishlistProvider);
    return ListView(children: [
      Constrained(
        maxWidth: 900,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Wishlist', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 16),
            AsyncView<Json>(
              value: res,
              onRetry: () => ref.invalidate(wishlistProvider),
              data: (r) {
                final items = (r['items'] as List).cast<Json>();
                if (items.isEmpty) return const EmptyState(icon: Icons.favorite_border, title: 'Nothing saved yet', message: 'Tap Save on a destination or stay to keep it here.');
                return Column(children: [
                  for (final i in items)
                    Card(
                      margin: const EdgeInsets.only(bottom: 10),
                      child: ListTile(
                        leading: ClipRRect(borderRadius: BorderRadius.circular(8), child: WImage(i['image'] as String?, width: 56, height: 56)),
                        title: Text((i['name'] ?? 'Saved item') as String),
                        subtitle: Text(i['kind'] as String),
                        trailing: IconButton(
                          tooltip: 'Remove from wishlist',
                          icon: const Icon(Icons.close),
                          onPressed: () async {
                            await ref.read(apiProvider).delete('/wishlist/${i['kind']}/${i['ref_id']}');
                            ref.invalidate(wishlistProvider);
                          },
                        ),
                        onTap: () {
                          final slug = i['slug'];
                          if (i['kind'] == 'destination') context.push('/destinations/$slug');
                          if (i['kind'] == 'accommodation') context.push('/stays/$slug');
                        },
                      ),
                    ),
                ]);
              },
            ),
          ]),
        ),
      ),
    ]);
  }
}

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final res = ref.watch(notificationsProvider);
    return ListView(children: [
      Constrained(
        maxWidth: 760,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text('Notifications', style: Theme.of(context).textTheme.headlineMedium)),
              TextButton(
                onPressed: () async {
                  await ref.read(apiProvider).postEmpty('/notifications/read-all');
                  ref.invalidate(notificationsProvider);
                },
                child: const Text('Mark all read'),
              ),
            ]),
            const Text('In-app notifications only. Push delivery needs Firebase credentials and is not configured.', style: TextStyle(fontSize: 12, color: Tokens.inkMuted)),
            const SizedBox(height: 16),
            AsyncView<Json>(
              value: res,
              onRetry: () => ref.invalidate(notificationsProvider),
              data: (r) {
                final items = (r['items'] as List).cast<Json>();
                if (items.isEmpty) return const EmptyState(icon: Icons.notifications_none, title: 'You are all caught up');
                return Column(children: [
                  for (final n in items)
                    Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      color: n['read_at'] == null ? Tokens.forest.withValues(alpha: 0.06) : null,
                      child: ListTile(
                        leading: Icon(n['type'] == 'payment' ? Icons.payments_outlined : n['type'] == 'itinerary' ? Icons.map_outlined : Icons.luggage_outlined, color: Tokens.forest),
                        title: Text(n['title'] as String, style: TextStyle(fontWeight: n['read_at'] == null ? FontWeight.w700 : FontWeight.w500)),
                        subtitle: Text('${n['body']}\n${fmtDate(n['created_at'] as String, pattern: 'd MMM y, HH:mm')}'),
                        isThreeLine: true,
                        onTap: () async {
                          await ref.read(apiProvider).patchEmpty('/notifications/${n['id']}/read');
                          ref.invalidate(notificationsProvider);
                          final bid = (n['data'] as Map?)?['bookingId'];
                          if (bid != null && context.mounted) context.push('/bookings/$bid');
                        },
                      ),
                    ),
                ]);
              },
            ),
          ]),
        ),
      ),
    ]);
  }
}

IconData categoryIconFor(String c) => categoryIcon(c);
