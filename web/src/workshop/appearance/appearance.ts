import { tryLocalStorageSetItem } from "@/shared/platform/browser-storage";
import { STORAGE_KEY_APPEARANCE } from "@/shared/storage-keys";

export {
  POEM_FONT_OPTIONS,
  UI_FONT_OPTIONS,
  POEM_SIZE_OPTIONS,
  POEM_WEIGHT_OPTIONS,
  POEM_DECORATION_OPTIONS,
  type PoemFontId,
  type UiFontId,
  type PoemSizeId,
  type PoemWeightId,
  type PoemDecorationId,
} from "./fonts";

export {
  BACKGROUND_OPTIONS,
  type BackgroundId,
  type CustomBackgroundTheme,
} from "./backgrounds/presets";

import {
  POEM_FONT_OPTIONS,
  UI_FONT_OPTIONS,
  POEM_SIZE_OPTIONS,
  POEM_WEIGHT_OPTIONS,
  POEM_DECORATION_OPTIONS,
  type PoemFontId,
  type UiFontId,
  type PoemSizeId,
  type PoemWeightId,
  type PoemDecorationId,
} from "./fonts";

import {
  BACKGROUND_OPTIONS,
  type BackgroundId,
  type CustomBackgroundTheme,
  pickRandomFirstVisitBackground,
} from "./backgrounds/presets";

const STORAGE_KEY = STORAGE_KEY_APPEARANCE;

export type BackdropMotionSetting = "system" | "on" | "off";
export type BackdropPowerSetting = "off" | "low" | "very-low";

export interface AppearanceSettings {
  poemFont: PoemFontId;
  uiFont: UiFontId;
  background: BackgroundId;
  poemSize: PoemSizeId;
  poemWeight: PoemWeightId;
  poemDecoration: PoemDecorationId;
  /** Overrides animation preference. */
  backdropMotion: BackdropMotionSetting;
  /** Reduce paint complexity (fewer layers / less blend). */
  backdropPower: BackdropPowerSetting;
  /** User-generated custom backdrop (active when background === "custom"). */
  customBackground: CustomBackgroundTheme | null;
  /** Global color-intensity preset, applied as percentages (100 = neutral/unchanged). */
  colorSaturation: number;
  colorBrightness: number;
  colorContrast: number;
}

export const COLOR_INTENSITY_RANGE = {
  saturation: { min: 50, max: 160 },
  brightness: { min: 85, max: 115 },
  contrast: { min: 85, max: 120 },
} as const;

export interface ColorIntensityPreset {
  key: string;
  label: string;
  desc: string;
  saturation: number;
  brightness: number;
  contrast: number;
}

export const COLOR_INTENSITY_PRESETS: ColorIntensityPreset[] = [
  { key: "neutral", label: "Neutral", desc: "Unchanged — exactly as each theme was designed.", saturation: 100, brightness: 100, contrast: 100 },
  { key: "muted", label: "Muted", desc: "Softer, quieter colors — easier on the eyes for long sessions.", saturation: 91, brightness: 101, contrast: 96 },
  { key: "vivid", label: "Vivid", desc: "A touch richer, more saturated colors.", saturation: 112, brightness: 100, contrast: 103 },
  { key: "bold", label: "Bold", desc: "A little more punch on top of vivid color.", saturation: 108, brightness: 98, contrast: 108 },
];

const DEFAULTS: AppearanceSettings = {
  poemFont: "literata",
  uiFont: "dm-sans",
  background: "default",
  poemSize: "md",
  poemWeight: "normal",
  poemDecoration: "none",
  backdropMotion: "system",
  backdropPower: "low",
  customBackground: null,
  colorSaturation: 100,
  colorBrightness: 100,
  colorContrast: 100,
};

export function defaultAppearance(): AppearanceSettings {
  return { ...DEFAULTS };
}

function isPoemFontId(x: string): x is PoemFontId {
  return POEM_FONT_OPTIONS.some((o) => o.id === x);
}

function isUiFontId(x: string): x is UiFontId {
  return UI_FONT_OPTIONS.some((o) => o.id === x);
}

function isBackgroundId(x: string): x is BackgroundId {
  return BACKGROUND_OPTIONS.some((o) => o.id === x);
}

function isPoemSizeId(x: string): x is PoemSizeId {
  return POEM_SIZE_OPTIONS.some((o) => o.id === x);
}

