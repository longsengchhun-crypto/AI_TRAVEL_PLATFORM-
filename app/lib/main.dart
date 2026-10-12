import 'package:flutter/material.dart';
import 'package:flutter_web_plugins/url_strategy.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/router.dart';
import 'core/theme/theme.dart';

void main() {
  usePathUrlStrategy(); // clean URLs on web; Vercel rewrites unknown paths to index.html
  runApp(const ProviderScope(child: WayfarerApp()));
}

class WayfarerApp extends ConsumerWidget {
  const WayfarerApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'WAYFARER – Travel, hotels and trip planning',
      debugShowCheckedModeBanner: false,
      theme: WayfarerTheme.light(),
      routerConfig: ref.watch(routerProvider),
    );
  }
}
