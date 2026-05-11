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

const SMOOTH_DURATION_MS = 280;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Typewriter scrolling: keeps the caret near the vertical center of the
 * scroller while typing or moving the cursor. Activates only when the
 * `typewriterEnabled` state field is true.
 *
 * Animates the scroll with a short eased tween instead of CM's instant
 * `scrollIntoView`, so the page glides under the caret instead of jumping.
 */
const typewriterPlugin = ViewPlugin.fromClass(
  class {
    private raf: number | null = null;
    private animFrom = 0;
    private animTo = 0;
    private animStart = 0;
    private animating = false;

    constructor(_view: EditorView) {}

    update(update: { docChanged: boolean; selectionSet: boolean; state: EditorView["state"]; view: EditorView }) {
      if (!update.state.field(typewriterEnabled, false)) return;
      if (!update.docChanged && !update.selectionSet) return;
      this.schedule(update.view);
    }

    private schedule(view: EditorView) {
      if (this.raf != null) cancelAnimationFrame(this.raf);
      // Defer to next frame so layout reflects the latest edit before we measure.
      this.raf = requestAnimationFrame(() => {
        this.raf = null;
        this.retarget(view);
      });
    }

    private retarget(view: EditorView) {
      const head = view.state.selection.main.head;
      const coords = view.coordsAtPos(head);
      if (!coords) return;
      const scroller = view.scrollDOM;
      const rect = scroller.getBoundingClientRect();
      const caretMid = (coords.top + coords.bottom) / 2;
      const viewportCenter = rect.top + scroller.clientHeight / 2;
      const offsetFromCenter = caretMid - viewportCenter;

      // Deadzone: caret may roam ~3 lines from center before the page follows.
      // Inside the zone, nothing scrolls — typing feels natural, screen stays
      // still. Cross the zone edge and the screen re-centers smoothly.
      const lineH = view.defaultLineHeight || (coords.bottom - coords.top) || 20;
      const deadzone = lineH * 3;
      if (Math.abs(offsetFromCenter) <= deadzone) return;

      const caretYInScroll = caretMid - rect.top + scroller.scrollTop;
      const target = Math.max(0, caretYInScroll - scroller.clientHeight / 2);
      const current = scroller.scrollTop;
      if (Math.abs(target - current) < 1.5) return;

      // Respect reduced motion preference.
      if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
        scroller.scrollTop = target;
        return;
      }

      this.animFrom = current;
      this.animTo = target;
      this.animStart = performance.now();
      if (!this.animating) {
        this.animating = true;
        this.tick(view);
      }
    }

    private tick(view: EditorView) {
      requestAnimationFrame(() => {
        const scroller = view.scrollDOM;
        const elapsed = performance.now() - this.animStart;
        const t = Math.min(1, elapsed / SMOOTH_DURATION_MS);
        const eased = easeOutCubic(t);
        scroller.scrollTop = this.animFrom + (this.animTo - this.animFrom) * eased;
        if (t < 1) {
          this.tick(view);
        } else {
          this.animating = false;
        }
      });
    }

    destroy() {
      if (this.raf != null) cancelAnimationFrame(this.raf);
      this.animating = false;
    }
  },
);

export const typewriterExtension = [typewriterEnabled, typewriterPlugin];
