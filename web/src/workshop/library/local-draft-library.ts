import {
  tryLocalStorageRemoveItem,
  tryLocalStorageSetItem,
} from "@/shared/platform/browser-storage";
import {
  STORAGE_KEY_DRAFT,
  STORAGE_KEY_LIBRARY,
} from "@/shared/storage-keys";
import { loadDraft, type DraftState } from "./local-draft-storage";
import {
  migrateLegacyRevisionsV1ToPoem,
  parseRevisionSnapshotsFromExport,
  setRevisionsForPoem,
  type RevisionSnapshot,
} from "./revision-snapshots";

const LIBRARY_KEY = STORAGE_KEY_LIBRARY;
const LEGACY_DRAFT_KEY = STORAGE_KEY_DRAFT;

export interface PoemRecord {
  id: string;
  title: string;
  body: string;
  form?: string;
  updatedAt: string;
}

export interface DraftLibrary {
  version: 1;
  activeId: string;
  poems: PoemRecord[];
}

function newPoemId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function readLibraryRaw(): DraftLibrary | null {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    if (o.version !== 1) return null;
    if (typeof o.activeId !== "string" || !Array.isArray(o.poems)) return null;
    const poems: PoemRecord[] = [];
    for (const p of o.poems) {
      if (!p || typeof p !== "object") continue;
      const r = p as Record<string, unknown>;
      if (
        typeof r.id !== "string" ||
        typeof r.title !== "string" ||
        typeof r.body !== "string"
      )
        continue;
      const updatedAt =
        typeof r.updatedAt === "string" ? r.updatedAt : new Date().toISOString();
      const form =
        r.form === undefined || r.form === null ? undefined : String(r.form);
      poems.push({
        id: r.id,
        title: r.title,
        body: r.body,
        updatedAt,
        ...(form ? { form } : {}),
      });
    }
    if (poems.length === 0) return null;
    if (!poems.some((x) => x.id === o.activeId)) return null;
    return { version: 1, activeId: o.activeId, poems };
  } catch {
    return null;
  }
}

export function saveLibrary(lib: DraftLibrary): boolean {
  return tryLocalStorageSetItem(LIBRARY_KEY, JSON.stringify(lib));
}

function emptyPoem(): PoemRecord {
  const id = newPoemId();
  return {
    id,
    title: "",
    body: "",
    updatedAt: new Date().toISOString(),
  };
}

function fromDraftState(d: DraftState, id: string): PoemRecord {
  return {
    id,
    title: d.title,
    body: d.body,
    updatedAt: new Date().toISOString(),
    ...(d.form ? { form: d.form } : {}),
  };
}

/**
 * Loads the poem library, migrating a legacy single-slot draft + global snapshots once.
 */
export function loadOrCreateLibrary(): DraftLibrary {
  const existing = readLibraryRaw();
  if (existing) return existing;

  const d = loadDraft();
  const id = newPoemId();
  const poem: PoemRecord = d ? fromDraftState(d, id) : { ...emptyPoem(), id };
  const lib: DraftLibrary = { version: 1, activeId: id, poems: [poem] };
  void saveLibrary(lib);
  migrateLegacyRevisionsV1ToPoem(id);
  void tryLocalStorageRemoveItem(LEGACY_DRAFT_KEY);
  return lib;
}

export function poemById(lib: DraftLibrary, id: string): PoemRecord | undefined {
  return lib.poems.find((p) => p.id === id);
}

export function upsertActivePoem(
  lib: DraftLibrary,
  patch: Pick<PoemRecord, "title" | "body"> & {
    form?: string;
  },
): DraftLibrary {
  const now = new Date().toISOString();
  const poems = lib.poems.map((p) => {
    if (p.id !== lib.activeId) return p;
    const next: PoemRecord = {
      ...p,
      title: patch.title,
      body: patch.body,
      updatedAt: now,
    };
    if (patch.form !== undefined) {
      if (patch.form.trim()) next.form = patch.form.trim();
      else delete next.form;
    }
    return next;
  });
  return { ...lib, poems };
}

export function setActivePoem(lib: DraftLibrary, activeId: string): DraftLibrary | null {
  if (!lib.poems.some((p) => p.id === activeId)) return null;
  return { ...lib, activeId };
}

