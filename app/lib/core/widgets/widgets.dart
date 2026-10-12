import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../data/providers.dart';
import '../network/api_client.dart';
import '../theme/theme.dart';

/* ------------------------------------------------------------------ formatting */

final moneyProvider = Provider<String Function(num usd)>((ref) {
  final code = ref.watch(currencyProvider);
  final meta = ref.watch(metaProvider).value;
  final list = (meta?['currencies'] as List?) ?? const [];
  final row = list.cast<Map>().where((c) => c['code'] == code).cast<Map?>().firstOrNull;
  final rate = (row?['per_usd'] as num?)?.toDouble() ?? 1.0;
  final symbol = (row?['symbol'] as String?) ?? r'$';
  final active = row != null ? code : 'USD';
  return (num usd) {
    final v = usd * (row != null ? rate : 1);
    final noDecimals = (rate >= 100 && active != 'USD') || v == v.roundToDouble();
    final f = NumberFormat.decimalPattern()..minimumFractionDigits = noDecimals ? 0 : 2..maximumFractionDigits = noDecimals ? 0 : 2;
    final prefix = active == 'USD' ? r'$' : symbol;
    return '$prefix${f.format(v)}';
  };
});

String fmtDate(String? iso, {String pattern = 'EEE d MMM'}) {
  if (iso == null) return '';
  final d = DateTime.tryParse(iso);
  return d == null ? iso : DateFormat(pattern).format(d.toLocal());
}

String fmtMinutes(int m) {
  final h = (m ~/ 60) % 24, mm = m % 60;
  final suffix = h >= 12 ? 'pm' : 'am';
  final h12 = h % 12 == 0 ? 12 : h % 12;
  return '$h12:${mm.toString().padLeft(2, '0')} $suffix';
}

String iso(DateTime d) => DateFormat('yyyy-MM-dd').format(d);

int nightsBetween(String? a, String? b) {
  if (a == null || b == null) return 0;
  final x = DateTime.tryParse(a), y = DateTime.tryParse(b);
  if (x == null || y == null) return 0;
  return y.difference(x).inDays;
}

/* ------------------------------------------------------------------ layout */

class Constrained extends StatelessWidget {
  const Constrained({super.key, required this.child, this.maxWidth = Tokens.maxContent, this.padding});
  final Widget child;
  final double maxWidth;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    final w = MediaQuery.sizeOf(context).width;
    final gutter = w >= 840 ? 32.0 : 16.0;
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: Padding(padding: padding ?? EdgeInsets.symmetric(horizontal: gutter), child: child),
      ),
    );
  }
}

bool isWide(BuildContext c) => MediaQuery.sizeOf(c).width >= 840;

class SectionHeader extends StatelessWidget {
  const SectionHeader(this.title, {super.key, this.subtitle, this.action, this.onAction});
  final String title;
  final String? subtitle;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(top: 32, bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Semantics(header: true, child: Text(title, style: t.headlineSmall)),
              if (subtitle != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(subtitle!, style: t.bodyMedium?.copyWith(color: Tokens.inkMuted))),
            ]),
          ),
          if (action != null) TextButton(onPressed: onAction, child: Text(action!)),
        ],
      ),
    );
  }
}

/* ------------------------------------------------------------------ imagery */

/// Network photo with a calm tonal fallback (never a broken-image icon).
class WImage extends StatelessWidget {
  const WImage(this.url, {super.key, this.height, this.width, this.radius = 0, this.fallbackIcon = Icons.landscape_outlined, this.label});
  final String? url;
  final double? height, width, radius;
  final IconData fallbackIcon;
  final String? label;

  Widget _fallback() => Container(
        height: height,
        width: width,
        decoration: BoxDecoration(
          gradient: const LinearGradient(colors: [Color(0xFFE6E0D0), Color(0xFFD7DFD6)], begin: Alignment.topLeft, end: Alignment.bottomRight),
        ),
        child: Center(child: Icon(fallbackIcon, color: Tokens.forest.withValues(alpha: 0.5), size: 32)),
      );

