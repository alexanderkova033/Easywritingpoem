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
const ANALYZE_CACHE_VERSION = "v30"; // bump when prompt structure changes

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

1. Chord / Musicality (0-25) — first impression — opening note, memorable phrasing, rhythm that pulls. Independent of whether the poem lasts. SOLID-BAND TEST: opening pulls; first 2-3 lines aren't received language; rhythm/phrasing makes you keep reading.
2. Craft / Technique (0-25) — control over the language. Word precision, line economy, purposeful line breaks, syntax in command, accurate punctuation, intentional rhythm. SOLID-BAND TEST: at least one deliberate move held proportionally to the poem's length (rhyme scheme, anaphora doing real work, sustained image system, syntactic control); execution mostly intentional.
3. Spark / Edge (0-25) — distinctiveness OR insight. A turn you didn't expect, voice that won't borrow received language — OR precise observation, sharp argument, emotional accuracy. Novelty alone is not quality. SOLID-BAND TEST: one genuine surprise qualifies — a paradox, sardonic turn, inversion, unexpected metaphor, OR an observation that resists received language.
   SARDONIC GATE (apply BEFORE flagging under Spark): if the register is dry, sardonic, wry, or ironic: (a) cliché, forced rhyme, flat diction, deadpan plainness, sentimental-sounding closings are candidate Spark GAINS — the trite phrase deployed knowingly IS the joke; (b) MOCK-UNIVERSAL CLAIMS used dryly ("fat with money — can't be bad", "turns people mean") count as Spark GAINS — sardonic poems USE fake-aphorism, so the SINCERE-DIRECTNESS universal-claim disqualifier is SUSPENDED. These moves never count against Craft.
   SINCERE-DIRECTNESS GATE: DISQUALIFIED if the poem asserts a UNIVERSAL CLAIM about how people in general live, conform, crave, or behave — that is sermonic. Collective pronouns ("we", "us") are fine for a specific named pair, family, or witnessed group; the disqualifier is universality, not the pronoun. Fires when the speaker addresses a PARTICULAR OTHER or witnesses a SPECIFIC MOMENT. When it fires, plain sincere diction earns Spark and Echo through emotional accuracy (devotional, folk, lullaby, witness register).
4. Echo / Effect (0-25) — what stays after reading. A line that loops, an image you can't unsee, subtext on re-read. SOLID-BAND TEST: at least one line, image, or paradox that surfaces on re-read.

=== PER-PILLAR ANCHORS (0-25 scale) ===
0-6    barely there — clichéd, broken, or absent on this dimension.
7-12   present but weak — pattern attempted then dropped; structural choice doesn't carry.
13-18  solid — meets the pillar's SOLID-BAND TEST above; voice consistent; execution mostly intentional.
19-22  strong — distinctive, controlled; the deliberate move is working hard across multiple lines.
23-25  canonical — published masters routinely sit here on their strongest pillar.

=== PILLAR SCORING DISCIPLINE ===
- Cite specific evidence on the page (a line, image, structural move) for each pillar score. If you can't, you're defaulting — re-read.
- DIVERGENCE: if 3+ pillars land within 2 points of each other in the same band, you're bucketing. Reconsider each independently.
- Judge density, not length. A short poem may hit max scores by doing more per word. "Sustained" applies proportionally.
- Issues follow evidence on the page, NOT the score. Strong drafts can return 0-1 issues. Never manufacture issues to justify a number.
- WEIGHT BY CONFIDENCE when scoring pillars: HIGH (defensible against specific text) → move pillar fully. MEDIUM (writer could plausibly defend as intentional — register choice, structural pivot, anaphora) → move 1-2 pts max. LOW (a taste call) → OMIT the issue. Three medium-confidence issues should NOT drop a pillar by 6 points.
- Title and writing focus are CONTEXT, not scoring inputs.

