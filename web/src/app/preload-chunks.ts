import { STORAGE_KEY_PRELOAD_ALL_CHUNKS } from "@/shared/storage-keys";

// Every lazy()/dynamic-import target the workshop uses. Listed in one place so
// the "preload everything" toggle can warm the browser HTTP cache for them on
// startup — once fetched, Vite's immutable hashed chunks stay cached and work
// offline even after a refresh.
const CHUNK_LOADERS: Array<() => Promise<unknown>> = [
  () => import("@/workshop/shell/PoemWorkshop"),
  () => import("@/landing/LandingPage"),
  () => import("@/workshop/appearance/backgrounds/BackgroundPicker"),
  () => import("@/workshop/analysis/WorkshopToolPanels"),
  () => import("@/workshop/analysis/AiAnalysis"),
  () => import("@/workshop/reading/ReadingModeModal"),
  () => import("@/workshop/sharing/ShareModal"),
  () => import("docx"),
  () => import("jspdf"),
  () => import("html-to-image"),
];

export function isPreloadAllChunksEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_PRELOAD_ALL_CHUNKS) === "1";
  } catch {
    return false;
  }
}

export function setPreloadAllChunksEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY_PRELOAD_ALL_CHUNKS, on ? "1" : "0");
  } catch {
    // ignore
  }
}

function preloadAllChunks(): void {
  for (const load of CHUNK_LOADERS) {
    // Swallow failures: if a chunk fails now (e.g., already offline), the
    // normal lazyWithReload path will retry when the user actually opens it.
    load().catch(() => {});
  }
}

// Kick off all chunk fetches on idle so they don't compete with first paint.
export function schedulePreloadIfEnabled(): void {
  if (!isPreloadAllChunksEnabled()) return;
  const ric = (window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (typeof ric === "function") {
    ric(preloadAllChunks, { timeout: 4000 });
  } else {
    window.setTimeout(preloadAllChunks, 2000);
  }
}

// Called when the user flips the toggle on — warm the cache immediately so the
// benefit kicks in this session, not just after the next refresh.
export function preloadAllChunksNow(): void {
  preloadAllChunks();
}
