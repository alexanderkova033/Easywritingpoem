import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RailIcon } from "./components/RailIcon";
import { WritingPrompt } from "./components/WritingPrompt";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  applyAppearance,
  loadAppearance,
  saveAppearance,
  type AppearanceSettings,
} from "@/workshop/appearance/appearance";
import { AppearanceFormFields } from "@/workshop/appearance/AppearanceFormFields";
import { BackdropFormFields, BackdropMotionToggle } from "@/workshop/appearance/BackdropFormFields";
import { lazyWithReload } from "@/app/lazy-with-reload";
import {
  isPreloadAllChunksEnabled,
  setPreloadAllChunksEnabled,
  preloadAllChunksNow,
} from "@/app/preload-chunks";
// BackgroundPicker pulls in the full AI theme generator + ColorEditor; only
// rendered when the user opens the Page Background modal. Lazy keeps it off
// the initial workshop bundle.
const BackgroundPicker = lazy(
  lazyWithReload(() =>
    import("@/workshop/appearance/backgrounds/BackgroundPicker").then((m) => ({ default: m.BackgroundPicker })),
  ),
);
import { FirstVisitHint } from "./FirstVisitHint";
import { SamplePoemBanner } from "./SamplePoemBanner";
import { RhymeTooltip } from "@/workshop/rhyme/RhymeTooltip";
import { FeedbackWidget } from "./FeedbackWidget";
import { PoemBodyEditor } from "@/workshop/editor/PoemBodyEditor";
import { TOOL_TABS } from "@/workshop/analysis/ToolTabBar";
import { useToolTabListKeyboard } from "@/workshop/analysis/useToolTabListKeyboard";
import { useWorkshopToolHotkeys } from "@/workshop/analysis/useWorkshopToolHotkeys";
// Lazy-load the full tools panel — it pulls in all tool components (rhyme, syllables,
// spell, stats, suggest, etc.) which would otherwise inflate the critical-path bundle.
const WorkshopToolPanels = lazy(
  lazyWithReload(() =>
    import("@/workshop/analysis/WorkshopToolPanels").then((m) => ({ default: m.WorkshopToolPanels })),
  ),
);
import type { DraftMeta } from "@/workshop/library/library-meta";
import type { PoemRecord } from "@/workshop/library/local-draft-library";
import { usePoemWorkshopModel } from "./usePoemWorkshopModel";
import { FORM_PRESETS } from "@/workshop/goals/types";
import { FocusNotesPanel } from "@/workshop/goals/FocusNotesPanel";
import { loadLastAnalysis, loadIgnoredIssueIds } from "@/workshop/analysis/ai-analysis-storage";
// Lazy-load the AI analysis panel — it pulls in the analyze/compare client,
// chat UI, and rationale renderer, none of which are needed for first paint.
const AiAnalysis = lazy(
  lazyWithReload(() =>
    import("@/workshop/analysis/AiAnalysis").then((m) => ({ default: m.AiAnalysis })),
  ),
);
import { useWritingStreakOnMount } from "@/workshop/shell/useWritingStreakOnMount";
import { useVirtualKeyboardClass } from "@/workshop/shell/useVirtualKeyboardClass";
import { AiSummaryPopover } from "@/workshop/analysis/AiSummaryPopover";
import { AiLineRibbons } from "@/workshop/analysis/AiLineRibbons";
import type { AnalysisIssue, PoemAnalysis, PoemComparison } from "@/workshop/analysis/ai-analyze";
import { STORAGE_KEY_AI_SCORING_ENABLED } from "@/shared/storage-keys";
import { detectPoemForm, type LocalAnalysisContext } from "@/workshop/analysis/ai-analyze";
import { FormatToolbar } from "@/workshop/editor/FormatToolbar";
import { SelectionSuggestPopover } from "@/workshop/editor/SelectionSuggestPopover";
import { checkShareHash } from "@/workshop/sharing/sharing";
import { CommandPalette, toolTabActions, type CommandPaletteAction } from "@/workshop/palette/CommandPalette";
import { FindReplaceBar } from "@/workshop/editor/FindReplaceBar";
import { diffWords } from "@/workshop/editor/word-diff";
import type { RevisionSnapshot } from "@/workshop/library/revision-snapshots";
import {
  TOOL_BUCKET_LABEL,
  TOOL_BUCKET_ORDER,
  defaultTabForBucket,
  formatRelativeSnapshotWhen,
  tabsForBucket,
  toolTabBucket,
} from "./workshop-helpers";
import { STORAGE_KEY_SHOW_LINE_SYLLABLES, STORAGE_KEY_SHOW_RHYME_SCHEME, STORAGE_KEY_RHYME_SCHEME_BREADTH, STORAGE_KEY_WORD_LOOKUP_ENABLED, STORAGE_KEY_TABS_EXPANDED } from "@/shared/storage-keys";
import { usePanelLayout, DEFAULT_TOOLS_W, DEFAULT_RAIL_W, MIN_EDITOR_W } from "./hooks/usePanelLayout";
import { useSheetDrag } from "./hooks/useSheetDrag";
import { InlineRhymeHint } from "@/workshop/editor/InlineRhymeHint";
import { MobileActionBar, type MobileTab } from "./MobileActionBar";
import { WorkshopModals } from "./WorkshopModals";
import { WorkshopBanners } from "./WorkshopBanners";
import { WorkshopTopbarHeader } from "./WorkshopTopbarHeader";
import { WorkshopLibraryModal } from "./WorkshopLibraryModal";
import { endingForBreadth, type RhymeBreadth } from "@/workshop/rhyme/scheme";
import { useIgnoredRhymes, useManualRhymeLinks, useManualRhymeUnlinks } from "@/workshop/rhyme/rhyme-storage";
import { useManualStressOverrides } from "@/workshop/meter/stress-storage";
import { meterMarksForLine } from "@/workshop/meter/meter-marks";
import { useGlobalKeyboardShortcuts } from "./hooks/useGlobalKeyboardShortcuts";
import { ExportModal } from "./ExportModal";
import { ShortcutsModal } from "./ShortcutsModal";
import { SpotlightTour } from "@/workshop/tour/SpotlightTour";
import {
  useHoverHintBinder,
  useHoverHintsSettings,
} from "@/workshop/hints/HoverHintsContext";
import "./PoemWorkshop.css";
import "./PoemWorkshop.meter.css";
import "./PoemWorkshop.rhyme.css";
import "./PoemWorkshop.snapshot.css";
import "@/workshop/vocabulary/WordLookupPopup.css";

function endWordOfLineRaw(line: string | undefined): string {
  if (!line) return "";
  const m = line.match(/[A-Za-z'’]+(?=[^A-Za-z'’]*$)/);
  return m ? m[0] : "";
}

function deriveAiHighlights(poemId: string | undefined): {
  lines: Array<[number, number, string?]>;
  words: Array<{ words: string[]; lineStart: number; lineEnd: number; severity?: string }>;
} {
  const saved = loadLastAnalysis(poemId);
  if (!saved) return { lines: [], words: [] };
  const ignored = loadIgnoredIssueIds(poemId);
  const issues = saved.issues.filter((i) => !ignored.has(i.id));
  return {
    lines: issues.map((iss) => [iss.line_start, iss.line_end, iss.severity] as [number, number, string?]),
    words: issues
      .filter((iss) => iss.problem_words && iss.problem_words.length > 0)
      .map((iss) => ({ words: iss.problem_words!, lineStart: iss.line_start, lineEnd: iss.line_end, severity: iss.severity })),
  };
}

const IS_TOUCH_DEVICE =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

