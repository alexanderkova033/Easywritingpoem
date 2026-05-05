import { EditorView, ViewPlugin, WidgetType, placeholder } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { lineFocusExtension, setLineFocusEnabled } from "@/workshop/editor/line-focus-extension";
import { highlightSelectionMatches, search } from "@codemirror/search";
import { countSyllablesInLine } from "@/workshop/analysis/syllables";
import type { MutableRefObject } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { basicSetup } from "@uiw/codemirror-extensions-basic-setup";
import {
  bindSpellContext,
  poemEditorTheme,
  poemSpellExtensions,
  spellSyncFacet,
} from "@/workshop/editor/spell-highlight";
import {
  formatMarksExtension,
  formatMarksTheme,
} from "@/workshop/editor/format-marks";
import type { SpellMode } from "@/workshop/library/local-draft-storage";

// ---- Syllable count + rhythm bar widgets ----
class SyllableWidget extends WidgetType {
  constructor(readonly count: number, readonly pct: number) { super(); }
  eq(other: SyllableWidget) { return other.count === this.count && other.pct === this.pct; }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-syllable-wrap";
    wrap.setAttribute("aria-hidden", "true");

    const bar = document.createElement("span");
    bar.className = "cm-rhythm-bar";
    bar.style.setProperty("--bar-pct", `${this.pct}%`);

    const num = document.createElement("span");
    num.className = "cm-syllable-count";
    num.textContent = `${this.count}`;

    wrap.append(bar, num);
    return wrap;
  }
  ignoreEvent() { return true; }
}

const syllableCountPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    update(update: { docChanged: boolean; view: EditorView }) {
      if (update.docChanged) this.decorations = this.build(update.view);
    }
    build(view: EditorView): DecorationSet {
      // First pass: collect counts to find max for scaling bars
      const counts: { lineNo: number; to: number; count: number }[] = [];
      for (let i = 1; i <= view.state.doc.lines; i++) {
        const line = view.state.doc.line(i);
        if (!line.text.trim()) continue;
        const count = countSyllablesInLine(line.text);
        if (count === 0) continue;
        counts.push({ lineNo: i, to: line.to, count });
      }
      const maxCount = counts.reduce((m, c) => Math.max(m, c.count), 1);
      // Second pass: render widget with proportional bar
      const decos = counts.map(({ to, count }) =>
        Decoration.widget({
          widget: new SyllableWidget(count, Math.round((count / maxCount) * 100)),
          side: 1,
        }).range(to),
      );
      return Decoration.set(decos);
    }
  },
  { decorations: (v) => v.decorations },
);

/** Facet must change on the same render as spellMode (not only after a spellBump effect). */
function spellFacetValue(spellBump: number, spellMode: SpellMode): number {
  return spellBump * 2 + (spellMode === "strict" ? 1 : 0);
}

const setLineFlash = StateEffect.define<DecorationSet>();
const clearLineFlash = StateEffect.define<void>();

const lineFlashField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setLineFlash)) next = e.value;
      if (e.is(clearLineFlash)) next = Decoration.none;
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const setIssueHighlight = StateEffect.define<DecorationSet>();
const clearIssueHighlight = StateEffect.define<void>();

const issueHighlightField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setIssueHighlight)) next = e.value;
      if (e.is(clearIssueHighlight)) next = Decoration.none;
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// Persistent (always-on) highlights for all AI issues after analysis
const setPersistentIssueDecos = StateEffect.define<DecorationSet>();
const clearPersistentIssueDecos = StateEffect.define<void>();

const persistentIssueDecosField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setPersistentIssueDecos)) next = e.value;
      if (e.is(clearPersistentIssueDecos)) next = Decoration.none;
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export interface PoemBodyEditorProps {
  value: string;
  /** Increment when `value` was set by the workshop (not from the debounced editor pipeline). */
  bodySyncNonce: number;
  onLiveBody: (value: string) => void;
  editorViewRef: MutableRefObject<EditorView | null>;
  wordlist: Set<string> | null;
  spellMode: SpellMode;
  spellBump: number;
  jumpLine?: number | null;
  jumpBump?: number;
  issueHighlight?: [number, number, string?] | null;
  /** Persistent dim highlights for all AI issue line ranges after analysis. */
  persistentIssueHighlights?: Array<[number, number, string?]>;
  /** Per-line syllable counts at end of each line (CodeMirror widgets). */
  showLineSyllables?: boolean;
  /** Dim non-active lines very subtly (typewriter focus mode). */
  lineFocusMode?: boolean;
  /** Called when user selects text; null means selection cleared. */
  onSelectionText?: (text: string | null, rect: DOMRect | null) => void;
  id?: string;
  "aria-describedby"?: string;
}

