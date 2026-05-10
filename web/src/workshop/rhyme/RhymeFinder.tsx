import "./RhymeFinder.css";
import { useCallback, useRef, useState, type FormEvent } from "react";
import { usePinnedRhymes, useRecentLookups } from "./rhyme-storage";

type RhymeStrength = "perfect" | "near" | "broad";

interface DatamuseWord {
  word: string;
  score?: number;
  numSyllables?: number;
  defs?: string[];
}

const STRENGTH_OPTIONS: { id: RhymeStrength; label: string; hint: string }[] = [
  { id: "perfect", label: "Perfect", hint: "Exact end-sound match (cat → hat, bat, mat)" },
  { id: "near", label: "Near", hint: "Close but not exact rhyme (cat → that, flat)" },
  { id: "broad", label: "Broad", hint: "Sounds somewhat similar (slant rhyme / loose match)" },
];

function datamuseUrl(word: string, strength: RhymeStrength): string {
  const enc = encodeURIComponent(word.trim().toLowerCase());
  const md = "&md=ds&max=30";
  if (strength === "perfect") return `https://api.datamuse.com/words?rel_rhy=${enc}${md}`;
  if (strength === "near") return `https://api.datamuse.com/words?rel_nry=${enc}${md}`;
  return `https://api.datamuse.com/words?sl=${enc}${md}`;
}

function firstDef(defs?: string[]): string {
  if (!defs?.length) return "";
  return defs[0]!.replace(/^[a-z]+\t/, "");
}

function bucketBySyllables(words: DatamuseWord[]): Array<{ key: string; label: string; words: DatamuseWord[] }> {
  const buckets = new Map<string, DatamuseWord[]>();
  for (const w of words) {
    const n = w.numSyllables ?? 0;
    const key = n === 0 ? "?" : n >= 3 ? "3" : String(n);
    const arr = buckets.get(key) ?? [];
    arr.push(w);
    buckets.set(key, arr);
  }
  const order = ["1", "2", "3", "?"];
  const out: Array<{ key: string; label: string; words: DatamuseWord[] }> = [];
  for (const k of order) {
    const arr = buckets.get(k);
    if (!arr || arr.length === 0) continue;
    const label =
      k === "1" ? "1 syllable" :
      k === "2" ? "2 syllables" :
      k === "3" ? "3+ syllables" :
                  "syllables unknown";
    out.push({ key: k, label, words: arr });
  }
  return out;
}

interface RhymeFinderProps {
  onApplyWord?: (word: string) => void;
}

export function RhymeFinder({ onApplyWord }: RhymeFinderProps = {}) {
  const [query, setQuery] = useState("");
  const [strength, setStrength] = useState<RhymeStrength>("perfect");
  const [results, setResults] = useState<DatamuseWord[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const { togglePin, isPinned } = usePinnedRhymes();
  const { recent, pushRecent } = useRecentLookups();

  const search = useCallback(async (word: string, str: RhymeStrength) => {
    const w = word.trim();
    if (!w) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus("loading");
    setErrorMsg("");
    setResults(null);
    try {
      const res = await fetch(datamuseUrl(w, str), { signal: ctrl.signal });
      if (!res.ok) throw new Error(`Rhyme API error ${res.status}`);
      const data = (await res.json()) as DatamuseWord[];
      setResults(data);
      setStatus("idle");
      pushRecent(w);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setErrorMsg("Could not reach rhyme service. Check your connection.");
      setStatus("error");
    }
  }, [pushRecent]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void search(query, strength);
  };

  const handleStrengthChange = (str: RhymeStrength) => {
    setStrength(str);
    if (query.trim() && results !== null) {
      void search(query, str);
    }
  };

  const runRecent = (w: string) => {
    setQuery(w);
    void search(w, strength);
  };

  const buckets = results ? bucketBySyllables(results) : [];

  return (
    <div className="rhyme-finder rhyme-lookup-card">
      <form className="rhyme-finder-form" onSubmit={handleSubmit}>
        <div className="rhyme-finder-input-row">
          <span className="rhyme-finder-input-icon" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </span>
          <input
            type="text"
            className="rhyme-finder-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Look up rhymes for a word…"
            aria-label="Word to rhyme"
            autoComplete="off"
            spellCheck="false"
          />
          <button
            type="submit"
            className="small-btn small-btn-primary"
            disabled={!query.trim() || status === "loading"}
          >
            {status === "loading" ? "…" : "Find"}
          </button>
        </div>
        <div className="rhyme-strength-row" role="group" aria-label="Rhyme strength">
          {STRENGTH_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`rhyme-strength-btn${strength === opt.id ? " active" : ""}`}
              title={opt.hint}
              onClick={() => handleStrengthChange(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </form>

      {recent.length > 0 ? (
        <div className="rhyme-recent-row">
          <span className="rhyme-recent-label muted small">Recent:</span>
          <div className="rhyme-recent-chips">
            {recent.map((w) => (
              <button
                key={w}
                type="button"
                className="rhyme-recent-chip"
                onClick={() => runRecent(w)}
                title={`Look up "${w}" again`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {status === "error" && (
        <p className="muted small rhyme-finder-error">{errorMsg}</p>
      )}

      {results !== null && results.length === 0 && (
        <p className="muted small rhyme-finder-empty">
          No {strength} rhymes found for &ldquo;{query}&rdquo;.
        </p>
      )}

      {results !== null && results.length > 0 && (
        <div className="rhyme-finder-results">
          <p className="rhyme-finder-results-label muted small">
            {results.length} {strength} rhyme{results.length !== 1 ? "s" : ""} for &ldquo;{query}&rdquo;
          </p>
          <div className="rhyme-bucket-stack">
            {buckets.map((b) => (
              <div key={b.key} className="rhyme-bucket">
                <span className="rhyme-bucket-label">{b.label}</span>
                <div className="rhyme-finder-chips">
                  {b.words.map((r) => {
                    const def = firstDef(r.defs);
                    const pinnedNow = isPinned(r.word);
                    return (
                      <span key={r.word} className="rhyme-chip-row">
                        <button
                          type="button"
                          className="rhyme-chip rhyme-chip-clickable"
                          onClick={() => onApplyWord?.(r.word)}
                          title={def ? `${r.word} — ${def}` : `Use "${r.word}"`}
                          disabled={!onApplyWord}
                        >
                          {r.word}
                        </button>
                        <button
                          type="button"
                          className={`rhyme-pin-btn${pinnedNow ? " is-pinned" : ""}`}
                          onClick={() => togglePin(r.word)}
                          aria-label={pinnedNow ? `Unpin ${r.word}` : `Pin ${r.word}`}
                          title={pinnedNow ? "Unpin" : "Pin — keep visible"}
                        >
                          {pinnedNow ? "★" : "☆"}
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
