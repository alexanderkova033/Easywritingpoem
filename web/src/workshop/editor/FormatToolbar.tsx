import "./FormatToolbar.css";
import type { EditorView } from "@codemirror/view";
import type { MutableRefObject } from "react";
import { toggleBold, toggleUnderline } from "@/workshop/editor/format-marks";
import { POEM_SIZE_OPTIONS, type PoemSizeId } from "@/workshop/appearance/appearance";
import { useHoverHintBinder } from "@/workshop/hints/HoverHintsContext";

function tidyDoubleSpaces(view: EditorView) {
  const text = view.state.doc.toString();
  const fixed = text.replace(/ {2,}/g, " ");
  if (fixed === text) return;
  view.dispatch({
    changes: { from: 0, to: text.length, insert: fixed },
    userEvent: "tidy.double-spaces",
  });
}

function tidyCapLines(view: EditorView) {
  const lines = view.state.doc.toString().split("\n");
  const fixed = lines.map((l) => {
    const trimmed = l.trimStart();
    if (!trimmed) return l;
    const leading = l.slice(0, l.length - trimmed.length);
    return leading + trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  });
  const result = fixed.join("\n");
  const original = view.state.doc.toString();
  if (result === original) return;
  view.dispatch({
    changes: { from: 0, to: original.length, insert: result },
    userEvent: "tidy.cap-lines",
  });
}

function tidyLowerLines(view: EditorView) {
  const lines = view.state.doc.toString().split("\n");
  const fixed = lines.map((l) => {
    const trimmed = l.trimStart();
    if (!trimmed) return l;
    const leading = l.slice(0, l.length - trimmed.length);
    return leading + trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  });
  const result = fixed.join("\n");
  const original = view.state.doc.toString();
  if (result === original) return;
  view.dispatch({
    changes: { from: 0, to: original.length, insert: result },
    userEvent: "tidy.lower-lines",
  });
}

function tidyStanzaSpacing(view: EditorView) {
  const text = view.state.doc.toString();
  // Collapse 3+ blank lines to 1 blank line, trim trailing whitespace per line
  const fixed = text
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  if (fixed === text) return;
  view.dispatch({
    changes: { from: 0, to: text.length, insert: fixed },
    userEvent: "tidy.stanza-spacing",
  });
}

