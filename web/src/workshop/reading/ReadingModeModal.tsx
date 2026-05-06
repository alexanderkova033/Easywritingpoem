import "./ReadingModeModal.css";
import { useEffect, useRef, useState } from "react";
import { stripFormatMarkers } from "@/workshop/editor/format-marks";
import { STORAGE_KEY_READING_FONT_SIZE } from "@/shared/storage-keys";

interface ReadingModeModalProps {
  title: string;
  formNote: string;
  body: string;
  onClose: () => void;
}

const FONT_SIZES = [0.92, 1.0, 1.1, 1.2, 1.32, 1.46, 1.62];
const DEFAULT_SIZE_IDX = 2;

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

export function ReadingModeModal({ title, formNote, body, onClose }: ReadingModeModalProps) {
  const [sizeIdx, setSizeIdx] = useState(loadSizeIdx);
  const [copyFlash, setCopyFlash] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_READING_FONT_SIZE, String(sizeIdx)); } catch { /* ignore */ }
  }, [sizeIdx]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const cleanBody = stripFormatMarkers(body);
  const lines = cleanBody.split("\n");

  const handleCopy = () => {
    const text = [title, formNote, "", cleanBody].filter(Boolean).join("\n");
    void navigator.clipboard.writeText(text).then(() => {
      setCopyFlash(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopyFlash(false), 1600);
    });
  };

  const fontSize = FONT_SIZES[sizeIdx]!;

  return (
    <div
      className="reading-mode-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* SVG filter that gives the paper edges a hand-torn roughness */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter id="rp-rough" x="-2%" y="-1%" width="104%" height="102%" colorInterpolationFilters="linearRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.032 0.065" numOctaves="3" seed="8" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="4" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      <div className="reading-mode-modal" role="dialog" aria-modal="true" aria-label="Reading view">
        <button
          type="button"
          className="reading-mode-close"
          onClick={onClose}
          aria-label="Close reading view"
        >
          ×
        </button>

        {/* Controls bar */}
        <div className="reading-mode-controls">
          <div className="reading-mode-controls-left">
            <div className="reading-mode-font-size-group" aria-label="Font size">
              <button
                type="button"
                className="reading-mode-font-btn"
                onClick={() => setSizeIdx((i) => Math.max(0, i - 1))}
                disabled={sizeIdx === 0}
                aria-label="Decrease font size"
              >
                A−
              </button>
              <button
                type="button"
                className="reading-mode-font-btn"
                onClick={() => setSizeIdx((i) => Math.min(FONT_SIZES.length - 1, i + 1))}
                disabled={sizeIdx === FONT_SIZES.length - 1}
                aria-label="Increase font size"
              >
                A+
              </button>
            </div>
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
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6 9V2h12v7" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
              Print
            </button>
          </div>
        </div>

        <article className="reading-mode-poem" style={{ fontSize: `${fontSize}rem` }}>
          {title && <h1 className="reading-mode-title">{title}</h1>}
          {formNote && <p className="reading-mode-form">{formNote}</p>}
          <div className="reading-mode-divider" aria-hidden>
            <span className="reading-mode-divider-ornament">✦ ✦ ✦</span>
          </div>
          <div className="reading-mode-body">
            {lines.map((line, i) =>
              line.trim() === "" ? (
                <div key={i} className="reading-mode-stanza-break" aria-hidden />
              ) : (
                <p key={i} className="reading-mode-line">{line}</p>
              ),
            )}
            <div className="reading-mode-fin" aria-hidden>&#8258;</div>
          </div>
        </article>
      </div>
    </div>
  );
}
