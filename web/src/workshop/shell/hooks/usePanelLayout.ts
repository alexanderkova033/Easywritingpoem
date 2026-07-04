import { useCallback, useRef, useState } from "react";
import { STORAGE_KEY_TOOLS_WIDTH, STORAGE_KEY_TOOLS_RAIL_WIDTH, STORAGE_KEY_RAIL_WIDTH } from "@/shared/storage-keys";

export const DEFAULT_TOOLS_W = 300;
export const DEFAULT_RAIL_W = 64;
/** Collapsed icon-rail width (labels off) — thin, like the left rail. */
export const DEFAULT_TOOLS_RAIL_W = 64;
/** Collapsed rail width when labels are toggled on (wide enough to read them). */
export const LABELLED_TOOLS_RAIL_W = 100;
export const SNAP_PX = 36;
export const MIN_EDITOR_W = 240;

function readStoredWidth(key: string, fallback: number, max: number): number {
  try {
    const v = parseInt(localStorage.getItem(key) ?? "", 10);
    if (v >= 0 && v <= max) return v;
  } catch { /* ignore */ }
  return fallback;
}

function gapPx(): number {
  return Math.round(1.55 * parseFloat(getComputedStyle(document.documentElement).fontSize || "16"));
}

interface DragColumnOptions {
  cssVar: "--tools-col" | "--rail-col";
  defaultW: number;
  direction: "left" | "right";
  applyLive: (w: number) => void;
  commit: (w: number) => void;
  computeMaxW: () => number;
}

function startColumnDrag(
  e: React.PointerEvent<HTMLDivElement>,
  grid: HTMLDivElement | null,
  opts: DragColumnOptions,
) {
  e.preventDefault();
  const target = e.currentTarget;
  const pointerId = e.pointerId;
  // Suppress the width transition while dragging so the panel tracks the
  // pointer 1:1 instead of easing behind it.
  grid?.classList.add("is-resizing");
  try { target.setPointerCapture(pointerId); } catch { /* ignore */ }
  const startX = e.clientX;
  const startW = parseInt(grid?.style.getPropertyValue(opts.cssVar) || String(opts.defaultW), 10);
  let rafId = 0;
  let pendingW = startW;
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    const delta = ev.clientX - startX;
    const raw = opts.direction === "left" ? startW - delta : startW + delta;
    const maxW = opts.computeMaxW();
    pendingW = raw < SNAP_PX ? 0 : Math.max(0, Math.min(maxW, raw));
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      opts.applyLive(pendingW);
    });
  };
  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    target.removeEventListener("pointermove", onMove);
    target.removeEventListener("pointerup", onUp);
    target.removeEventListener("pointercancel", onUp);
    try { target.releasePointerCapture(pointerId); } catch { /* ignore */ }
    if (rafId) cancelAnimationFrame(rafId);
    grid?.classList.remove("is-resizing");
    const finalW = parseInt(grid?.style.getPropertyValue(opts.cssVar) || String(startW), 10);
    opts.commit(finalW);
  };
  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerup", onUp);
  target.addEventListener("pointercancel", onUp);
}

