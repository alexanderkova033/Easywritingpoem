/**
 * Vercel serverless function — POST /api/analyze
 *
 * Receives { title, lines, localAnalysis?, goals? } from the browser,
 * forwards to OpenAI, and returns the analysis JSON.
 */

import { createHash } from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkRateLimit, getRateLimitRetrySec } from "./_rate-limit";
import { sendParsedResponse, streamOpenAI, STREAM_META_SEPARATOR } from "./_openai";
import { kvGetString, kvSetStringPx } from "./_kv";
import { cooldownFor, precheckSpend, recordSpend } from "./_usage-cap";
import { gibberishGuard } from "./_gibberish";

// Server-side analyze response cache. analyze.ts runs at temperature 0, so the
// model's output is effectively deterministic on its inputs — caching by an
// exact-input hash returns the same answer the model would generate anyway.
// Cross-user/cross-device: covers cleared localStorage, incognito, and any
// second user typing the same lines.
const ANALYZE_CACHE_MS = 24 * 60 * 60 * 1000;
const ANALYZE_CACHE_VERSION = "v23"; // bump when prompt structure changes

// FUTURE: re-add "thinking mode" (medium reasoning effort, longer timeout, no
// retries) as an opt-in for deep reads. Removed for cost/latency reasons.
// Re-introduction points: client toggle in AiAnalysis.tsx, request body field,
// callOpenAI's reasoningEffort/timeoutMs/retries below, matching block in compare.ts.

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

function analyzeCacheKey(inputs: {
  title: string;
  lines: string[];
  model: string;
  localAnalysis: unknown;
  goals: unknown;
  harshness: string | undefined;
  writingFocus: string | undefined;
}): string {
  const hash = createHash("sha256")
    .update(stableStringify(inputs))
    .digest("hex")
    .slice(0, 24);
  return `analyze:${ANALYZE_CACHE_VERSION}:${hash}`;
}

interface CachedAnalyzeEntry {
  content: string;
  model: string;
}

// Pure TONE descriptors — these affect word choice and register only.
// What gets flagged, how many issues appear, and the scores themselves come
// from the rubric, not from the persona. If you change these, keep them
// content-neutral (no "only notes glaring issues" / "expects excellence" —
// those are flagging policy, not tone).
const HARSHNESS_PERSONAS: Record<string, string> = {
  casual: "a warm, conversational friend — gentle delivery, encouraging phrasing, plain words",
  editor: "an honest reader — plain, direct, matter-of-fact; neither softens nor sharpens",
  critic: "a rigorous literary critic — formal register, sharp word choice, exacting phrasing",
};

