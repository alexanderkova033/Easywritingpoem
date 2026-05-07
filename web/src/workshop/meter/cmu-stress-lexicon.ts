let cache: Map<string, string> | null = null;
let loadPromise: Promise<Map<string, string>> | null = null;

/** Load word → stress pattern (x /) from public/cmu-stress.txt. */
export function loadStressLexicon(): Promise<Map<string, string>> {
  if (cache) return Promise.resolve(cache);
  if (!loadPromise) {
    const url = `${import.meta.env.BASE_URL}cmu-stress.txt`;
    loadPromise = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Stress lexicon failed (${r.status})`);
        return r.text();
      })
      .then((text) => {
        const m = new Map<string, string>();
        for (const line of text.split("\n")) {
          const t = line.trim();
          if (!t || t.startsWith("#")) continue;
          const tab = t.indexOf("\t");
          if (tab < 0) continue;
          const word = t.slice(0, tab).toLowerCase();
          const pat = t.slice(tab + 1).trim();
          if (word && pat) m.set(word, pat);
        }
        cache = m;
        return m;
      });
  }
  return loadPromise;
}

export function clearStressLexiconCacheForTests(): void {
  cache = null;
  loadPromise = null;
}
