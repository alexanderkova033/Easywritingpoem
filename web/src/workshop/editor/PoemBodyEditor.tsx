import { EditorView, ViewPlugin, WidgetType, keymap, placeholder, gutter, GutterMarker, type ViewUpdate } from "@codemirror/view";
import { StateEffect, StateField, EditorState, Transaction, RangeSet, RangeSetBuilder, type Range } from "@codemirror/state";
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
// We use CM line decorations (not direct DOM mutation) so CM owns the style
// and its MutationObserver won't fight us and reset the font back.

const setLineFontScaleDecos = StateEffect.define<DecorationSet>();

const lineFontScaleField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setLineFontScaleDecos)) return e.value;
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const lineFontScalePlugin = ViewPlugin.fromClass(
  class {
    private rafId = 0;
    private lastW = 0;
    private ro: ResizeObserver;
    constructor(view: EditorView) {
      this.lastW = view.scrollDOM.clientWidth;
      this.ro = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width ?? 0;
        if (Math.abs(w - this.lastW) > 0.5) {
          this.lastW = w;
          this.schedule(view);
        }
      });
      this.ro.observe(view.scrollDOM);
      this.schedule(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.schedule(u.view);
    }
    schedule(view: EditorView) {
      cancelAnimationFrame(this.rafId);
      this.rafId = requestAnimationFrame(() => this.measureAndApply(view));
    }
    measureAndApply(view: EditorView) {
      const scroller = view.scrollDOM;
      const contentEl = view.contentDOM;
      const gutters = scroller.querySelector<HTMLElement>(".cm-gutters");
      const gutterW = gutters ? gutters.offsetWidth : 0;
      const cs = getComputedStyle(contentEl);
      const paddingX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const availW = scroller.clientWidth - gutterW - paddingX;
      if (availW <= 50) return;

      // Step 1: remove all scale decorations so lines render at their natural size.
      // CM's dispatch() applies DOM changes synchronously, so the DOM reflects
      // natural sizes immediately when we measure below.
      view.dispatch({ effects: setLineFontScaleDecos.of(Decoration.none) });

      // Step 2: measure each line at its natural (unscaled) width
      const lineEls = contentEl.querySelectorAll<HTMLElement>(".cm-line");
      const decos: Range<Decoration>[] = [];
      const docLineCount = view.state.doc.lines;

      for (let i = 0; i < lineEls.length && i < docLineCount; i++) {
        const el = lineEls[i];
        let maxRight = -Infinity, minLeft = Infinity;
        for (const node of el.childNodes) {
          const child = node as HTMLElement;
          if (child.nodeType === Node.ELEMENT_NODE && child.classList?.contains("cm-syllable-wrap")) continue;
          const r = document.createRange();
          r.selectNode(node);
          for (const rect of r.getClientRects()) {
            if (rect.width < 1) continue;
            maxRight = Math.max(maxRight, rect.right);
            minLeft = Math.min(minLeft, rect.left);
          }
        }
        if (!isFinite(maxRight) || !isFinite(minLeft)) continue;
        const textW = maxRight - minLeft;
        if (textW > availW + 1) {
          const base = parseFloat(getComputedStyle(el).fontSize);
          const scaled = Math.max(base * (availW / textW), 8);
          const docLine = view.state.doc.line(i + 1);
          decos.push(
            Decoration.line({ attributes: { style: `font-size:${scaled.toFixed(2)}px` } })
              .range(docLine.from),
          );
        }
      }

      // Step 3: apply the new scale decorations (CM owns these, won't reset them)
      view.dispatch({ effects: setLineFontScaleDecos.of(decos.length ? Decoration.set(decos) : Decoration.none) });
    }
    destroy() {
      cancelAnimationFrame(this.rafId);
      this.ro.disconnect();
    }
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

// Gutter dots are anchored at line.from positions and mapped through doc
// changes so they follow the line as the user types — line-number-keyed
// storage made the dots drift away from the line they were marking.
const setIssueGutter = StateEffect.define<Array<{ pos: number; sev: string }>>();
const clearIssueGutter = StateEffect.define<void>();

const issueGutterField = StateField.define<RangeSet<GutterMarker>>({
  create() { return RangeSet.empty; },
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(clearIssueGutter)) next = RangeSet.empty;
      if (e.is(setIssueGutter)) {
        const builder = new RangeSetBuilder<GutterMarker>();
        const sorted = [...e.value].sort((a, b) => a.pos - b.pos);
        for (const { pos, sev } of sorted) {
          builder.add(pos, pos, new SeverityDot(sev));
        }
        next = builder.finish();
      }
    }
    return next;
  },
});

