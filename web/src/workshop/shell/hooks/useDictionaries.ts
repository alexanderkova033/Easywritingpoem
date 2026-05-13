import { useEffect, useState } from "react";
import { loadEnglishWordlist } from "@/spellcheck/wordlist";
import { loadStressLexicon } from "@/workshop/meter/cmu-stress-lexicon";

type IdleCb = (cb: () => void, opts?: { timeout: number }) => number;
type CancelIdleCb = (id: number) => void;

function scheduleIdle(run: () => void, fallbackDelayMs: number, timeoutMs: number) {
  const ric = (window as { requestIdleCallback?: IdleCb }).requestIdleCallback;
  const cic = (window as { cancelIdleCallback?: CancelIdleCb }).cancelIdleCallback;
  if (typeof ric === "function") {
    const id = ric(run, { timeout: timeoutMs });
    return () => { if (typeof cic === "function") cic(id); };
  }
  const t = window.setTimeout(run, fallbackDelayMs);
  return () => window.clearTimeout(t);
}

export interface DictionariesState {
  wordlist: Set<string> | null;
  wordlistErr: string | null;
  retryWordlist: () => void;
  stressLexicon: Map<string, string> | null;
  stressLexiconErr: string | null;
}

export function useDictionaries(): DictionariesState {
  const [wordlist, setWordlist] = useState<Set<string> | null>(null);
  const [wordlistErr, setWordlistErr] = useState<string | null>(null);
  const [wordlistRetryBump, setWordlistRetryBump] = useState(0);
  const [stressLexicon, setStressLexicon] = useState<Map<string, string> | null>(null);
  const [stressLexiconErr, setStressLexiconErr] = useState<string | null>(null);

  const retryWordlist = () => setWordlistRetryBump((n) => n + 1);

  useEffect(() => {
    setWordlistErr(null);
    const run = () => {
      void loadEnglishWordlist()
        .then((w) => {
          setWordlist(w);
          setWordlistErr(null);
        })
        .catch((e) => {
          setWordlistErr(e instanceof Error ? e.message : "Could not load word list.");
        });
    };
    return scheduleIdle(run, 800, 2000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordlistRetryBump]);

  useEffect(() => {
    const run = () => {
      void loadStressLexicon()
        .then((m) => {
          setStressLexicon(m);
          setStressLexiconErr(null);
        })
        .catch((e) => {
          setStressLexicon(null);
          setStressLexiconErr(
            e instanceof Error ? e.message : "Could not load stress dictionary.",
          );
        });
    };
    return scheduleIdle(run, 1200, 2500);
  }, []);

  return { wordlist, wordlistErr, retryWordlist, stressLexicon, stressLexiconErr };
}
