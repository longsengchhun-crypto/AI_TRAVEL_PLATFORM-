import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';

import '../config/env.dart';
import '../storage/token_store.dart';

typedef Json = Map<String, dynamic>;

/// User-facing API failure with a machine-readable code.
class ApiException implements Exception {
  ApiException(this.message, {this.code = 'UNKNOWN', this.status, this.details});
  final String message;
  final String code;
  final int? status;
  final dynamic details;

  bool get isNetwork => code == 'NETWORK';
  bool get isUnauthorized => status == 401;
  @override
  String toString() => message;
}

ApiException _toException(DioException e) {
  final data = e.response?.data;
  if (data is Map && data['error'] is Map) {
    final err = data['error'] as Map;
    return ApiException(
      (err['message'] ?? 'Something went wrong').toString(),
      code: (err['code'] ?? 'UNKNOWN').toString(),
      status: e.response?.statusCode,
      details: err['details'],
    );
  }
  switch (e.type) {
    case DioExceptionType.connectionTimeout:
    case DioExceptionType.receiveTimeout:
    case DioExceptionType.sendTimeout:
      return ApiException('The server took too long to respond. Check your connection and try again.', code: 'NETWORK');
    case DioExceptionType.connectionError:
      return ApiException('You appear to be offline, or the server is unreachable.', code: 'NETWORK');
    case DioExceptionType.cancel:
      return ApiException('Request cancelled.', code: 'CANCELLED');
    default:
      return ApiException('Unexpected error (${e.response?.statusCode ?? 'no response'}).', status: e.response?.statusCode);
  }
}

/// Thin, typed wrapper over Dio: auth header, one-shot refresh on 401, uniform errors.
class ApiClient {
  ApiClient(this._tokens, {this._onSessionExpired, String? baseUrl})
      : _dio = Dio(BaseOptions(
          baseUrl: baseUrl ?? Env.apiBaseUrl,
          connectTimeout: const Duration(seconds: 12),
          receiveTimeout: const Duration(seconds: 30),
          headers: {'Accept': 'application/json'},
        )) {
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (o, h) async {
        final t = await _tokens.access();
        if (t != null && !o.headers.containsKey('Authorization')) o.headers['Authorization'] = 'Bearer $t';
        h.next(o);
      },
      onError: (e, h) async {
        final isAuthCall = e.requestOptions.path.startsWith('/auth/');
        if (e.response?.statusCode == 401 && !isAuthCall && e.requestOptions.extra['retried'] != true) {
          final ok = await _refresh();
          if (ok) {
            final req = e.requestOptions..extra['retried'] = true;
            req.headers.remove('Authorization');
            try {
              h.resolve(await _dio.fetch(req));
              return;
            } on DioException catch (e2) {
              return h.next(e2);
            }
          } else {
            _onSessionExpired?.call();
          }
        }
        h.next(e);
      },
    ));
  }

  final TokenStore _tokens;
  final Dio _dio;
  final void Function()? _onSessionExpired;
  Completer<bool>? _refreshing;

  Future<bool> _refresh() {
    if (_refreshing != null) return _refreshing!.future;
    final c = _refreshing = Completer<bool>();
    () async {
      try {
        final rt = await _tokens.refresh();
        if (rt == null) return c.complete(false);
        final r = await Dio(BaseOptions(baseUrl: _dio.options.baseUrl)).post('/auth/refresh', data: {'refreshToken': rt});
        await _tokens.save(r.data['accessToken'] as String, r.data['refreshToken'] as String);
        c.complete(true);
      } catch (_) {
        await _tokens.clear();
        c.complete(false);
      } finally {
        _refreshing = null;
      }
    }();
    return c.future;
  }

  Future<T> _wrap<T>(Future<Response<dynamic>> Function() call) async {
    try {
      final r = await call();
      return r.data as T;
    } on DioException catch (e) {
      throw _toException(e);
    }
  }

  Future<Json> getJson(String path, {Json? query, CancelToken? cancel}) => _wrap<Json>(() => _dio.get(path, queryParameters: _clean(query), cancelToken: cancel));
  Future<Json> postJson(String path, {Object? body}) => _wrap<Json>(() => _dio.post(path, data: body ?? {}));
  Future<Json> patchJson(String path, {Object? body}) => _wrap<Json>(() => _dio.patch(path, data: body ?? {}));
  Future<Json> putJson(String path, {Object? body}) => _wrap<Json>(() => _dio.put(path, data: body ?? {}));
  Future<void> delete(String path) async {
    try {
      await _dio.delete(path);
    } on DioException catch (e) {
      throw _toException(e);
    }
  }

  Future<void> putEmpty(String path) async {
    try {
      await _dio.put(path);
    } on DioException catch (e) {
      throw _toException(e);
    }
  }

  Future<void> postEmpty(String path, {Object? body}) async {
    try {
      await _dio.post(path, data: body ?? {});
    } on DioException catch (e) {
      throw _toException(e);
    }
  }

  Future<void> patchEmpty(String path, {Object? body}) async {
    try {
      await _dio.patch(path, data: body ?? {});
    } on DioException catch (e) {
      throw _toException(e);
    }
  }

  static Json? _clean(Json? q) {
    if (q == null) return null;
    final out = <String, dynamic>{};
    q.forEach((k, v) {
      if (v == null) return;
      if (v is String && v.isEmpty) return;
      if (v is List) {
        if (v.isEmpty) return;
        out[k] = v.join(',');
      } else {
        out[k] = v;
      }
    });
    return out;
  }
}

final tokenStoreProvider = Provider<TokenStore>((ref) => TokenStore());

/// Set by the auth controller so the client can sign the user out when refresh fails.
final sessionExpiredProvider = StateProvider<void Function()?>((ref) => null);

final apiProvider = Provider<ApiClient>((ref) {
  return ApiClient(ref.watch(tokenStoreProvider), onSessionExpired: () => ref.read(sessionExpiredProvider)?.call());
});