  @override
  Widget build(BuildContext context) {
    final r = BorderRadius.circular(radius ?? 0);
    final child = (url == null || url!.isEmpty)
        ? _fallback()
        : CachedNetworkImage(
            imageUrl: url!,
            height: height,
            width: width,
            fit: BoxFit.cover,
            fadeInDuration: MediaQuery.of(context).disableAnimations ? Duration.zero : const Duration(milliseconds: 200),
            placeholder: (_, _) => Container(height: height, width: width, color: Tokens.sand),
            errorWidget: (_, _, _) => _fallback(),
          );
    return Semantics(
      image: true,
      label: label,
      child: ClipRRect(borderRadius: r, child: child),
    );
  }
}

/* ------------------------------------------------------------------ states */

class SkeletonBox extends StatelessWidget {
  const SkeletonBox({super.key, this.height = 16, this.width, this.radius = 8});
  final double height;
  final double? width;
  final double radius;
  @override
  Widget build(BuildContext context) => Container(
        height: height,
        width: width,
        decoration: BoxDecoration(color: Tokens.sand, borderRadius: BorderRadius.circular(radius)),
      );
}

class SkeletonList extends StatelessWidget {
  const SkeletonList({super.key, this.count = 4, this.itemHeight = 220});
  final int count;
  final double itemHeight;
  @override
  Widget build(BuildContext context) => Semantics(
        label: 'Loading',
        child: Column(
          children: [for (var i = 0; i < count; i++) Padding(padding: const EdgeInsets.only(bottom: 16), child: SkeletonBox(height: itemHeight, radius: Tokens.radius))],
        ),
      );
}

class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.error, this.onRetry});
  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final e = error;
    final network = e is ApiException && e.isNetwork;
    final msg = e is ApiException ? e.message : 'Something went wrong. Please try again.';
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(network ? Icons.wifi_off_rounded : Icons.error_outline_rounded, size: 40, color: Tokens.terracotta),
            const SizedBox(height: 12),
            Text(network ? 'Connection problem' : 'We could not load this', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 6),
            Text(msg, textAlign: TextAlign.center, style: const TextStyle(color: Tokens.inkMuted)),
            if (onRetry != null) ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Try again')),
            ],
          ]),
        ),
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.title, this.message, this.icon = Icons.search_off_rounded, this.action});
  final String title;
  final String? message;
  final IconData icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 48, horizontal: 24),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Icon(icon, size: 44, color: Tokens.inkMuted),
              const SizedBox(height: 12),
              Text(title, style: Theme.of(context).textTheme.titleMedium, textAlign: TextAlign.center),
              if (message != null) ...[
                const SizedBox(height: 6),
                Text(message!, textAlign: TextAlign.center, style: const TextStyle(color: Tokens.inkMuted)),
              ],
              if (action != null) ...[const SizedBox(height: 16), action!],
            ]),
          ),
        ),
      );
}

/// Standard async rendering: skeleton while loading, retryable error, data builder.
class AsyncView<T> extends StatelessWidget {
  const AsyncView({super.key, required this.value, required this.data, this.onRetry, this.loading});
  final AsyncValue<T> value;
  final Widget Function(T) data;
  final VoidCallback? onRetry;
  final Widget? loading;

  @override
  Widget build(BuildContext context) => value.when(
        data: data,
        loading: () => loading ?? const Padding(padding: EdgeInsets.symmetric(vertical: 16), child: SkeletonList()),
        error: (e, _) => ErrorState(error: e, onRetry: onRetry),
      );
}

/* ------------------------------------------------------------------ small pieces */

class DemoBadge extends StatelessWidget {
  const DemoBadge({super.key, this.text = 'Demo listing'});
  final String text;
  @override
  Widget build(BuildContext context) => Tooltip(
        message: 'Educational sample data: not a real commercial offer',
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(color: Tokens.amber.withValues(alpha: 0.16), borderRadius: BorderRadius.circular(6)),
          child: Text(text, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Color(0xFF7A5517))),
        ),
      );
}

