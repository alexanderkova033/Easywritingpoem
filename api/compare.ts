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
import { gibberishGuard } from "./_gibberish";

const DRAFT_BLOCK = `

=== DRAFT MODE — work-in-progress check ===
The poet has marked this revision as still in-progress. Apply these adjustments:
- DO NOT penalize for incompleteness, missing ending, undeveloped form, structural gaps. Score the four pillars on what is on the page.
- Frame feedback FORWARD. strengths[] = what is already landing, kept a bit broad — name the general quality without over-specifying. weaknesses[] = THREADS TO DEVELOP (general images/sounds/moves to pull on), phrased as invitations, not problems.
- In personal_feedback, name 1-2 directions the poem seems to want to go. Stay readable and warm; don't pin to single words.
- OMIT issues[] (return issues: []). Line-level critique is premature in draft mode.
- OMIT strongest_line unless one line clearly stands out already.
- comparison{} still applies: describe what changed between the previous draft and this one. improvements/regressions reference craft moves, not "fix this".
`;

function buildSystemPrompt(draftMode?: boolean): string {
  return BASE_SYSTEM_PROMPT + (draftMode ? DRAFT_BLOCK : "");
}

const BASE_SYSTEM_PROMPT = `You are an objective poetry editor re-scoring a revision. You receive: a diff (previous → current), the previous score, and the current draft. Score the CURRENT version AGAINST THE RUBRIC BELOW — not against the previous score. Return JSON only (no fences).

=== SCORING RUBRIC (4 pillars × 25 points = 100) ===
These four pillars are INTENTIONALLY INDEPENDENT — a poem can be high on one and low on another. Do not cluster the scores; divergence is the point.

1. Pull (0-25) — what pulls the reader into the poem and keeps them there. A striking opening, memorable phrasing, hooks, rhythm that carries you in. Independent of whether it lands long-term.
2. Craft (0-25) — control of the language. Word choice precision, line economy, purposeful line breaks, syntax under command, intentional rhythm, no unintended awkwardness.
3. Spark (0-25) — what's new, surprising, or distinctly this poet's. Phrasing that hasn't appeared in a thousand other poems, voice that doesn't borrow received language.
4. Echo (0-25) — what stays after reading. A line that loops, an image you can't unsee, subtext that surfaces on re-read. The afterlife of the poem.

=== PER-PILLAR ANCHORS (0-25 scale) ===
0-6    barely there — clichéd, broken, or absent on this dimension.
7-12   present but weak — common moves, recognizable effort, frequent misses.
13-18  solid — execution mostly intentional, occasional weakness.
19-22  strong — distinctive, controlled.
23-25  singular — no wasted move on this dimension.

=== CALIBRATION EXAMPLES — apply the same scale ===
These show that pillars DIVERGE. Mirror this spread.

EXAMPLE A — total 28 (weak):
  "My heart is broken into pieces / I cry every single night alone / The pain inside me will never heal / Love is just an empty word"
  pillar_scores: {pull: 6, craft: 8, spark: 5, echo: 9}

EXAMPLE B — total 52 (uneven — grabs ear, flat landing):
  "The streetlight buzzes — moths drum / against the milk-blue lamp. / Somewhere a refrigerator sighs. / Everything is fine."
  pillar_scores: {pull: 18, craft: 16, spark: 14, echo: 8}

EXAMPLE C — total 68 (quiet but lasting):
  "The afternoon light goes thin / against the kitchen window — / yellow as a paperback's spine / kept on the radiator too long."
  pillar_scores: {pull: 12, craft: 21, spark: 17, echo: 19}

=== RE-SCORING RULES (read carefully — these override any instinct to be encouraging) ===
- The previous score is reference ONLY for describing the trend in comparison{}. NOT a floor, NOT an anchor.
- Compute the current overall_score by reading the current draft FRESH and summing the four pillar scores, AS IF you had never seen the previous version.
- ZERO PITY POINTS: do not raise the score because the writer revised, tried, or engaged with feedback. Raise the score ONLY if the rubric mathematically yields more points.
- If the edits did NOT fix underlying craft weaknesses, the score MUST stay the same OR drop. A revision can absolutely score lower.
- HARD CAP: overall_score must not exceed (lowest pillar × 4) + 20. Apply AFTER summing.
- Do NOT default to the polite middle (55-85). Weak drafts belong in 0-49 even on revision.
- Do NOT cluster pillars. If three pillars are 18 and one is 9, score the fourth 9, not 13 "to be fair".

=== LOCAL ANALYSIS GUIDANCE (soft, not hard) ===
Detected clichés normally lower Spark — UNLESS used ironically or subverted. Broken syllable targets normally lower Craft — UNLESS the breakage lands as deliberate rhythmic disruption. Heavy repetition normally lowers Craft or Spark — UNLESS doing visible work (refrain, incantation). Reward purposeful rule-breaking; penalize accidental failures.

Compute pillar_scores FIRST against the anchors, write pillar_rationales, then derive overall_score arithmetically. The math must be visible.

Keys:
pillar_scores {pull:int 0-25, craft:int 0-25, spark:int 0-25, echo:int 0-25} — REQUIRED. Score INDEPENDENTLY against the anchors. The four should show divergence.
pillar_rationales {pull:string, craft:string, spark:string, echo:string} — REQUIRED. One line per pillar (≤14 words, plain English). Name the specific line/image/sound that justified the score. No jargon.
overall_score (int 1-100, CURRENT) — MUST equal min(pull + craft + spark + echo, (lowest_pillar × 4) + 20). Compute arithmetically.
warm_reaction (≤14w, terse).
strengths[] (2-3 items, 6-12 words each — plain and specific, name the actual line/image: "the streetlight buzz pulls you in fast", not "strong sonic patterning").
weaknesses[] (2-3 items, 6-12 words each — same rule, plain and specific: "the closing line falls into received language", not "tonal failure").
strongest_line {line:int, why:≤10w plain words}.
issues[] (2-5).
comparison {improvements:[], regressions:[], unchanged:[]} (0-3 items each, ≤6w, may be empty).
personal_feedback (string, 2-3 sentences, addressed to the writer as "you". Holistic read of the CURRENT draft + the revision arc + one concrete next move, in one short paragraph. Mentor tone, no preamble.).
Each issue: id, severity ("high"|"medium"|"low"), line_start, line_end, headline (≤6w), problem_words?[],
  rationale (3-5 sentences — name the craft problem and which pillar it hurts, explain why it weakens THIS line, describe the effect on the reader, contrast with a sharper move),
  improvements[] (2-4 concrete moves, each ≤14 words), rewrite?, confidence? ("low" only).
Prefer single-line issues. 1-based line numbers. DO NOT emit overall_feedback — personal_feedback now carries both the holistic read and the addressed-to-you note.`;

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
    previousWeaknesses?: unknown;
    previousIssues?: unknown;
    draftMode?: unknown;
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
  const model = typeof body.model === "string" ? body.model : "gpt-5-mini";
  const draftMode = body.draftMode === true;

  const gib = await gibberishGuard({
    rawIp: req.headers["x-forwarded-for"],
    text: `${title}\n${lines.join("\n")}\n${changesText}`,
    apiKey,
  });
  if (!gib.ok) {
    if (gib.retryAfterSec) res.setHeader("Retry-After", String(gib.retryAfterSec));
    return res.status(gib.status).json(gib.body);
  }

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

  const previousWeaknesses = Array.isArray(body.previousWeaknesses)
    ? (body.previousWeaknesses as unknown[])
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        .slice(0, 6)
        .map((s) => s.trim().slice(0, 120))
    : [];

  const previousIssues = Array.isArray(body.previousIssues)
    ? (body.previousIssues as unknown[])
        .filter(
          (v): v is { line_start: number; line_end: number; headline?: string } =>
            !!v && typeof v === "object" &&
            typeof (v as { line_start: unknown }).line_start === "number",
        )
        .slice(0, 8)
        .map((iss) => ({
          line_start: Math.max(1, Math.round(iss.line_start)),
          line_end: Math.max(1, Math.round(iss.line_end)),
          headline: typeof iss.headline === "string" ? iss.headline.slice(0, 80) : "",
        }))
    : [];

  const titlePart = title.trim() ? `Title: ${title.trim()}\n\n` : "";
  const prevScoreText = prevScores ? `\nPrevious score: ${JSON.stringify(prevScores)}\n` : "";
  const historyText = scoreHistory && scoreHistory.length > 1
    ? `\nScore history (oldest → newest): ${scoreHistory.join(" → ")}\n`
    : "";
  let prevFlagged = "";
  if (previousWeaknesses.length > 0 || previousIssues.length > 0) {
    const sections: string[] = ["=== Previously flagged in last analysis (verify if resolved or still present) ==="];
    if (previousWeaknesses.length > 0) {
      sections.push(`Weaknesses: ${previousWeaknesses.map((w) => `"${w}"`).join("; ")}`);
    }
    if (previousIssues.length > 0) {
      sections.push("Past issues:");
      for (const iss of previousIssues) {
        const range = iss.line_start === iss.line_end ? `L${iss.line_start}` : `L${iss.line_start}–${iss.line_end}`;
        sections.push(`  - ${range}: ${iss.headline || "(no headline)"}`);
      }
    }
    sections.push("If the writer addressed any of these, list them under comparison.improvements (terse). If still present, raise them again in issues[]. Don't re-criticise fixed problems.");
    prevFlagged = "\n" + sections.join("\n") + "\n";
  }
  const contextBlock = buildContextHints(lines, local, goals, writingFocus);

  const userMessage = `${titlePart}=== CHANGES from previous draft (line numbers refer to the CURRENT draft below) ===\n${changesText}\n${prevScoreText}${historyText}${prevFlagged}\n=== CURRENT VERSION ===\n${numbered(lines)}${contextBlock}\n\n--- Scoring instructions ---\nScore the CURRENT version from scratch against the 4 pillars (Pull, Craft, Spark, Echo). Write one plain-language pillar_rationale per pillar (≤14 words) naming the specific line/image/sound that drove that score. The previous score and history above are reference ONLY for describing the trend in comparison{} — do NOT let them anchor or inflate the new score. Local-analysis signals are soft — reward intentional rule-breaking, penalize accidental failures. Do not cluster pillars; divergence is the point.`;

  const result = await callOpenAI(
    apiKey,
    {
      model,
      messages: [
        { role: "system", content: buildSystemPrompt(draftMode) },
        { role: "user", content: userMessage },
      ],
      max_tokens: 5000,
      temperature: 0,
      reasoningEffort: "low",
    },
    res,
  );
  if (!result) return;

  await recordSpend(spend.ip, result.model, result.usage.promptTokens, result.usage.completionTokens);
  sendParsedResponse(res, result.content, result.model, draftMode ? { draft: true } : undefined);
}
