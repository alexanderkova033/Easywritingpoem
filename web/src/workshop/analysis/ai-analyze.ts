/**
 * Browser-side calls to the /api/* serverless endpoints.
 * The OpenAI key lives on the server — the browser never touches it.
 */

export interface AnalysisMeta {
  model: string;
  analyzedAt: string;
}

export type Confidence = "high" | "medium" | "low";

export interface AnalysisIssue {
  id: string;
  severity?: "high" | "medium" | "low";
  /** How sure the model is this is actually a problem (vs taste). */
  confidence?: Confidence;
  line_start: number;
  line_end: number;
  excerpt?: string;
  problem_words?: string[];
  /** One-line preview shown when the issue card is collapsed. */
  headline?: string;
  rationale: string;
  improvements: string[];
  /** Concrete rewritten version of the line(s), when provided by the model. */
  rewrite?: string;
}

export interface StrongestLine {
  line: number;
  excerpt: string;
  why: string;
}

export interface PoemAnalysis {
  meta: AnalysisMeta;
  overall_score: number;
  warm_reaction?: string;
  summary?: string;
  strengths?: string[];
  weaknesses?: string[];
  strongest_line?: StrongestLine;
  overall_direction?: string;
  /** 2-3 sentence holistic read of the poem as a whole. */
  overall_feedback?: string;
  /** 2-3 sentences addressed to the writer ("you"), warm/mentor tone. */
  personal_feedback?: string;
  clarifying_question?: string;
  issues: AnalysisIssue[];
}

export interface LocalAnalysisContext {
  cliches: Array<{ phrase: string; lineNumber: number }>;
  rhymeScheme: string[];
  syllablesPerLine: number[];
  repeatedWords: Array<{ word: string; count: number; lines: number[] }>;
  form: string;
}

/** Heuristic poem-form detection based on line count and syllable counts. */
export function detectPoemForm(lines: string[], syllablesPerLine: number[]): string {
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length === 3) {
    const nonEmptySyl = lines
      .map((l, i) => (l.trim() ? (syllablesPerLine[i] ?? 0) : null))
      .filter((s): s is number => s !== null);
    if (
      nonEmptySyl.length === 3 &&
      Math.abs(nonEmptySyl[0]! - 5) <= 1 &&
      Math.abs(nonEmptySyl[1]! - 7) <= 1 &&
      Math.abs(nonEmptySyl[2]! - 5) <= 1
    ) {
      return "haiku";
    }
  }
  if (nonEmpty.length === 14) return "sonnet";
  if (nonEmpty.length === 19) return "villanelle";
  return "free";
}

function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : parseInt(String(n), 10);
  if (!Number.isFinite(v)) return 50;
  return Math.max(1, Math.min(100, Math.round(v)));
}

function parseSeverity(v: unknown): "high" | "medium" | "low" | undefined {
  if (v === "high" || v === "medium" || v === "low") return v;
  return undefined;
}

function parseConfidence(v: unknown): Confidence | undefined {
  if (v === "high" || v === "medium" || v === "low") return v;
  return undefined;
}

function parseStringArray(v: unknown, max: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = (v as unknown[])
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, max);
  return out.length > 0 ? out : undefined;
}

function parseStrongestLine(v: unknown): StrongestLine | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const line = typeof o.line === "number" ? o.line : parseInt(String(o.line), 10);
  if (!Number.isFinite(line) || line < 1) return undefined;
  const excerpt = typeof o.excerpt === "string" ? o.excerpt.trim() : "";
  const why = typeof o.why === "string" ? o.why.trim() : "";
  if (!excerpt && !why) return undefined;
  return { line: Math.round(line), excerpt, why };
}

