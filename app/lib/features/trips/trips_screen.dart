import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/providers.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/theme.dart';
import '../../core/widgets/cards.dart';
import '../../core/widgets/widgets.dart';
import '../auth/auth_controller.dart';
import '../maps/place_map.dart';

/// Saved trips list.
class TripsScreen extends ConsumerWidget {
  const TripsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final res = ref.watch(itinerariesProvider);
    final money = ref.watch(moneyProvider);
    return ListView(children: [
      Constrained(
        maxWidth: 900,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const SizedBox(height: 24),
          Row(children: [
            Expanded(child: Text('My trips', style: Theme.of(context).textTheme.headlineMedium)),
            FilledButton.icon(onPressed: () => context.go('/trips/new'), icon: const Icon(Icons.auto_awesome_outlined), label: const Text('Plan a trip')),
          ]),
          const SizedBox(height: 16),
          AsyncView<Json>(
            value: res,
            onRetry: () => ref.invalidate(itinerariesProvider),
            data: (r) {
              final items = (r['items'] as List).cast<Json>();
              if (items.isEmpty) {
                return EmptyState(icon: Icons.map_outlined, title: 'No saved trips yet', message: 'Describe your trip to the planner and save the plan here.', action: FilledButton(onPressed: () => context.go('/trips/new'), child: const Text('Start planning')));
              }
              return Column(children: [
                for (final it in items)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Card(
                      child: ListTile(
                        contentPadding: const EdgeInsets.all(14),
                        leading: ClipRRect(borderRadius: BorderRadius.circular(8), child: WImage(it['cover_image'] as String?, width: 64, height: 64)),
                        title: Text(it['title'] as String),
                        subtitle: Text('${it['destination_name']} · ${it['num_days']} day${it['num_days'] == 1 ? '' : 's'} · ${money(it['est_total_usd'] as num)} est.'),
                        trailing: Pill(it['generated_by'] == 'rules' ? 'Rules engine' : it['generated_by'] == 'llm' ? 'AI-assisted' : 'Manual'),
                        onTap: () => context.push('/trips/${it['id']}'),
                      ),
                    ),
                  ),
              ]);
            },
          ),
        ]),
      ),
    ]);
  }
}

/// Natural-language trip planner. Shows the understood parameters, asks for missing info, never invents places.
class PlannerScreen extends ConsumerStatefulWidget {
  const PlannerScreen({super.key, this.destination});
  final String? destination;
  @override
  ConsumerState<PlannerScreen> createState() => _PlannerScreenState();
}

class _PlannerScreenState extends ConsumerState<PlannerScreen> {
  final _prompt = TextEditingController();
  bool busy = false;
  Json? result;
  Object? error;

  static const examples = [
    'I have three days in Phnom Penh, two adults, and a total budget of \$150. I enjoy Khmer food, culture, photography and relaxed walks.',
    'Four days in Siem Reap for 2 adults, temples and photography',
    'A relaxed weekend in Kampot, riverside and local dining',
    '3 days in Singapore with 2 adults and 2 kids',
  ];

  @override
  void initState() {
    super.initState();
    if (widget.destination != null) {
      _prompt.text = '3 days in ${widget.destination!.replaceAll('-', ' ')} for 2 adults';
    }
  }

