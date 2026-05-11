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
import { BackdropFormFields } from "@/workshop/appearance/BackdropFormFields";
import { BackgroundPicker } from "@/workshop/appearance/BackgroundPicker";
import { FirstVisitHint } from "./FirstVisitHint";
import { SamplePoemBanner } from "./SamplePoemBanner";
import { RhymeTooltip } from "./RhymeTooltip";
import { FeedbackWidget } from "./FeedbackWidget";
import { PoemBodyEditor } from "@/workshop/editor/PoemBodyEditor";
import { TOOL_TABS } from "@/workshop/analysis/ToolTabBar";
import { useToolTabListKeyboard } from "@/workshop/analysis/useToolTabListKeyboard";
import { useWorkshopToolHotkeys } from "@/workshop/analysis/useWorkshopToolHotkeys";
// Lazy-load the full tools panel — it pulls in all tool components (rhyme, syllables,
// spell, stats, suggest, etc.) which would otherwise inflate the critical-path bundle.
const WorkshopToolPanels = lazy(() =>
  import("@/workshop/analysis/WorkshopToolPanels").then((m) => ({ default: m.WorkshopToolPanels }))
);
import type { DraftMeta } from "@/workshop/library/library-meta";
import type { PoemRecord } from "@/workshop/library/local-draft-library";
import { usePoemWorkshopModel } from "./usePoemWorkshopModel";
import { FORM_PRESETS } from "@/workshop/library/workshop-goals";
import { AiAnalysis, loadLastAnalysis, loadIgnoredIssueIds } from "@/workshop/analysis/AiAnalysis";
import { recordWriteToday } from "@/workshop/shell/writing-streak";
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
import type { RevisionSnapshot } from "@/workshop/library/revision-snapshots";
import {
  TOOL_BUCKET_LABEL,
  TOOL_BUCKET_ORDER,
  defaultTabForBucket,
  formatRelativeSnapshotWhen,
  tabsForBucket,
  toolTabBucket,
} from "./workshop-helpers";
import { STORAGE_KEY_SHOW_LINE_SYLLABLES, STORAGE_KEY_SHOW_RHYME_SCHEME, STORAGE_KEY_RHYME_SCHEME_BREADTH, STORAGE_KEY_WORD_LOOKUP_ENABLED, STORAGE_KEY_TABS_EXPANDED, STORAGE_KEY_TOOLS_WIDTH, STORAGE_KEY_RAIL_WIDTH } from "@/shared/storage-keys";
import { InlineRhymeHint } from "@/workshop/editor/InlineRhymeHint";
import { MobileActionBar, type MobileTab } from "./MobileActionBar";
import { WorkshopModals } from "./WorkshopModals";
import { WorkshopBanners } from "./WorkshopBanners";
import { WorkshopTopbarHeader } from "./WorkshopTopbarHeader";
import { WorkshopLibraryModal } from "./WorkshopLibraryModal";
import { endingForBreadth, type RhymeBreadth } from "@/workshop/analysis/rhyme-scheme";
import { useIgnoredRhymes, useManualRhymeLinks, useManualRhymeUnlinks } from "@/workshop/rhyme/rhyme-storage";
import { KeyboardShortcutsContent } from "./KeyboardShortcutsContent";
import { SpotlightTour } from "@/workshop/tour/SpotlightTour";
import {
  useHoverHintBinder,
  useHoverHintsSettings,
} from "@/workshop/hints/HoverHintsContext";
import "./PoemWorkshop.css";
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
  const m = usePoemWorkshopModel(rhymeBreadth, manualRhymeLinks.links, manualRhymeUnlinks.unlinks);
  const bucketTabs = tabsForBucket(toolTabBucket(m.toolTab));
  const onToolTabKeyDown = useToolTabListKeyboard(
    m.toolTab,
    m.setToolTab,
    bucketTabs,
  );
  useWorkshopToolHotkeys(m.toolTab, m.setToolTab);

  // Record a writing streak once per mount when the poem body has substantive
  // content. Idempotent within the calendar day — costs nothing if already
  // recorded today. Local-only, no analytics.
  const streakRecordedRef = useRef(false);
  useEffect(() => {
    if (streakRecordedRef.current) return;
    if (m.body.trim().length < 15) return;
    streakRecordedRef.current = true;
    recordWriteToday();
  }, [m.body]);

  const [mainIdea, setMainIdea] = useState(() => {
    try { return localStorage.getItem("easy-poems:main-idea") ?? ""; } catch { return ""; }
  });
  const saveMainIdea = (v: string) => {
    setMainIdea(v);
    try {
      if (v.trim()) localStorage.setItem("easy-poems:main-idea", v);
      else localStorage.removeItem("easy-poems:main-idea");
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
  const sheetDragRef = useRef<{ pointerId: number; startY: number; startSnap: "half" | "full"; currentY: number } | null>(null);
  const [topbarOverflowOpen, setTopbarOverflowOpen] = useState(false);
  const overflowMenuRef = useRef<HTMLDivElement | null>(null);
  const [allTabsExpanded, setAllTabsExpanded] = useState(() => {
    try { return !!localStorage.getItem(STORAGE_KEY_TABS_EXPANDED); } catch { return false; }
  });
  const expandAllTabs = () => {
    try { localStorage.setItem(STORAGE_KEY_TABS_EXPANDED, "1"); } catch { /* ignore */ }
    setAllTabsExpanded(true);
  };

  const DEFAULT_TOOLS_W = 380;
  const DEFAULT_RAIL_W  = 64;
  const SNAP_PX = 36; // snap to 0 when dragged this narrow

  const [toolsPanelWidth, setToolsPanelWidth] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem(STORAGE_KEY_TOOLS_WIDTH) ?? "", 10);
      if (v >= 0 && v <= 1200) return v;
    } catch { /* ignore */ }
    return DEFAULT_TOOLS_W;
  });

  const [railWidth, setRailWidth] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem(STORAGE_KEY_RAIL_WIDTH) ?? "", 10);
      if (v >= 0 && v <= 320) return v;
    } catch { /* ignore */ }
    return DEFAULT_RAIL_W;
  });

  const applyToolsW = useCallback((w: number) => {
    const el = workshopGridRef.current;
    if (!el) return;
    el.style.setProperty("--tools-col", `${w}px`);
    el.classList.toggle("tools-collapsed", w === 0);
    setToolsPanelWidth(w);
  }, []);

  const applyRailW = useCallback((w: number) => {
    const el = workshopGridRef.current;
    if (!el) return;
    el.style.setProperty("--rail-col", `${w}px`);
    el.classList.toggle("rail-collapsed", w === 0);
    setRailWidth(w);
  }, []);

  const saveToolsW = useCallback((w: number) => {
    try { localStorage.setItem(STORAGE_KEY_TOOLS_WIDTH, String(w)); } catch { /* ignore */ }
  }, []);

  const saveRailW = useCallback((w: number) => {
    try { localStorage.setItem(STORAGE_KEY_RAIL_WIDTH, String(w)); } catch { /* ignore */ }
  }, []);

  const resetLayout = useCallback(() => {
    applyToolsW(DEFAULT_TOOLS_W);
    applyRailW(DEFAULT_RAIL_W);
    saveToolsW(DEFAULT_TOOLS_W);
    saveRailW(DEFAULT_RAIL_W);
  }, [applyToolsW, applyRailW, saveToolsW, saveRailW]);

  const MIN_EDITOR_W = 240; // minimum editor column width (px)
  const GAP_PX = Math.round(1.55 * parseFloat(getComputedStyle(document.documentElement).fontSize || "16"));

  const handleResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    try { target.setPointerCapture(pointerId); } catch { /* ignore */ }
    const startX = e.clientX;
    const startW = parseInt(workshopGridRef.current?.style.getPropertyValue("--tools-col") || String(DEFAULT_TOOLS_W), 10);
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const raw = startW - (ev.clientX - startX); // drag left → wider
      const currentRail = parseInt(workshopGridRef.current?.style.getPropertyValue("--rail-col") || String(DEFAULT_RAIL_W), 10);
      const maxW = Math.min(
        window.innerWidth - currentRail - MIN_EDITOR_W - GAP_PX * 2,
        window.innerWidth - MIN_EDITOR_W - GAP_PX * 2,
      );
      const next = raw < SNAP_PX ? 0 : Math.max(0, Math.min(maxW, raw));
      applyToolsW(next);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      try { target.releasePointerCapture(pointerId); } catch { /* ignore */ }
      saveToolsW(parseInt(workshopGridRef.current?.style.getPropertyValue("--tools-col") || String(startW), 10));
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }, [applyToolsW, saveToolsW]);

  const handleRailResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    try { target.setPointerCapture(pointerId); } catch { /* ignore */ }
    const startX = e.clientX;
    const startW = parseInt(workshopGridRef.current?.style.getPropertyValue("--rail-col") || String(DEFAULT_RAIL_W), 10);
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const raw = startW + (ev.clientX - startX); // drag right → wider
      const currentTools = parseInt(workshopGridRef.current?.style.getPropertyValue("--tools-col") || String(DEFAULT_TOOLS_W), 10);
      const maxW = window.innerWidth - currentTools - MIN_EDITOR_W - GAP_PX * 2;
      const next = raw < SNAP_PX ? 0 : Math.max(0, Math.min(maxW, raw));
      applyRailW(next);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      try { target.releasePointerCapture(pointerId); } catch { /* ignore */ }
      saveRailW(parseInt(workshopGridRef.current?.style.getPropertyValue("--rail-col") || String(startW), 10));
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }, [applyRailW, saveRailW]);
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

  const [aiResult, setAiResult] = useState<PoemAnalysis | PoemComparison | null>(null);
  const [aiVisibleIssues, setAiVisibleIssues] = useState<AnalysisIssue[]>([]);
  const [aiIgnoredIds, setAiIgnoredIds] = useState<Set<string>>(() => loadIgnoredIssueIds(undefined));
  const aiScoringEnabled = (() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_AI_SCORING_ENABLED);
      return raw !== "0" && raw !== "false";
    } catch { return true; }
  })();

  // Hide topbar when virtual keyboard is open
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handler = () => {
      const open = vv.height < window.innerHeight * 0.78;
      document.documentElement.classList.toggle("vp-keyboard-open", open);
    };
    vv.addEventListener("resize", handler);
    return () => {
      vv.removeEventListener("resize", handler);
      document.documentElement.classList.remove("vp-keyboard-open");
    };
  }, []);

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
  const [cursorLine, setCursorLine] = useState<number>(1);
  const [rhymeFinderQuery, setRhymeFinderQuery] = useState<{ word: string; bump: number; expand?: boolean } | undefined>(undefined);
  const [hoveredRhymeWord, setHoveredRhymeWord] = useState<string | null>(null);
  const rhymeBumpRef = useRef(0);

  const baseRhymeEndHighlights = useMemo(() => {
    if (m.toolTab !== "rhyme") return [] as Array<{ line: number; clusterIdx: number }>;
    const out: Array<{ line: number; clusterIdx: number }> = [];
    let idx = 0;
    for (const group of m.stanzaRhymeGroups) {
      for (const c of group.clusters) {
        const words = c.lineNumbers.map((n) => {
          const ln = m.lines[n - 1] ?? "";
          const mm = ln.match(/[a-zA-Z']+(?=[^a-zA-Z']*$)/);
          return mm ? mm[0] : "";
        });
        if (rhymeIgnored.isIgnored(words)) continue;
        for (const line of c.lineNumbers) out.push({ line, clusterIdx: idx });
        idx++;
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
    // Explicit click on a highlighted end-word — open the panel if collapsed.
    setRhymeFinderQuery({ word, bump: rhymeBumpRef.current, expand: true });
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
    const hoverIdx = baseRhymeEndHighlights.length > 0
      ? Math.max(...baseRhymeEndHighlights.map((h) => h.clusterIdx)) + 1
      : 0;
    const extra: Array<{ line: number; clusterIdx: number }> = [];
    for (let i = 0; i < m.lines.length; i++) {
      if (existing.has(i + 1)) continue;
      const mm = (m.lines[i] ?? "").match(/[a-zA-Z']+(?=[^a-zA-Z']*$)/);
      if (!mm) continue;
      const wn = mm[0].toLowerCase().replace(/[^a-z']/g, "");
      if (wn.length < 2) continue;
      const k = endingForBreadth(wn, rhymeBreadth);
      if (k && k === targetKey) extra.push({ line: i + 1, clusterIdx: hoverIdx });
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
  const [lineFocusMode, setLineFocusMode] = useState(false);
  const sessionStartRef = useRef(Date.now());
  const [sessionWordGoal, setSessionWordGoal] = useState<number | null>(null);
  const [showGoalInput, setShowGoalInput] = useState(false);
  const [goalInputVal, setGoalInputVal] = useState("");
  const workshopGridRef = useRef<HTMLDivElement | null>(null);
  const [appearance, setAppearance] = useState<AppearanceSettings>(() =>
    loadAppearance(),
  );
  const hint = useHoverHintBinder();
  const { enabled: hoverHintsEnabled, setEnabled: setHoverHintsEnabled } =
    useHoverHintsSettings();
  const overlayOpenCountPrev = useRef(0);
  const overlayReturnFocusRef = useRef<HTMLElement | null>(null);
  const toolsPanelRef = useRef<HTMLElement | null>(null);

  const handleSheetDragStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (window.innerWidth > 899) return;
    e.preventDefault();
    const target = e.currentTarget;
    try { target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    sheetDragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startSnap: mobileSheetSnap,
      currentY: e.clientY,
    };
    target.classList.add("is-dragging");
  }, [mobileSheetSnap]);

  const handleSheetDragMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = sheetDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    drag.currentY = e.clientY;
    const dy = e.clientY - drag.startY;
    const panel = toolsPanelRef.current;
    if (!panel) return;
    const vh = window.innerHeight;
    const baseTop = drag.startSnap === "full" ? vh * 0.08 : vh * 0.50;
    const liveTop = Math.max(vh * 0.05, Math.min(vh, baseTop + dy));
    panel.style.setProperty("--sheet-top", `${liveTop}px`);
  }, []);

  const handleSheetDragEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = sheetDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const target = e.currentTarget;
    try { target.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    target.classList.remove("is-dragging");
    sheetDragRef.current = null;
    const dy = drag.currentY - drag.startY;
    const vh = window.innerHeight;
    const baseTop = drag.startSnap === "full" ? vh * 0.08 : vh * 0.50;
    const finalTop = baseTop + dy;
    const panel = toolsPanelRef.current;
    if (panel) panel.style.removeProperty("--sheet-top");
    if (finalTop > vh * 0.78) {
      setMobileToolsExpanded(false);
    } else if (finalTop < vh * 0.25) {
      setMobileSheetSnap("full");
    } else {
      setMobileSheetSnap("half");
    }
  }, []);
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
  useEffect(() => {
    if (m.toolTab === "rhyme") setShowRhymeScheme(true);
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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setIsCmdkOpen(true);
        return;
      }
      if (e.key.toLowerCase() === "f" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setFindMode("find");
        setIsFindOpen(true);
        return;
      }
      if (e.key.toLowerCase() === "h" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setFindMode("replace");
        setIsFindOpen(true);
        return;
      }
      if (e.key.toLowerCase() === "r" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        setIsReadingMode((v) => !v);
        return;
      }
      if (e.key === "Escape") setTopbarOverflowOpen(false);
      if (e.key === "Escape") setIsFocusMode(false);
      if (e.key !== "Escape") return;
      setIsLibraryOpen(false);
      setIsStyleOpen(false);
      setIsBackgroundOpen(false);
      setIsExportOpen(false);
      setIsCmdkOpen(false);
      setIsFindOpen(false);
      setIsShortcutsOpen(false);
      setIsGuideOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "z" && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        setIsFocusMode((v) => !v);
        return;
      }
      if (e.key.toLowerCase() === "g" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        m.setToolTab("lines");
        queueMicrotask(() => document.getElementById("go-line-input")?.focus());
        return;
      }
      if (e.key.toLowerCase() === "s" && (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey) {
        e.preventDefault();
        m.setToolTab("snapshots");
        m.saveSnapshot();
      }
      if (e.key.toLowerCase() === "a" && (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey) {
        e.preventDefault();
        mobileAnalyzeFnRef.current?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [m.saveSnapshot, m.setToolTab]);

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
    <div className={`poem-workshop ${isFocusMode ? "is-focus-mode" : ""}`}>
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

      {isExportOpen ? (
        <div
          className="overlay"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setIsExportOpen(false);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Export poem"
          >
            <div className="modal-head">
              <h2 className="modal-title">Export</h2>
              <button
                type="button"
                className="small-btn"
                onClick={() => setIsExportOpen(false)}
              >
                Close
              </button>
            </div>
            {exportFlash ? (
              <p className="export-flash" role="status" aria-live="polite">
                {exportFlash}
              </p>
            ) : null}
            <div className="modal-actions">
              <button type="button" className="small-btn" onClick={() => { m.onDownloadTxt(); doExportFlash("Downloaded .txt ✓"); }}>
                Download .txt
              </button>
              <button type="button" className="small-btn" onClick={() => { m.onDownloadMd(); doExportFlash("Downloaded .md ✓"); }}>
                Download .md
              </button>
              <button
                type="button"
                className="small-btn small-btn-primary"
                onClick={() => void m.onDownloadDocx().then(() => doExportFlash("Downloaded Word (.docx) ✓"))}
              >
                Download Word (.docx)
              </button>
              <button
                type="button"
                className="small-btn"
                onClick={() => void m.onCopyMarkdown().then(() => doExportFlash("Copied Markdown ✓"))}
                {...hint(
                  "Copy as Markdown: title becomes a heading, form note is italic, each line preserved — handy for Notion, GitHub, blogs, or ChatGPT.",
                )}
              >
                Copy Markdown
              </button>
              <button
                type="button"
                className="small-btn"
                onClick={() => window.print()}
                {...hint("Print or save as PDF via your browser’s print dialog")}
              >
                Print / PDF
              </button>
            </div>
            {m.docxExportErr ? (
              <p className="export-error compact" role="alert">
                {m.docxExportErr}
              </p>
            ) : null}
            <p className="modal-note">
              Export/copy sends text only where you choose—check the destination’s
              terms.
            </p>
            <div className="export-checklist-row">
              <h3 className="export-backup-title">
                Publication checklist
                {checklistOpenCount > 0
                  ? <span className="tool-tab-badge" style={{ marginLeft: 8 }}>{checklistOpenCount}</span>
                  : <span className="export-checklist-done"> ✓ Ready</span>}
              </h3>
              <ul className="checklist checklist-draft">
                {m.publication.items.map((item) => (
                  <li
                    key={item.text}
                    className={`checklist-item ${item.done ? "done" : "open"}${!item.done ? " checklist-item-needs-attn" : ""}`}
                  >
                    <span className="checklist-mark" aria-hidden>{item.done ? "✓" : "○"}</span>
                    <span className="checklist-text">
                      {item.text}
                      {item.detail ? <span className="checklist-detail"> — {item.detail}</span> : null}
                    </span>
                    {!item.done && (item.openToolTab || item.focusTitleField) && (
                      <button
                        type="button"
                        className="small-btn checklist-jump-btn"
                        onClick={() => {
                          setIsExportOpen(false);
                          if (item.focusTitleField) focusPoemTitle();
                          else m.setToolTab(item.openToolTab!);
                        }}
                      >
                        {item.focusTitleField ? "Focus title" : "Go to tool"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div className="export-backup-row">
              <h3 className="export-backup-title">Workshop backup</h3>
              <p className="modal-note">
                Export or import all drafts + snapshots as a single JSON file—useful for switching devices.
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  className="small-btn"
                  onClick={() => { m.exportWorkshopBackup(); doExportFlash("Backup downloaded"); }}
                  {...hint("Download all drafts and snapshots as a JSON backup")}
                >
                  Export backup (.json)
                </button>
                <button
                  type="button"
                  className="small-btn"
                  onClick={m.triggerImportBackup}
                  {...hint("Import a previously exported backup JSON file")}
                >
                  Import backup
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {isShortcutsOpen ? (
        <div
          className="overlay"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setIsShortcutsOpen(false);
          }}
        >
          <section
            className="modal shortcuts-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-modal-title"
          >
            <div className="modal-head">
              <h2 id="shortcuts-modal-title" className="modal-title">
                Keyboard shortcuts
              </h2>
              <button
                type="button"
                className="small-btn"
                onClick={() => setIsShortcutsOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="shortcuts-modal-body">
              <KeyboardShortcutsContent />
            </div>
          </section>
        </div>
      ) : null}

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
              <h2 id="style-modal-title" className="modal-title">Fonts &amp; Typography</h2>
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
                <span>Show "Define" button when selecting a word (requires word lookup service).</span>
              </label>
              <label className="appearance-hints-toggle">
                <input
                  type="checkbox"
                  checked={hoverHintsEnabled}
                  onChange={(e) => setHoverHintsEnabled(e.target.checked)}
                />
                <span>Show button hints on hover (hover devices only).</span>
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
              <h2 id="bg-modal-title" className="modal-title">Page Background</h2>
              <button type="button" className="small-btn" onClick={() => setIsBackgroundOpen(false)}>
                Close
              </button>
            </div>
            <BackgroundPicker
              appearance={appearance}
              background={appearance.background}
              onChange={setAppearance}
            />
            <div className="modal-note">
              <strong>Background settings</strong> (strength + motion + low‑power)
            </div>
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
              <div className={`editor-meta-grid${metaOpen ? "" : " editor-meta-grid-hidden"}${mainIdeaOpen ? "" : " editor-meta-grid-solo"}`} aria-label="Draft metadata">
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
                          Diff vs.&nbsp;
                          <span className="poem-diff-bar-snapshot">
                            {diffSnapshot.label || formatRelativeSnapshotWhen(diffSnapshot.createdAt)}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="poem-diff-bar-exit"
                          onClick={exitDiffSnapshot}
                          title="Exit diff overlay"
                        >Exit diff</button>
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
                      rhymeSchemeLabels={null}
                      cursorLineGetterRef={cursorLineGetterRef}
                      showLineSyllables={showLineSyllables}
                      lineFocusMode={isFocusMode ? (lineFocusMode ? "line" : "stanza") : lineFocusMode}
                      typewriterScroll={isFocusMode}
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
                          <span className="tool-tab-badge" aria-label={`${m.spellHits.length} spelling flags`}>
                            {m.spellHits.length > 9 ? "9+" : m.spellHits.length}
                          </span>
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
            spellHits={m.spellHits}
            wordlist={m.wordlist}
            wordlistErr={m.wordlistErr}
            spellMode={m.spellMode}
            onSpellModeChange={m.setSpellMode}
            goToLine={m.goToLine}
            goToLineEnd={m.goToLineEnd}
            goToSpellHitAt={m.goToSpellHitAt}
            cycleSpellHit={m.cycleSpellHit}
            spellNavIndex={m.spellNavIndex}
            applySpellSuggestion={m.applySpellSuggestion}
            spellBump={m.spellBump}
            refreshSpell={m.refreshSpell}
            onSpellPersistenceError={m.onSpellPersistenceError}
            updateGoal={m.updateGoal}
            setGoalValue={m.setGoalValue}
            toggleGoalSoft={m.toggleGoalSoft}
            applyGoalPreset={m.applyGoalPreset}
            revisions={m.revisions}
            snapshotLabel={m.snapshotLabel}
            onSnapshotLabelChange={m.setSnapshotLabel}
            onSaveSnapshot={m.saveSnapshot}
            snapshotFlash={m.snapshotFlash}
            onRestoreRevision={m.restoreRevision}
            onDeleteRevision={m.deleteRevision}
            onDiffSnapshot={handleDiffSnapshot}
            activeDiffSnapshotId={diffSnapshot?.id ?? null}
            compareLeftId={m.compareLeftId}
            compareRightId={m.compareRightId}
            onCompareLeftChange={m.setCompareLeftId}
            onCompareRightChange={m.setCompareRightId}
            compareViewMode={m.compareViewMode}
            onCompareViewModeChange={m.setCompareViewMode}
            compareSnapshotOptions={m.compareSnapshotOptions}
            compareLeftBody={m.compareLeftBody}
            compareRightBody={m.compareRightBody}
            compareDiffRows={m.compareDiffRows}
            onOpenToolTab={m.setToolTab}
            focusPoemTitle={focusPoemTitle}
            stressLexiconReady={m.stressLexiconReady}
            stressLexiconErr={m.stressLexiconErr}
            heavyToolsStale={m.heavyToolsStale}
            clicheHits={m.clicheHits}
            poemTitle={m.title}
            poemLines={m.lines}
            onInsertSuggestion={m.insertTextAtEnd}
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
      </main>

      {/* AI Analysis — full-width section below the grid on desktop; hidden on mobile (results flow into the Issues tab) */}
      <AiAnalysis
        key={m.activePoemId}
        poemId={m.activePoemId}
        title={m.title}
        lines={m.lines}
        mainIdea={mainIdea}
        localAnalysis={localAnalysis}
        goals={m.goals}
        onJumpToLine={m.goToLine}
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
              <AiAnalysis
                key={`mobile-ai-${m.activePoemId}`}
                poemId={m.activePoemId}
                title={m.title}
                lines={m.lines}
                mainIdea={mainIdea}
                localAnalysis={localAnalysis}
                goals={m.goals}
                onJumpToLine={(line) => { m.goToLine(line); setMobileAiOpen(false); setMobileTab("write"); }}
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
