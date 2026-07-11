import { useEffect, useRef, useState } from "react";
import {
  BACKDROP_INTENSITY_PRESETS,
  PANEL_INTENSITY_PRESETS,
  POEM_FONT_OPTIONS,
  UI_FONT_OPTIONS,
  type AppearanceSettings,
  type ColorIntensityPreset,
  defaultAppearance,
  type PoemFontId,
  type UiFontId,
} from "./appearance";
import "./FontSelect.css";

type IntensityFieldKeys = {
  saturation: "backdropSaturation" | "panelSaturation";
  brightness: "backdropBrightness" | "panelBrightness";
  contrast: "backdropContrast" | "panelContrast";
};

function ColorIntensityPresetRow({
  label,
  presets,
  fields,
  appearance,
  onChange,
}: {
  label: string;
  presets: ColorIntensityPreset[];
  fields: IntensityFieldKeys;
  appearance: AppearanceSettings;
  onChange: (next: AppearanceSettings) => void;
}) {
  const activeKey = presets.find(
    (p) =>
      p.saturation === appearance[fields.saturation] &&
      p.brightness === appearance[fields.brightness] &&
      p.contrast === appearance[fields.contrast],
  )?.key;

  return (
    <div className="color-intensity-row">
      <span className="color-intensity-row-label">{label}</span>
      <div className="color-intensity-presets" role="group" aria-label={`${label} color intensity`}>
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`color-intensity-chip${p.key === activeKey ? " is-active" : ""}`}
            title={p.desc}
            aria-pressed={p.key === activeKey}
            onClick={() =>
              onChange({
                ...appearance,
                [fields.saturation]: p.saturation,
                [fields.brightness]: p.brightness,
                [fields.contrast]: p.contrast,
              })
            }
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

type FontOption = { id: string; label: string; fontFamily: string };

function FontSelect<T extends string>({
  value,
  options,
  onChange,
  id,
}: {
  value: T;
  options: readonly FontOption[];
  onChange: (v: T) => void;
  id: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selected = options.find((o) => o.id === value) ?? options[0]!;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Scroll selected item into view when opening
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLLIElement>("[aria-selected='true']");
    el?.scrollIntoView({ block: "nearest" });
  }, [open]);

  // Keyboard navigation
  const onKeyDown = (e: React.KeyboardEvent) => {
    const idx = options.findIndex((o) => o.id === value);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      const next = options[(idx + 1) % options.length]!;
      onChange(next.id as T);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = options[(idx - 1 + options.length) % options.length]!;
      onChange(prev.id as T);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((o) => !o);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className={`font-select${open ? " is-open" : ""}`} ref={rootRef}>
      <button
        type="button"
        id={id}
        className="font-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        <span className="font-select-preview" style={{ fontFamily: selected.fontFamily }}>
          {selected.label}
        </span>
        <span className="font-select-chevron" aria-hidden>▾</span>
      </button>

      {open && (
        <ul
          ref={listRef}
          className="font-select-list"
          role="listbox"
          aria-label="Font options"
        >
          {options.map((o) => (
            <li
              key={o.id}
              role="option"
              aria-selected={o.id === value}
              className={`font-select-option${o.id === value ? " is-selected" : ""}`}
              style={{ fontFamily: o.fontFamily }}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(o.id as T);
                setOpen(false);
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AppearanceFormFields(props: {
  appearance: AppearanceSettings;
  onChange: (next: AppearanceSettings) => void;
}) {
  const { appearance, onChange } = props;
  const poemSel = POEM_FONT_OPTIONS.find((o) => o.id === appearance.poemFont) ?? POEM_FONT_OPTIONS[0]!;
  const uiSel = UI_FONT_OPTIONS.find((o) => o.id === appearance.uiFont) ?? UI_FONT_OPTIONS[0]!;

  return (
    <div className="appearance-fields" aria-label="Font options">
      <label className="appearance-field">
        <span className="appearance-field-label">Poem font</span>
        <FontSelect<PoemFontId>
          id="poem-font-select"
          value={appearance.poemFont}
          options={POEM_FONT_OPTIONS}
          onChange={(v) => onChange({ ...appearance, poemFont: v })}
        />
      </label>

      <label className="appearance-field">
        <span className="appearance-field-label">UI font</span>
        <FontSelect<UiFontId>
          id="ui-font-select"
          value={appearance.uiFont}
          options={UI_FONT_OPTIONS}
          onChange={(v) => onChange({ ...appearance, uiFont: v })}
        />
      </label>

      <div className="font-preview" aria-hidden="true">
        <div className="font-preview-poem" style={{ fontFamily: poemSel.fontFamily }}>
          She walks in beauty, like the night
          <br />
          Of cloudless climes and starry skies
        </div>
        <div className="font-preview-ui" style={{ fontFamily: uiSel.fontFamily }}>
          Interface · Buttons · Menus
        </div>
      </div>

      <div className="appearance-intensity-group">
        <h3 className="style-modal-settings-title">Color intensity</h3>
        <ColorIntensityPresetRow
          label="Backdrop"
          presets={BACKDROP_INTENSITY_PRESETS}
          fields={{ saturation: "backdropSaturation", brightness: "backdropBrightness", contrast: "backdropContrast" }}
          appearance={appearance}
          onChange={onChange}
        />
        <ColorIntensityPresetRow
          label="Panels"
          presets={PANEL_INTENSITY_PRESETS}
          fields={{ saturation: "panelSaturation", brightness: "panelBrightness", contrast: "panelContrast" }}
          appearance={appearance}
          onChange={onChange}
        />
      </div>

      <div className="appearance-actions">
        <button
          type="button"
          className="small-btn appearance-reset-btn"
          onClick={() => {
            const d = defaultAppearance();
            // Only reset the fields this modal owns (fonts, sizing, both
            // color-intensity preset rows) — the *animation/performance*
            // backdrop settings (backdropMotion/backdropPower) live in the
            // separate Background modal and shouldn't be wiped from here.
            onChange({
              ...appearance,
              poemFont: d.poemFont,
              uiFont: d.uiFont,
              poemSize: d.poemSize,
              poemWeight: d.poemWeight,
              poemDecoration: d.poemDecoration,
              backdropSaturation: d.backdropSaturation,
              backdropBrightness: d.backdropBrightness,
              backdropContrast: d.backdropContrast,
              panelSaturation: d.panelSaturation,
              panelBrightness: d.panelBrightness,
              panelContrast: d.panelContrast,
            });
          }}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
