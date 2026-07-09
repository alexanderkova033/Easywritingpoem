import { useState, useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import "./BackgroundPicker.css";
import {
  BACKGROUND_OPTIONS,
  type BackgroundId,
  type CustomBackgroundTheme,
} from "./presets";
import type { AppearanceSettings } from "../appearance";
import { generateBackground } from "./generate-background";

const PRESET_OPTIONS = BACKGROUND_OPTIONS.filter((o) => o.id !== "custom" && o.id !== "default");

const RECENTS_KEY = "easy-poems:recent-backgrounds";
const MAX_RECENTS = 3;

function loadRecents(): BackgroundId[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as BackgroundId[];
    return Array.isArray(arr) ? arr.slice(0, MAX_RECENTS) : [];
  } catch { return []; }
}

function saveRecent(id: BackgroundId) {
  if (id === "custom") return;
  try {
    const prev = loadRecents().filter((x) => x !== id);
    localStorage.setItem(RECENTS_KEY, JSON.stringify([id, ...prev].slice(0, MAX_RECENTS)));
  } catch { /* ignore */ }
}

const EDITABLE_COLORS: { key: keyof CustomBackgroundTheme; label: string }[] = [
  { key: "bg",      label: "Background" },
  { key: "surface", label: "Surface" },
  { key: "accent",  label: "Accent" },
  { key: "text",    label: "Text" },
  { key: "muted",   label: "Muted" },
  { key: "border",  label: "Border" },
];

function ThemePreviewCard({ theme }: { theme: CustomBackgroundTheme }) {
  return (
    <div className="theme-preview-card" style={{ background: theme.bg, borderColor: theme.border }}>
      <div className="theme-preview-header" style={{ background: theme.surface, borderBottomColor: theme.border }}>
        <div className="theme-preview-title" style={{ background: theme.text }} />
      </div>
      <div className="theme-preview-body">
        <div className="theme-preview-line" style={{ background: theme.muted }} />
        <div className="theme-preview-line theme-preview-line--short" style={{ background: theme.muted }} />
        <div className="theme-preview-line" style={{ background: theme.muted }} />
        <div className="theme-preview-line theme-preview-line--medium" style={{ background: theme.muted }} />
      </div>
      <div className="theme-preview-pip" style={{ background: theme.accent }} />
    </div>
  );
}

