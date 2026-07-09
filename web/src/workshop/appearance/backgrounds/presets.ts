export const BACKGROUND_OPTIONS = [
  { id: "default",   label: "Studio",         glyph: "◇"  },
  { id: "paper",     label: "Warm paper",     glyph: "✎"  },
  { id: "night",     label: "Night garden",   glyph: "☽"  },
  { id: "forest",    label: "Deep forest",    glyph: "❧"  },
  { id: "dawn",      label: "Dawn blush",     glyph: "✦"  },
  { id: "ocean",     label: "Open ocean",     glyph: "≋"  },
  { id: "aurora",    label: "Aurora",         glyph: "✧"  },
  { id: "parchment", label: "Old parchment",  glyph: "📜" },
  { id: "dusk",      label: "Amber dusk",     glyph: "☀"  },
  { id: "winter",    label: "Winter",         glyph: "❄"  },
  { id: "autumn",    label: "Autumn",         glyph: "❦"  },
  { id: "spring",    label: "Spring",         glyph: "✿"  },
  { id: "summer",    label: "Summer",         glyph: "⊙"  },
  { id: "rain",      label: "Rainy day",      glyph: "⌁"  },
  { id: "park",      label: "Park afternoon", glyph: "⊛"  },
  { id: "dark",      label: "Dark",           glyph: "■"  },
  { id: "custom",    label: "Custom",         glyph: "✦"  },
] as const;

export type BackgroundId = (typeof BACKGROUND_OPTIONS)[number]["id"];

/** CSS variable values for a user-generated custom backdrop. */
export interface CustomBackgroundTheme {
  colorScheme: "light" | "dark";
  label: string;
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  ambientA: string;
  ambientB: string;
  ambientC: string;
  ambientD: string;
  shineTop: string;
  shineMid: string;
  netLine: string;
}

/** Curated backgrounds shown at random to first-time visitors. */
export const RANDOM_FIRST_VISIT_BACKGROUNDS: BackgroundId[] = [
  "aurora", "night", "forest", "ocean", "parchment",
  "dusk", "winter", "autumn", "rain", "dawn",
];

export function pickRandomFirstVisitBackground(): BackgroundId {
  const idx = Math.floor(Math.random() * RANDOM_FIRST_VISIT_BACKGROUNDS.length);
  return RANDOM_FIRST_VISIT_BACKGROUNDS[idx]!;
}
