import { useEffect } from "react";
import { isTypingInField } from "@/workshop/hints/keyboard-field-target";
import {
  defaultTabForBucket,
  tabsForBucket,
  toolTabBucket,
  TOOL_BUCKET_ORDER,
  type ToolTab,
} from "@/workshop/shell/workshop-helpers";

/** Alt+[ / ] cycles tabs within the current tool group; Alt+1/2/3 jumps to a bucket. */
export function useWorkshopToolHotkeys(
  toolTab: ToolTab,
  setToolTab: (t: ToolTab) => void,
) {
  useEffect(() => {
    const ids = tabsForBucket(toolTabBucket(toolTab));
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (isTypingInField(e.target)) return;

      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        const i = ids.indexOf(toolTab);
        if (i < 0) return;
        const delta = e.key === "]" ? 1 : -1;
        setToolTab(ids[(i + delta + ids.length) % ids.length]!);
        return;
      }

      const bucketIdx = parseInt(e.key, 10) - 1;
      if (bucketIdx >= 0 && bucketIdx < TOOL_BUCKET_ORDER.length) {
        e.preventDefault();
        setToolTab(defaultTabForBucket(TOOL_BUCKET_ORDER[bucketIdx]!));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [toolTab, setToolTab]);
}
