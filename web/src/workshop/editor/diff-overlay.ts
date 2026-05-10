import { StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { diffWords } from "./word-diff";

/** Set or clear the snapshot to diff against. Pass null to exit diff mode. */
export const setDiffSnapshot = StateEffect.define<string | null>();

interface DiffState {
  snapshotBody: string | null;
  decorations: DecorationSet;
}

class RemovedTextWidget extends WidgetType {
  constructor(private readonly text: string) { super(); }
  eq(other: RemovedTextWidget) { return other.text === this.text; }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-diff-removed";
    el.setAttribute("aria-label", `Removed: ${this.text}`);
    el.title = `Removed in current version: ${this.text}`;
    el.textContent = this.text;
    return el;
  }
  ignoreEvent() { return true; }
}

function buildDecorations(snapshotBody: string, currentBody: string): DecorationSet {
  const ops = diffWords(snapshotBody, currentBody);
  const decos: Range<Decoration>[] = [];
  let pos = 0;
  for (const op of ops) {
    if (op.kind === "keep") {
      pos += op.text.length;
    } else if (op.kind === "add") {
      if (op.text.length > 0) {
        decos.push(Decoration.mark({ class: "cm-diff-add" }).range(pos, pos + op.text.length));
      }
      pos += op.text.length;
    } else {
      // remove: insert ghost widget at the deletion point. side: -1 so the
      // widget renders just before any add-decoration starting at the same pos.
      decos.push(
        Decoration.widget({ widget: new RemovedTextWidget(op.text), side: -1 }).range(pos),
      );
    }
  }
  decos.sort((a, b) => a.from - b.from || (a.value.startSide - b.value.startSide));
  return Decoration.set(decos, true);
}

export const diffOverlayField = StateField.define<DiffState>({
  create: () => ({ snapshotBody: null, decorations: Decoration.none }),
  update(state, tr) {
    let nextBody: string | null | undefined;
    for (const e of tr.effects) {
      if (e.is(setDiffSnapshot)) nextBody = e.value;
    }
    if (nextBody !== undefined) {
      if (nextBody === null) return { snapshotBody: null, decorations: Decoration.none };
      const current = tr.state.doc.toString();
      return { snapshotBody: nextBody, decorations: buildDecorations(nextBody, current) };
    }
    if (tr.docChanged && state.snapshotBody !== null) {
      const current = tr.state.doc.toString();
      return { ...state, decorations: buildDecorations(state.snapshotBody, current) };
    }
    if (tr.docChanged) {
      return { ...state, decorations: state.decorations.map(tr.changes) };
    }
    return state;
  },
  provide: (f) => EditorView.decorations.from(f, (s) => s.decorations),
});
