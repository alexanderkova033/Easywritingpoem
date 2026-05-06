import "./WordLookupPopup.css";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";


interface DictMeaning {
  partOfSpeech: string;
  definitions: {
    definition: string;
    example?: string;
    synonyms?: string[];
    antonyms?: string[];
  }[];
  synonyms?: string[];
  antonyms?: string[];
}

interface DictEntry {
  word: string;
  meanings: DictMeaning[];
}

interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface PopupPos {
  left: number;
  top: number;
}

const MAX_SYNONYMS = 22;
const MAX_ANTONYMS = 22;

function collectFromDict(entry: DictEntry): { syns: string[]; ants: string[] } {
  const synSet = new Set<string>();
  const antSet = new Set<string>();
  for (const m of entry.meanings) {
    for (const s of m.synonyms ?? []) synSet.add(s.trim());
    for (const a of m.antonyms ?? []) antSet.add(a.trim());
    for (const d of m.definitions) {
      for (const s of d.synonyms ?? []) synSet.add(s.trim());
      for (const a of d.antonyms ?? []) antSet.add(a.trim());
    }
  }
  return {
    syns: [...synSet].filter(Boolean),
    ants: [...antSet].filter(Boolean),
  };
}

function mergeWordLists(
  lookup: string,
  primary: string[],
  extra: string[],
  max: number,
): string[] {
  const lower = lookup.toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const w = raw.trim();
    if (!w) return;
    const k = w.toLowerCase();
    if (k === lower || seen.has(k)) return;
    seen.add(k);
    out.push(w);
  };
  for (const w of primary) add(w);
  for (const w of extra) add(w);
  return out.slice(0, max);
}

interface DatamuseRow {
  word?: string;
}

async function fetchDatamuseRelated(
  w: string,
  signal: AbortSignal,
): Promise<{ syns: string[]; ants: string[] }> {
  const q = encodeURIComponent(w);
  const urls = [
    `https://api.datamuse.com/words?rel_syn=${q}&max=30`,
    `https://api.datamuse.com/words?rel_ant=${q}&max=30`,
    `https://api.datamuse.com/words?ml=${q}&max=25`,
  ];
  try {
    const results = await Promise.all(
      urls.map((url) =>
        fetch(url, { signal }).then(async (r) => {
          if (!r.ok) return [];
          const j: unknown = await r.json();
          return Array.isArray(j) ? j : [];
        }),
      ),
    );
    const synRows = [
      ...(results[0] as DatamuseRow[]),
      ...(results[2] as DatamuseRow[]),
    ];
    const antRows = results[1] as DatamuseRow[];
    const syns = synRows.map((r) => r.word).filter(Boolean) as string[];
    const ants = antRows.map((r) => r.word).filter(Boolean) as string[];
    return { syns, ants };
  } catch {
    return { syns: [], ants: [] };
  }
}

const MAX_POS_GROUPS = 3;
const COLLAPSED_DEFS = 2;

interface DefGroup {
  pos: string;
  allDefs: string[];
}

function extractDefs(entry: DictEntry): DefGroup[] {
  const groups: DefGroup[] = [];
  for (const m of entry.meanings) {
    const texts = m.definitions
      .map((d) => d.definition)
      .filter(Boolean);
    if (texts.length === 0) continue;
    groups.push({ pos: m.partOfSpeech, allDefs: texts });
    if (groups.length >= MAX_POS_GROUPS) break;
  }
  return groups;
}

