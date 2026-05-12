import type { EditorView } from "@codemirror/view";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
} from "react";
import { isLocalStorageNearlyFull } from "@/shared/platform/browser-storage";
import { diffPoemLines } from "@/workshop/library/diff-lines";
import {
  buildMarkdownPoem,
  buildPlainTextTitleBody,
  copyTextToClipboard,
  downloadDocxFile,
  downloadHtmlFile,
  downloadPdfFile,
  downloadPngFile,
  downloadTextFile,
  exportFilename,
} from "@/workshop/library/export-poem";
import { stripFormatMarkers } from "@/workshop/editor/format-marks";
import {
  buildWorkshopExportJson,
  duplicateActivePoem,
  duplicatePoemById as duplicatePoemByIdInLib,
  loadOrCreateLibrary,
  mergeImportedPoems,
  newBlankPoemAfter,
  poemById,
  removePoem,
  saveLibrary,
  setActivePoem,
  upsertActivePoem,
  type DraftLibrary,
} from "@/workshop/library/local-draft-library";
import {
  loadDraftMetaMap,
  saveDraftMetaMap,
  upsertDraftMeta,
  type DraftMetaMap,
} from "@/workshop/library/library-meta";
import {
  migrateLegacyDraftIfNeeded,
  type SpellMode,
} from "@/workshop/library/local-draft-storage";
import {
  addRevision,
  countDuplicateRevisions,
  loadRevisions,
  removeDuplicateRevisions,
  removeRevision,
  removeRevisionsForPoem,
  type RevisionSnapshot,
} from "@/workshop/library/revision-snapshots";
import {
  loadWorkshopGoals,
  saveWorkshopGoals,
} from "@/workshop/goals/storage";
import {
  type WorkshopGoals,
  FORM_PRESETS,
} from "@/workshop/goals/types";
import { loadPersonalDictionary, loadSessionIgnores } from "@/spellcheck/personal-dictionary";
import { loadEnglishWordlist } from "@/spellcheck/wordlist";
import type { SpellHit } from "@/spellcheck/scan";
import { spellHitsFromText } from "@/spellcheck/scan";
import {
  BODY_TO_REACT_DEBOUNCE_MS,
  SPELL_ANALYSIS_DEBOUNCE_MS,
} from "@/spellcheck/spell-timing";
import { evaluateGoals } from "@/workshop/goals/metrics";
import { linesFromBody } from "@/workshop/analysis/lines-from-body";
import {
  computeDocumentStats,
  computeQuickDocumentStats,
} from "@/workshop/analysis/line-stats";
import { loadStressLexicon } from "@/workshop/meter/cmu-stress-lexicon";
import {
  meterHintsForBody,
  summarizeMeterCoverage,
} from "@/workshop/meter/meter-hints";
import { useHeavyAnalysis } from "@/workshop/analysis/use-heavy-analysis";
import { buildPublicationChecklist } from "@/workshop/analysis/publication-checklist";
import { detectRhymeScheme, type RhymeBreadth } from "@/workshop/rhyme/scheme";
import {
  focusCharacterRangeInEditor,
  focusLastWordInLine,
  focusLineInEditor,
} from "@/workshop/editor/focus-line-in-editor";
import { isTypingInField } from "@/workshop/hints/keyboard-field-target";
import { TOOL_TABS } from "@/workshop/analysis/ToolTabBar";
import { readFirstVisitHintDismissed } from "./firstVisitHintStorage";
import {
  COMPARE_CURRENT_ID,
  compareBodyForId,
  formatRelativeSnapshotWhen,
  formatSnapshotWhen,
  parseGoalInput,
  type ToolTab,
} from "@/workshop/shell/workshop-helpers";

import {
  STORAGE_KEY_LAST_EXPORT_AT,
  STORAGE_KEY_LAST_TOOL_TAB,
  STORAGE_KEY_SAMPLE_DISMISSED,
} from "@/shared/storage-keys";

export const SAMPLE_POEM_TITLE = "The Candle";
export const SAMPLE_POEM_BODY =
  `The candle burns in winter's grip,\nand shadows stretch across the floor.\nA moth has pressed its paper wing\nagainst the cold and frosted door.\n\nThe candle knows it cannot last —\nits wax grows thin, its circle bright.\nBut still it burns to hold the past,\nand moths will linger in its light.`;

function isSampleDismissed(): boolean {
  try { return !!localStorage.getItem(STORAGE_KEY_SAMPLE_DISMISSED); } catch { return false; }
}

const LAST_TOOL_TAB_KEY = STORAGE_KEY_LAST_TOOL_TAB;
const LAST_EXPORT_KEY = STORAGE_KEY_LAST_EXPORT_AT;
const EXPORT_REMINDER_DAYS = 7;

function readLastExportAt(): string | null {
  try {
    return localStorage.getItem(LAST_EXPORT_KEY);
  } catch {
    return null;
  }
}

function recordExportAt() {
  try {
    localStorage.setItem(LAST_EXPORT_KEY, new Date().toISOString());
  } catch {
    /* ignore */
  }
}

function checkExportReminderDue(lib: DraftLibrary): boolean {
  const hasContent = lib.poems.some(
    (p) => p.body.trim().length > 0 || p.title.trim().length > 0,
  );
  if (!hasContent) return false;
  const raw = readLastExportAt();
  if (!raw) return true;
  const daysSince = (Date.now() - new Date(raw).getTime()) / 86_400_000;
  return daysSince >= EXPORT_REMINDER_DAYS;
}

function shouldForceSummaryTools(): boolean {
  try {
    return window.matchMedia("(max-width: 899px)").matches;
  } catch {
    return false;
  }
}

function readSessionToolTab(): ToolTab {
  const allowed = new Set(TOOL_TABS.map((x) => x.id));
  try {
    const raw = sessionStorage.getItem(LAST_TOOL_TAB_KEY);
    if (shouldForceSummaryTools()) return "issues";
    if (raw && allowed.has(raw as ToolTab)) return raw as ToolTab;
  } catch {
    /* sessionStorage unavailable */
  }
  // First-time visitors land on Suggest so they immediately have something to do
  if (!readFirstVisitHintDismissed()) return "suggest";
  return "issues";
}

const DRAFT_STORAGE_MSG =
  "Could not save your drafts to this browser (storage may be full or blocked).";
