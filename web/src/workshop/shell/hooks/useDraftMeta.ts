import { useCallback, useMemo, useState } from "react";
import {
  loadDraftMetaMap,
  saveDraftMetaMap,
  upsertDraftMeta,
  type DraftMetaMap,
} from "@/workshop/library/library-meta";
import type { DraftLibrary } from "@/workshop/library/local-draft-library";

export interface DraftMetaState {
  meta: DraftMetaMap;
  setMeta: React.Dispatch<React.SetStateAction<DraftMetaMap>>;
  poemOptions: Array<{ id: string; label: string; archived: boolean }>;
  setDraftLabel: (poemId: string, label: string) => void;
  togglePinned: (poemId: string) => void;
  setDraftTags: (poemId: string, tags: string[]) => void;
  setDraftArchived: (poemId: string, archived: boolean) => void;
}

export function useDraftMeta(library: DraftLibrary): DraftMetaState {
  const [meta, setMeta] = useState<DraftMetaMap>(() => loadDraftMetaMap());

  const poemOptions = useMemo(() => {
    const labelFor = (p: (typeof library.poems)[0]) =>
      meta[p.id]?.label?.trim() || p.title.trim() || "Untitled";
    return library.poems
      .slice()
      .filter(
        (p) => !meta[p.id]?.archived || p.id === library.activeId,
      )
      .sort((a, b) => {
        const ma = meta[a.id] ?? {};
        const mb = meta[b.id] ?? {};
        const pa = ma.pinned ? 1 : 0;
        const pb = mb.pinned ? 1 : 0;
        if (pa !== pb) return pb - pa;
        const oa = ma.lastOpenedAt ? new Date(ma.lastOpenedAt).getTime() : 0;
        const ob = mb.lastOpenedAt ? new Date(mb.lastOpenedAt).getTime() : 0;
        if (oa !== ob) return ob - oa;
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      })
      .map((p) => ({
        id: p.id,
        label: labelFor(p),
        archived: Boolean(meta[p.id]?.archived),
      }));
  }, [library.poems, library.activeId, meta]);

  const setDraftLabel = useCallback((poemId: string, label: string) => {
    setMeta((prev) => {
      const patched = upsertDraftMeta(prev, poemId, { label });
      void saveDraftMetaMap(patched);
      return patched;
    });
  }, []);

  const togglePinned = useCallback((poemId: string) => {
    setMeta((prev) => {
      const pinned = Boolean(prev[poemId]?.pinned);
      const patched = upsertDraftMeta(prev, poemId, { pinned: !pinned });
      void saveDraftMetaMap(patched);
      return patched;
    });
  }, []);

  const setDraftTags = useCallback((poemId: string, tags: string[]) => {
    setMeta((prev) => {
      const patched = upsertDraftMeta(prev, poemId, { tags });
      void saveDraftMetaMap(patched);
      return patched;
    });
  }, []);

  const setDraftArchived = useCallback(
    (poemId: string, archived: boolean) => {
      setMeta((prev) => {
        const patched = upsertDraftMeta(prev, poemId, { archived });
        void saveDraftMetaMap(patched);
        return patched;
      });
    },
    [],
  );

  return {
    meta,
    setMeta,
    poemOptions,
    setDraftLabel,
    togglePinned,
    setDraftTags,
    setDraftArchived,
  };
}