  Future<void> _generate({bool save = false}) async {
    if (_prompt.text.trim().length < 5) return;
    setState(() { busy = true; error = null; });
    try {
      final r = await ref.read(apiProvider).postJson('/ai/travel-plan', body: {'prompt': _prompt.text.trim(), 'save': save});
      if (save && r['itineraryId'] != null && mounted) {
        ref.invalidate(itinerariesProvider);
        context.go('/trips/${r['itineraryId']}');
        return;
      }
      setState(() => result = r);
    } catch (e) {
      setState(() => error = e);
    }
    if (mounted) setState(() => busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final signedIn = ref.watch(authProvider).signedIn;
    final status = ref.watch(aiStatusProvider).value;
    final t = Theme.of(context).textTheme;
    return ListView(children: [
      Constrained(
        maxWidth: 960,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Trip planner', style: t.headlineMedium),
            const SizedBox(height: 8),
            Text('Describe your trip in plain language. Suggestions come only from places and hotels stored in WAYFARER.', style: t.bodyLarge?.copyWith(color: Tokens.inkMuted)),
            if (status != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Pill(status['llmConfigured'] == true ? 'AI-assisted planning enabled' : 'Rules-based planner (no language model configured)', icon: status['llmConfigured'] == true ? Icons.auto_awesome : Icons.rule, color: status['llmConfigured'] == true ? Tokens.forest : Tokens.terracotta),
              ),
            const SizedBox(height: 16),
            TextField(
              controller: _prompt,
              minLines: 3,
              maxLines: 6,
              maxLength: 800,
              decoration: const InputDecoration(labelText: 'Your trip', hintText: 'e.g. 3 days in Phnom Penh, 2 adults, \$150 total, love food and culture'),
            ),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final e in examples) ActionChip(label: Text(e.length > 48 ? '${e.substring(0, 46)}…' : e), onPressed: () => setState(() => _prompt.text = e)),
            ]),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: busy ? null : _generate,
              icon: busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.auto_awesome_outlined),
              label: Text(busy ? 'Planning…' : 'Create itinerary'),
            ),
            if (error != null) ErrorState(error: error!, onRetry: _generate),
            if (result != null) ...[
              const SizedBox(height: 24),
              _ResultView(
                result: result!,
                signedIn: signedIn,
                onSave: () {
                  if (!signedIn) {
                    context.push('/login?next=${Uri.encodeComponent('/trips/new')}');
                  } else {
                    _generate(save: true);
                  }
                },
              ),
            ],
          ]),
        ),
      ),
    ]);
  }
}

class _ResultView extends StatelessWidget {
  const _ResultView({required this.result, required this.onSave, required this.signedIn});
  final Json result;
  final VoidCallback onSave;
  final bool signedIn;

  @override
  Widget build(BuildContext context) {
    if (result['status'] == 'needs_more_info') {
      final qs = (result['questions'] as List).cast<String>();
      final dests = (result['availableDestinations'] as List).cast<Json>();
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('I need a little more information', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            for (final q in qs) Text('• $q'),
            const SizedBox(height: 12),
            const Text('Destinations I can plan:', style: TextStyle(color: Tokens.inkMuted)),
            const SizedBox(height: 6),
            Wrap(spacing: 6, runSpacing: 6, children: [for (final d in dests) Chip(label: Text(d['name'] as String))]),
          ]),
        ),
      );
    }
    final plan = result['plan'] as Json;
    final understood = result['understood'] as Json;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Tokens.sand, borderRadius: BorderRadius.circular(8)),
        child: Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
          const Text('I understood:', style: TextStyle(fontWeight: FontWeight.w600)),
          Pill('${understood['days']} days', icon: Icons.calendar_today_outlined),
          Pill('${understood['adults']} adults${(understood['children'] as int) > 0 ? ', ${understood['children']} children' : ''}', icon: Icons.people_outline),
          if (understood['budgetUsd'] != null) Pill('\$${understood['budgetUsd']} ${understood['budgetIsPerDay'] == true ? 'per day' : 'total'}', icon: Icons.payments_outlined),
          for (final i in (understood['interests'] as List).cast<String>()) Pill(i, color: Tokens.terracotta),
        ]),
      ),
      if (result['parserNote'] != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(result['parserNote'] as String, style: const TextStyle(fontSize: 12, color: Tokens.inkMuted))),
      const SizedBox(height: 16),
      PlanView(plan: plan),
      const SizedBox(height: 16),
      FilledButton.icon(onPressed: onSave, icon: const Icon(Icons.bookmark_add_outlined), label: Text(signedIn ? 'Save to my trips' : 'Sign in to save this trip')),
    ]);
  }
}

