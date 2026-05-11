import { EditorView, ViewPlugin } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";

export const setTypewriterEnabled = StateEffect.define<boolean>();

const typewriterEnabled = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setTypewriterEnabled)) return e.value;
    }
    return value;
  },
});

/**
 * Typewriter scrolling: keeps the caret near the vertical center of the
 * scroller while typing or moving the cursor. Activates only when the
 * `typewriterEnabled` state field is true.
 */
const typewriterPlugin = ViewPlugin.fromClass(
  class {
    private raf: number | null = null;
    constructor(_view: EditorView) {}
    update(update: { docChanged: boolean; selectionSet: boolean; state: EditorView["state"]; view: EditorView }) {
      if (!update.state.field(typewriterEnabled, false)) return;
      if (!update.docChanged && !update.selectionSet) return;
      const view = update.view;
      const head = update.state.selection.main.head;
      if (this.raf != null) cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => {
        this.raf = null;
        try {
          view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) });
        } catch { /* ignore */ }
      });
    }
    destroy() {
      if (this.raf != null) cancelAnimationFrame(this.raf);
    }
  },
);

export const typewriterExtension = [typewriterEnabled, typewriterPlugin];
