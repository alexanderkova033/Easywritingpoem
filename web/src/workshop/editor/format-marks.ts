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
// Replace decoration with no widget = hide the characters entirely.
const hiddenBracket = Decoration.replace({});

// Marks must stay on a single line — the styling regex below doesn't cross newlines.
const BOLD_RE = /\*\*([^*\n]+?)\*\*/g;
const UNDERLINE_RE = /__([^_\n]+?)__/g;

type Built = { decorations: DecorationSet; atomics: DecorationSet };

function build(view: EditorView): Built {
  const decoBuilder = new RangeSetBuilder<Decoration>();
  const atomBuilder = new RangeSetBuilder<Decoration>();
  const entries: Array<{
    from: number;
    to: number;
    deco: Decoration;
    atomic: boolean;
  }> = [];

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);

    const addWrapped = (m: RegExpMatchArray, innerDeco: Decoration) => {
      const start = from + m.index!;
      const end = start + m[0].length;
      const inner = start + 2;
      const innerEnd = end - 2;
      entries.push({ from: start, to: inner, deco: hiddenBracket, atomic: true });
      entries.push({ from: inner, to: innerEnd, deco: innerDeco, atomic: false });
      entries.push({ from: innerEnd, to: end, deco: hiddenBracket, atomic: true });
    };

    for (const m of text.matchAll(BOLD_RE)) addWrapped(m, boldMark);
    for (const m of text.matchAll(UNDERLINE_RE)) addWrapped(m, underlineMark);
  }

  entries.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const e of entries) {
    decoBuilder.add(e.from, e.to, e.deco);
    if (e.atomic) atomBuilder.add(e.from, e.to, e.deco);
  }
  return { decorations: decoBuilder.finish(), atomics: atomBuilder.finish() };
}

export const formatMarksExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomics: DecorationSet;
    constructor(view: EditorView) {
      const b = build(view);
      this.decorations = b.decorations;
      this.atomics = b.atomics;
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        const b = build(update.view);
        this.decorations = b.decorations;
        this.atomics = b.atomics;
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => {
        const p = view.plugin(plugin);
        return p ? p.atomics : Decoration.none;
      }),
  },
);

export const formatMarksTheme = EditorView.baseTheme({
  ".cm-fmt-bold": { fontWeight: "bold" },
  ".cm-fmt-underline": { textDecoration: "underline" },
});

// ---- Toggle helpers ---- //

/**
 * Wrap a single segment of text with `open` / `close`, or unwrap if it already
 * starts and ends with them.
 */
function wrapOrUnwrapSegment(text: string, open: string, close: string): string {
  if (
    text.startsWith(open) &&
    text.endsWith(close) &&
    text.length > open.length + close.length
  ) {
    return text.slice(open.length, text.length - close.length);
  }
  return open + text + close;
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

  // If the selection sits exactly inside an existing wrap (e.g. user
  // selected the visible "hello" inside the hidden `**hello**`), unwrap by
  // removing the surrounding markers.
  const before = state.sliceDoc(
    Math.max(0, range.from - open.length),
    range.from,
  );
  const after = state.sliceDoc(
    range.to,
    Math.min(state.doc.length, range.to + close.length),
  );
  if (before === open && after === close) {
    const selected = state.sliceDoc(range.from, range.to);
    view.dispatch({
      changes: [
        { from: range.from - open.length, to: range.from, insert: "" },
        { from: range.to, to: range.to + close.length, insert: "" },
      ],
      selection: {
        anchor: range.from - open.length,
        head: range.from - open.length + selected.length,
      },
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
      return leading + wrapOrUnwrapSegment(core, open, close) + trailing;
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
  const result = wrapOrUnwrapSegment(selected, open, close);
  const wrapped = result.length > selected.length;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: result },
    selection: {
      anchor: range.from + (wrapped ? open.length : 0),
      head: range.from + (wrapped ? open.length + selected.length : result.length),
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
