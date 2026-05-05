/**
 * Browser-side calls to the /api/* serverless endpoints.
 * The OpenAI key lives on the server — the browser never touches it.
 */

export interface AnalysisMeta {
  model: string;
  analyzedAt: string;
}

export interface AnalysisDimensions {
  imagery: number;
  musicality: number;
  originality: number;
  clarity: number;
}

export interface AnalysisIssue {
  id: string;
  severity?: "high" | "medium" | "low";
  line_start: number;
  line_end: number;
  excerpt?: string;
  problem_words?: string[];
  rationale: string;
  improvements: string[];
  /** Concrete rewritten version of the line(s), when provided by the model. */
  rewrite?: string;
}

export interface PoemAnalysis {
  meta: AnalysisMeta;
  overall_score: number;
  summary?: string;
  overall_direction?: string;
  dimensions: AnalysisDimensions;
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

function parseAnalysis(obj: Record<string, unknown>): PoemAnalysis {
  const dims = (obj.dimensions ?? {}) as Record<string, unknown>;
  const issuesRaw = Array.isArray(obj.issues) ? obj.issues : [];
  const meta = (obj.meta ?? {}) as Record<string, unknown>;

  return {
    meta: {
      model: typeof meta.model === "string" ? meta.model : "gpt-4o-mini",
      analyzedAt:
        typeof meta.analyzedAt === "string" ? meta.analyzedAt : new Date().toISOString(),
    },
    overall_score: clampScore(obj.overall_score),
    summary: typeof obj.summary === "string" ? obj.summary : undefined,
    overall_direction: typeof obj.overall_direction === "string" ? obj.overall_direction : undefined,
    dimensions: {
      imagery: clampScore(dims.imagery),
      musicality: clampScore(dims.musicality),
      originality: clampScore(dims.originality),
      clarity: clampScore(dims.clarity),
    },
    issues: issuesRaw
      .filter((x): x is Record<string, unknown> => x !== null && typeof x === "object")
      .map((iss, idx) => ({
        id: typeof iss.id === "string" ? iss.id : `issue-${idx + 1}`,
        severity: parseSeverity(iss.severity),
        line_start: clampScore(iss.line_start),
        line_end: clampScore(iss.line_end),
        excerpt: typeof iss.excerpt === "string" ? iss.excerpt : undefined,
        problem_words: Array.isArray(iss.problem_words)
          ? (iss.problem_words as unknown[])
              .filter((s): s is string => typeof s === "string")
              .slice(0, 3)
          : undefined,
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
    previousScores: { overall_score: number; dimensions: AnalysisDimensions };
    localAnalysis?: LocalAnalysisContext;
    goals?: Record<string, number>;
    writingFocus?: string;
    scoreHistory?: number[];
  },
  model = "gpt-4o-mini",
  signal?: AbortSignal,
): Promise<PoemComparison> {
  const response = await fetch("/api/compare", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, lines, previousLines, previousScores, model, localAnalysis, goals, writingFocus, scoreHistory }),
  });

  if (!response.ok) {
    let msg = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch { /* ignore */ }
    throw new Error(msg);
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
  model = "gpt-4o-mini",
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
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  const data = (await response.json()) as Record<string, unknown>;
  return parseAnalysis(data);
}
