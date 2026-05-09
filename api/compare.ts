/**
 * Vercel serverless function — POST /api/compare
 *
 * Receives { title, lines, previousLines, previousScores, localAnalysis?, goals? }
 * and asks the model to analyse the current poem AND compare it to the previous version.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkRateLimit } from "./_rate-limit";
import { callOpenAI, sendParsedResponse } from "./_openai";

const SYSTEM_PROMPT = `You are an encouraging poetry editor reviewing a revised poem.
You will receive TWO versions — the previous draft and the current draft — plus the previous scores.
Return valid JSON with this exact shape:

{
  "meta": { "model": "<model-id>", "analyzedAt": "<ISO-8601>" },
  "overall_score": <integer 1-100 for the CURRENT version>,
  "warm_reaction": "<one warm honest sentence (≤18 words) reacting to the current draft>",
  "summary": "<2-3 sentences: honest, specific overall impression of the current poem — what it achieves and the single most important improvement direction>",
  "strengths": ["<2-4 short phrases (≤10 words each) naming what works in the CURRENT draft>"],
  "weaknesses": ["<2-4 short phrases (≤10 words each) naming what most needs work in the CURRENT draft>"],
  "strongest_line": {
    "line": <1-based integer of the single best line in the CURRENT draft>,
    "excerpt": "<the line itself or a short quote>",
    "why": "<one short sentence>"
  },
  "overall_direction": "<3-5 sentences of whole-poem craft advice for the next revision — big picture, not a list of line problems>",
  "clarifying_question": "<optional — one short clarifying question; omit field if not needed>",
  "issues": [
    {
      "id": "issue-1",
      "severity": "<high|medium|low>",
      "line_start": <1-based int>,
      "line_end": <1-based int>,
      "excerpt": "<short quote, optional>",
      "problem_words": ["<specific weak word or phrase>"],
      "headline": "<one fragment (≤8 words) naming the problem>",
      "rationale": "<polite, specific — mention exact weak words when relevant>",
      "improvements": ["<direction>"],
      "rewrite": "<a specific rewritten version of the problematic line(s) — include only when showing is clearer than telling>"
    }
  ],
  "comparison": {
    "summary": "<2-3 sentence overview of what changed overall>",
    "improvements": ["<specific thing that got better>"],
    "regressions": ["<specific thing that got worse, if any>"],
    "unchanged": ["<what stayed strong>"]
  }
}

Rules:
- Scores are for the CURRENT version, integers 1-100.
- warm_reaction: always present, one sentence (≤18 words), human-sounding.
- summary: always present, 2-3 sentences, honest and specific.
- strengths / weaknesses: 2-4 short phrases each (≤10 words).
- strongest_line: always present for the current draft.
- overall_direction: always present, 3-5 sentences, big picture.
- clarifying_question: include only if intent is genuinely ambiguous; otherwise omit.
- severity: "high" = significantly hurts the poem, "medium" = noticeable flaw, "low" = minor polish.
- problem_words: 0-3 specific words or short phrases from the line that are weak. Omit if none stand out.
- headline: required on every issue, ≤8 words, fragment style.
- improvements/regressions/unchanged: 1-4 items each, or empty arrays.
- issues: 3-6 most actionable, or fewer for strong poems.
- rewrite: include only for word-choice or imagery issues where a concrete example is more helpful than a direction.
- If local analysis context is provided, use it to make feedback more precise.
- Return ONLY the JSON object, no markdown fences.`;

interface LocalAnalysis {
  cliches?: Array<{ phrase: string; lineNumber: number }>;
  rhymeScheme?: string[];
  syllablesPerLine?: number[];
  repeatedWords?: Array<{ word: string; count: number }>;
  form?: string;
}

interface GoalsContext {
  minLines?: number;
  maxLines?: number;
  minWords?: number;
  maxWords?: number;
  minStanzas?: number;
  maxStanzas?: number;
  maxSyllablesPerLine?: number;
}

function numbered(lines: string[]): string {
  return lines.map((l, i) => `${i + 1}: ${l}`).join("\n");
}

function buildContextHints(lines: string[], local?: LocalAnalysis, goals?: GoalsContext, writingFocus?: string): string {
  const hints: string[] = [];

  if (local?.form && local.form !== "free") hints.push(`Detected form: ${local.form}`);

  if (local?.syllablesPerLine && local.syllablesPerLine.length > 0) {
    const syllLines = local.syllablesPerLine
      .map((s, i) => lines[i]?.trim() ? `${i + 1}:${s}` : null)
      .filter((x): x is string => x !== null);
    if (syllLines.length > 0) hints.push(`Syllables per line: ${syllLines.join(" ")}`);
  }

  if (local?.rhymeScheme && local.rhymeScheme.some((s) => s)) {
    const scheme = local.rhymeScheme
      .map((s, i) => (s ? `${i + 1}:${s}` : null))
      .filter((x): x is string => x !== null)
      .join(" ");
    hints.push(`Rhyme scheme: ${scheme}`);
  }

  if (local?.cliches && local.cliches.length > 0) {
    hints.push(`Detected clichés: ${local.cliches.map((c) => `L${c.lineNumber}: "${c.phrase}"`).join("; ")}`);
  }

  if (local?.repeatedWords && local.repeatedWords.length > 0) {
    const top = local.repeatedWords.slice(0, 6);
    hints.push(`Repeated words: ${top.map((r) => `"${r.word}" ×${r.count}`).join(", ")}`);
  }

  if (goals) {
    const goalParts: string[] = [];
    if (goals.minLines) goalParts.push(`min ${goals.minLines} lines`);
    if (goals.maxLines) goalParts.push(`max ${goals.maxLines} lines`);
    if (goals.minWords) goalParts.push(`min ${goals.minWords} words`);
    if (goals.maxWords) goalParts.push(`max ${goals.maxWords} words`);
    if (goals.minStanzas) goalParts.push(`min ${goals.minStanzas} stanzas`);
    if (goals.maxStanzas) goalParts.push(`max ${goals.maxStanzas} stanzas`);
    if (goals.maxSyllablesPerLine) goalParts.push(`max ${goals.maxSyllablesPerLine} syllables/line`);
    if (goalParts.length > 0) hints.push(`Author's constraints: ${goalParts.join(", ")}`);
  }

  if (writingFocus && writingFocus.trim()) {
    hints.push(`Author's writing focus for this revision: ${writingFocus.trim()}`);
  }

  return hints.length > 0 ? `\n\n--- Local analysis context ---\n${hints.join("\n")}` : "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!checkRateLimit(req.headers["x-forwarded-for"])) {
    return res.status(429).json({ error: "Too many requests — please wait a moment before analyzing again." });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is not configured with an OpenAI API key." });
  }

  const body = req.body as {
    title?: unknown;
    lines?: unknown;
    previousLines?: unknown;
    previousScores?: unknown;
    scoreHistory?: unknown;
    model?: unknown;
    localAnalysis?: unknown;
    goals?: unknown;
    writingFocus?: unknown;
  };

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return res.status(400).json({ error: "Missing or empty `lines` array." });
  }
  if (!Array.isArray(body.previousLines) || body.previousLines.length === 0) {
    return res.status(400).json({ error: "Missing or empty `previousLines` array." });
  }

  const title = typeof body.title === "string" ? body.title : "";
  const lines = (body.lines as unknown[]).map((l) => String(l ?? ""));
  const prevLines = (body.previousLines as unknown[]).map((l) => String(l ?? ""));
  const model = typeof body.model === "string" ? body.model : "gpt-5-mini";
  const prevScores = body.previousScores ?? null;
  const local = (body.localAnalysis && typeof body.localAnalysis === "object" ? body.localAnalysis : undefined) as LocalAnalysis | undefined;
  const goals = (body.goals && typeof body.goals === "object" ? body.goals : undefined) as GoalsContext | undefined;
  const writingFocus = typeof body.writingFocus === "string" ? body.writingFocus.slice(0, 500) : undefined;
  const scoreHistory = Array.isArray(body.scoreHistory)
    ? (body.scoreHistory as unknown[]).filter((v): v is number => typeof v === "number").slice(-10)
    : undefined;

  const titlePart = title.trim() ? `Title: ${title.trim()}\n\n` : "";
  const prevScoreText = prevScores ? `\nPrevious scores: ${JSON.stringify(prevScores)}\n` : "";
  const historyText = scoreHistory && scoreHistory.length > 1
    ? `\nScore history (oldest → newest): ${scoreHistory.join(" → ")}\n`
    : "";
  const contextBlock = buildContextHints(lines, local, goals, writingFocus);

  const userMessage = `${titlePart}=== PREVIOUS VERSION ===\n${numbered(prevLines)}\n${prevScoreText}${historyText}\n=== CURRENT VERSION ===\n${numbered(lines)}${contextBlock}`;

  const result = await callOpenAI(
    apiKey,
    {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      max_tokens: 3000,
      temperature: 0.4,
    },
    res,
  );
  if (!result) return;

  sendParsedResponse(res, result.content, result.model);
}
