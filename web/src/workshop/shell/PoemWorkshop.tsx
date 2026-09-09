import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RailIcon } from "./components/RailIcon";
import { WritingPrompt } from "./components/WritingPrompt";
import { EditorEndOfTextLine } from "./components/EditorEndOfTextLine";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  applyAppearance,
  loadAppearance,
  saveAppearance,
  type AppearanceSettings,
} from "@/workshop/appearance/appearance";
import { AppearanceFormFields } from "@/workshop/appearance/AppearanceFormFields";
import { BackdropMotionToggle } from "@/workshop/appearance/BackdropFormFields";
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
import { loadLastAnalysis, loadIgnoredIssueIds, loadDismissedIssueIds, LS_DISMISSED_PREFIX, LS_IGNORED_PREFIX } from "@/workshop/analysis/ai-analysis-storage";
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
import { buildToolStats, type ToolStatsInput } from "@/workshop/analysis/tool-stats";
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
  formatRelativeSnapshotWhen,
  tabsForBucket,
  type ToolTab,
} from "./workshop-helpers";
import { STORAGE_KEY_SHOW_LINE_SYLLABLES, STORAGE_KEY_SHOW_RHYME_SCHEME, STORAGE_KEY_RHYME_SCHEME_BREADTH, STORAGE_KEY_WORD_LOOKUP_ENABLED } from "@/shared/storage-keys";
import { usePanelLayout, DEFAULT_TOOLS_W, DEFAULT_RAIL_W, MIN_EDITOR_W } from "./hooks/usePanelLayout";
import { useSheetDrag } from "./hooks/useSheetDrag";
import { InlineRhymeHint } from "@/workshop/editor/InlineRhymeHint";
import { WorkshopModals } from "./WorkshopModals";
import { WorkshopBanners } from "./WorkshopBanners";
import { hasBlockingBanner } from "./workshop-banner-state";
import { useIsNarrowViewport } from "./hooks/useIsNarrowViewport";
import { WorkshopTopbarHeader } from "./WorkshopTopbarHeader";
import { WorkshopLibraryModal } from "./WorkshopLibraryModal";
import type { LibraryRow } from "./WorkshopLibraryModal";
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
// MUST stay last. PoemWorkshop.css reaches WorkshopLayout.css through an @import,
// and @import is hoisted above the importing sheet's own rules — so phone-only
// layout declared there lost every equal-specificity tie to the 8,700 lines that
// followed. Importing the mobile block here instead puts it at the end of the
// cascade, which is what its media query always meant. See WorkshopMobile.css.
import "./WorkshopMobile.css";

function endWordOfLineRaw(line: string | undefined): string {
  if (!line) return "";
  const m = line.match(/[A-Za-z'’]+(?=[^A-Za-z'’]*$)/);
  return m ? m[0] : "";
}