function isPoemWeightId(x: string): x is PoemWeightId {
  return POEM_WEIGHT_OPTIONS.some((o) => o.id === x);
}

function isPoemDecorationId(x: string): x is PoemDecorationId {
  return POEM_DECORATION_OPTIONS.some((o) => o.id === x);
}

function isBackdropMotionSetting(x: string): x is BackdropMotionSetting {
  return x === "system" || x === "on" || x === "off";
}

function isBackdropPowerSetting(x: string): x is BackdropPowerSetting {
  return x === "off" || x === "low" || x === "very-low";
}

function loadColorIntensity(
  v: unknown,
  range: { min: number; max: number },
  fallback: number,
): number {
  if (typeof v !== "number" || Number.isNaN(v)) return fallback;
  return Math.min(range.max, Math.max(range.min, v));
}

function loadCustomBackground(v: unknown): CustomBackgroundTheme | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const fields = [
    "colorScheme", "label", "bg", "surface", "surface2", "border",
    "text", "muted", "accent", "ambientA", "ambientB", "ambientC",
    "ambientD", "shineTop", "shineMid", "netLine",
  ];
  if (!fields.every((k) => typeof o[k] === "string")) return null;
  if (o.colorScheme !== "light" && o.colorScheme !== "dark") return null;
  return o as unknown as CustomBackgroundTheme;
}

const APPEARANCE_SCHEMA_VERSION = 3;

