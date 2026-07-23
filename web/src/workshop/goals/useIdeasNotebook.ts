import { useCallback, useEffect, useState } from "react";
import {
  IDEAS_CHANGED_EVENT,
  loadIdeas,
  saveIdeas,
  type IdeaEntry,
} from "./ideas-notebook-storage";

/**
 * Subscribes to the ideas-notebook localStorage entry and keeps the returned
 * list in sync across all consumers (e.g. the plans panel notebook and the
 * focus-mode side panel). All writers should call `persist` instead of saving
 * directly so the change event fires.
 */
export function useIdeasNotebook(): [
  IdeaEntry[],
  (next: IdeaEntry[]) => void,
] {
  const [ideas, setIdeas] = useState<IdeaEntry[]>([]);

  useEffect(() => {
    setIdeas(loadIdeas());
    const onChange = () => setIdeas(loadIdeas());
    window.addEventListener(IDEAS_CHANGED_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(IDEAS_CHANGED_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const persist = useCallback((next: IdeaEntry[]) => {
    setIdeas(next);
    saveIdeas(next);
  }, []);

  return [ideas, persist];
}

/**
 * Stable comparator: pinned active first, then unpinned active, then done last.
 * Preserves the user's drag order within each bucket.
 */
export function sortPinnedFirst(ideas: IdeaEntry[]): IdeaEntry[] {
  const pinnedActive: IdeaEntry[] = [];
  const unpinnedActive: IdeaEntry[] = [];
  const done: IdeaEntry[] = [];
  for (const i of ideas) {
    if (i.done) done.push(i);
    else if (i.pinned) pinnedActive.push(i);
    else unpinnedActive.push(i);
  }
  return [...pinnedActive, ...unpinnedActive, ...done];
}