class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, this.color = Tokens.forest, this.icon});
  final String text;
  final Color color;
  final IconData? icon;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          if (icon != null) ...[Icon(icon, size: 14, color: color), const SizedBox(width: 4)],
          Text(text, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: color)),
        ]),
      );
}

class RatingBadge extends StatelessWidget {
  const RatingBadge({super.key, required this.rating, required this.count});
  final num rating;
  final int count;
  @override
  Widget build(BuildContext context) {
    if (count == 0) return const Text('No reviews yet', style: TextStyle(fontSize: 12, color: Tokens.inkMuted));
    return Row(mainAxisSize: MainAxisSize.min, children: [
      const Icon(Icons.star_rounded, size: 16, color: Tokens.amber),
      const SizedBox(width: 2),
      Text(rating.toStringAsFixed(1), style: const TextStyle(fontWeight: FontWeight.w700)),
      Text(' ($count)', style: const TextStyle(color: Tokens.inkMuted, fontSize: 12)),
    ]);
  }
}

class StarRow extends StatelessWidget {
  const StarRow(this.stars, {super.key});
  final int stars;
  @override
  Widget build(BuildContext context) => Semantics(
        label: '$stars star property',
        child: Row(mainAxisSize: MainAxisSize.min, children: [for (var i = 0; i < stars; i++) const Icon(Icons.star_rounded, size: 14, color: Tokens.amber)]),
      );
}

class StatusPill extends StatelessWidget {
  const StatusPill(this.status, {super.key});
  final String status;
  @override
  Widget build(BuildContext context) {
    final (label, color, icon) = switch (status) {
      'CONFIRMED' => ('Confirmed', Tokens.success, Icons.check_circle_outline),
      'PENDING_CONFIRMATION' => ('Awaiting payment', Tokens.amber, Icons.hourglass_bottom_rounded),
      'CHECKED_IN' => ('Checked in', Tokens.forest, Icons.login_rounded),
      'COMPLETED' => ('Completed', Tokens.forest, Icons.task_alt_rounded),
      'CANCELLED' => ('Cancelled', Tokens.danger, Icons.cancel_outlined),
      'EXPIRED' => ('Expired', Tokens.inkMuted, Icons.timer_off_outlined),
      'REFUND_PENDING' => ('Refund pending', Tokens.amber, Icons.undo_rounded),
      'REFUNDED' => ('Refunded', Tokens.inkMuted, Icons.undo_rounded),
      'DRAFT' => ('Draft', Tokens.inkMuted, Icons.edit_outlined),
      'SUCCESS' => ('Paid (simulated)', Tokens.success, Icons.check_circle_outline),
      'FAILED' => ('Payment failed', Tokens.danger, Icons.error_outline),
      'PENDING' => ('Payment pending', Tokens.amber, Icons.hourglass_bottom_rounded),
      _ => (status, Tokens.inkMuted, Icons.info_outline),
    };
    return Pill(label, color: color, icon: icon);
  }
}

class PriceRow extends StatelessWidget {
  const PriceRow(this.label, this.value, {super.key, this.bold = false, this.muted = false});
  final String label, value;
  final bool bold, muted;
  @override
  Widget build(BuildContext context) {
    final style = TextStyle(fontWeight: bold ? FontWeight.w700 : FontWeight.w400, fontSize: bold ? 16 : 14, color: muted ? Tokens.inkMuted : Tokens.ink);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Flexible(child: Text(label, style: style)), Text(value, style: style)]),
    );
  }
}

void showError(BuildContext context, Object e) {
  final msg = e is ApiException ? e.message : 'Something went wrong. Please try again.';
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(msg), backgroundColor: Tokens.danger));
}

void showInfo(BuildContext context, String msg) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(msg)));
}

Future<bool> confirm(BuildContext context, {required String title, required String message, String confirmLabel = 'Confirm', bool destructive = false}) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep')),
        FilledButton(
          style: destructive ? FilledButton.styleFrom(backgroundColor: Tokens.danger) : null,
          onPressed: () => Navigator.pop(c, true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return r ?? false;
}
