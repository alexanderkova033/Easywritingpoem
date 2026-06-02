import { StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { applyAppearance, loadAppearance } from "@/workshop/appearance/appearance";
import { HoverHintsProvider } from "@/workshop/hints/HoverHintsContext";
import { ToastProvider } from "@/shared/toast/ToastContext";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { clearChunkReloadFlag, lazyWithReload } from "@/app/lazy-with-reload";
import { schedulePreloadIfEnabled } from "@/app/preload-chunks";
import { STORAGE_KEY_LANDING_DISMISSED } from "@/shared/storage-keys";
import "@/app/index.css";

const PoemWorkshop = lazy(
  lazyWithReload(() =>
    import("@/workshop/shell/PoemWorkshop").then((m) => ({ default: m.PoemWorkshop })),
  ),
);
const LandingPage = lazy(
  lazyWithReload(() =>
    import("@/landing/LandingPage").then((m) => ({ default: m.LandingPage })),
  ),
);

applyAppearance(loadAppearance());

// Pause animations + background work when the tab is hidden. Toggles a body
// class that CSS uses to halt keyframes; visibility-aware intervals also gate
// on document.hidden so they don't repaint the DOM in the background.
function syncTabHiddenClass() {
  document.body.classList.toggle("tab-hidden", document.hidden);
}
syncTabHiddenClass();
document.addEventListener("visibilitychange", syncTabHiddenClass);

// Idle slowdown — after no user input for IDLE_MS, halve the playback rate
// of the ambient body::before / body::after animations (drift continues but
// at 2x slower). On the next input event, restore rate to 1 instantly.
//
// Uses Web Animations API rather than CSS toggling so the slowdown works
// per-theme without touching each theme's animation declaration. The drift
// is the only thing affected — UI transitions, modal animations, AI
// streaming, typing, and React state are untouched.
//
// Listeners are passive + capture so they cannot block scroll or be
// cancelled by stopPropagation inside the app.
const IDLE_MS = 45_000;
const IDLE_RATE = 0.35;
let idleTimer: number | undefined;
let isIdle = false;
let currentRate = 1;

function applyAmbientRate(rate: number) {
  currentRate = rate;
  for (const anim of document.getAnimations()) {
    const effect = anim.effect;
    if (!(effect instanceof KeyframeEffect)) continue;
    const target = effect.target;
    if (target !== document.body && target !== document.documentElement) continue;
    const pseudo = effect.pseudoElement;
    if (pseudo !== "::before" && pseudo !== "::after") continue;
    anim.playbackRate = rate;
  }
}

function markActive() {
  if (isIdle) {
    isIdle = false;
    document.documentElement.removeAttribute("data-user-idle");
    applyAmbientRate(1);
  }
  if (idleTimer !== undefined) window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    isIdle = true;
    document.documentElement.setAttribute("data-user-idle", "");
    applyAmbientRate(IDLE_RATE);
  }, IDLE_MS);
}

const IDLE_EVENTS = [
  "pointermove",
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
] as const;
for (const ev of IDLE_EVENTS) {
  window.addEventListener(ev, markActive, { passive: true, capture: true });
}
// Visibility flip back from hidden also counts as activity — user just
// returned to the tab and should see the live backdrop immediately.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) markActive();
});

// Theme switches replace the body::before / body::after Animation objects
// (new animation-name → new Animation instance at default rate 1). When that
// happens while we're idle, reapply the current rate on the next frame so
// the new theme's drift inherits the slowdown.
const htmlEl = document.documentElement;
const themeObserver = new MutationObserver(() => {
  if (currentRate === 1) return;
  requestAnimationFrame(() => applyAmbientRate(currentRate));
});
themeObserver.observe(htmlEl, {
  attributes: true,
  attributeFilter: ["data-workshop-bg"],
});

markActive();

function readLandingDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_LANDING_DISMISSED) === "1";
  } catch {
    return false;
  }
}

function App() {
  const [showWorkshop, setShowWorkshop] = useState(readLandingDismissed);

  useEffect(() => {
    clearChunkReloadFlag();
    schedulePreloadIfEnabled();
  }, []);

  // Push a history entry when entering the workshop so the browser Back button
  // returns to the landing page instead of leaving the site.
  useEffect(() => {
    if (showWorkshop && window.history.state?.view !== "workshop") {
      window.history.pushState({ view: "workshop" }, "");
    }
  }, [showWorkshop]);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      setShowWorkshop(e.state?.view === "workshop");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const enter = () => {
    try {
      localStorage.setItem(STORAGE_KEY_LANDING_DISMISSED, "1");
    } catch {
      // ignore
    }
    window.history.pushState({ view: "workshop" }, "");
    setShowWorkshop(true);
  };

  if (!showWorkshop) {
    return (
      <Suspense fallback={null}>
        <LandingPage onEnter={enter} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div className="app-loading-shell" aria-hidden />}>
      <a href="#poem-body" className="skip-link">Skip to editor</a>
      <ToastProvider>
        <HoverHintsProvider>
          <PoemWorkshop />
        </HoverHintsProvider>
      </ToastProvider>
    </Suspense>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <Analytics />
      <SpeedInsights />
    </ErrorBoundary>
  </StrictMode>
);