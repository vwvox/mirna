import {
  DesignControl,
  DesignRadius,
  DesignSpacing,
  DesignTypography,
} from "@anlg/design-system";

// Mirna palette. The shared design system keeps desktop's neutral tokens; the
// phone app uses the brand colours directly.
export const MirnaColors = {
  serra: "#2E4A3B",
  sage: "#A9B8A3",
  terra: "#B4532F",
  ipe: "#E3B23C",
  mist: "#F5F3EC",
  paper: "#FBFAF6",
  moss: "#DCE3D6",
  soapstone: "#2F3431",
} as const;

export const Colors = {
  background: MirnaColors.paper,
  brandBackgroundTop: MirnaColors.paper,
  brandBackgroundBottom: MirnaColors.mist,
  paper: MirnaColors.paper,
  surface: "#FFFFFF",
  ink: MirnaColors.soapstone,
  inkInverse: MirnaColors.paper,
  primary: MirnaColors.serra,
  primaryForeground: MirnaColors.paper,
  secondary: MirnaColors.mist,
  mutedSurface: MirnaColors.mist,
  muted: "#5F6A63",
  accentSurface: MirnaColors.moss,
  border: "#E2E0D6",
  accent: MirnaColors.terra,
  highlight: MirnaColors.ipe,
  destructive: MirnaColors.terra,
  destructiveForeground: MirnaColors.paper,
  alert: "#F7E9E2",
  alertForeground: "#8F3D20",
  alertBorder: "#EBCBBC",
  scrim: "rgba(47, 52, 49, 0.32)",
};
export type ColorPalette = { [K in keyof typeof Colors]: string };

export const DarkColors: ColorPalette = {
  background: "#1A1F1C",
  brandBackgroundTop: "#1A1F1C",
  brandBackgroundBottom: "#1A1F1C",
  paper: "#1A1F1C",
  surface: "#232A26",
  ink: "#F1EFE8",
  inkInverse: "#1A1F1C",
  primary: MirnaColors.sage,
  primaryForeground: "#1A1F1C",
  secondary: "#2B332E",
  mutedSurface: "#2B332E",
  muted: "#A3ACA5",
  accentSurface: "#2F3A33",
  border: "#38423C",
  accent: "#D97F5A",
  highlight: MirnaColors.ipe,
  destructive: "#D97F5A",
  destructiveForeground: "#1A1F1C",
  alert: "#3A2219",
  alertForeground: "#F0A98C",
  alertBorder: "#5C3324",
  scrim: "rgba(0, 0, 0, 0.5)",
};

export const Gradients = {
  brandBackground: `linear-gradient(to bottom, ${MirnaColors.paper} 0%, ${MirnaColors.mist} 100%)`,
} as const;

export const Spacing = {
  xs: DesignSpacing.xs,
  sm: DesignSpacing.sm,
  md: DesignSpacing.lg,
  lg: DesignSpacing.xl,
  xl: DesignSpacing.xxl,
  compact: DesignSpacing.md,
  roomy: DesignSpacing.xxxl,
} as const;

export const Radius = {
  card: DesignRadius.xl,
  control: DesignRadius.lg,
  panel: DesignRadius.panel,
  sheet: DesignRadius.sheet,
  pill: DesignRadius.pill,
} as const;

export const CornerCurve = {
  squircle: "continuous",
} as const;

// Fonts are embedded at build time by the expo-font config plugin (app.json);
// nothing is downloaded at runtime. Family names match the font files on iOS
// and the XML font families on Android.
export const FontFamily = {
  heading: "Fraunces",
  text: "Figtree",
  mono: "IBM Plex Mono",
} as const;

export const Typography = {
  largeTitle: {
    ...DesignTypography.largeTitle,
    fontFamily: FontFamily.heading,
    fontWeight: "600",
    letterSpacing: -0.4,
  },
  title: {
    ...DesignTypography.title,
    fontFamily: FontFamily.heading,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  section: {
    ...DesignTypography.section,
    fontFamily: FontFamily.heading,
    fontWeight: "600",
  },
  body: { ...DesignTypography.body, fontFamily: FontFamily.text },
  bodyStrong: { ...DesignTypography.bodyStrong, fontFamily: FontFamily.text },
  label: { ...DesignTypography.label, fontFamily: FontFamily.text },
  caption: { ...DesignTypography.caption, fontFamily: FontFamily.text },
  captionStrong: {
    ...DesignTypography.captionStrong,
    fontFamily: FontFamily.text,
  },
  // Times and durations.
  time: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "400",
    fontFamily: FontFamily.mono,
  },
  // The in-app "mirna" wordmark. Never shown next to the app icon.
  wordmark: {
    fontSize: 44,
    lineHeight: 52,
    fontWeight: "600",
    letterSpacing: -0.5,
    fontFamily: FontFamily.heading,
  },
} as const;
export const ControlSize = DesignControl;

export const LISTENING_CONTROL_HEIGHT = DesignControl.listening;
export const LISTENING_CONTROL_RADIUS = DesignRadius.panel;
