import { StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { applyAppearance, loadAppearance } from "@/workshop/appearance/appearance";
import { HoverHintsProvider } from "@/workshop/hints/HoverHintsContext";
import { ToastProvider } from "@/shared/toast/ToastContext";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { STORAGE_KEY_LANDING_DISMISSED } from "@/shared/storage-keys";
import "@/app/index.css";

const PoemWorkshop = lazy(() =>
  import("@/workshop/shell/PoemWorkshop").then((m) => ({ default: m.PoemWorkshop })),
);
const LandingPage = lazy(() =>
  import("@/landing/LandingPage").then((m) => ({ default: m.LandingPage })),
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

function readLandingDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_LANDING_DISMISSED) === "1";
  } catch {
    return false;
  }
}

function App() {
  const [showWorkshop, setShowWorkshop] = useState(readLandingDismissed);

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