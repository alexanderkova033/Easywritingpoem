/**
 * Vercel serverless function — POST /api/compare
 *
 * Receives { title, lines, changesText, previousScores, localAnalysis?, goals? }
 * and asks the model to analyse the current poem AND compare it to the previous version.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkRateLimit, getRateLimitRetrySec } from "./_rate-limit";
import { callOpenAI, sendParsedResponse } from "./_openai";
import { cooldownFor, precheckSpend, recordSpend } from "./_usage-cap";

const SYSTEM_PROMPT = `You are an encouraging poetry editor. Receive a diff (previous → current) + previous score. Score the CURRENT version. Return JSON only (no fences). Keys:
overall_score (int 1-100, CURRENT), warm_reaction (≤14w, terse), strengths[] (2-3, ≤6w, terse), weaknesses[] (2-3, ≤6w, terse), strongest_line {line:int, why:≤8w}, issues[] (2-5 — mix serious craft problems with smaller nitpicks; pick the most useful across that range), comparison {improvements:[], regressions:[], unchanged:[]} (0-3 items each, ≤6w, may be empty).
overall_feedback (string, 2-3 full sentences, holistic read of the current draft as a whole — voice, mood, what it accomplishes, where it lands).
personal_feedback (string, 2-3 full sentences addressed to the writer as "you". Note the revision arc — what improved, what their instincts seem drawn to, one concrete craft move to grow into next. Mentor tone, not rubric).
Each issue: id, severity ("high"|"medium"|"low"), line_start, line_end, headline (≤6w), problem_words?[],
  rationale (3-5 full sentences — (1) name the specific craft problem, (2) explain WHY it weakens the line in this poem's context with concrete words/sounds/rhythm, (3) describe how it lands on the reader (sensory or emotional effect, what gets blurred), (4) when useful, contrast with what a sharper move would do. Speak about THIS line, not generalities.),
  improvements[] (2-4 concrete moves, each ≤14 words, naming a specific technique or word swap), rewrite?, confidence? ("low" only).
Prefer single-line issues. Cover a range of craft angles across issues — imagery, diction, rhythm, sound, structure, clarity. Headline stays terse; rationale gets paragraph-length detail; improvements stay punchy but specific. Use local analysis hints if provided. 1-based line numbers.`;

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

  if (local?.form && local.form !== "free") {
    const formRules: Record<string, string> = {
      haiku: "Strict: 5-7-5 syllables; one nature image; cutting word/turn between images; no metaphor stacking.",
      sonnet: "14 lines; expect a clear volta around line 8 or 9; consistent meter; coherent rhyme scheme.",
      villanelle: "19 lines; two refrains alternating; pattern A1 b A2 / a b A1 / a b A2 / a b A1 / a b A2 / a b A1 A2.",
    };
    const rule = formRules[local.form];
    hints.push(`Detected form: ${local.form}${rule ? ` — ${rule}` : ""}\nJudge against this form's conventions when relevant.`);
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!(await checkRateLimit(req.headers["x-forwarded-for"]))) {
    const retryAfterSec = await getRateLimitRetrySec(req.headers["x-forwarded-for"]);
    if (retryAfterSec > 0) res.setHeader("Retry-After", String(retryAfterSec));
    return res.status(429).json({
      error: "Too many requests — please wait a moment before analyzing again.",
      retryAfterSec,
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is not configured with an OpenAI API key." });
  }

  const body = req.body as {
    title?: unknown;
    lines?: unknown;
    changesText?: unknown;
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
  if (typeof body.changesText !== "string" || !body.changesText.trim()) {
    return res.status(400).json({ error: "Missing `changesText` describing the diff from the previous draft." });
  }

  const MAX_LINES = 500;
  if ((body.lines as unknown[]).length > MAX_LINES) {
    return res.status(400).json({ error: `Too many lines (max ${MAX_LINES}).` });
  }

  const title = typeof body.title === "string" ? body.title : "";
  const lines = (body.lines as unknown[]).map((l) => String(l ?? ""));
  const totalChars = lines.reduce((sum, l) => sum + l.length, 0) + title.length;
  if (totalChars > 20_000) {
    return res.status(400).json({ error: "Poem too long (max 20000 characters)." });
  }
  const changesText = (body.changesText as string).slice(0, 8_000);
  const model = typeof body.model === "string" ? body.model : "gpt-5-nano";

  const spend = await precheckSpend({
    rawIp: req.headers["x-forwarded-for"],
    endpoint: "compare",
    cooldownMs: cooldownFor("compare", model),
  });
  if (!spend.ok) {
    if (spend.retryAfterSec) res.setHeader("Retry-After", String(spend.retryAfterSec));
    return res.status(spend.status).json(spend.body);
  }
  const prevScores = body.previousScores ?? null;
  const local = (body.localAnalysis && typeof body.localAnalysis === "object" ? body.localAnalysis : undefined) as LocalAnalysis | undefined;
  const goals = (body.goals && typeof body.goals === "object" ? body.goals : undefined) as GoalsContext | undefined;
  const writingFocus = typeof body.writingFocus === "string" ? body.writingFocus.slice(0, 500) : undefined;
  const scoreHistory = Array.isArray(body.scoreHistory)
    ? (body.scoreHistory as unknown[]).filter((v): v is number => typeof v === "number").slice(-10)
    : undefined;

  const titlePart = title.trim() ? `Title: ${title.trim()}\n\n` : "";
  const prevScoreText = prevScores ? `\nPrevious score: ${JSON.stringify(prevScores)}\n` : "";
  const historyText = scoreHistory && scoreHistory.length > 1
    ? `\nScore history (oldest → newest): ${scoreHistory.join(" → ")}\n`
    : "";
  const contextBlock = buildContextHints(lines, local, goals, writingFocus);

  const userMessage = `${titlePart}=== CHANGES from previous draft (line numbers refer to the CURRENT draft below) ===\n${changesText}\n${prevScoreText}${historyText}\n=== CURRENT VERSION ===\n${numbered(lines)}${contextBlock}\n\nNote: only the diff is shown above, not the full previous draft. Score and review the CURRENT version, but use the diff to identify what improved or regressed.`;

  const result = await callOpenAI(
    apiKey,
    {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      max_tokens: 5000,
      temperature: 0.4,
      reasoningEffort: "low",
    },
    res,
  );
  if (!result) return;

  await recordSpend(spend.ip, result.model, result.usage.promptTokens, result.usage.completionTokens);
  sendParsedResponse(res, result.content, result.model);
}
