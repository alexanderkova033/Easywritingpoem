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
 * Find the nearest ancestor that actually scrolls vertically. CodeMirror is
 * mounted with `height="auto"` here, so `view.scrollDOM` (the cm-scroller)
 * does not overflow — the page (or some wrapper) is what scrolls. Walk up
 * until we find an element whose scrollHeight exceeds its clientHeight and
 * whose computed overflow-y allows scrolling. Fall back to the window's
 * scrolling element when nothing inside the document scrolls.
 */
function findScrollContainer(el: HTMLElement | null): HTMLElement | Window {
  let node: HTMLElement | null = el?.parentElement ?? null;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = getComputedStyle(node);
    const overflowY = style.overflowY;
    if ((overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
        node.scrollHeight > node.clientHeight + 1) {
      return node;
    }
    node = node.parentElement;
  }
  return window;
}

function getScrollTop(target: HTMLElement | Window): number {
  return target instanceof Window
    ? (target.scrollY || document.documentElement.scrollTop)
    : target.scrollTop;
}

function setScrollTop(target: HTMLElement | Window, value: number): void {
  if (target instanceof Window) target.scrollTo(target.scrollX, value);
  else target.scrollTop = value;
}

function getViewportHeight(target: HTMLElement | Window): number {
  return target instanceof Window ? target.innerHeight : target.clientHeight;
}

function getViewportTop(target: HTMLElement | Window): number {
  return target instanceof Window ? 0 : target.getBoundingClientRect().top;
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
    private animTarget: HTMLElement | Window | null = null;

    constructor(_view: EditorView) {}

    update(update: { docChanged: boolean; selectionSet: boolean; state: EditorView["state"]; startState: EditorView["state"]; transactions: readonly { effects: readonly { is: (e: typeof setTypewriterEnabled) => boolean; value: boolean }[] }[]; view: EditorView }) {
      if (!update.state.field(typewriterEnabled, false)) return;
      // Re-center on enable so the caret lands at viewport center immediately
      // (not just after the next keystroke).
      const justEnabled = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(setTypewriterEnabled) && e.value === true),
      );
      if (!update.docChanged && !update.selectionSet && !justEnabled) return;
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
      const scrollTarget = findScrollContainer(view.scrollDOM);
      const viewportTop = getViewportTop(scrollTarget);
      const viewportH = getViewportHeight(scrollTarget);
      const caretMid = (coords.top + coords.bottom) / 2;
      const viewportCenter = viewportTop + viewportH / 2;
      const offsetFromCenter = caretMid - viewportCenter;

      // Deadzone: caret may roam ~3 lines from center before the page follows.
      // Inside the zone, nothing scrolls — typing feels natural, screen stays
      // still. Cross the zone edge and the screen re-centers smoothly.
      const lineH = view.defaultLineHeight || (coords.bottom - coords.top) || 20;
      const deadzone = lineH * 3;
      if (Math.abs(offsetFromCenter) <= deadzone) return;

      const current = getScrollTop(scrollTarget);
      const target = Math.max(0, current + offsetFromCenter);
      if (Math.abs(target - current) < 1.5) return;

      // Respect reduced motion preference.
      if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setScrollTop(scrollTarget, target);
        return;
      }

      this.animTarget = scrollTarget;
      this.animFrom = current;
      this.animTo = target;
      this.animStart = performance.now();
      if (!this.animating) {
        this.animating = true;
        this.tick();
      }
    }

    private tick() {
      requestAnimationFrame(() => {
        const target = this.animTarget;
        if (!target) { this.animating = false; return; }
        const elapsed = performance.now() - this.animStart;
        const t = Math.min(1, elapsed / SMOOTH_DURATION_MS);
        const eased = easeOutCubic(t);
        setScrollTop(target, this.animFrom + (this.animTo - this.animFrom) * eased);
        if (t < 1) {
          this.tick();
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
