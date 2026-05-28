import { useCallback, useEffect, useMemo, useState } from "react";
import { loadIdSet, saveIdSet } from "@/workshop/analysis/ai-analysis-storage";

export const LS_CRAFT_IGNORED_PREFIX = "easy-poems:craft-ignored:";

export function craftKey(category: string, item: string): string {
  return `${category}:${item.toLowerCase()}`;
}

export function useIgnoredCraftItems(poemId: string | undefined) {
  const [ignored, setIgnored] = useState<Set<string>>(() =>
    loadIdSet(LS_CRAFT_IGNORED_PREFIX, poemId),
  );

  useEffect(() => {
    setIgnored(loadIdSet(LS_CRAFT_IGNORED_PREFIX, poemId));
  }, [poemId]);

  const persist = useCallback(
    (next: Set<string>) => {
      setIgnored(next);
      saveIdSet(LS_CRAFT_IGNORED_PREFIX, poemId, next);
    },
    [poemId],
  );

  const ignore = useCallback(
    (category: string, item: string) => {
      const next = new Set(ignored);
      next.add(craftKey(category, item));
      persist(next);
    },
    [ignored, persist],
  );

  const restore = useCallback(
    (category: string, item: string) => {
      const next = new Set(ignored);
      next.delete(craftKey(category, item));
      persist(next);
    },
    [ignored, persist],
  );

  const restoreAll = useCallback(
    (category: string) => {
      const next = new Set(ignored);
      const prefix = `${category}:`;
      for (const k of ignored) {
        if (k.startsWith(prefix)) next.delete(k);
      }
      persist(next);
    },
    [ignored, persist],
  );

  const isIgnored = useCallback(
    (category: string, item: string) => ignored.has(craftKey(category, item)),
    [ignored],
  );

  const countInCategory = useMemo(
    () => (category: string) => {
      const prefix = `${category}:`;
      let n = 0;
      for (const k of ignored) if (k.startsWith(prefix)) n += 1;
      return n;
    },
    [ignored],
  );

  return { ignored, ignore, restore, restoreAll, isIgnored, countInCategory };
}