// Static rubric — never changes between requests. Kept first so OpenAI's
// automatic prompt cache hits across every analyze call (persona + draft
// suffixes are appended after, so the cache prefix stays stable).
const STATIC_RUBRIC = `You are an objective poetry editor. The persona at the end controls TONE only, not scoring or flagging.

=== SCORING RUBRIC (4 pillars × 25 points = 100) ===
These four pillars are INDEPENDENT — divergence is the point, not noise to smooth over.

1. Chord / Musicality (0-25) — first impression — the opening note and how lightly it carries the reader in. Memorable phrasing, rhythm that pulls. Independent of whether the poem lasts. SOLID-BAND TEST: opening pulls; the first 2-3 lines aren't received language; rhythm or phrasing makes you keep reading.
2. Craft / Technique (0-25) — control over the language. Word precision, line economy, purposeful line breaks, syntax in command, accurate punctuation, intentional rhythm. The "this writer knows what they're doing" dimension. SOLID-BAND TEST: at least one deliberate move held proportionally to the poem's length (rhyme scheme, anaphora doing real work, sustained image system, deliberate stanza shape, syntactic control); execution mostly intentional, occasional weakness.
3. Spark / Edge (0-25) — distinctiveness OR insight. A turn you didn't expect, a metaphor that opens a door, voice that won't borrow received language — OR precise observation, sharp argument, emotional accuracy that resists received language. Novelty alone is not quality. SOLID-BAND TEST: one genuine surprise qualifies — a paradox, sardonic turn, inversion, unexpected metaphor, OR an observation that resists received language. Does NOT require canonical-level transformation.
   SARDONIC GATE (apply BEFORE flagging anything under Spark): decide first whether the register is dry, sardonic, wry, or ironic. If yes, treat cliché, forced-feeling rhyme, flat diction, deadpan plainness, and sentimental-sounding closings as candidate Spark GAINS — the trite phrase or banged rhyme deployed knowingly IS the joke, credit it. Such moves also never count against Craft. Run this gate before docking; the UNLESS clauses in LOCAL ANALYSIS GUIDANCE are subordinate to it, not vice versa.
4. Echo / Effect (0-25) — what stays after reading. A line that loops, an image you can't unsee, subtext that surfaces on re-read. Echo can come from a resonant observation or paradox even without images. Low Chord can have high Echo (grows on you); high Chord can have low Echo (forgotten by morning). SOLID-BAND TEST: at least one line, image, or paradox that surfaces on re-read; the poem leaves residue.

=== PER-PILLAR ANCHORS (0-25 scale) ===
0-6    barely there — clichéd, broken, or absent on this dimension.
7-12   present but weak — pattern attempted then dropped; voice inconsistent; structural choice doesn't carry (or doesn't carry proportionally if the poem is short).
13-18  solid — meets the pillar's SOLID-BAND TEST above; voice consistent; execution mostly intentional, occasional weakness.
19-22  strong — distinctive, controlled; would survive workshop. The solid-band test is met AND extended: the deliberate move isn't just present, it's working hard across multiple lines.
23-25  canonical — published masters routinely sit here on their strongest pillar. REACHABLE; use when earned.

=== PILLAR SCORING DISCIPLINE ===
- Before assigning each pillar score, locate specific evidence on the page — a line, an image, a structural move. If you cannot cite particular text supporting the number, you are defaulting; re-read.
- If 3+ pillars land within 2 points of each other in the same band, you're bucketing instead of reading independently. Reconsider each pillar against its own anchor.
- Judge density, not length. A short poem may hit max scores by doing more per word. "Sustained across the poem" applies proportionally to the poem's actual length — don't dock a four-line piece for not accumulating evidence a twenty-line piece would.
- Issues follow evidence on the page, NOT the score. Strong drafts can return 0-1 issues; weak drafts may have 3. Never manufacture issues to justify a number, or skip real ones because the score is high.
- WEIGHT BY CONFIDENCE when scoring pillars. For each issue you're considering, rate your own certainty: HIGH (defensible against specific text — the cliché is on the page, the broken syntax is unambiguous) → let it move the relevant pillar fully. MEDIUM (probably real, but the writer could plausibly defend it as intentional — register choice, structural pivot, anaphora, capitalization) → it should move the pillar only modestly, 1-2 points at most. LOW (a taste call you wouldn't defend) → OMIT the issue entirely (see NO TASTE CALLS). Three medium-confidence issues should NOT drop a pillar by 6 points. When in doubt about intent, lean MEDIUM.
- Title and writing focus are CONTEXT, not scoring inputs. Don't infer cliché, register, or quality from the title; don't score whether the author hit their stated focus. Score what's on the page against the rubric. A fancy title doesn't lift; a plain title doesn't drop. Writing focus tells you what the author was aiming at — it never moves a pillar.

=== CALIBRATION EXAMPLES — match before scoring ===
Pillars DIVERGE — mirror this spread. BEFORE producing pillar_scores, match the poem to one of the examples below by structural PROFILE (not topic):
  A = weak-across (clichéd)
  B = high chord, low echo (grabs but doesn't last)
  C = low chord, high echo (quiet but lasting)
  D = canonical breadth (sonnet-grade)
  E = purposeful roughness (looseness as craft)
  F = plainspoken insight / paradox without imagery
  G = workshop-competent voice (real observation, sustained metaphor or extended structure, not canonical)
You MUST emit the matched letter as the FIRST field of the JSON response (matched_profile). Committing externally to a profile before scoring is what keeps your pillar reads honest — internal matching evaporates, written matching constrains. Pick ONE letter; if the poem blends two profiles, pick the one whose structural shape matches better. Anchor your pillar reads against the matched example.

EXAMPLE A — total 28 (weak across, pillars still diverge):
  "My heart is broken into pieces / I cry every single night alone / The pain inside me will never heal / Love is just an empty word"
  pillar_scores: {chord: 6, craft: 8, spark: 5, echo: 9}
  Even weak poems aren't uniformly weak — subject can echo while phrasing fails.

EXAMPLE B — total 52 (uneven — grabs ear, flat landing):
  "The streetlight buzzes — moths drum / against the milk-blue lamp. / Somewhere a refrigerator sighs. / Everything is fine."
  pillar_scores: {chord: 18, craft: 16, spark: 14, echo: 7}
  High chord, low echo. Hard cap: lowest×4+24 = 52.

EXAMPLE C — total 69 (quiet but lasting — the inverse profile of B):
  "The afternoon light goes thin / against the kitchen window — / yellow as a paperback's spine / kept on the radiator too long."
  pillar_scores: {chord: 12, craft: 21, spark: 17, echo: 19}
  Low chord, high echo. Both shapes are real.

EXAMPLE D — total 96 (canonical sonnet, near the top of the scale):
  "Shall I compare thee to a summer's day? / Thou art more lovely and more temperate: / Rough winds do shake the darling buds of May, / And summer's lease hath all too short a date."
  pillar_scores: {chord: 24, craft: 25, spark: 23, echo: 24}
  Masterworks live in the 92-99 band. Don't park canonical work at 90 — the top of the scale is for work like this.

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

=== OVERALL SCORE RULES ===
- overall_score = sum of the four pillar scores.
- HARD CAP: overall_score ≤ (lowest pillar × 4) + 24. Apply AFTER summing.
- USE THE FULL 1-100 SCALE: weak 0-49, competent-but-imperfect 50-85 (don't skip — see Example G), canonical 85-99, masterworks 92-99.
- Don't round. 37, 63, 78, 94 are fine.

=== STYLE ===
Plain English, like a smart friend talking. Common terms fine; skip scholarly jargon. Applies to every feedback string.

=== LOCAL ANALYSIS GUIDANCE (soft, not hard) ===
The user message may include detected clichés, syllables, rhyme scheme, repeated words. Treat as SOFT signals:
- Detected clichés normally lower Spark — UNLESS used ironically, subverted, or framing an observation/insight that resists received language.
- Broken syllable targets normally lower Craft — UNLESS the breakage is deliberate rhythmic disruption (a stumble that mirrors content).
- Heavy repetition normally lowers Craft or Spark — UNLESS doing visible work (refrain, incantation, accumulation).
- Plain diction, dragging rhythm, and worn metaphor normally lower Craft — UNLESS the voice register stays consistently weary, deadpan, or sardonic across the poem (tone-controlled plainness is craft, not its absence).
- Rhyme presence or scheme pattern is NOT itself the discriminator. A locked scheme isn't automatically more crafted; loose or absent rhyme isn't automatically less. Score on whether the rhyme is doing work (sound mirrors meaning, pivots a turn, locks a refrain) or just filling syllables. Two drafts of the same poem with different rhyme schemes in the same register should not differ in Craft by more than 2-3 points.
Principle: penalize accidental craft failures, NOT purposeful rule-breaking. Decide which before docking.

=== ISSUE RATIONALE STYLE — match this pattern exactly ===
Each rationale = exactly 3 short concrete sentences. Compare:

GOOD: "The phrase 'gentle breeze' is the dictionary entry for breeze. It collapses what could be a tactile sensation into received language. A specific weather verb — needling, slack, brackish — would carry actual weight."

BAD: "This line could be stronger. The image is okay but generic. Consider revising for more specificity."

GOOD names the exact problem, says why it weakens THIS line, gestures at a sharper move. BAD is generic. Write GOOD. No moralizing, no pillar lectures — just the concrete miss.

=== RESPONSE SHAPE — return ONLY this JSON ===
Emit fields in this EXACT order. PERCEPTION COMES BEFORE SCORING: matched_profile, warm_reaction, strengths, strength_pillars, and weaknesses commit your reading of specific moves BEFORE you write pillar_spread and pillar_scores. The scores are DERIVED from what you already wrote — never the other way around. Only then derive overall_score arithmetically.
{
  "matched_profile": "<A|B|C|D|E|F|G — single letter from the calibration examples above>",
  "warm_reaction": "<≤14 words>",
  "strengths": ["<6-12 words, plain — name the actual line/image>", ...1-3 items],
  "strength_pillars": ["<chord|craft|spark|echo>", ...same length and order as strengths],
  "weaknesses": ["<6-12 words, plain and specific>", ...1-3 items],
  "pillar_spread": {
    "highest": "<chord|craft|spark|echo>",
    "lowest": "<chord|craft|spark|echo>",
    "divergence_reason": "<≤12 words explaining why these two pillars sit apart on THIS poem>"
  },
  "pillar_scores": {"chord": <int 0-25>, "craft": <int 0-25>, "spark": <int 0-25>, "echo": <int 0-25>},
  "overall_score": <int 1-100, MUST equal min(chord+craft+spark+echo, lowest×4+24)>,
  "strongest_line": {"line": <int>, "why": "<≤10 words>"},  // OMIT entirely if no single line clearly stands out (cumulative/prose/highly consistent poems), OR if your candidate ALSO has a flaw you'd otherwise flag (borderline → omit). Don't invent significance.
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
  "personal_feedback": "<2-3 short sentences addressed to 'you' — holistic read + one concrete next move, no preamble>"
}

issues[]: 0-3 items (see PILLAR SCORING DISCIPLINE above on when to return 0-1 or empty). Prefer single-line. problem_words ONLY when the issue is genuinely word-level (diction, cliché, dead verb); OMIT entirely for structural issues (rhythm, break, pacing). Omit rewrite when unused (no null, no empty). NO TASTE CALLS: if your objection is a stylistic preference the writer could reasonably reject (a low-confidence call), OMIT the entire issue. Only flag misses you'd defend on the page with specific evidence. NO DOUBLE-COUNTING: a line, phrase, or move cited in strengths[] CANNOT appear in issues[]. Before finalizing issues[], scan each candidate against strengths[] — if it's already praised there, OMIT it. If you genuinely see a move as both strong and flawed, the strength wins: drop the issue. You don't get to praise the same turn as witty AND flag it as incongruent.

PROFILE CALIBRATION FLOOR (load-bearing — this is the rule that makes matched_profile binding, not decorative): your pillar_scores AVERAGE must land within ±2 of the matched profile's example pillar average. The bands:
  A (weak) avg 7    → your average in [5, 9]
  B (uneven) avg 13.75 → your average in [11.75, 15.75]
  C (quiet) avg 17.25 → your average in [15.25, 19.25]
  D (canonical) avg 24  → your average in [22, 25]
  E (rough) avg 22.5  → your average in [20.5, 24.5]
  F (plainspoken) avg 23 → your average in [21, 25]
  G (workshop) avg 19.5  → your average in [17.5, 21.5]
If your pillars cluster BELOW the band: either (a) re-match to a lower-fitting profile (e.g. a default-flat 14-avg score on a sermonic poem means you should match A, not G), or (b) name the specific deviation in pillar_spread.divergence_reason. If your pillars cluster ABOVE the band: re-match upward. Default-flat scoring around 14-15 when you matched G/F means you treated the profile as a label, not as the calibration anchor — re-score.

pillar_spread: highest and lowest MUST be different pillars. divergence_reason justifies why these two sit apart on THIS poem (e.g. "sustained image system but flat opening" — not "pillars can diverge"). If you cannot name a real divergence reason, you are bucketing — re-read each pillar against its anchor before scoring.

STRENGTH-NAMING DISCIPLINE (read BEFORE writing strengths[]): distinguish DELIVERY from THESIS. A strength is a specific line, image, turn, or voice move that resists received language. A thesis ("we conform," "we erase ourselves to fit," "we crave reflection," "love hurts," "the system is rigged") presented in rhyme is NOT a strength — it is a widely-held diagnosis the reader could derive without the poem. Words like "honest voice," "urgent message," "moral center," "important paradox," "sharp moral point" describe TOPIC, not craft. If the candidate strength is the message rather than the move that delivers it, OMIT it. 1-3 items total; one real strength beats three theses.

strength_pillars: one entry per strength, same order. Map by what the strength actually proves: a strong opening / memorable phrasing → chord; voice control, line economy, sustained pattern → craft; a turn, sardonic move, inversion, fresh metaphor, sharp observation → spark; a resonant image or paradox that lingers → echo. FLOOR RULE (load-bearing — this is why strengths are written before pillar_scores): if exactly one strength maps to a pillar, that pillar's score MUST be ≥ 14 (the floor of solid band — naming one strength means the SOLID-BAND TEST is met). If 2+ strengths map to the same pillar, that pillar MUST be ≥ 16. These are floors, not ceilings; specific failures named in weaknesses can override, but the override must be explicit and named on the page — not a vibe.

strongest_line: pick a line that survives re-reads as the unambiguous standout. Borderline cases — notable but also flawed, or notable but not clearly above the rest — should OMIT the field. The field is for genuine standouts; a "pretty good" line is not a standout. Across slight context variations (title tweak, focus tweak), your strongest_line pick should not flip — if it would, omit instead.`;