function deriveAiHighlights(poemId: string | undefined): {
  lines: Array<[number, number, string?]>;
  words: Array<{ words: string[]; lineStart: number; lineEnd: number; severity?: string; headline?: string }>;
} {
  const saved = loadLastAnalysis(poemId);
  if (!saved) return { lines: [], words: [] };
  const ignored = loadIgnoredIssueIds(poemId);
  const issues = saved.issues.filter((i) => !ignored.has(i.id));
  return {
    lines: issues.map((iss) => [iss.line_start, iss.line_end, iss.severity] as [number, number, string?]),
    // Keep editor highlights sparse — one word per issue is enough to draw the
    // eye to where the issue lives without turning the poem into a heatmap.
    words: issues
      .filter((iss) => iss.problem_words && iss.problem_words.length > 0)
      .map((iss) => ({ words: iss.problem_words!.slice(0, 1), lineStart: iss.line_start, lineEnd: iss.line_end, severity: iss.severity, headline: iss.headline })),
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
  // Whether the tools panel is expanded (a tool's panel is showing) or
  // collapsed to a thin icon rail. `activeTool` is the currently-open tool, or
  // null when collapsed — editor overlays key off it so a collapsed panel shows
  // no rhyme/meter/repeat decorations.
  const [toolsExpanded, setToolsExpanded] = useState(false);
  // The collapsed icon rail always shows a text label under each icon — clear
  // for new users. (Previously toggleable; now permanently on.)
  // Enable the width transition only after first paint so the initial
  // collapsed→rail sizing doesn't animate on load.
  const [toolsAnimReady, setToolsAnimReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setToolsAnimReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const activeTool: ToolTab | null = toolsExpanded ? m.toolTab : null;
  const openToolTab = useCallback(
    (t: ToolTab) => {
      m.setToolTab(t);
      setToolsExpanded(true);
    },
    [m],
  );
  const toggleToolTab = useCallback(
    (t: ToolTab) => {
      // Collapse when clicking the already-open tool; otherwise open it.
      if (toolsExpanded && m.toolTab === t) {
        setToolsExpanded(false);
      } else {
        m.setToolTab(t);
        setToolsExpanded(true);
      }
    },
    [toolsExpanded, m],
  );
  useWorkshopToolHotkeys(m.toolTab, openToolTab);

  useWritingStreakOnMount(m.body);

  // The "Main idea" field is gone. It was optional, rarely filled, and cost a
  // label + input in the meta row on every draft; what it fed the analyzer (a
  // "Main idea: …" writing focus) is now better covered by the tool readings.
  // Values already in localStorage under easy-poems:main-idea:<poemId> are left
  // alone rather than deleted — they are the writer's text, not ours to bin.
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
  // The phone tools sheet is never dismissed — it rests peeking above the bottom
  // edge and is dragged to whatever height the writer wants (see useSheetDrag), so
  // there is no open/closed state and no bottom tab bar to switch between.
  //
  // Tablets (900–1049px) are a different layout: there the tools are a slide-in
  // right drawer that genuinely opens and closes, so they keep their own flag.
  // It used to share the phone's state, which is why removing that broke the
  // tablet toggle.
  const [tabletToolsOpen, setTabletToolsOpen] = useState(false);
  const [topbarOverflowOpen, setTopbarOverflowOpen] = useState(false);
  const overflowMenuRef = useRef<HTMLDivElement | null>(null);

  const {
    workshopGridRef,
    toolsPanelWidth,
    setToolsPanelWidth,
    toolsRailWidth,
    railWidth,
    applyToolsW,
    applyRailW,
    saveToolsW,
    saveRailW,
    resetLayout,
    handleResizeStart,
    handleRailResizeStart,
    handleToolsRailResizeStart,
  } = usePanelLayout();
  const isNarrow = useIsNarrowViewport();
  // The title row has no open/collapsed/hidden states any more — it is simply a
  // small field that is always there. See the meta grid in the editor below.
  // Format toolbar collapsed by default on mobile
  const [mobileToolbarOpen, setMobileToolbarOpen] = useState(false);

  // Swipe gesture state

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

  const openIssueAtLineRef = useRef<((line: number, scroll?: boolean) => void) | null>(null);

  const [aiResult, setAiResult] = useState<PoemAnalysis | PoemComparison | null>(null);
  const [aiVisibleIssues, setAiVisibleIssues] = useState<AnalysisIssue[]>([]);
  const [aiIgnoredIds, setAiIgnoredIds] = useState<Set<string>>(() => loadIgnoredIssueIds(undefined));
  const [aiDismissedIds, setAiDismissedIds] = useState<Set<string>>(() => loadDismissedIssueIds(undefined));
  const aiDismissedIssues = useMemo<AnalysisIssue[]>(
    () => (aiResult ? aiResult.issues.filter((i) => aiDismissedIds.has(i.id)) : []),
    [aiResult, aiDismissedIds],
  );
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
  const [wordHighlights, setWordHighlights] = useState<Array<{ words: string[]; lineStart: number; lineEnd: number; severity?: string; headline?: string }>>(
    () => deriveAiHighlights(m.activePoemId).words,
  );
  const rhymeIgnored = useIgnoredRhymes();
  const [repeatSubTab, setRepeatSubTab] = useState<"words" | "phrases" | "patterns">("words");
  const [cursorLine, setCursorLine] = useState<number>(1);
  // Separate primitive states (not one object) so React's setState bailout
  // skips a re-render on keystrokes that don't change the line count or the
  // empty/non-empty boundary — most keystrokes don't, and this data feeds
  // the end-of-text divider on every doc change, un-debounced.
  const [liveLineCount, setLiveLineCount] = useState<number>(() => m.lines.length);
  const [liveHasText, setLiveHasText] = useState<boolean>(() => m.body.length > 0);
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
    if (activeTool !== "meter") return null;
    const out: Array<{ line: number; marks: Array<{ col: number; stress: boolean }> }> = [];
    for (let i = 0; i < m.lines.length; i++) {
      const lineText = m.lines[i] ?? "";
      if (!lineText.trim()) continue;
      const marks = meterMarksForLine(lineText, m.stressLexicon, manualStress.overrides);
      if (marks.length === 0) continue;
      out.push({ line: i + 1, marks });
    }
    return out.length === 0 ? null : out;
  }, [activeTool, m.lines, m.stressLexicon, manualStress.overrides]);

  const rhymeBumpRef = useRef(0);

  const baseRhymeEndHighlights = useMemo(() => {
    if (activeTool !== "rhyme") return [] as Array<{ line: number; colorKey: string }>;
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
  }, [activeTool, m.stanzaRhymeGroups, m.lines, rhymeIgnored]);

  // Auto-fill the Rhyme Finder when the cursor parks on a different line or
  // the user opens the rhyme tab. Avoids refiring on every keystroke.
  const rhymeLinesRef = useRef(m.lines);
  rhymeLinesRef.current = m.lines;
  useEffect(() => {
    if (activeTool !== "rhyme") return;
    const word = endWordOfLineRaw(rhymeLinesRef.current[(cursorLine ?? 1) - 1]);
    if (!word) return;
    rhymeBumpRef.current += 1;
    // Passive cursor parking — fill query but don't pop a collapsed panel open.
    setRhymeFinderQuery({ word, bump: rhymeBumpRef.current });
  }, [activeTool, cursorLine]);

  // Click delegation: when in the rhyme tab, clicking any highlighted
  // end-word in the editor refills the Rhyme Finder with that word.
  // Also handles AI word-issue Alt+clicks: opens the matching issue panel.
  const handleEditorBodyClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const issueHit = target?.closest(".cm-word-issue") as HTMLElement | null;
    if (issueHit && event.altKey) {
      const raw = issueHit.getAttribute("data-issue-line");
      const line = raw ? Number(raw) : NaN;
      if (Number.isFinite(line) && line > 0) {
        event.preventDefault();
        event.stopPropagation();
        openIssueAtLineRef.current?.(line, true);
      }
      return;
    }
    if (activeTool !== "rhyme") return;
    const hit = target?.closest(".cm-rhyme-end") as HTMLElement | null;
    if (!hit) return;
    const word = (hit.textContent || "").trim();
    if (!word) return;
    rhymeBumpRef.current += 1;
    setRhymeFinderQuery({ word, bump: rhymeBumpRef.current });
  }, [activeTool]);

  // Add transient highlights for end-words that rhyme with the currently
  // hovered Datamuse suggestion. Uses the same breadth as the editor scheme.
  const rhymeEndHighlights = useMemo(() => {
    if (activeTool !== "rhyme" || !hoveredRhymeWord) return baseRhymeEndHighlights;
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
  }, [baseRhymeEndHighlights, hoveredRhymeWord, activeTool, m.lines, rhymeBreadth]);

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

  // Readings from the writing tools, handed to the AI analysis as supporting
  // evidence. Built on demand (when the poet asks for a read) rather than in a
  // memo: the Echoes pass is far too much work to run on every keystroke.
  const toolStatsSource: ToolStatsInput = {
    lines: m.lines, docStats: m.docStats, meterHints: m.meterHints,
    repetition: m.repetition, internalRhymes: m.internalRhymes,
    spellHits: m.spellHits, stressLexicon: m.stressLexicon,
  };
  const toolStatsSourceRef = useRef(toolStatsSource);
  toolStatsSourceRef.current = toolStatsSource;
  const getToolStats = useCallback(() => buildToolStats(toolStatsSourceRef.current), []);
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
      setAiDismissedIds(loadDismissedIssueIds(m.activePoemId));
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
    setAiDismissedIds(loadDismissedIssueIds(m.activePoemId));
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
        .map((iss) => ({ words: iss.problem_words!.slice(0, 1), lineStart: iss.line_start, lineEnd: iss.line_end, severity: iss.severity, headline: iss.headline })),
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
    const poemId = m.activePoemId;
    setAiIgnoredIds((prev) => {
      const s = new Set(prev);
      s.add(id);
      if (poemId) {
        try { localStorage.setItem(LS_IGNORED_PREFIX + poemId, JSON.stringify([...s])); } catch { /* ignore */ }
      }
      return s;
    });
    setAiDismissedIds((prev) => {
      const s = new Set(prev);
      s.add(id);
      if (poemId) {
        try { localStorage.setItem(LS_DISMISSED_PREFIX + poemId, JSON.stringify([...s])); } catch { /* ignore */ }
      }
      return s;
    });
    setAiVisibleIssues((prev) => prev.filter((i) => i.id !== id));
  }, [m.activePoemId]);

  const ribbonRestore = useCallback((id: string) => {
    const poemId = m.activePoemId;
    setAiIgnoredIds((prev) => {
      if (!prev.has(id)) return prev;
      const s = new Set(prev);
      s.delete(id);
      if (poemId) {
        try {
          if (s.size === 0) localStorage.removeItem(LS_IGNORED_PREFIX + poemId);
          else localStorage.setItem(LS_IGNORED_PREFIX + poemId, JSON.stringify([...s]));
        } catch { /* ignore */ }
      }
      return s;
    });
    setAiDismissedIds((prev) => {
      if (!prev.has(id)) return prev;
      const s = new Set(prev);
      s.delete(id);
      if (poemId) {
        try {
          if (s.size === 0) localStorage.removeItem(LS_DISMISSED_PREFIX + poemId);
          else localStorage.setItem(LS_DISMISSED_PREFIX + poemId, JSON.stringify([...s]));
        } catch { /* ignore */ }
      }
      return s;
    });
    setAiVisibleIssues((prev) => {
      if (prev.some((i) => i.id === id)) return prev;
      const restored = aiResult?.issues.find((i) => i.id === id);
      if (!restored) return prev;
      return [...prev, restored];
    });
  }, [m.activePoemId, aiResult]);

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
  // Inner scroll container of the tools panel (the accordion list scrolls here on desktop).
  const toolsScrollBodyRef = useRef<HTMLDivElement | null>(null);
  const toolsGutterRef = useRef<HTMLDivElement | null>(null);
  const railPanelRef = useRef<HTMLElement | null>(null);
  const railGutterRef = useRef<HTMLDivElement | null>(null);

  const {
    handleSheetDragStart,
    handleSheetDragMove,
    handleSheetDragEnd,
    sheetIsProminent,
    sheetIsExpanded,
    sheetIsStowed,
    openSheet,
    collapseSheet,
  } = useSheetDrag({ toolsPanelRef });
  const editorPanelRef = useRef<HTMLElement | null>(null);
  const mobileAnalyzeFnRef = useRef<(() => void) | null>(null);
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
    if (activeTool !== "repeat") return undefined;
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
  }, [activeTool, repeatSubTab, m.repeated, m.repetition]);

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

  // Once opened, the sheet stays mounted and hides instead of unmounting, so a
  // read in flight survives a close. Unmounting aborted it client-side — the
  // server had already taken the request and billed it — and left the remounted
  // panel at status "idle", so reopening looked like nothing was happening and
  // fired a second read straight into the rate limit.
  const [mobileAiEverOpened, setMobileAiEverOpened] = useState(false);
  useEffect(() => {
    if (mobileAiOpen) setMobileAiEverOpened(true);
  }, [mobileAiOpen]);

  // The ONE place a read starts when the sheet opens. There were two: the ref
  // callback fired the moment AiAnalysis registered its analyze fn, and a
  // timer fired again 200ms later "in case the first didn't catch". Both fired,
  // every time, and the second aborted the first mid-flight and re-requested —
  // so one tap on Analyse cost two API calls, and the rate limit arrived at
  // half the taps it should have.
  //
  // Gated on the flag the Analyse action sets, so opening the sheet any other
  // way — tapping the score pill to read the notes, jumping to an issue — never
  // starts a read on its own. The short delay lets AiAnalysis mount and register
  // first; a repeat call would be free anyway, since handleAnalyze returns early
  // while a read is in flight.
  useEffect(() => {
    if (!mobileAiOpen || !mobileSheetAutoTrigger.current) return;
    const id = window.setTimeout(() => {
      mobileSheetAutoTrigger.current = false;
      mobileSheetAnalyzeFn.current?.();
    }, 250);
    return () => window.clearTimeout(id);
  }, [mobileAiOpen]);

  const openAiTab = useCallback((tab: "overview" | "issues" | "chat") => {
    if (window.innerWidth <= 899) {
      setMobileAiOpen(true);
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

  // Stores the analyze fn, and nothing else. It used to fire the read here as
  // well; firing belongs to the effect above, which is the single trigger.
  // Registration happens more than once anyway — the effect that publishes this
  // re-runs whenever handleAnalyze's identity changes — so it is the wrong place
  // to decide that a read should start.
  const mobileSheetAiRef = useCallback((fn: (() => void) | null) => {
    mobileSheetAnalyzeFn.current = fn;
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


  // Bring the newly-opened accordion tool into view, parked just below the
  // sticky head. Clicking a header is usually a no-op (it's already visible);
  // this mainly handles tool changes from hotkeys or the command palette,
  // where the target row may be off-screen. Skip the very first run so the
  // panel opens at the top of the list (showing every group) rather than
  // jumping down to whichever tool was last open.
  const toolScrollDidMount = useRef(false);
  useEffect(() => {
    if (!toolScrollDidMount.current) {
      toolScrollDidMount.current = true;
      return;
    }
    const body = toolsScrollBodyRef.current;
    if (!body) return;
    // Wait a frame so the expanded body has laid out before we measure.
    const id = requestAnimationFrame(() => {
      const header = body.querySelector<HTMLElement>(
        '.tool-accordion-header[aria-expanded="true"]',
      );
      if (!header) return;
      const stickyHead = body.querySelector<HTMLElement>(".tools-sticky-head");
      const offset = (stickyHead?.offsetHeight ?? 0) + 8;
      const headerRect = header.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const delta = headerRect.top - bodyRect.top - offset;
      // Only scroll when the header is clipped by the sticky head or sits below
      // the fold — keeps clicks on already-visible rows from jumping.
      if (delta < 0 || headerRect.top > bodyRect.bottom - 48) {
        body.scrollTo({ top: body.scrollTop + delta, behavior: "smooth" });
      }
    });
    return () => cancelAnimationFrame(id);
  }, [activeTool]);

  // Drive the tools column width: collapsed → its own resizable icon-rail width,
  // expanded → the resizable full-panel width. Both are independent of the left
  // rail, so resizing the left panel never reshapes this one. --tools-col is a
  // registered @property, so the switch animates smoothly.
  useEffect(() => {
    const grid = workshopGridRef.current;
    if (!grid) return;
    grid.style.setProperty(
      "--tools-col",
      `${toolsExpanded ? toolsPanelWidth : toolsRailWidth}px`,
    );
  }, [toolsExpanded, toolsPanelWidth, toolsRailWidth, workshopGridRef]);

  // Center each resize handle's drag bar on its own sticky panel (rail /
  // tools), not on the gutter's full scroll-height box. The bar shares the
  // panel's own `top: 1.15rem` sticky offset (see CSS), so it engages/
  // disengages "stuck" in lockstep with the panel purely via the compositor
  // — no scroll listener needed. This effect only supplies --bar-center
  // (half the panel's height), which shifts the bar down from that shared
  // offset to the panel's actual center; it's recomputed on layout changes,
  // not on scroll.
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const toolsPanel = toolsPanelRef.current;
      const toolsGutter = toolsGutterRef.current;
      if (toolsPanel && toolsGutter) {
        toolsGutter.style.setProperty("--bar-center", `${Math.round(toolsPanel.offsetHeight / 2)}px`);
      }
      const railPanel = railPanelRef.current;
      const railGutter = railGutterRef.current;
      if (railPanel && railGutter) {
        railGutter.style.setProperty("--bar-center", `${Math.round(railPanel.offsetHeight / 2)}px`);
      }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("resize", schedule);
    return () => { window.removeEventListener("resize", schedule); if (raf) cancelAnimationFrame(raf); };
  }, [toolsExpanded, m.toolTab, toolsPanelWidth, toolsRailWidth, railWidth, isReadingMode]);


  // When rhyme tab opens, surface the rhyme scheme column at the top of the
  // editor instead of showing labels inside the editor's left gutter.
  // Remember the prior state so we can restore it when leaving the tab if
  // the user had the quick-toggle off before we forced it on.
  const rhymeSchemePrevRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (activeTool === "rhyme") {
      setShowRhymeScheme((prev) => {
        if (rhymeSchemePrevRef.current === null) rhymeSchemePrevRef.current = prev;
        return true;
      });
    } else if (rhymeSchemePrevRef.current !== null) {
      const wasOnBefore = rhymeSchemePrevRef.current;
      rhymeSchemePrevRef.current = null;
      if (!wasOnBefore) setShowRhymeScheme(false);
    }
  }, [activeTool]);

  // (Panel scroll positions used to be saved and restored around the mobile
  // write/tools tab switch. The sheet is now always on screen and simply resizes,
  // so neither panel is ever unmounted or slid away and both keep their own
  // scroll position for free.)

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
    setIsShareOpen,
    setIsStatsOpen,
    setIsTemplatesOpen,
    setToolTab: openToolTab,
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
    // Store the clamped expanded width, but don't write --tools-col here — the
    // width effect owns that var (so it can show the collapsed rail width until
    // a tool is opened, and animate between the two).
    setToolsPanelWidth(safeTools);
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
      spell +
      aiVisibleIssues.length
    );
  }, [
    checklistOpenCount,
    m.goalEvaluation.warnings.length,
    m.spellHits.length,
    m.wordlist,
    aiVisibleIssues.length,
  ]);

  // "Strong fit" mirrors MeterPanel's own meter-fit-high threshold (>=70%) — a
  // couple of incidental iambic feet in free verse shouldn't light this up.
  const meterHasStrongFit = useMemo(() => {
    const scored = m.meterHints.filter((r) => r.iambicFitPercent != null);
    if (scored.length === 0) return false;
    const strong = scored.filter((r) => (r.iambicFitPercent ?? 0) >= 70).length;
    return strong >= 3 && strong / scored.length >= 0.5;
  }, [m.meterHints]);

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

  // How many books stand on one plank. Measured from the scroller rather than
  // the viewport, because the library is a centered modal on desktop and a
  // full-width sheet on phones — the same viewport gives two different shelves.
  const [libraryCols, setLibraryCols] = useState(2);
  const libraryHasRows = libraryListRows.length > 0;
  useEffect(() => {
    if (!isLibraryOpen || !libraryHasRows) return;
    const el = libraryListParentRef.current;
    if (!el) return;
    const apply = (w: number) => {
      // Below ~300px a second book would leave its card too narrow to read.
      const next = w >= 300 ? 2 : 1;
      setLibraryCols((prev) => (prev === next ? prev : next));
    };
    apply(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) apply(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isLibraryOpen, libraryHasRows]);

  const libraryShelves = useMemo(() => {
    const shelves: LibraryRow[][] = [];
    for (let i = 0; i < libraryListRows.length; i += libraryCols) {
      shelves.push(libraryListRows.slice(i, i + libraryCols));
    }
    return shelves;
  }, [libraryListRows, libraryCols]);

  const libraryVirtualizer = useVirtualizer({
    count: libraryShelves.length,
    getScrollElement: () => libraryListParentRef.current,
    estimateSize: () => 168,
    overscan: 2,
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
      const last = libraryListRows.length - 1;
      // Left/right walk along a shelf; up/down step a whole shelf at a time.
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setLibraryActiveIdx((i) => Math.min(i + 1, last));
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setLibraryActiveIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setLibraryActiveIdx((i) => Math.min(i + libraryCols, last));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setLibraryActiveIdx((i) => Math.max(i - libraryCols, 0));
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
  }, [isLibraryOpen, libraryActiveIdx, libraryListRows, libraryCols, m]);

  useEffect(() => {
    if (!isLibraryOpen) return;
    try {
      // The virtualizer indexes shelves, the selection indexes books.
      libraryVirtualizer.scrollToIndex(Math.floor(libraryActiveIdx / libraryCols), {
        align: "auto",
      });
    } catch {
      /* ignore */
    }
  }, [isLibraryOpen, libraryActiveIdx, libraryCols, libraryVirtualizer]);

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
        keywords: "background scene theme paper night forest dawn wallpaper",
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
        run: () => { openToolTab("snapshots"); m.saveSnapshot(); },
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
      ...toolTabActions({ openToolTab }),
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
          openToolTab("lines");
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
  }, [focusPoemTitle, hoverHintsEnabled, isFocusMode, m, openToolTab, setHoverHintsEnabled]);

  // The active tool's panel. Rendered once, inside whichever accordion row is
  // open (m.toolTab is the single source of truth for which row is expanded).
  const toolPanelsEl = (
    <Suspense
      fallback={
        /* Says what it is doing. This was an empty 4rem box, so on a phone —
           where the panels chunk is ~124KB over mobile data and the word list
           and stress dictionary are another 3.5MB behind it — opening a tool
           showed blank space for as long as the download took, and the tools
           read as broken rather than pending. */
        <div className="tools-loading-fallback" role="status">
          <span className="tools-loading-dot" aria-hidden />
          <span>Loading tools…</span>
        </div>
      }
    >
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
        aiIssues={aiVisibleIssues}
        aiDismissedIssues={aiDismissedIssues}
        onAiApply={ribbonApply}
        onAiIgnore={ribbonIgnore}
        onAiRestore={ribbonRestore}
        wordlist={m.wordlist}
        wordlistErr={m.wordlistErr}
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
        onOpenToolTab={openToolTab}
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
  );

  // Vertical accordion list of tools (right panel), grouped by bucket. One row
  // is expanded at a time — m.toolTab. Clicking a header opens that tool.
  const toolDot = (id: string) => {
    if (id === "issues" && issuesQueueCount > 0)
      return <span className="tool-accordion-dot" aria-label="items in queue" />;
    if (id === "spell" && m.wordlist && m.spellHits.length > 0)
      return <span className="tool-accordion-dot" aria-label={`${m.spellHits.length} spelling flags`} />;
    if (id === "goals" && m.goalEvaluation.warnings.length > 0)
      return <span className="tool-accordion-dot" aria-label="plans not met" />;
    if (id === "rhyme" && m.stanzaRhymeGroups.some((g) => g.clusters.length > 0))
      return <span className="tool-accordion-dot" aria-label="rhymes found in your poem" />;
    if (id === "meter" && meterHasStrongFit)
      return <span className="tool-accordion-dot" aria-label="a strong metrical pattern detected" />;
    return null;
  };
  const toolAccordion = (
    <div className="tool-accordion" role="tablist" aria-label="Writing tools" aria-orientation="vertical" data-tour-id="tool-buckets">
      {TOOL_BUCKET_ORDER.map((bucket) => (
        <div className="tool-accordion-group" key={bucket}>
          <div className="tool-accordion-group-label">{TOOL_BUCKET_LABEL[bucket]}</div>
          {tabsForBucket(bucket).map((id) => {
            const meta = TOOL_TABS.find((t) => t.id === id);
            if (!meta) return null;
            const Icon = meta.Icon;
            const active = activeTool === id;
            return (
              <div className={`tool-accordion-item ${active ? "is-open" : ""}`} key={id}>
                <button
                  type="button"
                  role="tab"
                  id={`tool-acc-${id}`}
                  aria-selected={active}
                  aria-expanded={active}
                  aria-controls={`tool-panel-${id}`}
                  className="tool-accordion-header"
                  onClick={() => toggleToolTab(id)}
                  title={meta.desc}
                >
                  <span className="tool-accordion-icon" aria-hidden>
                    <Icon />
                  </span>
                  <span className="tool-accordion-label">{meta.label}</span>
                  {toolDot(id)}
                  <span className="tool-accordion-chevron" aria-hidden>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
                      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>
                {active && (
                  <div
                    className="tool-accordion-body"
                    id={`tool-panel-${id}`}
                    role="region"
                    aria-labelledby={`tool-acc-${id}`}
                  >
                    {toolPanelsEl}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );

  return (
    <div
      className={`poem-workshop ${isFocusMode ? "is-focus-mode" : ""}${
        sheetIsExpanded ? " has-sheet-expanded" : ""
      }`}
      data-tool-tab={activeTool ?? undefined}
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

      {/* On a phone the onboarding hint yields to anything more urgent — it stacked
          with the backup reminder and the two together filled ~40% of the viewport.
          It is not dismissed, just deferred: it returns once the banner is cleared. */}
      {!(isNarrow && hasBlockingBanner(m)) && (
        <FirstVisitHint
          onOpenGuide={() => setIsGuideOpen(true)}
          onSuggest={() => openToolTab("suggest")}
        />
      )}

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
        libraryShelves={libraryShelves}
        libraryCols={libraryCols}
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
          else if (item.openToolTab) openToolTab(item.openToolTab);
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
              <label
                className="appearance-hints-toggle"
                {...hint('Show a "Define" button when you select a word.')}
              >
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
                </span>
              </label>
              <label
                className="appearance-hints-toggle"
                {...hint("Show button tooltips on hover (hover devices only).")}
              >
                <input
                  type="checkbox"
                  checked={hoverHintsEnabled}
                  onChange={(e) => setHoverHintsEnabled(e.target.checked)}
                />
                <span className="appearance-hints-text">
                  <span className="appearance-hints-title">Hover hints</span>
                </span>
              </label>
              <label
                className="appearance-hints-toggle"
                {...hint(
                  "Fetch all panels (backgrounds, AI, reading mode, share, export) right after startup " +
                  "so they keep working if you lose internet. Uses a bit more data on first load.",
                )}
              >
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
            {/* Motion toggle is desktop-only. Touch devices force every backdrop
                animation off for battery/jank reasons (see the `(hover: none)`
                block in index.css), so on a phone the switch controlled nothing
                that could be seen — a setting that only ever lies. */}
            {!isNarrow && (
              <BackdropMotionToggle appearance={appearance} onChange={setAppearance} />
            )}
            <Suspense fallback={<p className="muted small" style={{ padding: "1rem" }}>Loading…</p>}>
              <BackgroundPicker
                appearance={appearance}
                background={appearance.background}
                onChange={setAppearance}
              />
            </Suspense>
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
      {tabletToolsOpen && (
        <div className="tablet-tools-scrim" aria-hidden onClick={() => setTabletToolsOpen(false)} />
      )}

      {/* Mobile sheet scrim. Transparent and click-through until the sheet is
          dragged far enough up to be the thing you're working in; tapping it then
          drops the sheet back to its peek. */}
      <div
        className={`mobile-sheet-scrim${sheetIsProminent ? " mobile-sheet-scrim-strong" : ""}`}
        aria-hidden
        onClick={collapseSheet}
      />

      <main
        id="workshop-main"
        className={`workshop-grid ${toolsExpanded ? "" : "tools-rail"} tools-rail-labels ${toolsAnimReady ? "tools-anim" : ""}`}
        ref={workshopGridRef}
        data-mobile-view="tools"
        data-tools-open={tabletToolsOpen ? "true" : "false"}
        aria-label="Poetry workshop"
        /* No swipe gesture here. It used to page between the write and tools
           tabs, and only reached the library from the tools tab — a narrow enough
           condition that stray swipes rarely matched. With tabs gone that guard
           went too, leaving "any leftward swipe anywhere in the workshop opens the
           library", which fired on text selection and on flicks over the poem.
           Library is a topbar button now, so the gesture bought nothing and is
           removed rather than re-tuned. */
      >
        <nav ref={railPanelRef} className={`workshop-rail ${isFocusMode ? "is-hidden" : ""}`} aria-label="Workshop shortcuts">
          {/* Tablet-only tools drawer toggle */}
          <button
            type="button"
            className="rail-btn tablet-tools-toggle"
            onClick={() => setTabletToolsOpen((v) => !v)}
            aria-label={tabletToolsOpen ? "Close tools" : "Open tools"}
            aria-expanded={tabletToolsOpen}
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
              {/* Desktop floats the score at the top-right of the editor. On a
                  phone it takes the Analyse button's place on the title row
                  instead (see the title row below) — there is no room beside it,
                  and the two were saying the same thing anyway. */}
              {aiResult && !isNarrow && (
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
              {/* The title is one small always-present field. It used to have three
                  states — collapsed bar, expanded grid, fully hidden with a peek
                  button — plus the toggles between them, which was a lot of
                  machinery and screen furniture for an optional one-line input.
                  Made small enough that it costs less than the controls did. */}
              <div className="editor-meta-grid" aria-label="Draft metadata">
                <div className="row title-row">
                  {/* Label is visually hidden rather than dropped — the field still
                      needs a name for screen readers, and the placeholder carries
                      it for everyone else. */}
                  <label htmlFor="poem-title" className="sr-only">Title</label>
                  <input
                    id="poem-title"
                    type="text"
                    value={m.title}
                    onChange={(e) => m.setTitle(e.target.value)}
                    placeholder="Title"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {/* Aa and Analyse share the title's line on phones. They used to
                      sit on a second row alongside a "Poem" label that named the
                      obvious — three rows of furniture above the poem, now one. */}
                  <button
                    type="button"
                    className={`mobile-toolbar-toggle ${mobileToolbarOpen ? "is-open" : ""}`}
                    onClick={() => setMobileToolbarOpen((v) => !v)}
                    aria-label={mobileToolbarOpen ? "Hide formatting options" : "Show formatting options"}
                    aria-expanded={mobileToolbarOpen}
                  >
                    Aa
                  </button>
                  {/* Once there's a score, it stands in for Analyse in the same
                      slot and at the same size — a phone row has space for one
                      of the two, and the pill is the more useful one: it carries
                      the number and opens the read that produced it. Re-running
                      lives on Refine, inside that sheet. */}
                  {aiResult && isNarrow ? (
                    <div className="editor-score-slot">
                      <AiSummaryPopover
                        result={aiResult}
                        scoringEnabled={aiScoringEnabled}
                        onJumpToLine={m.goToLine}
                        onOpenTab={openAiTab}
                        visibleIssueCount={aiVisibleIssues.length}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={`editor-analyse-btn${mobileIsAnalyzing ? " is-busy" : ""}`}
                      onClick={() => {
                        if (mobileAiOpen) {
                          mobileSheetAnalyzeFn.current?.();
                        } else {
                          mobileSheetAutoTrigger.current = true;
                          setMobileAiOpen(true);
                        }
                      }}
                      disabled={mobileIsAnalyzing}
                      aria-label="Analyse poem with AI"
                      {...hint("Run AI analysis on this poem")}
                    >
                      <span aria-hidden>✦</span>
                      <span className="editor-analyse-label">Analyse</span>
                    </button>
                  )}
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
                  {/* The "Poem" label and the Aa toggle moved up to the title row;
                      what's left here is the format toolbar it reveals. */}
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
                    <div className="poem-editor-body-wrap" style={{ position: "relative" }} onClick={handleEditorBodyClick}>
                    <PoemBodyEditor
                      id="poem-body"
                      aria-describedby="poem-body-hint"
                      value={m.body}
                      bodySyncNonce={m.bodySyncNonce}
                      onLiveBody={m.onEditorBody}
                      editorViewRef={m.editorViewRef}
                      wordlist={m.wordlist}
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
                      onLiveLineCount={(lineCount, hasText) => {
                        setLiveLineCount(lineCount);
                        setLiveHasText(hasText);
                      }}
                      onApplyRewriteAtCursor={handleApplyRewriteAtCursor}
                      wordHighlights={wordHighlights}
                      rhymeEndHighlights={rhymeEndHighlights}
                      internalRhymes={activeTool === "rhyme" ? m.internalRhymes : undefined}
                      repeatHighlights={repeatHighlights}
                      echoHighlights={activeTool === "echoes" ? echoHighlights ?? undefined : undefined}
                      lineVowelTints={activeTool === "echoes" ? lineVowelTints ?? undefined : undefined}
                      flowMarkers={activeTool === "echoes" ? flowMarkers ?? undefined : undefined}
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
                    <EditorEndOfTextLine lineCount={liveLineCount} visible={liveHasText} />
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
                <div className="editor-goal-strip" aria-label="Plan progress">
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

        </section>

        {/* Rail resize gutter */}
        {!isReadingMode && (
          <div
            ref={railGutterRef}
            className="rail-resize-gutter"
            onPointerDown={handleRailResizeStart}
            onDoubleClick={() => { applyRailW(DEFAULT_RAIL_W); saveRailW(DEFAULT_RAIL_W); }}
            aria-hidden
            title="Drag to resize · double-click to reset"
          />
        )}

        {/* Tools resize gutter — resizes the collapsed icon-rail or the expanded
            panel, whichever is showing (like the left rail). */}
        {!isReadingMode && (
          <div
            ref={toolsGutterRef}
            className="tools-resize-gutter"
            onPointerDown={toolsExpanded ? handleResizeStart : handleToolsRailResizeStart}
            onDoubleClick={() => { applyToolsW(DEFAULT_TOOLS_W); saveToolsW(DEFAULT_TOOLS_W); }}
            aria-hidden
            title="Drag to resize · double-click to reset"
          />
        )}

        {/* Stowed handle. Replaces the old ✕: dragging or flicking the sheet all
            the way down slides it off and leaves only this. Sits inset from the
            bottom-right corner rather than spanning the edge, so it is nowhere
            near Android's back/home gesture strip — the sheet can be got rid of
            without the gesture that does it also risking leaving the page. */}
        {sheetIsStowed && (
          <button
            type="button"
            className="tools-stow-tab"
            onClick={openSheet}
            aria-label="Show tools"
          >
            <span className="tools-stow-tab-chevron" aria-hidden>⌃</span>
            <span className="tools-stow-tab-label">Tools</span>
          </button>
        )}

        {/* Copy goes down with the sheet. Its only home on a phone is the sheet
            header, so stowing the sheet took the action off screen at exactly
            the moment the poem is the only thing left on it. */}
        {sheetIsStowed && (
          <button
            type="button"
            className={`tools-copy-btn tools-copy-stowed${m.quickCopyFlash ? " is-copied" : ""}`}
            onClick={() => void m.onQuickCopyPlain()}
            aria-label="Copy poem body as plain text"
          >
            {m.quickCopyFlash ? (
              <span className="tools-copy-label">Copied</span>
            ) : (
              <>
                <svg className="tools-copy-icon" viewBox="0 0 24 24" aria-hidden>
                  <path
                    fill="none" stroke="currentColor" strokeWidth="1.75"
                    strokeLinecap="round" strokeLinejoin="round"
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                </svg>
                <span className="tools-copy-label">Copy</span>
              </>
            )}
          </button>
        )}

        <div className="tools-panel-cell">
        <aside
          ref={toolsPanelRef}
          className={`tools-panel ${isFocusMode ? "is-collapsed" : ""}${sheetIsStowed ? " is-stowed" : ""}`}
          aria-label="Tools"
          id="writing-tools"
          data-tour-id="tools-panel"
        >
          <div className="tools-scroll-body" ref={toolsScrollBodyRef}>
          {/* The WHOLE header is the drag surface, not just the pill. A 28px
              grabber is a hard target on a phone — dragging the sheet back down
              was the part that felt fiddliest. handleSheetDragStart ignores
              gestures that begin on a button so Copy/Analyse still tap normally. */}
          <div
            className="tools-sticky-head"
            onPointerDown={handleSheetDragStart}
            onPointerMove={handleSheetDragMove}
            onPointerUp={handleSheetDragEnd}
            onPointerCancel={handleSheetDragEnd}
          >
            <div className="tools-swipe-handle" role="separator" aria-label="Drag to resize tools panel" />
            <div className="tools-head-row tools-head-row-simple">
              <h2 className="tools-heading">Tools</h2>
              <div className="tools-head-actions">
                {/* Copy lives here on phones. In the editor it sat below the poem,
                    which on a small screen meant scrolling past the whole draft to
                    reach it; the tools header is always on screen. */}
                <button
                  type="button"
                  className={`tools-copy-btn${m.quickCopyFlash ? " is-copied" : ""}`}
                  onClick={() => void m.onQuickCopyPlain()}
                  aria-label="Copy poem body as plain text"
                  {...hint("Copy poem body as plain text (no title or form)")}
                >
                  {m.quickCopyFlash ? (
                    <span className="tools-copy-label">Copied</span>
                  ) : (
                    <>
                      <svg className="tools-copy-icon" viewBox="0 0 24 24" aria-hidden>
                        <path
                          fill="none" stroke="currentColor" strokeWidth="1.75"
                          strokeLinecap="round" strokeLinejoin="round"
                          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                        />
                      </svg>
                      <span className="tools-copy-label">Copy</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="tools-analyse-btn"
                  onClick={() => {
                    if (window.innerWidth <= 899) {
                      // Mobile: open the analysis sheet.
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
                  <span className="tools-analyse-icon" aria-hidden>✦</span>
                  <span className="tools-analyse-label">Analyse</span>
                </button>
              </div>
            </div>
          </div>

          {toolAccordion}

          {/* Hint shown while the poem is still blank and the tools have nothing to say */}
          {!m.lines.some((l) => l.trim()) && (
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
        </div>

        {/* AI Analysis — second row of the workshop grid, spans editor+tools columns so the rail can stay beside it on desktop. Hidden on mobile (results flow into the Issues tab). */}
        <Suspense fallback={null}>
          <AiAnalysis
            key={m.activePoemId}
            poemId={m.activePoemId}
            title={m.title}
            lines={m.lines}            localAnalysis={localAnalysis}
            getToolStats={getToolStats}
            onOpenTool={openToolTab}
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

      {/* The mobile bottom tab bar (Write / Tools / Library / Analyse) is gone.
          Tools is the peeking sheet itself, Library and Analyse moved up into the
          topbar, and Write was only ever "not the other three" — so the bar cost
          ~58px of permanent vertical space to switch between things that are now
          all reachable without it. */}

      {/* Mobile AI analysis bottom sheet. Rendered from the first open onward and
          hidden when closed, not unmounted — see mobileAiEverOpened above. */}
      {mobileAiEverOpened && (
        <div
          className={`mobile-ai-sheet${mobileAiOpen ? "" : " is-hidden"}`}
          role="dialog"
          aria-label="AI Analysis"
          aria-hidden={!mobileAiOpen}
        >
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
                  lines={m.lines}                  localAnalysis={localAnalysis}
                  getToolStats={getToolStats}
                  onOpenTool={(tool) => { openToolTab(tool); setMobileAiOpen(false); }}
                  goals={m.goals}
                  onJumpToLine={(line) => { m.goToLine(line); setMobileAiOpen(false); }}
                  onJumpToWord={(line, phrase) => { m.goToWordStart(line, phrase); setMobileAiOpen(false); }}
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
        onShareSaveAs={(format) => {
          // Same handlers the Export modal uses — one implementation of each
          // format, reachable from both places.
          if (format === "txt") m.onDownloadTxt();
          else if (format === "md") m.onDownloadMd();
          else if (format === "docx") void m.onDownloadDocx();
          else if (format === "pdf") void m.onDownloadPdf();
          else if (format === "html") void m.onDownloadHtml();
          else if (format === "png") void m.onDownloadPng();
        }}
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
              This app collects no analytics and requires no account. Drafts, snapshots,
              and settings are stored solely in this browser's <code>localStorage</code> and
              are never transmitted to a server during normal editing.
            </p>
            <p>
              Using the optional AI analysis sends the poem text to the configured AI
              provider for that request only. Exporting or copying content sends it
              wherever you direct it, so please review that destination's own privacy terms.
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
          <div className="privacy-actions">
            <button
              type="button"
              className="topbar-ghost-btn"
              onClick={() => setIsGuideOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={isGuideOpen}
              aria-label="Open guide"
              {...hint("Guide — how to use easywriting-poem")}
            >
              <svg className="topbar-ghost-icon" viewBox="0 0 24 24" aria-hidden focusable="false">
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.75" />
                <path d="M12 17v-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M12 13.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5v1" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              className="topbar-ghost-btn"
              onClick={() => setIsStyleOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={isStyleOpen}
              aria-label="Open style"
              {...hint("Style — fonts and typography")}
            >
              <svg className="topbar-ghost-icon" viewBox="0 0 24 24" aria-hidden focusable="false">
                <path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" d="M4 19l5-13 5 13M6 14h6" />
                <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" d="M17 19v-5.5a2.5 2.5 0 0 1 5 0V19M15.5 16h4" />
              </svg>
            </button>
            <button
              type="button"
              className="topbar-ghost-btn"
              onClick={() => setIsLibraryOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={isLibraryOpen}
              aria-label="Open library"
              {...hint("Library — manage drafts")}
            >
              <svg className="topbar-ghost-icon" viewBox="0 0 24 24" aria-hidden focusable="false">
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
            </button>
            <FeedbackWidget />
          </div>
        </div>
      </footer>
    </div>
  );
}
