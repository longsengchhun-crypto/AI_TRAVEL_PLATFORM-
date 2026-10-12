import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';

/// Holds the signed-in user (or null). Tokens live in [TokenStore].
class AuthController extends AsyncNotifier<Json?> {
  @override
  Future<Json?> build() async {
    ref.read(sessionExpiredProvider.notifier).state = () => state = const AsyncData(null);
    final token = await ref.read(tokenStoreProvider).access();
    if (token == null) return null;
    try {
      return await ref.read(apiProvider).getJson('/users/me');
    } on ApiException catch (e) {
      if (e.isNetwork) rethrow; // keep tokens; let the UI offer a retry
      await ref.read(tokenStoreProvider).clear();
      return null;
    }
  }

  Future<void> login(String email, String password) async {
    final r = await ref.read(apiProvider).postJson('/auth/login', body: {'email': email, 'password': password});
    await _accept(r);
  }

  Future<void> register(String name, String email, String password) async {
    final r = await ref.read(apiProvider).postJson('/auth/register', body: {'name': name, 'email': email, 'password': password});
    await _accept(r);
  }

  Future<void> _accept(Json r) async {
    await ref.read(tokenStoreProvider).save(r['accessToken'] as String, r['refreshToken'] as String);
    state = AsyncData(r['user'] as Json);
  }

  Future<void> logout() async {
    final store = ref.read(tokenStoreProvider);
    final rt = await store.refresh();
    if (rt != null) {
      try {
        await ref.read(apiProvider).postEmpty('/auth/logout', body: {'refreshToken': rt});
      } catch (_) {}
    }
    await store.clear();
    state = const AsyncData(null);
  }

  Future<void> updateProfile({String? name, String? phone, String? currency}) async {
    final r = await ref.read(apiProvider).patchJson('/users/me', body: {
      'name': ?name,
      'phone': ?phone,
      'preferredCurrency': ?currency,
    });
    state = AsyncData(r);
  }
}

final authProvider = AsyncNotifierProvider<AuthController, Json?>(AuthController.new);

extension AuthX on AsyncValue<Json?> {
  Json? get user => value;
  bool get signedIn => value != null;
  String get role => (value?['role'] ?? 'guest').toString();
  bool get isStaff => role == 'admin' || role == 'staff';
  bool get isPartner => role == 'partner';
}
