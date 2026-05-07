import { EditorView, ViewPlugin, WidgetType, placeholder, gutter, GutterMarker, type ViewUpdate } from "@codemirror/view";
import { StateEffect, StateField, EditorState, Transaction, RangeSetBuilder, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { lineFocusExtension, setLineFocusEnabled } from "@/workshop/editor/line-focus-extension";
import { highlightSelectionMatches, search } from "@codemirror/search";
import { countSyllablesInLine } from "@/workshop/analysis/syllables";
import type { MutableRefObject } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { ExternalChange } from "@uiw/react-codemirror";
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

// ---- Per-line font scaling: shrink long lines to fit without wrapping ----
const lineFontScalePlugin = ViewPlugin.fromClass(
  class {
    private rafId = 0;
    constructor(view: EditorView) { this.schedule(view); }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.geometryChanged) {
        this.schedule(u.view);
      }
    }
    schedule(view: EditorView) {
      cancelAnimationFrame(this.rafId);
      this.rafId = requestAnimationFrame(() => this.scale(view));
    }
    scale(view: EditorView) {
      const scroller = view.scrollDOM;
      const contentEl = view.contentDOM;
      const gutters = scroller.querySelector<HTMLElement>(".cm-gutters");
      const gutterW = gutters ? gutters.offsetWidth : 0;
      const cs = getComputedStyle(contentEl);
      const paddingX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const availW = scroller.clientWidth - gutterW - paddingX;
      if (availW <= 50) return;
      const lines = contentEl.querySelectorAll<HTMLElement>(".cm-line");
      lines.forEach((l) => { l.style.fontSize = ""; });
      void contentEl.offsetWidth; // force reflow before measuring
      lines.forEach((l) => {
        if (!l.childNodes.length) return;
        const range = document.createRange();
        range.selectNodeContents(l);
        const rects = range.getClientRects();
        if (!rects.length) return;
        let maxRight = -Infinity, minLeft = Infinity;
        for (const r of rects) {
          if (r.width < 1) continue;
          maxRight = Math.max(maxRight, r.right);
          minLeft = Math.min(minLeft, r.left);
        }
        if (!isFinite(maxRight) || !isFinite(minLeft)) return;
        const textW = maxRight - minLeft;
        if (textW > availW + 1) {
          const base = parseFloat(getComputedStyle(l).fontSize);
          const scaled = Math.max(base * (availW / textW), 8);
          l.style.fontSize = `${scaled.toFixed(2)}px`;
        }
      });
    }
    destroy() { cancelAnimationFrame(this.rafId); }
  }
);

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