/// Renders a plan or loaded itinerary (days → timeline). Items from the API share the same shape.
class PlanView extends ConsumerWidget {
  const PlanView({super.key, required this.plan, this.editing = false, this.onRemove, this.onMove, this.onRegenerate});
  final Json plan;
  final bool editing;
  final void Function(int day, int index)? onRemove;
  final void Function(int day, int from, int to)? onMove;
  final void Function(int day)? onRegenerate;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final money = ref.watch(moneyProvider);
    final days = (plan['days'] as List).cast<Json>();
    final budget = plan['budget'] as Json?;
    final warnings = ((plan['warnings'] as List?) ?? const []).cast<String>();
    final assumptions = ((plan['assumptions'] as List?) ?? const []).cast<dynamic>().map((e) => e.toString()).toList();
    final t = Theme.of(context).textTheme;

    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (plan['title'] != null) Text(plan['title'] as String, style: t.headlineSmall),
      if (plan['summary'] != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(plan['summary'] as String, style: const TextStyle(color: Tokens.inkMuted, height: 1.4))),
      if (plan['modeNote'] != null)
        Padding(
          padding: const EdgeInsets.only(top: 10),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(plan['mode'] == 'llm' ? Icons.auto_awesome : Icons.rule, size: 16, color: Tokens.terracotta),
            const SizedBox(width: 6),
            Expanded(child: Text(plan['modeNote'] as String, style: const TextStyle(fontSize: 12, color: Tokens.terracotta))),
          ]),
        ),
      for (final w in warnings)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Container(padding: const EdgeInsets.all(10), decoration: BoxDecoration(color: Tokens.amber.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(8)), child: Row(children: [const Icon(Icons.warning_amber_rounded, size: 18), const SizedBox(width: 8), Expanded(child: Text(w, style: const TextStyle(fontSize: 13)))])),
        ),
      if (budget != null) ...[
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Estimated budget', style: t.titleMedium),
              const SizedBox(height: 8),
              PriceRow('Stay${plan['lodging'] != null ? ' · ${plan['lodging']['name']} (${plan['lodging']['nights']} night${plan['lodging']['nights'] == 1 ? '' : 's'})' : ''}', money(budget['lodgingUsd'] as num)),
              PriceRow('Activities and entry fees', money(budget['activitiesUsd'] as num)),
              PriceRow('Food', money(budget['foodUsd'] as num)),
              PriceRow('Local transport', money(budget['transportUsd'] as num)),
              const Divider(height: 20),
              PriceRow('Estimated total', money(budget['totalUsd'] as num), bold: true),
              if (budget['budgetUsd'] != null)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Row(children: [
                    Icon(budget['withinBudget'] == true ? Icons.check_circle : Icons.error_outline, size: 18, color: budget['withinBudget'] == true ? Tokens.success : Tokens.danger),
                    const SizedBox(width: 6),
                    Text(budget['withinBudget'] == true ? 'Within your ${money(budget['budgetUsd'] as num)} budget' : 'Over your ${money(budget['budgetUsd'] as num)} budget', style: TextStyle(color: budget['withinBudget'] == true ? Tokens.success : Tokens.danger, fontWeight: FontWeight.w600)),
                  ]),
                ),
              if (assumptions.isNotEmpty)
                ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  title: const Text('Assumptions', style: TextStyle(fontSize: 14)),
                  children: [for (final a in assumptions) Align(alignment: Alignment.centerLeft, child: Padding(padding: const EdgeInsets.only(bottom: 6), child: Text('• $a', style: const TextStyle(fontSize: 13, color: Tokens.inkMuted))))],
                ),
            ]),
          ),
        ),
      ],
      for (final d in days) _DayCard(day: d, money: money, editing: editing, onRemove: onRemove, onMove: onMove, onRegenerate: onRegenerate, destination: plan['destination'] as Json?),
    ]);
  }
}

class _DayCard extends StatefulWidget {
  const _DayCard({required this.day, required this.money, required this.editing, this.onRemove, this.onMove, this.onRegenerate, this.destination});
  final Json day;
  final String Function(num) money;
  final bool editing;
  final void Function(int, int)? onRemove;
  final void Function(int, int, int)? onMove;
  final void Function(int)? onRegenerate;
  final Json? destination;
  @override
  State<_DayCard> createState() => _DayCardState();
}