export function addPoem(lib: DraftLibrary, poem: PoemRecord): DraftLibrary {
  return { ...lib, poems: [...lib.poems, poem], activeId: poem.id };
}

export function duplicatePoemById(
  lib: DraftLibrary,
  poemId: string,
): DraftLibrary | null {
  const cur = poemById(lib, poemId);
  if (!cur) return null;
  const copy: PoemRecord = {
    id: newPoemId(),
    title: cur.title ? `${cur.title} (copy)` : "",
    body: cur.body,
    updatedAt: new Date().toISOString(),
    ...(cur.form ? { form: cur.form } : {}),
  };
  return addPoem(lib, copy);
}

export function duplicateActivePoem(lib: DraftLibrary): DraftLibrary | null {
  return duplicatePoemById(lib, lib.activeId);
}

export function newBlankPoemAfter(lib: DraftLibrary): DraftLibrary {
  const p = emptyPoem();
  return addPoem(lib, p);
}

/** Removes a poem; if it was the last one, inserts a fresh blank poem. */
export function removePoem(lib: DraftLibrary, poemId: string): DraftLibrary {
  let poems = lib.poems.filter((p) => p.id !== poemId);
  if (poems.length === 0) {
    poems = [emptyPoem()];
  }
  let activeId = lib.activeId;
  if (activeId === poemId) {
    activeId = poems[0]!.id;
  }
  return { ...lib, poems, activeId };
}

export const WORKSHOP_EXPORT_MARK = "easyPoemsWorkshopExport" as const;
export const WORKSHOP_EXPORT_VERSION = 1 as const;

export interface WorkshopExportPoem {
  title: string;
  body: string;
  form?: string;
  updatedAt?: string;
  revisions?: RevisionSnapshot[];
}

export interface WorkshopExportFile {
  [WORKSHOP_EXPORT_MARK]: true;
  version: typeof WORKSHOP_EXPORT_VERSION;
  exportedAt: string;
  poems: WorkshopExportPoem[];
}

export function buildWorkshopExportJson(input: {
  poems: PoemRecord[];
  revisionsForPoem: (poemId: string) => RevisionSnapshot[];
}): string {
  const exportedAt = new Date().toISOString();
  const poems: WorkshopExportPoem[] = input.poems.map((p) => ({
    title: p.title,
    body: p.body,
    ...(p.form ? { form: p.form } : {}),
    updatedAt: p.updatedAt,
    revisions: input.revisionsForPoem(p.id),
  }));
  const payload: WorkshopExportFile = {
    [WORKSHOP_EXPORT_MARK]: true,
    version: WORKSHOP_EXPORT_VERSION,
    exportedAt,
    poems,
  };
  return JSON.stringify(payload, null, 2);
}

export interface ImportMergeResult {
  added: number;
  lib: DraftLibrary;
}

export function mergeImportedPoems(
  lib: DraftLibrary,
  rawJson: string,
): ImportMergeResult | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson) as unknown;
  } catch {
    return { error: "That file is not valid JSON." };
  }
  if (!parsed || typeof parsed !== "object") return { error: "Invalid backup format." };
  const o = parsed as Record<string, unknown>;
  if (o[WORKSHOP_EXPORT_MARK] !== true) {
    return { error: "Not an Easy-poems workshop backup." };
  }
  if (o.version !== 1 || !Array.isArray(o.poems)) {
    return {
      error:
        "This backup was created with an incompatible version of Easy-poems and cannot be imported. " +
        "Try exporting a fresh backup from the version you used to create this file.",
    };
  }
  let added = 0;
  let next = lib;
  for (const item of o.poems) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    if (typeof p.title !== "string" || typeof p.body !== "string") continue;
    const id = newPoemId();
    const form =
      p.form === undefined || p.form === null ? undefined : String(p.form);
    const poem: PoemRecord = {
      id,
      title: p.title,
      body: p.body,
      updatedAt:
        typeof p.updatedAt === "string" ? p.updatedAt : new Date().toISOString(),
      ...(form?.trim() ? { form: form.trim() } : {}),
    };
    next = { ...next, poems: [...next.poems, poem], activeId: id };
    added++;
    const revs = parseRevisionSnapshotsFromExport(p.revisions);
    if (revs.length) {
      void setRevisionsForPoem(id, revs);
    }
  }
  if (added === 0) return { error: "No poems found in that file." };
  return { added, lib: next };
}
