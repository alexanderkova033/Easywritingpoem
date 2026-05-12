import type { ReactNode } from "react";
import type { ChecklistItem } from "@/workshop/analysis/publication-checklist";
import type { LineStressSource } from "@/workshop/meter/meter-hints";

export const LINES_TABLE_MAX = 400;
export const METER_TABLE_MAX = 400;

export function meterStressSourceMark(s: LineStressSource): string {
  if (s === "lexicon") return "✓";
  if (s === "mixed") return "~";
  return "—";
}

export function meterStressSourceHint(s: LineStressSource): string {
  if (s === "lexicon") return "Stress from CMU dictionary for this line";
  if (s === "mixed") return "Mixed dictionary + heuristic stress";
  return "Heuristic stress (word not in CMU list or invented)";
}

export function checklistJumpLabel(item: ChecklistItem): string {
  if (item.focusTitleField) return "Focus title";
  switch (item.openToolTab) {
    case "lines":
      return "Lines";
    case "spell":
      return "Spelling";
    case "goals":
      return "Goals";
    default:
      return "Open";
  }
}

export function endWordOfLine(line: string | undefined): string {
  if (!line) return "";
  const m = line.match(/[a-zA-Z']+(?=[^a-zA-Z']*$)/);
  return m ? m[0] : "";
}

export function escapeRegex(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

export function buildPhraseRegexSource(phrase: string): string {
  const words = phrase.split(/\s+/).filter(Boolean).map(escapeRegex);
  if (words.length === 0) return "(?!)";
  return words.join("[^A-Za-z']+");
}

export function buildPhraseRegex(phrase: string): RegExp {
  return new RegExp(buildPhraseRegexSource(phrase), "gi");
}

export function highlightInLine(
  lineText: string,
  match: string | RegExp,
): ReactNode[] {
  const out: ReactNode[] = [];
  const source = typeof match === "string" ? escapeRegex(match) : match.source;
  const flags = typeof match === "string" ? "gi" : (match.flags.includes("g") ? match.flags : match.flags + "g");
  const re = new RegExp(source, flags);
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lineText)) !== null) {
    if (m.index > lastIndex) {
      out.push(lineText.slice(lastIndex, m.index));
    }
    out.push(
      <mark key={`${m.index}-${m[0]}`} className="rep-highlight">
        {m[0]}
      </mark>,
    );
    lastIndex = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (lastIndex < lineText.length) {
    out.push(lineText.slice(lastIndex));
  }
  return out;
}
