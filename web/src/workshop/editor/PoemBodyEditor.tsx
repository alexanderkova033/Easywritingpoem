import { EditorView, ViewPlugin, WidgetType, keymap, placeholder, gutter, GutterMarker, type ViewUpdate } from "@codemirror/view";
import { StateEffect, StateField, EditorState, Transaction, RangeSet, RangeSetBuilder, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { lineFocusExtension, setLineFocusMode, type LineFocusMode } from "@/workshop/editor/line-focus-extension";
import { typewriterExtension, setTypewriterEnabled } from "@/workshop/editor/typewriter-extension";
import { diffOverlayField, setDiffSnapshot } from "@/workshop/editor/diff-overlay";
import "@/workshop/editor/diff-overlay.css";
import { highlightSelectionMatches, search } from "@codemirror/search";
import { countSyllablesInLine } from "@/workshop/meter/syllables";
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

// Touch devices (iOS Safari, Android Chrome, iPad) struggle with the heaviest
// live-update decoration plugins. Detect once at module load; matchMedia result
// is stable for the session and avoids recomputing extensions per render.
const IS_TOUCH_DEVICE: boolean =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

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

function activeLineNumber(view: EditorView): number {
  if (!view.hasFocus) return -1;
  return view.state.doc.lineAt(view.state.selection.main.head).number;
}

const syllableCountPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private lastActiveLine = -2;
    // Per-line text cache — typing on one line reuses every other line's
    // memoised count instead of recomputing all N lines per keystroke. Combined
    // with the module-level lineCache in syllables.ts, a steady-state rebuild
    // for a 50-line poem is N hash lookups, not N word-tokenisations.
    private lineTexts: string[] = [];
    private lineCounts: number[] = [];
    constructor(view: EditorView) {
      this.lastActiveLine = activeLineNumber(view);
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      // Touch: skip selectionSet/focusChanged — they fire on every tap and the
      // only side effect is hiding the active-line widget. Worth the trade-off
      // to keep typing fluid on iPad. Doc changes still rebuild.
      if (IS_TOUCH_DEVICE) {
        if (update.docChanged) this.decorations = this.build(update.view);
        return;
      }
      if (update.docChanged) {
        this.decorations = this.build(update.view);
        return;
      }
      if (update.selectionSet || update.focusChanged) {
        // Only rebuild when the active line actually changed; cursor moves on
        // the same line don't affect which widget is filtered out.
        const next = activeLineNumber(update.view);
        if (next === this.lastActiveLine) return;
        this.decorations = this.build(update.view);
      }
    }
    build(view: EditorView): DecorationSet {
      const sel = view.state.selection.main;
      const activeLineNo = view.hasFocus
        ? view.state.doc.lineAt(sel.head).number
        : -1;
      this.lastActiveLine = activeLineNo;
      const doc = view.state.doc;
      const lineCount = doc.lines;
      // Resize per-line caches and recompute only lines whose text changed.
      if (this.lineTexts.length !== lineCount) {
        this.lineTexts.length = lineCount;
        this.lineCounts.length = lineCount;
      }
      const counts: { lineNo: number; to: number; count: number }[] = [];
      let maxCount = 1;
      for (let i = 1; i <= lineCount; i++) {
        const line = doc.line(i);
        const text = line.text;
        const idx = i - 1;
        let count: number;
        if (this.lineTexts[idx] === text) {
          count = this.lineCounts[idx]!;
        } else {
          count = text.trim() ? countSyllablesInLine(text) : 0;
          this.lineTexts[idx] = text;
          this.lineCounts[idx] = count;
        }
        if (count <= 0) continue;
        if (count > maxCount) maxCount = count;
        counts.push({ lineNo: i, to: line.to, count });
      }
      const decos = counts
        .filter(({ lineNo }) => lineNo !== activeLineNo)
        .map(({ to, count }) =>
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

// Strongest-line decoration — subtle gold accent for the best line in the poem.
const setStrongestLine = StateEffect.define<DecorationSet>();
const clearStrongestLine = StateEffect.define<void>();

const strongestLineField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setStrongestLine)) next = e.value;
      if (e.is(clearStrongestLine)) next = Decoration.none;
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

// ---- Rhyme scheme letter gutter (A/B/A/B per line) ---- //
class SchemeLetterMarker extends GutterMarker {
  constructor(readonly letter: string, readonly colorIdx: number) { super(); }
  eq(other: SchemeLetterMarker) { return other.letter === this.letter && other.colorIdx === this.colorIdx; }
  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-rhyme-scheme cm-rhyme-scheme-${this.colorIdx % 6}`;
    el.textContent = this.letter;
    return el;
  }
}

const setSchemeLetters = StateEffect.define<string[]>();
const clearSchemeLetters = StateEffect.define<void>();

const schemeLetterField = StateField.define<RangeSet<GutterMarker>>({
  create() { return RangeSet.empty; },
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(clearSchemeLetters)) next = RangeSet.empty;
      if (e.is(setSchemeLetters)) {
        const builder = new RangeSetBuilder<GutterMarker>();
        const labels = e.value;
        const doc = tr.state.doc;
        const colorMap = new Map<string, number>();
        for (let i = 0; i < labels.length && i < doc.lines; i++) {
          const label = labels[i];
          if (!label) continue;
          if (!colorMap.has(label)) colorMap.set(label, colorMap.size);
          const line = doc.line(i + 1);
          builder.add(line.from, line.from, new SchemeLetterMarker(label, colorMap.get(label)!));
        }
        next = builder.finish();
      }
    }
    return next;
  },
});

// ---- Rhyme end-word highlights (line → scheme letter colour key) ---- //
const setRhymeEndDecos = StateEffect.define<Array<{ line: number; colorKey: string }>>();
const clearRhymeEndDecos = StateEffect.define<void>();

const rhymeEndField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(clearRhymeEndDecos)) { next = Decoration.none; }
      if (e.is(setRhymeEndDecos)) {
        const decos: Range<Decoration>[] = [];
        const doc = tr.state.doc;
        for (const { line, colorKey } of e.value) {
          if (line < 1 || line > doc.lines) continue;
          const docLine = doc.line(line);
          const text = docLine.text;
          const re = /[a-zA-Z']+/g;
          let last: { start: number; end: number } | null = null;
          let m: RegExpExecArray | null;
          while ((m = re.exec(text)) !== null) {
            last = { start: m.index, end: m.index + m[0].length };
          }
          if (!last) continue;
          const safeKey = /^[a-z]$|^hover$/.test(colorKey) ? colorKey : "x";
          const cls = `cm-rhyme-end cm-rhyme-end-${safeKey}`;
          decos.push(Decoration.mark({ class: cls }).range(docLine.from + last.start, docLine.from + last.end));
        }
        decos.sort((a, b) => a.from - b.from || a.to - b.to);
        try { next = Decoration.set(decos, true); } catch { next = Decoration.none; }
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---- Internal-rhyme highlights (word ranges within a line) ---- //
const setInternalRhymeDecos = StateEffect.define<Array<{ line: number; ranges: Array<{ start: number; end: number }> }>>();
const clearInternalRhymeDecos = StateEffect.define<void>();

const internalRhymeField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(clearInternalRhymeDecos)) { next = Decoration.none; }
      if (e.is(setInternalRhymeDecos)) {
        const decos: Range<Decoration>[] = [];
        const doc = tr.state.doc;
        for (const { line, ranges } of e.value) {
          if (line < 1 || line > doc.lines) continue;
          const docLine = doc.line(line);
          for (const r of ranges) {
            const from = docLine.from + r.start;
            const to = docLine.from + r.end;
            if (to <= from || to > docLine.to) continue;
            decos.push(Decoration.mark({ class: "cm-rhyme-internal" }).range(from, to));
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

// ---- Line vowel tints (for the Vowel music subtab) ---- //
const setLineVowelTints = StateEffect.define<Array<{ line: number; bucket: "bright" | "mid" | "dark"; active?: boolean }>>();
const clearLineVowelTints = StateEffect.define<void>();

const lineVowelTintField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(clearLineVowelTints)) { next = Decoration.none; }
      if (e.is(setLineVowelTints)) {
        const decos: Range<Decoration>[] = [];
        const doc = tr.state.doc;
        for (const { line, bucket, active } of e.value) {
          if (line < 1 || line > doc.lines) continue;
          const docLine = doc.line(line);
          const cls = `cm-vowel-line cm-vowel-line-${bucket}${active ? " cm-vowel-line-active" : ""}`;
          decos.push(Decoration.line({ class: cls }).range(docLine.from));
        }
        decos.sort((a, b) => a.from - b.from);
        try { next = Decoration.set(decos, true); } catch { next = Decoration.none; }
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---- Flow markers (end-of-line glyph + caesura mark) ---- //
class FlowEndWidget extends WidgetType {
  constructor(readonly endStop: "hard" | "soft" | "open", readonly active: boolean) { super(); }
  eq(o: FlowEndWidget) { return o.endStop === this.endStop && o.active === this.active; }
  toDOM() {
    const el = document.createElement("span");
    const glyph = this.endStop === "hard" ? "■" : this.endStop === "soft" ? "·" : "↵";
    el.className = `cm-flow-end cm-flow-end-${this.endStop}${this.active ? " cm-flow-end-active" : ""}`;
    el.textContent = glyph;
    el.setAttribute("aria-hidden", "true");
    return el;
  }
  ignoreEvent() { return true; }
}

class FlowCaesuraWidget extends WidgetType {
  constructor(readonly active: boolean) { super(); }
  eq(o: FlowCaesuraWidget) { return o.active === this.active; }
  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-flow-caesura${this.active ? " cm-flow-caesura-active" : ""}`;
    el.textContent = "‖";
    el.setAttribute("aria-hidden", "true");
    return el;
  }
  ignoreEvent() { return true; }
}

