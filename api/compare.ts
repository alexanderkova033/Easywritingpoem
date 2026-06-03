/**
 * Vercel serverless function — POST /api/compare
 *
 * Receives { title, lines, changesText, previousScores, localAnalysis?, goals? }
 * and asks the model to analyse the current poem AND compare it to the previous version.
 */
import { createHash } from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkRateLimit, getRateLimitRetrySec } from "./_rate-limit";
import { callOpenAI, sendParsedResponse } from "./_openai";
import { kvGetString, kvSetStringPx } from "./_kv";
import { cooldownFor, precheckSpend, recordSpend } from "./_usage-cap";
import { gibberishGuard } from "./_gibberish";

// Server-side compare response cache. Same rationale as analyze.ts: temperature 0
// makes outputs deterministic on inputs, so identical revisions (same current poem,
// same diff, same prior context) return the cached response without burning cooldown.
// Hit cases: edit a line → compare → refresh page → compare again.
const COMPARE_CACHE_MS = 24 * 60 * 60 * 1000;
const COMPARE_CACHE_VERSION = "v3"; // bump when prompt structure changes

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => stableStringify(v)).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return "{" + keys.map((k) =>
    JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k]),
  ).join(",") + "}";
}

function compareCacheKey(inputs: {
  title: string;
  lines: string[];
  changesText: string;
  previousScores: unknown;
  previousWeaknesses: string[];
  previousIssues: unknown;
  model: string;
  localAnalysis: unknown;
  goals: unknown;
  writingFocus: string | undefined;
  draftMode: boolean;
}): string {
  const hash = createHash("sha256")
    .update(stableStringify(inputs))
    .digest("hex")
    .slice(0, 24);
  return `compare:${COMPARE_CACHE_VERSION}:${hash}`;
}

interface CachedCompareEntry {
  content: string;
  model: string;
}

const DRAFT_BLOCK = `\n\nNote: the poem is not fully written yet — treat it as a work-in-progress draft.`;

function buildSystemPrompt(draftMode?: boolean): string {
  return BASE_SYSTEM_PROMPT + (draftMode ? DRAFT_BLOCK : "");
}