function parseAnalysis(obj: Record<string, unknown>): PoemAnalysis {
  const issuesRaw = Array.isArray(obj.issues) ? obj.issues : [];
  const meta = (obj.meta ?? {}) as Record<string, unknown>;

  return {
    meta: {
      model: typeof meta.model === "string" ? meta.model : "gpt-5-nano",
      analyzedAt:
        typeof meta.analyzedAt === "string" ? meta.analyzedAt : new Date().toISOString(),
    },
    overall_score: clampScore(obj.overall_score),
    warm_reaction: typeof obj.warm_reaction === "string" && obj.warm_reaction.trim()
      ? obj.warm_reaction.trim() : undefined,
    summary: typeof obj.summary === "string" ? obj.summary : undefined,
    strengths: parseStringArray(obj.strengths, 4),
    weaknesses: parseStringArray(obj.weaknesses, 4),
    strongest_line: parseStrongestLine(obj.strongest_line),
    overall_direction: typeof obj.overall_direction === "string" ? obj.overall_direction : undefined,
    overall_feedback: typeof obj.overall_feedback === "string" && obj.overall_feedback.trim()
      ? obj.overall_feedback.trim() : undefined,
    personal_feedback: typeof obj.personal_feedback === "string" && obj.personal_feedback.trim()
      ? obj.personal_feedback.trim() : undefined,
    clarifying_question: typeof obj.clarifying_question === "string" && obj.clarifying_question.trim()
      ? obj.clarifying_question.trim() : undefined,
    issues: issuesRaw
      .filter((x): x is Record<string, unknown> => x !== null && typeof x === "object")
      .map((iss, idx) => ({
        id: typeof iss.id === "string" ? iss.id : `issue-${idx + 1}`,
        severity: parseSeverity(iss.severity),
        confidence: parseConfidence(iss.confidence),
        line_start: clampScore(iss.line_start),
        line_end: clampScore(iss.line_end),
        excerpt: typeof iss.excerpt === "string" ? iss.excerpt : undefined,
        problem_words: Array.isArray(iss.problem_words)
          ? (iss.problem_words as unknown[])
              .filter((s): s is string => typeof s === "string")
              .slice(0, 3)
          : undefined,
        headline: typeof iss.headline === "string" && iss.headline.trim()
          ? iss.headline.trim() : undefined,
        rationale: typeof iss.rationale === "string" ? iss.rationale : "",
        improvements: Array.isArray(iss.improvements)
          ? (iss.improvements as unknown[])
              .filter((s): s is string => typeof s === "string")
              .slice(0, 3)
          : [],
        rewrite: typeof iss.rewrite === "string" && iss.rewrite.trim() ? iss.rewrite.trim() : undefined,
      })),
  };
}

export interface ComparisonChanges {
  summary: string;
  improvements: string[];
  regressions: string[];
  unchanged: string[];
}

export interface PoemComparison extends PoemAnalysis {
  comparison: ComparisonChanges;
}

function parseComparison(obj: Record<string, unknown>): PoemComparison {
  const base = parseAnalysis(obj);
  const c = (obj.comparison ?? {}) as Record<string, unknown>;
  const toStrArr = (v: unknown) =>
    Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return {
    ...base,
    comparison: {
      summary: typeof c.summary === "string" ? c.summary : "",
      improvements: toStrArr(c.improvements),
      regressions: toStrArr(c.regressions),
      unchanged: toStrArr(c.unchanged),
    },
  };
}

/**
 * Build a compact line-level diff between two drafts. We send this instead of
 * the entire previous version so the model doesn't pay tokens for unchanged
 * lines. Uses a simple LCS to align lines, then coalesces removed+added pairs
 * into "changed" entries when they touch.
 */
