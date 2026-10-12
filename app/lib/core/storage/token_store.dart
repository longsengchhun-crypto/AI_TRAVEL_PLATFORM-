import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Access/refresh token persistence. Uses the platform keystore on mobile (Keychain / EncryptedSharedPreferences).
class TokenStore {
  TokenStore({FlutterSecureStorage? storage}) : _s = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _s;
  String? _accessCache;
  String? _refreshCache;
  bool _loaded = false;

  Future<void> _load() async {
    if (_loaded) return;
    try {
      _accessCache = await _s.read(key: 'wf_access');
      _refreshCache = await _s.read(key: 'wf_refresh');
    } catch (_) {
      // Storage can be unavailable (private windows, locked keystores): behave as signed out.
    }
    _loaded = true;
  }

  Future<String?> access() async {
    await _load();
    return _accessCache;
  }

  Future<String?> refresh() async {
    await _load();
    return _refreshCache;
  }

  Future<void> save(String access, String refresh) async {
    _accessCache = access;
    _refreshCache = refresh;
    _loaded = true;
    try {
      await _s.write(key: 'wf_access', value: access);
      await _s.write(key: 'wf_refresh', value: refresh);
    } catch (_) {}
  }

  Future<void> clear() async {
    _accessCache = null;
    _refreshCache = null;
    _loaded = true;
    try {
      await _s.delete(key: 'wf_access');
      await _s.delete(key: 'wf_refresh');
    } catch (_) {}
  }
}