// ---- Issue gutter markers ---- //
class SeverityDot extends GutterMarker {
  constructor(readonly sev: string) { super(); }
  eq(other: SeverityDot) { return other.sev === this.sev; }
  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-issue-dot cm-issue-dot-${this.sev}`;
    el.setAttribute("aria-hidden", "true");
    return el;
  }
}

const setIssueGutter = StateEffect.define<Array<[number, string]>>();
const clearIssueGutter = StateEffect.define<void>();

const issueGutterField = StateField.define<Map<number, string>>({
  create() { return new Map(); },
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) {
      if (e.is(setIssueGutter)) { next = new Map(e.value); }
      if (e.is(clearIssueGutter)) { next = new Map(); }
    }
    return next;
  },
});

const issueGutterExtension = gutter({
  class: "cm-issue-gutter",
  markers(view) {
    const dotMap = view.state.field(issueGutterField);
    const builder = new RangeSetBuilder<GutterMarker>();
    if (dotMap.size === 0) return builder.finish();
    const sorted = [...dotMap.entries()].sort((a, b) => a[0] - b[0]);
    for (const [lineNo, sev] of sorted) {
      try {
        const line = view.state.doc.line(lineNo);
        builder.add(line.from, line.from, new SeverityDot(sev));
      } catch { /* line out of range */ }
    }
    return builder.finish();
  },
  initialSpacer: () => new SeverityDot("low"),
});

// ---- Word-level problem highlights ---- //
const setWordHighlights = StateEffect.define<Array<{ words: string[]; lineStart: number; lineEnd: number; severity?: string }>>();
const clearWordHighlights = StateEffect.define<void>();

const wordHighlightField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(clearWordHighlights)) { next = Decoration.none; }
      if (e.is(setWordHighlights)) {
        const decos: Range<Decoration>[] = [];
        const doc = tr.state.doc;
        for (const { words, lineStart, lineEnd, severity } of e.value) {
          if (!words.length) continue;
          const cls = severity === "high"
            ? "cm-word-issue cm-word-issue-high"
            : severity === "medium"
              ? "cm-word-issue cm-word-issue-medium"
              : "cm-word-issue cm-word-issue-low";
          const startLine = Math.max(1, lineStart);
          const endLine = Math.min(doc.lines, lineEnd);
          for (let n = startLine; n <= endLine; n++) {
            const line = doc.line(n);
            const text = line.text.toLowerCase();
            for (const word of words) {
              const needle = word.toLowerCase();
              let pos = 0;
              while (pos < text.length) {
                const idx = text.indexOf(needle, pos);
                if (idx === -1) break;
                decos.push(Decoration.mark({ class: cls }).range(line.from + idx, line.from + idx + needle.length));
                pos = idx + needle.length;
              }
            }
          }
        }
        decos.sort((a, b) => a.from - b.from || a.to - b.to);
        try { next = Decoration.set(decos, true); } catch { next = Decoration.none; }
      }
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
  /** Severity dot markers in the gutter for lines with AI issues. */
  issueGutterMarkers?: Array<[number, number, string?]>;
  /** Word-level problem highlights from AI issues. */
  wordHighlights?: Array<{ words: string[]; lineStart: number; lineEnd: number; severity?: string }>;
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

  // Gutter severity dots
  useEffect(() => {
    const view = props.editorViewRef.current;
    if (!view) return;
    const markers = props.issueGutterMarkers;
    if (!markers || markers.length === 0) {
      try { view.dispatch({ effects: clearIssueGutter.of(undefined) }); } catch { /* ignore */ }
      return;
    }
    // Expand line ranges to individual lines with their worst severity
    const dotMap = new Map<number, string>();
    const sevOrder = (s?: string) => s === "high" ? 2 : s === "medium" ? 1 : 0;
    try {
      const lineCount = view.state.doc.lines;
      for (const [start, end, sev] of markers) {
        for (let n = start; n <= Math.min(end, lineCount); n++) {
          const existing = dotMap.get(n);
          if (!existing || sevOrder(sev) > sevOrder(existing)) dotMap.set(n, sev ?? "low");
        }
      }
    } catch { /* ignore */ }
    try {
      view.dispatch({ effects: setIssueGutter.of([...dotMap.entries()]) });
    } catch { /* ignore */ }
  }, [props.editorViewRef, props.issueGutterMarkers]);

  // Word-level highlights
  useEffect(() => {
    const view = props.editorViewRef.current;
    if (!view) return;
    const wh = props.wordHighlights;
    if (!wh || wh.length === 0) {
      try { view.dispatch({ effects: clearWordHighlights.of(undefined) }); } catch { /* ignore */ }
      return;
    }
    try { view.dispatch({ effects: setWordHighlights.of(wh) }); } catch { /* ignore */ }
  }, [props.editorViewRef, props.wordHighlights]);

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
      // Prevent poem-load/suggestion-apply transactions from polluting undo history.
      // react-codemirror marks external value changes with ExternalChange; we intercept
      // them and annotate addToHistory=false so Ctrl+Z can't undo past the loaded state.
      EditorState.transactionExtender.of((tr) =>
        tr.annotation(ExternalChange) ? { annotations: Transaction.addToHistory.of(false) } : null
      ),
      lineFontScalePlugin,
      EditorView.contentAttributes.of({ spellcheck: "true" }),
      spellSyncFacet.of(spellFacetValue(props.spellBump, props.spellMode)),
      search({ top: true }),
      highlightSelectionMatches(),
      lineFlashField,
      issueHighlightField,
      persistentIssueDecosField,
      issueGutterField,
      issueGutterExtension,
      wordHighlightField,
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
  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
            if (text.length >= 1 && update.selectionSet) {
              if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current);
              const view = update.view;
              const to = sel.to;
              selectionTimerRef.current = setTimeout(() => {
                const coords = view.coordsAtPos(to);
                if (coords) {
                  const rect = new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
                  selectionCallbackRef.current?.(text, rect);
                }
              }, 200);
            }
          } else if (update.selectionSet) {
            if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current);
            selectionCallbackRef.current(null, null);
          }
        }}
      />
    </div>
  );
}
