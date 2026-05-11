import {
  tryLocalStorageRemoveItem,
  tryLocalStorageSetItem,
} from "@/shared/platform/browser-storage";
import {
  STORAGE_KEY_REVISIONS_V1,
  STORAGE_KEY_REVISIONS_V2,
} from "@/shared/storage-keys";

const STORAGE_V1 = STORAGE_KEY_REVISIONS_V1;
const STORAGE_V2 = STORAGE_KEY_REVISIONS_V2;
const MAX_SNAPSHOTS = 50;

export interface RevisionSnapshot {
  id: string;
  createdAt: string;
  label?: string;
  title: string;
  body: string;
  form?: string;
  /** AI overall score at time of snapshot, if analysis was run. */
  aiScore?: number;
}

function parseSnapshotItem(item: unknown): RevisionSnapshot | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.createdAt !== "string") return null;
  if (typeof o.title !== "string" || typeof o.body !== "string") return null;
  return {
    id: o.id,
    createdAt: o.createdAt,
    ...(typeof o.label === "string" ? { label: o.label } : {}),
    title: o.title,
    body: o.body,
    ...(typeof o.form === "string" ? { form: o.form } : {}),
    ...(typeof o.aiScore === "number" ? { aiScore: o.aiScore } : {}),
  };
}

function parseV1Array(raw: unknown): RevisionSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: RevisionSnapshot[] = [];
  for (const item of raw) {
    const s = parseSnapshotItem(item);
    if (s) out.push(s);
  }
  return out;
}

function readMap(): Record<string, RevisionSnapshot[]> {
  try {
    const v2 = localStorage.getItem(STORAGE_V2);
    if (v2) {
      const p = JSON.parse(v2) as unknown;
      if (p && typeof p === "object" && !Array.isArray(p)) {
        const out: Record<string, RevisionSnapshot[]> = {};
        for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
          if (!Array.isArray(v)) continue;
          const snaps = parseV1Array(v);
          if (snaps.length) out[k] = snaps;
        }
        return out;
      }
    }
  } catch {
    /* ignore */
  }
  return {};
}

function writeMap(map: Record<string, RevisionSnapshot[]>): boolean {
  return tryLocalStorageSetItem(STORAGE_V2, JSON.stringify(map));
}

/** When the poem library is first created, move legacy global snapshots under that poem. */
export function migrateLegacyRevisionsV1ToPoem(poemId: string): void {
  try {
    const existing = localStorage.getItem(STORAGE_V2);
    if (existing) {
      const map = readMap();
      if (Object.keys(map).length > 0) return;
    }
    const rawV1 = localStorage.getItem(STORAGE_V1);
    if (!rawV1) return;
    const arr = parseV1Array(JSON.parse(rawV1) as unknown);
    void tryLocalStorageRemoveItem(STORAGE_V1);
    if (arr.length === 0) return;
    const map: Record<string, RevisionSnapshot[]> = { [poemId]: arr };
    void writeMap(map);
  } catch {
    /* ignore */
  }
}

export function loadRevisions(poemId: string): RevisionSnapshot[] {
  const map = readMap();
  return map[poemId] ?? [];
}

export function saveRevisionsForPoem(
  poemId: string,
  snapshots: RevisionSnapshot[],
): boolean {
  const map = readMap();
  const trimmed = snapshots.slice(0, MAX_SNAPSHOTS);
  map[poemId] = trimmed;
  return writeMap(map);
}

/** Replace snapshots for a poem (e.g. after import). */
export function setRevisionsForPoem(
  poemId: string,
  snapshots: RevisionSnapshot[],
): boolean {
  return saveRevisionsForPoem(poemId, snapshots);
}

export function removeRevisionsForPoem(poemId: string): void {
  const map = readMap();
  delete map[poemId];
  void writeMap(map);
}

export function addRevision(
  poemId: string,
  current: RevisionSnapshot[],
  draft: {
    title: string;
    body: string;
    form?: string;
    label?: string;
    aiScore?: number;
  },
): { ok: boolean; revisions: RevisionSnapshot[]; duplicate?: boolean } {
  const prev = current[0];
  if (
    prev &&
    prev.body === draft.body &&
    prev.title === draft.title &&
    (prev.form ?? "") === (draft.form ?? "")
  ) {
    return { ok: true, revisions: current, duplicate: true };
  }
  const snap: RevisionSnapshot = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    title: draft.title,
    body: draft.body,
    ...(draft.form ? { form: draft.form } : {}),
    ...(draft.label?.trim() ? { label: draft.label.trim() } : {}),
    ...(draft.aiScore != null ? { aiScore: draft.aiScore } : {}),
  };
  const next = [snap, ...current].slice(0, MAX_SNAPSHOTS);
  if (!saveRevisionsForPoem(poemId, next)) return { ok: false, revisions: current };
  return { ok: true, revisions: next };
}

export function removeRevision(
  poemId: string,
  current: RevisionSnapshot[],
  id: string,
): { ok: boolean; revisions: RevisionSnapshot[] } {
  const next = current.filter((s) => s.id !== id);
  if (!saveRevisionsForPoem(poemId, next)) return { ok: false, revisions: current };
  return { ok: true, revisions: next };
}

export function parseRevisionSnapshotsFromExport(
  raw: unknown,
): RevisionSnapshot[] {
  return parseV1Array(raw).slice(0, MAX_SNAPSHOTS);
}
