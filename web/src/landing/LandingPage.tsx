import { useEffect, useRef, useState } from "react";
import "./LandingPage.css";
import { getCurrentStreak, getDailyPrompt } from "@/workshop/shell/writing-streak";

// Pool of ambient poetry words. Six visible at a time; each slot cycles to the
// next pool entry when its drift animation iterates, so variety grows without
// increasing on-screen density.
const FLOATER_POOL = [
  "moonlight", "whisper", "ember", "silver", "drift", "hush",
  "velvet", "linger", "amber", "glimmer", "frost", "echo",
  "tender", "quiet", "fade", "stillness", "shimmer", "gossamer",
  "ash", "thrum", "petal", "dusk",
];

export function LandingPage({ onEnter }: { onEnter: () => void }) {
  const heroRef = useRef<HTMLElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [stickyVisible, setStickyVisible] = useState(false);
  const [streak] = useState(() => getCurrentStreak());
  const [dailyPrompt] = useState(() => getDailyPrompt());
  const [floaters, setFloaters] = useState<string[]>(() => FLOATER_POOL.slice(0, 6));
  const poolCursor = useRef(6);

  const swapFloater = (slot: number) => {
    setFloaters((prev) => {
      const next = [...prev];
      const visible = new Set(prev);
      visible.delete(prev[slot]);
      let pick = FLOATER_POOL[poolCursor.current % FLOATER_POOL.length];
      poolCursor.current += 1;
      // Avoid picking a word already shown in another slot
      let guard = 0;
      while (visible.has(pick) && guard < FLOATER_POOL.length) {
        pick = FLOATER_POOL[poolCursor.current % FLOATER_POOL.length];
        poolCursor.current += 1;
        guard += 1;
      }
      next[slot] = pick;
      return next;
    });
  };

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
        <svg className="landing-sticky-logo" viewBox="0 0 32 32" aria-hidden width="20" height="20">
          <g transform="translate(-8.85 -8.5) scale(1.4)">
            <path d="M21 8C23.5 9 25 12.5 21 18L16 23.5L14.5 27L13 23.5C10.5 19.5 11.5 14 21 8Z" fill="#7a9b7c" />
            <path d="M21 8L13.5 22" stroke="#0a0f0d" strokeWidth="0.85" strokeLinecap="round" opacity="0.5" fill="none" />
            <path d="M13 23.5L14.5 27" stroke="#d5ddd7" strokeWidth="1.3" strokeLinecap="round" fill="none" />
          </g>
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
        <div className="landing-floaters" aria-hidden>
          {floaters.map((word, i) => (
            <span
              key={i}
              className={`landing-floater landing-floater-${i + 1}`}
              onAnimationIteration={() => swapFloater(i)}
            >
              {word}
            </span>
          ))}
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
            A quiet place<br />
            <span className="landing-headline-accent">to write poetry.</span>
          </h1>
          <p className="landing-sub">
            Live rhyme, syllables, and meter as you type. AI to analyse.
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
              Try it free →
            </button>
          </div>

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

      {/* Lower zone — visually distinct band: concepts + footer CTA */}
      <div className="landing-lower">
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
    </div>
  );
}