export function usePanelLayout() {
  const workshopGridRef = useRef<HTMLDivElement | null>(null);

  const [toolsPanelWidth, setToolsPanelWidth] = useState(() =>
    readStoredWidth(STORAGE_KEY_TOOLS_WIDTH, DEFAULT_TOOLS_W, 1200),
  );
  const [railWidth, setRailWidth] = useState(() =>
    readStoredWidth(STORAGE_KEY_RAIL_WIDTH, DEFAULT_RAIL_W, 320),
  );
  const [toolsRailWidth, setToolsRailWidth] = useState(() =>
    // Default matches labels-on (the default), so the fresh rail is wide enough
    // to read the labels; toggling labels off narrows it.
    readStoredWidth(STORAGE_KEY_TOOLS_RAIL_WIDTH, LABELLED_TOOLS_RAIL_W, 320),
  );

  const applyToolsWLive = useCallback((w: number) => {
    const el = workshopGridRef.current;
    if (!el) return;
    el.style.setProperty("--tools-col", `${w}px`);
    el.classList.toggle("tools-collapsed", w === 0);
  }, []);

  const applyRailWLive = useCallback((w: number) => {
    const el = workshopGridRef.current;
    if (!el) return;
    el.style.setProperty("--rail-col", `${w}px`);
    el.classList.toggle("rail-collapsed", w === 0);
  }, []);

  // Collapsed icon-rail width of the tools panel. Clamped to a rail-ish range so
  // it can't be dragged shut or absurdly wide; drives --tools-col while the tool
  // panel is collapsed (the width effect in PoemWorkshop switches which value
  // --tools-col holds based on expand state).
  const clampToolsRail = (w: number) => Math.max(48, Math.min(w, 220));
  const applyToolsRailWLive = useCallback((w: number) => {
    const el = workshopGridRef.current;
    if (!el) return;
    el.style.setProperty("--tools-col", `${clampToolsRail(w)}px`);
  }, []);
  const saveToolsRailW = useCallback((w: number) => {
    try { localStorage.setItem(STORAGE_KEY_TOOLS_RAIL_WIDTH, String(w)); } catch { /* ignore */ }
  }, []);

  const applyToolsW = useCallback((w: number) => {
    applyToolsWLive(w);
    setToolsPanelWidth(w);
  }, [applyToolsWLive]);

  const applyRailW = useCallback((w: number) => {
    applyRailWLive(w);
    setRailWidth(w);
  }, [applyRailWLive]);

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

  const handleResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    startColumnDrag(e, workshopGridRef.current, {
      cssVar: "--tools-col",
      defaultW: DEFAULT_TOOLS_W,
      direction: "left", // drag left → wider
      applyLive: applyToolsWLive,
      computeMaxW: () => {
        const currentRail = parseInt(workshopGridRef.current?.style.getPropertyValue("--rail-col") || String(DEFAULT_RAIL_W), 10);
        const gap = gapPx();
        return Math.min(
          window.innerWidth - currentRail - MIN_EDITOR_W - gap * 2,
          window.innerWidth - MIN_EDITOR_W - gap * 2,
        );
      },
      commit: (w) => {
        setToolsPanelWidth(w);
        saveToolsW(w);
      },
    });
  }, [applyToolsWLive, saveToolsW]);

  const handleRailResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    startColumnDrag(e, workshopGridRef.current, {
      cssVar: "--rail-col",
      defaultW: DEFAULT_RAIL_W,
      direction: "right",
      applyLive: applyRailWLive,
      computeMaxW: () => {
        const currentTools = parseInt(workshopGridRef.current?.style.getPropertyValue("--tools-col") || String(DEFAULT_TOOLS_W), 10);
        const gap = gapPx();
        return window.innerWidth - currentTools - MIN_EDITOR_W - gap * 2;
      },
      commit: (w) => {
        setRailWidth(w);
        saveRailW(w);
      },
    });
  }, [applyRailWLive, saveRailW]);

  // Resize the collapsed icon rail (mirrors the left rail: drag left → wider).
  const handleToolsRailResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    startColumnDrag(e, workshopGridRef.current, {
      cssVar: "--tools-col",
      defaultW: DEFAULT_TOOLS_RAIL_W,
      direction: "left",
      applyLive: applyToolsRailWLive,
      computeMaxW: () => 220,
      commit: (w) => {
        const cw = Math.max(48, Math.min(w, 220));
        setToolsRailWidth(cw);
        saveToolsRailW(cw);
      },
    });
  }, [applyToolsRailWLive, saveToolsRailW]);

  return {
    workshopGridRef,
    toolsPanelWidth,
    setToolsPanelWidth,
    toolsRailWidth,
    setToolsRailWidth,
    saveToolsRailW,
    railWidth,
    setRailWidth,
    applyToolsW,
    applyRailW,
    applyToolsWLive,
    applyRailWLive,
    saveToolsW,
    saveRailW,
    resetLayout,
    handleResizeStart,
    handleRailResizeStart,
    handleToolsRailResizeStart,
  };
}
