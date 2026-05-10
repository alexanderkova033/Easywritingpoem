import "./RhymeFinder.css";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { usePinnedRhymes, useRecentLookups } from "./rhyme-storage";
import { datamuseFetch } from "./datamuse-cache";

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
  /** When this changes, query is replaced with `word` and search runs. Bump
   *  triggers re-apply for the same word (e.g. clicking the same end-word twice). */
  externalQuery?: { word: string; bump: number };
  /** Hover-highlight callback — pass the hovered suggestion to highlight matching
   *  end-words in the editor. Called with null when hover ends. */
  onHoverWord?: (word: string | null) => void;
}

const COLLAPSED_KEY = "easy-poems:rhyme-finder-collapsed";
function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) !== "0"; } catch { return true; }
}
function writeCollapsed(v: boolean): void {
  try { localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0"); } catch { /* ignore */ }
}

export function RhymeFinder({ onApplyWord, externalQuery, onHoverWord }: RhymeFinderProps = {}) {
  const [query, setQuery] = useState("");
  const [strength, setStrength] = useState<RhymeStrength>("perfect");
  const [results, setResults] = useState<DatamuseWord[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed());
  const abortRef = useRef<AbortController | null>(null);
  const { pinned, togglePin, isPinned } = usePinnedRhymes();
  const { recent, pushRecent } = useRecentLookups();

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      writeCollapsed(next);
      return next;
    });
  };

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
      const data = (await datamuseFetch(datamuseUrl(w, str), ctrl.signal)) as DatamuseWord[];
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

  // External-driven query (cursor-line end word, click in editor, etc.).
  const lastExternalKey = useRef<string>("");
  useEffect(() => {
    if (!externalQuery) return;
    const w = externalQuery.word.trim();
    if (!w) return;
    const key = `${w}:${externalQuery.bump}`;
    if (key === lastExternalKey.current) return;
    lastExternalKey.current = key;
    setQuery(w);
    if (collapsed) {
      setCollapsed(false);
      writeCollapsed(false);
    }
    void search(w, strength);
  }, [externalQuery, search, strength, collapsed]);

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
    <div className={`rhyme-finder rhyme-lookup-card${collapsed ? " is-collapsed" : ""}`}>
      <button
        type="button"
        className="rhyme-finder-toggle"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        title={collapsed ? "Open rhyme finder" : "Close rhyme finder"}
      >
        <span className={`rhyme-finder-chevron${collapsed ? "" : " is-open"}`} aria-hidden>▸</span>
        <span className="rhyme-finder-toggle-label">Find a rhyme</span>
        {query ? <span className="rhyme-finder-toggle-word">{query}</span> : null}
        {pinned.length > 0 ? <span className="rhyme-finder-pin-count" title={`${pinned.length} pinned`}>★ {pinned.length}</span> : null}
      </button>
      {collapsed ? null : (
      <>
      {pinned.length > 0 ? (
        <div className="rhyme-pinned-strip rhyme-pinned-strip-compact">
          <span className="rhyme-pinned-label" aria-hidden>★</span>
          <div className="rhyme-pinned-chips">
            {pinned.map((w) => (
              <button
                key={w}
                type="button"
                className="rhyme-pinned-chip-compact"
                onClick={() => onApplyWord?.(w)}
                onMouseEnter={() => onHoverWord?.(w)}
                onMouseLeave={() => onHoverWord?.(null)}
                onFocus={() => onHoverWord?.(w)}
                onBlur={() => onHoverWord?.(null)}
                title={`Use "${w}" — click × to unpin`}
              >
                <span className="rhyme-pinned-chip-word">{w}</span>
                <span
                  className="rhyme-pinned-chip-unpin"
                  role="button"
                  aria-label={`Unpin ${w}`}
                  onClick={(e) => { e.stopPropagation(); togglePin(w); }}
                >
                  ×
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
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

      </>
      )}
      {!collapsed && results !== null && results.length > 0 && (
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
                          onMouseEnter={() => onHoverWord?.(r.word)}
                          onMouseLeave={() => onHoverWord?.(null)}
                          onFocus={() => onHoverWord?.(r.word)}
                          onBlur={() => onHoverWord?.(null)}
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