export function PoemBodyEditor(props: PoemBodyEditorProps) {
  bindSpellContext(() => ({
    dict: props.wordlist,
    mode: props.spellMode,
  }));

  const lastBodySyncNonce = useRef(props.bodySyncNonce);
  const [localValue, setLocalValue] = useState(() => props.value);

  useLayoutEffect(() => {
    if (props.bodySyncNonce !== lastBodySyncNonce.current) {
      lastBodySyncNonce.current = props.bodySyncNonce;
      setLocalValue(props.value);
    }
  }, [props.bodySyncNonce, props.value]);

  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!props.jumpBump) return;
    const view = props.editorViewRef.current;
    const n = props.jumpLine;
    if (!view || !n || n < 1) return;
    try {
      const line = view.state.doc.line(n);
      const deco = Decoration.line({ class: "cm-line-flash" }).range(line.from);
      view.dispatch({ effects: setLineFlash.of(Decoration.set([deco])) });
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => {
        try {
          view.dispatch({ effects: clearLineFlash.of(undefined) });
        } catch {
          /* ignore */
        }
      }, 900);
    } catch {
      // line out of range
    }
  }, [props.editorViewRef, props.jumpBump, props.jumpLine]);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  // Persistent dim highlights for all AI issue lines (updated after each analysis run)
  useEffect(() => {
    const view = props.editorViewRef.current;
    if (!view) return;
    const highlights = props.persistentIssueHighlights;
    if (!highlights || highlights.length === 0) {
      try { view.dispatch({ effects: clearPersistentIssueDecos.of(undefined) }); } catch { /* ignore */ }
      return;
    }
    try {
      const decos = [];
      const lineCount = view.state.doc.lines;
      for (const [startLine, endLine, sev] of highlights) {
        const sevClass = sev === "high"
          ? "cm-line-issue-persistent cm-line-issue-persist-high"
          : sev === "medium"
            ? "cm-line-issue-persistent cm-line-issue-persist-medium"
            : "cm-line-issue-persistent cm-line-issue-persist-low";
        for (let n = startLine; n <= Math.min(endLine, lineCount); n++) {
          const line = view.state.doc.line(n);
          decos.push(Decoration.line({ class: sevClass }).range(line.from));
        }
      }
      view.dispatch({
        effects: decos.length > 0
          ? setPersistentIssueDecos.of(Decoration.set(decos))
          : clearPersistentIssueDecos.of(undefined),
      });
    } catch { /* line out of range */ }
  }, [props.editorViewRef, props.persistentIssueHighlights]);

  // Issue highlight: strong background on hovered/active AI issue lines + scroll into view
  useEffect(() => {
    const view = props.editorViewRef.current;
    if (!view) return;
    const range = props.issueHighlight;
    if (!range) {
      try { view.dispatch({ effects: clearIssueHighlight.of(undefined) }); } catch { /* ignore */ }
      return;
    }
    try {
      const [startLine, endLine, sev] = range;
      const sevClass = sev === "high"
        ? "cm-line-issue-highlight cm-line-issue-high"
        : sev === "medium"
          ? "cm-line-issue-highlight cm-line-issue-medium"
          : "cm-line-issue-highlight cm-line-issue-low";
      const decos = [];
      const lineCount = view.state.doc.lines;
      for (let n = startLine; n <= Math.min(endLine, lineCount); n++) {
        const line = view.state.doc.line(n);
        decos.push(Decoration.line({ class: sevClass }).range(line.from));
      }
      view.dispatch({
        effects: setIssueHighlight.of(Decoration.set(decos)),
      });
    } catch { /* line out of range */ }
  }, [props.editorViewRef, props.issueHighlight]);

  const showSyllables = props.showLineSyllables !== false;

  // Sync line-focus enabled state into the CM state field when the prop changes
  useEffect(() => {
    const view = props.editorViewRef.current;
    if (!view) return;
    try { view.dispatch({ effects: setLineFocusEnabled.of(props.lineFocusMode ?? false) }); } catch { /* ignore */ }
  }, [props.editorViewRef, props.lineFocusMode]);

  const extensions = useMemo(
    () => [
      EditorView.contentAttributes.of({ spellcheck: "true" }),
      spellSyncFacet.of(spellFacetValue(props.spellBump, props.spellMode)),
      search({ top: true }),
      highlightSelectionMatches(),
      lineFlashField,
      issueHighlightField,
      persistentIssueDecosField,
      ...lineFocusExtension,
      placeholder("Start writing…"),
      ...(showSyllables ? [syllableCountPlugin] : []),
      ...poemSpellExtensions,
      formatMarksExtension,
      formatMarksTheme,
      ...basicSetup(),
      poemEditorTheme,
    ],
    [props.spellBump, props.spellMode, showSyllables],
  );

  const selectionCallbackRef = useRef(props.onSelectionText);
  selectionCallbackRef.current = props.onSelectionText;

  return (
    <div className="poem-cm-wrap" id={props.id}>
      <CodeMirror
        aria-describedby={props["aria-describedby"]}
        value={localValue}
        height="auto"
        theme="none"
        extensions={extensions}
        onChange={(v) => {
          setLocalValue(v);
          props.onLiveBody(v);
        }}
        onCreateEditor={(view) => {
          props.editorViewRef.current = view;
        }}
        onUpdate={(update) => {
          if (!selectionCallbackRef.current) return;
          const sel = update.state.selection.main;
          if (!sel.empty) {
            const text = update.state.sliceDoc(sel.from, sel.to).trim();
            if (text.length >= 3 && update.selectionSet) {
              const coords = update.view.coordsAtPos(sel.head);
              if (coords) {
                const rect = new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
                selectionCallbackRef.current(text, rect);
              }
            }
          } else if (update.selectionSet) {
            selectionCallbackRef.current(null, null);
          }
        }}
      />
    </div>
  );
}
