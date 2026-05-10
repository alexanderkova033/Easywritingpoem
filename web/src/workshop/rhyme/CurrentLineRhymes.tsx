import { useEffect, useRef, useState } from "react";
import "./RhymeFinder.css";
import { usePinnedRhymes } from "./rhyme-storage";

interface DatamuseWord {
  word: string;
  score?: number;
  numSyllables?: number;
  defs?: string[];
}

interface Props {
  endWord: string;
  onApplyWord?: (word: string) => void;
}

function firstDef(defs?: string[]): string {
  if (!defs?.length) return "";
  const raw = defs[0]!;
  return raw.replace(/^[a-z]+\t/, "");
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

export function CurrentLineRhymes({ endWord, onApplyWord }: Props) {
  const [results, setResults] = useState<DatamuseWord[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { pinned, togglePin, isPinned } = usePinnedRhymes();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();

    const w = endWord.trim().toLowerCase();
    if (!w || w.length < 2) {
      setResults(null);
      setStatus("idle");
      return;
    }

    debounceRef.current = setTimeout(() => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStatus("loading");
      const url = `https://api.datamuse.com/words?rel_rhy=${encodeURIComponent(w)}&md=ds&max=24`;
      fetch(url, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((data: DatamuseWord[]) => {
          setResults(data);
          setStatus("idle");
        })
        .catch((err) => {
          if ((err as Error).name === "AbortError") return;
          setStatus("error");
        });
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [endWord]);

  const showAuto = !!endWord && endWord.length >= 2;
  const showPinned = pinned.length > 0;
  if (!showAuto && !showPinned) return null;

  const buckets = results ? bucketBySyllables(results) : [];

  return (
    <div className="current-line-rhymes-wrap">
      {showPinned ? (
        <div className="rhyme-pinned-strip">
          <span className="rhyme-pinned-label" aria-hidden>★</span>
          <div className="rhyme-pinned-chips">
            {pinned.map((w) => (
              <span key={w} className="rhyme-pinned-chip-row">
                <button
                  type="button"
                  className="current-line-rhyme-chip rhyme-pinned-chip"
                  onClick={() => onApplyWord?.(w)}
                  title={`Use "${w}" — replaces line's last word`}
                >
                  {w}
                </button>
                <button
                  type="button"
                  className="rhyme-pin-btn is-pinned"
                  onClick={() => togglePin(w)}
                  aria-label={`Unpin ${w}`}
                  title="Unpin"
                >
                  ★
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {showAuto ? (
        <div className="current-line-rhymes">
          <div className="current-line-rhymes-head">
            <span className="current-line-rhymes-label">Rhymes for</span>
            <span className="current-line-rhymes-word">{endWord}</span>
            {status === "loading" ? <span className="current-line-rhymes-spinner" aria-hidden>·</span> : null}
          </div>
          {status === "error" ? (
            <p className="muted small">Could not reach rhyme service.</p>
          ) : results === null ? null : results.length === 0 ? (
            <p className="muted small">No rhymes found.</p>
          ) : (
            <div className="rhyme-bucket-stack">
              {buckets.map((b) => (
                <div key={b.key} className="rhyme-bucket">
                  <span className="rhyme-bucket-label">{b.label}</span>
                  <div className="current-line-rhymes-chips">
                    {b.words.map((r) => {
                      const def = firstDef(r.defs);
                      const pinnedNow = isPinned(r.word);
                      return (
                        <span key={r.word} className="rhyme-chip-row">
                          <button
                            type="button"
                            className="current-line-rhyme-chip"
                            onClick={() => onApplyWord?.(r.word)}
                            title={def ? `${r.word} — ${def}` : `Use "${r.word}"`}
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
          )}
        </div>
      ) : null}
    </div>
  );
}