// Module-level handler ref so the gutter extension (defined once) can call
// the latest React callback. Only one editor instance runs at a time.
const gutterDotClickHandler: { fn: ((line: number) => void) | null } = { fn: null };
const applyRewriteHandler: { fn: ((line: number) => boolean) | null } = { fn: null };

const applyRewriteKeymap = keymap.of([
  {
    key: "Alt-Enter",
    run(view) {
      const fn = applyRewriteHandler.fn;
      if (!fn) return false;
      const lineNo = view.state.doc.lineAt(view.state.selection.main.from).number;
      return fn(lineNo);
    },
  },
]);

const issueGutterExtension = gutter({
  class: "cm-issue-gutter",
  markers: (view) => view.state.field(issueGutterField),
  initialSpacer: () => new SeverityDot("low"),
  domEventHandlers: {
    click(view, line) {
      const set = view.state.field(issueGutterField);
      let hit = false;
      set.between(line.from, line.from, () => { hit = true; });
      if (!hit) return false;
      const lineNo = view.state.doc.lineAt(line.from).number;
      gutterDotClickHandler.fn?.(lineNo);
      return true;
    },
  },
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
  /** Called when the user clicks a severity dot in the gutter. */
  onGutterDotClick?: (line: number) => void;
  /** Called when the cursor parks on a different line for ~400ms. */
  onCursorLineChange?: (line: number) => void;
  /** Alt+Enter on a flagged line — apply that issue's rewrite if available. */
  onApplyRewriteAtCursor?: (line: number) => boolean;
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

  // Persistent line-bg highlight intentionally disabled — it tinted entire
  // line ranges around every issue and made the editor feel cluttered. Issues
  // are surfaced via the gutter severity dots and the word-level highlights.
  // The hover/active issue still fires the strong `setIssueHighlight` effect.
  useEffect(() => {
    const view = props.editorViewRef.current;
    if (!view) return;
    try { view.dispatch({ effects: clearPersistentIssueDecos.of(undefined) }); } catch { /* ignore */ }
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
    // Paint a single dot at line_start per issue — multi-line ranges should
    // not blanket every adjacent line with markers.
    const dotMap = new Map<number, string>();
    const sevOrder = (s?: string) => s === "high" ? 2 : s === "medium" ? 1 : 0;
    const entries: Array<{ pos: number; sev: string }> = [];
    try {
      const lineCount = view.state.doc.lines;
      for (const [start, , sev] of markers) {
        if (start < 1 || start > lineCount) continue;
        const existing = dotMap.get(start);
        if (!existing || sevOrder(sev) > sevOrder(existing)) dotMap.set(start, sev ?? "low");
      }
      for (const [lineNo, sev] of dotMap) {
        const line = view.state.doc.line(lineNo);
        entries.push({ pos: line.from, sev });
      }
    } catch { /* ignore */ }
    try {
      view.dispatch({ effects: setIssueGutter.of(entries) });
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

  // Forward latest gutter-dot click callback to the module-level extension.
  useEffect(() => {
    gutterDotClickHandler.fn = props.onGutterDotClick ?? null;
    return () => { gutterDotClickHandler.fn = null; };
  }, [props.onGutterDotClick]);

  useEffect(() => {
    applyRewriteHandler.fn = props.onApplyRewriteAtCursor ?? null;
    return () => { applyRewriteHandler.fn = null; };
  }, [props.onApplyRewriteAtCursor]);

  const extensions = useMemo(
    () => [
      // Prevent poem-load/suggestion-apply transactions from polluting undo history.
      // react-codemirror marks external value changes with ExternalChange; we intercept
      // them and annotate addToHistory=false so Ctrl+Z can't undo past the loaded state.
      EditorState.transactionExtender.of((tr) =>
        tr.annotation(ExternalChange) ? { annotations: Transaction.addToHistory.of(false) } : null
      ),
      lineFontScaleField,
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
      applyRewriteKeymap,
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

  const cursorLineCallbackRef = useRef(props.onCursorLineChange);
  cursorLineCallbackRef.current = props.onCursorLineChange;
  const cursorLineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCursorLineRef = useRef<number>(-1);

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
          // Debounced cursor-line tracker — fires when the cursor parks on a
          // different line for ~400ms, lets parent open the matching issue.
          if (cursorLineCallbackRef.current && (update.docChanged || update.selectionSet)) {
            const sel = update.state.selection.main;
            if (sel.empty) {
              const lineNo = update.state.doc.lineAt(sel.from).number;
              if (lineNo !== lastCursorLineRef.current) {
                lastCursorLineRef.current = lineNo;
                if (cursorLineTimerRef.current) clearTimeout(cursorLineTimerRef.current);
                cursorLineTimerRef.current = setTimeout(() => {
                  cursorLineCallbackRef.current?.(lineNo);
                }, 400);
              }
            }
          }
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
