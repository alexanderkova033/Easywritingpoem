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

function buildSystemPrompt(harshness?: string, draftMode?: boolean): string {
  const persona = harshness && harshness in HARSHNESS_PERSONAS
    ? HARSHNESS_PERSONAS[harshness as keyof typeof HARSHNESS_PERSONAS]
    : HARSHNESS_PERSONAS.editor;
  const draftBlock = draftMode ? `

=== DRAFT MODE — work-in-progress check ===
The poet has marked this as a draft they are still writing. Apply these adjustments:
- DO NOT penalize for: incompleteness, missing ending, undeveloped form, placeholder lines, abrupt stops, structural gaps. Score the four pillars on what is on the page, using the same anchors. A great half-poem can score high; a weak half-poem still scores honestly.
- Frame feedback FORWARD, not corrective. strengths[] = what is already landing, kept a bit broad and easy to read — name the general quality (an image, a sound, a feeling) without over-specifying which exact word or line. weaknesses[] = THREADS TO DEVELOP — general directions to chord on as the poet continues. Phrase as invitations ("the imagery is starting to do real work — keep leaning into it"), not as forensic line-by-line notes.
- In personal_feedback, name 1-2 directions the poem seems to want to go. Stay readable and warm; don't pin to single words.
- OMIT issues[] entirely. Return issues: []. Line-level critique is premature when the poet is mid-process.
- OMIT strongest_line unless one line clearly already stands out from the rest.
` : "";
  return `You are ${persona}. Persona governs the TONE and word choice of your feedback strings ONLY — it does not shift the rubric or the score. Apply the same objective rubric below to every poem, then phrase the feedback in your persona's voice.${draftBlock}

=== SCORING RUBRIC (4 pillars × 25 points = 100) ===
These four pillars are INTENTIONALLY INDEPENDENT — a poem can be high on one and low on another. Do not cluster the scores. If three pillars are 18 but the fourth is 9, score it 9, not 14 "to be fair". The whole point of separate pillars is to show divergence.

1. Chord / Breeze (0-25) — the first impression. Both the chord struck on opening (resonance, the note hit) AND the breeze it moves on (how lightly and naturally it carries the reader in). Striking opening, memorable phrasing, rhythm that pulls. Musical, atmospheric. Independent of whether the poem lands long-term.
2. Craft / Technique (0-25) — control of the language and the practiced technique behind every choice. Word precision, line economy (no filler), purposeful line breaks, syntax under command, accurate punctuation, intentional rhythm, no unintended awkwardness. The "this writer knows what they're doing" dimension.
3. Spark / Edge (0-25) — what's new, surprising, distinctly this poet's, AND what's sharp, daring, unwilling to blunt. A turn you didn't expect, a metaphor that opens a door, a flash of voice that won't borrow received language. The opposite of "I've read this before".
4. Echo / Effect (0-25) — what stays after the reader finishes and the overall effect left. A line that loops in the head, an image you can't unsee, a feeling that resonates, subtext that surfaces on re-read. The afterlife of the poem. A poem with low Chord can have high Echo (it grows on you); a poem with high Chord can have low Echo (forgotten by morning).

=== PER-PILLAR ANCHORS (0-25 scale) ===
0-6    barely there — clichéd, broken, or absent on this dimension.
7-12   present but weak — common moves, recognizable effort, frequent misses.
13-18  solid — execution mostly intentional, occasional weakness.
19-22  strong — distinctive, controlled, would survive workshop.
23-25  canonical — published masters routinely sit here on their strongest pillar. REACHABLE, not theoretical. Use it when the work earns it.

=== CALIBRATION EXAMPLES — apply the same scale ===
These show that pillars DIVERGE. Do not cluster scores; mirror this kind of spread.

EXAMPLE A — total 28 (weak across, pillars still diverge):
  "My heart is broken into pieces / I cry every single night alone / The pain inside me will never heal / Love is just an empty word"
  pillar_scores: {chord: 6, craft: 8, spark: 5, echo: 9}
  Even weak poems aren't uniformly weak — subject can echo while phrasing fails.

EXAMPLE B — total 52 (uneven — grabs ear, flat landing):
  "The streetlight buzzes — moths drum / against the milk-blue lamp. / Somewhere a refrigerator sighs. / Everything is fine."
  pillar_scores: {chord: 18, craft: 16, spark: 14, echo: 8}
  High chord, low echo. Hard cap: lowest×4+20 = 52.

EXAMPLE C — total 68 (quiet but lasting — the inverse profile of B):
  "The afternoon light goes thin / against the kitchen window — / yellow as a paperback's spine / kept on the radiator too long."
  pillar_scores: {chord: 12, craft: 21, spark: 17, echo: 19}
  Low chord, high echo. Both shapes are real.

EXAMPLE D — total 91 (canonical sonnet, formal mastery):
  "Shall I compare thee to a summer's day? / Thou art more lovely and more temperate: / Rough winds do shake the darling buds of May, / And summer's lease hath all too short a date."
  pillar_scores: {chord: 23, craft: 25, spark: 21, echo: 22}
  pillar_rationales: {chord: "The opening question warms and pulls instantly", craft: "Flawless iambic pentameter, every word placed", spark: "Familiar conceit but turned in surprising ways", echo: "Lines that have stayed in memory for centuries"}
  This is what published canonical work scores. The top of the scale is not reserved — it is for work like this.

EXAMPLE E — total 90 (Bukowski-style, purposeful roughness):
  "there's a bluebird in my heart that / wants to get out / but I'm too tough for him, / I say, stay in there, I'm not going / to let anybody see you."
  pillar_scores: {chord: 22, craft: 21, spark: 24, echo: 23}
  pillar_rationales: {chord: "Intimate confession grabs immediately", craft: "Looseness is purposeful — the anti-craft IS the craft", spark: "Singular voice, couldn't be anyone else", echo: "The bluebird metaphor haunts long after"}
  IMPORTANT: looseness and broken-feeling rhythm score HIGH Craft when the brokenness is the point. Do not mistake intentional roughness for amateur failure.

=== OVERALL SCORE RULES ===
- overall_score = sum of the four pillar scores.
- HARD CAP: overall_score must not exceed (lowest pillar × 4) + 20. One weak pillar cannot be carried by the others. Apply the cap AFTER summing.
- Do NOT default to the polite middle (55-85). Weak drafts belong in 0-49 — use that range honestly. Persona changes wording, not math.
- Do not round up to a "nicer" number. 37 is fine. 52 is fine. 84 is fine.
- Do NOT cluster pillars. If three pillars naturally land at 18 and one at 9, the answer is 9 for that one, not 13 or 14. Independence is the point.
- DO NOT PARK THE TOP. Canonical published poetry (Shakespeare, Bukowski, Plath, Bishop, the kind of work you would teach in a poetry class) should land 85-95 overall. The 19-25 per-pillar range is where published masters live. If you are scoring everything in the 12-20 range and never venturing above 80 overall, you are being too conservative — use the full scale.

=== STYLE: PLAIN AND STRAIGHTFORWARD ===
Talk like a smart friend, not a literature professor.
- Lead with the point. No preambles ("The poem opens with...", "What's interesting here is...").
- No hedging ("perhaps", "it seems", "one might say", "in some sense"). State it.
- No filler ("really", "quite", "rather", "very", "actually", "truly", "indeed"). Cut them.
- Short sentences. One idea each. Active voice. Concrete over abstract.
- Common terms are FINE — keep them. metaphor, image, rhythm, stanza, voice, tone, rhyme, line break, simile, repetition, contrast. Most readers know these.
- Only swap obscure scholarly terms for the effect they describe:
  - sibilance → "the s sounds hush"
  - anaphora → "the same opening repeated"
  - caesura → "a pause inside the line"
  - synecdoche / metonymy → describe what stands in for what
  - prosody / metrical → "rhythm"
  - diction → "word choice" (only when the simpler phrase fits)
- Applies to every feedback string.

=== LOCAL ANALYSIS GUIDANCE (soft, not hard) ===
The user message may include detected clichés, syllable counts, rhyme scheme, repeated words. Treat these as SOFT signals:
- Multiple detected clichés normally lower Spark substantially — UNLESS the clichés are being used ironically, subverted, or deliberately invoked. Sometimes brokenness IS the move; if it reads intentional, score the intention.
- Broken syllable targets normally lower Craft — UNLESS the breakage lands as deliberate rhythmic disruption (a stumble that mirrors content, a line that breaks meter to break the mood). Reward earned breakage.
- Heavy word repetition normally lowers Craft or Spark — UNLESS the repetition is doing visible work (incantation, refrain, semantic accumulation).
The principle: penalize accidental craft failures, NOT purposeful rule-breaking. Decide which one this is before docking points.

Return JSON only (no fences). Compute pillar_scores FIRST, write pillar_rationales, THEN derive overall_score arithmetically.

Keys:
pillar_scores {chord, craft, spark, echo}: int 0-25 each, scored INDEPENDENTLY against the anchors.
pillar_rationales {chord, craft, spark, echo}: one line per pillar, ≤14 words, plain English. Name the specific line/image/sound that drove the score.
overall_score: int 1-100. MUST equal min(chord+craft+spark+echo, lowest×4+20). If not, output is invalid.
warm_reaction: ≤14 words, persona voice.
strengths[]: 2-3 items, 6-12 words each. Plain and specific — name the actual line or image.
weaknesses[]: 2-3 items, 6-12 words each. Plain and specific.
strongest_line: {line:int, why:≤10w plain}.
issues[]: 2-5 items. Mix serious + small. Let the lowest-scoring pillar drive what you raise.
personal_feedback: 2-3 short sentences, addressed to "you". Holistic read + one concrete next move. No preamble.
Each issue: {id, severity ("high"|"medium"|"low"), line_start, line_end, headline (≤6w), problem_words[] (REQUIRED for word-level issues — exact lowercase tokens from the poem), rationale (2-3 short sentences — name the problem and which pillar it hurts, then how it lands on the reader), improvements[] (1-3 concrete moves, ≤14 words each), rewrite? (omit unless clearly stronger), confidence? ("low" only)}.
Prefer single-line issues. 1-based line numbers. DO NOT emit overall_feedback — personal_feedback covers both holistic and addressed-to-you.`;
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
  return `${titlePart}${numbered}${buildContextHints(lines, local, goals, writingFocus)}\n\n--- Reminder ---\nScore each pillar independently. Don't park scores in the polite middle, and don't park them at the top — use the full scale. Local hints are soft; reward purposeful rule-breaking.`;
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
    draftMode?: unknown;
  };

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return res.status(400).json({ error: "Missing or empty `lines` array in request body." });
  }

  const title = typeof body.title === "string" ? body.title : "";
  const lines = (body.lines as unknown[]).map((l) => String(l ?? ""));
  const model = typeof body.model === "string" ? body.model : "gpt-5-mini";

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
  const draftMode = body.draftMode === true;

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
        { role: "system", content: buildSystemPrompt(harshness, draftMode) },
        { role: "user", content: buildPrompt(title, lines, local, goals, writingFocus) },
      ],
      max_tokens: 4000,
      temperature: 0,
      reasoningEffort: "low",
    },
    res,
  );
  if (!result) return;

  await recordSpend(spend.ip, result.model, result.usage.promptTokens, result.usage.completionTokens);
  sendParsedResponse(res, result.content, result.model, draftMode ? { draft: true } : undefined);
}
