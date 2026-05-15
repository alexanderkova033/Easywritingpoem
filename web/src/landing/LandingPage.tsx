import { useEffect, useRef, useState } from "react";
import "./LandingPage.css";
import { getCurrentStreak, getDailyPrompt } from "@/workshop/shell/writing-streak";

export function LandingPage({ onEnter }: { onEnter: () => void }) {
  const heroRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [stickyVisible, setStickyVisible] = useState(false);
  const [previewRevealed, setPreviewRevealed] = useState(false);
  const [streak] = useState(() => getCurrentStreak());
  const [dailyPrompt] = useState(() => getDailyPrompt());

  // Scroll-driven parallax — writes --landing-scroll-y (in px) to root.
  // Aurora layers use it via transform for depth.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let ticking = false;
    const update = () => {
      ticking = false;
      root.style.setProperty("--landing-scroll-y", `${window.scrollY}`);
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setStickyVisible(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setPreviewRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="landing-root" ref={rootRef}>
      {/* Full-page backdrop: extends behind hero + preview seamlessly */}
      <div className="landing-bg" aria-hidden>
        <span className="landing-bg-grid" />
        <span className="landing-bg-aurora landing-bg-aurora-1" />
        <span className="landing-bg-aurora landing-bg-aurora-2" />
        <span className="landing-bg-aurora landing-bg-aurora-3" />
        <span className="landing-bg-floor" />
      </div>
      {/* Sticky mini-header — appears after hero scrolls out of view */}
      <header className={`landing-sticky-bar${stickyVisible ? " is-visible" : ""}`} aria-hidden={!stickyVisible}>
        <svg className="landing-sticky-logo" viewBox="0 0 24 24" aria-hidden width="20" height="20">
          <path d="M19 3C19 3 20 8 16 13L13 18L12 21L11 18C9.5 14.5 10 9 16 4C17 3.3 18.2 3 19 3Z" fill="#68aa6e" stroke="white" strokeWidth="0.7" strokeLinejoin="round" />
          <path d="M19 3L12 21" stroke="rgba(0,0,0,0.18)" strokeWidth="0.55" strokeLinecap="round" fill="none" />
          <path d="M11 18L12 21" stroke="#c5e0c8" strokeWidth="1.5" strokeLinecap="round" fill="none" />
          <path d="M19 3C19 3 20 8 16 13L13 18L12 21L11 18C9.5 14.5 10 9 16 4C17 3.3 18.2 3 19 3Z" fill="none" stroke="rgba(30,60,35,0.22)" strokeWidth="0.8" strokeLinejoin="round" />
        </svg>
        <span className="landing-sticky-name">easywriting <span className="landing-brand-badge">poem</span></span>
        <button type="button" className="landing-btn landing-btn-primary landing-sticky-cta" onClick={onEnter}>
          Start writing
        </button>
      </header>

      {/* Hero */}
      <section
        className="landing-hero"
        ref={heroRef}
        data-offscreen={stickyVisible ? "true" : "false"}
      >
        <div className="landing-aurora" aria-hidden>
          <span className="landing-aurora-blob landing-aurora-blob-1" />
          <span className="landing-aurora-blob landing-aurora-blob-2" />
          <span className="landing-aurora-blob landing-aurora-blob-3" />
        </div>
        <svg className="landing-constellation" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden>
          {/* Connecting paths (drawn behind nodes) */}
          <path className="lc-link lc-link-1" d="M 180 170 L 410 320" />
          <path className="lc-link lc-link-2" d="M 410 320 L 250 540" />
          <path className="lc-link lc-link-3" d="M 250 540 L 480 680" />
          <path className="lc-link lc-link-4" d="M 1220 200 L 1410 380" />
          <path className="lc-link lc-link-5" d="M 1410 380 L 1180 540" />
          <path className="lc-link lc-link-6" d="M 1180 540 L 1320 760" />
          <path className="lc-link lc-link-7" d="M 410 320 L 1220 200" />
          <path className="lc-link lc-link-8" d="M 480 680 L 1180 540" />
          {/* Nodes */}
          <circle className="lc-dot lc-dot-1" cx="180" cy="170" r="3" />
          <circle className="lc-dot lc-dot-2" cx="410" cy="320" r="4" />
          <circle className="lc-dot lc-dot-3" cx="250" cy="540" r="3" />
          <circle className="lc-dot lc-dot-4" cx="480" cy="680" r="3.5" />
          <circle className="lc-dot lc-dot-5" cx="1220" cy="200" r="3.5" />
          <circle className="lc-dot lc-dot-6" cx="1410" cy="380" r="3" />
          <circle className="lc-dot lc-dot-7" cx="1180" cy="540" r="4" />
          <circle className="lc-dot lc-dot-8" cx="1320" cy="760" r="3" />
        </svg>
        <div className="landing-hero-inner">
          <div className="landing-hero-eyebrow landing-hero-eyebrow-desktop">
            <svg className="landing-hero-feather" viewBox="0 0 24 24" aria-hidden width="22" height="22">
              <path d="M19 3C19 3 20 8 16 13L13 18L12 21L11 18C9.5 14.5 10 9 16 4C17 3.3 18.2 3 19 3Z" fill="#68aa6e" stroke="white" strokeWidth="0.7" strokeLinejoin="round" />
              <path d="M19 3L12 21" stroke="rgba(0,0,0,0.18)" strokeWidth="0.55" strokeLinecap="round" fill="none" />
            </svg>
            <span className="landing-brand-name">easywriting <span className="landing-brand-badge">poem</span></span>
          </div>
          <h1 className="landing-headline">
            Type a poem.<br />
            <span className="landing-headline-accent">See it analyzed — live.</span>
          </h1>
          <p className="landing-sub">
            Rhyme, syllables, meter — live as you type.
            AI when you're stuck. No sign-up. Your words stay in your browser.
          </p>

          {/* Live typing demo — mirrors actual editor layout */}
          <div className="landing-demo" aria-hidden>
            <div className="landing-demo-editor">
              <span className="landing-demo-scanline" />
              <span className="landing-demo-grid" />
              <div className="landing-demo-statusbar">
                <span className="landing-demo-live"><span className="landing-demo-livedot" />LIVE</span>
                <span className="landing-demo-status-stack">
                  <span className="landing-demo-status-meta landing-demo-status-analyzing">analyzing<span className="landing-demo-dots" aria-hidden /></span>
                  <span className="landing-demo-status-meta landing-demo-status-done">✓ ABAB · iambic tetrameter</span>
                </span>
                <span className="landing-demo-score-pop" aria-label="AI score">
                  <span className="landing-demo-score-label">SCORE</span>
                  <span className="landing-demo-score-num">97</span>
                </span>
              </div>
              <div className="landing-demo-line">
                <span className="landing-demo-text landing-demo-text-1">The candle burns in winter's grip,</span>
                <span className="landing-demo-bar landing-demo-bar-1" />
                <span className="landing-demo-syl landing-demo-syl-1">8</span>
                <span className="landing-demo-badge landing-demo-badge-a landing-demo-badge-1">A</span>
              </div>
              <div className="landing-demo-line">
                <span className="landing-demo-text landing-demo-text-2">and shadows stretch across the floor.</span>
                <span className="landing-demo-bar landing-demo-bar-2" />
                <span className="landing-demo-syl landing-demo-syl-2">8</span>
                <span className="landing-demo-badge landing-demo-badge-b landing-demo-badge-2">B</span>
              </div>
              <div className="landing-demo-line">
                <span className="landing-demo-text landing-demo-text-3">A moth has pressed its paper wing</span>
                <span className="landing-demo-bar landing-demo-bar-3" />
                <span className="landing-demo-syl landing-demo-syl-3">8</span>
                <span className="landing-demo-badge landing-demo-badge-a landing-demo-badge-3">A</span>
              </div>
              <div className="landing-demo-line landing-demo-line-typing">
                <span className="landing-demo-text landing-demo-text-4">against the cold and frosted door.</span>
                <span className="landing-demo-cursor" />
                <span className="landing-demo-bar landing-demo-bar-4" />
                <span className="landing-demo-syl landing-demo-syl-4">8</span>
                <span className="landing-demo-badge landing-demo-badge-b landing-demo-badge-4">B</span>
              </div>
            </div>
            <div className="landing-demo-labels">
              <span className="landing-demo-label-tag">Rhyme: ABAB</span>
              <span className="landing-demo-label-tag">8 syllables / line</span>
              <span className="landing-demo-label-tag landing-demo-label-meter">Meter: iambic tetrameter</span>
            </div>
          </div>

          <div className="landing-ctas">
            <button type="button" className="landing-btn landing-btn-primary" onClick={onEnter}>
              <span className="landing-cta-full">Try it free — no account needed →</span>
              <span className="landing-cta-short">Try it free →</span>
            </button>
          </div>
          <p className="landing-hero-reassurance">Free · Private · No sign-up</p>

          {/* Subtle daily prompt + streak strip — only shown if user has used the app before */}
          {(streak.count > 0 || dailyPrompt) && (
            <div className="landing-daily-strip" aria-label="Today's writing nudge">
              <span className="landing-daily-prompt">
                <span className="landing-daily-label">Today</span>
                <span className="landing-daily-text">{dailyPrompt}</span>
              </span>
              {streak.count > 0 && (
                <span className="landing-streak" title={streak.best > streak.count ? `Best: ${streak.best} days` : "Keep going"}>
                  <span className="landing-streak-icon" aria-hidden>·</span>
                  <span className="landing-streak-count">{streak.count}</span>
                  <span className="landing-streak-label">{streak.count === 1 ? "day" : "days"}</span>
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      {/* App preview mockup */}
      <section
        className="landing-preview"
        id="how-it-works"
        aria-label="App preview"
        ref={previewRef}
        data-revealed={previewRevealed ? "true" : "false"}
      >
        <h2 className="landing-section-title">What it looks like</h2>
        <div className="lp-shell" aria-hidden>
          <span className="lp-shell-scanline" />
          {/* Topbar */}
          <div className="lp-topbar">
            <div className="lp-topbar-left">
              <span className="lp-brand">
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
                  <path d="M19 3C19 3 20 8 16 13L13 18L12 21L11 18C9.5 14.5 10 9 16 4C17 3.3 18.2 3 19 3Z" fill="currentColor" />
                </svg>
                easywriting<span className="lp-brand-badge">poem</span>
              </span>
              <span className="lp-draft-pill">
                <span className="lp-draft-tag">DRAFT</span>
                <span className="lp-draft-name">The Candle</span>
                <span className="lp-draft-caret">▾</span>
                <span className="lp-draft-plus">+</span>
              </span>
            </div>
            <div className="lp-topbar-right">
              <span className="lp-stat">42 words · 6 lines</span>
              <span className="lp-save"><span className="lp-save-dot" />Saved</span>
              <span className="lp-topbar-icons">
                <span className="lp-tbi">≡</span>
                <span className="lp-tbi">◐</span>
                <span className="lp-tbi">⌕</span>
                <span className="lp-tbi">⋯</span>
              </span>
            </div>
          </div>
          {/* 3-column grid */}
          <div className="lp-grid">
            {/* Rail — icon-only square buttons */}
            <div className="lp-rail">
              {[
                { glyph: "Aa", title: "Style" },
                { glyph: "❏", title: "Library" },
                { glyph: "↑", title: "Export" },
                { glyph: "⛶", title: "Focus" },
                { glyph: "?", title: "Guide", active: true },
              ].map((b) => (
                <div
                  key={b.title}
                  className={`lp-rail-btn${b.active ? " lp-rail-btn-active" : ""}`}
                  title={b.title}
                >
                  <span className="lp-rail-glyph">{b.glyph}</span>
                </div>
              ))}
            </div>
            {/* Editor */}
            <div className="lp-editor">
              {/* Title + Main idea fields side-by-side */}
              <div className="lp-fields">
                <div className="lp-field">
                  <span className="lp-field-label">Title</span>
                  <div className="lp-field-input">The Candle</div>
                </div>
                <div className="lp-field">
                  <span className="lp-field-label">Main idea <span className="lp-field-opt">(optional)</span></span>
                  <div className="lp-field-input lp-field-input-placeholder">e.g. the feeling of leaving home for the first time</div>
                </div>
              </div>
              {/* Poem header row with format toolbar */}
              <div className="lp-poem-header">
                <span className="lp-poem-label">Poem</span>
                <span className="lp-format-toolbar">
                  <span className="lp-fmt-btn lp-fmt-bold">B</span>
                  <span className="lp-fmt-btn lp-fmt-under">U</span>
                  <span className="lp-fmt-sep" />
                  <span className="lp-fmt-text">Size</span>
                  <span className="lp-fmt-select">Med ▾</span>
                  <span className="lp-fmt-sep" />
                  <span className="lp-fmt-btn lp-fmt-mono">'syl</span>
                  <span className="lp-fmt-btn lp-fmt-mono">AB</span>
                  <span className="lp-fmt-btn lp-fmt-mono">A·A</span>
                  <span className="lp-fmt-sep" />
                  <span className="lp-fmt-btn">¶</span>
                  <span className="lp-fmt-btn lp-fmt-focus">◉</span>
                </span>
              </div>
              {/* Line-numbered poem body */}
              <div className="lp-poem-body">
                {[
                  { text: "The candle burns in winter's grip,", badge: "A", syl: 8 },
                  { text: "and shadows stretch across the floor.", badge: "B", syl: 8 },
                  { text: "A moth has pressed its paper wing", badge: "A", syl: 8 },
                  { text: "against the cold and frosted door.", badge: "B", syl: 8 },
                  { text: "", badge: null, syl: null },
                  { text: "The candle knows it cannot last —", badge: "C", syl: 8 },
                  { text: "its wax grows thin, its circle bright.", badge: "D", syl: 8 },
                ].map((row, i) => (
                  <div key={i} className="lp-poem-row">
                    <span className="lp-line-num">{i + 1}</span>
                    <span className="lp-rhyme-gutter">
                      {row.badge && <span className={`lp-rhyme-badge lp-rhyme-${row.badge.toLowerCase()}`}>{row.badge}</span>}
                    </span>
                    <span className="lp-poem-text">{row.text || " "}</span>
                    {row.syl != null && (
                      <span className="lp-syl-wrap">
                        <span className="lp-syl-bar" style={{ width: `${(row.syl / 10) * 28}px` }} />
                        <span className="lp-syl">{row.syl}</span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {/* Tools panel */}
            <div className="lp-tools">
              <div className="lp-tools-header">
                <span className="lp-tools-title">Tools</span>
                <span className="lp-analyse-btn">+ Analyse</span>
              </div>
              <div className="lp-tools-sections">
                <span className="lp-tsection lp-tsection-active">OVERVIEW</span>
                <span className="lp-tsection">SOUND</span>
                <span className="lp-tsection">SUGGEST</span>
              </div>
              <div className="lp-tools-tabs">
                {[
                  { glyph: "⊙", label: "Queue", active: true },
                  { glyph: "M", label: "Spell" },
                  { glyph: "≡", label: "Lines" },
                  { glyph: "◎", label: "Goals" },
                  { glyph: "◰", label: "Snaps" },
                ].map((t) => (
                  <span key={t.label} className={`lp-ttab${t.active ? " lp-ttab-active" : ""}`}>
                    <span className="lp-ttab-glyph">{t.glyph}</span>
                    <span className="lp-ttab-label">{t.label}</span>
                  </span>
                ))}
              </div>
              <div className="lp-tools-inner">
                <div className="lp-rqueue">
                  <div className="lp-rqueue-title"><span className="lp-rqueue-dot" />Revision queue</div>
                  <div className="lp-rqueue-group">
                    <span className="lp-rqueue-soon">● Soon <span className="lp-rqueue-count">2</span></span>
                  </div>
                  {[
                    { tag: "CHECKLIST", title: "At least one non-empty line", body: "Add your poem before publishing.", action: "Lines" },
                    { tag: "CHECKLIST", title: "Title set", body: "Optional for some venues; still useful when sharing.", action: "Add title" },
                  ].map((c, i) => (
                    <div key={i} className="lp-rcard">
                      <span className="lp-rcard-tag">{c.tag}</span>
                      <div className="lp-rcard-body">
                        <span className="lp-rcard-title">{c.title}</span>
                        <span className="lp-rcard-desc">{c.body}</span>
                      </div>
                      <span className="lp-rcard-action">{c.action}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="lp-tools-footer">
                <span className="lp-kbd">?</span>shortcuts <span className="lp-kbd lp-kbd-w">⌘K</span>commands
              </div>
            </div>
          </div>
          {/* Bottom AI Analysis panel */}
          <div className="lp-ai">
            <div className="lp-ai-header">
              <span className="lp-ai-title">✦ AI Analysis</span>
              <span className="lp-ai-caret">▴</span>
            </div>
            <div className="lp-ai-controls">
              <span className="lp-ai-toggle"><span className="lp-ai-toggle-thumb">100</span>Score</span>
              <span className="lp-ai-select">Fast ▾</span>
              <span className="lp-ai-chip">♡ Gentle</span>
              <span className="lp-ai-chip lp-ai-chip-active">✦ Honest</span>
              <span className="lp-ai-chip">⚡ Critic</span>
              <span className="lp-ai-read">+ Read poem</span>
            </div>
            <div className="lp-ai-desc">
              Reads your poem and returns a warm reaction, strengths, weaknesses, the strongest line, and line-level suggestions.
            </div>
          </div>
        </div>
        <p className="landing-preview-caption">Your poem · your browser · nothing sent to a server</p>
      </section>

      {/* What we analyze */}
      <section className="landing-concepts">
        <h2 className="landing-section-title">What easywriting-poem analyzes</h2>
        <div className="landing-concepts-grid">
          <div className="landing-concept">
            <span className="landing-concept-icon" aria-hidden>♪</span>
            <h3>Rhyme</h3>
            <p>End-rhyme scheme labeled A B A B — see the pattern at a glance and find near-rhymes.</p>
          </div>
          <div className="landing-concept">
            <span className="landing-concept-icon" aria-hidden>◦ ◦ •</span>
            <h3>Rhythm &amp; meter</h3>
            <p>Syllable counts per line. Stress patterns detected so you can feel where the beat falls.</p>
          </div>
          <div className="landing-concept">
            <span className="landing-concept-icon" aria-hidden>↺</span>
            <h3>Repeats</h3>
            <p>Repeated words highlighted so you can decide whether they're intentional or just filler.</p>
          </div>
          <div className="landing-concept">
            <span className="landing-concept-icon" aria-hidden>✦</span>
            <h3>AI score</h3>
            <p>Imagery, musicality, originality, and clarity scored 1–100 with line-level suggestions.</p>
          </div>
        </div>
      </section>

      {/* CTA footer */}
      <section className="landing-footer-cta">
        <p className="landing-footer-tagline">
          Whether you're drafting a birthday poem or a Shakespearean sonnet — start with a blank page and let the analysis guide you.
        </p>
        <button type="button" className="landing-btn landing-btn-primary landing-btn-lg" onClick={onEnter}>
          Open the workshop — it's free →
        </button>
      </section>
    </div>
  );
}