class _DayCardState extends State<_DayCard> {
  bool showMap = false;
  @override
  Widget build(BuildContext context) {
    final items = (widget.day['items'] as List).cast<Json>();
    final dayNo = widget.day['day'] as int;
    return Padding(
      padding: const EdgeInsets.only(top: 20),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text('Day $dayNo', style: Theme.of(context).textTheme.titleLarge)),
              Text(widget.money(widget.day['costUsd'] as num? ?? (items.fold<double>(0, (s, i) => s + ((i['costUsd'] ?? 0) as num))) ), style: const TextStyle(fontWeight: FontWeight.w600)),
              IconButton(tooltip: showMap ? 'Hide route map' : 'Show route map', onPressed: items.isEmpty ? null : () => setState(() => showMap = !showMap), icon: Icon(showMap ? Icons.map : Icons.map_outlined)),
              if (widget.editing && widget.onRegenerate != null) IconButton(tooltip: 'Regenerate day $dayNo', onPressed: () => widget.onRegenerate!(dayNo), icon: const Icon(Icons.autorenew)),
            ]),
            if (items.isEmpty) const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Text('No stops yet for this day.', style: TextStyle(color: Tokens.inkMuted))),
            if (showMap && items.isNotEmpty) ...[
              PlaceMap(
                height: 240,
                drawRoute: true,
                points: [for (final (i, it) in items.indexed) MapPoint(lat: (it['lat'] as num).toDouble(), lng: (it['lng'] as num).toDouble(), title: it['name'] as String, subtitle: fmtMinutes(it['startMin'] as int), index: i + 1)],
              ),
              const Padding(padding: EdgeInsets.only(top: 6, bottom: 6), child: Text('Dashed line connects stops in order (straight lines, not driving directions).', style: TextStyle(fontSize: 11, color: Tokens.inkMuted))),
            ],
            for (final (i, it) in items.indexed)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  SizedBox(
                    width: 64,
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(fmtMinutes(it['startMin'] as int), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                      Text('${it['durationMin']} min', style: const TextStyle(fontSize: 11, color: Tokens.inkMuted)),
                    ]),
                  ),
                  Container(width: 2, height: 64, margin: const EdgeInsets.only(right: 12), color: Tokens.border),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Icon(categoryIcon(it['category'] as String?), size: 16, color: Tokens.forest),
                        const SizedBox(width: 6),
                        Expanded(child: Text(it['name'] as String, style: const TextStyle(fontWeight: FontWeight.w600))),
                        Text((it['costUsd'] as num) == 0 ? 'Free' : widget.money(it['costUsd'] as num), style: const TextStyle(fontSize: 13)),
                      ]),
                      if (((it['travelMinFromPrev'] ?? 0) as num) > 0) Text('~${it['travelMinFromPrev']} min travel (estimate)', style: const TextStyle(fontSize: 11, color: Tokens.inkMuted)),
                      const SizedBox(height: 2),
                      Text(it['reason'] as String? ?? '', style: const TextStyle(fontSize: 13, color: Tokens.inkMuted, height: 1.35)),
                      Wrap(spacing: 6, children: [
                        if (it['isDemo'] == true || it['is_demo'] == true) const Padding(padding: EdgeInsets.only(top: 4), child: DemoBadge()),
                      ]),
                    ]),
                  ),
                  if (widget.editing)
                    Column(children: [
                      IconButton(tooltip: 'Move up', visualDensity: VisualDensity.compact, onPressed: i > 0 ? () => widget.onMove!(dayNo, i, i - 1) : null, icon: const Icon(Icons.arrow_upward, size: 18)),
                      IconButton(tooltip: 'Move down', visualDensity: VisualDensity.compact, onPressed: i < items.length - 1 ? () => widget.onMove!(dayNo, i, i + 1) : null, icon: const Icon(Icons.arrow_downward, size: 18)),
                      IconButton(tooltip: 'Remove stop', visualDensity: VisualDensity.compact, onPressed: () => widget.onRemove!(dayNo, i), icon: const Icon(Icons.delete_outline, size: 18, color: Tokens.danger)),
                    ]),
                ]),
              ),
          ]),
        ),
      ),
    );
  }
}

