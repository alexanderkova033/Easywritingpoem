import { Facet, StateEffect, StateField, type Transaction } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { SpellMode } from "@/workshop/library/local-draft-storage";
import { loadPersonalDictionary, loadSessionIgnores } from "@/spellcheck/personal-dictionary";
import { SPELL_ANALYSIS_DEBOUNCE_MS } from "@/spellcheck/spell-timing";
import { spellErrorRangesFromText } from "@/spellcheck/scan";

export const spellSyncFacet = Facet.define<number, number>({
  combine: (xs) => xs[xs.length - 1] ?? 0,
});

type SpellCtx = () => { dict: Set<string> | null; mode: SpellMode };

let spellContext: SpellCtx = () => ({ dict: null, mode: "permissive" });

/** Call each render (or via layout effect) so the plugin reads fresh dict/mode. */
export function bindSpellContext(fn: SpellCtx): void {
  spellContext = fn;
}

const setSpellDeco = StateEffect.define<DecorationSet>();

const spellField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value: DecorationSet, tr: Transaction) {
    for (const e of tr.effects) {
      if (e.is(setSpellDeco)) return e.value;
    }
    return tr.docChanged ? value.map(tr.changes) : value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const spellPlugin = ViewPlugin.fromClass(
  class {
    private timeout: ReturnType<typeof setTimeout> | undefined;
    private lastRev = -1;
    private disposed = false;

    constructor(private view: EditorView) {
      this.schedule();
    }

    update(u: ViewUpdate) {
      const rev = u.state.facet(spellSyncFacet);
      if (u.docChanged || rev !== this.lastRev) {
        this.lastRev = rev;
        this.schedule();
      }
    }

    private schedule() {
      clearTimeout(this.timeout);
      this.timeout = setTimeout(() => this.run(), SPELL_ANALYSIS_DEBOUNCE_MS);
    }

    private run() {
      if (this.disposed) return;
      const { dict, mode } = spellContext();
      if (!dict) {
        this.safeDispatch(setSpellDeco.of(Decoration.none));
        return;
      }
      const state = this.view.state;
      const text = state.doc.toString();
      // Cursor positions — skip any error range that the cursor sits inside
      // so in-progress words are never underlined until the word is finished.
      const cursorPositions = state.selection.ranges
        .filter((r) => r.empty)
        .map((r) => r.from);
      const ranges = spellErrorRangesFromText(
        text,
        dict,
        loadPersonalDictionary(),
        loadSessionIgnores(),
        mode,
      ).filter((r) => !cursorPositions.some((pos) => pos >= r.from && pos <= r.to));
      const deco = ranges.map((r) =>
        Decoration.mark({ class: "cm-spell-error" }).range(r.from, r.to),
      );
      this.safeDispatch(setSpellDeco.of(Decoration.set(deco)));
    }

    private safeDispatch(effect: StateEffect<DecorationSet>) {
      try {
        if (this.disposed) return;
        this.view.dispatch({ effects: effect });
      } catch {
        /* view may be tearing down */
      }
    }

    destroy() {
      this.disposed = true;
      clearTimeout(this.timeout);
    }
  },
);

export const poemSpellExtensions = [spellField, spellPlugin];

export const poemEditorTheme = EditorView.theme({
  "&": {
    fontSize: "var(--poem-font-size, 1rem)",
    minHeight: "13rem",
    backgroundColor: "var(--bg)",
    color: "color-mix(in srgb, var(--text) 82%, transparent)",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    transition: "border-color 0.2s ease",
  },
  ".cm-scroller": { fontFamily: "inherit", overflowX: "hidden" },
  ".cm-content": {
    fontFamily: "var(--font-poem), Georgia, serif",
    fontWeight: "var(--poem-font-weight, 400)",
    textDecoration: "var(--poem-text-decoration, none)",
    lineHeight: "var(--poem-line-height, 1.65)",
    letterSpacing: "var(--poem-letter-spacing, 0em)",
    caretColor: "color-mix(in srgb, var(--accent) 70%, var(--text))",
    minHeight: "13rem",
    padding: "0.6rem 0.7rem",
  },
  ".cm-gutters": {
    backgroundColor: "var(--surface)",
    color: "var(--muted)",
    borderRight: "1px solid var(--border)",
    borderTopLeftRadius: "8px",
    borderBottomLeftRadius: "8px",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "color-mix(in srgb, var(--accent) 4%, var(--surface))",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--accent) 3.5%, transparent)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeft:
      "1.5px solid color-mix(in srgb, var(--accent) 72%, var(--muted))",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 0.35rem 0 0.5rem" },
  /* Match global ::selection — avoid system / default light fill */
  ".cm-selectionBackground": {
    background: "var(--selection-bg) !important",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    background:
      "color-mix(in srgb, var(--selection-bg) 96%, var(--accent)) !important",
  },
  ".cm-focused": {
    outline: "2px solid color-mix(in srgb, var(--accent) 42%, var(--border))",
    outlineOffset: "1px",
  },
});
