/**
 * CodeMirror extension that renders **bold** and __underline__ markers visually,
 * and helpers to toggle those markers around the current selection.
 */
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

// ---- Decoration classes ---- //
const boldMark = Decoration.mark({ class: "cm-fmt-bold" });
const underlineMark = Decoration.mark({ class: "cm-fmt-underline" });
// Hidden bracket: replaces the `**` / `__` characters with nothing.
const hiddenBracket = Decoration.replace({});
// Visible bracket: shown faintly while the cursor is inside the wrapped range
// so the user can still see and edit the markers when they want to.
const visibleBracket = Decoration.mark({ class: "cm-fmt-bracket" });

// Marks must stay on a single line — the styling regex below doesn't cross newlines.
const BOLD_RE = /\*\*([^*\n]+?)\*\*/g;
const UNDERLINE_RE = /__([^_\n]+?)__/g;

function rangeTouchesSelection(
  from: number,
  to: number,
  view: EditorView,
): boolean {
  for (const r of view.state.selection.ranges) {
    if (r.from <= to && r.to >= from) return true;
  }
  return false;
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const entries: Array<{ from: number; to: number; deco: Decoration }> = [];

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);

    const addWrapped = (
      m: RegExpMatchArray,
      innerDeco: Decoration,
    ) => {
      const start = from + m.index!;
      const end = start + m[0].length;
      const inner = start + 2;
      const innerEnd = end - 2;
      const showBrackets = rangeTouchesSelection(start, end, view);
      const bracket = showBrackets ? visibleBracket : hiddenBracket;
      entries.push({ from: start, to: inner, deco: bracket });
      entries.push({ from: inner, to: innerEnd, deco: innerDeco });
      entries.push({ from: innerEnd, to: end, deco: bracket });
    };

    for (const m of text.matchAll(BOLD_RE)) addWrapped(m, boldMark);
    for (const m of text.matchAll(UNDERLINE_RE)) addWrapped(m, underlineMark);
  }

  entries.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const { from, to, deco } of entries) {
    builder.add(from, to, deco);
  }
  return builder.finish();
}

export const formatMarksExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

export const formatMarksTheme = EditorView.baseTheme({
  ".cm-fmt-bold": { fontWeight: "bold" },
  ".cm-fmt-underline": { textDecoration: "underline" },
  ".cm-fmt-bracket": {
    opacity: "0.32",
    fontWeight: "normal",
    textDecoration: "none",
  },
});

// ---- Toggle helpers ---- //

/**
 * Wrap a single segment of text with `open` / `close`, or unwrap if it already
 * starts and ends with them. Returns the rewritten segment and the offsets of
 * the inner content within it (used to position the selection afterwards).
 */
function wrapOrUnwrapSegment(
  text: string,
  open: string,
  close: string,
): { result: string; innerStart: number; innerEnd: number } {
  if (
    text.startsWith(open) &&
    text.endsWith(close) &&
    text.length > open.length + close.length
  ) {
    const inner = text.slice(open.length, text.length - close.length);
    return { result: inner, innerStart: 0, innerEnd: inner.length };
  }
  const result = open + text + close;
  return {
    result,
    innerStart: open.length,
    innerEnd: open.length + text.length,
  };
}

/** Wraps or unwraps the selection with `open` / `close` markers. */
function toggleWrap(view: EditorView, open: string, close: string) {
  const { state } = view;
  const range = state.selection.main;

  // No selection — insert placeholder and put cursor inside.
  if (range.empty) {
    const placeholder = open + close;
    view.dispatch({
      changes: { from: range.from, insert: placeholder },
      selection: { anchor: range.from + open.length },
    });
    view.focus();
    return;
  }

  const selected = state.sliceDoc(range.from, range.to);

  // Multi-line selection — wrap each non-empty line on its own, since the
  // styling regex can't span newlines. Preserve leading/trailing whitespace.
  if (selected.includes("\n")) {
    const lines = selected.split("\n");
    const rewritten = lines.map((line) => {
      const leadingLen = line.length - line.trimStart().length;
      const trailingLen = line.length - line.trimEnd().length;
      const leading = line.slice(0, leadingLen);
      const trailing = trailingLen > 0 ? line.slice(line.length - trailingLen) : "";
      const core = line.slice(leadingLen, line.length - trailingLen);
      if (!core) return line;
      const { result } = wrapOrUnwrapSegment(core, open, close);
      return leading + result + trailing;
    });
    const replacement = rewritten.join("\n");
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: replacement },
      selection: { anchor: range.from, head: range.from + replacement.length },
    });
    view.focus();
    return;
  }

  // Single-line selection.
  const { result, innerStart, innerEnd } = wrapOrUnwrapSegment(
    selected,
    open,
    close,
  );
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: result },
    selection: {
      anchor: range.from + innerStart,
      head: range.from + innerEnd,
    },
  });
  view.focus();
}

export function toggleBold(view: EditorView) {
  toggleWrap(view, "**", "**");
}

export function toggleUnderline(view: EditorView) {
  toggleWrap(view, "__", "__");
}

/** Strip format markers from a string (for plain-text export). */
export function stripFormatMarkers(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1");
}
