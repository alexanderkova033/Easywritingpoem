import "./RhymeFinder.css";
import { useCallback, useRef, useState, type FormEvent } from "react";

type RhymeStrength = "perfect" | "near" | "broad";

interface DatamuseWord {
  word: string;
  score?: number;
  numSyllables?: number;
}

const STRENGTH_OPTIONS: { id: RhymeStrength; label: string; hint: string }[] = [
  { id: "perfect", label: "Perfect", hint: "Exact end-sound match (cat → hat, bat, mat)" },
  { id: "near", label: "Near", hint: "Close but not exact rhyme (cat → that, flat)" },
  { id: "broad", label: "Broad", hint: "Sounds somewhat similar (slant rhyme / loose match)" },
];

function datamuseUrl(word: string, strength: RhymeStrength): string {
  const enc = encodeURIComponent(word.trim().toLowerCase());
  if (strength === "perfect") return `https://api.datamuse.com/words?rel_rhy=${enc}&max=30`;
  if (strength === "near") return `https://api.datamuse.com/words?rel_nry=${enc}&max=30`;
  return `https://api.datamuse.com/words?sl=${enc}&max=30`;
}

export function RhymeFinder() {
  const [query, setQuery] = useState("");
  const [strength, setStrength] = useState<RhymeStrength>("perfect");
  const [results, setResults] = useState<DatamuseWord[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const abortRef = useRef<AbortController | null>(null);

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
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setErrorMsg("Could not reach rhyme service. Check your connection.");
      setStatus("error");
    }
  }, []);

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

  return (
    <div className="rhyme-finder">
      <h4 className="tool-subheading rhyme-finder-heading">Find rhymes</h4>
      <form className="rhyme-finder-form" onSubmit={handleSubmit}>
        <div className="rhyme-finder-input-row">
          <input
            type="text"
            className="rhyme-finder-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a word…"
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
          <div className="rhyme-finder-chips">
            {results.map((r) => (
              <span key={r.word} className="rhyme-chip">
                {r.word}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
