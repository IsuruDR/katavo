/**
 * Design tokens for Katavo. Single source of truth for color, space, type,
 * motion. Components import from here directly; no theme provider yet.
 *
 * Design system: warm paper + ink + ink-stamp green.
 * Editorial restraint, type-led hierarchy, no chrome.
 *
 * Type pairing: IBM Plex Serif (display) + IBM Plex Sans (UI).
 * Loaded in app/_layout.tsx via @expo-google-fonts.
 *
 * OKLCH targets converted to hex for RN compatibility:
 *   paper        oklch(0.985 0.005 80)
 *   ink          oklch(0.18  0.01  240)
 *   inkSecondary oklch(0.55  0.005 240)
 *   hairline     oklch(0.92  0.005 80)
 *   accent       oklch(0.36  0.06  160)
 *   warning      oklch(0.50  0.10  30)
 */

export const color = {
  paper: "#FBF8F1",
  paperWarm: "#F4EFE3",
  ink: "#1A1B1F",
  inkSecondary: "#84858C",
  inkTertiary: "#B8B7B0",
  hairline: "#E8E2D2",
  hairlineStrong: "#D9D2BE",
  accent: "#2D5040",
  accentSoft: "rgba(45, 80, 64, 0.08)",
  warning: "#8C4A3D",
  warningSoft: "rgba(140, 74, 61, 0.10)",
} as const;

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  huge: 64,
  giant: 96,
} as const;

export const radius = {
  sm: 6,
  md: 12,
  pill: 999,
  circle: 999,
} as const;

export const motion = {
  fast: 100,
  base: 150,
  slow: 300,
  ambient: 1600,
  easing: {
    out: [0.22, 1, 0.36, 1] as const,
    inOut: [0.65, 0, 0.35, 1] as const,
  },
} as const;

export const font = {
  serifRegular: "IBMPlexSerif_400Regular",
  serifMedium: "IBMPlexSerif_500Medium",
  serifSemiBold: "IBMPlexSerif_600SemiBold",
  serifBold: "IBMPlexSerif_700Bold",
  sansRegular: "IBMPlexSans_400Regular",
  sansMedium: "IBMPlexSans_500Medium",
  sansSemiBold: "IBMPlexSans_600SemiBold",
  sansBold: "IBMPlexSans_700Bold",
} as const;

export const text = {
  // Editorial display — page-level titles, hero typography
  displaySerif: {
    fontFamily: font.serifBold,
    fontSize: 32,
    lineHeight: 38,
    color: color.ink,
    letterSpacing: -0.4,
  },
  // Editorial title — content row titles, screen titles
  titleSerif: {
    fontFamily: font.serifSemiBold,
    fontSize: 19,
    lineHeight: 26,
    color: color.ink,
    letterSpacing: -0.2,
  },
  // Sans display — used sparingly when serif feels wrong
  displaySans: {
    fontFamily: font.sansBold,
    fontSize: 28,
    lineHeight: 36,
    color: color.ink,
    letterSpacing: -0.3,
  },
  // Body — primary UI text
  body: {
    fontFamily: font.sansMedium,
    fontSize: 16,
    lineHeight: 24,
    color: color.ink,
  },
  bodyRegular: {
    fontFamily: font.sansRegular,
    fontSize: 16,
    lineHeight: 24,
    color: color.ink,
  },
  bodySmall: {
    fontFamily: font.sansRegular,
    fontSize: 14,
    lineHeight: 20,
    color: color.inkSecondary,
  },
  // Mono — timestamps, durations, technical figures
  mono: {
    fontFamily: font.sansMedium,
    fontSize: 14,
    lineHeight: 20,
    fontVariant: ["tabular-nums" as const],
    color: color.inkSecondary,
  },
  // Caption — overlines, eyebrow labels
  caption: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    lineHeight: 14,
    color: color.inkSecondary,
    letterSpacing: 0.6,
    textTransform: "uppercase" as const,
  },
  // Button — labels on primary CTAs
  button: {
    fontFamily: font.sansSemiBold,
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: -0.1,
  },
} as const;

export const layout = {
  rowMinHeight: 64,
  hitSlop: { top: 12, bottom: 12, left: 12, right: 12 },
  safeAreaTopPadding: 56,
} as const;