const setFlowMarkers = StateEffect.define<Array<{ line: number; endStop: "hard" | "soft" | "open"; caesuraColumn: number | null; active?: boolean }>>();
const clearFlowMarkers = StateEffect.define<void>();

const flowMarkerField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(clearFlowMarkers)) { next = Decoration.none; }
      if (e.is(setFlowMarkers)) {
        const decos: Range<Decoration>[] = [];
        const doc = tr.state.doc;
        for (const { line, endStop, caesuraColumn, active } of e.value) {
          if (line < 1 || line > doc.lines) continue;
          const docLine = doc.line(line);
          decos.push(
            Decoration.widget({
              widget: new FlowEndWidget(endStop, !!active),
              side: 1,
            }).range(docLine.to),
          );
          if (caesuraColumn !== null && caesuraColumn > 0 && caesuraColumn < docLine.text.length) {
            decos.push(
              Decoration.widget({
                widget: new FlowCaesuraWidget(!!active),
                side: 1,
              }).range(docLine.from + caesuraColumn),
            );
          }
        }
        decos.sort((a, b) => a.from - b.from);
        try { next = Decoration.set(decos, true); } catch { next = Decoration.none; }
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---- Meter overlay: stress dots anchored on vowel positions ---- //
const setMeterOverlay = StateEffect.define<Array<{ line: number; marks: Array<{ col: number; stress: boolean }> }>>();
const clearMeterOverlay = StateEffect.define<void>();

const meterOverlayField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(clearMeterOverlay)) { next = Decoration.none; }
      if (e.is(setMeterOverlay)) {
        const decos: Range<Decoration>[] = [];
        const doc = tr.state.doc;
        for (const entry of e.value) {
          if (entry.line < 1 || entry.line > doc.lines) continue;
          const docLine = doc.line(entry.line);
          const lineLen = docLine.to - docLine.from;
          for (const mark of entry.marks) {
            if (mark.col < 0 || mark.col >= lineLen) continue;
            const from = docLine.from + mark.col;
            decos.push(
              Decoration.mark({
                class: mark.stress ? "cm-meter-syl cm-meter-syl-stress" : "cm-meter-syl cm-meter-syl-unstress",
              }).range(from, from + 1),
            );
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

// ---- Sound-echo highlights (alliteration/assonance/…) ---- //
const setEchoHighlights = StateEffect.define<Array<{ line: number; start: number; end: number; colorKey: string; color?: string }>>();
const clearEchoHighlights = StateEffect.define<void>();

const echoHighlightField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(clearEchoHighlights)) { next = Decoration.none; }
      if (e.is(setEchoHighlights)) {
        const decos: Range<Decoration>[] = [];
        const doc = tr.state.doc;
        const seen = new Set<string>();
        for (const { line, start, end, colorKey, color } of e.value) {
          if (line < 1 || line > doc.lines) continue;
          const docLine = doc.line(line);
          const from = docLine.from + start;
          const to = docLine.from + end;
          if (to <= from || to > docLine.to) continue;
          const k = `${from}-${to}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const safe = /^[a-z]+$/.test(colorKey) ? colorKey : "x";
          const attrs: Record<string, string> = color
            ? { style: `background-color: color-mix(in srgb, ${color} 38%, transparent); border-bottom-color: ${color};` }
            : {};
          decos.push(
            Decoration.mark({
              class: `cm-echo cm-echo-${safe}`,
              attributes: attrs,
            }).range(from, to),
          );
        }
        decos.sort((a, b) => a.from - b.from || a.to - b.to);
        try { next = Decoration.set(decos, true); } catch { next = Decoration.none; }
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
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

// ---- Repeat-tool persistent marks (Repeats panel subtab → editor) ---- //
// Content depends on the active subtab (words / phrases / patterns). Hue comes
// from the group's colour index; severity controls intensity. Cleared when the
// tool closes or the array empties.
const setRepeatHighlights = StateEffect.define<DecorationSet>();
const clearRepeatHighlights = StateEffect.define<void>();

const repeatHighlightField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setRepeatHighlights)) next = e.value;
      if (e.is(clearRepeatHighlights)) next = Decoration.none;
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
  spellBump: number;
  jumpLine?: number | null;
  jumpBump?: number;
  /** Scroll a line into view WITHOUT moving the cursor or focusing. */
  peekLine?: number | null;
  peekBump?: number;
  /** Subtly highlight the strongest line in the poem (from AI analysis). */
  strongestLine?: number | null;
  issueHighlight?: [number, number, string?] | null;
  /** Persistent dim highlights for all AI issue line ranges after analysis. */
  persistentIssueHighlights?: Array<[number, number, string?]>;
  /** Per-line syllable counts at end of each line (CodeMirror widgets). */
  showLineSyllables?: boolean;
  /** Dim non-active lines very subtly (typewriter focus mode).
   *  Boolean kept for back-compat: true → "line", false → "off". */
  lineFocusMode?: boolean | LineFocusMode;
  /** Keep the caret near vertical center of the viewport while typing. */
  typewriterScroll?: boolean;
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
  /** Per-line rhyme end-word highlights — colors the last word in each listed line by cluster index. */
  rhymeEndHighlights?: Array<{ line: number; colorKey: string }>;
  /** Internal-rhyme highlights — subtle marks on word ranges that rhyme with another word in the same line. */
  internalRhymes?: Array<{ line: number; ranges: Array<{ start: number; end: number }> }>;
  /** Repeat-tool highlights — one mark per occurrence of the active Repeats subtab. */
  repeatHighlights?: Array<{
    line: number;
    start: number;
    end: number;
    severity: "low" | "med" | "high";
    kind: "word" | "phrase" | "pattern";
    groupId: string;
    colorIndex: number;
    count: number;
  }>;
  /** Sound-echo highlights — words that share a sound (alliteration, assonance, etc.). */
  echoHighlights?: Array<{ line: number; start: number; end: number; colorKey: string; color?: string }>;
  /** Line-level vowel tints (Vowel music subtab). */
  lineVowelTints?: Array<{ line: number; bucket: "bright" | "mid" | "dark"; active?: boolean }>;
  /** End-stop glyphs + caesura marks (Pause & flow subtab). */
  flowMarkers?: Array<{ line: number; endStop: "hard" | "soft" | "open"; caesuraColumn: number | null; active?: boolean }>;
  /** Stress dots anchored on syllable nucleus positions per line (Stress & meter tab). */
  meterOverlay?: Array<{ line: number; marks: Array<{ col: number; stress: boolean }> }> | null;
  /** Per-line rhyme scheme letters (A/B/A/B…). Empty string skips a line. Only rendered when present. */
  rhymeSchemeLabels?: string[] | null;
  /** Receives a getter so callers can read the current cursor line synchronously. */
  cursorLineGetterRef?: MutableRefObject<(() => number) | null>;
  /** When set, render an inline word-level diff against this snapshot body. Null/undefined disables. */
  diffSnapshotBody?: string | null;
  id?: string;
  "aria-describedby"?: string;
}

export function PoemBodyEditor(props: PoemBodyEditorProps) {
  bindSpellContext(() => ({
    dict: props.wordlist,
  }));

  const lastBodySyncNonce = useRef(props.bodySyncNonce);
  const [localValue, setLocalValue] = useState(() => props.value);

  useLayoutEffect(() => {
    if (props.bodySyncNonce !== lastBodySyncNonce.current) {
      lastBodySyncNonce.current = props.bodySyncNonce;
      setLocalValue(props.value);
      // The user types directly into CodeMirror without flowing through React's
      // value prop (see onChange below). So localValue can be stale relative to
      // view.state.doc. If a resync target matches that stale React value,
      // setLocalValue is a no-op and CodeMirror's own value-watcher won't fire.
      // Push the new value straight into the view to guarantee the doc resets.
      const view = props.editorViewRef.current;
      if (view && view.state.doc.toString() !== props.value) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: props.value },
          annotations: [ExternalChange.of(true)],
        });
      }
    }
  }, [props.bodySyncNonce, props.value, props.editorViewRef]);

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

  // peekLine: scroll a line into view (centered) WITHOUT focusing or moving cursor.
  useEffect(() => {
    if (!props.peekBump) return;
    const view = props.editorViewRef.current;
    const n = props.peekLine;
    if (!view || !n || n < 1) return;
    try {
      const line = view.state.doc.line(n);
      view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
    } catch { /* ignore */ }
  }, [props.editorViewRef, props.peekBump, props.peekLine]);

  // Strongest-line decoration: subtle gold accent on the best line.
  useEffect(() => {
    const view = props.editorViewRef.current;
    if (!view) return;
    const n = props.strongestLine;
    if (!n || n < 1) {
      try { view.dispatch({ effects: clearStrongestLine.of(undefined) }); } catch { /* ignore */ }
      return;
    }
    try {
      const lineCount = view.state.doc.lines;
      if (n > lineCount) {
        view.dispatch({ effects: clearStrongestLine.of(undefined) });
        return;
      }
      const line = view.state.doc.line(n);
      const deco = Decoration.line({ class: "cm-line-strongest" }).range(line.from);
      view.dispatch({ effects: setStrongestLine.of(Decoration.set([deco])) });
    } catch { /* ignore */ }
  }, [props.editorViewRef, props.strongestLine]);

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

  // Rhyme end-word highlights
  useEffect(() => {
    const view = props.editorViewRef.current;
    if (!view) return;
    const rh = props.rhymeEndHighlights;
    if (!rh || rh.length === 0) {
      try { view.dispatch({ effects: clearRhymeEndDecos.of(undefined) }); } catch { /* ignore */ }
      return;
    }
    try { view.dispatch({ effects: setRhymeEndDecos.of(rh) }); } catch { /* ignore */ }
  }, [props.editorViewRef, props.rhymeEndHighlights]);

  // Internal-rhyme decorations
  useEffect(() => {
    const view = props.editorViewRef.current;
    if (!view) return;
    const ir = props.internalRhymes;
    if (!ir || ir.length === 0) {
      try { view.dispatch({ effects: clearInternalRhymeDecos.of(undefined) }); } catch { /* ignore */ }
      return;
    }
    try { view.dispatch({ effects: setInternalRhymeDecos.of(ir) }); } catch { /* ignore */ }
  }, [props.editorViewRef, props.internalRhymes]);

  // Repeat-tool persistent marks — one tinted span per occurrence of the
  // active Repeats subtab. Colour comes from `colorIndex`, intensity from
  // `severity`. Cleared when the Repeats tool closes or the array empties.
  useEffect(() => {
    const view = props.editorViewRef.current;
    if (!view) return;
    const rh = props.repeatHighlights;
    if (!rh || rh.length === 0) {
      try { view.dispatch({ effects: clearRepeatHighlights.of(undefined) }); } catch { /* ignore */ }
      return;
    }
    try {
      const doc = view.state.doc;
      const lineCount = doc.lines;
      const decos: Range<Decoration>[] = [];
      for (const r of rh) {
        if (r.line < 1 || r.line > lineCount) continue;
        const line = doc.line(r.line);
        const lineLen = line.to - line.from;
        const a = Math.max(0, Math.min(r.start, lineLen));
        const b = Math.max(a, Math.min(r.end, lineLen));
        if (b <= a) continue;
        // Golden-angle hue spread → distinct colour per group, no cycling.
        const hue = Math.round(((r.colorIndex * 137.508) % 360 + 360) % 360);
        const cls =
          `cm-repeat-mark cm-repeat-mark-${r.severity} cm-repeat-mark-${r.kind}`;
        decos.push(
          Decoration.mark({
            class: cls,
            attributes: {
              "data-repeat-group": r.groupId,
              "data-repeat-count": String(r.count),
              style: `--repeat-hue: ${hue} 72% 48%`,
            },
          }).range(line.from + a, line.from + b),
        );
      }
      decos.sort((a, b) => a.from - b.from || a.to - b.to);
      view.dispatch({ effects: setRepeatHighlights.of(Decoration.set(decos, true)) });
    } catch { /* ignore */ }
  }, [props.editorViewRef, props.repeatHighlights]);

  // Echo (alliteration/assonance/…) decorations
  useEffect(() => {
    const view = props.editorViewRef.current;
    if (!view) return;
    const eh = props.echoHighlights;
    if (!eh || eh.length === 0) {
      try { view.dispatch({ effects: clearEchoHighlights.of(undefined) }); } catch { /* ignore */ }
      return;
    }
    try { view.dispatch({ effects: setEchoHighlights.of(eh) }); } catch { /* ignore */ }
  }, [props.editorViewRef, props.echoHighlights]);

  // Line vowel tints
  useEffect(() => {
    const view = props.editorViewRef.current;
    if (!view) return;
    const vt = props.lineVowelTints;
    if (!vt || vt.length === 0) {
      try { view.dispatch({ effects: clearLineVowelTints.of(undefined) }); } catch { /* ignore */ }
      return;
    }
    try { view.dispatch({ effects: setLineVowelTints.of(vt) }); } catch { /* ignore */ }
  }, [props.editorViewRef, props.lineVowelTints]);

  // Flow markers (end-stops + caesura)
  useEffect(() => {
    const view = props.editorViewRef.current;
    if (!view) return;
    const fm = props.flowMarkers;
    if (!fm || fm.length === 0) {
      try { view.dispatch({ effects: clearFlowMarkers.of(undefined) }); } catch { /* ignore */ }
      return;
    }
    try { view.dispatch({ effects: setFlowMarkers.of(fm) }); } catch { /* ignore */ }
  }, [props.editorViewRef, props.flowMarkers]);

  // Meter scansion overlay (Stress & meter tab)
  useEffect(() => {
    const view = props.editorViewRef.current;
    if (!view) return;
    const mo = props.meterOverlay;
    if (!mo || mo.length === 0) {
      try { view.dispatch({ effects: clearMeterOverlay.of(undefined) }); } catch { /* ignore */ }
      return;
    }
    try { view.dispatch({ effects: setMeterOverlay.of(mo) }); } catch { /* ignore */ }
  }, [props.editorViewRef, props.meterOverlay]);

  // Rhyme scheme letters in gutter
  useEffect(() => {
    const view = props.editorViewRef.current;
    if (!view) return;
    const labels = props.rhymeSchemeLabels;
    if (!labels || labels.length === 0) {
      try { view.dispatch({ effects: clearSchemeLetters.of(undefined) }); } catch { /* ignore */ }
      return;
    }
    try { view.dispatch({ effects: setSchemeLetters.of(labels) }); } catch { /* ignore */ }
  }, [props.editorViewRef, props.rhymeSchemeLabels]);

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

  // Sync line-focus mode into the CM state field when the prop changes
  useEffect(() => {
    const view = props.editorViewRef.current;
    if (!view) return;
    const raw = props.lineFocusMode;
    const mode: LineFocusMode = raw === true ? "line" : raw === false || raw == null ? "off" : raw;
    try { view.dispatch({ effects: setLineFocusMode.of(mode) }); } catch { /* ignore */ }
  }, [props.editorViewRef, props.lineFocusMode]);

  // Sync typewriter scroll state.
  useEffect(() => {
    const view = props.editorViewRef.current;
    if (!view) return;
    try { view.dispatch({ effects: setTypewriterEnabled.of(props.typewriterScroll ?? false) }); } catch { /* ignore */ }
  }, [props.editorViewRef, props.typewriterScroll]);

  // Sync diff overlay: dispatch new snapshot body or clear when null/undefined.
  useEffect(() => {
    const view = props.editorViewRef.current;
    if (!view) return;
    const body = props.diffSnapshotBody ?? null;
    try { view.dispatch({ effects: setDiffSnapshot.of(body) }); } catch { /* ignore */ }
  }, [props.editorViewRef, props.diffSnapshotBody]);

  // Forward latest gutter-dot click callback to the module-level extension.
  useEffect(() => {
    gutterDotClickHandler.fn = props.onGutterDotClick ?? null;
    return () => { gutterDotClickHandler.fn = null; };
  }, [props.onGutterDotClick]);

  useEffect(() => {
    applyRewriteHandler.fn = props.onApplyRewriteAtCursor ?? null;
    return () => { applyRewriteHandler.fn = null; };
  }, [props.onApplyRewriteAtCursor]);

  // Pause ambient body animations while the editor is focused. CSS rule in
  // index.css gates on `html.is-editor-typing` so only the heavy backdrops
  // pause on touch — discrete UI animations still run.
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest(".cm-editor")) {
        document.documentElement.classList.add("is-editor-typing");
      }
    };
    const onFocusOut = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest(".cm-editor")) {
        document.documentElement.classList.remove("is-editor-typing");
      }
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.documentElement.classList.remove("is-editor-typing");
    };
  }, []);

  // Expose a synchronous cursor-line getter so callers can decide whether to
  // peek/jump based on where the cursor already is.
  useEffect(() => {
    if (!props.cursorLineGetterRef) return;
    props.cursorLineGetterRef.current = () => {
      const view = props.editorViewRef.current;
      if (!view) return -1;
      try {
        const sel = view.state.selection.main;
        return view.state.doc.lineAt(sel.from).number;
      } catch { return -1; }
    };
    return () => { if (props.cursorLineGetterRef) props.cursorLineGetterRef.current = null; };
  }, [props.editorViewRef, props.cursorLineGetterRef]);

  const extensions = useMemo(
    () => [
      // Prevent poem-load/suggestion-apply transactions from polluting undo history.
      // react-codemirror marks external value changes with ExternalChange; we intercept
      // them and annotate addToHistory=false so Ctrl+Z can't undo past the loaded state.
      EditorState.transactionExtender.of((tr) =>
        tr.annotation(ExternalChange) ? { annotations: Transaction.addToHistory.of(false) } : null
      ),
      // lineFontScale measures every .cm-line via getClientRects on each doc
      // change. Skipped on touch — mobile viewports are narrow and wrap anyway,
      // so the auto-shrink rarely fires, and the measurement cost is the single
      // biggest source of typing lag on iPad.
      ...(IS_TOUCH_DEVICE ? [] : [lineFontScaleField, lineFontScalePlugin]),
      EditorView.contentAttributes.of({ spellcheck: "false" }),
      spellSyncFacet.of(props.spellBump),
      search({ top: true }),
      highlightSelectionMatches(),
      lineFlashField,
      strongestLineField,
      issueHighlightField,
      persistentIssueDecosField,
      issueGutterField,
      issueGutterExtension,
      schemeLetterField,
      wordHighlightField,
      rhymeEndField,
      internalRhymeField,
      repeatHighlightField,
      echoHighlightField,
      lineVowelTintField,
      flowMarkerField,
      meterOverlayField,
      diffOverlayField,
      applyRewriteKeymap,
      ...lineFocusExtension,
      ...typewriterExtension,
      placeholder("Start writing…"),
      ...(showSyllables ? [syllableCountPlugin] : []),
      ...poemSpellExtensions,
      formatMarksExtension,
      formatMarksTheme,
      ...basicSetup(),
      poemEditorTheme,
    ],
    [props.spellBump, showSyllables],
  );

  const selectionCallbackRef = useRef(props.onSelectionText);
  selectionCallbackRef.current = props.onSelectionText;
  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cursorLineCallbackRef = useRef(props.onCursorLineChange);
  cursorLineCallbackRef.current = props.onCursorLineChange;
  const cursorLineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCursorLineRef = useRef<number>(-1);

  return (
    <div className={`poem-cm-wrap${props.diffSnapshotBody ? " is-diff-mode" : ""}`} id={props.id}>
      <CodeMirror
        aria-describedby={props["aria-describedby"]}
        value={localValue}
        height="auto"
        theme="none"
        extensions={extensions}
        onChange={(v) => {
          // Don't setLocalValue here: localValue is only used to feed
          // external resyncs (bodySyncNonce). CodeMirror owns the doc
          // internally during typing, so updating React state on every
          // keystroke caused a full PoemBodyEditor rerender per char.
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