export function PoemWorkshop() {
  const [rhymeBreadth, setRhymeBreadth] = useState<RhymeBreadth>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_RHYME_SCHEME_BREADTH);
      if (raw === "strict" || raw === "near" || raw === "broad") return raw;
    } catch { /* ignore */ }
    return "near";
  });

  const manualRhymeLinks = useManualRhymeLinks();
  const manualRhymeUnlinks = useManualRhymeUnlinks();
  const manualStress = useManualStressOverrides();
  const m = usePoemWorkshopModel(
    rhymeBreadth,
    manualRhymeLinks.links,
    manualRhymeUnlinks.unlinks,
    manualStress.overrides,
  );
  const bucketTabs = tabsForBucket(toolTabBucket(m.toolTab));
  const onToolTabKeyDown = useToolTabListKeyboard(
    m.toolTab,
    m.setToolTab,
    bucketTabs,
  );
  useWorkshopToolHotkeys(m.toolTab, m.setToolTab);

  useWritingStreakOnMount(m.body);

  const mainIdeaStorageKey = (poemId: string | undefined) =>
    poemId ? `easy-poems:main-idea:${poemId}` : null;
  const readMainIdea = (poemId: string | undefined) => {
    const key = mainIdeaStorageKey(poemId);
    if (!key) return "";
    try {
      const scoped = localStorage.getItem(key);
      if (scoped != null) return scoped;
      // One-time migration: if a legacy global value exists and the active
      // poem has no scoped value yet, claim it for this poem so the user
      // doesn't lose what they typed before this fix.
      const legacy = localStorage.getItem("easy-poems:main-idea");
      if (legacy) {
        localStorage.setItem(key, legacy);
        localStorage.removeItem("easy-poems:main-idea");
        return legacy;
      }
    } catch { /* ignore */ }
    return "";
  };
  const [mainIdea, setMainIdea] = useState(() => readMainIdea(m.activePoemId));
  useEffect(() => {
    setMainIdea(readMainIdea(m.activePoemId));
  }, [m.activePoemId]);
  const saveMainIdea = (v: string) => {
    setMainIdea(v);
    const key = mainIdeaStorageKey(m.activePoemId);
    if (!key) return;
    try {
      if (v.trim()) localStorage.setItem(key, v);
      else localStorage.removeItem(key);
    } catch { /* ignore */ }
  };
  const [mainIdeaOpen, setMainIdeaOpen] = useState(() => {
    try { return localStorage.getItem("easy-poems:main-idea-open") !== "0"; } catch { return true; }
  });
  const toggleMainIdea = () => {
    setMainIdeaOpen((v) => {
      const next = !v;
      try { localStorage.setItem("easy-poems:main-idea-open", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isStyleOpen, setIsStyleOpen] = useState(false);
  const [isBackgroundOpen, setIsBackgroundOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const statsPopoverRef = useRef<HTMLDivElement | null>(null);
  // Alias for code that previously used this name
  const setIsAppearanceOpen = (v: boolean) => setIsStyleOpen(v);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isCmdkOpen, setIsCmdkOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [findMode, setFindMode] = useState<"find" | "replace">("find");
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySort, setLibrarySort] = useState<
    "recent" | "title" | "updated"
  >("recent");
  const [libraryShowArchived, setLibraryShowArchived] = useState(false);
  const librarySearchRef = useRef<HTMLInputElement | null>(null);
  const [libraryActiveIdx, setLibraryActiveIdx] = useState(0);
  const [mobileTab, setMobileTab] = useState<"write" | "tools" | "library">("write");
  const mobileToolsExpanded = mobileTab === "tools";
  // Bottom-sheet snap point on mobile when tools tab is active. Reset to "half" each time it opens.
  const [mobileSheetSnap, setMobileSheetSnap] = useState<"half" | "full">("half");
  const setMobileToolsExpanded = (v: boolean) => {
    if (v) setMobileSheetSnap("half");
    setMobileTab(v ? "tools" : "write");
  };
  const [topbarOverflowOpen, setTopbarOverflowOpen] = useState(false);
  const overflowMenuRef = useRef<HTMLDivElement | null>(null);
  const [allTabsExpanded, setAllTabsExpanded] = useState(() => {
    try { return !!localStorage.getItem(STORAGE_KEY_TABS_EXPANDED); } catch { return false; }
  });
  const expandAllTabs = () => {
    try { localStorage.setItem(STORAGE_KEY_TABS_EXPANDED, "1"); } catch { /* ignore */ }
    setAllTabsExpanded(true);
  };

  const {
    workshopGridRef,
    toolsPanelWidth,
    railWidth,
    applyToolsW,
    applyRailW,
    saveToolsW,
    saveRailW,
    resetLayout,
    handleResizeStart,
    handleRailResizeStart,
  } = usePanelLayout();
  // Collapsible title area on mobile
  const [metaOpen, setMetaOpen] = useState(() => !m.title.trim());
  // Fully hide the title bar to maximise writing space
  const [metaHidden, setMetaHidden] = useState(false);
  // Format toolbar collapsed by default on mobile
  const [mobileToolbarOpen, setMobileToolbarOpen] = useState(false);
  useEffect(() => { if (!m.title.trim()) { setMetaOpen(true); setMetaHidden(false); } }, [m.title]);

  // Swipe gesture state
  const swipeRef = useRef<{ x: number; y: number; t: number } | null>(null);

  const [diffSnapshot, setDiffSnapshot] = useState<RevisionSnapshot | null>(null);
  const handleDiffSnapshot = useCallback((snap: RevisionSnapshot) => {
    setDiffSnapshot((cur) => (cur?.id === snap.id ? null : snap));
  }, []);
  const exitDiffSnapshot = useCallback(() => setDiffSnapshot(null), []);

  // Word-level adds/removes for the diff bar stats. Word tokens only — skip
  // whitespace/punctuation so the count matches what the writer sees.
  const diffStats = useMemo(() => {
    if (!diffSnapshot) return null;
    const ops = diffWords(diffSnapshot.body, m.body);
    let added = 0;
    let removed = 0;
    for (const op of ops) {
      if (op.kind === "keep") continue;
      const words = (op.text.match(/[A-Za-z0-9_']+/g) ?? []).length;
      if (op.kind === "add") added += words;
      else removed += words;
    }
    return { added, removed };
  }, [diffSnapshot, m.body]);

  const [aiResult, setAiResult] = useState<PoemAnalysis | PoemComparison | null>(null);
  const [aiVisibleIssues, setAiVisibleIssues] = useState<AnalysisIssue[]>([]);
  const [aiIgnoredIds, setAiIgnoredIds] = useState<Set<string>>(() => loadIgnoredIssueIds(undefined));
  const aiScoringEnabled = (() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_AI_SCORING_ENABLED);
      return raw !== "0" && raw !== "false";
    } catch { return true; }
  })();

  useVirtualKeyboardClass();

  const [issueHighlight, setIssueHighlight] = useState<[number, number, string?] | null>(null);
  // Restore highlights from saved analysis on first mount so reload doesn't
  // wipe the dots/line backgrounds that were visible before the refresh.
  const [persistentIssueHighlights, setPersistentIssueHighlights] = useState<Array<[number, number, string?]>>(
    () => deriveAiHighlights(m.activePoemId).lines,
  );
  const [wordHighlights, setWordHighlights] = useState<Array<{ words: string[]; lineStart: number; lineEnd: number; severity?: string }>>(
    () => deriveAiHighlights(m.activePoemId).words,
  );
  const rhymeIgnored = useIgnoredRhymes();
  const [repeatSubTab, setRepeatSubTab] = useState<"words" | "phrases" | "patterns">("words");
  const [cursorLine, setCursorLine] = useState<number>(1);
  const [rhymeFinderQuery, setRhymeFinderQuery] = useState<{ word: string; bump: number; expand?: boolean } | undefined>(undefined);
  const [hoveredRhymeWord, setHoveredRhymeWord] = useState<string | null>(null);
  const [echoHighlights, setEchoHighlights] = useState<
    Array<{ line: number; start: number; end: number; colorKey: string; color?: string }> | null
  >(null);
  const [lineVowelTints, setLineVowelTints] = useState<
    Array<{ line: number; bucket: "bright" | "mid" | "dark"; active?: boolean }> | null
  >(null);
  const [flowMarkers, setFlowMarkers] = useState<
    Array<{ line: number; endStop: "hard" | "soft" | "open"; caesuraColumn: number | null; active?: boolean }> | null
  >(null);

  // Stress dots anchored on vowel positions, rendered when the Stress & meter
  // tab is active. Each vowel becomes a Decoration.mark; CSS draws the dot
  // above the character so the text isn't shifted.
  const meterOverlay = useMemo(() => {
    if (m.toolTab !== "meter") return null;
    const out: Array<{ line: number; marks: Array<{ col: number; stress: boolean }> }> = [];
    for (let i = 0; i < m.lines.length; i++) {
      const lineText = m.lines[i] ?? "";
      if (!lineText.trim()) continue;
      const marks = meterMarksForLine(lineText, m.stressLexicon, manualStress.overrides);
      if (marks.length === 0) continue;
      out.push({ line: i + 1, marks });
    }
    return out.length === 0 ? null : out;
  }, [m.toolTab, m.lines, m.stressLexicon, manualStress.overrides]);

  const rhymeBumpRef = useRef(0);

  const baseRhymeEndHighlights = useMemo(() => {
    if (m.toolTab !== "rhyme") return [] as Array<{ line: number; colorKey: string }>;
    // Color key = scheme letter (lowercased). Same rhyme group → same key →
    // same colour across every stanza it appears in.
    const out: Array<{ line: number; colorKey: string }> = [];
    const seen = new Set<number>();
    for (const group of m.stanzaRhymeGroups) {
      for (const c of group.clusters) {
        const words = c.lineNumbers.map((n) => {
          const ln = m.lines[n - 1] ?? "";
          const mm = ln.match(/[a-zA-Z']+(?=[^a-zA-Z']*$)/);
          return mm ? mm[0] : "";
        });
        if (rhymeIgnored.isIgnored(words)) continue;
        const key = (c.label ?? "").charAt(0).toLowerCase() || "x";
        for (const line of c.lineNumbers) {
          if (seen.has(line)) continue;
          out.push({ line, colorKey: key });
          seen.add(line);
        }
      }
    }
    return out;
  }, [m.toolTab, m.stanzaRhymeGroups, m.lines, rhymeIgnored]);

  // Auto-fill the Rhyme Finder when the cursor parks on a different line or
  // the user opens the rhyme tab. Avoids refiring on every keystroke.
  const rhymeLinesRef = useRef(m.lines);
  rhymeLinesRef.current = m.lines;
  useEffect(() => {
    if (m.toolTab !== "rhyme") return;
    const word = endWordOfLineRaw(rhymeLinesRef.current[(cursorLine ?? 1) - 1]);
    if (!word) return;
    rhymeBumpRef.current += 1;
    // Passive cursor parking — fill query but don't pop a collapsed panel open.
    setRhymeFinderQuery({ word, bump: rhymeBumpRef.current });
  }, [m.toolTab, cursorLine]);

  // Click delegation: when in the rhyme tab, clicking any highlighted
  // end-word in the editor refills the Rhyme Finder with that word.
  const handleEditorClickForRhyme = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (m.toolTab !== "rhyme") return;
    const target = event.target as HTMLElement | null;
    const hit = target?.closest(".cm-rhyme-end") as HTMLElement | null;
    if (!hit) return;
    const word = (hit.textContent || "").trim();
    if (!word) return;
    rhymeBumpRef.current += 1;
    // Click on a highlighted end-word fills the Rhyme Finder query but
    // doesn't pop a collapsed panel open — keeps the layout calm.
    setRhymeFinderQuery({ word, bump: rhymeBumpRef.current });
  }, [m.toolTab]);

  // Add transient highlights for end-words that rhyme with the currently
  // hovered Datamuse suggestion. Uses the same breadth as the editor scheme.
  const rhymeEndHighlights = useMemo(() => {
    if (m.toolTab !== "rhyme" || !hoveredRhymeWord) return baseRhymeEndHighlights;
    const norm = hoveredRhymeWord.toLowerCase().replace(/[^a-z']/g, "");
    if (norm.length < 2) return baseRhymeEndHighlights;
    const targetKey = endingForBreadth(norm, rhymeBreadth);
    if (!targetKey) return baseRhymeEndHighlights;
    const existing = new Set(baseRhymeEndHighlights.map((h) => h.line));
    const extra: Array<{ line: number; colorKey: string }> = [];
    for (let i = 0; i < m.lines.length; i++) {
      if (existing.has(i + 1)) continue;
      const mm = (m.lines[i] ?? "").match(/[a-zA-Z']+(?=[^a-zA-Z']*$)/);
      if (!mm) continue;
      const wn = mm[0].toLowerCase().replace(/[^a-z']/g, "");
      if (wn.length < 2) continue;
      const k = endingForBreadth(wn, rhymeBreadth);
      if (k && k === targetKey) extra.push({ line: i + 1, colorKey: "hover" });
    }
    return [...baseRhymeEndHighlights, ...extra];
  }, [baseRhymeEndHighlights, hoveredRhymeWord, m.toolTab, m.lines, rhymeBreadth]);

  const [selectionText, setSelectionText] = useState<string | null>(null);
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [sharedPoemView, setSharedPoemView] = useState(() => checkShareHash());

  const localAnalysis = useMemo<LocalAnalysisContext>(() => {
    const syllablesPerLine = m.lines.map((_, i) => m.docStats.lines[i]?.syllables ?? 0);
    return {
      cliches: m.clicheHits,
      rhymeScheme: m.rhymeScheme,
      syllablesPerLine,
      repeatedWords: m.repeated,
      form: detectPoemForm(m.lines, syllablesPerLine),
    };
  }, [m.clicheHits, m.rhymeScheme, m.docStats.lines, m.repeated, m.lines]);
  const prevActivePoemIdRef = useRef(m.activePoemId);
  useEffect(() => {
    if (m.activePoemId !== prevActivePoemIdRef.current) {
      prevActivePoemIdRef.current = m.activePoemId;
      setIssueHighlight(null);
      const { lines, words } = deriveAiHighlights(m.activePoemId);
      setPersistentIssueHighlights(lines);
      setWordHighlights(words);
      const saved = loadLastAnalysis(m.activePoemId);
      setAiResult(saved);
      const ignored = loadIgnoredIssueIds(m.activePoemId);
      setAiIgnoredIds(ignored);
      setAiVisibleIssues(saved ? saved.issues.filter((i) => !ignored.has(i.id)) : []);
    }
  }, [m.activePoemId]);

  // Initial mount: hydrate aiResult/visibleIssues from saved analysis so the
  // status strip + ribbons appear without waiting for a new analyse.
  useEffect(() => {
    const saved = loadLastAnalysis(m.activePoemId);
    if (!saved) return;
    setAiResult(saved);
    const ignored = loadIgnoredIssueIds(m.activePoemId);
    setAiIgnoredIds(ignored);
    setAiVisibleIssues(saved.issues.filter((i) => !ignored.has(i.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVisibleIssuesChange = useCallback((issues: AnalysisIssue[]) => {
    setAiVisibleIssues(issues);
    setPersistentIssueHighlights(
      issues.map((iss) => [iss.line_start, iss.line_end, iss.severity] as [number, number, string?]),
    );
    setWordHighlights(
      issues
        .filter((iss) => iss.problem_words && iss.problem_words.length > 0)
        .map((iss) => ({ words: iss.problem_words!, lineStart: iss.line_start, lineEnd: iss.line_end, severity: iss.severity })),
    );
  }, []);

  const ribbonApply = useCallback((iss: AnalysisIssue) => {
    if (!iss.rewrite) return;
    m.applyLineRewrite(iss.line_start, iss.line_end, iss.rewrite);
    setAiIgnoredIds((prev) => {
      const s = new Set(prev);
      s.add(iss.id);
      const poemId = m.activePoemId;
      if (poemId) {
        try { localStorage.setItem("easy-poems:ai-ignored:" + poemId, JSON.stringify([...s])); } catch { /* ignore */ }
      }
      return s;
    });
    setAiVisibleIssues((prev) => prev.filter((i) => i.id !== iss.id));
  }, [m]);

  const ribbonIgnore = useCallback((id: string) => {
    setAiIgnoredIds((prev) => {
      const s = new Set(prev);
      s.add(id);
      const poemId = m.activePoemId;
      if (poemId) {
        try { localStorage.setItem("easy-poems:ai-ignored:" + poemId, JSON.stringify([...s])); } catch { /* ignore */ }
      }
      return s;
    });
    setAiVisibleIssues((prev) => prev.filter((i) => i.id !== id));
  }, [m.activePoemId]);

  // Alt+Enter: apply the rewrite for the issue covering the cursor's line.
  const handleApplyRewriteAtCursor = useCallback((line: number): boolean => {
    const match = aiVisibleIssues.find(
      (iss) => line >= iss.line_start && line <= iss.line_end && iss.rewrite,
    );
    if (!match) return false;
    ribbonApply(match);
    return true;
  }, [aiVisibleIssues, ribbonApply]);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [showDeleteCurrentConfirm, setShowDeleteCurrentConfirm] = useState(false);
  const [pendingDeleteSnapId, setPendingDeleteSnapId] = useState<string | null>(null);
  const [diffSnapshotId, setDiffSnapshotId] = useState<string | null>(null);
  const [exportFlash, setExportFlash] = useState<string | null>(null);
  const exportFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isReadingMode, setIsReadingMode] = useState(false);
  const [showLineSyllables, setShowLineSyllables] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SHOW_LINE_SYLLABLES);
      if (raw === "0" || raw === "false") return false;
    } catch {
      /* ignore */
    }
    return true;
  });
  const [showRhymeScheme, setShowRhymeScheme] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SHOW_RHYME_SCHEME);
      if (raw === "0" || raw === "false") return false;
      if (raw === "1" || raw === "true") return true;
    } catch { /* ignore */ }
    // Default off on phones — the narrow column eats too much screen width
    return window.innerWidth >= 900;
  });
  const [wordLookupEnabled, setWordLookupEnabled] = useState(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY_WORD_LOOKUP_ENABLED);
      if (v === "1" || v === "true") return true;
      if (v === "0" || v === "false") return false;
    } catch { /* ignore */ }
    return true; // on by default
  });
  const [preloadAllChunks, setPreloadAllChunksState] = useState(isPreloadAllChunksEnabled);
  const [lineFocusMode, setLineFocusMode] = useState(false);
  const sessionStartRef = useRef(Date.now());
  const [sessionWordGoal, setSessionWordGoal] = useState<number | null>(null);
  const [showGoalInput, setShowGoalInput] = useState(false);
  const [goalInputVal, setGoalInputVal] = useState("");
  const [appearance, setAppearance] = useState<AppearanceSettings>(() =>
    loadAppearance(),
  );
  const hint = useHoverHintBinder();
  const { enabled: hoverHintsEnabled, setEnabled: setHoverHintsEnabled } =
    useHoverHintsSettings();
  const overlayOpenCountPrev = useRef(0);
  const overlayReturnFocusRef = useRef<HTMLElement | null>(null);
  const toolsPanelRef = useRef<HTMLElement | null>(null);

  const { handleSheetDragStart, handleSheetDragMove, handleSheetDragEnd } = useSheetDrag({
    toolsPanelRef,
    mobileSheetSnap,
    setMobileSheetSnap,
    setMobileToolsExpanded,
  });
  const editorPanelRef = useRef<HTMLElement | null>(null);
  // Saved scroll positions so switching tabs doesn't reset where you were.
  const editorScrollPos = useRef(0);
  const toolsScrollPos = useRef(0);
  const mobileAnalyzeFnRef = useRef<(() => void) | null>(null);
  const openIssueAtLineRef = useRef<((line: number, scroll?: boolean) => void) | null>(null);
  const aiSwitchTabRef = useRef<((tab: "overview" | "issues" | "chat") => void) | null>(null);
  const cursorLineGetterRef = useRef<(() => number) | null>(null);
  const [peekLine, setPeekLine] = useState<number | null>(null);
  const [peekBump, setPeekBump] = useState(0);

  /** Scroll a line into view without moving the cursor. */
  const peekToLine = useCallback((line: number) => {
    setPeekLine(line);
    setPeekBump((n) => n + 1);
  }, []);

  /**
   * Repeat-tool persistent highlights. Active whenever the Repeats panel is
   * the visible tool; content mirrors the active subtab (words/phrases/
   * patterns). Each group (a unique word, phrase, or edge-pattern) gets its
   * own colour index assigned in encounter order — the editor turns this
   * into a unique hue via golden-angle increment so any number of groups
   * stays visually distinct. `count` drives the small badge at the top-right
   * of each occurrence.
   */
  const repeatHighlights = useMemo(() => {
    if (m.toolTab !== "repeat") return undefined;
    type Entry = {
      line: number;
      start: number;
      end: number;
      severity: "low" | "med" | "high";
      kind: "word" | "phrase" | "pattern";
      groupId: string;
      colorIndex: number;
      count: number;
    };
    const out: Entry[] = [];
    const colorMap = new Map<string, number>();
    const colorFor = (groupId: string) => {
      let c = colorMap.get(groupId);
      if (c === undefined) {
        c = colorMap.size;
        colorMap.set(groupId, c);
      }
      return c;
    };
    const pushGroup = (
      groupId: string,
      severity: "low" | "med" | "high",
      kind: "word" | "phrase" | "pattern",
      occurrences: Array<{ line: number; start: number; end: number }>,
    ) => {
      if (occurrences.length === 0) return;
      const colorIndex = colorFor(groupId);
      const count = occurrences.length;
      for (const o of occurrences) {
        out.push({
          line: o.line,
          start: o.start,
          end: o.end,
          severity,
          kind,
          groupId,
          colorIndex,
          count,
        });
      }
    };
    if (repeatSubTab === "words") {
      for (const r of m.repeated) {
        pushGroup(`w:${r.word}`, r.severity, "word", r.occurrences);
      }
    } else if (repeatSubTab === "phrases") {
      for (const p of m.repetition.phrases) {
        pushGroup(`p${p.n}:${p.phrase}`, p.severity, "phrase", p.occurrences);
      }
    } else {
      // patterns — anaphora + epistrophe. Severity grades by group size.
      const gradeEdge = (count: number): "low" | "med" | "high" =>
        count >= 4 ? "high" : count >= 3 ? "med" : "low";
      for (const g of m.repetition.anaphora) {
        pushGroup(`a${g.n}:${g.prefix}`, gradeEdge(g.lines.length), "pattern", g.occurrences);
      }
      for (const g of m.repetition.epistrophe) {
        pushGroup(`e${g.n}:${g.prefix}`, gradeEdge(g.lines.length), "pattern", g.occurrences);
      }
    }
    return out;
  }, [m.toolTab, repeatSubTab, m.repeated, m.repetition]);

  /**
   * Smart jump: if the user's cursor is already on that line, do nothing
   * (avoids stealing focus / scrolling away while they're editing). Otherwise
   * peek (scroll into view) without grabbing focus.
   */
  const smartPreviewLine = useCallback((line: number) => {
    const cur = cursorLineGetterRef.current?.() ?? -1;
    if (cur === line) return;
    peekToLine(line);
  }, [peekToLine]);
  const [mobileAiOpen, setMobileAiOpen] = useState(false);
  const [mobileIsAnalyzing, setMobileIsAnalyzing] = useState(false);

  // Safety net: when the sheet flips open, force-fire the analyze fn after a
  // short delay if the autoTrigger path didn't catch it (e.g. AiAnalysis hadn't
  // populated the ref yet at toggle time). Idempotent — handleAnalyze early-returns
  // when status is already "loading".
  useEffect(() => {
    if (!mobileAiOpen) return;
    const id = window.setTimeout(() => {
      mobileSheetAnalyzeFn.current?.();
    }, 200);
    return () => window.clearTimeout(id);
  }, [mobileAiOpen]);

  const openAiTab = useCallback((tab: "overview" | "issues" | "chat") => {
    if (window.innerWidth <= 899) {
      setMobileAiOpen(true);
      setMobileTab("write");
      requestAnimationFrame(() => aiSwitchTabRef.current?.(tab));
      return;
    }
    aiSwitchTabRef.current?.(tab);
    requestAnimationFrame(() => {
      const el = document.querySelector(".ai-analysis-section") as HTMLElement | null;
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);
  // Set to true just before opening the sheet so analysis auto-triggers on mount only.
  const mobileSheetAutoTrigger = useRef(false);
  const mobileSheetAnalyzeFn = useRef<(() => void) | null>(null);

  // Stable ref callback — stores the analyze fn and auto-triggers when the
  // sheet was just opened. Two paths to fire: (1) the autoTrigger flag set by
  // the Analyse tap, (2) sheet flipped open and idle status (safety net).
  const mobileSheetAiRef = useCallback((fn: (() => void) | null) => {
    mobileSheetAnalyzeFn.current = fn;
    if (mobileSheetAutoTrigger.current && fn) {
      mobileSheetAutoTrigger.current = false;
      fn();
    }
  }, []);

  const overlayOpenCount =
    Number(isLibraryOpen) +
    Number(isExportOpen) +
    Number(isStyleOpen) +
    Number(isBackgroundOpen) +
    Number(isCmdkOpen) +
    Number(isFindOpen) +
    Number(isShortcutsOpen) +
    Number(isGuideOpen);

  useEffect(() => {
    const prev = overlayOpenCountPrev.current;
    if (prev === 0 && overlayOpenCount > 0) {
      const a = document.activeElement;
      overlayReturnFocusRef.current =
        a instanceof HTMLElement ? a : null;
    }
    if (prev > 0 && overlayOpenCount === 0) {
      const t = overlayReturnFocusRef.current;
      overlayReturnFocusRef.current = null;
      queueMicrotask(() => {
        if (t?.isConnected) t.focus();
      });
    }
    overlayOpenCountPrev.current = overlayOpenCount;
  }, [overlayOpenCount]);


  // Reset tools panel scroll to top when switching tool sub-tabs.
  useEffect(() => {
    toolsPanelRef.current?.scrollTo({ top: 0 });
  }, [m.toolTab]);

  // When rhyme tab opens, surface the rhyme scheme column at the top of the
  // editor instead of showing labels inside the editor's left gutter.
  // Remember the prior state so we can restore it when leaving the tab if
  // the user had the quick-toggle off before we forced it on.
  const rhymeSchemePrevRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (m.toolTab === "rhyme") {
      setShowRhymeScheme((prev) => {
        if (rhymeSchemePrevRef.current === null) rhymeSchemePrevRef.current = prev;
        return true;
      });
    } else if (rhymeSchemePrevRef.current !== null) {
      const wasOnBefore = rhymeSchemePrevRef.current;
      rhymeSchemePrevRef.current = null;
      if (!wasOnBefore) setShowRhymeScheme(false);
    }
  }, [m.toolTab]);


  // Preserve panel scroll positions when switching between write/tools on mobile.
  const prevMobileTab = useRef(mobileTab);
  useEffect(() => {
    const prev = prevMobileTab.current;
    prevMobileTab.current = mobileTab;
    if (prev === mobileTab) return;
    // Save departing panel's position immediately.
    if (prev === "write") editorScrollPos.current = editorPanelRef.current?.scrollTop ?? 0;
    if (prev === "tools") toolsScrollPos.current = toolsPanelRef.current?.scrollTop ?? 0;
    // Restore arriving panel's position after the slide transition completes (280ms).
    const id = setTimeout(() => {
      if (mobileTab === "write" && editorPanelRef.current)
        editorPanelRef.current.scrollTop = editorScrollPos.current;
      if (mobileTab === "tools" && toolsPanelRef.current)
        toolsPanelRef.current.scrollTop = toolsScrollPos.current;
    }, 290);
    return () => clearTimeout(id);
  }, [mobileTab]);

  useEffect(() => {
    document.documentElement.toggleAttribute("data-writing-focus-v2", isFocusMode);
    return () => {
      document.documentElement.removeAttribute("data-writing-focus-v2");
    };
  }, [isFocusMode]);

  // Browser back exits focus mode: push a sentinel history entry on enter so
  // the back button (or Android system back, swipe-back gesture) pops out of
  // focus instead of leaving the workshop entirely.
  useEffect(() => {
    if (!isFocusMode) return;
    const STATE_KEY = "easywriting:focusMode";
    window.history.pushState({ [STATE_KEY]: true }, "");
    const onPop = () => setIsFocusMode(false);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // If we still own the sentinel entry (user exited via UI, not back btn),
      // pop it so history isn't polluted with focus-mode entries.
      if (window.history.state && (window.history.state as Record<string, unknown>)[STATE_KEY]) {
        window.history.back();
      }
    };
  }, [isFocusMode]);

  // Fade-on-idle: in focus mode, only physical pointer activity reveals the
  // chrome. Typing keeps the writing trance — mouse must actually move (or
  // scroll/click) for the topbar/toolbar to fade back in.
  useEffect(() => {
    if (!isFocusMode) {
      document.documentElement.removeAttribute("data-focus-idle");
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      document.documentElement.removeAttribute("data-focus-idle");
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        document.documentElement.setAttribute("data-focus-idle", "");
      }, 2500);
    };
    // Enter focus mode hidden — chrome only appears once the mouse actually moves.
    document.documentElement.setAttribute("data-focus-idle", "");
    const opts = { passive: true } as AddEventListenerOptions;
    window.addEventListener("pointermove", arm, opts);
    window.addEventListener("pointerdown", arm, opts);
    window.addEventListener("wheel", arm, opts);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("pointermove", arm);
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("wheel", arm);
      document.documentElement.removeAttribute("data-focus-idle");
    };
  }, [isFocusMode]);

  useEffect(() => {
    const simplify = isFocusMode || appearance.backdropPower !== "off";
    document.documentElement.toggleAttribute("data-backdrop-simplify", simplify);
    return () => document.documentElement.removeAttribute("data-backdrop-simplify");
  }, [appearance.backdropPower, isFocusMode]);

  // Swipe handled exclusively in the JSX onTouchEnd below to avoid the
  // native-vs-synthetic race condition that caused library to open from write.

  const doExportFlash = (msg: string) => {
    setExportFlash(msg);
    if (exportFlashTimerRef.current) clearTimeout(exportFlashTimerRef.current);
    exportFlashTimerRef.current = setTimeout(() => setExportFlash(null), 1800);
  };

  useEffect(() => {
    return () => {
      if (exportFlashTimerRef.current) clearTimeout(exportFlashTimerRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    applyAppearance(appearance);
  }, [appearance]);

  useEffect(() => {
    void saveAppearance(appearance);
  }, [appearance]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY_SHOW_LINE_SYLLABLES,
        showLineSyllables ? "1" : "0",
      );
    } catch {
      /* ignore */
    }
  }, [showLineSyllables]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_RHYME_SCHEME_BREADTH, rhymeBreadth); } catch { /* ignore */ }
  }, [rhymeBreadth]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY_SHOW_RHYME_SCHEME,
        showRhymeScheme ? "1" : "0",
      );
    } catch {
      /* ignore */
    }
  }, [showRhymeScheme]);

  useEffect(() => {
    const lockScroll =
      isLibraryOpen ||
      isStyleOpen ||
      isBackgroundOpen ||
      isExportOpen ||
      isCmdkOpen ||
      isShortcutsOpen ||
      isGuideOpen;
    if (!lockScroll) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isLibraryOpen, isStyleOpen, isBackgroundOpen, isExportOpen, isCmdkOpen, isShortcutsOpen, isGuideOpen]);

  useGlobalKeyboardShortcuts({
    setIsCmdkOpen,
    setFindMode,
    setIsFindOpen,
    setIsReadingMode,
    setIsFocusMode,
    setTopbarOverflowOpen,
    setIsLibraryOpen,
    setIsStyleOpen,
    setIsBackgroundOpen,
    setIsExportOpen,
    setIsShortcutsOpen,
    setIsGuideOpen,
    setToolTab: m.setToolTab,
    saveSnapshot: m.saveSnapshot,
    mobileAnalyzeFnRef,
  });

  useEffect(() => {
    // Clamp both stored widths so that rail + editor(min) + tools never exceeds the viewport.
    const vw = window.innerWidth;
    const gap = Math.round(parseFloat(getComputedStyle(document.documentElement).fontSize || "16")) * 2;
    const safeRail  = Math.max(0, Math.min(railWidth,        vw - MIN_EDITOR_W - DEFAULT_TOOLS_W - gap));
    const safeTools = Math.max(0, Math.min(toolsPanelWidth,  vw - safeRail - MIN_EDITOR_W - gap));
    applyRailW(safeRail);
    applyToolsW(safeTools);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!topbarOverflowOpen) return;
    const onDown = (e: MouseEvent) => {
      if (overflowMenuRef.current && !overflowMenuRef.current.contains(e.target as Node)) {
        setTopbarOverflowOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [topbarOverflowOpen]);

  useEffect(() => {
    if (!isStatsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (statsPopoverRef.current && !statsPopoverRef.current.contains(e.target as Node)) {
        setIsStatsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isStatsOpen]);

  const focusPoemTitle = () => {
    document.getElementById("poem-title")?.focus();
  };

  const printPoemText = useMemo(() => {
    const t = m.title.trim();
    const f = m.formNote.trim();
    return `${t ? `${t}\n\n` : ""}${f ? `${f}\n\n` : ""}${m.body}`;
  }, [m.body, m.formNote, m.title]);

  const checklistOpenCount = useMemo(
    () => m.publication.items.filter((i) => !i.done).length,
    [m.publication.items],
  );


  const issuesQueueCount = useMemo(() => {
    const spell = m.wordlist ? m.spellHits.length : 0;
    return (
      checklistOpenCount +
      m.goalEvaluation.warnings.length +
      spell
    );
  }, [
    checklistOpenCount,
    m.goalEvaluation.warnings.length,
    m.spellHits.length,
    m.wordlist,
  ]);

  const libraryListRows = useMemo(() => {
    const q = libraryQuery.trim().toLowerCase();
    const labelFor = (p: PoemRecord) =>
      m.draftMeta[p.id]?.label?.trim() || p.title.trim() || "Untitled";
    type Row = {
      id: string;
      label: string;
      poem: PoemRecord;
      meta: DraftMeta;
    };
    const rows: Row[] = m.library.poems.map((poem) => ({
      id: poem.id,
      label: labelFor(poem),
      poem,
      meta: m.draftMeta[poem.id] ?? {},
    }));
    const filtered = rows.filter((r) => {
      if (
        !libraryShowArchived &&
        r.meta.archived &&
        r.id !== m.activePoemId
      ) {
        return false;
      }
      if (!q) return true;
      const tags = (r.meta.tags ?? []).join(" ").toLowerCase();
      const hay = `${r.label} ${r.poem.title} ${tags}`.toLowerCase();
      return hay.includes(q);
    });
    const sorted = filtered.slice();
    sorted.sort((a, b) => {
      const pa = a.meta.pinned ? 1 : 0;
      const pb = b.meta.pinned ? 1 : 0;
      if (pa !== pb) return pb - pa;
      if (librarySort === "title") {
        return a.label.localeCompare(b.label, undefined, {
          sensitivity: "base",
        });
      }
      if (librarySort === "updated") {
        return (
          new Date(b.poem.updatedAt).getTime() -
          new Date(a.poem.updatedAt).getTime()
        );
      }
      const oa = a.meta.lastOpenedAt
        ? new Date(a.meta.lastOpenedAt).getTime()
        : 0;
      const ob = b.meta.lastOpenedAt
        ? new Date(b.meta.lastOpenedAt).getTime()
        : 0;
      if (oa !== ob) return ob - oa;
      return (
        new Date(b.poem.updatedAt).getTime() -
        new Date(a.poem.updatedAt).getTime()
      );
    });
    return sorted;
  }, [
    m.library.poems,
    m.draftMeta,
    m.activePoemId,
    libraryQuery,
    libraryShowArchived,
    librarySort,
  ]);

  const libraryListParentRef = useRef<HTMLDivElement | null>(null);
  const libraryVirtualizer = useVirtualizer({
    count: libraryListRows.length,
    getScrollElement: () => libraryListParentRef.current,
    estimateSize: () => 150,
    overscan: 3,
  });

  useEffect(() => {
    if (!isLibraryOpen) return;
    setLibraryActiveIdx(0);
    queueMicrotask(() => librarySearchRef.current?.focus());
  }, [isLibraryOpen]);

  useEffect(() => {
    if (!isLibraryOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") return;
      // Don't steal keys while typing in a field.
      if (e.target && (e.target as HTMLElement).closest?.("input,textarea,select,[contenteditable='true']")) {
        return;
      }
      if (libraryListRows.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setLibraryActiveIdx((i) => Math.min(i + 1, libraryListRows.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setLibraryActiveIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        const row = libraryListRows[libraryActiveIdx];
        if (!row) return;
        e.preventDefault();
        m.selectPoem(row.id);
        setIsLibraryOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isLibraryOpen, libraryActiveIdx, libraryListRows, m]);

  useEffect(() => {
    if (!isLibraryOpen) return;
    try {
      libraryVirtualizer.scrollToIndex(libraryActiveIdx, { align: "auto" });
    } catch {
      /* ignore */
    }
  }, [isLibraryOpen, libraryActiveIdx, libraryVirtualizer]);

  const cmdkActions = useMemo<CommandPaletteAction[]>(() => {
    return [
      {
        id: "workshop-guide",
        title: "Guide",
        keywords: "help guide tour new introduction overview walkthrough",
        run: () => setIsGuideOpen(true),
      },
      {
        id: "toggle-hover-hints",
        title: hoverHintsEnabled
          ? "Turn off delayed hover explanations"
          : "Turn on delayed hover explanations",
        keywords:
          "hover tooltip tip button explain description help hints delayed hover",
        run: () => setHoverHintsEnabled((v) => !v),
      },
      {
        id: "toggle-word-lookup",
        title: wordLookupEnabled
          ? "Turn off word lookup popup"
          : "Turn on word lookup popup",
        keywords: "word lookup dictionary synonym antonym popup disable enable",
        run: () => {
          const next = !wordLookupEnabled;
          setWordLookupEnabled(next);
          try { localStorage.setItem(STORAGE_KEY_WORD_LOOKUP_ENABLED, next ? "1" : "0"); } catch { /* ignore */ }
        },
      },
      {
        id: "library",
        title: "Open Library",
        keywords: "draft poem library",
        run: () => setIsLibraryOpen(true),
      },
      {
        id: "appearance",
        title: "Fonts",
        keywords: "font typography typeface poem ui interface",
        run: () => setIsAppearanceOpen(true),
      },
      {
        id: "backdrop",
        title: "Page background",
        keywords: "background scene theme paper night forest dawn slate wallpaper",
        run: () => setIsBackgroundOpen(true),
      },

      {
        id: "export",
        title: "Open Export",
        keywords: "export copy download",
        run: () => setIsExportOpen(true),
      },
      {
        id: "focus",
        title: isFocusMode ? "Exit focus mode" : "Enter focus mode",
        keywords: "focus distraction",
        run: () => setIsFocusMode((v) => !v),
      },
      {
        id: "new",
        title: "New draft",
        keywords: "new poem draft",
        run: () => m.newPoem(),
      },
      {
        id: "duplicate",
        title: "Duplicate draft",
        keywords: "copy duplicate poem draft",
        run: () => m.duplicatePoem(),
      },
      {
        id: "delete",
        title: "Delete current draft",
        keywords: "delete remove poem draft",
        run: () => m.deleteCurrentPoem(),
      },
      {
        id: "snapshot",
        title: "Save snapshot",
        keywords: "snapshot revision",
        run: () => { m.setToolTab("snapshots"); m.saveSnapshot(); },
      },
      {
        id: "revision-pass",
        title: "Revision pass (open export checklist)",
        keywords: "revision pass polish review spelling repeats checklist",
        hint: "Shortcuts to spelling, rhyme, repeats, lines, meter",
        run: () => setIsExportOpen(true),
      },
      {
        id: "keyboard-shortcuts",
        title: "Keyboard shortcuts",
        keywords: "shortcuts keys hotkeys keyboard help",
        run: () => setIsShortcutsOpen(true),
      },
      ...toolTabActions({ openToolTab: m.setToolTab }),
      {
        id: "title",
        title: "Focus title",
        keywords: "title heading",
        run: () => focusPoemTitle(),
      },
      {
        id: "find",
        title: "Find in poem",
        keywords: "find search",
        run: () => {
          setFindMode("find");
          setIsFindOpen(true);
        },
      },
      {
        id: "replace",
        title: "Replace in poem",
        keywords: "replace search",
        run: () => {
          setFindMode("replace");
          setIsFindOpen(true);
        },
      },
      {
        id: "go-line",
        title: "Go to line",
        keywords: "go line jump",
        run: () => {
          m.setToolTab("lines");
          queueMicrotask(() => {
            document.getElementById("go-line-input")?.focus();
          });
        },
      },
      {
        id: "templates",
        title: "Form templates",
        keywords: "template haiku sonnet villanelle limerick form",
        run: () => setIsTemplatesOpen(true),
      },
      {
        id: "reading-mode",
        title: "Reading view",
        keywords: "reading view clean fullscreen poem display",
        run: () => setIsReadingMode(true),
      },
    ];
  }, [focusPoemTitle, hoverHintsEnabled, isFocusMode, m, setHoverHintsEnabled]);

  return (
    <div
      className={`poem-workshop ${isFocusMode ? "is-focus-mode" : ""}`}
      data-tool-tab={m.toolTab}
    >
      {isFocusMode && (
        <button
          type="button"
          className="focus-back-btn"
          onClick={() => setIsFocusMode(false)}
          aria-label="Exit focus mode"
          title="Exit focus mode"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden focusable="false">
            <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {isFocusMode && <FocusNotesPanel />}
      <CommandPalette
        open={isCmdkOpen}
        onClose={() => setIsCmdkOpen(false)}
        actions={cmdkActions}
      />
      <WorkshopTopbarHeader
        m={m}
        isFocusMode={isFocusMode}
        setIsFocusMode={setIsFocusMode}
        setIsLibraryOpen={setIsLibraryOpen}
        setMobileTab={setMobileTab}
        setMetaOpen={setMetaOpen}
        showRhymeScheme={showRhymeScheme}
        isStatsOpen={isStatsOpen}
        setIsStatsOpen={setIsStatsOpen}
        statsPopoverRef={statsPopoverRef}
        isBackgroundOpen={isBackgroundOpen}
        setIsBackgroundOpen={setIsBackgroundOpen}
        setFindMode={setFindMode}
        setIsFindOpen={setIsFindOpen}
        topbarOverflowOpen={topbarOverflowOpen}
        setTopbarOverflowOpen={setTopbarOverflowOpen}
        overflowMenuRef={overflowMenuRef}
        sessionStartRef={sessionStartRef}
        sessionWordGoal={sessionWordGoal}
        setSessionWordGoal={setSessionWordGoal}
        showGoalInput={showGoalInput}
        setShowGoalInput={setShowGoalInput}
        goalInputVal={goalInputVal}
        setGoalInputVal={setGoalInputVal}
        setIsReadingMode={setIsReadingMode}
        setIsShareOpen={setIsShareOpen}
        setIsExportOpen={setIsExportOpen}
        setIsCmdkOpen={setIsCmdkOpen}
        setIsShortcutsOpen={setIsShortcutsOpen}
        resetLayout={resetLayout}
      />

      <FirstVisitHint
        onOpenGuide={() => setIsGuideOpen(true)}
        onSuggest={() => m.setToolTab("suggest")}
      />

      {m.samplePoemActive && (
        <SamplePoemBanner
          onClear={m.clearSamplePoem}
          onKeep={m.keepSamplePoem}
        />
      )}

      <RhymeTooltip sampleActive={m.samplePoemActive} />

      <WorkshopBanners m={m} />

      <WorkshopLibraryModal
        m={m}
        isLibraryOpen={isLibraryOpen}
        setIsLibraryOpen={setIsLibraryOpen}
        showDeleteCurrentConfirm={showDeleteCurrentConfirm}
        setShowDeleteCurrentConfirm={setShowDeleteCurrentConfirm}
        libraryQuery={libraryQuery}
        setLibraryQuery={setLibraryQuery}
        librarySort={librarySort}
        setLibrarySort={setLibrarySort}
        libraryShowArchived={libraryShowArchived}
        setLibraryShowArchived={setLibraryShowArchived}
        libraryListRows={libraryListRows}
        libraryListParentRef={libraryListParentRef}
        libraryVirtualizer={libraryVirtualizer}
        libraryActiveIdx={libraryActiveIdx}
        librarySearchRef={librarySearchRef}
        pendingDeleteSnapId={pendingDeleteSnapId}
        setPendingDeleteSnapId={setPendingDeleteSnapId}
        diffSnapshotId={diffSnapshotId}
        setDiffSnapshotId={setDiffSnapshotId}
      />

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        m={m}
        exportFlash={exportFlash}
        doExportFlash={doExportFlash}
        checklistOpenCount={checklistOpenCount}
        onJumpFromChecklist={(item) => {
          setIsExportOpen(false);
          if (item.focusTitleField) focusPoemTitle();
          else if (item.openToolTab) m.setToolTab(item.openToolTab);
        }}
      />
      <ShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />

      {isGuideOpen ? (
        <SpotlightTour onClose={() => setIsGuideOpen(false)} />
      ) : null}

      {isStyleOpen ? (
        <div
          className="overlay"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setIsStyleOpen(false);
          }}
        >
          <section
            className="modal style-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="style-modal-title"
          >
            <div className="modal-head">
              <div className="style-modal-head-text">
                <h2 id="style-modal-title" className="modal-title">Fonts &amp; Typography</h2>
                <p className="style-modal-subtitle">Pick how your poem and the app look.</p>
              </div>
              <button type="button" className="small-btn" onClick={() => setIsStyleOpen(false)}>
                Close
              </button>
            </div>
            <AppearanceFormFields appearance={appearance} onChange={setAppearance} />
            <div className="style-modal-settings">
              <h3 className="style-modal-settings-title">Editor settings</h3>
              <label className="appearance-hints-toggle">
                <input
                  type="checkbox"
                  checked={wordLookupEnabled}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setWordLookupEnabled(next);
                    try { localStorage.setItem(STORAGE_KEY_WORD_LOOKUP_ENABLED, next ? "1" : "0"); } catch { /* ignore */ }
                  }}
                />
                <span className="appearance-hints-text">
                  <span className="appearance-hints-title">Define on selection</span>
                  <span className="appearance-hints-desc">Show a "Define" button when you select a word.</span>
                </span>
              </label>
              <label className="appearance-hints-toggle">
                <input
                  type="checkbox"
                  checked={hoverHintsEnabled}
                  onChange={(e) => setHoverHintsEnabled(e.target.checked)}
                />
                <span className="appearance-hints-text">
                  <span className="appearance-hints-title">Hover hints</span>
                  <span className="appearance-hints-desc">Show button tooltips on hover (hover devices only).</span>
                </span>
              </label>
              <label className="appearance-hints-toggle">
                <input
                  type="checkbox"
                  checked={preloadAllChunks}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setPreloadAllChunksState(next);
                    setPreloadAllChunksEnabled(next);
                    if (next) preloadAllChunksNow();
                  }}
                />
                <span className="appearance-hints-text">
                  <span className="appearance-hints-title">Load everything up front</span>
                  <span className="appearance-hints-desc">
                    Fetch all panels (backgrounds, AI, reading mode, share, export) right after startup
                    so they keep working if you lose internet. Uses a bit more data on first load.
                  </span>
                </span>
              </label>
            </div>
          </section>
        </div>
      ) : null}

      {isBackgroundOpen ? (
        <div
          className="overlay"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setIsBackgroundOpen(false);
          }}
        >
          <section
            className="modal style-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bg-modal-title"
          >
            <div className="modal-head">
              <h2 id="bg-modal-title" className="modal-title">Page Background &amp; Performance</h2>
              <button type="button" className="small-btn" onClick={() => setIsBackgroundOpen(false)}>
                Close
              </button>
            </div>
            <BackdropMotionToggle appearance={appearance} onChange={setAppearance} />
            <Suspense fallback={<p className="muted small" style={{ padding: "1rem" }}>Loading…</p>}>
              <BackgroundPicker
                appearance={appearance}
                background={appearance.background}
                onChange={setAppearance}
              />
            </Suspense>
            <BackdropFormFields appearance={appearance} onChange={setAppearance} />
          </section>
        </div>
      ) : null}

      <input
        ref={m.importInputRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        onChange={m.onImportBackupFile}
      />

      {/* Expand pills — appear at viewport edges when a panel is fully collapsed */}
      {railWidth === 0 && (
        <button
          type="button"
          className="panel-expand-pill panel-expand-pill-rail"
          onClick={() => { applyRailW(DEFAULT_RAIL_W); saveRailW(DEFAULT_RAIL_W); }}
          aria-label="Expand rail"
        >
          <span>›</span>
        </button>
      )}
      {toolsPanelWidth === 0 && (
        <button
          type="button"
          className="panel-expand-pill panel-expand-pill-tools"
          onClick={() => { applyToolsW(DEFAULT_TOOLS_W); saveToolsW(DEFAULT_TOOLS_W); }}
          aria-label="Expand tools panel"
        >
          <span>‹</span>
        </button>
      )}

      {/* Tablet scrim — fixed overlay, NOT a grid item */}
      {mobileToolsExpanded && (
        <div
          className="tablet-tools-scrim"
          aria-hidden
          onClick={() => setMobileToolsExpanded(false)}
        />
      )}

      {/* Mobile bottom-sheet scrim — only visible at full snap */}
      {mobileToolsExpanded && (
        <div
          className={`mobile-sheet-scrim mobile-sheet-scrim-${mobileSheetSnap}`}
          aria-hidden
          onClick={() => setMobileSheetSnap("half")}
        />
      )}

      <main
        id="workshop-main"
        className="workshop-grid"
        ref={workshopGridRef}
        data-mobile-view={mobileToolsExpanded ? "tools" : "editor"}
        data-tools-open={mobileToolsExpanded ? "true" : "false"}
        data-mobile-sheet={mobileToolsExpanded ? mobileSheetSnap : "closed"}
        aria-label="Poetry workshop"
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (!t) return;
          swipeRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
        }}
        onTouchEnd={(e) => {
          const start = swipeRef.current;
          swipeRef.current = null;
          if (!start) return;
          const t = e.changedTouches[0];
          if (!t) return;
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          const dt = Date.now() - start.t;
          if (Math.abs(dx) < 55 || Math.abs(dy) > Math.abs(dx) * 0.8 || dt > 450) return;
          if (dx < 0) {
            if (mobileTab === "write") setMobileTab("tools");
            else if (mobileTab === "tools") setIsLibraryOpen(true);
          } else if (dx > 0) {
            if (mobileTab === "tools") setMobileTab("write");
          }
        }}
      >
        <nav className={`workshop-rail ${isFocusMode ? "is-hidden" : ""}`} aria-label="Workshop shortcuts">
          {/* Tablet-only tools drawer toggle */}
          <button
            type="button"
            className="rail-btn tablet-tools-toggle"
            onClick={() => setMobileToolsExpanded(!mobileToolsExpanded)}
            aria-label={mobileToolsExpanded ? "Close tools" : "Open tools"}
            aria-expanded={mobileToolsExpanded}
          >
            <RailIcon>
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.75"/>
                <path d="M15 3v18" stroke="currentColor" strokeWidth="1.75"/>
              </svg>
            </RailIcon>
            <span className="rail-label">Tools</span>
          </button>

          <button
            type="button"
            className="rail-btn rail-btn-library"
            onClick={() => setIsLibraryOpen(true)}
            aria-label="Open library"
            data-tour-id="rail-library"
            aria-haspopup="dialog"
            aria-expanded={isLibraryOpen}
            {...hint("Open Library — manage drafts")}
          >
            <RailIcon>
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <path
                  d="M5 19V6.5A2.5 2.5 0 0 1 7.5 4H20v14.5A1.5 1.5 0 0 1 18.5 20H7.5A2.5 2.5 0 0 1 5 17.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M8 7h9M8 10h9M8 13h6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </RailIcon>
            <span className="rail-label">Library</span>
          </button>

          <span className="rail-group-divider" aria-hidden />

          <button
            type="button"
            className="rail-btn rail-btn-fonts"
            onClick={() => setIsStyleOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={isStyleOpen}
            {...hint("Style — fonts and typography")}
          >
            <RailIcon>
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" d="M4 19l5-13 5 13M6 14h6" />
                <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" d="M17 19v-5.5a2.5 2.5 0 0 1 5 0V19M15.5 16h4" />
              </svg>
            </RailIcon>
            <span className="rail-label">Style</span>
          </button>

          <button
            type="button"
            className={`rail-btn${isBackgroundOpen ? " is-active" : ""}`}
            onClick={() => setIsBackgroundOpen((v) => !v)}
            aria-haspopup="dialog"
            aria-expanded={isBackgroundOpen}
            data-tour-id="rail-background"
            {...hint("Background — choose a scene behind the page")}
          >
            <RailIcon>
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
                <path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" d="M3 15l4.5-4.5 3 3 3-3 4.5 4.5" />
                <circle cx="8" cy="9.5" r="1.25" fill="currentColor" />
              </svg>
            </RailIcon>
            <span className="rail-label">Background</span>
          </button>

          <button
            type="button"
            className="rail-btn rail-btn-primary"
            onClick={() => setIsExportOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={isExportOpen}
            {...hint("Export — copy or download the poem and backups")}
          >
            <RailIcon>
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <path
                  d="M12 14V3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M8.5 6.5 12 3l3.5 3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </RailIcon>
            <span className="rail-label">Export</span>
          </button>

          <span className="rail-group-divider" aria-hidden />

          <button
            type="button"
            className="rail-btn"
            onClick={() => setIsFocusMode((v) => !v)}
            aria-pressed={isFocusMode}
            data-tour-id="rail-focus"
            {...hint(
              isFocusMode
                ? "Exit focus mode — show tools and side rail again"
                : "Focus mode — hide tools for a calmer writing space",
            )}
          >
            <RailIcon>
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <path
                  d="M4 9V6a2 2 0 0 1 2-2h3M20 9V6a2 2 0 0 0-2-2h-3M4 15v3a2 2 0 0 0 2 2h3M20 15v3a2 2 0 0 1-2 2h-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </RailIcon>
            <span className="rail-label">{isFocusMode ? "Unfocus" : "Focus"}</span>
          </button>

          <button
            type="button"
            className="rail-btn rail-btn-guide"
            onClick={() => setIsGuideOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={isGuideOpen}
            {...hint("Guide — how to use easywriting-poem")}
          >
            <RailIcon>
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.75" />
                <path d="M12 17v-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M12 13.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5v1" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            </RailIcon>
            <span className="rail-label">Guide</span>
          </button>
        </nav>

        <section
          ref={editorPanelRef}
          className="editor-panel"
          aria-label="Poem editor"
          id="poem-draft"
          data-tour-id="poem-editor"
        >
          <div className="editor-print-hide">
            <div className="editor-stack">
              {aiResult && (
                <div className="ai-summary-titlebar">
                  <AiSummaryPopover
                    result={aiResult}
                    scoringEnabled={aiScoringEnabled}
                    onJumpToLine={m.goToLine}
                    onOpenTab={openAiTab}
                    visibleIssueCount={aiVisibleIssues.length}
                  />
                </div>
              )}
              {/* Mobile collapsed header — tap to expand, × to hide entirely */}
              {!metaOpen && !metaHidden && (
                <div className="editor-meta-bar">
                  <button
                    type="button"
                    className="editor-meta-collapsed"
                    onClick={() => setMetaOpen(true)}
                    onContextMenu={(e) => { e.preventDefault(); setMetaOpen(true); document.getElementById("poem-title")?.focus(); }}
                    aria-label="Edit title and form"
                  >
                    <span className="editor-meta-collapsed-title">
                      {m.title.trim() || "Untitled"}
                    </span>
                    {m.formNote.trim() && (
                      <span className="editor-meta-collapsed-form">· {m.formNote.trim()}</span>
                    )}
                    <span className="editor-meta-collapsed-chevron" aria-hidden>›</span>
                  </button>
                  <button
                    type="button"
                    className="editor-meta-hide-btn"
                    onClick={() => setMetaHidden(true)}
                    aria-label="Hide title bar for distraction-free writing"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden fill="none" width="14" height="14">
                      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              )}
              {/* Minimal peek bar shown when title is fully hidden */}
              {metaHidden && (
                <button
                  type="button"
                  className="editor-meta-peek-btn"
                  onClick={() => setMetaHidden(false)}
                  aria-label="Show title bar"
                >
                  {m.title.trim() || "Untitled"}
                </button>
              )}
              <div className={`editor-meta-grid${metaOpen ? "" : " editor-meta-grid-hidden"}`} aria-label="Draft metadata">
                <div className="row title-row">
                  <label htmlFor="poem-title">Title</label>
                  <input
                    id="poem-title"
                    type="text"
                    value={m.title}
                    onChange={(e) => m.setTitle(e.target.value)}
                    onBlur={() => { if (m.title.trim()) setMetaOpen(false); }}
                    placeholder="Optional"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div className={`row title-row${mainIdeaOpen ? "" : " editor-main-idea-hidden"}`}>
                  <label htmlFor="poem-main-idea">
                    <button
                      type="button"
                      className="editor-main-idea-toggle"
                      onClick={toggleMainIdea}
                      aria-expanded={mainIdeaOpen}
                      aria-label={mainIdeaOpen ? "Collapse main idea field" : "Expand main idea field"}
                    >
                      Main idea (optional)
                      <span className={`editor-main-idea-chevron${mainIdeaOpen ? "" : " is-collapsed"}`} aria-hidden>‹</span>
                    </button>
                  </label>
                  <input
                    id="poem-main-idea"
                    type="text"
                    value={mainIdea}
                    onChange={(e) => saveMainIdea(e.target.value)}
                    onBlur={() => { if (m.title.trim()) setMetaOpen(false); }}
                    placeholder="e.g. the feeling of leaving home for the first time"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </div>
              <FindReplaceBar
                editorView={m.editorViewRef.current}
                open={isFindOpen}
                mode={findMode}
                onClose={() => setIsFindOpen(false)}
              />
              <div className="row body-row">
                <div className="body-label-row">
                  <label id="poem-body-label" htmlFor="poem-body">
                    Poem
                  </label>
                  {/* Mobile: Aa toggle to show/hide toolbar */}
                  <button
                    type="button"
                    className={`mobile-toolbar-toggle ${mobileToolbarOpen ? "is-open" : ""}`}
                    onClick={() => setMobileToolbarOpen(v => !v)}
                    aria-label={mobileToolbarOpen ? "Hide formatting options" : "Show formatting options"}
                    aria-expanded={mobileToolbarOpen}
                  >
                    Aa
                  </button>
                  <div
                    data-tour-id="format-toolbar"
                    className={`mobile-toolbar-wrap ${mobileToolbarOpen ? "is-open" : ""}`}
                  >
                  <FormatToolbar
                    editorViewRef={m.editorViewRef}
                    poemSize={appearance.poemSize}
                    onSizeChange={(size) =>
                      setAppearance((prev) => ({ ...prev, poemSize: size }))
                    }
                    onReadingMode={() => setIsReadingMode(true)}
                    showLineSyllables={showLineSyllables}
                    onShowLineSyllablesChange={setShowLineSyllables}
                    showRhymeScheme={showRhymeScheme}
                    onShowRhymeSchemeChange={setShowRhymeScheme}
                    lineFocusMode={lineFocusMode}
                    onLineFocusModeChange={setLineFocusMode}
                  />
                  </div>{/* /format-toolbar tour target */}
                </div>
                <div className="poem-editor-with-scheme">
                  <div className="poem-editor-shell" style={{ display: "flex", flexDirection: "column" }}>
                    {diffSnapshot && (
                      <div className="poem-diff-bar" role="status" aria-live="polite">
                        <span className="poem-diff-bar-label">
                          Comparing draft against
                          <span className="poem-diff-bar-snapshot">
                            {diffSnapshot.label || formatRelativeSnapshotWhen(diffSnapshot.createdAt)}
                          </span>
                        </span>
                        {diffStats && (diffStats.added > 0 || diffStats.removed > 0) ? (
                          <span className="poem-diff-bar-stats" aria-label="Word changes">
                            {diffStats.added > 0 && (
                              <span className="poem-diff-bar-stat-add">+{diffStats.added}</span>
                            )}
                            {diffStats.removed > 0 && (
                              <span className="poem-diff-bar-stat-rem">−{diffStats.removed}</span>
                            )}
                          </span>
                        ) : (
                          <span className="poem-diff-bar-stats poem-diff-bar-stats-empty">no changes</span>
                        )}
                        <div className="poem-diff-bar-actions">
                          <button
                            type="button"
                            className="poem-diff-bar-restore"
                            onClick={() => {
                              m.restoreRevision(diffSnapshot);
                              exitDiffSnapshot();
                            }}
                            title="Replace the current draft with this snapshot"
                          >Restore this version</button>
                          <button
                            type="button"
                            className="poem-diff-bar-exit"
                            onClick={exitDiffSnapshot}
                            title="Stop comparing"
                          >Done</button>
                        </div>
                      </div>
                    )}
                    <div className="poem-editor-body-wrap" style={{ position: "relative" }} onClick={handleEditorClickForRhyme}>
                    <PoemBodyEditor
                      id="poem-body"
                      aria-describedby="poem-body-hint"
                      value={m.body}
                      bodySyncNonce={m.bodySyncNonce}
                      onLiveBody={m.onEditorBody}
                      editorViewRef={m.editorViewRef}
                      wordlist={m.wordlist}
                      spellMode={m.spellMode}
                      spellBump={m.spellBump}
                      jumpLine={m.jumpLine}
                      jumpBump={m.jumpBump}
                      peekLine={peekLine}
                      peekBump={peekBump}
                      strongestLine={aiResult?.strongest_line?.line ?? null}
                      issueHighlight={issueHighlight}
                      persistentIssueHighlights={persistentIssueHighlights}
                      issueGutterMarkers={persistentIssueHighlights}
                      onGutterDotClick={(line) => openIssueAtLineRef.current?.(line, true)}
                      onCursorLineChange={(line) => {
                        setCursorLine(line);
                        openIssueAtLineRef.current?.(line, false);
                      }}
                      onApplyRewriteAtCursor={handleApplyRewriteAtCursor}
                      wordHighlights={wordHighlights}
                      rhymeEndHighlights={rhymeEndHighlights}
                      internalRhymes={m.toolTab === "rhyme" ? m.internalRhymes : undefined}
                      repeatHighlights={repeatHighlights}
                      echoHighlights={m.toolTab === "echoes" ? echoHighlights ?? undefined : undefined}
                      lineVowelTints={m.toolTab === "echoes" ? lineVowelTints ?? undefined : undefined}
                      flowMarkers={m.toolTab === "echoes" ? flowMarkers ?? undefined : undefined}
                      meterOverlay={meterOverlay}
                      rhymeSchemeLabels={null}
                      cursorLineGetterRef={cursorLineGetterRef}
                      showLineSyllables={showLineSyllables}
                      lineFocusMode={isFocusMode ? (lineFocusMode ? "line" : "stanza") : lineFocusMode}
                      typewriterScroll={isFocusMode && !IS_TOUCH_DEVICE}
                      onSelectionText={(text, rect) => {
                        setSelectionText(text);
                        setSelectionRect(rect);
                      }}
                      diffSnapshotBody={diffSnapshot?.body ?? null}
                    />
                    <WritingPrompt visible={m.body.trim() === ""} />
                    {aiVisibleIssues.length > 0 && (
                      <AiLineRibbons
                        editorViewRef={m.editorViewRef}
                        issues={aiVisibleIssues}
                        ignoredIds={aiIgnoredIds}
                        onApply={ribbonApply}
                        onIgnore={ribbonIgnore}
                        onSelect={(line) => openIssueAtLineRef.current?.(line)}
                      />
                    )}
                    </div>
                    <InlineRhymeHint editorViewRef={m.editorViewRef} />
                    {selectionText && selectionRect && (
                      <SelectionSuggestPopover
                        key={selectionText}
                        anchorRect={selectionRect}
                        selectedText={selectionText}
                        poemTitle={m.title}
                        poemLines={m.lines}
                        wordLookupEnabled={wordLookupEnabled}
                        aiIssues={aiVisibleIssues}
                        onApplyLine={m.applyLineRewrite}
                        onApply={(text) => {
                          const view = m.editorViewRef.current;
                          if (!view) return;
                          const { from, to } = view.state.selection.main;
                          view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
                          m.onEditorBody(view.state.doc.toString());
                        }}
                        onClose={() => { setSelectionText(null); setSelectionRect(null); }}
                      />
                    )}
                  </div>
                  {showRhymeScheme && m.rhymeScheme.some((l) => l) ? (
                    <div className="editor-rhyme-scheme" aria-label="End-rhyme scheme">
                      {m.rhymeScheme.map((label, i) =>
                        label ? (
                          <span key={i} className="editor-rhyme-row">
                            <span className={`editor-rhyme-label rhyme-label-${label.charAt(0).toLowerCase()}`}>{label}</span>
                          </span>
                        ) : (
                          <span key={i} className="editor-rhyme-spacer" aria-hidden="true" />
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
                <div
                  className={`poem-editor-copy-box ${m.quickCopyFlash ? "is-copied" : ""}`}
                >
                  <div className="poem-editor-copy-slot-inner">
                    <button
                      type="button"
                      className="quick-copy-face quick-copy-face-icon"
                      onClick={() => void m.onQuickCopyPlain()}
                      {...hint("Copy poem body as plain text (no title or form)")}
                      aria-label="Copy poem body as plain text"
                      tabIndex={m.quickCopyFlash ? -1 : 0}
                      aria-hidden={m.quickCopyFlash}
                    >
                      <svg
                        className="quick-copy-svg"
                        viewBox="0 0 24 24"
                        aria-hidden
                      >
                        <path
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                        />
                      </svg>
                    </button>
                    <span
                      className="quick-copy-face quick-copy-face-done"
                      aria-live="polite"
                      aria-hidden={!m.quickCopyFlash}
                    >
                      Copied
                    </span>
                  </div>
                </div>
              </div>
              {(m.goals.targetLines != null || m.goals.targetStanzas != null || m.goals.targetLinesPerStanza != null) && (
                <div className="editor-goal-strip" aria-label="Goal progress">
                  {m.goals.preset && (
                    <span className="editor-goal-strip-form">{FORM_PRESETS.find(p => p.key === m.goals.preset)?.label}</span>
                  )}
                  {m.goals.targetLines != null && (
                    <span className={`editor-goal-strip-item${m.docStats.nonEmptyLines === m.goals.targetLines ? " is-met" : m.docStats.nonEmptyLines > m.goals.targetLines ? " is-over" : ""}`}>
                      {m.docStats.nonEmptyLines}/{m.goals.targetLines} lines
                    </span>
                  )}
                  {m.goals.targetStanzas != null && (
                    <span className={`editor-goal-strip-item${m.docStats.stanzaCount === m.goals.targetStanzas ? " is-met" : m.docStats.stanzaCount > m.goals.targetStanzas ? " is-over" : ""}`}>
                      {m.docStats.stanzaCount}/{m.goals.targetStanzas} stanzas
                    </span>
                  )}
                  {m.goals.targetLinesPerStanza != null && m.docStats.stanzaCount > 0 && (
                    <span className={`editor-goal-strip-item${Math.round(m.docStats.nonEmptyLines / m.docStats.stanzaCount) === m.goals.targetLinesPerStanza ? " is-met" : ""}`}>
                      {Math.round(m.docStats.nonEmptyLines / m.docStats.stanzaCount)}/{m.goals.targetLinesPerStanza} L/S
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <pre className="poem-print-fallback" aria-hidden="true">
            {printPoemText}
          </pre>

          {/* Mobile quick-stats strip — always visible at bottom of editor on narrow screens */}
          <div className="mobile-editor-stats" aria-label="Quick stats" role="status">
            <span className="mobile-editor-stat">
              <span className="mobile-editor-stat-val">{m.quickDocStats.totalWords}</span>
              <span className="mobile-editor-stat-lbl">words</span>
            </span>
            <span className="mobile-editor-stat-divider" aria-hidden>·</span>
            <span className="mobile-editor-stat">
              <span className="mobile-editor-stat-val">{m.quickDocStats.totalLines}</span>
              <span className="mobile-editor-stat-lbl">lines</span>
            </span>
            {m.lastAiScore != null && (
              <>
                <span className="mobile-editor-stat-divider" aria-hidden>·</span>
                <span className="mobile-editor-stat">
                  <span className="mobile-editor-stat-val">✦ {m.lastAiScore}</span>
                  <span className="mobile-editor-stat-lbl">score</span>
                </span>
              </>
            )}
          </div>
        </section>

        {/* Rail resize gutter */}
        {!isReadingMode && (
          <div
            className="rail-resize-gutter"
            onPointerDown={handleRailResizeStart}
            onDoubleClick={() => { applyRailW(DEFAULT_RAIL_W); saveRailW(DEFAULT_RAIL_W); }}
            aria-hidden
            title="Drag to resize · double-click to reset"
          />
        )}

        {/* Tools resize gutter */}
        {!isReadingMode && (
          <div
            className="tools-resize-gutter"
            onPointerDown={handleResizeStart}
            onDoubleClick={() => { applyToolsW(DEFAULT_TOOLS_W); saveToolsW(DEFAULT_TOOLS_W); }}
            aria-hidden
            title="Drag to resize · double-click to reset"
          />
        )}

        <aside
          ref={toolsPanelRef}
          className={`tools-panel ${isFocusMode ? "is-collapsed" : ""} ${!mobileToolsExpanded ? "is-mobile-collapsed" : ""}`}
          aria-label="Tools"
          id="writing-tools"
          data-tour-id="tools-panel"
        >
          <div className="tools-scroll-body">
          <div className="tools-sticky-head">
            <div
              className="tools-swipe-handle"
              role="slider"
              aria-label="Drag to resize tools sheet"
              aria-valuemin={0}
              aria-valuemax={2}
              aria-valuenow={mobileSheetSnap === "full" ? 2 : 1}
              onPointerDown={handleSheetDragStart}
              onPointerMove={handleSheetDragMove}
              onPointerUp={handleSheetDragEnd}
              onPointerCancel={handleSheetDragEnd}
              onClick={() => {
                if (window.innerWidth > 899) return;
                setMobileSheetSnap((s) => (s === "half" ? "full" : "half"));
              }}
            />
            <button
              type="button"
              className="tools-mobile-close"
              onClick={() => setMobileToolsExpanded(false)}
              aria-label="Close tools"
            >
              ✕
            </button>
            <div className="tools-head-row tools-head-row-simple">
              <h2 className="tools-heading">Tools</h2>
              <button
                type="button"
                className="tools-analyse-btn"
                onClick={() => {
                  if (window.innerWidth <= 899) {
                    // Mobile: open the analysis sheet (same as the bottom-bar Analyse pill).
                    if (mobileAiOpen) {
                      mobileSheetAnalyzeFn.current?.();
                    } else {
                      mobileSheetAutoTrigger.current = true;
                      setMobileAiOpen(true);
                    }
                  } else {
                    mobileAnalyzeFnRef.current?.();
                    requestAnimationFrame(() => {
                      const el = document.querySelector(".ai-analysis-section") as HTMLElement | null;
                      el?.scrollIntoView({ behavior: "smooth", block: "start" });
                    });
                  }
                }}
                {...hint("Run AI analysis on this poem")}
              >
                ✦ Analyse
              </button>
            </div>
            <div
              className="tool-bucket-row"
              role="tablist"
              aria-label="Tool groups"
              data-tour-id="tool-buckets"
            >
              {TOOL_BUCKET_ORDER.map((b) => {
                const active = toolTabBucket(m.toolTab) === b;
                return (
                  <button
                    key={b}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    className={`tool-bucket-tab ${active ? "active" : ""}`}
                    onClick={() => m.setToolTab(defaultTabForBucket(b))}
                  >
                    {TOOL_BUCKET_LABEL[b]}
                  </button>
                );
              })}
            </div>
            <nav
              className="tool-tabs"
              role="tablist"
              aria-label="Tools in this group"
              onKeyDown={onToolTabKeyDown}
            >
              {(() => {
                const CORE_OVERVIEW: string[] = ["issues", "lines"];
                const visibleTabs = TOOL_TABS.filter((t) => bucketTabs.includes(t.id));
                const isOverview = toolTabBucket(m.toolTab) === "overview";
                const collapsed = isOverview && !allTabsExpanded;
                const shown = collapsed
                  ? visibleTabs.filter((t) => CORE_OVERVIEW.includes(t.id) || m.toolTab === t.id)
                  : visibleTabs;
                return (
                  <>
                    {shown.map(({ id, label, desc, Icon }) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        id={`tool-tab-${id}`}
                        aria-selected={m.toolTab === id}
                        aria-controls={`tool-panel-${id}`}
                        tabIndex={m.toolTab === id ? 0 : -1}
                        className={`tool-tab ${m.toolTab === id ? "active" : ""}`}
                        onClick={() => m.setToolTab(id)}
                        title={desc}
                      >
                        <Icon />
                        <span className="tool-tab-label">{label}</span>
                        {id === "issues" && issuesQueueCount > 0 && (
                          <span className="goal-tab-dot" aria-label="issues in queue" />
                        )}
                        {id === "spell" && m.wordlist && m.spellHits.length > 0 && (
                          <span className="goal-tab-dot" aria-label={`${m.spellHits.length} spelling flags`} />
                        )}
                        {id === "goals" && m.goalEvaluation.warnings.length > 0 && (
                          <span className="goal-tab-dot" aria-label="goals not met" />
                        )}
                      </button>
                    ))}
                    {collapsed && (
                      <button
                        type="button"
                        className="tool-tab tool-tab-more"
                        onClick={expandAllTabs}
                        title="Show all tools"
                      >
                        <span className="tool-tab-more-dots">•••</span>
                        <span className="tool-tab-label">More</span>
                      </button>
                    )}
                  </>
                );
              })()}
            </nav>
          </div>

          <Suspense fallback={<div className="tools-loading-fallback" aria-hidden />}>
          <WorkshopToolPanels
            toolTab={m.toolTab}
            docStats={m.docStats}
            meterHints={m.meterHints}
            goals={m.goals}
            goalEvaluation={m.goalEvaluation}
            publication={m.publication}
            rhymeClusters={m.rhymeClusters}
            vowelTailClusters={m.vowelTailClusters}
            assonanceClusters={m.assonanceClusters}
            consonanceClusters={m.consonanceClusters}
            stanzaRhymeGroups={m.stanzaRhymeGroups}
            repeated={m.repeated}
            repetition={m.repetition}
            spellHits={m.spellHits}
            wordlist={m.wordlist}
            wordlistErr={m.wordlistErr}
            spellMode={m.spellMode}
            onSpellModeChange={m.setSpellMode}
            goToLine={m.goToLine}
            goToWord={m.goToWord}
            goToLineEnd={m.goToLineEnd}
            goToSpellHitAt={m.goToSpellHitAt}
            cycleSpellHit={m.cycleSpellHit}
            spellNavIndex={m.spellNavIndex}
            applySpellSuggestion={m.applySpellSuggestion}
            applySpellSuggestionAll={m.applySpellSuggestionAll}
            spellBump={m.spellBump}
            refreshSpell={m.refreshSpell}
            onSpellPersistenceError={m.onSpellPersistenceError}
            updateGoal={m.updateGoal}
            setGoalValue={m.setGoalValue}
            setRhymeSchemeGoal={m.setRhymeSchemeGoal}
            setRhymeSchemePerStanza={m.setRhymeSchemePerStanza}
            resetGoals={m.resetGoals}
            toggleGoalSoft={m.toggleGoalSoft}
            applyGoalPreset={m.applyGoalPreset}
            revisions={m.revisions}
            snapshotLabel={m.snapshotLabel}
            onSnapshotLabelChange={m.setSnapshotLabel}
            onSaveSnapshot={m.saveSnapshot}
            snapshotFlash={m.snapshotFlash}
            onRestoreRevision={m.restoreRevision}
            onDeleteRevision={m.deleteRevision}
            onDeleteDuplicateRevisions={m.deleteDuplicateRevisions}
            duplicateRevisionCount={m.duplicateRevisionCount}
            onDiffSnapshot={handleDiffSnapshot}
            activeDiffSnapshotId={diffSnapshot?.id ?? null}
            onOpenToolTab={m.setToolTab}
            focusPoemTitle={focusPoemTitle}
            stressLexiconReady={m.stressLexiconReady}
            stressLexiconErr={m.stressLexiconErr}
            heavyToolsStale={m.heavyToolsStale}
            poemId={m.activePoemId}
            repeatSubTab={repeatSubTab}
            setRepeatSubTab={setRepeatSubTab}
            clicheHits={m.clicheHits}
            poemTitle={m.title}
            poemLines={m.lines}
            onInsertSuggestion={m.insertTextAtEnd}
            onInsertSuggestionAtCursor={m.insertTextAtCursor}
            selectedText={selectionText}
            onInsertWord={m.replaceEndWordOrInsert}
            onReplaceLine={(lineNum, text) => m.applyLineRewrite(lineNum, lineNum, text)}
            cursorLine={cursorLine}
            rhymeBreadth={rhymeBreadth}
            onRhymeBreadthChange={setRhymeBreadth}
            rhymeFinderQuery={rhymeFinderQuery}
            onRhymeSuggestionHover={setHoveredRhymeWord}
            manualRhymeLinks={manualRhymeLinks.links}
            onAddManualRhymeLink={manualRhymeLinks.addLink}
            onRemoveManualRhymeLink={manualRhymeLinks.removeLink}
            manualRhymeUnlinks={manualRhymeUnlinks.unlinks}
            onAddManualRhymeUnlink={manualRhymeUnlinks.addUnlink}
            onRemoveManualRhymeUnlink={manualRhymeUnlinks.removeUnlink}
            stressLexicon={m.stressLexicon}
            manualStressOverrides={manualStress.overrides}
            onSetStressOverride={manualStress.setOverride}
            onRemoveStressOverride={manualStress.removeOverride}
            onEchoHighlightsChange={setEchoHighlights}
            onLineVowelTintsChange={setLineVowelTints}
            onFlowMarkersChange={setFlowMarkers}
          />
          </Suspense>

          {/* Mobile-only hint when the poem is blank and the user has just opened Tools */}
          {mobileToolsExpanded && !m.lines.some((l) => l.trim()) && (
            <div className="tools-empty-hint">
              <p className="tools-empty-hint-msg">
                Write a few lines first — the tools will light up with rhyme suggestions, syllable counts, cliché flags, and more.
              </p>
              <ul className="tools-empty-hint-list" aria-hidden>
                <li>🔤 Rhyme &amp; sound</li>
                <li>∿ Meter &amp; syllables</li>
                <li>✦ AI analysis</li>
                <li>📚 Word lookup</li>
              </ul>
            </div>
          )}
          </div>{/* /tools-scroll-body */}

          {/* Shortcuts nudge — desktop only, always visible at bottom of panel */}
          <div className="tools-shortcuts-hint" aria-hidden>
            <button
              type="button"
              className="tools-shortcuts-hint-btn"
              onClick={() => { setIsShortcutsOpen(true); }}
            >
              <kbd className="kbd-hint">?</kbd> shortcuts
            </button>
            <span className="tools-shortcuts-sep" aria-hidden>·</span>
            <button
              type="button"
              className="tools-shortcuts-hint-btn"
              onClick={() => { setIsCmdkOpen(true); }}
            >
              <kbd className="kbd-hint">⌘K</kbd> commands
            </button>
          </div>
        </aside>

        {/* AI Analysis — second row of the workshop grid, spans editor+tools columns so the rail can stay beside it on desktop. Hidden on mobile (results flow into the Issues tab). */}
        <Suspense fallback={null}>
          <AiAnalysis
            key={m.activePoemId}
            poemId={m.activePoemId}
            title={m.title}
            lines={m.lines}
            mainIdea={mainIdea}
            localAnalysis={localAnalysis}
            goals={m.goals}
            onJumpToLine={m.goToLine}
            onJumpToWord={m.goToWordStart}
            onPeekLine={smartPreviewLine}
            onHighlightLines={(start, end, sev) => setIssueHighlight([start, end, sev])}
            onClearHighlight={() => setIssueHighlight(null)}
            onAnalysisDone={(issues, score) => {
              handleVisibleIssuesChange(issues);
              m.setLastAiScore(score);
              requestAnimationFrame(() => {
                const panel = toolsPanelRef.current;
                if (!panel) return;
                const resultsEl = panel.querySelector(".ai-results") as HTMLElement | null;
                if (resultsEl) {
                  const panelRect = panel.getBoundingClientRect();
                  const elRect = resultsEl.getBoundingClientRect();
                  panel.scrollTo({ top: panel.scrollTop + elRect.top - panelRect.top - 16, behavior: "smooth" });
                }
              });
            }}
            onVisibleIssuesChange={handleVisibleIssuesChange}
            onResultChange={setAiResult}
            onApplyLine={m.applyLineRewrite}
            onAnalyzeRef={(fn) => { mobileAnalyzeFnRef.current = fn; }}
            onOpenIssueAtLineRef={(fn) => { openIssueAtLineRef.current = fn; }}
            onSwitchTabRef={(fn) => { aiSwitchTabRef.current = fn; }}
          />
        </Suspense>
      </main>

      <MobileActionBar
        isFocusMode={isFocusMode}
        activeTab={mobileTab}
        wordCount={m.quickDocStats.totalWords}
        isAnalyzing={mobileIsAnalyzing}
        onTab={(tab: MobileTab) => {
          if (tab === "library") {
            setIsLibraryOpen(true);
            setMobileTab("write");
          } else {
            setMobileTab(tab);
          }
        }}
        onAnalyse={() => {
          if (mobileAiOpen) {
            // Sheet already visible — run analysis directly without remounting.
            mobileSheetAnalyzeFn.current?.();
          } else {
            mobileSheetAutoTrigger.current = true;
            setMobileAiOpen(true);
          }
        }}
      />

      {/* Mobile AI analysis bottom sheet */}
      {mobileAiOpen && (
        <div className="mobile-ai-sheet" role="dialog" aria-label="AI Analysis">
          <div className="mobile-ai-sheet-backdrop" onClick={() => { setMobileAiOpen(false); setMobileIsAnalyzing(false); }} />
          <div className="mobile-ai-sheet-panel">
            <div className="mobile-ai-sheet-grip" aria-hidden />
            <div className="mobile-ai-sheet-header">
              <span className="mobile-ai-sheet-title">✦ AI Analysis</span>
              <button
                type="button"
                className="mobile-ai-sheet-close"
                onClick={() => { setMobileAiOpen(false); setMobileIsAnalyzing(false); }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="mobile-ai-sheet-body">
              <Suspense fallback={<p className="muted small" style={{ padding: "1rem" }}>Loading…</p>}>
                <AiAnalysis
                  key={`mobile-ai-${m.activePoemId}`}
                  poemId={m.activePoemId}
                  title={m.title}
                  lines={m.lines}
                  mainIdea={mainIdea}
                  localAnalysis={localAnalysis}
                  goals={m.goals}
                  onJumpToLine={(line) => { m.goToLine(line); setMobileAiOpen(false); setMobileTab("write"); }}
                  onJumpToWord={(line, phrase) => { m.goToWordStart(line, phrase); setMobileAiOpen(false); setMobileTab("write"); }}
                  onPeekLine={smartPreviewLine}
                  onHighlightLines={(start, end, sev) => setIssueHighlight([start, end, sev])}
                  onClearHighlight={() => setIssueHighlight(null)}
                  onAnalysisDone={(issues, score) => {
                    handleVisibleIssuesChange(issues);
                    m.setLastAiScore(score);
                  }}
                  onVisibleIssuesChange={handleVisibleIssuesChange}
                  onResultChange={setAiResult}
                  onApplyLine={m.applyLineRewrite}
                  onAnalyzeRef={mobileSheetAiRef}
                  onLoadingChange={setMobileIsAnalyzing}
                  onSwitchTabRef={(fn) => { aiSwitchTabRef.current = fn; }}
                />
              </Suspense>
            </div>
          </div>
        </div>
      )}

      <WorkshopModals
        isTemplatesOpen={isTemplatesOpen}
        onCloseTemplates={() => setIsTemplatesOpen(false)}
        onInsertTemplate={(body, form) => { m.applyTemplate(body, form); setIsTemplatesOpen(false); }}
        isReadingMode={isReadingMode}
        onCloseReadingMode={() => setIsReadingMode(false)}
        title={m.title}
        formNote={m.formNote}
        body={m.body}
        isShareOpen={isShareOpen}
        onCloseShare={() => setIsShareOpen(false)}
        sharedPoemView={sharedPoemView}
        onDismissSharedPoem={() => { setSharedPoemView(null); window.location.hash = ""; }}
        onAddSharedPoemToDrafts={(poem) => {
          m.newPoem();
          setTimeout(() => { m.setTitle(poem.title); m.setBody(poem.body); }, 50);
          setSharedPoemView(null);
          window.location.hash = "";
        }}
      />

      <footer className="privacy">
        <div className="privacy-top-row">
          <details className="privacy-details">
            <summary className="privacy-summary">
              Privacy — your drafts stay in this browser
            </summary>
          <div className="privacy-body">
            <p>
              No analytics, no accounts, no tracking. Drafts, snapshots, and settings
              are stored only in this browser's <code>localStorage</code> and are never
              sent to a server during normal editing.
            </p>
            <p>
              If you use the optional AI analysis feature, the poem text is sent to the
              configured AI provider for that request only. Exporting or copying sends
              text wherever you direct it — check that destination's terms.
            </p>
            <p>
              New to the layout?{" "}
              <button
                type="button"
                className="privacy-inline-link"
                onClick={() => setIsGuideOpen(true)}
              >
                Open the guide
              </button>
              {" "}any time.
            </p>
          </div>
          </details>
          <FeedbackWidget />
        </div>
      </footer>
    </div>
  );
}
