/**
 * Browser-side calls to the /api/* serverless endpoints.
 * The OpenAI key lives on the server — the browser never touches it.
 */

import { parseAiErrorAndNotify } from "../ai-cost/aiBudgetBus";

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

export interface PillarScores {
  chord: number;
  craft: number;
  spark: number;
  echo: number;
}

export interface PoemAnalysis {
  meta: AnalysisMeta;
  overall_score: number;
  /** 4 × 25 pillar breakdown. Sum (with hard cap) = overall_score. */
  pillar_scores?: PillarScores;
  /** True when the request was sent in draft mode (work-in-progress). */
  draft?: boolean;
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

function clampPillar(n: unknown): number {
  const v = typeof n === "number" ? n : parseInt(String(n), 10);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(25, Math.round(v)));
}

function parsePillarScores(v: unknown): PillarScores | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const hasAny =
    o.chord !== undefined ||
    o.craft !== undefined ||
    o.spark !== undefined ||
    o.echo !== undefined;
  if (!hasAny) return undefined;
  return {
    chord: clampPillar(o.chord),
    craft: clampPillar(o.craft),
    spark: clampPillar(o.spark),
    echo: clampPillar(o.echo),
  };
}

/** If the model emitted pillar_scores, enforce overall = min(sum, lowest×4 + 20).
 *  This is the server-side math check the prompt mandates — we apply it client-side
 *  too so a sloppy model can't sneak past with an inflated overall_score. */
function reconcileOverallScore(pillars: PillarScores | undefined, modelOverall: number): number {
  if (!pillars) return modelOverall;
  const values = [pillars.chord, pillars.craft, pillars.spark, pillars.echo];
  const sum = values.reduce((a, b) => a + b, 0);
  const lowest = Math.min(...values);
  const cap = lowest * 4 + 20;
  const computed = Math.min(sum, cap);
  return Math.max(1, Math.min(100, computed));
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

/** Cap total issues at MAX_ISSUES and roughly balance high/medium/low buckets.
 * Round-robin pick from each severity bucket (high → medium → low) preserving
 * original order within each bucket. Issues with no severity fall into "low". */
const MAX_ISSUES = 5;
function balanceAndCapIssues<T extends { severity?: "high" | "medium" | "low" }>(issues: T[]): T[] {
  if (issues.length <= MAX_ISSUES) return issues;
  const high: T[] = [];
  const medium: T[] = [];
  const low: T[] = [];
  for (const iss of issues) {
    if (iss.severity === "high") high.push(iss);
    else if (iss.severity === "medium") medium.push(iss);
    else low.push(iss);
  }
  const out: T[] = [];
  const buckets = [high, medium, low];
  while (out.length < MAX_ISSUES) {
    let drew = false;
    for (const b of buckets) {
      if (out.length >= MAX_ISSUES) break;
      const next = b.shift();
      if (next) { out.push(next); drew = true; }
    }
    if (!drew) break;
  }
  return out;
}

function parseAnalysis(obj: Record<string, unknown>): PoemAnalysis {
  const issuesRaw = Array.isArray(obj.issues) ? obj.issues : [];
  const meta = (obj.meta ?? {}) as Record<string, unknown>;
  const pillars = parsePillarScores(obj.pillar_scores);

  return {
    meta: {
      model: typeof meta.model === "string" ? meta.model : "gpt-5-mini",
      analyzedAt:
        typeof meta.analyzedAt === "string" ? meta.analyzedAt : new Date().toISOString(),
    },
    overall_score: reconcileOverallScore(pillars, clampScore(obj.overall_score)),
    pillar_scores: pillars,
    draft: obj.draft === true,
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
    issues: balanceAndCapIssues(issuesRaw
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
      }))),
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
    previousWeaknesses,
    previousIssues,
    draftMode,
    thinkingMode,
  }: {
    title: string;
    lines: string[];
    previousLines: string[];
    previousScores: { overall_score: number };
    localAnalysis?: LocalAnalysisContext;
    goals?: Record<string, number>;
    writingFocus?: string;
    scoreHistory?: number[];
    previousWeaknesses?: string[];
    previousIssues?: Array<{ line_start: number; line_end: number; headline?: string }>;
    draftMode?: boolean;
    thinkingMode?: boolean;
  },
  signal?: AbortSignal,
): Promise<PoemComparison> {
  const changesText = buildChangesText(previousLines, lines);
  const response = await fetch("/api/compare", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title, lines, changesText, previousScores, localAnalysis, goals, writingFocus, scoreHistory,
      previousWeaknesses, previousIssues, draftMode, thinkingMode,
    }),
  });

  if (!response.ok) {
    const { message, retryAfterSec } = await parseAiErrorAndNotify(response, "compare");
    const e = new Error(message) as Error & { retryAfterSec?: number };
    if (retryAfterSec !== undefined) e.retryAfterSec = retryAfterSec;
    throw e;
  }

  const data = (await response.json()) as Record<string, unknown>;
  return parseComparison(data);
}

export type RecheckStatus = "resolved" | "partial" | "still" | "elsewhere";
export interface RecheckResult {
  status: RecheckStatus;
  note: string;
}

export async function recheckIssue(
  {
    oldLine,
    newLine,
    context,
    rationale,
    headline,
    lineRange,
  }: {
    oldLine: string;
    newLine: string;
    context?: string;
    rationale: string;
    headline?: string;
    lineRange?: string;
  },
  signal?: AbortSignal,
): Promise<RecheckResult> {
  const response = await fetch("/api/recheck", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oldLine, newLine, context, rationale, headline, lineRange }),
  });
  if (!response.ok) {
    const { message, retryAfterSec } = await parseAiErrorAndNotify(response, "recheck");
    const e = new Error(message) as Error & { retryAfterSec?: number };
    if (retryAfterSec !== undefined) e.retryAfterSec = retryAfterSec;
    throw e;
  }
  const data = (await response.json()) as Record<string, unknown>;
  const rawStatus = typeof data.status === "string" ? data.status : "still";
  const status: RecheckStatus =
    rawStatus === "resolved" || rawStatus === "partial" || rawStatus === "still" || rawStatus === "elsewhere"
      ? (rawStatus as RecheckStatus)
      : "still";
  const note = typeof data.note === "string" ? data.note.trim() : "";
  return { status, note };
}

export type HarshnessLevel = "casual" | "editor" | "critic";

export async function analyzePoem(
  {
    title,
    lines,
    localAnalysis,
    goals,
    harshness,
    writingFocus,
    draftMode,
    thinkingMode,
  }: {
    title: string;
    lines: string[];
    localAnalysis?: LocalAnalysisContext;
    goals?: Record<string, number>;
    harshness?: HarshnessLevel;
    writingFocus?: string;
    draftMode?: boolean;
    /** When true, the server uses medium reasoning effort for a slower but
     *  more careful analysis. Default false = low reasoning, faster. */
    thinkingMode?: boolean;
  },
  signal?: AbortSignal,
): Promise<PoemAnalysis> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, lines, localAnalysis, goals, harshness, writingFocus, draftMode, thinkingMode }),
  });

  if (!response.ok) {
    const { message, retryAfterSec } = await parseAiErrorAndNotify(response, "analyze");
    const e = new Error(message) as Error & { retryAfterSec?: number };
    if (retryAfterSec !== undefined) e.retryAfterSec = retryAfterSec;
    throw e;
  }

  const data = (await response.json()) as Record<string, unknown>;
  return parseAnalysis(data);
}
