import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useHoverHintBinder } from "@/workshop/hints/HoverHintsContext";
import { SavedAgo } from "./components/SavedAgo";
import { SessionTimer } from "./components/SessionTimer";
import type { usePoemWorkshopModel } from "./usePoemWorkshopModel";

type Model = ReturnType<typeof usePoemWorkshopModel>;

type Props = {
  m: Model;
  isFocusMode: boolean;
  setIsFocusMode: (v: boolean) => void;
  setIsLibraryOpen: (v: boolean) => void;
  setMobileTab: (v: "write" | "tools" | "library") => void;
  setMetaOpen: (v: boolean) => void;
  showRhymeScheme: boolean;
  isStatsOpen: boolean;
  setIsStatsOpen: Dispatch<SetStateAction<boolean>>;
  statsPopoverRef: MutableRefObject<HTMLDivElement | null>;
  isBackgroundOpen: boolean;
  setIsBackgroundOpen: Dispatch<SetStateAction<boolean>>;
  setFindMode: (v: "find" | "replace") => void;
  setIsFindOpen: (v: boolean) => void;
  topbarOverflowOpen: boolean;
  setTopbarOverflowOpen: Dispatch<SetStateAction<boolean>>;
  overflowMenuRef: MutableRefObject<HTMLDivElement | null>;
  sessionStartRef: MutableRefObject<number>;
  sessionWordGoal: number | null;
  setSessionWordGoal: (v: number | null) => void;
  showGoalInput: boolean;
  setShowGoalInput: (v: boolean) => void;
  goalInputVal: string;
  setGoalInputVal: (v: string) => void;
  setIsReadingMode: (v: boolean) => void;
  setIsShareOpen: (v: boolean) => void;
  setIsExportOpen: (v: boolean) => void;
  setIsCmdkOpen: (v: boolean) => void;
  setIsShortcutsOpen: (v: boolean) => void;
  resetLayout: () => void;
};

