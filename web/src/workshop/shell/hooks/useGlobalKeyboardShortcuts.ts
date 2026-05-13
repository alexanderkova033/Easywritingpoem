import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { ToolTab } from "@/workshop/shell/workshop-helpers";

type FindMode = "find" | "replace";

export interface GlobalKeyboardShortcutsInput {
  setIsCmdkOpen: Dispatch<SetStateAction<boolean>>;
  setFindMode: Dispatch<SetStateAction<FindMode>>;
  setIsFindOpen: Dispatch<SetStateAction<boolean>>;
  setIsReadingMode: Dispatch<SetStateAction<boolean>>;
  setIsFocusMode: Dispatch<SetStateAction<boolean>>;
  setTopbarOverflowOpen: Dispatch<SetStateAction<boolean>>;
  setIsLibraryOpen: Dispatch<SetStateAction<boolean>>;
  setIsStyleOpen: Dispatch<SetStateAction<boolean>>;
  setIsBackgroundOpen: Dispatch<SetStateAction<boolean>>;
  setIsExportOpen: Dispatch<SetStateAction<boolean>>;
  setIsShortcutsOpen: Dispatch<SetStateAction<boolean>>;
  setIsGuideOpen: Dispatch<SetStateAction<boolean>>;
  setToolTab: (tab: ToolTab) => void;
  saveSnapshot: () => void;
  mobileAnalyzeFnRef: MutableRefObject<(() => void) | null>;
}

/**
 * Registers workshop-wide keyboard shortcuts:
 *   Ctrl/Cmd+K   → command palette
 *   Ctrl/Cmd+F   → find
 *   Ctrl/Cmd+H   → find + replace
 *   Ctrl/Cmd+Shift+R → toggle reading mode
 *   Alt+Z        → toggle focus mode
 *   Ctrl/Cmd+G   → go-to-line
 *   Ctrl/Cmd+Shift+S → snapshot
 *   Ctrl/Cmd+Shift+A → analyze
 *   Escape       → close any open overlay
 *
 * The two listeners that previously lived inline in PoemWorkshop have been
 * collapsed into a single keydown handler so we install one window listener
 * instead of two.
 */
export function useGlobalKeyboardShortcuts(input: GlobalKeyboardShortcutsInput): void {
  const {
    setIsCmdkOpen,
    setFindMode,
    setIsFindOpen,
    setIsReadingMode,
    setIsFocusMode,
    setTopbarOverflowOpen,
    setIsLibraryOpen,
    setIsStyleOpen,
    setIsBackgroundOpen,
    setIsExportOpen,
    setIsShortcutsOpen,
    setIsGuideOpen,
    setToolTab,
    saveSnapshot,
    mobileAnalyzeFnRef,
  } = input;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (key === "k" && ctrlOrMeta) {
        e.preventDefault();
        setIsCmdkOpen(true);
        return;
      }
      if (key === "f" && ctrlOrMeta) {
        e.preventDefault();
        setFindMode("find");
        setIsFindOpen(true);
        return;
      }
      if (key === "h" && ctrlOrMeta) {
        e.preventDefault();
        setFindMode("replace");
        setIsFindOpen(true);
        return;
      }
      if (key === "r" && ctrlOrMeta && e.shiftKey) {
        e.preventDefault();
        setIsReadingMode((v) => !v);
        return;
      }
      if (key === "z" && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        setIsFocusMode((v) => !v);
        return;
      }
      if (key === "g" && ctrlOrMeta && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setToolTab("lines");
        queueMicrotask(() => document.getElementById("go-line-input")?.focus());
        return;
      }
      if (key === "s" && ctrlOrMeta && e.shiftKey && !e.altKey) {
        e.preventDefault();
        setToolTab("snapshots");
        saveSnapshot();
        return;
      }
      if (key === "a" && ctrlOrMeta && e.shiftKey && !e.altKey) {
        e.preventDefault();
        mobileAnalyzeFnRef.current?.();
        return;
      }
      if (e.key === "Escape") {
        setTopbarOverflowOpen(false);
        setIsFocusMode(false);
        setIsLibraryOpen(false);
        setIsStyleOpen(false);
        setIsBackgroundOpen(false);
        setIsExportOpen(false);
        setIsCmdkOpen(false);
        setIsFindOpen(false);
        setIsShortcutsOpen(false);
        setIsGuideOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    setIsCmdkOpen,
    setFindMode,
    setIsFindOpen,
    setIsReadingMode,
    setIsFocusMode,
    setTopbarOverflowOpen,
    setIsLibraryOpen,
    setIsStyleOpen,
    setIsBackgroundOpen,
    setIsExportOpen,
    setIsShortcutsOpen,
    setIsGuideOpen,
    setToolTab,
    saveSnapshot,
    mobileAnalyzeFnRef,
  ]);
}
