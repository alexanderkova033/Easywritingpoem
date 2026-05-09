/**
 * Vercel serverless function — POST /api/analyze
 *
 * Receives { title, lines, localAnalysis?, goals? } from the browser,
 * forwards to OpenAI, and returns the analysis JSON.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkRateLimit } from "./_rate-limit";
import { callOpenAI, sendParsedResponse } from "./_openai";

const HARSHNESS_PERSONAS: Record<string, string> = {
  baby:    "a kind, encouraging reader who celebrates effort and only mentions one very obvious improvement gently",
  casual:  "a supportive friend who enjoys poetry casually — warm, encouraging, only notes glaring issues",
  student: "a writing workshop peer — honest and constructive, balanced praise and critique",
  editor:  "a professional poetry editor — direct, specific, and demanding high craft standards",
  critic:  "a rigorous literary critic — uncompromising, deeply analytical, expects excellence in every line",
};

function buildSystemPrompt(harshness?: string): string {
  const persona = harshness && harshness in HARSHNESS_PERSONAS
    ? HARSHNESS_PERSONAS[harshness as keyof typeof HARSHNESS_PERSONAS]
    : HARSHNESS_PERSONAS.editor;
  return `You are ${persona}. Analyze the poem and return valid JSON with this exact shape:
{
  "meta": { "model": "<model-id>", "analyzedAt": "<ISO-8601>" },
  "overall_score": <integer 1-100>,
  "warm_reaction": "<one warm, honest sentence (max 18 words) reacting to the poem as a person, not an evaluator>",
  "summary": "<2-3 sentences: an honest, specific overall impression — what the poem achieves, what mood it creates, and its defining strength>",
  "strengths": ["<2-4 brief phrases (each max 10 words) naming what the poem does well — concrete, not generic>"],
  "weaknesses": ["<2-4 brief phrases (each max 10 words) naming what most needs work — concrete, not generic>"],
  "strongest_line": {
    "line": <1-based integer of the single best line>,
    "excerpt": "<the line itself or a short quote from it>",
    "why": "<one short sentence on what makes this line land>"
  },
  "overall_direction": "<3-5 sentences giving the single most important whole-poem improvement direction. This should be broad craft advice — about the poem's arc, emotional range, tonal consistency, structural choices, or central image — NOT a repeat of individual line issues. Write as if advising a poet before their next full revision.>",
  "clarifying_question": "<optional — one short clarifying question to ask the poet if a major intent is ambiguous; omit field if not needed>",
  "issues": [
    {
      "id": "issue-1",
      "severity": "<high|medium|low>",
      "line_start": <1-based integer>,
      "line_end": <1-based integer>,
      "excerpt": "<short quote, optional>",
      "problem_words": ["<specific weak word or phrase>"],
      "headline": "<one short fragment (max 8 words) naming the problem — used as a one-line preview>",
      "rationale": "<polite, specific reason — mention the exact words or phrases that are weak when relevant>",
      "improvements": ["<direction 1>", "<optional direction 2>"],
      "rewrite": "<a specific rewritten version of the problematic line(s) — include only when showing is clearer than telling; omit for structural issues or when directions suffice>"
    }
  ]
}
Rules:
- Scores are integers 1-100.
- warm_reaction: always present, ONE sentence, ≤18 words. Sound like a person reacting, not a rubric. Specific, not generic.
- summary: always present, 2-3 sentences, honest and specific — not generic praise.
- strengths / weaknesses: 2-4 items each. Each item is a SHORT phrase (≤10 words), no full sentences. Concrete: name the technique, image, or move — not vague praise.
- strongest_line: always present. Pick the single line that does the most work; \`line\` is its 1-based index.
- overall_direction: always present, 3-5 sentences of whole-poem craft advice. Never a list of line problems — think big picture: arc, theme, voice, structure, emotional progression.
- clarifying_question: include ONLY when intent is genuinely ambiguous. Otherwise omit the field entirely.
- Limit issues to the 3-6 most actionable ones; fewer is fine for strong poems.
- severity: "high" = significantly hurts the poem, "medium" = noticeable flaw, "low" = minor polish.
- problem_words: 0-3 specific words or short phrases from the line that are weak. Omit if none stand out.
- headline: required for every issue. ≤8 words, fragment style, names the problem at a glance.
- improvements: 1-3 strings per issue.
- rewrite: include only for word-choice or imagery issues where a concrete example is more helpful than a direction. Keep it as 1-2 lines max.
- If local analysis context is provided (syllables, rhyme scheme, clichés, goals), use it to make your feedback more precise and specific. Reference detected clichés directly.
- line_start / line_end are 1-based indexes into the numbered lines you receive.
- Return ONLY the JSON object, no markdown fences.`;
}

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

function buildContextHints(lines: string[], local?: LocalAnalysis, goals?: GoalsContext, writingFocus?: string): string {
  const hints: string[] = [];

  if (local?.form && local.form !== "free") {
    hints.push(`Detected form: ${local.form}`);
  }

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

function buildPrompt(title: string, lines: string[], local?: LocalAnalysis, goals?: GoalsContext, writingFocus?: string): string {
  const titlePart = title.trim() ? `Title: ${title.trim()}\n\n` : "";
  const numbered = lines.map((l, i) => `${i + 1}: ${l}`).join("\n");
  return `${titlePart}${numbered}${buildContextHints(lines, local, goals, writingFocus)}`;
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
    model?: unknown;
    localAnalysis?: unknown;
    goals?: unknown;
    harshness?: unknown;
    writingFocus?: unknown;
    analysisStyle?: unknown;
  };

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return res.status(400).json({ error: "Missing or empty `lines` array in request body." });
  }

  const title = typeof body.title === "string" ? body.title : "";
  const lines = (body.lines as unknown[]).map((l) => String(l ?? ""));
  const model = typeof body.model === "string" ? body.model : "gpt-5-mini";
  const local = (body.localAnalysis && typeof body.localAnalysis === "object" ? body.localAnalysis : undefined) as LocalAnalysis | undefined;
  const goals = (body.goals && typeof body.goals === "object" ? body.goals : undefined) as GoalsContext | undefined;
  const harshness = typeof body.harshness === "string" ? body.harshness : undefined;
  const writingFocus = typeof body.writingFocus === "string" ? body.writingFocus.slice(0, 500) : undefined;
  const analysisStyle = body.analysisStyle === "big-picture" ? "big-picture" : "detailed";

  const MAX_LINES = 500;
  if (lines.length > MAX_LINES) {
    return res.status(400).json({ error: `Too many lines (max ${MAX_LINES}).` });
  }

  const styleDirective = analysisStyle === "big-picture"
    ? `\n\nIMPORTANT: For this analysis, the poet wants BIG-PICTURE feedback. Set "issues" to an empty array []. Do NOT identify or list any line-level problems. Put all your craft observations into warm_reaction, strengths, weaknesses, strongest_line, summary, and overall_direction. Be more discursive in summary and overall_direction since you have no issue list to carry the detail.`
    : "";

  const result = await callOpenAI(
    apiKey,
    {
      model,
      messages: [
        { role: "system", content: buildSystemPrompt(harshness) + styleDirective },
        { role: "user", content: buildPrompt(title, lines, local, goals, writingFocus) },
      ],
      max_tokens: 2600,
      temperature: 0.4,
    },
    res,
  );
  if (!result) return;

  sendParsedResponse(res, result.content, result.model);
}
