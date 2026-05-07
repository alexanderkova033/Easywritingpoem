const WORD_RE = /[a-zA-Z']+/g;

export interface WordSpan {
  start: number;
  end: number;
  raw: string;
}

export function wordSpansInLine(line: string): WordSpan[] {
  const out: WordSpan[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(WORD_RE.source, "g");
  while ((m = re.exec(line)) !== null) {
    const raw = m[0]!;
    out.push({ start: m.index, end: m.index + raw.length, raw });
  }
  return out;
}

export function wordsInLine(line: string): string[] {
  return wordSpansInLine(line).map((s) => s.raw);
}

export function lastWordInLine(line: string): string | null {
  const w = wordsInLine(line);
  return w.length ? w[w.length - 1]! : null;
}

export function normalizeWordToken(raw: string): string {
  return raw.replace(/^'+|'+$/g, "").toLowerCase();
}