export function buildChangesText(prev: string[], curr: string[]): string {
  const n = prev.length;
  const m = curr.length;
  // dp[i][j] = LCS of prev[i..] and curr[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (prev[i] === curr[j]) dp[i]![j]! = dp[i + 1]![j + 1]! + 1;
      else dp[i]![j]! = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  type RawOp = { type: "removed"; oldLine: number; oldText: string }
    | { type: "added"; newLine: number; newText: string };
  const ops: RawOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (prev[i] === curr[j]) { i++; j++; continue; }
    if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      ops.push({ type: "removed", oldLine: i + 1, oldText: prev[i]! });
      i++;
    } else {
      ops.push({ type: "added", newLine: j + 1, newText: curr[j]! });
      j++;
    }
  }
  while (i < n) { ops.push({ type: "removed", oldLine: i + 1, oldText: prev[i]! }); i++; }
  while (j < m) { ops.push({ type: "added", newLine: j + 1, newText: curr[j]! }); j++; }

  const lines: string[] = [];
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k]!;
    const next = ops[k + 1];
    if (o.type === "removed" && next?.type === "added") {
      lines.push(`Line ${next.newLine} changed (was line ${o.oldLine}): "${o.oldText}" → "${next.newText}"`);
      k++;
    } else if (o.type === "removed") {
      lines.push(`Line ${o.oldLine} removed: "${o.oldText}"`);
    } else {
      lines.push(`Line ${o.newLine} added: "${o.newText}"`);
    }
  }
  return lines.length === 0 ? "(no line-level changes — same text)" : lines.join("\n");
}

export async function comparePoem(
  {
    title,
    lines,
    previousLines,
    previousScores,
    localAnalysis,
    goals,
    writingFocus,
    scoreHistory,
  }: {
    title: string;
    lines: string[];
    previousLines: string[];
    previousScores: { overall_score: number };
    localAnalysis?: LocalAnalysisContext;
    goals?: Record<string, number>;
    writingFocus?: string;
    scoreHistory?: number[];
  },
  model = "gpt-5-nano",
  signal?: AbortSignal,
): Promise<PoemComparison> {
  const changesText = buildChangesText(previousLines, lines);
  const response = await fetch("/api/compare", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, lines, changesText, previousScores, model, localAnalysis, goals, writingFocus, scoreHistory }),
  });

  if (!response.ok) {
    let msg = `HTTP ${response.status}`;
    let retryAfterSec: number | undefined;
    try {
      const body = (await response.json()) as { error?: string; retryAfterSec?: number };
      if (body?.error) msg = body.error;
      if (typeof body.retryAfterSec === "number") retryAfterSec = body.retryAfterSec;
    } catch { /* ignore */ }
    const e = new Error(msg) as Error & { retryAfterSec?: number };
    if (retryAfterSec !== undefined) e.retryAfterSec = retryAfterSec;
    throw e;
  }

  const data = (await response.json()) as Record<string, unknown>;
  return parseComparison(data);
}

export type HarshnessLevel = "baby" | "casual" | "student" | "editor" | "critic";

export async function analyzePoem(
  {
    title,
    lines,
    localAnalysis,
    goals,
    harshness,
    writingFocus,
  }: {
    title: string;
    lines: string[];
    localAnalysis?: LocalAnalysisContext;
    goals?: Record<string, number>;
    harshness?: HarshnessLevel;
    writingFocus?: string;
  },
  model = "gpt-5-nano",
  signal?: AbortSignal,
): Promise<PoemAnalysis> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, lines, model, localAnalysis, goals, harshness, writingFocus }),
  });

  if (!response.ok) {
    let msg = `HTTP ${response.status}`;
    let retryAfterSec: number | undefined;
    try {
      const body = (await response.json()) as { error?: string; retryAfterSec?: number };
      if (body?.error) msg = body.error;
      if (typeof body.retryAfterSec === "number") retryAfterSec = body.retryAfterSec;
    } catch {
      /* ignore */
    }
    const e = new Error(msg) as Error & { retryAfterSec?: number };
    if (retryAfterSec !== undefined) e.retryAfterSec = retryAfterSec;
    throw e;
  }

  const data = (await response.json()) as Record<string, unknown>;
  return parseAnalysis(data);
}
