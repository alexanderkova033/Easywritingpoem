/**
 * Vercel serverless function — POST /api/analyze
 *
 * Receives { title, lines, localAnalysis?, goals? } from the browser,
 * forwards to OpenAI, and returns the analysis JSON.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkRateLimit, getRateLimitRetrySec } from "./_rate-limit";
import { callOpenAI, sendParsedResponse } from "./_openai";
import { cooldownFor, precheckSpend, recordSpend } from "./_usage-cap";
import { gibberishGuard } from "./_gibberish";

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
  return `You are ${persona}. Persona governs the TONE and word choice of your feedback strings ONLY — it does not shift the rubric or the score. Apply the same objective rubric below to every poem, then phrase the feedback in your persona's voice.

=== SCORING RUBRIC (4 pillars × 25 points = 100) ===
Score each pillar independently on a 0-25 scale, then sum for overall_score.
1. Musicality (0-25) — rhythm, meter consistency, sound work (assonance, consonance, internal rhyme), line-break musicality, line-length control.
2. Technique (0-25) — diction precision, grammar/syntax control, line economy (no filler), absence of clichés, controlled use of devices (metaphor, enjambment, purposeful repetition).
3. Imagery / Theme (0-25) — concrete sensory image strength, coherence of theme, emotional or intellectual stakes earned (shown, not stated), subtext.
4. Originality / Form (0-25) — freshness of phrasing and angle vs received language, command of chosen form (or purposeful free-verse shape), turns/voltas/structural surprise.

=== PER-PILLAR ANCHORS (0-25 scale) ===
0-6    amateur — clichéd, broken, or absent. First-draft work by someone who hasn't studied the craft.
7-12   developing — recognizable effort, common moves, frequent missteps.
13-18  competent — solid execution, mostly intentional choices, occasional weakness.
19-22  strong — distinctive, controlled, would not be cut from a workshop.
23-25  publishable — singular, surprising, no wasted move on this dimension.

=== OVERALL SCORE RULES ===
- overall_score = sum of the four pillar scores.
- HARD CAP: overall_score must not exceed (lowest pillar × 4) + 20. One amateur pillar cannot be carried by the others. Apply the cap AFTER summing.
- Do NOT default to the polite middle (55-85). If a draft is weak / clichéd / amateur across multiple pillars, the honest score is in the 0-49 range — use it. Politeness inflation is a bug, not kindness; the persona changes wording, not the math.
- Do not round up to a "nicer" number. 37 is fine. 52 is fine. 84 is fine.

Return JSON only (no fences). Keys:
overall_score (int 1-100, per rules above), warm_reaction (≤14 words, terse — in persona voice), strengths[] (2-3 items, ≤6w each, terse), weaknesses[] (2-3, ≤6w, terse), strongest_line {line:int, why:≤8w}, issues[] (2-5 — mix serious craft problems with smaller nitpicks; let the lowest-scoring pillar(s) drive which issues you raise).
overall_feedback (string, 1-2 short sentences max, holistic read of the poem — voice, mood, what it lands or misses. Specific, not generic. Tone matches persona; verdict does not.).
personal_feedback (string, 1-2 short sentences max, addressed to the writer as "you". One thing they're doing well + one concrete craft move to try next. Tone matches persona, no preamble.).
Each issue: id, severity ("high"|"medium"|"low"), line_start, line_end, headline (≤6w), problem_words[] (REQUIRED whenever the issue centers on specific words — diction, cliché, weak verb, filler, vague noun, sound clash, repetition. List the exact lowercase tokens from the poem text that the editor should highlight. Only omit when the issue is purely structural — line break, stanza order, missing volta — where no specific word is the culprit.),
  rationale (3-5 full sentences — (1) name the specific craft problem AND which pillar it hurts, (2) explain WHY it weakens the line in this poem's context, quoting concrete words/sounds/rhythm, (3) describe how it lands on the reader (sensory or emotional effect, what gets blurred or lost), (4) when useful, contrast with what a sharper move would do. Do not generalise; speak about THIS line.),
  improvements[] (2-4 concrete moves the writer can try, each ≤14 words, naming a specific technique or word swap rather than vague advice),
  rewrite? (omit unless you can offer a clearly stronger one-line replacement),
  confidence? ("low" only — omit otherwise).
Prefer single-line issues (line_start == line_end). Cover a range of craft angles across issues — imagery, diction, rhythm, sound, structure, clarity — not all the same kind. Use local analysis hints (clichés, syllables, rhyme, form) when present and let them depress the relevant pillar score. 1-based line numbers. Keep headline terse; rationale gets full paragraph-length sentences; improvements stay punchy but specific.`;
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
    const formRules: Record<string, string> = {
      haiku: "Strict: 5-7-5 syllables; one nature image; cutting word/turn between images; no metaphor stacking.",
      sonnet: "14 lines; expect a clear volta around line 8 or 9; consistent meter (typically iambic pentameter); rhyme scheme should be coherent.",
      villanelle: "19 lines; two refrains alternating then both at the end; A1 b A2 / a b A1 / a b A2 / a b A1 / a b A2 / a b A1 A2 pattern. Refrains must reward repetition.",
    };
    const rule = formRules[local.form];
    hints.push(`Detected form: ${local.form}${rule ? ` — ${rule}` : ""}\nJudge the poem against this form's conventions when relevant.`);
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
  return `${titlePart}${numbered}${buildContextHints(lines, local, goals, writingFocus)}\n\n--- Scoring reminder ---\nScore each of the 4 pillars (Musicality, Technique, Imagery/Theme, Originality/Form) 0-25 against the anchors in your system prompt. Sum, then apply the hard cap rule. Do not default to the polite middle — weak drafts belong in 0-49.`;
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
    model?: unknown;
    localAnalysis?: unknown;
    goals?: unknown;
    harshness?: unknown;
    writingFocus?: unknown;
  };

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return res.status(400).json({ error: "Missing or empty `lines` array in request body." });
  }

  const title = typeof body.title === "string" ? body.title : "";
  const lines = (body.lines as unknown[]).map((l) => String(l ?? ""));
  const model = typeof body.model === "string" ? body.model : "gpt-5-nano";

  const spend = await precheckSpend({
    rawIp: req.headers["x-forwarded-for"],
    endpoint: "analyze",
    cooldownMs: cooldownFor("analyze", model),
  });
  if (!spend.ok) {
    if (spend.retryAfterSec) res.setHeader("Retry-After", String(spend.retryAfterSec));
    return res.status(spend.status).json(spend.body);
  }
  const local = (body.localAnalysis && typeof body.localAnalysis === "object" ? body.localAnalysis : undefined) as LocalAnalysis | undefined;
  const goals = (body.goals && typeof body.goals === "object" ? body.goals : undefined) as GoalsContext | undefined;
  const harshness = typeof body.harshness === "string" ? body.harshness : undefined;
  const writingFocus = typeof body.writingFocus === "string" ? body.writingFocus.slice(0, 500) : undefined;

  const MAX_LINES = 500;
  if (lines.length > MAX_LINES) {
    return res.status(400).json({ error: `Too many lines (max ${MAX_LINES}).` });
  }

  const MAX_TOTAL_CHARS = 20_000;
  const totalChars = lines.reduce((sum, l) => sum + l.length, 0) + title.length;
  if (totalChars > MAX_TOTAL_CHARS) {
    return res.status(400).json({ error: `Poem too long (max ${MAX_TOTAL_CHARS} characters).` });
  }

  const gib = await gibberishGuard({
    rawIp: req.headers["x-forwarded-for"],
    text: `${title}\n${lines.join("\n")}`,
    apiKey,
  });
  if (!gib.ok) {
    if (gib.retryAfterSec) res.setHeader("Retry-After", String(gib.retryAfterSec));
    return res.status(gib.status).json(gib.body);
  }

  const result = await callOpenAI(
    apiKey,
    {
      model,
      messages: [
        { role: "system", content: buildSystemPrompt(harshness) },
        { role: "user", content: buildPrompt(title, lines, local, goals, writingFocus) },
      ],
      max_tokens: 4000,
      temperature: 0.4,
      reasoningEffort: "low",
    },
    res,
  );
  if (!result) return;

  await recordSpend(spend.ip, result.model, result.usage.promptTokens, result.usage.completionTokens);
  sendParsedResponse(res, result.content, result.model);
}