function ColorEditor({
  theme,
  onChange,
}: {
  theme: CustomBackgroundTheme;
  onChange: (next: CustomBackgroundTheme) => void;
}) {
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  return (
    <div className="bg-color-editor">
      <div className="bg-color-swatches">
        {EDITABLE_COLORS.map(({ key, label }) => {
          const value = theme[key] as string;
          return (
            <label key={key} className="bg-color-swatch-label" title={`${label} — ${value}`}>
              <span
                className="bg-color-swatch"
                style={{ background: value }}
                onClick={() => inputRefs.current[key]?.click()}
              />
              <input
                ref={(el) => { inputRefs.current[key] = el; }}
                type="color"
                value={value.startsWith("#") ? value : "#888888"}
                className="bg-color-input"
                onChange={(e) => onChange({ ...theme, [key]: e.target.value })}
                aria-label={`Edit ${label} colour`}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}

const EXAMPLE_PROMPTS: { label: string; prompt: string; gradient: string }[] = [
  {
    label: "Misty autumn",
    prompt: "misty autumn morning",
    gradient: "linear-gradient(135deg, #b8612c 0%, #6d3014 60%, #2a140a 100%)",
  },
  {
    label: "Candlelit library",
    prompt: "candlelit library at night",
    gradient: "linear-gradient(135deg, #c8923a 0%, #4a2a14 55%, #1a0e08 100%)",
  },
  {
    label: "Ocean at dawn",
    prompt: "ocean at dawn",
    gradient: "linear-gradient(135deg, #ffb98c 0%, #5fa6c8 55%, #1a3a5a 100%)",
  },
  {
    label: "Winter solstice",
    prompt: "winter solstice, cold and still",
    gradient: "linear-gradient(135deg, #e8f1fa 0%, #88aac8 55%, #2a3a5a 100%)",
  },
];

export function BackgroundPicker(props: {
  background: BackgroundId;
  onChange: (next: AppearanceSettings) => void;
  appearance: AppearanceSettings;
}) {
  const { background, onChange, appearance } = props;

  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CustomBackgroundTheme | null>(null);

  const handleGenerate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setGenerating(true);
    setGenerateError(null);
    setDraft(null);
    try {
      const result = await generateBackground(trimmed);
      setDraft(result);
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Generation failed — please try again.");
    } finally {
      setGenerating(false);
    }
  }, [prompt]);

  const handleUseDraft = useCallback(() => {
    if (!draft) return;
    onChange({ ...appearance, background: "custom", customBackground: draft });
    setDraft(null);
    setPrompt("");
  }, [draft, appearance, onChange]);

  const handleDiscardDraft = useCallback(() => {
    setDraft(null);
  }, []);

  const handleRemoveCustom = useCallback(() => {
    onChange({ ...appearance, background: "default", customBackground: null });
  }, [appearance, onChange]);

  const handleActiveColorChange = useCallback((next: CustomBackgroundTheme) => {
    onChange({ ...appearance, background: "custom", customBackground: next });
  }, [appearance, onChange]);

  const handleDraftColorChange = useCallback((next: CustomBackgroundTheme) => {
    setDraft(next);
  }, []);

  const isCustomActive = background === "custom" && appearance.customBackground != null;
  const [recents, setRecents] = useState<BackgroundId[]>(() => loadRecents());

  const handleSelect = useCallback((id: BackgroundId) => {
    onChange({ ...appearance, background: id });
    saveRecent(id);
    setRecents(loadRecents());
  }, [appearance, onChange]);

  // Distinguish a tap from a touch-drag-to-scroll. Touch users on tablets
  // would otherwise pick a background every time they tried to scroll the
  // modal by dragging on a card.
  const tapDragRef = useRef<{ y: number; x: number; moved: boolean } | null>(null);
  const tapHandlers = (run: () => void) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      tapDragRef.current = { y: e.clientY, x: e.clientX, moved: false };
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const s = tapDragRef.current;
      if (!s) return;
      if (Math.abs(e.clientY - s.y) > 8 || Math.abs(e.clientX - s.x) > 8) s.moved = true;
    },
    onPointerCancel: () => { tapDragRef.current = null; },
    onClick: () => {
      const moved = tapDragRef.current?.moved;
      tapDragRef.current = null;
      if (!moved) run();
    },
  });

  const recentOptions = recents
    .map((id) => PRESET_OPTIONS.find((o) => o.id === id))
    .filter(Boolean) as typeof PRESET_OPTIONS;

  return (
    <div className="bg-picker" role="radiogroup" aria-label="Page backdrop">
      {recentOptions.length > 0 && (
        <div className="bg-picker-recents">
          <span className="bg-picker-recents-label">Recently used</span>
          <div className="bg-picker-recents-row">
            {recentOptions.map((o) => {
              const selected = o.id === background;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`bg-picker-recent-btn ${selected ? "is-selected" : ""}`}
                  {...tapHandlers(() => handleSelect(o.id))}
                  title={o.label}
                >
                  <span className={`bg-picker-swatch bg-picker-swatch--${o.id}`} aria-hidden />
                  <span className="bg-picker-recent-label">{o.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-picker-grid">
        {PRESET_OPTIONS.map((o) => {
          const selected = o.id === background;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`bg-picker-card ${selected ? "is-selected" : ""}`}
              {...tapHandlers(() => handleSelect(o.id))}
            >
              <span className={`bg-picker-swatch bg-picker-swatch--${o.id}`} aria-hidden />
              <span className="bg-picker-glyph" aria-hidden>{o.glyph}</span>
              <span className="bg-picker-text">
                <span className="bg-picker-label">{o.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Custom backdrop creator ── */}
      <div className="bg-creator">
        <div className="bg-creator-header">
          <span className="bg-creator-spark" aria-hidden>✨</span>
          <span className="bg-creator-title">Make your own</span>
        </div>

        <div className="bg-creator-input-row">
          <input
            type="text"
            className="bg-creator-input"
            placeholder="Describe a mood or scene…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void handleGenerate(); }
            }}
            disabled={generating}
          />
          <button
            type="button"
            className="btn btn--primary btn--sm bg-creator-generate-btn"
            disabled={!prompt.trim() || generating}
            onClick={() => void handleGenerate()}
            aria-label={generating ? "Generating" : "Generate backdrop"}
            title="Generate"
          >
            {generating
              ? <span className="bg-creator-spinner" aria-hidden />
              : <span aria-hidden>✨</span>}
          </button>
        </div>

        {!draft && !generating && (
          <div className="bg-creator-examples" aria-label="Example prompts">
            {EXAMPLE_PROMPTS.map((ex) => (
              <button
                key={ex.prompt}
                type="button"
                className="bg-creator-example-chip"
                onClick={() => setPrompt(ex.prompt)}
                title={ex.prompt}
              >
                <span
                  className="bg-creator-example-swatch"
                  style={{ background: ex.gradient }}
                  aria-hidden
                />
                <span className="bg-creator-example-label">{ex.label}</span>
              </button>
            ))}
          </div>
        )}

        {generateError && (
          <p className="bg-creator-error" role="alert">{generateError}</p>
        )}

        {draft && (
          <div className="bg-creator-draft">
            <div className="bg-creator-stage">
              <ThemePreviewCard theme={draft} />
              <span className="bg-creator-stage-name" title={draft.label}>{draft.label}</span>
              <div className="bg-creator-stage-actions">
                <button
                  type="button"
                  className="bg-creator-icon-btn"
                  disabled={generating}
                  onClick={() => void handleGenerate()}
                  title="Regenerate"
                  aria-label="Regenerate"
                >↺</button>
                <button
                  type="button"
                  className="bg-creator-icon-btn"
                  onClick={handleDiscardDraft}
                  title="Discard"
                  aria-label="Discard"
                >✕</button>
                <button
                  type="button"
                  className="btn btn--primary btn--sm bg-creator-use-btn"
                  onClick={handleUseDraft}
                >Use</button>
              </div>
            </div>
            <ColorEditor theme={draft} onChange={handleDraftColorChange} />
          </div>
        )}

        {isCustomActive && !draft && (
          <div className="bg-creator-active">
            <div className="bg-creator-stage is-active">
              <ThemePreviewCard theme={appearance.customBackground!} />
              <span className="bg-creator-stage-name" title={appearance.customBackground!.label}>
                {appearance.customBackground!.label}
              </span>
              <div className="bg-creator-stage-actions">
                <button
                  type="button"
                  className="bg-creator-icon-btn"
                  onClick={handleRemoveCustom}
                  title="Remove custom backdrop"
                  aria-label="Remove custom backdrop"
                >✕</button>
              </div>
            </div>
            <ColorEditor theme={appearance.customBackground!} onChange={handleActiveColorChange} />
          </div>
        )}
      </div>
    </div>
  );
}