/// Loaded itinerary (own or template): edit, reorder, remove, replace/regenerate, recalculate, copy.
class ItineraryScreen extends ConsumerStatefulWidget {
  const ItineraryScreen({super.key, required this.id});
  final String id;
  @override
  ConsumerState<ItineraryScreen> createState() => _ItineraryScreenState();
}

class _ItineraryScreenState extends ConsumerState<ItineraryScreen> {
  bool busy = false;

  Json _asPlan(Json it) {
    final days = (it['days'] as List).cast<Json>();
    return {
      'title': it['title'],
      'summary': it['summary'],
      'modeNote': it['generated_by'] == 'rules' || it['generated_by'] == 'curated' ? 'Built by WAYFARER\'s deterministic rules engine from stored records, not an AI model.' : null,
      'days': days,
      'assumptions': (it['assumptions'] as List?) ?? const [],
      'budget': {
        'lodgingUsd': 0, 'activitiesUsd': it['est_total_usd'], 'foodUsd': 0, 'transportUsd': 0, 'totalUsd': it['est_total_usd'], 'budgetUsd': it['budget_usd'],
        'withinBudget': it['budget_usd'] == null ? null : (it['est_total_usd'] as num) <= (it['budget_usd'] as num),
      },
      'destination': {'lat': it['dest_lat'], 'lng': it['dest_lng']},
    };
  }

