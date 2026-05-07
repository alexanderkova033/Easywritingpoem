/** Approximate English syllable count (heuristic; not linguistically exact). */
export function countSyllablesInWord(raw: string): number {
  const w = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;

  let count = 0;
  let prevVowel = false;
  for (let i = 0; i < w.length; i++) {
    const v = "aeiouy".includes(w[i]!);
    if (v && !prevVowel) count++;
    prevVowel = v;
  }

  if (w.endsWith("e") && count > 1) count--;
  if (w.endsWith("le") && w.length > 2 && !"aeiouy".includes(w[w.length - 3]!)) {
    if (count === 0) count = 1;
    else count++;
  }

  return Math.max(1, count);
}

export function countSyllablesInLine(line: string): number {
  const parts = line.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 0;
  let sum = 0;
  for (const p of parts) {
    sum += countSyllablesInWord(p);
  }
  return sum;
}
