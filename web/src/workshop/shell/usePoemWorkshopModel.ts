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
  loadRevisions,
  removeRevision,
  removeRevisionsForPoem,
  type RevisionSnapshot,
} from "@/workshop/library/revision-snapshots";
import {
  loadWorkshopGoals,
  saveWorkshopGoals,
  type WorkshopGoals,
  FORM_PRESETS,
} from "@/workshop/library/workshop-goals";
import { loadPersonalDictionary, loadSessionIgnores } from "@/spellcheck/personal-dictionary";
import { loadEnglishWordlist } from "@/spellcheck/wordlist";
import type { SpellHit } from "@/spellcheck/scan";
import { spellHitsFromText } from "@/spellcheck/scan";
import {
  BODY_TO_REACT_DEBOUNCE_MS,
  SPELL_ANALYSIS_DEBOUNCE_MS,
} from "@/spellcheck/spell-timing";
import { evaluateGoals } from "@/workshop/analysis/goal-metrics";
import { linesFromBody } from "@/workshop/analysis/lines-from-body";
import {
  computeDocumentStats,
  computeQuickDocumentStats,
} from "@/workshop/analysis/line-stats";
import { loadStressLexicon } from "@/workshop/analysis/cmu-stress-lexicon";
import {
  meterHintsForBody,
  summarizeMeterCoverage,
} from "@/workshop/analysis/meter-hints";
import { findRepeatedWords } from "@/workshop/analysis/repeated-words";
import { buildPublicationChecklist } from "@/workshop/analysis/publication-checklist";
import {
  lightAssonanceClusters,
  lightConsonanceClusters,
  lightVowelTailClusters,
  roughRhymeClusters,
} from "@/workshop/analysis/rhyme-hints";
import { scanCliches } from "@/workshop/analysis/cliche-scan";
import { detectRhymeScheme, type RhymeBreadth } from "@/workshop/analysis/rhyme-scheme";
import {
  focusCharacterRangeInEditor,
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

export function usePoemWorkshopModel(rhymeBreadth: RhymeBreadth = "near") {
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
  const [snapshotFlash, setSnapshotFlash] = useState(false);
  const snapshotFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [docxExportErr, setDocxExportErr] = useState<string | null>(null);
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
    void loadEnglishWordlist()
      .then((w) => {
        setWordlist(w);
        setWordlistErr(null);
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "Could not load word list.";
        setWordlistErr(msg);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordlistRetryBump]);

  useEffect(() => {
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

  useEffect(() => {
    const t = setTimeout(() => {
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
        // Re-check storage fullness on every save so we warn promptly
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
    }, 500);
    return () => clearTimeout(t);
  }, [title, body, formNote, spellMode, activePoemId]);

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
  const rhymeClusters = useMemo(
    () => roughRhymeClusters(heavyLines),
    [heavyLines],
  );
  const vowelTailClusters = useMemo(
    () => lightVowelTailClusters(heavyLines),
    [heavyLines],
  );
  const assonanceClusters = useMemo(
    () => lightAssonanceClusters(heavyLines),
    [heavyLines],
  );
  const consonanceClusters = useMemo(
    () => lightConsonanceClusters(heavyLines),
    [heavyLines],
  );
  const repeated = useMemo(() => findRepeatedWords(heavyLines), [heavyLines]);
  const clicheHits = useMemo(() => scanCliches(heavyLines), [heavyLines]);
  const rhymeScheme = useMemo(() => detectRhymeScheme(lines, rhymeBreadth), [lines, rhymeBreadth]);
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
    () => evaluateGoals(docStats, goals),
    [docStats, goals],
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
      if (!e.ctrlKey || !e.altKey) return;
      if (e.key !== "," && e.key !== ".") return;
      if (isTypingInField(e.target)) return;
      if (spellHits.length === 0) return;
      e.preventDefault();
      const delta = e.key === "." ? 1 : -1;
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
    setSnapshotLabel("");
    setSnapshotFlash(true);
    if (snapshotFlashTimer.current) clearTimeout(snapshotFlashTimer.current);
    snapshotFlashTimer.current = setTimeout(() => {
      setSnapshotFlash(false);
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

  const onDownloadTxt = useCallback(() => {
    const text = buildPlainTextTitleBody(
      title,
      formNote.trim() || undefined,
      stripFormatMarkers(bodyLiveRef.current),
    );
    downloadTextFile(exportFilename(title, "txt"), text);
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
    downloadTextFile(exportFilename(title, "md"), text);
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
    setDocxExportErr(null);
    try {
      await downloadDocxFile(
        exportFilename(title, "docx"),
        title,
        formNote.trim() || undefined,
        stripFormatMarkers(bodyLiveRef.current),
      );
      recordExportAt();
    } catch (e) {
      setDocxExportErr(
        e instanceof Error ? e.message : "Could not build the Word file.",
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
      setGoals((g) => ({ ...g, [key]: value, preset: undefined }));
    },
    [],
  );

  const applyGoalPreset = useCallback((presetKey: string | null) => {
    if (presetKey === null) {
      setGoals({});
      return;
    }
    const preset = FORM_PRESETS.find((p) => p.key === presetKey);
    if (preset) setGoals({ ...preset.goals, preset: presetKey });
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
    docxExportErr,
    onDownloadTxt,
    onDownloadMd,
    onDownloadDocx,
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
    vowelTailClusters,
    assonanceClusters,
    consonanceClusters,
    repeated,
    clicheHits,
    rhymeScheme,
    spellHits,
    heavyToolsStale,
    meterCoverageSummary,
    goals,
    goalEvaluation,
    publication,
    goToLine,
    goToSpellHit,
    goToSpellHitAt,
    cycleSpellHit,
    spellNavIndex,
    applySpellSuggestion,
    refreshSpell,
    updateGoal,
    setGoalValue,
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
    insertTextAtEnd,
    lastAiScore,
    setLastAiScore,
  };
}
