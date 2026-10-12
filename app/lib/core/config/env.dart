/// Build-time configuration. Override with --dart-define=API_BASE_URL=https://host/api
class Env {
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://wayfarer-api-liart.vercel.app/api',
  );
  static const mapsApiKey = String.fromEnvironment('MAPS_API_KEY');
  static const appName = 'WAYFARER';
}