function buildSystemPrompt(harshness?: string): string {
  const personaKey = harshness && harshness in HARSHNESS_PERSONAS ? harshness : "editor";
  const persona = HARSHNESS_PERSONAS[personaKey]!;
  // Persona comes LAST so the STATIC_RUBRIC prefix is identical
  // across every analyze request — OpenAI prompt cache can then hit on it.
  return `${STATIC_RUBRIC}\n\n=== PERSONA (tone only — does not change the rubric or score) ===\nFor this response, write feedback in the voice of: ${persona}.`;
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
  return `${titlePart}${numbered}${buildContextHints(lines, local, goals, writingFocus)}`;
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
  const model = typeof body.model === "string" ? body.model : "gpt-5-mini";
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

  // Server-side cache check — done BEFORE precheckSpend so cache hits don't
  // burn the per-IP cooldown. analyze runs at temperature 0, so identical
  // inputs return the same answer the model would generate.
  const cacheKey = analyzeCacheKey({
    title, lines, model, localAnalysis: local, goals, harshness, writingFocus,
  });
  const cachedRaw = await kvGetString(cacheKey);
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw) as CachedAnalyzeEntry;
      if (cached?.content && cached?.model) {
        sendParsedResponse(res, cached.content, cached.model);
        return;
      }
    } catch {
      // Corrupted entry — fall through and regenerate.
    }
  }

  // Cache miss — now check the spend/cooldown gate before paying for OpenAI.
  // The 120s cooldown intentionally spans all analyses from the same IP, so
  // it caps spend regardless of which poem is being analyzed. Cache hits skip
  // this gate entirely (cache check runs above).
  const spend = await precheckSpend({
    rawIp: req.headers["x-forwarded-for"],
    endpoint: "analyze",
    cooldownMs: cooldownFor("analyze", model),
  });
  if (!spend.ok) {
    if (spend.retryAfterSec) res.setHeader("Retry-After", String(spend.retryAfterSec));
    return res.status(spend.status).json(spend.body);
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

  // Streaming path — content bytes flow to the client as OpenAI emits them.
  // Body shape: <model JSON content>${STREAM_META_SEPARATOR}<meta JSON>
  // The client splits on the separator, parses each half, and reassembles the
  // same envelope shape sendParsedResponse would have built.
  let headersSent = false;
  const result = await streamOpenAI(
    apiKey,
    {
      model,
      messages: [
        { role: "system", content: buildSystemPrompt(harshness) },
        { role: "user", content: buildPrompt(title, lines, local, goals, writingFocus) },
      ],
      max_tokens: 4000,
      reasoningEffort: "low",
      timeoutMs: 30_000,
    },
    res,
    (delta) => {
      if (!headersSent) {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("X-Accel-Buffering", "no");
        res.status(200);
        headersSent = true;
      }
      res.write(delta);
    },
  );
  if (!result) {
    // Pre-stream errors already wrote a JSON error to res. Mid-stream failures
    // returned null after headers — close the connection so the client throws.
    if (headersSent) res.end();
    return;
  }

  await recordSpend(spend.ip, result.model, result.usage.promptTokens, result.usage.completionTokens);
  // Store the raw OpenAI content + resolved model so future identical inputs
  // can skip the call. Best-effort; failure here must not break the response.
  void kvSetStringPx(
    cacheKey,
    JSON.stringify({ content: result.content, model: result.model } satisfies CachedAnalyzeEntry),
    ANALYZE_CACHE_MS,
  ).catch(() => {});

  const meta: Record<string, unknown> = {
    model: result.model,
    analyzedAt: new Date().toISOString(),
  };
  res.write(STREAM_META_SEPARATOR + JSON.stringify(meta));
  res.end();
}
