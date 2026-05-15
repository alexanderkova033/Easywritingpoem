// When a new deploy ships, hashed chunk filenames change. A tab still holding
// the previous index.html will try to fetch a chunk that no longer exists and
// throw "Failed to fetch dynamically imported module". Hard-reload once so the
// browser fetches a fresh index.html (which references the new chunk hashes).
// SessionStorage guard prevents a reload loop if the failure has another cause.

const RELOAD_FLAG = "__chunk_reload_attempted__";

const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
];

function isChunkLoadError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return CHUNK_ERROR_PATTERNS.some((re) => re.test(message));
}

export function lazyWithReload<T>(loader: () => Promise<T>): () => Promise<T> {
  return () =>
    loader().catch((err) => {
      if (!isChunkLoadError(err)) throw err;
      try {
        if (sessionStorage.getItem(RELOAD_FLAG)) throw err;
        sessionStorage.setItem(RELOAD_FLAG, "1");
      } catch {
        throw err;
      }
      location.reload();
      // Block the suspense fallback from resolving while the reload is in flight.
      return new Promise<T>(() => {});
    });
}

// Call once on a successful app render so the next chunk error gets a fresh attempt.
export function clearChunkReloadFlag(): void {
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // ignore
  }
}
