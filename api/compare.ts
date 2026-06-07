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
const COMPARE_CACHE_VERSION = "v20"; // bump when prompt structure changes

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
  previousMatchedProfile: string | null;
  previousPillarScores: { chord: number; craft: number; spark: number; echo: number } | null;
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

const BASE_SYSTEM_PROMPT = `You are an objective poetry editor re-scoring a revision. You receive a diff, the previous overall score, and the current draft. Score the CURRENT version against the rubric below.

=== SCORING RUBRIC (4 pillars × 25 points = 100) ===
These four pillars are INDEPENDENT — divergence is the point, not noise to smooth over.

1. Chord / Musicality (0-25) — first impression — opening note, memorable phrasing, rhythm that pulls. Independent of whether the poem lasts. SOLID-BAND TEST: opening pulls; first 2-3 lines aren't received language; rhythm/phrasing makes you keep reading.
2. Craft / Technique (0-25) — control over the language. Word precision, line economy, purposeful line breaks, syntax in command, intentional rhythm. SOLID-BAND TEST: at least one deliberate move held proportionally to the poem's length (rhyme scheme, anaphora doing real work, sustained image system, syntactic control); execution mostly intentional.
3. Spark / Edge (0-25) — distinctiveness OR insight. A turn you didn't expect, voice that won't borrow received language — OR precise observation, sharp argument, emotional accuracy. Novelty alone is not quality. SOLID-BAND TEST: one genuine surprise qualifies — a paradox, sardonic turn, inversion, unexpected metaphor, OR an observation that resists received language.
   SARDONIC GATE (apply BEFORE flagging anything under Spark): if the register is dry, sardonic, wry, or ironic: (a) cliché, forced rhyme, flat diction, deadpan plainness, sentimental-sounding closings are candidate Spark GAINS — the trite phrase deployed knowingly IS the joke; (b) MOCK-UNIVERSAL CLAIMS used dryly ("fat with money — can't be bad", "turns people mean") count as Spark GAINS — sardonic poems USE fake-aphorism, so the SINCERE-DIRECTNESS universal-claim disqualifier is SUSPENDED. These moves never count against Craft.
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
- Judge density, not length. A short poem may hit max scores by doing more per word. "Sustained across the poem" applies proportionally.
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

EXAMPLE E — total 90 (Bukowski-style, purposeful roughness — looseness scores HIGH Craft when brokenness is the point):
  "there's a bluebird in my heart that / wants to get out / but I'm too tough for him, / I say, stay in there, I'm not going / to let anybody see you."
  pillar_scores: {chord: 22, craft: 21, spark: 24, echo: 23}

EXAMPLE F — total 92 (quiet plainspoken — insight/emotional precision reach top of scale without imagery; bare diction IS the craft):
  "I sat beside my mother's bed / and listened to the machines / pretend they knew / what living meant."
  pillar_scores: {chord: 22, craft: 23, spark: 22, echo: 25}

EXAMPLE G — total 78 (workshop-competent — most revised drafts land HERE, not lower; clear voice, specific observation, one quiet resonance):
  "At forty I keep finding / my mother's handwriting / in the margins of my own — / the way I cross my sevens, / the way I close my parentheses."
  pillar_scores: {chord: 18, craft: 19, spark: 19, echo: 22}

=== RE-SCORING RULES ===
You receive the previous overall_score. It is an ANCHOR — the new score moves from there, driven by EVIDENCE of change in the diff. It is NOT a fresh-read target.

- CARRY-OVERS: a weakness present in BOTH drafts was already priced into the prior score. Surface it in issues[] if you want, but it CANNOT push a pillar lower than the prior pillar score. Two readings of substantially the same text must not diverge just because the model is annoyed the writer didn't fix it.
- DOWNWARD MOVES: only NEW evidence in the revision drops a pillar (cliché added, syntax broken, image weakened, opening dulled).
- UPWARD MOVES — CONSERVATIVE BY DEFAULT: a revision rarely earns more than 3-5 points overall. A single sharper image or cleaner line break is a small move (+1-2 on one pillar), not a sweeping rise. Award larger jumps (6+) ONLY when the revision added a substantively new strength the prior draft lacked: a new structural move (anaphora that wasn't there, refrain locked, image-system extended), a new turn/insight, OR a profile change justified by structural shape change. "The writer fixed some carry-overs" is NOT enough to bump the score — the prior score already assumed those weren't fixed; fixing them returns you to baseline, not above it.
- ZERO PITY POINTS. Effort doesn't move the score; only the rubric does.
- SMALL REVISION → SMALL CHANGE: a few words or one line changed → expect the new score within ~3 points of the prior, unless that change was substantively load-bearing.
- DO NOT manufacture issues to justify a score; issues follow evidence, not vice versa. Empty issues[] is correct for strong drafts.

=== SCORE ↔ COMPARISON CONSISTENCY (hard rule) ===
The comparison{} block and the score MUST agree. Build comparison{} from concrete evidence first, then pillar_scores reflect that direction:
- improvements > regressions → net direction UP. At least one pillar rises; no pillar falls unless a regression specifically explains it.
- regressions > improvements → net direction DOWN.
- equal or both empty → score holds within ~3 points of prior overall.
- Each comparison item must be pillar-attributable ("sharper closing" → Echo+, "added cliché" → Spark−). If it isn't, omit it.
- Don't ship a contradiction. If "Revision lifted the poem" appears alongside a -4 score, the read is broken; reconcile comparison{} or pillar_scores before returning.

=== PROFILE LOCK ===
The calibration profiles A-G are the biggest source of jumpy scores across Refines (a C→G swap = 20+ points). If a prior matched_profile is given, INHERIT it unless the revision changed structural SHAPE (length, form, register, image-system). Line edits and word swaps don't justify a profile swap. If you do swap, name the structural change in pillar_spread.divergence_reason.

- WEIGHT BY CONFIDENCE when scoring pillars: HIGH (defensible against specific text) → move pillar fully. MEDIUM (writer could plausibly defend as intentional) → move 1-2 pts max. LOW (a taste call) → OMIT the issue. Three medium-confidence issues should NOT drop a pillar by 6 points.
- overall_score = sum of pillar scores. No cap.
- USE THE FULL 1-100 SCALE: weak 0-49, competent 50-85 (don't skip — see Example G), canonical 85-99.

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
    previousMatchedProfile?: unknown;
    previousPillarScores?: unknown;
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

  const previousMatchedProfile = typeof body.previousMatchedProfile === "string"
    && /^[A-G]$/.test(body.previousMatchedProfile.trim())
      ? body.previousMatchedProfile.trim()
      : null;

  const previousPillarScores = (() => {
    const v = body.previousPillarScores;
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    const pick = (k: string): number | null => {
      const n = typeof o[k] === "number" ? (o[k] as number) : parseInt(String(o[k]), 10);
      if (!Number.isFinite(n)) return null;
      return Math.max(0, Math.min(25, Math.round(n)));
    };
    const chord = pick("chord"); const craft = pick("craft");
    const spark = pick("spark"); const echo = pick("echo");
    if (chord === null || craft === null || spark === null || echo === null) return null;
    return { chord, craft, spark, echo };
  })();

  // Cache check — done BEFORE precheckSpend and OpenAI so cache hits don't
  // burn the per-IP cooldown. compare runs at temperature 0, so identical
  // inputs return the same answer the model would generate.
  const cacheKey = compareCacheKey({
    title, lines, changesText, previousScores: prevScores, previousWeaknesses,
    previousIssues, model, localAnalysis: local, goals, writingFocus,
    previousMatchedProfile, previousPillarScores,
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

  // Prior anchors. The prior overall_score is the ANCHOR the new read moves
  // from; the prior matched_profile and pillar_scores prevent the two biggest
  // sources of score jumpiness (profile swaps and per-pillar re-rolls).
  let priorAnchor = "";
  const priorOverall = prevScores && typeof prevScores === "object"
    && typeof (prevScores as { overall_score?: unknown }).overall_score === "number"
      ? (prevScores as { overall_score: number }).overall_score
      : null;
  if (priorOverall !== null) {
    priorAnchor += `\nPrior overall_score: ${priorOverall}. New score moves FROM here, driven by NEW evidence in the diff (see RE-SCORING RULES — small revision → ≤3 pts; sharper move → 1-2 pts on one pillar; substantively new strength → up to 5-6 pts; profile change → potentially larger, only if structural shape changed).`;
  }
  if (previousMatchedProfile) {
    priorAnchor += `\nPrior matched_profile: ${previousMatchedProfile}. INHERIT unless structural SHAPE changed (length/form/register/image-system) — word swaps don't justify a swap.`;
  }
  if (previousPillarScores) {
    const p = previousPillarScores;
    priorAnchor += `\nPrior pillar_scores: {chord: ${p.chord}, craft: ${p.craft}, spark: ${p.spark}, echo: ${p.echo}}. Per-pillar continuity: each new pillar score moves only by EVIDENCE of change for that pillar in the diff. If nothing changed for a pillar, it stays.`;
  }

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
  const comparisonContext = prevFlagged || priorAnchor
    ? `\n\n=== Comparison context (pillar_scores follow the RE-SCORING RULES in the system prompt — anchored to the prior read, moved by new evidence in the diff) ===${priorAnchor}${prevFlagged}`
    : "";

  const userMessage = `${titlePart}=== CURRENT VERSION ===\n${numbered(lines)}${contextBlock}\n\n=== CHANGES from previous draft (line numbers refer to the CURRENT draft above) ===\n${changesText}${comparisonContext}`;

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
      reasoningEffort: "medium",
      timeoutMs: 90_000,
      // Medium reasoning is slow; a stuck call rarely turns fast on retry, and
      // 2 retries × 90s = a 4.5-minute user wait. Single retry only.
      retries: 1,
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
