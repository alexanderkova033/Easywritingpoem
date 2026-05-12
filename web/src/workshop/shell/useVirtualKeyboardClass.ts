import { useEffect } from "react";

/**
 * Toggles a `vp-keyboard-open` class on `<html>` when the visual viewport
 * shrinks (mobile soft keyboard up). Used by the layout to hide the topbar
 * while typing so the editor keeps full height.
 */
export function useVirtualKeyboardClass(): void {
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
}