export function WorkshopTopbarHeader(props: Props) {
  const {
    m,
    isFocusMode,
    setIsFocusMode,
    setIsLibraryOpen,
    setMobileTab,
    setMetaOpen,
    showRhymeScheme,
    isStatsOpen,
    setIsStatsOpen,
    statsPopoverRef,
    isBackgroundOpen,
    setIsBackgroundOpen,
    setFindMode,
    setIsFindOpen,
    topbarOverflowOpen,
    setTopbarOverflowOpen,
    overflowMenuRef,
    sessionStartRef,
    sessionWordGoal,
    setSessionWordGoal,
    showGoalInput,
    setShowGoalInput,
    goalInputVal,
    setGoalInputVal,
    setIsReadingMode,
    setIsShareOpen,
    setIsExportOpen,
    setIsCmdkOpen,
    setIsShortcutsOpen,
    resetLayout,
  } = props;

  const hint = useHoverHintBinder();

  const topbarLinesHint =
    m.quickDocStats.totalLines !== m.quickDocStats.nonEmptyLines
      ? `${m.quickDocStats.nonEmptyLines} lines with text; ${m.quickDocStats.totalLines} total in editor (includes blanks)`
      : "Lines containing at least one character";

  return (
    <header
      className={`topbar ${isFocusMode ? "is-focus" : ""}`}
      aria-label="Workshop header"
    >
      <div className="topbar-primary topbar-primary-tiered">
        <div className="topbar-cluster topbar-cluster-brand">
          <div className="brand brand-tiered">
            <h1 className="brand-mark">
              <svg
                className="brand-logo-icon"
                viewBox="0 0 24 24"
                aria-hidden
                focusable="false"
              >
                {/* Feather body — vivid accent fill, white stroke for any-bg visibility */}
                <path
                  d="M19 3C19 3 20 8 16 13L13 18L12 21L11 18C9.5 14.5 10 9 16 4C17 3.3 18.2 3 19 3Z"
                  fill="#68aa6e"
                  stroke="white"
                  strokeWidth="0.7"
                  strokeLinejoin="round"
                />
                {/* Quill vein */}
                <path
                  d="M19 3L12 21"
                  stroke="rgba(0,0,0,0.18)"
                  strokeWidth="0.55"
                  strokeLinecap="round"
                  fill="none"
                />
                {/* Nib highlight */}
                <path
                  d="M11 18L12 21"
                  stroke="#c5e0c8"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  fill="none"
                />
                {/* Dark outline for light-background visibility */}
                <path
                  d="M19 3C19 3 20 8 16 13L13 18L12 21L11 18C9.5 14.5 10 9 16 4C17 3.3 18.2 3 19 3Z"
                  fill="none"
                  stroke="rgba(30,60,35,0.22)"
                  strokeWidth="0.8"
                  strokeLinejoin="round"
                />
              </svg>
              easywriting<span className="brand-product-badge">poem</span>
            </h1>
            <div className="topbar-draft-inline">
              <label className="draft-library-label" htmlFor="draft-poem-select">
                Draft
              </label>
              <select
                id="draft-poem-select"
                className="draft-library-select"
                value={m.activePoemId}
                onChange={(e) => m.selectPoem(e.target.value)}
                aria-label="Active draft"
              >
                {m.poemOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                    {o.archived ? " (archived)" : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="topbar-draft-icon-btn"
                onClick={() => m.newPoem()}
                aria-label="New draft"
                {...hint("New draft")}
              >
                +
              </button>
              <button
                type="button"
                className="topbar-draft-icon-btn"
                onClick={() => setIsLibraryOpen(true)}
                aria-label="Open draft library"
                {...hint("Library: manage all your drafts — create, switch, or archive.")}
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden width="14" height="14">
                  <rect x="2" y="3" width="16" height="2.5" rx="1" fill="currentColor"/>
                  <rect x="2" y="8.75" width="16" height="2.5" rx="1" fill="currentColor"/>
                  <rect x="2" y="14.5" width="10" height="2.5" rx="1" fill="currentColor"/>
                </svg>
              </button>
            </div>
          </div>
          <p className="brand-sub">
            {m.library.poems.length > 1
              ? `${m.library.poems.length} drafts saved · private, local, no account`
              : "Private, local, no account"}
          </p>
        </div>

        {/* Mobile-only poem title — centred between brand icon and actions */}
        <button
          type="button"
          className="topbar-mobile-title"
          onClick={() => {
            setMobileTab("write");
            setMetaOpen(true);
            requestAnimationFrame(() => document.getElementById("poem-title")?.focus());
          }}
          aria-label="Edit poem title"
        >
          {m.title.trim() || "Untitled"}
        </button>

        <div
          className="topbar-cluster topbar-cluster-context"
          role="status"
          aria-live="polite"
          aria-label="Draft stats"
        >
          <div className={`topbar-context-stats${isFocusMode ? " topbar-focus-stats" : ""}`}>
            <span
              className={isFocusMode ? "topbar-focus-stat" : "topbar-context-stat"}
              {...hint("Word count in poem body")}
            >
              {m.quickDocStats.totalWords} words
            </span>
            <span className={isFocusMode ? "topbar-focus-sep" : "topbar-context-sep"} aria-hidden>·</span>
            <span
              className={isFocusMode ? "topbar-focus-stat" : "topbar-context-stat"}
              {...hint(topbarLinesHint)}
            >
              {m.quickDocStats.nonEmptyLines} lines
            </span>
            {!isFocusMode && m.quickDocStats.totalLines !== m.quickDocStats.nonEmptyLines ? (
              <span className="topbar-context-hint"> ({m.quickDocStats.totalLines} incl. blanks)</span>
            ) : null}
            {m.lastAiScore != null && (
              <>
                <span className={isFocusMode ? "topbar-focus-sep" : "topbar-context-sep"} aria-hidden>·</span>
                <span
                  className="topbar-ai-score"
                  {...hint(`Last AI analysis score: ${m.lastAiScore}/10`)}
                >
                  ✦ {m.lastAiScore}
                </span>
              </>
            )}
            {showRhymeScheme && m.rhymeScheme.some((l) => l) && (
              <span
                className="topbar-rhyme-dot"
                aria-label="Rhyme scheme active"
                {...hint("Rhyme scheme visible in editor")}
              />
            )}
          </div>
        </div>

        <div className="topbar-cluster topbar-cluster-status" aria-label="Actions and save" data-tour-id="topbar-actions">
          <span className="topbar-saved topbar-saved-quiet" aria-live="polite">
            <span className={`save-dot ${m.savedFlash ? "is-on" : ""}`} aria-hidden />
            <span className="topbar-saved-label">
              {m.savedFlash ? "Saved" : m.lastSavedAt ? <SavedAgo ts={m.lastSavedAt} /> : null}
            </span>
          </span>

          {!isFocusMode ? (
            <>
              {/* Stats popover */}
              <div className="topbar-stats-wrap" ref={statsPopoverRef}>
                <button
                  type="button"
                  className={`topbar-ghost-btn topbar-stats-btn${isStatsOpen ? " is-selected" : ""}`}
                  onClick={() => setIsStatsOpen((v) => !v)}
                  aria-haspopup="true"
                  aria-expanded={isStatsOpen}
                  aria-label="Poem statistics"
                  {...hint("Stats: full word, line, syllable & stanza counts")}
                >
                  <svg className="topbar-ghost-icon" viewBox="0 0 24 24" aria-hidden focusable="false">
                    <path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" d="M18 20V10M12 20V4M6 20v-6" />
                  </svg>
                </button>
                {isStatsOpen && (
                  <div className="topbar-stats-popover" role="status" aria-label="Poem statistics">
                    <div className="tsp-grid">
                      <div className="tsp-row">
                        <span className="tsp-label">Words</span>
                        <span className="tsp-val">{m.docStats.totalWords}</span>
                      </div>
                      <div className="tsp-row">
                        <span className="tsp-label">Lines</span>
                        <span className="tsp-val">{m.docStats.nonEmptyLines}</span>
                      </div>
                      <div className="tsp-row">
                        <span className="tsp-label">Characters</span>
                        <span className="tsp-val">{m.docStats.totalChars}</span>
                      </div>
                      <div className="tsp-row">
                        <span className="tsp-label">Syllables (est.)</span>
                        <span className="tsp-val">{m.docStats.totalSyllables}</span>
                      </div>
                      <div className="tsp-row">
                        <span className="tsp-label">Stanzas</span>
                        <span className="tsp-val">{m.docStats.stanzaCount}</span>
                      </div>
                      <div className="tsp-row">
                        <span className="tsp-label">Read-aloud</span>
                        <span className="tsp-val">
                          {m.docStats.totalWords === 0 ? "—" : `${m.docStats.estimatedReadingMinutes} min`}
                        </span>
                      </div>
                      <div className="tsp-row">
                        <span className="tsp-label">Avg words / line</span>
                        <span className="tsp-val">
                          {m.docStats.nonEmptyLines > 0 ? m.docStats.avgWordsPerNonEmptyLine : "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {/* Background */}
              <button
                type="button"
                className={`topbar-ghost-btn ${isBackgroundOpen ? "is-selected" : ""}`}
                onClick={() => setIsBackgroundOpen((v) => !v)}
                aria-haspopup="dialog"
                aria-expanded={isBackgroundOpen}
                aria-label="Page background"
                {...hint("Background: choose a scene behind the page")}
              >
                <svg className="topbar-ghost-icon" viewBox="0 0 24 24" aria-hidden focusable="false">
                  <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
                  <path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" d="M3 15l4.5-4.5 3 3 3-3 4.5 4.5" />
                  <circle cx="8" cy="9.5" r="1.25" fill="currentColor" />
                </svg>
              </button>
              {/* Find */}
              <button
                type="button"
                className="topbar-ghost-btn"
                onClick={() => { setFindMode("find"); setIsFindOpen(true); }}
                aria-label="Find in poem (⌘F)"
                {...hint("Find text in the poem (⌘/Ctrl+F)")}
              >
                <svg className="topbar-ghost-icon" viewBox="0 0 24 24" aria-hidden focusable="false">
                  <circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" strokeWidth="1.75"/>
                  <path d="M14.5 14.5L19 19" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                </svg>
              </button>
              {/* Overflow ⋯ */}
              <div className="topbar-overflow-wrap" ref={overflowMenuRef}>
                <button
                  type="button"
                  className={`topbar-ghost-btn topbar-overflow-btn ${topbarOverflowOpen ? "is-selected" : ""}`}
                  aria-label="More options"
                  aria-expanded={topbarOverflowOpen}
                  aria-haspopup="menu"
                  onClick={() => setTopbarOverflowOpen((v) => !v)}
                  {...hint("More: session timer, word goal, share, shortcuts")}
                >
                  <svg className="topbar-ghost-icon" viewBox="0 0 24 24" aria-hidden focusable="false">
                    <circle cx="5" cy="12" r="1.5" fill="currentColor"/>
                    <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
                    <circle cx="19" cy="12" r="1.5" fill="currentColor"/>
                  </svg>
                </button>
                {topbarOverflowOpen && (
                  <div className="topbar-overflow-menu" role="menu">
                    {/* ── Writing ── */}
                    <span className="topbar-overflow-group-label">Writing</span>
                    <div className="topbar-overflow-section">
                      <span className="topbar-overflow-label">Session</span>
                      <span className="topbar-overflow-value"><SessionTimer startTs={sessionStartRef.current} /></span>
                    </div>
                    <div className="topbar-overflow-section">
                      <span className="topbar-overflow-label">Word goal</span>
                      {sessionWordGoal ? (
                        <button type="button" className="topbar-word-goal topbar-word-goal-menu" onClick={() => { setGoalInputVal(String(sessionWordGoal)); setShowGoalInput(true); setTopbarOverflowOpen(false); }}>
                          <span className="topbar-word-goal-fill" style={{ width: `${Math.min(100, Math.round((m.quickDocStats.totalWords / sessionWordGoal) * 100))}%` }} />
                          <span className="topbar-word-goal-label">{m.quickDocStats.totalWords}/{sessionWordGoal}w</span>
                        </button>
                      ) : showGoalInput ? (
                        <form className="topbar-goal-form" onSubmit={(e) => { e.preventDefault(); const n = parseInt(goalInputVal, 10); if (!isNaN(n) && n > 0) { setSessionWordGoal(n); setShowGoalInput(false); } }}>
                          <input className="topbar-goal-input" type="number" min="1" max="9999" placeholder="e.g. 100" value={goalInputVal} onChange={(e) => setGoalInputVal(e.target.value)} aria-label="Word count goal" autoFocus onBlur={() => { if (!goalInputVal) setShowGoalInput(false); }} onKeyDown={(e) => { if (e.key === "Escape") setShowGoalInput(false); }} />
                          <button type="submit" className="topbar-goal-submit" aria-label="Set goal">✓</button>
                        </form>
                      ) : (
                        <button type="button" className="topbar-overflow-action" onClick={() => { setGoalInputVal(""); setShowGoalInput(true); }}>Set goal</button>
                      )}
                    </div>
                    <hr className="topbar-overflow-divider" />
                    {/* ── View ── */}
                    <span className="topbar-overflow-group-label">View</span>
                    <button type="button" className="topbar-overflow-item" role="menuitem" onClick={() => { setIsFocusMode(true); setTopbarOverflowOpen(false); }}>Focus mode</button>
                    <button type="button" className="topbar-overflow-item" role="menuitem" onClick={() => { setIsReadingMode(true); setTopbarOverflowOpen(false); }}>Reading view</button>
                    <hr className="topbar-overflow-divider" />
                    {/* ── Share ── */}
                    <span className="topbar-overflow-group-label">Share</span>
                    <button type="button" className="topbar-overflow-item" role="menuitem" onClick={() => { setIsShareOpen(true); setTopbarOverflowOpen(false); }}>Share poem</button>
                    <button type="button" className="topbar-overflow-item" role="menuitem" onClick={() => { setIsExportOpen(true); setTopbarOverflowOpen(false); }}>Export poem</button>
                    <hr className="topbar-overflow-divider" />
                    {/* ── App ── */}
                    <span className="topbar-overflow-group-label">App</span>
                    <button type="button" className="topbar-overflow-item" role="menuitem" onClick={() => { setIsCmdkOpen(true); setTopbarOverflowOpen(false); }}>⌘ Commands</button>
                    <button type="button" className="topbar-overflow-item" role="menuitem" onClick={() => { setIsShortcutsOpen(true); setTopbarOverflowOpen(false); }}>Keyboard shortcuts</button>
                    <button type="button" className="topbar-overflow-item" role="menuitem" onClick={() => { resetLayout(); setTopbarOverflowOpen(false); }}>Reset panel layout</button>
                    <hr className="topbar-overflow-divider" />
                    {/* ── Data ── */}
                    <span className="topbar-overflow-group-label">Data</span>
                    <button type="button" className="topbar-overflow-item" role="menuitem" onClick={() => { void m.exportWorkshopBackup(); setTopbarOverflowOpen(false); }}>Export backup (JSON)</button>
                    <button type="button" className="topbar-overflow-item" role="menuitem" onClick={() => { void m.triggerImportBackup(); setTopbarOverflowOpen(false); }}>Import backup (JSON)</button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <button
              type="button"
              className="small-btn topbar-focus-exit-btn"
              onClick={() => setIsFocusMode(false)}
              aria-label="Exit focus mode and show tools"
            >
              Show tools
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
