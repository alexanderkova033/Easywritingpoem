import type { AppearanceSettings } from "./appearance";
import "./BackdropFormFields.css";

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
