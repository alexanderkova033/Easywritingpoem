import { EditorView, ViewPlugin, Decoration, type DecorationSet } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import type { Range } from "@codemirror/state";

export type LineFocusMode = "off" | "line" | "stanza";

export const setLineFocusMode = StateEffect.define<LineFocusMode>();
/** Back-compat: boolean toggle maps to "line" / "off". */
export const setLineFocusEnabled = StateEffect.define<boolean>();

const lineFocusMode = StateField.define<LineFocusMode>({
  create: () => "off",
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setLineFocusMode)) return e.value;
      if (e.is(setLineFocusEnabled)) return e.value ? "line" : "off";
    }
    return value;
  },
});

const dimmedLine = Decoration.line({ class: "cm-line-dimmed" });

/** Find the inclusive stanza line range around `activeLine`, where stanzas
 * are separated by one or more blank lines. */
function stanzaRange(view: EditorView, activeLine: number): { from: number; to: number } {
  const doc = view.state.doc;
  const total = doc.lines;
  let from = activeLine;
  while (from > 1) {
    const prev = doc.line(from - 1);
    if (!prev.text.trim()) break;
    from--;
  }
  let to = activeLine;
  while (to < total) {
    const next = doc.line(to + 1);
    if (!next.text.trim()) break;
    to++;
  }
  return { from, to };
}

const lineFocusPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    update(update: { docChanged: boolean; selectionSet: boolean; view: EditorView; startState: ReturnType<EditorView["state"]["toJSON"]> }) {
      if (update.docChanged || update.selectionSet || (update as { startState: { field?: (f: typeof lineFocusMode) => LineFocusMode } }).startState) {
        this.decorations = this.build((update as unknown as { view: EditorView }).view);
      }
    }
    build(view: EditorView): DecorationSet {
      const mode = view.state.field(lineFocusMode);
      if (mode === "off") return Decoration.none;
      const sel = view.state.selection.main;
      const activeLine = view.state.doc.lineAt(sel.head).number;
      const decos: Range<Decoration>[] = [];
      if (mode === "line") {
        for (let i = 1; i <= view.state.doc.lines; i++) {
          if (i === activeLine) continue;
          const line = view.state.doc.line(i);
          if (!line.text.trim()) continue;
          decos.push(dimmedLine.range(line.from));
        }
      } else {
        const { from, to } = stanzaRange(view, activeLine);
        // Dim every line outside the active stanza. When the doc is still a
        // single stanza (e.g. while writing the first paragraph, before any
        // blank-line separator exists) the range covers the whole doc, so
        // nothing dims and the entire paragraph stays in focus — which is the
        // point of stanza focus. (Previously this degraded to per-line focus,
        // wrongly dimming the rest of the paragraph being written.)
        for (let i = 1; i <= view.state.doc.lines; i++) {
          if (i >= from && i <= to) continue;
          const line = view.state.doc.line(i);
          if (!line.text.trim()) continue;
          decos.push(dimmedLine.range(line.from));
        }
      }
      return Decoration.set(decos, true);
    }
  },
  { decorations: (v) => v.decorations },
);

export const lineFocusExtension = [lineFocusMode, lineFocusPlugin];
