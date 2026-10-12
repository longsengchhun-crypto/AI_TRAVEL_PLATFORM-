import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/data/providers.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/theme.dart';
import '../../core/widgets/widgets.dart';

class _Msg {
  _Msg(this.fromUser, this.text, {this.sources = const [], this.mode, this.grounded = true, this.disclaimer});
  final bool fromUser;
  final String text;
  final List<Json> sources;
  final String? mode;
  final bool grounded;
  final String? disclaimer;
}

/// Travel knowledge assistant (retrieval-augmented). Always shows where an answer came from.
class AssistantScreen extends ConsumerStatefulWidget {
  const AssistantScreen({super.key, this.initialQuestion, this.destination});
  final String? initialQuestion, destination;
  @override
  ConsumerState<AssistantScreen> createState() => _AssistantScreenState();
}

class _AssistantScreenState extends ConsumerState<AssistantScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final List<_Msg> msgs = [];
  bool busy = false;

  static const suggestions = [
    'What should I wear when visiting temples?',
    'How does free cancellation work?',
    'How do I get around Phnom Penh?',
    'How should I plan my Angkor visit?',
    'What currency should I carry in Cambodia?',
  ];

  @override
  void initState() {
    super.initState();
    if (widget.initialQuestion != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _ask(widget.initialQuestion!));
    }
  }

  Future<void> _ask(String q) async {
    q = q.trim();
    if (q.length < 3 || busy) return;
    setState(() { msgs.add(_Msg(true, q)); busy = true; _input.clear(); });
    try {
      final r = await ref.read(apiProvider).postJson('/ai/assistant', body: {'question': q, if (widget.destination != null) 'destination': widget.destination});
      msgs.add(_Msg(false, r['answer'] as String, sources: (r['sources'] as List).cast<Json>(), mode: r['mode'] as String?, grounded: r['grounded'] == true, disclaimer: r['disclaimer'] as String?));
    } catch (e) {
      msgs.add(_Msg(false, e is ApiException ? e.message : 'Something went wrong.', grounded: false));
    }
    if (!mounted) return;
    setState(() => busy = false);
    await Future<void>.delayed(const Duration(milliseconds: 50));
    if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
  }

  @override
  Widget build(BuildContext context) {
    final status = ref.watch(aiStatusProvider).value;
    return Column(children: [
      Expanded(
        child: ListView(controller: _scroll, children: [
          Constrained(
            maxWidth: 820,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Travel guide assistant', style: Theme.of(context).textTheme.headlineMedium),
                const SizedBox(height: 8),
                const Text('Ask about destinations, transport, etiquette or booking policies. Answers come from WAYFARER\'s approved guides and always show their sources.', style: TextStyle(color: Tokens.inkMuted, height: 1.4)),
                if (status != null) Padding(padding: const EdgeInsets.only(top: 12), child: Pill(status['assistantMode'] == 'llm' ? 'Language model + retrieval' : 'Retrieval only: passages quoted from stored guides', icon: Icons.menu_book_outlined, color: Tokens.terracotta)),
                const SizedBox(height: 16),
                if (msgs.isEmpty) Wrap(spacing: 8, runSpacing: 8, children: [for (final s in suggestions) ActionChip(label: Text(s), onPressed: () => _ask(s))]),
                for (final m in msgs) _bubble(context, m),
                if (busy) const Padding(padding: EdgeInsets.all(12), child: Row(children: [SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)), SizedBox(width: 10), Text('Searching the guides…')])),
              ]),
            ),
          ),
        ]),
      ),
      Container(
        decoration: const BoxDecoration(color: Tokens.paper, border: Border(top: BorderSide(color: Tokens.border))),
        child: SafeArea(
          top: false,
          child: Constrained(
            maxWidth: 820,
            padding: const EdgeInsets.all(12),
            child: Row(children: [
              Expanded(
                child: TextField(
                  controller: _input,
                  maxLength: 500,
                  buildCounter: (_, {required currentLength, required isFocused, maxLength}) => null,
                  textInputAction: TextInputAction.send,
                  onSubmitted: _ask,
                  decoration: const InputDecoration(hintText: 'Ask a travel question'),
                ),
              ),
              const SizedBox(width: 8),
              IconButton.filled(tooltip: 'Send', onPressed: busy ? null : () => _ask(_input.text), icon: const Icon(Icons.arrow_upward)),
            ]),
          ),
        ),
      ),
    ]);
  }

  Widget _bubble(BuildContext context, _Msg m) {
    if (m.fromUser) {
      return Align(
        alignment: Alignment.centerRight,
        child: Container(
          margin: const EdgeInsets.only(top: 12, left: 48),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: Tokens.forest, borderRadius: BorderRadius.circular(12)),
          child: Text(m.text, style: const TextStyle(color: Colors.white)),
        ),
      );
    }
    return Container(
      margin: const EdgeInsets.only(top: 12, right: 24),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: Tokens.paper, border: Border.all(color: Tokens.border), borderRadius: BorderRadius.circular(12)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SelectableText(m.text, style: const TextStyle(height: 1.5)),
        if (!m.grounded && m.sources.isEmpty) const Padding(padding: EdgeInsets.only(top: 8), child: Pill('Not in approved guides', color: Tokens.terracotta, icon: Icons.help_outline)),
        if (m.sources.isNotEmpty) ...[
          const SizedBox(height: 12),
          const Text('Sources', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 12, color: Tokens.inkMuted)),
          const SizedBox(height: 4),
          for (final (i, s) in m.sources.indexed)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text('[${i + 1}] ${s['title']} · ${s['source']}${s['isDemo'] == true ? ' (demo content)' : ''}', style: const TextStyle(fontSize: 12, color: Tokens.inkMuted)),
            ),
        ],
        if (m.disclaimer != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(m.disclaimer!, style: const TextStyle(fontSize: 11, color: Tokens.inkMuted))),
      ]),
    );
  }
}
