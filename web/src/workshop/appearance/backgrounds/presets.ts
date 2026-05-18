export const BACKGROUND_OPTIONS = [
  { id: "default",   label: "Studio",        blurb: "Sage mesh, warm lamp glow, slow drifting dust motes.",             glyph: "◇"  },
  { id: "paper",     label: "Warm paper",    blurb: "Notebook rules, ink washes, layered cream warmth.",               glyph: "✎"  },
  { id: "night",     label: "Night garden",  blurb: "Stars, moonward glow, deep borders.",                             glyph: "☽"  },
  { id: "forest",    label: "Deep forest",   blurb: "Fronds, pine needles, mossy depth.",                              glyph: "❧"  },
  { id: "dawn",      label: "Dawn blush",    blurb: "Rose sunbeams, haze bands, pearlescent highlights.",              glyph: "✦"  },
  { id: "slate",     label: "Cool slate",    blurb: "Hex mesh, cool haze, studio blue.",                               glyph: "⬡"  },
  { id: "stone",     label: "Marble study",  blurb: "Polished cool grey marble, soft white veining, quiet sheen.",     glyph: "◈"  },
  { id: "crimson",   label: "Crimson dusk",  blurb: "Slow ember drift, horizon glow, ash ribbons and sparks.",         glyph: "♦"  },
  { id: "ocean",     label: "Open ocean",    blurb: "Depth haze, caustic diamonds, kelp veils, rising bubbles.",       glyph: "≋"  },
  { id: "aurora",    label: "Aurora",        blurb: "Twin light-curtains, violet-mint wash, moving starfield.",        glyph: "✧"  },
  { id: "parchment", label: "Old parchment", blurb: "Laid fibers, foxing blooms, candlelit fold-shadows.",             glyph: "📜" },
  { id: "dusk",      label: "Amber dusk",    blurb: "Sun below the horizon, amber ember wash, long shadows.",          glyph: "☀"  },
  { id: "winter",    label: "Winter",        blurb: "Pale ice, crystalline lattice, cold silver light.",               glyph: "❄"  },
  { id: "autumn",    label: "Autumn",        blurb: "Amber afternoon, warm dark tones, falling leaves.",               glyph: "❦"  },
  { id: "spring",    label: "Spring",        blurb: "Cherry blossoms, fresh green, soft morning light.",               glyph: "✿"  },
  { id: "summer",    label: "Summer",        blurb: "Clear sky, golden sun, bright open air.",                         glyph: "⊙"  },
  { id: "rain",      label: "Rainy day",     blurb: "Streaking droplets, wet reflections, grey overcast.",             glyph: "⌁"  },
  { id: "park",      label: "Park afternoon",blurb: "Dappled light, green canopy, warm afternoon air.",                glyph: "⊛"  },
  { id: "dark",      label: "Dark",          blurb: "Word-style dark workspace: flat charcoal desk, page silhouette.", glyph: "■"  },
  { id: "custom",    label: "Custom",        blurb: "Your generated backdrop.",                                        glyph: "✦"  },
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
