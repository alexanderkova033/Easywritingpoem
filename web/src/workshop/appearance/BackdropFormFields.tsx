import type {
  AppearanceSettings,
  BackdropMotionSetting,
  BackdropPowerSetting,
} from "./appearance";
import "./BackdropFormFields.css";

type QualityId = "light" | "balanced" | "full";

interface QualityPreset {
  id: QualityId;
  glyph: string;
  label: string;
  sub: string;
  hint: string;
  power: BackdropPowerSetting;
  motion: BackdropMotionSetting;
}

const QUALITY_PRESETS: QualityPreset[] = [
  {
    id: "light",
    glyph: "⚡",
    label: "Light",
    sub: "Easiest on battery",
    hint: "Calm, static backdrop. Best for laptops, older devices, or long sessions.",
    power: "very-low",
    motion: "off",
  },
  {
    id: "balanced",
    glyph: "◐",
    label: "Balanced",
    sub: "Recommended",
    hint: "Softened effects with gentle motion. Follows your system reduce-motion setting.",
    power: "low",
    motion: "system",
  },
  {
    id: "full",
    glyph: "✦",
    label: "Full",
    sub: "Most beautiful",
    hint: "Every layer, every animation. Uses more GPU.",
    power: "off",
    motion: "on",
  },
];

function detectQuality(
  power: BackdropPowerSetting,
  motion: BackdropMotionSetting,
): QualityId {
  const match = QUALITY_PRESETS.find(
    (p) => p.power === power && p.motion === motion,
  );
  if (match) return match.id;
  if (power === "very-low" || motion === "off") return "light";
  if (power === "low") return "balanced";
  return "full";
}

export function BackdropFormFields(props: {
  appearance: AppearanceSettings;
  onChange: (next: AppearanceSettings) => void;
}) {
  const { appearance, onChange } = props;
  const active = detectQuality(appearance.backdropPower, appearance.backdropMotion);
  const activePreset = QUALITY_PRESETS.find((p) => p.id === active)!;

  const selectQuality = (preset: QualityPreset) => {
    onChange({
      ...appearance,
      backdropPower: preset.power,
      backdropMotion: preset.motion,
    });
  };

  return (
    <div className="perf-panel" role="group" aria-label="Performance">
      <div className="perf-panel-head">
        <span className="perf-panel-icon" aria-hidden="true">⚡</span>
        <div className="perf-panel-heading">
          <h3 className="perf-panel-title">Performance</h3>
          <p className="perf-panel-sub">
            Lower the visual load if scrolling stutters, the fan kicks in, or
            you’re on battery.
          </p>
        </div>
      </div>

      <div
        className="perf-quality"
        role="radiogroup"
        aria-label="Visual quality"
      >
        {QUALITY_PRESETS.map((p) => {
          const selected = p.id === active;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`perf-quality-tile${selected ? " is-selected" : ""}`}
              onClick={() => selectQuality(p)}
              title={p.hint}
            >
              <span className={`perf-quality-swatch perf-quality-swatch--${p.id}`} aria-hidden="true">
                <span className="perf-quality-glyph">{p.glyph}</span>
              </span>
              <span className="perf-quality-text">
                <span className="perf-quality-label">{p.label}</span>
                <span className="perf-quality-sub">{p.sub}</span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="perf-quality-hint">{activePreset.hint}</p>
    </div>
  );
}

export function BackdropMotionToggle(props: {
  appearance: AppearanceSettings;
  onChange: (next: AppearanceSettings) => void;
}) {
  const { appearance, onChange } = props;
  const motionOn = appearance.backdropMotion !== "off";
  const toggleMotion = () => {
    onChange({
      ...appearance,
      backdropMotion: motionOn ? "off" : "on",
    });
  };

  return (
    <label className="perf-toggle bg-motion-toggle">
      <span className="perf-toggle-text">
        <strong>Animated background</strong>
        <span className="muted small">
          Drifting gradients and ambient effects
        </span>
      </span>
      <span className="perf-toggle-switch">
        <input
          type="checkbox"
          checked={motionOn}
          onChange={toggleMotion}
          aria-label="Animated background"
        />
        <span className="perf-toggle-track" aria-hidden="true">
          <span className="perf-toggle-thumb" />
        </span>
      </span>
    </label>
  );
}
