export const POEM_FONT_OPTIONS = [
  { id: "literata",          label: "Literata",           fontFamily: '"Literata", Georgia, serif' },
  { id: "spectral",          label: "Spectral",           fontFamily: '"Spectral", Georgia, serif' },
  { id: "lora",              label: "Lora",               fontFamily: '"Lora", Georgia, serif' },
  { id: "crimson-pro",       label: "Crimson Pro",        fontFamily: '"Crimson Pro", Georgia, serif' },
  { id: "source-serif",      label: "Source Serif 4",     fontFamily: '"Source Serif 4", Georgia, serif' },
  { id: "eb-garamond",       label: "EB Garamond",        fontFamily: '"EB Garamond", Georgia, serif' },
  { id: "playfair",          label: "Playfair Display",   fontFamily: '"Playfair Display", Georgia, serif' },
  { id: "cormorant",         label: "Cormorant Garamond", fontFamily: '"Cormorant Garamond", Georgia, serif' },
  { id: "merriweather",      label: "Merriweather",       fontFamily: '"Merriweather", Georgia, serif' },
  { id: "alegreya",          label: "Alegreya",           fontFamily: '"Alegreya", Georgia, serif' },
  { id: "dm-serif",          label: "DM Serif Display",   fontFamily: '"DM Serif Display", Georgia, serif' },
  { id: "libre-baskerville", label: "Libre Baskerville",  fontFamily: '"Libre Baskerville", Georgia, serif' },
] as const;

export const UI_FONT_OPTIONS = [
  { id: "dm-sans",     label: "DM Sans",       fontFamily: '"DM Sans", "Segoe UI", system-ui, sans-serif' },
  { id: "source-sans", label: "Source Sans 3", fontFamily: '"Source Sans 3", "Segoe UI", system-ui, sans-serif' },
  { id: "inter",       label: "Inter",         fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif' },
  { id: "nunito",      label: "Nunito",        fontFamily: '"Nunito", "Segoe UI", system-ui, sans-serif' },
  { id: "system",      label: "System UI",     fontFamily: 'system-ui, "Segoe UI", sans-serif' },
] as const;

export const POEM_SIZE_OPTIONS = [
  { id: "sm", label: "Small" },
  { id: "md", label: "Medium" },
  { id: "lg", label: "Large" },
  { id: "xl", label: "Extra Large" },
] as const;

export const POEM_WEIGHT_OPTIONS = [
  { id: "normal", label: "Regular" },
  { id: "medium", label: "Medium" },
  { id: "bold",   label: "Bold" },
] as const;

export const POEM_DECORATION_OPTIONS = [
  { id: "none",      label: "None" },
  { id: "underline", label: "Underline" },
] as const;

export type PoemFontId      = (typeof POEM_FONT_OPTIONS)[number]["id"];
export type UiFontId        = (typeof UI_FONT_OPTIONS)[number]["id"];
export type PoemSizeId      = (typeof POEM_SIZE_OPTIONS)[number]["id"];
export type PoemWeightId    = (typeof POEM_WEIGHT_OPTIONS)[number]["id"];
export type PoemDecorationId = (typeof POEM_DECORATION_OPTIONS)[number]["id"];