  Future<void> _patchDay(Json it, int day, List<String> ids) async {
    setState(() => busy = true);
    try {
      await ref.read(apiProvider).patchJson('/itineraries/${widget.id}', body: {'days': [{'day': day, 'items': [for (final id in ids) {'attractionId': id}]}]});
      ref.invalidate(itineraryProvider(widget.id));
      ref.invalidate(itinerariesProvider);
    } catch (e) {
      if (mounted) showError(context, e);
    }
    if (mounted) setState(() => busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final res = ref.watch(itineraryProvider(widget.id));
    final me = ref.watch(authProvider).user;
    final money = ref.watch(moneyProvider);
    return AsyncView<Json>(
      value: res,
      onRetry: () => ref.invalidate(itineraryProvider(widget.id)),
      data: (it) {
        final mine = me != null && it['user_id'] == me['id'];
        final days = (it['days'] as List).cast<Json>();
        List<String> idsOf(int day) => (days[day - 1]['items'] as List).map((i) => (i as Json)['attractionId'] as String).toList();
        return ListView(children: [
          Constrained(
            maxWidth: 900,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  IconButton(tooltip: 'Back', onPressed: () => context.canPop() ? context.pop() : context.go('/trips'), icon: const Icon(Icons.arrow_back)),
                  Expanded(child: Text(it['destination_name'] as String, style: const TextStyle(color: Tokens.inkMuted))),
                  if (!mine)
                    FilledButton.icon(
                      onPressed: busy ? null : () async {
                        if (me == null) { context.push('/login?next=${Uri.encodeComponent('/trips/${widget.id}')}'); return; }
                        try {
                          final c = await ref.read(apiProvider).postJson('/itineraries/${widget.id}/copy');
                          ref.invalidate(itinerariesProvider);
                          if (context.mounted) context.go('/trips/${c['id']}');
                        } catch (e) { if (context.mounted) showError(context, e); }
                      },
                      icon: const Icon(Icons.copy_all_outlined),
                      label: const Text('Copy to my trips'),
                    ),
                  if (mine) ...[
                    OutlinedButton.icon(
                      onPressed: busy ? null : () async {
                        setState(() => busy = true);
                        try {
                          final r = await ref.read(apiProvider).postJson('/itineraries/${widget.id}/recalculate');
                          ref.invalidate(itineraryProvider(widget.id));
                          if (context.mounted) showInfo(context, 'Estimate recalculated: ${money(r['totalUsd'] as num)}');
                        } catch (e) { if (context.mounted) showError(context, e); }
                        if (mounted) setState(() => busy = false);
                      },
                      icon: const Icon(Icons.calculate_outlined),
                      label: const Text('Recalculate'),
                    ),
                    const SizedBox(width: 8),
                    IconButton(
                      tooltip: 'Delete trip',
                      onPressed: () async {
                        final ok = await confirm(context, title: 'Delete this trip?', message: 'This removes the itinerary from your account.', confirmLabel: 'Delete', destructive: true);
                        if (!ok) return;
                        await ref.read(apiProvider).delete('/itineraries/${widget.id}');
                        ref.invalidate(itinerariesProvider);
                        if (context.mounted) context.go('/trips');
                      },
                      icon: const Icon(Icons.delete_outline, color: Tokens.danger),
                    ),
                  ],
                ]),
                if (busy) const LinearProgressIndicator(),
                PlanView(
                  plan: _asPlan(it),
                  editing: mine,
                  onRemove: (day, i) {
                    final ids = idsOf(day)..removeAt(i);
                    _patchDay(it, day, ids);
                  },
                  onMove: (day, from, to) {
                    final ids = idsOf(day);
                    final x = ids.removeAt(from);
                    ids.insert(to, x);
                    _patchDay(it, day, ids);
                  },
                  onRegenerate: (day) async {
                    setState(() => busy = true);
                    try {
                      await ref.read(apiProvider).postJson('/itineraries/${widget.id}/generate', body: {'day': day});
                      ref.invalidate(itineraryProvider(widget.id));
                    } catch (e) { if (context.mounted) showError(context, e); }
                    if (mounted) setState(() => busy = false);
                  },
                ),
                if (mine)
                  Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: OutlinedButton.icon(
                      onPressed: () => _addStop(context, it, days),
                      icon: const Icon(Icons.add_location_alt_outlined),
                      label: const Text('Add or replace a stop'),
                    ),
                  ),
                const SizedBox(height: 48),
              ]),
            ),
          ),
        ]);
      },
    );
  }

  Future<void> _addStop(BuildContext context, Json it, List<Json> days) async {
    final slug = it['destination_slug'] as String;
    var day = 1;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (c) => StatefulBuilder(builder: (c, set) => Consumer(builder: (c, ref, _) {
        final places = ref.watch(destinationPlacesProvider((slug: slug, kind: null)));
        final money = ref.watch(moneyProvider);
        return DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.8,
          builder: (c, scroll) => Column(children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(children: [
                const Expanded(child: Text('Add a stop to day', style: TextStyle(fontWeight: FontWeight.w600))),
                DropdownButton<int>(value: day, items: [for (final d in days) DropdownMenuItem(value: d['day'] as int, child: Text('Day ${d['day']}'))], onChanged: (v) => set(() => day = v!)),
              ]),
            ),
            Expanded(
              child: AsyncView<Json>(
                value: places,
                data: (p) {
                  final items = (p['items'] as List).cast<Json>();
                  final used = {for (final d in days) for (final i in (d['items'] as List)) (i as Json)['attractionId']};
                  return ListView.builder(
                    controller: scroll,
                    padding: const EdgeInsets.all(16),
                    itemCount: items.length,
                    itemBuilder: (c, i) {
                      final pl = items[i];
                      final inTrip = used.contains(pl['id']);
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: PlaceTile(
                          pl,
                          trailing: inTrip ? const Pill('In trip') : IconButton(tooltip: 'Add to day $day', icon: const Icon(Icons.add_circle_outline), onPressed: () {
                            Navigator.pop(c);
                            final ids = (days[day - 1]['items'] as List).map((x) => (x as Json)['attractionId'] as String).toList()..add(pl['id'] as String);
                            _patchDay(it, day, ids);
                          }),
                        ),
                      );
                    },
                  );
                },
              ),
            ),
            SizedBox(height: 0, child: Text(money(0))),
          ]),
        );
      })),
    );
  }
}