/** Prefer CodeMirror’s geometry so the popup tracks the real selection pixels. */
function anchorFromEditorSelection(view: EditorView): { word: string; anchor: AnchorRect; selFrom: number; selTo: number } | null {
  const sel = view.state.selection.main;
  if (sel.empty) return null;
  const raw = view.state.sliceDoc(sel.from, sel.to).trim();
  const singleToken = raw.replace(/\s+/g, "");
  if (!singleToken || singleToken.length < 2 || singleToken.length > 48) return null;
  if (/\s/.test(raw) && raw !== singleToken) return null;

  const fromC = view.coordsAtPos(sel.from);
  const toC = view.coordsAtPos(sel.to);
  if (!fromC || !toC) return null;
  const left = Math.min(fromC.left, toC.left);
  const top = Math.min(fromC.top, toC.top);
  const right = Math.max(fromC.right, toC.right);
  const bottom = Math.max(fromC.bottom, toC.bottom);

  const clean = singleToken.replace(/[^a-zA-Z’-]/g, "").toLowerCase();
  if (clean.length < 2) return null;

  return {
    word: clean,
    selFrom: sel.from,
    selTo: sel.to,
    anchor: {
      left,
      top,
      right,
      bottom,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    },
  };
}

export function WordLookupPopup({
  editorViewRef,
  enabled,
  onDisable,
}: {
  editorViewRef: MutableRefObject<EditorView | null>;
  enabled: boolean;
  onDisable?: () => void;
}) {
  const [word, setWord] = useState<string | null>(null);
  const [entry, setEntry] = useState<DictEntry | null>(null);
  const [altSyns, setAltSyns] = useState<string[]>([]);
  const [altAnts, setAltAnts] = useState<string[]>([]);
  const [expandedPos, setExpandedPos] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<"idle" | "loading" | "notfound" | "error">(
    "idle",
  );
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [popupPos, setPopupPos] = useState<PopupPos | null>(null);
  const [insertFlash, setInsertFlash] = useState<string | null>(null);
  const selRangeRef = useRef<{ from: number; to: number } | null>(null);
  const insertFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLookupRef = useRef<string | null>(null);

  const runLookup = useCallback(async (w: string, signal: AbortSignal) => {
    setStatus("loading");
    setEntry(null);
    setAltSyns([]);
    setAltAnts([]);
    setExpandedPos(new Set());

    // Combine the caller's abort signal with a 5-second timeout
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 5000);
    const combinedSignal = AbortSignal.any
      ? AbortSignal.any([signal, timeoutController.signal])
      : signal;

    try {
      const [dictRes, dm] = await Promise.all([
        fetch(
          `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`,
          { signal: combinedSignal },
        ),
        fetchDatamuseRelated(w, combinedSignal),
      ]);
      if (dictRes.status === 404) {
        setEntry(null);
        const sy = mergeWordLists(w, [], dm.syns, MAX_SYNONYMS);
        const an = mergeWordLists(w, [], dm.ants, MAX_ANTONYMS);
        setAltSyns(sy);
        setAltAnts(an);
        setStatus(sy.length === 0 && an.length === 0 ? "notfound" : "idle");
        return;
      }
      if (!dictRes.ok) {
        setEntry(null);
        setAltSyns([]);
        setAltAnts([]);
        setStatus("error");
        return;
      }
      const data = (await dictRes.json()) as DictEntry[];
      const ent = data[0] ?? null;
      setEntry(ent);
      const fromDict = ent ? collectFromDict(ent) : { syns: [], ants: [] };
      setAltSyns(mergeWordLists(w, fromDict.syns, dm.syns, MAX_SYNONYMS));
      setAltAnts(mergeWordLists(w, fromDict.ants, dm.ants, MAX_ANTONYMS));
      setStatus("idle");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setEntry(null);
      setAltSyns([]);
      setAltAnts([]);
      setStatus("error");
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  const close = useCallback(() => {
    lastLookupRef.current = null;
    selRangeRef.current = null;
    setWord(null);
    setEntry(null);
    setAltSyns([]);
    setAltAnts([]);
    setExpandedPos(new Set());
    setAnchor(null);
    setPopupPos(null);
    setStatus("idle");
    setInsertFlash(null);
    abortRef.current?.abort();
    if (insertFlashTimerRef.current) clearTimeout(insertFlashTimerRef.current);
  }, []);

  const insertWord = useCallback((replacement: string) => {
    const view = editorViewRef.current;
    const range = selRangeRef.current;
    if (!view || !range) return;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: replacement },
      selection: EditorSelection.cursor(range.from + replacement.length),
    });
    view.focus();
    setInsertFlash(replacement);
    if (insertFlashTimerRef.current) clearTimeout(insertFlashTimerRef.current);
    insertFlashTimerRef.current = setTimeout(() => {
      setInsertFlash(null);
      close();
    }, 900);
  }, [editorViewRef, close]);

  const handleDisable = useCallback(() => {
    onDisable?.();
    close();
  }, [close, onDisable]);

  const isTouchDevice = typeof window !== "undefined" &&
    window.matchMedia("(hover: none) and (pointer: coarse)").matches;

  useEffect(() => {
    if (!enabled) return;
    const tryLookup = () => {
      const view = editorViewRef.current;
      if (!view) return;
      const got = anchorFromEditorSelection(view);
      if (!got) return;
      setAnchor(got.anchor);
      selRangeRef.current = { from: got.selFrom, to: got.selTo };
      if (lastLookupRef.current === got.word) return;
      lastLookupRef.current = got.word;
      setWord(got.word);
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      void runLookup(got.word, ctrl.signal);
    };

    const onSelectionChange = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // Touch devices: CodeMirror needs more time to sync the native selection
      debounceRef.current = setTimeout(tryLookup, isTouchDevice ? 450 : 280);
    };

    // On touch, also trigger on touchend to catch double-tap word selection
    const onTouchEnd = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(tryLookup, 450);
    };

    document.addEventListener("selectionchange", onSelectionChange);
    if (isTouchDevice) document.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      if (isTouchDevice) document.removeEventListener("touchend", onTouchEnd);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [editorViewRef, runLookup, enabled, isTouchDevice]);

  const defGroups = entry ? extractDefs(entry) : [];
  const syns = altSyns;
  const ants = altAnts;

  useLayoutEffect(() => {
    if (!word || !anchor || !popupRef.current) {
      setPopupPos(null);
      return;
    }
    const el = popupRef.current;
    const br = el.getBoundingClientRect();
    const margin = 10;
    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const preferBelowTop = anchor.bottom + gap;
    const preferAboveTop = anchor.top - gap - br.height;
    let top =
      preferBelowTop + br.height <= vh - margin
        ? preferBelowTop
        : preferAboveTop;
    if (top < margin) top = margin;
    if (top + br.height > vh - margin) top = Math.max(margin, vh - margin - br.height);

    let left = anchor.left + anchor.width / 2 - br.width / 2;
    const idealLeft = left;
    if (left + br.width > vw - margin) left = vw - margin - br.width;
    if (left < margin) left = margin;
    if (idealLeft !== left) {
      const stick = anchor.left;
      if (stick + br.width <= vw - margin) left = Math.max(margin, stick);
    }
    setPopupPos({ left, top });
  }, [word, anchor, status, defGroups.length, syns.length, ants.length]);

  useEffect(() => {
    if (!word) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [word, close]);

  // Swipe-down to dismiss on touch devices
  useEffect(() => {
    if (!word) return;
    const el = popupRef.current;
    if (!el) return;
    let startY = 0;
    const onTouchStart = (e: TouchEvent) => { startY = e.touches[0]!.clientY; };
    const onTouchEnd = (e: TouchEvent) => {
      const dy = e.changedTouches[0]!.clientY - startY;
      if (dy > 48) close();
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [word, close]);

  if (!enabled || !word || !anchor) return null;

  const showLoading = status === "loading";
  const showError = status === "error";
  const showNotFound =
    status === "notfound" && defGroups.length === 0 && syns.length === 0 && ants.length === 0;

  return (
    <div
      ref={popupRef}
      className="word-lookup-popup"
      style={
        popupPos
          ? { left: popupPos.left, top: popupPos.top, transform: "none" }
          : {
              left: anchor.left + anchor.width / 2,
              top: anchor.bottom + 8,
              transform: "translateX(-50%)",
              visibility: "hidden" as const,
            }
      }
      role="dialog"
      aria-label={`Definition of ${word}`}
    >
      <div className="word-lookup-head">
        <span className="word-lookup-word">{word}</span>
        <div className="word-lookup-head-actions">
          <button type="button" className="word-lookup-disable-btn" onClick={handleDisable} title="Turn off auto word lookup">
            Disable
          </button>
          <button type="button" className="word-lookup-close" onClick={close} aria-label="Close">
            ×
          </button>
        </div>
      </div>

      {showLoading && (
        <p className="word-lookup-loading muted small">Looking up…</p>
      )}

      {showError && (
        <p className="word-lookup-error muted small" role="alert">
          Can&apos;t reach the dictionary or word services right now — check your
          connection or try again. Your poem stays local; only this lookup needs
          the network.
        </p>
      )}

      {showNotFound && (
        <p className="word-lookup-notfound muted small">No definition found.</p>
      )}

      {defGroups.length > 0 && (
        <div className="word-lookup-defs">
          {defGroups.map((g) => {
            const isExpanded = expandedPos.has(g.pos);
            const visibleDefs = isExpanded ? g.allDefs : g.allDefs.slice(0, COLLAPSED_DEFS);
            const hiddenCount = g.allDefs.length - COLLAPSED_DEFS;
            return (
              <div key={g.pos} className="word-lookup-def-group">
                <span className="word-lookup-pos">{g.pos}</span>
                <ol className="word-lookup-def-list">
                  {visibleDefs.map((text, i) => (
                    <li key={i} className="word-lookup-def-item">{text}</li>
                  ))}
                </ol>
                {!isExpanded && hiddenCount > 0 && (
                  <button
                    type="button"
                    className="word-lookup-more-defs"
                    onClick={() => setExpandedPos((prev) => new Set([...prev, g.pos]))}
                  >
                    +{hiddenCount} more
                  </button>
                )}
                {isExpanded && hiddenCount > 0 && (
                  <button
                    type="button"
                    className="word-lookup-more-defs"
                    onClick={() => setExpandedPos((prev) => { const s = new Set(prev); s.delete(g.pos); return s; })}
                  >
                    Show less
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {defGroups.length === 0 &&
      !showLoading &&
      !showError &&
      !showNotFound &&
      (syns.length > 0 || ants.length > 0) ? (
        <p className="word-lookup-dict-fallback muted small">
          No full dictionary entry — showing related words.
        </p>
      ) : null}

      {syns.length > 0 && (
        <div className="word-lookup-group word-lookup-group-tight">
          <span className="word-lookup-group-label">Synonyms &amp; similar</span>
          <div className="word-lookup-chips">
            {syns.map((s) => (
              <button
                key={s}
                type="button"
                className={`word-lookup-chip word-lookup-chip-btn ${insertFlash === s ? "is-inserted" : ""}`}
                onClick={() => insertWord(s)}
                title={`Replace "${word}" with "${s}"`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {(ants.length > 0 || (syns.length > 0 && !showLoading && !showError)) && (
        <div className="word-lookup-group word-lookup-group-tight">
          <span className="word-lookup-group-label">Antonyms &amp; opposites</span>
          {ants.length > 0 ? (
            <div className="word-lookup-chips word-lookup-chips-ant">
              {ants.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`word-lookup-chip word-lookup-chip-btn word-lookup-chip-ant ${insertFlash === a ? "is-inserted" : ""}`}
                  onClick={() => insertWord(a)}
                  title={`Replace "${word}" with "${a}"`}
                >
                  {a}
                </button>
              ))}
            </div>
          ) : (
            <p className="word-lookup-none muted small">None found</p>
          )}
        </div>
      )}
      {selRangeRef.current && (syns.length > 0 || ants.length > 0) && (
        <p className="word-lookup-insert-hint muted">
          Click a word to replace selection
        </p>
      )}
    </div>
  );
}