const GOALS_STORAGE_MSG =
  "Could not save your writing goals to browser storage.";
const SNAPSHOT_SAVE_MSG =
  "Could not save the snapshot (browser storage may be full or blocked).";
const SNAPSHOT_DELETE_MSG =
  "Could not update snapshots in browser storage.";

export function usePoemWorkshopModel(rhymeBreadth: RhymeBreadth = "near", manualRhymeLinks: string[] = [], manualRhymeUnlinks: string[] = []) {
  const [library, setLibrary] = useState<DraftLibrary>(() => {
    migrateLegacyDraftIfNeeded();
    return loadOrCreateLibrary();
  });
  const [meta, setMeta] = useState<DraftMetaMap>(() => loadDraftMetaMap());
  const [title, setTitle] = useState("");
  const [formNote, setFormNote] = useState("");
  const [body, setBody] = useState("");
  /** Bumped when the poem body is replaced outside the editor (load draft, restore snapshot). */
  const [bodySyncNonce, setBodySyncNonce] = useState(0);
  const [samplePoemActive, setSamplePoemActive] = useState(false);
  /** Latest body from CodeMirror; React `body` may trail by {@link BODY_TO_REACT_DEBOUNCE_MS}. */
  const bodyLiveRef = useRef("");
  const bodyToReactTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Debounced copy of `body` for expensive sidebar tools (meter, rhyme, repeats). */
  const [heavyBody, setHeavyBody] = useState("");
  const [spellMode, setSpellMode] = useState<SpellMode>("permissive");
  const [savedFlash, setSavedFlash] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [storageNearlyFull, setStorageNearlyFull] = useState(false);
  const storageNearlyFullRef = useRef(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [importNoticeKind, setImportNoticeKind] = useState<"success" | "error">(
    "success",
  );
  const [showExportReminder, setShowExportReminder] = useState(false);
  const [spellHitsState, setSpellHitsState] = useState<SpellHit[]>([]);
  const [, startSpellTransition] = useTransition();
  const [wordlist, setWordlist] = useState<Set<string> | null>(null);
  const [wordlistErr, setWordlistErr] = useState<string | null>(null);
  const [stressLexicon, setStressLexicon] = useState<Map<
    string,
    string
  > | null>(null);
  const [stressLexiconErr, setStressLexiconErr] = useState<string | null>(
    null,
  );
  const [spellBump, setSpellBump] = useState(0);
  const [spellNavIndex, setSpellNavIndex] = useState(0);
  const [revisions, setRevisions] = useState<RevisionSnapshot[]>([]);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [lastAiScore, setLastAiScore] = useState<number | null>(null);
  const [compareLeftId, setCompareLeftId] = useState(COMPARE_CURRENT_ID);
  const [compareRightId, setCompareRightId] = useState(COMPARE_CURRENT_ID);
  const [compareViewMode, setCompareViewMode] = useState<"side" | "diff">(
    "side",
  );
  const [goals, setGoals] = useState<WorkshopGoals>(() => loadWorkshopGoals());
  const [copyExportFlash, setCopyExportFlash] = useState(false);
  const [quickCopyFlash, setQuickCopyFlash] = useState(false);
  const [snapshotFlash, setSnapshotFlash] = useState<
    "saved" | "duplicate" | null
  >(null);
  const snapshotFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [jumpLine, setJumpLine] = useState<number | null>(null);
  const [jumpBump, setJumpBump] = useState(0);
  const copyExportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickCopyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const [toolTab, setToolTabInner] = useState<ToolTab>(() =>
    readSessionToolTab(),
  );
  const setToolTab = useCallback((t: ToolTab) => {
    setToolTabInner(t);
    try {
      sessionStorage.setItem(LAST_TOOL_TAB_KEY, t);
    } catch {
      /* ignore */
    }
  }, []);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const activePoemId = library.activeId;

  const workshopStateRef = useRef({
    title,
    body: bodyLiveRef.current,
    formNote,
    spellMode,
    library,
  });
  workshopStateRef.current = {
    title,
    body: bodyLiveRef.current,
    formNote,
    spellMode,
    library,
  };

  const initialHydrateRef = useRef(false);
  useLayoutEffect(() => {
    if (initialHydrateRef.current) return;
    initialHydrateRef.current = true;
    const p = poemById(library, library.activeId);
    if (!p) return;
    if (bodyToReactTimer.current) {
      clearTimeout(bodyToReactTimer.current);
      bodyToReactTimer.current = null;
    }
    setTitle(p.title);
    setBody(p.body);
    bodyLiveRef.current = p.body;
    setHeavyBody(p.body);
    setFormNote(p.form ?? "");
    setSpellMode(p.spellMode ?? "permissive");
    setRevisions(loadRevisions(library.activeId));
    setBodySyncNonce((n) => n + 1);
  }, [library]);

  const onEditorBody = useCallback((next: string) => {
    bodyLiveRef.current = next;
    if (bodyToReactTimer.current) clearTimeout(bodyToReactTimer.current);
    bodyToReactTimer.current = setTimeout(() => {
      bodyToReactTimer.current = null;
      setBody(next);
    }, BODY_TO_REACT_DEBOUNCE_MS);
  }, []);

  useEffect(
    () => () => {
      if (bodyToReactTimer.current) {
        clearTimeout(bodyToReactTimer.current);
        bodyToReactTimer.current = null;
      }
    },
    [],
  );

  const dismissPersistenceError = useCallback(() => {
    setPersistenceError(null);
  }, []);

  useEffect(() => {
    const t = setTimeout(
      () => setHeavyBody(body),
      SPELL_ANALYSIS_DEBOUNCE_MS,
    );
    return () => clearTimeout(t);
  }, [body]);

  useEffect(() => {
    if (wordlist) setSpellBump((n) => n + 1);
  }, [wordlist]);

  const [wordlistRetryBump, setWordlistRetryBump] = useState(0);

  const retryWordlist = () => setWordlistRetryBump((n) => n + 1);

  useEffect(() => {
    setWordlistErr(null);
    // Defer the 2.7MB wordlist fetch + parse until the browser is idle so it
    // doesn't compete with first paint or initial editor mount.
    const run = () => {
      void loadEnglishWordlist()
        .then((w) => {
          setWordlist(w);
          setWordlistErr(null);
        })
        .catch((e) => {
          const msg = e instanceof Error ? e.message : "Could not load word list.";
          setWordlistErr(msg);
        });
    };
    const ric = (window as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    const cic = (window as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
    if (typeof ric === "function") {
      const id = ric(run, { timeout: 2000 });
      return () => { if (typeof cic === "function") cic(id); };
    }
    const t = window.setTimeout(run, 800);
    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordlistRetryBump]);

  useEffect(() => {
    const run = () => {
      void loadStressLexicon()
        .then((m) => {
          setStressLexicon(m);
          setStressLexiconErr(null);
        })
        .catch((e) => {
          setStressLexicon(null);
          setStressLexiconErr(
            e instanceof Error ? e.message : "Could not load stress dictionary.",
          );
        });
    };
    const ric = (window as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    const cic = (window as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
    if (typeof ric === "function") {
      const id = ric(run, { timeout: 2500 });
      return () => { if (typeof cic === "function") cic(id); };
    }
    const t = window.setTimeout(run, 1200);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!saveWorkshopGoals(goals)) {
      setPersistenceError(GOALS_STORAGE_MSG);
      return;
    }
    setPersistenceError((prev) => (prev === GOALS_STORAGE_MSG ? null : prev));
  }, [goals]);

  useEffect(() => {
    setCompareLeftId((left) => {
      if (left === COMPARE_CURRENT_ID) return left;
      return revisions.some((s) => s.id === left) ? left : COMPARE_CURRENT_ID;
    });
    setCompareRightId((right) => {
      if (right === COMPARE_CURRENT_ID) return right;
      if (revisions.some((s) => s.id === right)) return right;
      return revisions[0]?.id ?? COMPARE_CURRENT_ID;
    });
  }, [revisions]);

  // Bumped to 1500ms (was 500ms) so JSON.stringify + localStorage.setItem
  // doesn't fire mid-keystroke on slow phones. Flushed on blur/visibilitychange/
  // beforeunload (see effect below) so no work is lost on exit.
  const persistActiveDraft = useCallback(() => {
    setLibrary((prev) => {
      const next = upsertActivePoem(prev, {
        title,
        body: bodyLiveRef.current,
        form: formNote,
        spellMode,
      });
      if (!saveLibrary(next)) {
        setPersistenceError(DRAFT_STORAGE_MSG);
        return prev;
      }
      setPersistenceError((p) => (p === DRAFT_STORAGE_MSG ? null : p));
      setSavedFlash(true);
      setLastSavedAt(Date.now());
      if (!storageNearlyFullRef.current && isLocalStorageNearlyFull()) {
        storageNearlyFullRef.current = true;
        setStorageNearlyFull(true);
        setPersistenceError("Browser storage is nearly full. Export a backup now to avoid losing work.");
      }
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        setSavedFlash(false);
        saveTimer.current = null;
      }, 900);
      return next;
    });
  }, [title, formNote, spellMode]);

  const persistRef = useRef(persistActiveDraft);
  persistRef.current = persistActiveDraft;

  useEffect(() => {
    const t = setTimeout(() => persistRef.current(), 1500);
    return () => clearTimeout(t);
  }, [title, body, formNote, spellMode, activePoemId]);

  // Flush pending save synchronously when user leaves the page or backgrounds
  // the tab. Covers: tab close, navigation, mobile app-switch, screen lock.
  useEffect(() => {
    const flush = () => persistRef.current();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const lines = useMemo(() => linesFromBody(body), [body]);
  const heavyLines = useMemo(() => linesFromBody(heavyBody), [heavyBody]);
  const quickDocStats = useMemo(
    () => computeQuickDocumentStats(body),
    [body],
  );
  const docStats = useMemo(
    () => computeDocumentStats(heavyBody),
    [heavyBody],
  );
  const meterHints = useMemo(
    () => meterHintsForBody(heavyBody, stressLexicon),
    [heavyBody, stressLexicon],
  );
  // All heavyLines-derived analyses run off-main-thread via a Web Worker.
  // Bundled into one request so the worker round-trips once per heavyBody
  // change instead of N times. Hook handles race protection.
  const heavy = useHeavyAnalysis(
    heavyLines,
    rhymeBreadth,
    manualRhymeLinks,
    manualRhymeUnlinks,
  );
  const rhymeClusters = heavy.rhymeClusters;
  const stanzaRhymeGroups = heavy.stanzaRhymeGroups;
  const vowelTailClusters = heavy.vowelTailClusters;
  const assonanceClusters = heavy.assonanceClusters;
  const consonanceClusters = heavy.consonanceClusters;
  const repetition = heavy.repetition;
  const repeated = repetition.words;
  const clicheHits = heavy.clicheHits;
  const internalRhymes = heavy.internalRhymes;
  // Fast path: rhyme scheme on the non-debounced `lines` so the editor's
  // rhyme ribbons + scheme letters update with low latency. Stays on the
  // main thread — same input rate as the editor itself.
  const rhymeScheme = useMemo(
    () => detectRhymeScheme(lines, rhymeBreadth, manualRhymeLinks, manualRhymeUnlinks),
    [lines, rhymeBreadth, manualRhymeLinks, manualRhymeUnlinks],
  );
  const heavyToolsStale = body !== heavyBody;
  const heavyDocStats = useMemo(
    () => computeDocumentStats(heavyBody),
    [heavyBody],
  );
  const meterCoverageSummary = useMemo(
    () => summarizeMeterCoverage(meterHints, heavyDocStats),
    [meterHints, heavyDocStats],
  );
  useEffect(() => {
    if (!wordlist) {
      startSpellTransition(() => setSpellHitsState([]));
      return;
    }
    const dict = wordlist;
    const personal = loadPersonalDictionary();
    const ignores = loadSessionIgnores();
    const mode = spellMode;
    const text = heavyBody;
    startSpellTransition(() => {
      setSpellHitsState(spellHitsFromText(text, dict, personal, ignores, mode));
    });
  }, [heavyBody, wordlist, spellMode, spellBump]); // eslint-disable-line react-hooks/exhaustive-deps

  const spellHits = spellHitsState;

  useEffect(() => {
    setSpellNavIndex(0);
  }, [spellHits]);

  const goalEvaluation = useMemo(
    () => evaluateGoals(docStats, goals, rhymeScheme),
    [docStats, goals, rhymeScheme],
  );

  const publication = useMemo(
    () =>
      buildPublicationChecklist({
        title,
        docStats,
        spellingFlagCount: spellHits.length,
        wordlistReady: Boolean(wordlist),
        goalEvaluation,
      }),
    [title, docStats, spellHits.length, wordlist, goalEvaluation],
  );

  const compareLeftBody = useMemo(
    () => compareBodyForId(compareLeftId, body, revisions),
    [compareLeftId, body, revisions],
  );
  const compareRightBody = useMemo(
    () => compareBodyForId(compareRightId, body, revisions),
    [compareRightId, body, revisions],
  );

  const compareDiffRows = useMemo(() => {
    if (compareLeftId === compareRightId) return [];
    return diffPoemLines(compareLeftBody, compareRightBody);
  }, [
    compareLeftBody,
    compareRightBody,
    compareLeftId,
    compareRightId,
  ]);

  const compareSnapshotOptions = useMemo(() => {
    const opts: { id: string; label: string; optionTitle?: string }[] = [
      { id: COMPARE_CURRENT_ID, label: "Current draft" },
      ...revisions.map((s) => ({
        id: s.id,
        label: `${formatRelativeSnapshotWhen(s.createdAt)}${s.label ? ` — ${s.label}` : ""}`,
        optionTitle: formatSnapshotWhen(s.createdAt),
      })),
    ];
    return opts;
  }, [revisions]);

  const goToLine = useCallback((line1Based: number) => {
    const view = editorViewRef.current;
    if (!view) return;
    setJumpLine(line1Based);
    setJumpBump((n) => n + 1);
    focusLineInEditor(view, line1Based);
  }, []);

  const goToLineEnd = useCallback((line1Based: number) => {
    const view = editorViewRef.current;
    if (!view) return;
    setJumpLine(line1Based);
    setJumpBump((n) => n + 1);
    focusLastWordInLine(view, line1Based);
  }, []);

  const goToSpellHit = useCallback((hit: SpellHit) => {
    const view = editorViewRef.current;
    if (!view) return;
    setJumpLine(hit.lineNumber);
    setJumpBump((n) => n + 1);
    if (body === heavyBody) {
      focusCharacterRangeInEditor(view, hit.docFrom, hit.docTo);
      return;
    }
    focusLineInEditor(view, hit.lineNumber);
  }, [body, heavyBody]);

  const goToSpellHitAt = useCallback(
    (hit: SpellHit) => {
      const idx = spellHits.indexOf(hit);
      if (idx >= 0) setSpellNavIndex(idx);
      goToSpellHit(hit);
    },
    [spellHits, goToSpellHit],
  );

  const cycleSpellHit = useCallback(
    (delta: number) => {
      const n = spellHits.length;
      if (n === 0) return;
      setSpellNavIndex((prev) => {
        const next = (prev + delta + n) % n;
        const h = spellHits[next];
        if (h) queueMicrotask(() => goToSpellHit(h));
        return next;
      });
    },
    [spellHits, goToSpellHit],
  );

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "F7") return;
      if (isTypingInField(e.target)) return;
      if (spellHits.length === 0) return;
      e.preventDefault();
      const delta = e.shiftKey ? -1 : 1;
      cycleSpellHit(delta);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [spellHits.length, cycleSpellHit]);

  const applySpellSuggestion = useCallback(
    (hit: SpellHit, replacement: string) => {
      const view = editorViewRef.current;
      if (!view) return false;
      const docStr = view.state.doc.toString();
      if (docStr !== heavyBody) return false;
      const { docFrom: from, docTo: to, word } = hit;
      const docLen = view.state.doc.length;
      if (from < 0 || to > docLen || from > to) return false;
      if (view.state.doc.sliceString(from, to) !== word) return false;
      view.dispatch({
        changes: { from, to, insert: replacement },
        selection: { anchor: from + replacement.length },
        scrollIntoView: true,
      });
      view.focus();
      return true;
    },
    [heavyBody],
  );

  const applySpellSuggestionAll = useCallback(
    (normalized: string, replacement: string) => {
      const view = editorViewRef.current;
      if (!view) return false;
      const docStr = view.state.doc.toString();
      if (docStr !== heavyBody) return false;
      const matches = spellHits.filter((h) => h.normalized === normalized);
      if (matches.length === 0) return false;
      const docLen = view.state.doc.length;
      for (const h of matches) {
        if (h.docFrom < 0 || h.docTo > docLen || h.docFrom > h.docTo)
          return false;
        if (view.state.doc.sliceString(h.docFrom, h.docTo) !== h.word)
          return false;
      }
      const changes = matches.map((h) => ({
        from: h.docFrom,
        to: h.docTo,
        insert: replacement,
      }));
      view.dispatch({ changes, scrollIntoView: true });
      view.focus();
      return true;
    },
    [heavyBody, spellHits],
  );

  const refreshSpell = useCallback(() => {
    setSpellBump((n) => n + 1);
  }, []);

  const applyLoadedPoem = useCallback((lib: DraftLibrary) => {
    const p = poemById(lib, lib.activeId);
    if (!p) return;
    if (bodyToReactTimer.current) {
      clearTimeout(bodyToReactTimer.current);
      bodyToReactTimer.current = null;
    }
    setTitle(p.title);
    setBody(p.body);
    bodyLiveRef.current = p.body;
    setHeavyBody(p.body);
    setFormNote(p.form ?? "");
    setSpellMode(p.spellMode ?? "permissive");
    setRevisions(loadRevisions(lib.activeId));
    setBodySyncNonce((n) => n + 1);

    // Inject sample poem for first-time visitors with an empty draft
    if (!readFirstVisitHintDismissed() && !isSampleDismissed() && !p.body.trim()) {
      setSamplePoemActive(true);
      setTitle(SAMPLE_POEM_TITLE);
      setBody(SAMPLE_POEM_BODY);
      bodyLiveRef.current = SAMPLE_POEM_BODY;
      setHeavyBody(SAMPLE_POEM_BODY);
      setBodySyncNonce((n) => n + 1);
    }
  }, []);

  const selectPoem = useCallback(
    (poemId: string) => {
      if (poemId === activePoemId) return;
      const flushed = upsertActivePoem(library, {
        title,
        body: bodyLiveRef.current,
        form: formNote,
        spellMode,
      });
      if (!saveLibrary(flushed)) {
        setPersistenceError(DRAFT_STORAGE_MSG);
        return;
      }
      const next = setActivePoem(flushed, poemId);
      if (!next) return;
      if (!saveLibrary(next)) {
        setPersistenceError(DRAFT_STORAGE_MSG);
        return;
      }
      setLibrary(next);
      // Update last-opened metadata (best effort).
      setMeta((prev) => {
        const patched = upsertDraftMeta(prev, poemId, {
          lastOpenedAt: new Date().toISOString(),
        });
        void saveDraftMetaMap(patched);
        return patched;
      });
      applyLoadedPoem(next);
    },
    [activePoemId, library, title, formNote, spellMode, applyLoadedPoem],
  );

  const newPoem = useCallback(() => {
    const flushed = upsertActivePoem(library, {
      title,
      body: bodyLiveRef.current,
      form: formNote,
      spellMode,
    });
    if (!saveLibrary(flushed)) {
      setPersistenceError(DRAFT_STORAGE_MSG);
      return;
    }
    const next = newBlankPoemAfter(flushed);
    if (!saveLibrary(next)) {
      setPersistenceError(DRAFT_STORAGE_MSG);
      return;
    }
    setLibrary(next);
    applyLoadedPoem(next);
  }, [library, title, formNote, spellMode, applyLoadedPoem]);

  const duplicatePoem = useCallback(() => {
    const flushed = upsertActivePoem(library, {
      title,
      body: bodyLiveRef.current,
      form: formNote,
      spellMode,
    });
    if (!saveLibrary(flushed)) {
      setPersistenceError(DRAFT_STORAGE_MSG);
      return;
    }
    const next = duplicateActivePoem(flushed);
    if (!next || !saveLibrary(next)) {
      setPersistenceError(DRAFT_STORAGE_MSG);
      return;
    }
    setLibrary(next);
    applyLoadedPoem(next);
  }, [library, title, formNote, spellMode, applyLoadedPoem]);

  const duplicatePoemById = useCallback(
    (poemId: string) => {
      const flushed = upsertActivePoem(library, {
        title,
        body: bodyLiveRef.current,
        form: formNote,
        spellMode,
      });
      if (!saveLibrary(flushed)) {
        setPersistenceError(DRAFT_STORAGE_MSG);
        return;
      }
      const next = duplicatePoemByIdInLib(flushed, poemId);
      if (!next || !saveLibrary(next)) {
        setPersistenceError(DRAFT_STORAGE_MSG);
        return;
      }
      setLibrary(next);
      applyLoadedPoem(next);
    },
    [library, title, formNote, spellMode, applyLoadedPoem],
  );

  const deleteCurrentPoem = useCallback(() => {
    if (library.poems.length <= 1) {
      window.alert("You only have one draft; add another before deleting this one.");
      return;
    }
    if (
      !window.confirm(
        "Delete this draft from this browser? Its snapshots for this poem will be removed too.",
      )
    ) {
      return;
    }
    const id = activePoemId;
    removeRevisionsForPoem(id);
    const flushed = upsertActivePoem(library, {
      title,
      body: bodyLiveRef.current,
      form: formNote,
      spellMode,
    });
    const without = removePoem(flushed, id);
    if (!saveLibrary(without)) {
      setPersistenceError(DRAFT_STORAGE_MSG);
      return;
    }
    setLibrary(without);
    applyLoadedPoem(without);
  }, [
    library,
    library.poems.length,
    activePoemId,
    title,
    formNote,
    spellMode,
    applyLoadedPoem,
  ]);

  const exportWorkshopBackup = useCallback(() => {
    const json = buildWorkshopExportJson({
      poems: library.poems,
      revisionsForPoem: loadRevisions,
    });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(`easy-poems-backup-${stamp}.json`, json);
    recordExportAt();
    setShowExportReminder(false);
  }, [library.poems]);

  const triggerImportBackup = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const onImportBackupFile = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === "string" ? reader.result : "";
        const { title: t, body: b, formNote: f, spellMode: sm, library: lib } =
          workshopStateRef.current;
        const flushed = upsertActivePoem(lib, {
          title: t,
          body: b,
          form: f,
          spellMode: sm,
        });
        if (!saveLibrary(flushed)) {
          setPersistenceError(DRAFT_STORAGE_MSG);
          return;
        }
        const merged = mergeImportedPoems(flushed, text);
        if ("error" in merged) {
          setImportNoticeKind("error");
          setImportNotice(merged.error);
          return;
        }
        if (!saveLibrary(merged.lib)) {
          setPersistenceError(DRAFT_STORAGE_MSG);
          return;
        }
        setImportNoticeKind("success");
        setImportNotice(`Imported ${merged.added} poem(s).`);
        setLibrary(merged.lib);
        applyLoadedPoem(merged.lib);
      };
      reader.onerror = () => {
        setImportNoticeKind("error");
        setImportNotice("Could not read the file. Check that it is a valid text file and try again.");
      };
      reader.onabort = () => {
        setImportNoticeKind("error");
        setImportNotice("File read was cancelled.");
      };
      reader.readAsText(file, "utf-8");
    },
    [applyLoadedPoem],
  );

  const dismissImportNotice = useCallback(() => {
    setImportNotice(null);
  }, []);

  // Check export reminder + storage quota once on mount
  useEffect(() => {
    setShowExportReminder(checkExportReminderDue(library));
    if (isLocalStorageNearlyFull()) {
      storageNearlyFullRef.current = true;
      setStorageNearlyFull(true);
      setPersistenceError(
        "Browser storage is nearly full. Export a backup now to avoid losing work.",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismissExportReminder = useCallback(() => {
    setShowExportReminder(false);
  }, []);

  const saveSnapshot = useCallback(() => {
    const result = addRevision(activePoemId, revisions, {
      title,
      body: bodyLiveRef.current,
      form: formNote.trim() || undefined,
      label: snapshotLabel.trim() || undefined,
      aiScore: lastAiScore ?? undefined,
    });
    if (!result.ok) {
      setPersistenceError(SNAPSHOT_SAVE_MSG);
      return;
    }
    setPersistenceError((prev) =>
      prev === SNAPSHOT_SAVE_MSG ? null : prev,
    );
    const next = result.revisions;
    setRevisions(next);
    if (!result.duplicate) setSnapshotLabel("");
    setSnapshotFlash(result.duplicate ? "duplicate" : "saved");
    if (snapshotFlashTimer.current) clearTimeout(snapshotFlashTimer.current);
    snapshotFlashTimer.current = setTimeout(() => {
      setSnapshotFlash(null);
      snapshotFlashTimer.current = null;
    }, 1800);
    setCompareLeftId((left) =>
      left === COMPARE_CURRENT_ID || (left && next.some((s) => s.id === left))
        ? left
        : COMPARE_CURRENT_ID,
    );
    setCompareRightId((right) => {
      if (right === COMPARE_CURRENT_ID) return right;
      if (right && next.some((s) => s.id === right)) return right;
      return next[0]?.id ?? COMPARE_CURRENT_ID;
    });
  }, [activePoemId, revisions, title, formNote, snapshotLabel, lastAiScore]);

  // Auto-snapshot every 10 minutes when the poem body has actually changed
  const lastAutoSnapshotBodyRef = useRef<string>("");
  useEffect(() => {
    const AUTO_INTERVAL_MS = 10 * 60 * 1000;
    const id = setInterval(() => {
      const { title: t, body: b, formNote: f, library: lib } = workshopStateRef.current;
      const poemId = lib.activeId;
      if (!b.trim()) return;
      if (b === lastAutoSnapshotBodyRef.current) return;
      const current = loadRevisions(poemId);
      const result = addRevision(poemId, current, {
        title: t,
        body: b,
        form: f.trim() || undefined,
        label: "Auto",
      });
      if (result.ok) {
        lastAutoSnapshotBodyRef.current = b;
        setRevisions(result.revisions);
      }
    }, AUTO_INTERVAL_MS);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyTemplate = useCallback((body: string, form: string) => {
    if (bodyToReactTimer.current) {
      clearTimeout(bodyToReactTimer.current);
      bodyToReactTimer.current = null;
    }
    setBody(body);
    bodyLiveRef.current = body;
    setHeavyBody(body);
    if (form) setFormNote(form);
    setBodySyncNonce((n) => n + 1);
  }, []);

  const applyLineRewrite = useCallback((lineStart: number, lineEnd: number, text: string) => {
    if (bodyToReactTimer.current) {
      clearTimeout(bodyToReactTimer.current);
      bodyToReactTimer.current = null;
    }
    const currentLines = bodyLiveRef.current.split("\n");
    const textLines = text.split("\n");
    currentLines.splice(lineStart - 1, lineEnd - lineStart + 1, ...textLines);
    const newBody = currentLines.join("\n");
    setBody(newBody);
    bodyLiveRef.current = newBody;
    setHeavyBody(newBody);
    setBodySyncNonce((n) => n + 1);
  }, []);

  const insertTextAtCursor = useCallback((text: string) => {
    const view = editorViewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: text },
      selection: { anchor: sel.from + text.length },
      scrollIntoView: true,
    });
    view.focus();
  }, []);

  /** If the line at the cursor has any word, replace its last word with `text`.
   * Otherwise insert `text` at the cursor. */
  const replaceEndWordOrInsert = useCallback((text: string) => {
    const view = editorViewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.from);
    const lineText = line.text;
    const re = /[a-zA-Z']+/g;
    let last: { start: number; end: number } | null = null;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lineText)) !== null) {
      last = { start: m.index, end: m.index + m[0].length };
    }
    if (!last) {
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: text },
        selection: { anchor: sel.from + text.length },
        scrollIntoView: true,
      });
    } else {
      const from = line.from + last.start;
      const to = line.from + last.end;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        scrollIntoView: true,
      });
    }
    view.focus();
  }, []);

  const insertTextAtEnd = useCallback((text: string) => {
    if (bodyToReactTimer.current) {
      clearTimeout(bodyToReactTimer.current);
      bodyToReactTimer.current = null;
    }
    const current = bodyLiveRef.current;
    const newBody = (current.trimEnd() ? current.trimEnd() + "\n" : "") + text;
    setBody(newBody);
    bodyLiveRef.current = newBody;
    setHeavyBody(newBody);
    setBodySyncNonce((n) => n + 1);
  }, []);

  const restoreRevision = useCallback((snap: RevisionSnapshot) => {
    if (bodyToReactTimer.current) {
      clearTimeout(bodyToReactTimer.current);
      bodyToReactTimer.current = null;
    }
    setTitle(snap.title);
    setBody(snap.body);
    bodyLiveRef.current = snap.body;
    setHeavyBody(snap.body);
    setFormNote(snap.form ?? "");
    setBodySyncNonce((n) => n + 1);
  }, []);

  const deleteRevision = useCallback(
    (id: string) => {
      const result = removeRevision(activePoemId, revisions, id);
      if (!result.ok) {
        setPersistenceError(SNAPSHOT_DELETE_MSG);
        return;
      }
      setPersistenceError((prev) =>
        prev === SNAPSHOT_DELETE_MSG ? null : prev,
      );
      const next = result.revisions;
      setRevisions(next);
      if (next.length === 0) {
        setCompareLeftId(COMPARE_CURRENT_ID);
        setCompareRightId(COMPARE_CURRENT_ID);
        return;
      }
      let newLeft = compareLeftId;
      let newRight = compareRightId;
      if (newLeft !== COMPARE_CURRENT_ID && !next.some((s) => s.id === newLeft)) {
        newLeft = COMPARE_CURRENT_ID;
      }
      if (newRight !== COMPARE_CURRENT_ID && !next.some((s) => s.id === newRight)) {
        newRight = next[0]!.id;
      }
      if (newLeft === COMPARE_CURRENT_ID && newRight === COMPARE_CURRENT_ID) {
        newRight = next[0]!.id;
      } else if (newLeft === newRight) {
        newRight =
          next.find((s) => s.id !== newLeft)?.id ?? COMPARE_CURRENT_ID;
      }
      setCompareLeftId(newLeft);
      setCompareRightId(newRight);
    },
    [activePoemId, revisions, compareLeftId, compareRightId],
  );

  const deleteDuplicateRevisions = useCallback(() => {
    const result = removeDuplicateRevisions(activePoemId, revisions);
    if (!result.ok) {
      setPersistenceError(SNAPSHOT_DELETE_MSG);
      return;
    }
    setPersistenceError((prev) =>
      prev === SNAPSHOT_DELETE_MSG ? null : prev,
    );
    if (result.removed === 0) return;
    const next = result.revisions;
    setRevisions(next);
    let newLeft = compareLeftId;
    let newRight = compareRightId;
    if (
      newLeft !== COMPARE_CURRENT_ID &&
      !next.some((s) => s.id === newLeft)
    ) {
      newLeft = COMPARE_CURRENT_ID;
    }
    if (
      newRight !== COMPARE_CURRENT_ID &&
      !next.some((s) => s.id === newRight)
    ) {
      newRight = next[0]?.id ?? COMPARE_CURRENT_ID;
    }
    if (
      newLeft !== COMPARE_CURRENT_ID &&
      newRight !== COMPARE_CURRENT_ID &&
      newLeft === newRight
    ) {
      newRight =
        next.find((s) => s.id !== newLeft)?.id ?? COMPARE_CURRENT_ID;
    }
    setCompareLeftId(newLeft);
    setCompareRightId(newRight);
  }, [activePoemId, revisions, compareLeftId, compareRightId]);

  const duplicateRevisionCount = useMemo(
    () => countDuplicateRevisions(revisions),
    [revisions],
  );

  const onDownloadTxt = useCallback(() => {
    const cleanBody = stripFormatMarkers(bodyLiveRef.current);
    const text = buildPlainTextTitleBody(
      title,
      formNote.trim() || undefined,
      cleanBody,
    );
    downloadTextFile(exportFilename(title, "txt", cleanBody), text);
    recordExportAt();
  }, [title, formNote]);

  const onDownloadMd = useCallback(() => {
    // Keep **bold** (valid markdown) but strip __underline__ (no markdown equivalent)
    const cleanBody = bodyLiveRef.current.replace(/__(.+?)__/g, "$1");
    const text = buildMarkdownPoem(
      title,
      formNote.trim() || undefined,
      cleanBody,
    );
    downloadTextFile(exportFilename(title, "md", cleanBody), text);
    recordExportAt();
  }, [title, formNote]);

  const onCopyMarkdown = useCallback(async () => {
    const cleanBody = bodyLiveRef.current.replace(/__(.+?)__/g, "$1");
    const text = buildMarkdownPoem(
      title,
      formNote.trim() || undefined,
      cleanBody,
    );
    try {
      await copyTextToClipboard(text);
      setCopyExportFlash(true);
      if (copyExportTimer.current) clearTimeout(copyExportTimer.current);
      copyExportTimer.current = setTimeout(() => {
        setCopyExportFlash(false);
        copyExportTimer.current = null;
      }, 1200);
    } catch {
      setPersistenceError("Could not copy to clipboard. Check browser permissions.");
    }
  }, [title, formNote]);

  const onQuickCopyPlain = useCallback(async () => {
    try {
      await copyTextToClipboard(stripFormatMarkers(bodyLiveRef.current));
      setQuickCopyFlash(true);
      if (quickCopyTimer.current) clearTimeout(quickCopyTimer.current);
      quickCopyTimer.current = setTimeout(() => {
        setQuickCopyFlash(false);
        quickCopyTimer.current = null;
      }, 1200);
    } catch {
      setPersistenceError("Could not copy to clipboard. Check browser permissions.");
    }
  }, []);

  const onDownloadDocx = useCallback(async () => {
    setExportErr(null);
    try {
      const cleanBody = stripFormatMarkers(bodyLiveRef.current);
      await downloadDocxFile(
        exportFilename(title, "docx", cleanBody),
        title,
        formNote.trim() || undefined,
        cleanBody,
      );
      recordExportAt();
    } catch (e) {
      setExportErr(
        e instanceof Error ? e.message : "Could not build the Word file.",
      );
    }
  }, [title, formNote]);

  const onDownloadPdf = useCallback(async () => {
    setExportErr(null);
    try {
      const cleanBody = stripFormatMarkers(bodyLiveRef.current);
      await downloadPdfFile(
        exportFilename(title, "pdf", cleanBody),
        title,
        formNote.trim() || undefined,
        cleanBody,
      );
      recordExportAt();
    } catch (e) {
      setExportErr(
        e instanceof Error ? e.message : "Could not build the PDF.",
      );
    }
  }, [title, formNote]);

  const onDownloadHtml = useCallback(async () => {
    setExportErr(null);
    try {
      const cleanBody = stripFormatMarkers(bodyLiveRef.current);
      await downloadHtmlFile(
        exportFilename(title, "html", cleanBody),
        title,
        formNote.trim() || undefined,
        cleanBody,
      );
      recordExportAt();
    } catch (e) {
      setExportErr(
        e instanceof Error ? e.message : "Could not build the HTML file.",
      );
    }
  }, [title, formNote]);

  const onDownloadPng = useCallback(async () => {
    setExportErr(null);
    try {
      const cleanBody = stripFormatMarkers(bodyLiveRef.current);
      await downloadPngFile(
        exportFilename(title, "png", cleanBody),
        title,
        formNote.trim() || undefined,
        cleanBody,
      );
      recordExportAt();
    } catch (e) {
      setExportErr(
        e instanceof Error ? e.message : "Could not build the image.",
      );
    }
  }, [title, formNote]);

  const updateGoal =
    (key: keyof WorkshopGoals) => (e: ChangeEvent<HTMLInputElement>) => {
      const v = parseGoalInput(e.target.value);
      setGoals((g) => ({ ...g, [key]: v }));
    };

  const setGoalValue = useCallback(
    (key: keyof WorkshopGoals, value: number | undefined) => {
      setGoals((g) => ({ ...g, [key]: value }));
    },
    [],
  );

  const setRhymeSchemeGoal = useCallback((scheme: string | undefined) => {
    setGoals((g) => ({ ...g, targetRhymeScheme: scheme }));
  }, []);

  const setRhymeSchemePerStanza = useCallback((perStanza: boolean) => {
    setGoals((g) => ({
      ...g,
      targetRhymeSchemePerStanza: perStanza ? true : undefined,
    }));
  }, []);

  const resetGoals = useCallback(() => {
    setGoals({});
  }, []);

  const setSyllablePattern = useCallback((pattern: number[] | undefined) => {
    setGoals((g) => ({ ...g, syllablePattern: pattern, preset: undefined }));
  }, []);

  const toggleGoalSoft = useCallback((key: string) => {
    setGoals((g) => {
      const soft = new Set(g.softGoals ?? []);
      if (soft.has(key)) soft.delete(key); else soft.add(key);
      return { ...g, softGoals: soft.size > 0 ? [...soft] : undefined };
    });
  }, []);

  const applyGoalPreset = useCallback((presetKey: string | null) => {
    if (presetKey === null) {
      setGoals((g) => ({ softGoals: g.softGoals }));
      return;
    }
    const preset = FORM_PRESETS.find((p) => p.key === presetKey);
    if (preset) {
      setGoals((g) => ({
        ...preset.goals,
        preset: presetKey,
        softGoals: g.softGoals,
      }));
    }
  }, []);

  const onSpellPersistenceError = useCallback((message: string) => {
    setPersistenceError(message);
  }, []);

  const poemOptions = useMemo(() => {
    const labelFor = (p: (typeof library.poems)[0]) =>
      meta[p.id]?.label?.trim() || p.title.trim() || "Untitled";
    return library.poems
      .slice()
      .filter(
        (p) =>
          !meta[p.id]?.archived || p.id === library.activeId,
      )
      .sort((a, b) => {
        const ma = meta[a.id] ?? {};
        const mb = meta[b.id] ?? {};
        const pa = ma.pinned ? 1 : 0;
        const pb = mb.pinned ? 1 : 0;
        if (pa !== pb) return pb - pa;
        const oa = ma.lastOpenedAt ? new Date(ma.lastOpenedAt).getTime() : 0;
        const ob = mb.lastOpenedAt ? new Date(mb.lastOpenedAt).getTime() : 0;
        if (oa !== ob) return ob - oa;
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      })
      .map((p) => ({
        id: p.id,
        label: labelFor(p),
        archived: Boolean(meta[p.id]?.archived),
      }));
  }, [library.poems, library.activeId, meta]);

  const setDraftLabel = useCallback((poemId: string, label: string) => {
    setMeta((prev) => {
      const patched = upsertDraftMeta(prev, poemId, { label });
      void saveDraftMetaMap(patched);
      return patched;
    });
  }, []);

  const togglePinned = useCallback((poemId: string) => {
    setMeta((prev) => {
      const pinned = Boolean(prev[poemId]?.pinned);
      const patched = upsertDraftMeta(prev, poemId, { pinned: !pinned });
      void saveDraftMetaMap(patched);
      return patched;
    });
  }, []);

  const setDraftTags = useCallback((poemId: string, tags: string[]) => {
    setMeta((prev) => {
      const patched = upsertDraftMeta(prev, poemId, { tags });
      void saveDraftMetaMap(patched);
      return patched;
    });
  }, []);

  const setDraftArchived = useCallback(
    (poemId: string, archived: boolean) => {
      setMeta((prev) => {
        const patched = upsertDraftMeta(prev, poemId, { archived });
        void saveDraftMetaMap(patched);
        return patched;
      });
    },
    [],
  );

  const clearSamplePoem = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY_SAMPLE_DISMISSED, "1"); } catch { /* ignore */ }
    setSamplePoemActive(false);
    setTitle("");
    setBody("");
    bodyLiveRef.current = "";
    setHeavyBody("");
    setBodySyncNonce((n) => n + 1);
  }, []);

  const keepSamplePoem = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY_SAMPLE_DISMISSED, "1"); } catch { /* ignore */ }
    setSamplePoemActive(false);
  }, []);

  return {
    title,
    setTitle,
    formNote,
    setFormNote,
    body,
    bodySyncNonce,
    onEditorBody,
    setBody,
    samplePoemActive,
    clearSamplePoem,
    keepSamplePoem,
    spellMode,
    setSpellMode,
    savedFlash,
    lastSavedAt,
    persistenceError,
    storageNearlyFull,
    dismissPersistenceError,
    importNotice,
    importNoticeKind,
    dismissImportNotice,
    showExportReminder,
    dismissExportReminder,
    wordlist,
    wordlistErr,
    retryWordlist,
    spellBump,
    editorViewRef,
    snapshotLabel,
    setSnapshotLabel,
    saveSnapshot,
    restoreRevision,
    deleteRevision,
    deleteDuplicateRevisions,
    duplicateRevisionCount,
    revisions,
    compareLeftId,
    compareRightId,
    setCompareLeftId,
    setCompareRightId,
    compareViewMode,
    setCompareViewMode,
    compareSnapshotOptions,
    compareLeftBody,
    compareRightBody,
    compareDiffRows,
    copyExportFlash,
    quickCopyFlash,
    snapshotFlash,
    exportErr,
    onDownloadTxt,
    onDownloadMd,
    onDownloadDocx,
    onDownloadPdf,
    onDownloadHtml,
    onDownloadPng,
    onCopyMarkdown,
    onQuickCopyPlain,
    toolTab,
    setToolTab,
    lines,
    quickDocStats,
    docStats,
    meterHints,
    stressLexiconReady: Boolean(stressLexicon),
    stressLexiconErr,
    rhymeClusters,
    stanzaRhymeGroups,
    vowelTailClusters,
    assonanceClusters,
    consonanceClusters,
    repeated,
    repetition,
    clicheHits,
    rhymeScheme,
    internalRhymes,
    spellHits,
    heavyToolsStale,
    meterCoverageSummary,
    goals,
    goalEvaluation,
    publication,
    goToLine,
    goToLineEnd,
    goToSpellHit,
    goToSpellHitAt,
    cycleSpellHit,
    spellNavIndex,
    applySpellSuggestion,
    applySpellSuggestionAll,
    refreshSpell,
    updateGoal,
    setGoalValue,
    setRhymeSchemeGoal,
    setRhymeSchemePerStanza,
    resetGoals,
    setSyllablePattern,
    toggleGoalSoft,
    applyGoalPreset,
    onSpellPersistenceError,
    jumpLine,
    jumpBump,
    activePoemId,
    library,
    poemOptions,
    draftMeta: meta,
    setDraftLabel,
    togglePinned,
    setDraftTags,
    setDraftArchived,
    selectPoem,
    newPoem,
    duplicatePoem,
    duplicatePoemById,
    deleteCurrentPoem,
    exportWorkshopBackup,
    triggerImportBackup,
    onImportBackupFile,
    importInputRef,
    applyTemplate,
    applyLineRewrite,
    insertTextAtCursor,
    replaceEndWordOrInsert,
    insertTextAtEnd,
    lastAiScore,
    setLastAiScore,
  };
}