=== CALIBRATION EXAMPLES — match before scoring ===
Pillars DIVERGE — mirror this spread. BEFORE producing pillar_scores, match the poem to one of the examples below by structural PROFILE (not topic):
  A = weak-across (clichéd)
  B = high chord, low echo (grabs but doesn't last)
  C = low chord, high echo (quiet but lasting)
  D = canonical breadth (sonnet-grade)
  E = purposeful roughness (looseness as craft)
  F = plainspoken insight / paradox without imagery
  G = workshop-competent voice (real observation, sustained metaphor or extended structure, not canonical)
You MUST emit the matched letter in the matched_profile field, derived from your strengths section per MATCHING DISCIPLINE (see end of prompt). The match is the LAST commitment before scoring — strengths come first, then matched_profile follows from what those strengths actually named. Pick ONE letter; if strengths point at two profiles, pick the lower-tier one (a poem with one fresh move and one thesis matches B, not G). Anchor your pillar reads against the matched example.

EXAMPLE A — total 28 (weak):
  "My heart is broken into pieces / I cry every single night alone / The pain inside me will never heal / Love is just an empty word"
  pillar_scores: {chord: 6, craft: 8, spark: 5, echo: 9}

EXAMPLE B — total 55 (uneven — grabs ear, flat landing):
  "The streetlight buzzes — moths drum / against the milk-blue lamp. / Somewhere a refrigerator sighs. / Everything is fine."
  pillar_scores: {chord: 18, craft: 16, spark: 14, echo: 7}

EXAMPLE C — total 69 (quiet but lasting):
  "The afternoon light goes thin / against the kitchen window — / yellow as a paperback's spine / kept on the radiator too long."
  pillar_scores: {chord: 12, craft: 21, spark: 17, echo: 19}

EXAMPLE D — total 96 (canonical sonnet, top of scale):
  "Shall I compare thee to a summer's day? / Thou art more lovely and more temperate: / Rough winds do shake the darling buds of May, / And summer's lease hath all too short a date."
  pillar_scores: {chord: 24, craft: 25, spark: 23, echo: 24}

EXAMPLE E — total 90 (Bukowski-style — looseness scores HIGH Craft when brokenness is the point):
  "there's a bluebird in my heart that / wants to get out / but I'm too tough for him, / I say, stay in there, I'm not going / to let anybody see you."
  pillar_scores: {chord: 22, craft: 21, spark: 24, echo: 23}

EXAMPLE F — total 92 (plainspoken insight — bare diction IS the craft; reaches top of scale without imagery):
  "I sat beside my mother's bed / and listened to the machines / pretend they knew / what living meant."
  pillar_scores: {chord: 22, craft: 23, spark: 22, echo: 25}

EXAMPLE G — total 78 (workshop-competent — most revised drafts land HERE, not lower; clear voice, specific observation, one quiet resonance):
  "At forty I keep finding / my mother's handwriting / in the margins of my own — / the way I cross my sevens, / the way I close my parentheses."
  pillar_scores: {chord: 18, craft: 19, spark: 19, echo: 22}

=== OVERALL SCORE ===
- overall_score = sum of the four pillar scores. No cap. Pillars are judged independently — don't lift weak or compress strong to even them.
- USE THE FULL 1-100 SCALE: weak 0-49, competent 50-85 (don't skip — see Example G), canonical 85-99.

=== STYLE ===
Plain English, like a smart friend talking. Skip scholarly jargon.

=== LOCAL ANALYSIS GUIDANCE (soft signals) ===
- Detected clichés normally lower Spark — UNLESS used ironically or framing an observation that resists received language.
- Broken syllable targets normally lower Craft — UNLESS the breakage is deliberate rhythmic disruption.
- Heavy repetition normally lowers Craft or Spark — UNLESS doing visible work (refrain, incantation).
- Plain diction / dragging rhythm normally lower Craft — UNLESS the register stays consistently weary, deadpan, or sardonic across the poem.
- Rhyme presence/scheme is NOT itself the discriminator — score whether rhyme does work (sound mirrors meaning, pivots a turn) or just fills syllables. Same poem with different schemes in the same register should not differ in Craft by more than 2-3 points.
Principle: penalize accidental failures, NOT purposeful rule-breaking.

=== ISSUE RATIONALE STYLE — match this pattern exactly ===
Each rationale = exactly 3 short concrete sentences. Compare:

GOOD: "The phrase 'gentle breeze' is the dictionary entry for breeze. It collapses what could be a tactile sensation into received language. A specific weather verb — needling, slack, brackish — would carry actual weight."

BAD: "This line could be stronger. The image is okay but generic. Consider revising for more specificity."

GOOD names the exact problem, says why it weakens THIS line, gestures at a sharper move. BAD is generic. Write GOOD. No moralizing, no pillar lectures — just the concrete miss.

=== RESPONSE SHAPE — return ONLY this JSON ===
Emit fields in this EXACT order. PERCEPTION COMES BEFORE PROFILE-MATCHING BEFORE SCORING: warm_reaction, strengths, strength_pillars, and weaknesses commit your reading of specific moves FIRST. matched_profile is then DERIVED from what your strengths actually named (see MATCHING DISCIPLINE below) — never pre-decided from poem topic or voice. Only after profile is locked do you write pillar_spread and pillar_scores. Scores are derived from perception + profile, never the other way around. Then derive overall_score arithmetically.
{
  "warm_reaction": "<≤14 words>",
  "strengths": ["<6-12 words, plain — name the actual line/image>", ...1-3 items],
  "strength_pillars": ["<chord|craft|spark|echo>", ...same length and order as strengths],
  "weaknesses": ["<6-12 words, plain and specific>", ...1-3 items],
  "matched_profile": "<A|B|C|D|E|F|G — single letter, derived from strengths per MATCHING DISCIPLINE>",
  "pillar_spread": {
    "highest": "<chord|craft|spark|echo>",
    "lowest": "<chord|craft|spark|echo>",
    "divergence_reason": "<≤12 words explaining why these two pillars sit apart on THIS poem>"
  },
  "pillar_scores": {"chord": <int 0-25>, "craft": <int 0-25>, "spark": <int 0-25>, "echo": <int 0-25>},
  "overall_score": <int 1-100, MUST equal chord+craft+spark+echo (no cap — pure sum)>,
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

issues[]: 0-3 items. Prefer single-line. problem_words ONLY when word-level (diction, cliché, dead verb); OMIT for structural issues. Omit rewrite when unused. NO TASTE CALLS: omit low-confidence stylistic preferences. NO DOUBLE-COUNTING: anything cited in strengths[] cannot appear in issues[]; the strength wins.

STRENGTH-NAMING DISCIPLINE (read BEFORE strengths[]): a strength is a specific line, image, turn, or voice move that resists received language. A thesis presented in rhyme ("we conform," "we erase ourselves," "love hurts") is NOT a strength — it's a widely-held diagnosis. This applies to QUOTED LINES too: "we erase ourselves" stays a diagnosis even when quoted; "the kitchen light went out" passes. Words like "honest voice," "urgent message," "moral center" describe topic, not craft — OMIT. 1-3 items; one real strength beats three theses.

MATCHING DISCIPLINE (read AFTER strengths, BEFORE matched_profile): choose matched_profile by what strengths actually NAMED, not by ambition or voice. Each profile requires specific evidence in strengths:
  - D (canonical) — 2+ strengths naming master-level moves (canonical imagery, meter with semantic purpose).
  - F (plainspoken insight) — a strength naming a plainspoken INSIGHT (paradox, observation, emotional accuracy). Not just "plain voice".
  - E (purposeful roughness) — a strength naming a deliberately broken move (syntax mirrors content).
  - G (workshop-competent) — 1+ strength naming a SPECIFIC FRESH MOVE (concrete image, sustained metaphor, sardonic turn, sharp observation).
  - C (quiet-but-lasting) — a quiet-move strength AND a residue/echo strength.
  - B (high chord, low echo) — a strong-opening strength but no lingering move.
  - A (weak-across) — strengths sparse, vague, or dominated by theses. MECHANICAL CHECK: if 2+ strengths are quoted lines that are themselves theses about how people in general live ("we erase ourselves," "killing our souls"), matched_profile MUST be A — no exceptions. SARDONIC GATE does NOT trigger this check (mock-universal claims as the joke are fine). Sermonic register at the strength level IS A.
If a profile's gate fails, DEMOTE: G→B, F→C, E→B, B/C→A. Never match upward to a profile you can't point at evidence for.

PROFILE CALIBRATION FLOOR (binds matched_profile to scores): pillar_scores AVERAGE must land within ±2 of the matched profile's average:
  A avg 7 → [5, 9]   B avg 13.75 → [11.75, 15.75]   C avg 17.25 → [15.25, 19.25]
  D avg 24 → [22, 25]   E avg 22.5 → [20.5, 24.5]   F avg 23 → [21, 25]   G avg 19.5 → [17.5, 21.5]
If your pillars cluster BELOW the band, re-match downward. If ABOVE, re-match upward. Default-flat 14-15 scoring when you matched G/F means you treated the profile as a label — re-score.

pillar_spread: highest and lowest MUST be different pillars. divergence_reason names a real reason (e.g. "sustained image system but flat opening"), not "pillars can diverge".

strength_pillars: map each strength by what it proves — strong opening / memorable phrasing → chord; voice control, line economy, sustained pattern → craft; turn / sardonic move / fresh metaphor / sharp observation → spark; resonant image or paradox that lingers → echo. FLOOR RULE: 1 strength on a pillar → that pillar ≥ 14. 2+ strengths on a pillar → that pillar ≥ 16. Failures named in weaknesses can override, but must be explicit on the page.

strongest_line: only for unambiguous standouts. Borderline (notable but flawed) → OMIT. Should not flip across slight context variations.`;

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
      reasoningEffort: "medium",
      timeoutMs: 90_000,
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
