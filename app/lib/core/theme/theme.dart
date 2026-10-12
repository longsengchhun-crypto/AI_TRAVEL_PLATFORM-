import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// WAYFARER design tokens: warm ivory paper, ink text, forest-green primary, terracotta accent.
class Tokens {
  static const ivory = Color(0xFFFAF7F0);
  static const paper = Color(0xFFFFFFFF);
  static const sand = Color(0xFFF1ECE0);
  static const ink = Color(0xFF1E2421);
  static const inkMuted = Color(0xFF5E645E);
  static const border = Color(0xFFE2DCCD);
  static const forest = Color(0xFF2F5D50);
  static const forestDeep = Color(0xFF1F4036);
  static const terracotta = Color(0xFFB65F37);
  static const amber = Color(0xFFC9923A);
  static const danger = Color(0xFFB3382C);
  static const success = Color(0xFF2E7D4F);

  static const s1 = 4.0, s2 = 8.0, s3 = 12.0, s4 = 16.0, s5 = 24.0, s6 = 32.0, s7 = 48.0;
  static const radius = 10.0;
  static const maxContent = 1180.0;
}

class WayfarerTheme {
  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: Tokens.forest,
      brightness: Brightness.light,
    ).copyWith(
      primary: Tokens.forest,
      onPrimary: Colors.white,
      secondary: Tokens.terracotta,
      onSecondary: Colors.white,
      surface: Tokens.paper,
      onSurface: Tokens.ink,
      error: Tokens.danger,
      outline: Tokens.border,
      surfaceContainerHighest: Tokens.sand,
    );
    final base = ThemeData(useMaterial3: true, colorScheme: scheme, scaffoldBackgroundColor: Tokens.ivory);
    final text = GoogleFonts.interTextTheme(base.textTheme).apply(bodyColor: Tokens.ink, displayColor: Tokens.ink);
    final serif = GoogleFonts.fraunces; // editorial display face for headlines
    return base.copyWith(
      textTheme: text.copyWith(
        displaySmall: serif(textStyle: text.displaySmall, fontWeight: FontWeight.w600, letterSpacing: -0.5),
        headlineMedium: serif(textStyle: text.headlineMedium, fontWeight: FontWeight.w600, letterSpacing: -0.3),
        headlineSmall: serif(textStyle: text.headlineSmall, fontWeight: FontWeight.w600),
        titleLarge: text.titleLarge?.copyWith(fontWeight: FontWeight.w600),
        titleMedium: text.titleMedium?.copyWith(fontWeight: FontWeight.w600),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: Tokens.ivory,
        foregroundColor: Tokens.ink,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: text.titleLarge?.copyWith(fontWeight: FontWeight.w600),
      ),
      cardTheme: CardThemeData(
        color: Tokens.paper,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Tokens.radius),
          side: const BorderSide(color: Tokens.border),
        ),
      ),
      dividerTheme: const DividerThemeData(color: Tokens.border, space: 1, thickness: 1),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Tokens.paper,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(Tokens.radius), borderSide: const BorderSide(color: Tokens.border)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(Tokens.radius), borderSide: const BorderSide(color: Tokens.border)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(Tokens.radius), borderSide: const BorderSide(color: Tokens.forest, width: 2)),
        errorBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(Tokens.radius), borderSide: const BorderSide(color: Tokens.danger)),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(48, 48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Tokens.radius)),
          textStyle: const TextStyle(fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(48, 48),
          foregroundColor: Tokens.ink,
          side: const BorderSide(color: Tokens.border),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Tokens.radius)),
        ),
      ),
      chipTheme: base.chipTheme.copyWith(
        backgroundColor: Tokens.paper,
        selectedColor: Tokens.forest.withValues(alpha: 0.12),
        side: const BorderSide(color: Tokens.border),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
        labelStyle: text.bodyMedium,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: Tokens.paper,
        indicatorColor: Tokens.forest.withValues(alpha: 0.14),
        labelTextStyle: WidgetStatePropertyAll(text.labelMedium),
      ),
      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: Tokens.paper,
        indicatorColor: Tokens.forest.withValues(alpha: 0.14),
      ),
      snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    );
  }
}
