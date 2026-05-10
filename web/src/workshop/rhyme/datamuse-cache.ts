interface DatamuseWord {
  word: string;
  score?: number;
  numSyllables?: number;
  defs?: string[];
}

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const SS_PREFIX = "easy-poems:dm:";

interface Entry {
  fetchedAt: number;
  data: DatamuseWord[];
}

const memCache = new Map<string, Entry>();

function readSession(url: string): Entry | null {
  try {
    const raw = sessionStorage.getItem(SS_PREFIX + url);
    if (!raw) return null;
    const e = JSON.parse(raw) as Entry;
    if (!e?.fetchedAt || !Array.isArray(e.data)) return null;
    return e;
  } catch {
    return null;
  }
}

function writeSession(url: string, entry: Entry): void {
  try {
    sessionStorage.setItem(SS_PREFIX + url, JSON.stringify(entry));
  } catch {
    /* quota — ignore */
  }
}

export async function datamuseFetch(
  url: string,
  signal?: AbortSignal,
): Promise<DatamuseWord[]> {
  const now = Date.now();

  const memHit = memCache.get(url);
  if (memHit && now - memHit.fetchedAt < TTL_MS) return memHit.data;

  const ssHit = readSession(url);
  if (ssHit && now - ssHit.fetchedAt < TTL_MS) {
    memCache.set(url, ssHit);
    return ssHit.data;
  }

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Datamuse error ${res.status}`);
  const data = (await res.json()) as DatamuseWord[];
  const entry: Entry = { fetchedAt: now, data };
  memCache.set(url, entry);
  writeSession(url, entry);
  return data;
}