export function FormatToolbar({
  editorViewRef,
  poemSize,
  onSizeChange,
  onReadingMode,
  showLineSyllables,
  onShowLineSyllablesChange,
  showRhymeScheme,
  onShowRhymeSchemeChange,
  lineFocusMode,
  onLineFocusModeChange,
}: {
  editorViewRef: MutableRefObject<EditorView | null>;
  poemSize: PoemSizeId;
  onSizeChange: (size: PoemSizeId) => void;
  onReadingMode?: () => void;
  showLineSyllables: boolean;
  onShowLineSyllablesChange: (next: boolean) => void;
  showRhymeScheme: boolean;
  onShowRhymeSchemeChange: (next: boolean) => void;
  lineFocusMode?: boolean;
  onLineFocusModeChange?: (next: boolean) => void;
}) {
  const hint = useHoverHintBinder();
  const apply = (fn: (v: EditorView) => void) => {
    const view = editorViewRef.current;
    if (view) fn(view);
  };

  return (
    <div className="format-toolbar" role="toolbar" aria-label="Text formatting">
      <button
        type="button"
        className="fmt-btn"
        {...hint("Bold selected text (**text**)")}
        aria-label="Bold"
        onMouseDown={(e) => {
          e.preventDefault();
          apply(toggleBold);
        }}
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        className="fmt-btn fmt-btn-underline"
        {...hint("Underline selected text (__text__)")}
        aria-label="Underline"
        onMouseDown={(e) => {
          e.preventDefault();
          apply(toggleUnderline);
        }}
      >
        <span style={{ textDecoration: "underline" }}>U</span>
      </button>
      <label className="fmt-size-label">
        <span className="fmt-size-label-text">Size</span>
        <select
          className="fmt-size-select"
          value={poemSize}
          onChange={(e) => onSizeChange(e.target.value as PoemSizeId)}
        >
          {POEM_SIZE_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className={`fmt-btn fmt-syllable-toggle ${showLineSyllables ? "is-on" : ""}`}
        {...hint(
          showLineSyllables
            ? "Hide estimated syllable count at the end of each line"
            : "Show estimated syllable count at the end of each line",
        )}
        aria-pressed={showLineSyllables}
        aria-label={
          showLineSyllables
            ? "Syllable counts on lines: on. Click to hide."
            : "Syllable counts on lines: off. Click to show."
        }
        onMouseDown={(e) => {
          e.preventDefault();
          onShowLineSyllablesChange(!showLineSyllables);
        }}
      >
        ˈsyll
      </button>

      <button
        type="button"
        className={`fmt-btn fmt-syllable-toggle ${showRhymeScheme ? "is-on" : ""}`}
        {...hint(
          showRhymeScheme
            ? "Hide end-rhyme scheme panel"
            : "Show end-rhyme scheme panel",
        )}
        aria-pressed={showRhymeScheme}
        aria-label={
          showRhymeScheme
            ? "Rhyme scheme: on. Click to hide."
            : "Rhyme scheme: off. Click to show."
        }
        onMouseDown={(e) => {
          e.preventDefault();
          onShowRhymeSchemeChange(!showRhymeScheme);
        }}
      >
        A B
      </button>

      <span className="fmt-sep" aria-hidden />

      <button
        type="button"
        className="fmt-btn fmt-tidy-btn"
        {...hint("Remove double spaces in the poem")}
        aria-label="Remove double spaces"
        onMouseDown={(e) => { e.preventDefault(); apply(tidyDoubleSpaces); }}
      >
        A·A
      </button>
      <button
        type="button"
        className="fmt-btn fmt-tidy-btn"
        {...hint("Capitalise first letter of each line")}
        aria-label="Capitalise first letter of each line"
        onMouseDown={(e) => { e.preventDefault(); apply(tidyCapLines); }}
      >
        ↑Aa
      </button>
      <button
        type="button"
        className="fmt-btn fmt-tidy-btn"
        {...hint("Lowercase first letter of each line")}
        aria-label="Lowercase first letter of each line"
        onMouseDown={(e) => { e.preventDefault(); apply(tidyLowerLines); }}
      >
        ↓aa
      </button>
      <button
        type="button"
        className="fmt-btn fmt-tidy-btn"
        {...hint(
          "Even stanza spacing — collapse extra blank lines, trim trailing spaces",
        )}
        aria-label="Even stanza spacing"
        onMouseDown={(e) => { e.preventDefault(); apply(tidyStanzaSpacing); }}
      >
        ¶≡
      </button>

      {onReadingMode && (
        <button
          type="button"
          className="fmt-btn fmt-tidy-btn"
          {...hint("Reading view — clean display of finished poem (⌘/Ctrl+Shift+R)")}
          aria-label="Reading view"
          onMouseDown={(e) => { e.preventDefault(); onReadingMode(); }}
        >
          ☰
        </button>
      )}
      {onLineFocusModeChange !== undefined && (
        <button
          type="button"
          className={`fmt-btn fmt-tidy-btn fmt-line-focus-btn fmt-labeled-btn${lineFocusMode ? " is-on" : ""}`}
          {...hint(lineFocusMode ? "Line focus: on — dims other lines while you write" : "Line focus: off — click to dim other lines")}
          aria-pressed={lineFocusMode}
          aria-label={lineFocusMode ? "Line focus on" : "Line focus off"}
          onMouseDown={(e) => { e.preventDefault(); onLineFocusModeChange(!lineFocusMode); }}
        >
          <span className="fmt-btn-icon" aria-hidden>◉</span>
          <span className="fmt-btn-label">Focus</span>
        </button>
      )}
    </div>
  );
}
