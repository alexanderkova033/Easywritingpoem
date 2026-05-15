import { useCallback, useRef, type MutableRefObject } from "react";

interface SheetDragState {
  pointerId: number;
  startY: number;
  startSnap: "half" | "full";
  currentY: number;
}

interface UseSheetDragOptions {
  toolsPanelRef: MutableRefObject<HTMLElement | null>;
  mobileSheetSnap: "half" | "full";
  setMobileSheetSnap: (snap: "half" | "full") => void;
  setMobileToolsExpanded: (v: boolean) => void;
}

export function useSheetDrag(opts: UseSheetDragOptions) {
  const { toolsPanelRef, mobileSheetSnap, setMobileSheetSnap, setMobileToolsExpanded } = opts;
  const sheetDragRef = useRef<SheetDragState | null>(null);

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
  }, [toolsPanelRef]);

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
  }, [setMobileSheetSnap, setMobileToolsExpanded, toolsPanelRef]);

  return { handleSheetDragStart, handleSheetDragMove, handleSheetDragEnd };
}