const BASE_SYSTEM_PROMPT = `You are an objective poetry editor re-scoring a revision. You receive a diff (previous → current), the previous score, and the current draft. Score the CURRENT version against the rubric below — not against the previous score.

=== SCORING RUBRIC (4 pillars × 25 points = 100) ===
These four pillars are INDEPENDENT — divergence is the point, not noise to smooth over.

1. Chord / Breeze (0-25) — first impression. The note struck on opening + how lightly it carries the reader in. Memorable phrasing, rhythm that pulls. Independent of whether the poem lasts. SOLID-BAND TEST: opening pulls; the first 2-3 lines aren't received language; rhythm or phrasing makes you keep reading.
2. Craft / Technique (0-25) — control over the language. Word precision, line economy, purposeful line breaks, syntax in command, intentional rhythm. SOLID-BAND TEST: at least one deliberate move held proportionally to the poem's length (rhyme scheme, anaphora doing real work, sustained image system, deliberate stanza shape, syntactic control); execution mostly intentional, occasional weakness.
3. Spark / Edge (0-25) — distinctiveness OR insight. A turn you didn't expect, voice that won't borrow received language — OR precise observation, sharp argument, emotional accuracy that resists received language. Novelty alone is not quality. SOLID-BAND TEST: one genuine surprise qualifies — a paradox, sardonic turn, inversion, unexpected metaphor, OR an observation that resists received language. Does NOT require canonical-level transformation.
4. Echo / Effect (0-25) — what stays after reading: the afterlife of the poem. A line that loops, an image you can't unsee, subtext on re-read. Echo can come from a resonant observation or paradox even without images. SOLID-BAND TEST: at least one line, image, or paradox that surfaces on re-read; the poem leaves residue.

=== PER-PILLAR ANCHORS (0-25 scale) ===
0-6    barely there — clichéd, broken, or absent on this dimension.
7-12   present but weak — pattern attempted then dropped; voice inconsistent; structural choice doesn't carry (or doesn't carry proportionally if the poem is short).
13-18  solid — meets the pillar's SOLID-BAND TEST above; voice consistent; execution mostly intentional, occasional weakness.
19-22  strong — distinctive, controlled; would survive workshop. The solid-band test is met AND extended: the deliberate move isn't just present, it's working hard.
23-25  canonical — published masters routinely sit here on their strongest pillar. REACHABLE, not theoretical.

=== PILLAR SCORING DISCIPLINE ===
- Before assigning each pillar score, locate specific evidence on the page — a line, an image, a structural move. If you cannot cite particular text supporting the number, you are defaulting; re-read.
- If 3+ pillars land within 2 points of each other in the same band, you're bucketing instead of reading independently. Reconsider each pillar against its own anchor.
- Judge density, not length. A short poem may hit max scores by doing more per word. "Sustained across the poem" applies proportionally to the poem's actual length — don't dock a four-line piece for not accumulating evidence a twenty-line piece would.

=== CALIBRATION EXAMPLES — match before scoring ===
Pillars DIVERGE — mirror this spread. BEFORE producing pillar_scores, match the poem to one of the examples below by structural PROFILE (not topic):
  A = weak-across (clichéd)
  B = high chord, low echo (grabs but doesn't last)
  C = low chord, high echo (quiet but lasting)
  D = canonical breadth (sonnet-grade)
  E = purposeful roughness (looseness as craft)
  F = plainspoken insight / paradox without imagery
  G = workshop-competent voice (real observation, sustained metaphor or extended structure, not canonical)
Anchor your pillar reads against the matched example. Reading the anchor table without matching first defaults borderline poems to mid-band — which is exactly how insight-driven and sustained-metaphor work gets underscored.

EXAMPLE A — total 28 (weak):
  "My heart is broken into pieces / I cry every single night alone / The pain inside me will never heal / Love is just an empty word"
  pillar_scores: {chord: 6, craft: 8, spark: 5, echo: 9}

EXAMPLE B — total 52 (uneven — grabs ear, flat landing):
  "The streetlight buzzes — moths drum / against the milk-blue lamp. / Somewhere a refrigerator sighs. / Everything is fine."
  pillar_scores: {chord: 18, craft: 16, spark: 14, echo: 7}

EXAMPLE C — total 69 (quiet but lasting):
  "The afternoon light goes thin / against the kitchen window — / yellow as a paperback's spine / kept on the radiator too long."
  pillar_scores: {chord: 12, craft: 21, spark: 17, echo: 19}

EXAMPLE D — total 96 (canonical sonnet, near the top of the scale):
  "Shall I compare thee to a summer's day? / Thou art more lovely and more temperate: / Rough winds do shake the darling buds of May, / And summer's lease hath all too short a date."
  pillar_scores: {chord: 24, craft: 25, spark: 23, echo: 24}
  Masterworks live in the 92-99 band. Don't park canonical work at 90 — the top is for work like this.

EXAMPLE E — total 90 (Bukowski-style, purposeful roughness):
  "there's a bluebird in my heart that / wants to get out / but I'm too tough for him, / I say, stay in there, I'm not going / to let anybody see you."
  pillar_scores: {chord: 22, craft: 21, spark: 24, echo: 23}
  IMPORTANT: looseness scores HIGH Craft when the brokenness is the point. Do not mistake intentional roughness for amateur failure.

EXAMPLE F — total 92 (quiet plainspoken — insight without imagery):
  "I sat beside my mother's bed / and listened to the machines / pretend they knew / what living meant."
  pillar_scores: {chord: 22, craft: 23, spark: 22, echo: 25}
  IMPORTANT: insight and emotional precision reach the top of the scale without imagery. The bare diction IS the craft. Spark comes from observation, not novelty. Don't park plainspoken work mid-scale just because it isn't "literary."

EXAMPLE G — total 78 (competent revised draft — clear voice, real noticing, doesn't break new ground):
  "At forty I keep finding / my mother's handwriting / in the margins of my own — / the way I cross my sevens, / the way I close my parentheses."
  pillar_scores: {chord: 18, craft: 19, spark: 19, echo: 22}
  IMPORTANT: most workshop-grade revised drafts sit here. Clear voice, specific observation, one quiet resonance — not canonical. The 70-85 band exists for craft that lands without breaking new ground. Don't skip past this band.

=== RE-SCORING RULES (override any instinct to be encouraging) ===
- Previous score is reference ONLY for comparison{}. NOT a floor, NOT an anchor. The prior reading may have been over- or under-calibrated; don't trend toward it for smoothness. A genuinely improved revision may score lower; a flat revision may score higher. Read CURRENT against the rubric, not against the number.
- Compute overall_score by reading the current draft FRESH, as if you'd never seen the previous version.
- ZERO PITY POINTS. Don't raise the score because the writer revised or engaged with feedback. Only raise it if the rubric mathematically yields more points.
- If edits didn't fix underlying weaknesses, the score stays the same or drops. Revisions can absolutely score lower.
- DO NOT manufacture issues to justify a score. If the current draft has no genuine misses, return 0-1 (empty issues[] is correct for a strong poem). Issues follow evidence, NOT the score.
- HARD CAP: overall_score ≤ (lowest pillar × 4) + 24. Apply AFTER summing — a weak pillar still pulls hard, but doesn't crush three strong ones.
- USE THE FULL 1-100 SCALE: weak 0-49 (even on revision), competent-but-imperfect 50-85 (don't skip — see Example G), canonical 85-99, masterworks 92-99.
- Don't cluster pillars. A pillar at 9 stays at 9 — don't drift it up to harmonize with three pillars at 18.

=== STYLE ===
Plain English, like a smart friend talking. Common terms fine; skip scholarly jargon. Applies to every feedback string.

=== LOCAL ANALYSIS GUIDANCE (soft, not hard) ===
- Detected clichés normally lower Spark — UNLESS used ironically, subverted, or framing an observation/insight that resists received language.
- Broken syllable targets normally lower Craft — UNLESS the breakage is deliberate rhythmic disruption.
- Heavy repetition normally lowers Craft or Spark — UNLESS doing visible work (refrain, incantation).
- Plain diction, dragging rhythm, and worn metaphor normally lower Craft — UNLESS the voice register stays consistently weary, deadpan, or sardonic across the poem (tone-controlled plainness is craft, not its absence).
Principle: penalize accidental craft failures, NOT purposeful rule-breaking.

=== ISSUE RATIONALE STYLE — match this pattern exactly ===
Each rationale = exactly 3 short concrete sentences. Compare:

GOOD: "The phrase 'gentle breeze' is the dictionary entry for breeze. It collapses what could be a tactile sensation into received language. A specific weather verb — needling, slack, brackish — would carry actual weight."

BAD: "This line could be stronger. The image is okay but generic. Consider revising for more specificity."

GOOD names the exact problem, says why it weakens THIS line, gestures at a sharper move. BAD is generic. Write GOOD. No moralizing, no pillar lectures — just the concrete miss.

=== RESPONSE SHAPE — return ONLY this JSON ===
Compute pillar_scores FIRST against the anchors, then derive overall_score arithmetically.
{
  "pillar_scores": {"chord": <int 0-25>, "craft": <int 0-25>, "spark": <int 0-25>, "echo": <int 0-25>},
  "overall_score": <int 1-100 for CURRENT, MUST equal min(chord+craft+spark+echo, lowest×4+24)>,
  "warm_reaction": "<≤14 words, terse>",
  "strengths": ["<6-12 words, plain — name the actual line/image>", ...2-3 items],
  "weaknesses": ["<6-12 words, plain>", ...2-3 items],
  "strongest_line": {"line": <int>, "why": "<≤10 words>"},  // OMIT entirely if no single line clearly stands out (cumulative/prose/highly consistent poems). Don't invent significance.
  "issues": [
    {
      "id": "<short kebab-case>",
      "severity": "high" | "medium" | "low",
      "line_start": <int, 1-based>,
      "line_end": <int, 1-based>,
      "headline": "<≤6 words>",
      "problem_words": ["<1-2 lowercase tokens — the actual offending word(s), never stopwords like 'the/and/is'>"],
      "rationale": "<exactly 3 short sentences, GOOD-style above>",
      "improvements": ["<concrete move, ≤14 words>", ...1-3 items],
      "rewrite": "<omit field entirely unless clearly stronger>"
    }
  ],
  "comparison": {
    "improvements": ["<≤6 words>", ...0-3 items],
    "regressions": ["<≤6 words>", ...0-3 items],
    "unchanged": ["<≤6 words>", ...0-3 items]
  },
  "personal_feedback": "<2-3 sentences addressed to 'you' — holistic read of CURRENT + the revision arc + one concrete next move, no preamble>"
}

issues[]: 0-3 items (see RE-SCORING RULES above on when to return 0-1 or empty). Prefer single-line. problem_words ONLY when the issue is genuinely word-level (diction, cliché, dead verb); OMIT entirely for structural issues (rhythm, break, pacing). Omit rewrite when unused (no null, no empty). NO TASTE CALLS: if your objection is a stylistic preference the writer could reasonably reject (a low-confidence call), OMIT the entire issue. Only flag misses you'd defend on the page with specific evidence.`;

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
  const prevScores = body.previousScores ?? null;
  const local = (body.localAnalysis && typeof body.localAnalysis === "object" ? body.localAnalysis : undefined) as LocalAnalysis | undefined;
  const goals = (body.goals && typeof body.goals === "object" ? body.goals : undefined) as GoalsContext | undefined;
  const writingFocus = typeof body.writingFocus === "string" ? body.writingFocus.slice(0, 500) : undefined;

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

  // Cache check — done BEFORE precheckSpend and OpenAI so cache hits don't
  // burn the per-IP cooldown. compare runs at temperature 0, so identical
  // inputs return the same answer the model would generate.
  const cacheKey = compareCacheKey({
    title, lines, changesText, previousScores: prevScores, previousWeaknesses,
    previousIssues, model, localAnalysis: local, goals, writingFocus, draftMode,
  });
  const cachedRaw = await kvGetString(cacheKey);
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw) as CachedCompareEntry;
      if (cached?.content && cached?.model) {
        sendParsedResponse(res, cached.content, cached.model, draftMode ? { draft: true } : undefined);
        return;
      }
    } catch {
      // Corrupted entry — fall through and regenerate.
    }
  }

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

  const titlePart = title.trim() ? `Title: ${title.trim()}\n\n` : "";
  const prevScoreText = prevScores ? `\nPrevious score: ${JSON.stringify(prevScores)}\n` : "";
  let prevFlagged = "";
  if (previousWeaknesses.length > 0 || previousIssues.length > 0) {
    const sections: string[] = ["Previously flagged in last analysis (verify if resolved or still present):"];
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

  // Order matters: poem FIRST so scoring happens against the rubric, then the
  // comparison context. Prior score is shown last and clearly labelled as
  // comparison-only — putting it ahead of the poem anchors the model to it.
  const comparisonContext = (prevScoreText || prevFlagged)
    ? `\n\n=== Comparison context (for the comparison{} block in your response ONLY — do NOT anchor your pillar scores or overall_score to these numbers) ===${prevScoreText}${prevFlagged}`
    : "";

  const userMessage = `${titlePart}=== CURRENT VERSION (score this FRESH against the rubric, as if you'd never seen the previous draft) ===\n${numbered(lines)}${contextBlock}\n\n=== CHANGES from previous draft (line numbers refer to the CURRENT draft above) ===\n${changesText}${comparisonContext}`;

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
      timeoutMs: 30_000,
      retries: 2,
    },
    res,
  );
  if (!result) return;

  await recordSpend(spend.ip, result.model, result.usage.promptTokens, result.usage.completionTokens);
  // Store raw OpenAI content + resolved model so future identical inputs skip
  // the call. Best-effort; failure here must not break the response.
  void kvSetStringPx(
    cacheKey,
    JSON.stringify({ content: result.content, model: result.model } satisfies CachedCompareEntry),
    COMPARE_CACHE_MS,
  ).catch(() => {});
  sendParsedResponse(res, result.content, result.model, draftMode ? { draft: true } : undefined);
}