export function loadAppearance(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS, background: pickRandomFirstVisitBackground() };
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object") return { ...DEFAULTS };
    const o = v as Record<string, unknown>;
    return {
      poemFont:
        typeof o.poemFont === "string" && isPoemFontId(o.poemFont)
          ? o.poemFont
          : DEFAULTS.poemFont,
      uiFont:
        typeof o.uiFont === "string" && isUiFontId(o.uiFont)
          ? o.uiFont
          : DEFAULTS.uiFont,
      background:
        typeof o.background === "string" && isBackgroundId(o.background)
          ? o.background
          : DEFAULTS.background,
      poemSize:
        typeof o.poemSize === "string" && isPoemSizeId(o.poemSize)
          ? o.poemSize
          : DEFAULTS.poemSize,
      poemWeight:
        typeof o.poemWeight === "string" && isPoemWeightId(o.poemWeight)
          ? o.poemWeight
          : DEFAULTS.poemWeight,
      poemDecoration:
        typeof o.poemDecoration === "string" && isPoemDecorationId(o.poemDecoration)
          ? o.poemDecoration
          : DEFAULTS.poemDecoration,
      backdropMotion:
        typeof o.backdropMotion === "string" && isBackdropMotionSetting(o.backdropMotion)
          ? o.backdropMotion
          : DEFAULTS.backdropMotion,
      backdropPower:
        typeof o.backdropPower === "string" && isBackdropPowerSetting(o.backdropPower)
          ? o.backdropPower
          : typeof o.lowPowerBackdrops === "boolean"
            ? (o.lowPowerBackdrops ? "low" : "off")
            : DEFAULTS.backdropPower,
      customBackground: loadCustomBackground(o.customBackground),
      colorSaturation: loadColorIntensity(
        o.colorSaturation, COLOR_INTENSITY_RANGE.saturation, DEFAULTS.colorSaturation,
      ),
      colorBrightness: loadColorIntensity(
        o.colorBrightness, COLOR_INTENSITY_RANGE.brightness, DEFAULTS.colorBrightness,
      ),
      colorContrast: loadColorIntensity(
        o.colorContrast, COLOR_INTENSITY_RANGE.contrast, DEFAULTS.colorContrast,
      ),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveAppearance(s: AppearanceSettings): boolean {
  return tryLocalStorageSetItem(
    STORAGE_KEY,
    JSON.stringify({ schemaVersion: APPEARANCE_SCHEMA_VERSION, ...s }),
  );
}

const POEM_SIZE_VAR: Record<PoemSizeId, string> = {
  xs: "0.95rem",
  sm: "1.075rem",
  md: "1.2rem",
  lg: "1.35rem",
  xl: "1.55rem",
};

const POEM_WEIGHT_VAR: Record<PoemWeightId, string> = {
  normal: "400",
  medium: "500",
  bold: "700",
};

let _lastBg: string | undefined;
let _customVarsApplied = false;

const CUSTOM_CSS_VARS = [
  "--bg", "--surface", "--surface-2", "--border", "--text", "--muted", "--accent",
  "--ambient-a", "--ambient-b", "--ambient-c", "--ambient-d",
  "--shine-top", "--shine-mid", "--net-line",
] as const;

function applyCustomVars(el: HTMLElement, cb: CustomBackgroundTheme): void {
  el.style.colorScheme = cb.colorScheme;
  el.style.setProperty("--bg", cb.bg);
  el.style.setProperty("--surface", cb.surface);
  el.style.setProperty("--surface-2", cb.surface2);
  el.style.setProperty("--border", cb.border);
  el.style.setProperty("--text", cb.text);
  el.style.setProperty("--muted", cb.muted);
  el.style.setProperty("--accent", cb.accent);
  el.style.setProperty("--ambient-a", cb.ambientA);
  el.style.setProperty("--ambient-b", cb.ambientB);
  el.style.setProperty("--ambient-c", cb.ambientC);
  el.style.setProperty("--ambient-d", cb.ambientD);
  el.style.setProperty("--shine-top", cb.shineTop);
  el.style.setProperty("--shine-mid", cb.shineMid);
  el.style.setProperty("--net-line", cb.netLine);
  _customVarsApplied = true;
}

function clearCustomVars(el: HTMLElement): void {
  if (!_customVarsApplied) return;
  el.style.colorScheme = "";
  CUSTOM_CSS_VARS.forEach((v) => el.style.removeProperty(v));
  _customVarsApplied = false;
}

export function applyAppearance(s: AppearanceSettings): void {
  const el = document.documentElement;
  el.dataset.poemFont = s.poemFont;
  el.dataset.uiFont = s.uiFont;

  const isCustomActive = s.background === "custom" && s.customBackground != null;
  if (isCustomActive) {
    applyCustomVars(el, s.customBackground!);
  } else {
    clearCustomVars(el);
  }

  const nextBg = s.background === "default" ? "" : s.background;
  if (_lastBg !== undefined && _lastBg !== nextBg) {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) {
      el.classList.add("theme-switching");
      requestAnimationFrame(() => {
        if (s.background === "default") delete el.dataset.workshopBg;
        else el.dataset.workshopBg = s.background;
        requestAnimationFrame(() => el.classList.remove("theme-switching"));
      });
    } else {
      if (s.background === "default") delete el.dataset.workshopBg;
      else el.dataset.workshopBg = s.background;
    }
  } else {
    if (s.background === "default") delete el.dataset.workshopBg;
    else el.dataset.workshopBg = s.background;
  }
  _lastBg = nextBg;
  if (s.backdropMotion === "system") delete el.dataset.backdropMotion;
  else el.dataset.backdropMotion = s.backdropMotion;
  if (s.backdropPower === "off") {
    el.removeAttribute("data-backdrop-low-power");
    delete el.dataset.backdropPower;
  } else {
    el.setAttribute("data-backdrop-low-power", "");
    el.dataset.backdropPower = s.backdropPower;
  }
  el.style.setProperty("--poem-font-size", POEM_SIZE_VAR[s.poemSize]);
  el.style.setProperty("--poem-font-weight", POEM_WEIGHT_VAR[s.poemWeight]);
  el.style.setProperty(
    "--poem-text-decoration",
    s.poemDecoration === "underline" ? "underline" : "none",
  );
  el.style.setProperty("--color-saturation", `${s.colorSaturation}%`);
  el.style.setProperty("--color-brightness", `${s.colorBrightness}%`);
  el.style.setProperty("--color-contrast", `${s.colorContrast}%`);
  // Gates the backdrop `filter` in index.css (applied to body::before/::after
  // directly — see the comment there for why not on body itself). Purely a
  // perf/no-op guard: only touch the property when a preset is actually
  // off-neutral.
  const isColorAdjusted =
    s.colorSaturation !== DEFAULTS.colorSaturation ||
    s.colorBrightness !== DEFAULTS.colorBrightness ||
    s.colorContrast !== DEFAULTS.colorContrast;
  if (isColorAdjusted) el.dataset.colorAdjusted = "";
  else delete el.dataset.colorAdjusted;
}
