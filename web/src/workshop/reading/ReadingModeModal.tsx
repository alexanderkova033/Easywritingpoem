import "./ReadingModeModal.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { stripFormatMarkers } from "@/workshop/editor/format-marks";
import {
  STORAGE_KEY_READING_FONT_SIZE,
  STORAGE_KEY_READING_THEME,
  STORAGE_KEY_READING_LINE_NUMBERS,
  STORAGE_KEY_READING_DROP_CAP,
} from "@/shared/storage-keys";

interface ReadingModeModalProps {
  title: string;
  formNote: string;
  body: string;
  onClose: () => void;
}

const FONT_SIZES = [0.92, 1.0, 1.1, 1.2, 1.32, 1.46, 1.62, 1.8];
const DEFAULT_SIZE_IDX = 3;

const THEMES = [
  { id: "parchment", label: "Parchment" },
  { id: "light",     label: "Light"     },
  { id: "sepia",     label: "Sepia"     },
  { id: "dark",      label: "Dark"      },
] as const;
type ThemeId = (typeof THEMES)[number]["id"];

function loadSizeIdx(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_READING_FONT_SIZE);
    if (raw !== null) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n >= 0 && n < FONT_SIZES.length) return n;
    }
  } catch { /* ignore */ }
  return DEFAULT_SIZE_IDX;
}

function loadTheme(): ThemeId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_READING_THEME);
    if (raw && THEMES.some((t) => t.id === raw)) return raw as ThemeId;
  } catch { /* ignore */ }
  return "parchment";
}

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch { /* ignore */ }
  return fallback;
}

