import { useEffect, useRef, useState } from "react";
import "./LandingPage.css";
import { getCurrentStreak, getDailyPrompt } from "@/workshop/shell/writing-streak";

export function LandingPage({ onEnter }: { onEnter: () => void }) {
  const heroRef = useRef<HTMLElement>(null);
  const [stickyVisible, setStickyVisible] = useState(false);
  const [streak] = useState(() => getCurrentStreak());
  const [dailyPrompt] = useState(() => getDailyPrompt());

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

  return (
    <div className="landing-root">
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
      <section className="landing-hero" ref={heroRef}>
        <div className="landing-aurora" aria-hidden>
          <span className="landing-aurora-blob landing-aurora-blob-1" />
          <span className="landing-aurora-blob landing-aurora-blob-2" />
          <span className="landing-aurora-blob landing-aurora-blob-3" />
        </div>
        <div className="landing-floaters" aria-hidden>
          <span className="landing-floater landing-floater-1">moonlight</span>
          <span className="landing-floater landing-floater-2">whisper</span>
          <span className="landing-floater landing-floater-3">ember</span>
          <span className="landing-floater landing-floater-4">silver</span>
          <span className="landing-floater landing-floater-5">drift</span>
          <span className="landing-floater landing-floater-6">hush</span>
        </div>
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
            Rhyme scheme, syllable counts, and meter update as you type.
            AI suggestions when you're stuck. No account. Your words stay private.
          </p>

          {/* Live typing demo */}
          <div className="landing-demo" aria-hidden>
            <div className="landing-demo-editor">
              <div className="landing-demo-line">
                <span className="landing-demo-text landing-demo-text-1">The candle burns in winter's grip,</span>
                <span className="landing-demo-badge landing-demo-badge-a landing-demo-badge-1">A</span>
                <span className="landing-demo-syl landing-demo-syl-1">8</span>
              </div>
              <div className="landing-demo-line">
                <span className="landing-demo-text landing-demo-text-2">and shadows stretch across the floor.</span>
                <span className="landing-demo-badge landing-demo-badge-b landing-demo-badge-2">B</span>
                <span className="landing-demo-syl landing-demo-syl-2">8</span>
              </div>
              <div className="landing-demo-line">
                <span className="landing-demo-text landing-demo-text-3">A moth has pressed its paper wing</span>
                <span className="landing-demo-badge landing-demo-badge-a landing-demo-badge-3">A</span>
                <span className="landing-demo-syl landing-demo-syl-3">8</span>
              </div>
              <div className="landing-demo-line landing-demo-line-typing">
                <span className="landing-demo-text landing-demo-text-4">against the cold and frosted door.</span>
                <span className="landing-demo-cursor" />
                <span className="landing-demo-badge landing-demo-badge-b landing-demo-badge-4">B</span>
                <span className="landing-demo-syl landing-demo-syl-4">8</span>
              </div>
            </div>
            <div className="landing-demo-labels">
              <span className="landing-demo-label-tag">Rhyme: ABAB</span>
              <span className="landing-demo-label-tag">8 syllables / line</span>
            </div>
          </div>

          <div className="landing-ctas">
            <button type="button" className="landing-btn landing-btn-primary" onClick={onEnter}>
              <span className="landing-cta-full">Try it free — no account needed →</span>
              <span className="landing-cta-short">Try it free →</span>
            </button>
          </div>
          <p className="landing-hero-reassurance">Free · Saves in your browser · No sign-up · Private</p>

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
      <section className="landing-preview" id="how-it-works" aria-label="App preview">
        <h2 className="landing-section-title">What it looks like</h2>
        <div className="lp-shell" aria-hidden>
          {/* Topbar */}
          <div className="lp-topbar">
            <span className="lp-brand">easywriting <span className="lp-brand-badge">poem</span></span>
            <span className="lp-draft-pill">The Candle</span>
            <span className="lp-stat">42 words</span>
            <span className="lp-save">● Saved</span>
          </div>
          {/* 3-column grid */}
          <div className="lp-grid">
            {/* Rail */}
            <div className="lp-rail">
              <div className="lp-rail-btn lp-rail-btn-guide">Guide</div>
              <div className="lp-rail-btn">Lib</div>
              <div className="lp-rail-btn">Export</div>
            </div>
            {/* Editor */}
            <div className="lp-editor">
              <div className="lp-title-field">The Candle</div>
              <div className="lp-poem-lines">
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
                    <span className="lp-poem-text">{row.text}</span>
                    {row.badge && <span className={`lp-rhyme-badge lp-rhyme-${row.badge.toLowerCase()}`}>{row.badge}</span>}
                    {row.syl != null && <span className="lp-syl">{row.syl}</span>}
                  </div>
                ))}
              </div>
            </div>
            {/* Tools */}
            <div className="lp-tools">
              <div className="lp-tools-tabs">
                <span className="lp-ttab">Queue</span>
                <span className="lp-ttab lp-ttab-active">Sound</span>
                <span className="lp-ttab">Ideas</span>
              </div>
              <div className="lp-tools-inner">
                <div className="lp-tool-heading">Rhyme scheme</div>
                <div className="lp-rhyme-rows">
                  {[["A","grip / wing"],["B","floor / door"],["C","last"],["D","bright"]].map(([label, words]) => (
                    <div key={label} className="lp-rhyme-row">
                      <span className={`lp-rhyme-badge lp-rhyme-${label.toLowerCase()}`}>{label}</span>
                      <span className="lp-rhyme-words">{words}</span>
                    </div>
                  ))}
                </div>
                <div className="lp-tool-heading" style={{ marginTop: "0.8rem" }}>Meter</div>
                <div className="lp-meter-rows">
                  {[8,8,8,8].map((n,i) => (
                    <div key={i} className="lp-meter-row">
                      <span className="lp-meter-bar" style={{ width: `${(n/10)*100}%` }} />
                      <span className="lp-meter-num">{n}</span>
                    </div>
                  ))}
                </div>
              </div>
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
