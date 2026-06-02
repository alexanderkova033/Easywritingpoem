import type { EditorView } from "@codemirror/view";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { isLocalStorageNearlyFull } from "@/shared/platform/browser-storage";
import {
  duplicateActivePoem,
  duplicatePoemById as duplicatePoemByIdInLib,
  loadOrCreateLibrary,
  newBlankPoemAfter,
  poemById,
  removePoem,
  saveLibrary,
  setActivePoem,
  upsertActivePoem,
  type DraftLibrary,
} from "@/workshop/library/local-draft-library";
import {
  saveDraftMetaMap,
  upsertDraftMeta,
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
  loadPersonalDictionary,
  loadSessionIgnores,
} from "@/spellcheck/personal-dictionary";
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
import {
  meterHintsForBody,
  summarizeMeterCoverage,
  type ManualStressOverrides,
} from "@/workshop/meter/meter-hints";
import { useHeavyAnalysis } from "@/workshop/analysis/use-heavy-analysis";
import { buildPublicationChecklist } from "@/workshop/analysis/publication-checklist";
import { detectRhymeScheme, type RhymeBreadth } from "@/workshop/rhyme/scheme";
import {
  focusCharacterRangeInEditor,
  focusCursorInEditor,
  focusLastWordInLine,
  focusLineInEditor,
} from "@/workshop/editor/focus-line-in-editor";
import { isTypingInField } from "@/workshop/hints/keyboard-field-target";
import { TOOL_TABS } from "@/workshop/analysis/ToolTabBar";
import { readFirstVisitHintDismissed } from "./firstVisitHintStorage";
import { type ToolTab } from "@/workshop/shell/workshop-helpers";
import {
  STORAGE_KEY_LAST_EXPORT_AT,
  STORAGE_KEY_LAST_TOOL_TAB,
  STORAGE_KEY_SAMPLE_DISMISSED,
} from "@/shared/storage-keys";
import { useDictionaries } from "./hooks/useDictionaries";
import { useGoalsState } from "./hooks/useGoalsState";
import { useDraftMeta } from "./hooks/useDraftMeta";
import { useExportActions } from "./hooks/useExportActions";

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
  if (!readFirstVisitHintDismissed()) return "suggest";
  return "issues";
}

const DRAFT_STORAGE_MSG =
  "Could not save your drafts to this browser (storage may be full or blocked).";
const SNAPSHOT_SAVE_MSG =
  "Could not save the snapshot (browser storage may be full or blocked).";
const SNAPSHOT_DELETE_MSG =
  "Could not update snapshots in browser storage.";