export function ReadingModeModal({ title, formNote, body, onClose }: ReadingModeModalProps) {
  const [sizeIdx, setSizeIdx] = useState(loadSizeIdx);
  const [theme, setTheme] = useState<ThemeId>(loadTheme);
  const [lineNumbers, setLineNumbers] = useState(() => loadBool(STORAGE_KEY_READING_LINE_NUMBERS, false));
  const [dropCap, setDropCap] = useState(() => loadBool(STORAGE_KEY_READING_DROP_CAP, true));
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copyFlash, setCopyFlash] = useState(false);
  const [controlsHidden, setControlsHidden] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);

  const armIdleHide = useCallback(() => {
    setControlsHidden(false);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setControlsHidden(true), 2400);
  }, []);

  useEffect(() => {
    armIdleHide();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [armIdleHide]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isFullscreen) {
          setIsFullscreen(false);
          return;
        }
        onClose();
        return;
      }
      // ignore when modifier held (avoid hijacking browser shortcuts)
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setSizeIdx((i) => Math.min(FONT_SIZES.length - 1, i + 1));
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setSizeIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "0") {
        setSizeIdx(DEFAULT_SIZE_IDX);
      } else if (e.key.toLowerCase() === "f") {
        setIsFullscreen((v) => !v);
      } else if (e.key.toLowerCase() === "t") {
        setTheme((cur) => {
          const i = THEMES.findIndex((t) => t.id === cur);
          return THEMES[(i + 1) % THEMES.length]!.id;
        });
      } else if (e.key.toLowerCase() === "n") {
        setLineNumbers((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, isFullscreen]);

  // Persist preferences
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_READING_FONT_SIZE, String(sizeIdx)); } catch { /* ignore */ }
  }, [sizeIdx]);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_READING_THEME, theme); } catch { /* ignore */ }
  }, [theme]);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_READING_LINE_NUMBERS, lineNumbers ? "1" : "0"); } catch { /* ignore */ }
  }, [lineNumbers]);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_READING_DROP_CAP, dropCap ? "1" : "0"); } catch { /* ignore */ }
  }, [dropCap]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const cleanBody = stripFormatMarkers(body);
  const lines = cleanBody.split("\n");

  let lineNum = 0;
  let firstContentLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() !== "") { firstContentLineIdx = i; break; }
  }

  const handleCopy = () => {
    const text = [title, formNote, "", cleanBody].filter(Boolean).join("\n");
    void navigator.clipboard.writeText(text).then(() => {
      setCopyFlash(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopyFlash(false), 1600);
    });
  };

  const cycleTheme = () => {
    const i = THEMES.findIndex((t) => t.id === theme);
    setTheme(THEMES[(i + 1) % THEMES.length]!.id);
  };

  const fontSize = FONT_SIZES[sizeIdx]!;

  return (
    <div
      className={`reading-mode-overlay ${isFullscreen ? "is-fullscreen" : ""}`}
      data-reading-theme={theme}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onMouseMove={armIdleHide}
      onTouchStart={armIdleHide}
    >
      <div
        className={`reading-mode-modal ${controlsHidden ? "controls-hidden" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Reading view"
        ref={modalRef}
      >
        <button
          type="button"
          className="reading-mode-close"
          onClick={onClose}
          aria-label="Close reading view"
        >
          ×
        </button>

        <div className="reading-mode-controls">
          <div className="reading-mode-controls-left">
            <div className="reading-mode-font-size-group" aria-label="Font size">
              <button
                type="button"
                className="reading-mode-font-btn"
                onClick={() => setSizeIdx((i) => Math.max(0, i - 1))}
                disabled={sizeIdx === 0}
                aria-label="Decrease font size"
                title="Decrease (−)"
              >
                A−
              </button>
              <button
                type="button"
                className="reading-mode-font-btn"
                onClick={() => setSizeIdx((i) => Math.min(FONT_SIZES.length - 1, i + 1))}
                disabled={sizeIdx === FONT_SIZES.length - 1}
                aria-label="Increase font size"
                title="Increase (+)"
              >
                A+
              </button>
            </div>
            <button
              type="button"
              className="reading-mode-icon-btn"
              onClick={cycleTheme}
              aria-label={`Theme: ${THEMES.find((t) => t.id === theme)?.label}. Click to cycle.`}
              title="Cycle theme (T)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" />
              </svg>
              {THEMES.find((t) => t.id === theme)?.label}
            </button>
            <button
              type="button"
              className={`reading-mode-icon-btn ${lineNumbers ? "is-active" : ""}`}
              onClick={() => setLineNumbers((v) => !v)}
              aria-pressed={lineNumbers}
              aria-label="Toggle line numbers"
              title="Line numbers (N)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 6h2M4 12h2M4 18h2" />
                <path d="M10 6h10M10 12h10M10 18h10" />
              </svg>
              #
            </button>
            <button
              type="button"
              className={`reading-mode-icon-btn ${dropCap ? "is-active" : ""}`}
              onClick={() => setDropCap((v) => !v)}
              aria-pressed={dropCap}
              aria-label="Toggle drop cap"
              title="Drop cap"
            >
              <span className="reading-mode-dropcap-icon" aria-hidden>A</span>
            </button>
          </div>
          <div className="reading-mode-controls-right">
            <span
              className={`reading-mode-copy-feedback ${copyFlash ? "is-visible" : ""}`}
              aria-live="polite"
            >
              Copied
            </span>
            <button
              type="button"
              className="reading-mode-icon-btn"
              onClick={handleCopy}
              aria-label="Copy poem to clipboard"
              title="Copy"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy
            </button>
            <button
              type="button"
              className="reading-mode-icon-btn"
              onClick={() => window.print()}
              aria-label="Print poem"
              title="Print"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6 9V2h12v7" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
              Print
            </button>
            <button
              type="button"
              className="reading-mode-icon-btn"
              onClick={() => setIsFullscreen((v) => !v)}
              aria-pressed={isFullscreen}
              aria-label="Toggle fullscreen"
              title="Fullscreen (F)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {isFullscreen ? (
                  <>
                    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
                  </>
                ) : (
                  <>
                    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>

        <article
          className={`reading-mode-poem ${lineNumbers ? "with-line-numbers" : ""} ${dropCap ? "with-drop-cap" : ""}`}
          style={{ fontSize: `${fontSize}rem` }}
        >
          {title && <h1 className="reading-mode-title">{title}</h1>}
          {formNote && <p className="reading-mode-form">{formNote}</p>}
          <div className="reading-mode-divider" aria-hidden>
            <span className="reading-mode-divider-ornament">✦ ✦ ✦</span>
          </div>
          <div className="reading-mode-body">
            {lines.map((line, i) => {
              if (line.trim() === "") {
                return <div key={i} className="reading-mode-stanza-break" aria-hidden />;
              }
              lineNum += 1;
              const isFirst = i === firstContentLineIdx;
              return (
                <p
                  key={i}
                  className={`reading-mode-line ${isFirst ? "is-first" : ""}`}
                  data-line-number={lineNumbers ? lineNum : undefined}
                >
                  {line}
                </p>
              );
            })}
            <div className="reading-mode-fin" aria-hidden>&#8258;</div>
          </div>
        </article>
      </div>
    </div>
  );
}
