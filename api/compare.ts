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
const COMPARE_CACHE_VERSION = "v14"; // bump when prompt structure changes

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

const BASE_SYSTEM_PROMPT = `You are an objective poetry editor re-scoring a revision. You receive a diff (previous → current), the previous score, and the current draft. Score the CURRENT version against the rubric below — not against the previous score.

=== SCORING RUBRIC (4 pillars × 25 points = 100) ===
These four pillars are INDEPENDENT — divergence is the point, not noise to smooth over.

1. Chord / Musicality (0-25) — first impression — the opening note and how lightly it carries the reader in. Memorable phrasing, rhythm that pulls. Independent of whether the poem lasts. SOLID-BAND TEST: opening pulls; the first 2-3 lines aren't received language; rhythm or phrasing makes you keep reading.
2. Craft / Technique (0-25) — control over the language. Word precision, line economy, purposeful line breaks, syntax in command, intentional rhythm. SOLID-BAND TEST: at least one deliberate move held proportionally to the poem's length (rhyme scheme, anaphora doing real work, sustained image system, deliberate stanza shape, syntactic control); execution mostly intentional, occasional weakness.
3. Spark / Edge (0-25) — distinctiveness OR insight. A turn you didn't expect, voice that won't borrow received language — OR precise observation, sharp argument, emotional accuracy that resists received language. Novelty alone is not quality. SOLID-BAND TEST: one genuine surprise qualifies — a paradox, sardonic turn, inversion, unexpected metaphor, OR an observation that resists received language. Does NOT require canonical-level transformation.
   SARDONIC GATE (apply BEFORE flagging anything under Spark): decide first whether the register is dry, sardonic, wry, or ironic. If yes, treat cliché, forced-feeling rhyme, flat diction, deadpan plainness, and sentimental-sounding closings as candidate Spark GAINS — the trite phrase or banged rhyme deployed knowingly IS the joke, credit it. Such moves also never count against Craft. Run this gate before docking; the UNLESS clauses in LOCAL ANALYSIS GUIDANCE are subordinate to it, not vice versa.
   SINCERE-DIRECTNESS GATE (parallel to SARDONIC): plain sincere diction can earn Spark and Echo through emotional accuracy when the speaker addresses a particular other or witnesses a specific moment (devotional, folk, lullaby, witness register). NOT sermonic: no "we should" generalization, no moral instruction, the feeling is anchored to the named situation, not asserted as universal. If these hold, "received language" reads as folk register, not Spark failure.
4. Echo / Effect (0-25) — what stays after reading. A line that loops, an image you can't unsee, subtext on re-read. Echo can come from a resonant observation or paradox even without images. SOLID-BAND TEST: at least one line, image, or paradox that surfaces on re-read; the poem leaves residue.

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
You MUST emit the matched letter in the matched_profile field, derived from your strengths section per MATCHING DISCIPLINE (see end of prompt). The match is the LAST commitment before scoring — strengths come first, then matched_profile follows from what those strengths actually named. Pick ONE letter; if strengths point at two profiles, pick the lower-tier one (a poem with one fresh move and one thesis matches B, not G). Anchor your pillar reads against the matched example.

EXAMPLE A — total 28 (weak):
  "My heart is broken into pieces / I cry every single night alone / The pain inside me will never heal / Love is just an empty word"
  pillar_scores: {chord: 6, craft: 8, spark: 5, echo: 9}

EXAMPLE B — total 55 (uneven — grabs ear, flat landing):
  "The streetlight buzzes — moths drum / against the milk-blue lamp. / Somewhere a refrigerator sighs. / Everything is fine."
  pillar_scores: {chord: 18, craft: 16, spark: 14, echo: 7}
  High chord, low echo. One weak pillar pulls the total down naturally.

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
- Compute overall_score by reading the current draft FRESH against the rubric. You are NOT given the previous overall_score for a reason — don't try to reconstruct it.
- ZERO PITY POINTS. Don't raise the score because the writer revised or engaged with feedback. Only raise it if the rubric mathematically yields more points.
- DO NOT manufacture issues to justify a score. If the current draft has no genuine misses, return 0-1 (empty issues[] is correct for a strong poem). Issues follow evidence, NOT the score.

=== SCORE CONTINUITY ACROSS REVISIONS ===
You will receive "Past issues" from the prior reading. These are CONTEXT, not new evidence:
- A weakness that was present in the prior draft AND is still present in the current draft is a CARRY-OVER. It was already weighted into the previous read. You may surface it in issues[] for the writer's attention, but a carry-over CANNOT push a pillar score below where the rubric would land it on a blind read. Two readings of substantially the same text should not produce divergent pillar scores just because the model is annoyed the writer didn't fix it.
- Score CHANGES from prior pillar reads should be driven by:
   • DROPS: new weakness introduced by the revision (a cliché added, syntax broken, image weakened, opening dulled) — evidence that did not exist before.
   • RISES: prior weakness fixed, or new strength added (sharper image, cleaner line break, sharper turn).
- Drift discipline: if the revision is small (a few words / one or two lines changed) and the rubric-blind read of the new draft would land in the same pillar band as the old draft, your pillar_scores should also land in that band. Do not re-roll a fresh harsh score because some carry-over issues are still visible.
- This is NOT "stays the same or drops" — it is "moves with the EVIDENCE of change", which often means stays the same when little changed.
- WEIGHT BY CONFIDENCE when scoring pillars. For each issue you're considering, rate your own certainty: HIGH (defensible against specific text) → let it move the relevant pillar fully. MEDIUM (probably real, but the writer could plausibly defend it as intentional — register choice, structural pivot, anaphora, capitalization) → it should move the pillar only modestly, 1-2 points at most. LOW (a taste call you wouldn't defend) → OMIT entirely (see NO TASTE CALLS). Three medium-confidence issues should NOT drop a pillar by 6 points. When in doubt about intent, lean MEDIUM.
- overall_score = sum of the four pillar scores. No cap. Each pillar is judged independently — don't lift a weak pillar to raise the total, and don't compress strong pillars because one is weak.
- USE THE FULL 1-100 SCALE: weak 0-49 (even on revision), competent-but-imperfect 50-85 (don't skip — see Example G), canonical 85-99, masterworks 92-99.

=== STYLE ===
Plain English, like a smart friend talking. Common terms fine; skip scholarly jargon. Applies to every feedback string.

=== LOCAL ANALYSIS GUIDANCE (soft, not hard) ===
- Detected clichés normally lower Spark — UNLESS used ironically, subverted, or framing an observation/insight that resists received language.
- Broken syllable targets normally lower Craft — UNLESS the breakage is deliberate rhythmic disruption.
- Heavy repetition normally lowers Craft or Spark — UNLESS doing visible work (refrain, incantation).
- Plain diction, dragging rhythm, and worn metaphor normally lower Craft — UNLESS the voice register stays consistently weary, deadpan, or sardonic across the poem (tone-controlled plainness is craft, not its absence).
- Rhyme presence or scheme pattern is NOT itself the discriminator. A locked scheme isn't automatically more crafted; loose or absent rhyme isn't automatically less. Score on whether the rhyme is doing work (sound mirrors meaning, pivots a turn, locks a refrain) or just filling syllables. Two drafts of the same poem with different rhyme schemes in the same register should not differ in Craft by more than 2-3 points.
Principle: penalize accidental craft failures, NOT purposeful rule-breaking.

=== ISSUE RATIONALE STYLE — match this pattern exactly ===
Each rationale = exactly 3 short concrete sentences. Compare:

GOOD: "The phrase 'gentle breeze' is the dictionary entry for breeze. It collapses what could be a tactile sensation into received language. A specific weather verb — needling, slack, brackish — would carry actual weight."

BAD: "This line could be stronger. The image is okay but generic. Consider revising for more specificity."

GOOD names the exact problem, says why it weakens THIS line, gestures at a sharper move. BAD is generic. Write GOOD. No moralizing, no pillar lectures — just the concrete miss.

=== RESPONSE SHAPE — return ONLY this JSON ===
Emit fields in this EXACT order. PERCEPTION COMES BEFORE PROFILE-MATCHING BEFORE SCORING: warm_reaction, strengths, strength_pillars, and weaknesses commit your reading of specific moves FIRST. matched_profile is then DERIVED from what your strengths actually named (see MATCHING DISCIPLINE below) — never pre-decided from poem topic or voice. Only after profile is locked do you write pillar_spread and pillar_scores. Scores are derived from perception + profile, never the other way around. Then derive overall_score arithmetically.
{
  "warm_reaction": "<≤14 words, terse>",
  "strengths": ["<6-12 words, plain — name the actual line/image>", ...1-3 items],
  "strength_pillars": ["<chord|craft|spark|echo>", ...same length and order as strengths],
  "weaknesses": ["<6-12 words, plain>", ...1-3 items],
  "matched_profile": "<A|B|C|D|E|F|G — single letter, derived from strengths per MATCHING DISCIPLINE>",
  "pillar_spread": {
    "highest": "<chord|craft|spark|echo>",
    "lowest": "<chord|craft|spark|echo>",
    "divergence_reason": "<≤12 words explaining why these two pillars sit apart on THIS poem>"
  },
  "pillar_scores": {"chord": <int 0-25>, "craft": <int 0-25>, "spark": <int 0-25>, "echo": <int 0-25>},
  "overall_score": <int 1-100 for CURRENT, MUST equal chord+craft+spark+echo (no cap — pure sum)>,
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
  "comparison": {
    "improvements": ["<≤6 words>", ...0-3 items],
    "regressions": ["<≤6 words>", ...0-3 items],
    "unchanged": ["<≤6 words>", ...0-3 items]
  },
  "personal_feedback": "<2-3 sentences addressed to 'you' — holistic read of CURRENT + the revision arc + one concrete next move, no preamble>"
}

issues[]: 0-3 items (see RE-SCORING RULES above on when to return 0-1 or empty). Prefer single-line. problem_words ONLY when the issue is genuinely word-level (diction, cliché, dead verb); OMIT entirely for structural issues (rhythm, break, pacing). Omit rewrite when unused (no null, no empty). NO TASTE CALLS: if your objection is a stylistic preference the writer could reasonably reject (a low-confidence call), OMIT the entire issue. Only flag misses you'd defend on the page with specific evidence. NO DOUBLE-COUNTING: a line, phrase, or move cited in strengths[] CANNOT appear in issues[]. Before finalizing issues[], scan each candidate against strengths[] — if it's already praised there, OMIT it. If you genuinely see a move as both strong and flawed, the strength wins: drop the issue.

MATCHING DISCIPLINE (read AFTER writing strengths, BEFORE matched_profile — this is why matched_profile now appears AFTER strengths in the JSON): choose matched_profile by what your strengths section actually NAMED, not by the poem's apparent ambition, urgency, or voice. Each profile requires SPECIFIC EVIDENCE in strengths:
  - D (canonical) — requires 2+ strengths naming master-level moves (canonical imagery, meter with semantic purpose).
  - F (plainspoken insight) — requires a strength naming a PLAINSPOKEN INSIGHT (paradox, observation, or emotional accuracy that does the work bare diction couldn't do alone). Not just "plain voice"; the insight has to be named.
  - E (purposeful roughness) — requires a strength naming a deliberately broken move (syntax that mirrors content, looseness as craft).
  - G (workshop-competent) — requires 1+ strength naming a SPECIFIC FRESH MOVE (concrete image, sustained metaphor, sardonic turn, sharp observation that resists received language).
  - C (quiet-but-lasting) — requires a quiet-move strength AND a residue/echo strength.
  - B (high chord, low echo) — requires a strong-opening strength but no lingering-move strength.
  - A (weak-across) — match A when your strengths section is sparse, vague, or dominated by THESES per STRENGTH-NAMING DISCIPLINE (e.g. "honest voice," "moral center," "urgent message," "important paradox" applied to argument-statements). Sermonic register at the strength level IS the A profile, regardless of how earnest or rhymed the poem feels. This is load-bearing — most over-matches happen here.
If a profile's gate fails (you matched G but your strengths can't satisfy G's gate above), the match is WRONG — DEMOTE to the next-lower-tier profile (G→B, F→C, E→B, B/C→A). Never match upward to a profile whose evidence you cannot point at in strengths.

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
    previousIssues, model, localAnalysis: local, goals, writingFocus,
  });
  const cachedRaw = await kvGetString(cacheKey);
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw) as CachedCompareEntry;
      if (cached?.content && cached?.model) {
        sendParsedResponse(res, cached.content, cached.model);
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
  // INTENTIONALLY do NOT include the prior overall_score in the prompt — it
  // acts as an anchor in either direction even when labelled "reference only",
  // and the comparison{} block describes change qualitatively without it.
  void prevScores;
  let prevFlagged = "";
  if (previousWeaknesses.length > 0 || previousIssues.length > 0) {
    const sections: string[] = ["Context from the prior reading (already priced into past pillar scores — surface in comparison{} but treat as CARRY-OVER per SCORE CONTINUITY rules, not as fresh evidence that drops pillar scores):"];
    if (previousWeaknesses.length > 0) {
      sections.push(`Past weaknesses: ${previousWeaknesses.map((w) => `"${w}"`).join("; ")}`);
    }
    if (previousIssues.length > 0) {
      sections.push("Past issues:");
      for (const iss of previousIssues) {
        const range = iss.line_start === iss.line_end ? `L${iss.line_start}` : `L${iss.line_start}–${iss.line_end}`;
        sections.push(`  - ${range}: ${iss.headline || "(no headline)"}`);
      }
    }
    sections.push("If addressed → list under comparison.improvements. If still present → optionally raise in issues[] for the writer's attention, but as a carry-over (does NOT lower pillar scores below where a blind rubric read would land them). If a past issue was a borderline taste call, omit it now — don't re-flag low-confidence misses across revisions.");
    prevFlagged = "\n" + sections.join("\n") + "\n";
  }
  const contextBlock = buildContextHints(lines, local, goals, writingFocus);

  // Order matters: poem FIRST so scoring happens against the rubric, then the
  // comparison context.
  const comparisonContext = prevFlagged
    ? `\n\n=== Comparison context (for the comparison{} block in your response ONLY — pillar_scores and overall_score MUST come from a blind rubric read of the current draft, not from this context) ===${prevFlagged}`
    : "";

  const userMessage = `${titlePart}=== CURRENT VERSION (score this FRESH against the rubric, as if you'd never seen the previous draft) ===\n${numbered(lines)}${contextBlock}\n\n=== CHANGES from previous draft (line numbers refer to the CURRENT draft above) ===\n${changesText}${comparisonContext}`;

  const result = await callOpenAI(
    apiKey,
    {
      model,
      messages: [
        { role: "system", content: BASE_SYSTEM_PROMPT },
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
  sendParsedResponse(res, result.content, result.model);
}