export function usePoemWorkshopModel(
  rhymeBreadth: RhymeBreadth = "near",
  manualRhymeLinks: string[] = [],
  manualRhymeUnlinks: string[] = [],
  manualStressOverrides: ManualStressOverrides = {},
) {
  const [library, setLibrary] = useState<DraftLibrary>(() => {
    migrateLegacyDraftIfNeeded();
    return loadOrCreateLibrary();
  });
  const [title, setTitle] = useState("");
  const [formNote, setFormNote] = useState("");
  const [body, setBody] = useState("");
  const [bodySyncNonce, setBodySyncNonce] = useState(0);
  const [samplePoemActive, setSamplePoemActive] = useState(false);
  const bodyLiveRef = useRef("");
  const bodyToReactTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [spellBump, setSpellBump] = useState(0);
  const [spellNavIndex, setSpellNavIndex] = useState(0);
  const [revisions, setRevisions] = useState<RevisionSnapshot[]>([]);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [lastAiScore, setLastAiScore] = useState<number | null>(null);
  const [snapshotFlash, setSnapshotFlash] = useState<"saved" | "duplicate" | null>(null);
  const snapshotFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [jumpLine, setJumpLine] = useState<number | null>(null);
  const [jumpBump, setJumpBump] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const [toolTab, setToolTabInner] = useState<ToolTab>(() => readSessionToolTab());
  const setToolTab = useCallback((t: ToolTab) => {
    setToolTabInner(t);
    try {
      sessionStorage.setItem(LAST_TOOL_TAB_KEY, t);
    } catch {
      /* ignore */
    }
  }, []);

  const activePoemId = library.activeId;

  // === Extracted hooks ===
  const { wordlist, wordlistErr, retryWordlist, stressLexicon, stressLexiconErr } =
    useDictionaries();

  const clearPersistenceErrorIfMatches = useCallback((msg: string) => {
    setPersistenceError((prev) => (prev === msg ? null : prev));
  }, []);

  const {
    goals,
    updateGoal,
    setGoalValue,
    setRhymeSchemeGoal,
    setRhymeSchemePerStanza,
    resetGoals,
    setSyllablePattern,
    toggleGoalSoft,
    applyGoalPreset,
  } = useGoalsState(setPersistenceError, clearPersistenceErrorIfMatches);

  const {
    meta,
    setMeta,
    poemOptions,
    setDraftLabel,
    togglePinned,
    setDraftTags,
    setDraftArchived,
  } = useDraftMeta(library);

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
    () => meterHintsForBody(heavyBody, stressLexicon, manualStressOverrides),
    [heavyBody, stressLexicon, manualStressOverrides],
  );
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

  const goToLine = useCallback((line1Based: number) => {
    const view = editorViewRef.current;
    if (!view) return;
    setJumpLine(line1Based);
    setJumpBump((n) => n + 1);
    focusLineInEditor(view, line1Based);
  }, []);

  const goToWord = useCallback(
    (line1Based: number, startCol: number, endCol: number) => {
      const view = editorViewRef.current;
      if (!view) return;
      setJumpLine(line1Based);
      setJumpBump((n) => n + 1);
      const doc = view.state.doc;
      if (line1Based < 1 || line1Based > doc.lines) return;
      const docLine = doc.line(line1Based);
      const from = Math.max(docLine.from, docLine.from + Math.max(0, startCol));
      const to = Math.min(docLine.to, docLine.from + Math.max(startCol, endCol));
      focusCharacterRangeInEditor(view, from, to);
    },
    [],
  );

  const goToWordStart = useCallback(
    (line1Based: number, phrase: string) => {
      const view = editorViewRef.current;
      if (!view) return;
      const doc = view.state.doc;
      if (line1Based < 1 || line1Based > doc.lines) return;
      const docLine = doc.line(line1Based);
      const haystack = docLine.text;
      const needle = phrase.trim();
      let col = 0;
      if (needle) {
        const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        const m = haystack.match(re);
        if (m && m.index != null) {
          col = m.index;
        } else {
          const idx = haystack.toLowerCase().indexOf(needle.toLowerCase());
          if (idx >= 0) col = idx;
        }
      }
      setJumpLine(line1Based);
      setJumpBump((n) => n + 1);
      focusCursorInEditor(view, docLine.from + col);
    },
    [],
  );

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
      setMeta((prev) => {
        const patched = upsertDraftMeta(prev, poemId, {
          lastOpenedAt: new Date().toISOString(),
        });
        void saveDraftMetaMap(patched);
        return patched;
      });
      applyLoadedPoem(next);
    },
    [activePoemId, library, title, formNote, spellMode, applyLoadedPoem, setMeta],
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

  const dismissImportNotice = useCallback(() => {
    setImportNotice(null);
  }, []);

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

  // === Export actions hook (downloads / copy / import) ===
  const {
    copyExportFlash,
    quickCopyFlash,
    exportErr,
    importInputRef,
    onDownloadTxt,
    onDownloadMd,
    onDownloadDocx,
    onDownloadPdf,
    onDownloadHtml,
    onDownloadPng,
    onCopyMarkdown,
    onQuickCopyPlain,
    exportWorkshopBackup,
    triggerImportBackup,
    onImportBackupFile,
    folderPickerSupported,
    folderSaveFlash,
    saveCurrentPoemToFolder,
    saveAllPoemsToFolder,
  } = useExportActions({
    title,
    formNote,
    bodyLiveRef,
    library,
    workshopStateRef,
    setLibrary,
    setPersistenceError,
    setImportNotice,
    setImportNoticeKind,
    applyLoadedPoem,
    setShowExportReminder,
  });

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
    setRevisions(result.revisions);
    if (!result.duplicate) setSnapshotLabel("");
    setSnapshotFlash(result.duplicate ? "duplicate" : "saved");
    if (snapshotFlashTimer.current) clearTimeout(snapshotFlashTimer.current);
    snapshotFlashTimer.current = setTimeout(() => {
      setSnapshotFlash(null);
      snapshotFlashTimer.current = null;
    }, 1800);
  }, [activePoemId, revisions, title, formNote, snapshotLabel, lastAiScore]);

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
    const view = editorViewRef.current;
    if (view) {
      const doc = view.state.doc;
      const endPos = doc.length;
      const needsLeadingNewline = endPos > 0 && doc.sliceString(endPos - 1, endPos) !== "\n";
      const insert = (needsLeadingNewline ? "\n" : "") + text;
      view.dispatch({
        changes: { from: endPos, to: endPos, insert },
        selection: { anchor: endPos + insert.length },
        scrollIntoView: true,
      });
      view.focus();
      return;
    }
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
      setRevisions(result.revisions);
    },
    [activePoemId, revisions],
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
    setRevisions(result.revisions);
  }, [activePoemId, revisions]);

  const duplicateRevisionCount = useMemo(
    () => countDuplicateRevisions(revisions),
    [revisions],
  );

  const onSpellPersistenceError = useCallback((message: string) => {
    setPersistenceError(message);
  }, []);

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
    stressLexicon,
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
    goToWord,
    goToWordStart,
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
    folderPickerSupported,
    folderSaveFlash,
    saveCurrentPoemToFolder,
    saveAllPoemsToFolder,
    applyTemplate,
    applyLineRewrite,
    insertTextAtCursor,
    replaceEndWordOrInsert,
    insertTextAtEnd,
    lastAiScore,
    setLastAiScore,
  };
}
