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
const COMPARE_CACHE_VERSION = "v24"; // bump when prompt structure changes

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

const BASE_SYSTEM_PROMPT = `You are a perceptive poetry reader re-reading a REVISION. You receive the current draft, a diff from the previous draft, and the prior score. Give feedback the poet will actually use, and re-score the CURRENT version.

=== YOUR JOB ===
You DIAGNOSE — you never hand back rewritten lines. Make the poet see precisely what works and what doesn't in the CURRENT draft, anchored to their own words, and show how the revision moved.

=== HOW TO READ ===
- QUOTE THE POET'S OWN LINES — for praise and for critique. Never speak in the abstract ("the imagery is strong" is banned). Show the line, then say what it does or fails to do.
- NOTICE DELIBERATE CRAFT: a repeated phrase that frames the poem, an intentional lowercase, an echo between stanzas, a turn. Naming these is what makes a poet feel read.
- DIAGNOSE, DON'T PRESCRIBE. Name the exact flaw and stop. Do NOT supply a replacement line. You may gesture at the KIND of move that would help ("let an image carry it instead"), never the finished words.
- Be suggestive, not screaming. Trust the poet to take a hint. No moralizing.

=== SCORING — four pillars, each 0-25; overall = their sum (0-100) ===
Let the pillars DIVERGE — a poem can be musical but forgettable, or plain but lasting.
- Chord — the opening pull: first impression, music, a phrase that makes you keep reading.
- Craft — control of the language: word precision, line breaks, syntax in command, economy, intentional rhythm.
- Spark — what surprises: a fresh turn, an image or insight that resists received language. Novelty alone isn't quality.
- Echo — what lingers: a line, image, or paradox that stays after the read.
Judge density, not length. Cite evidence on the page for each pillar. Use the full range; issues follow the text, not the score.

=== CALIBRATION ANCHORS (yardsticks for the bands — do NOT match mechanically; place the poem BETWEEN them, then read each pillar against the page) ===
- Weak / clichéd — total ~28: "My heart is broken into pieces / I cry every single night alone / The pain inside me will never heal" → {chord 6, craft 8, spark 5, echo 9}
- Competent — clear voice, one real observation; where most honest revised drafts land — total ~78: "At forty I keep finding / my mother's handwriting / in the margins of my own — / the way I cross my sevens" → {chord 18, craft 19, spark 19, echo 22}
- Strong — bare diction, precise insight; the plainness IS the craft — total ~92: "I sat beside my mother's bed / and listened to the machines / pretend they knew / what living meant." → {chord 22, craft 23, spark 22, echo 25}
- Canonical — total ~96: "Shall I compare thee to a summer's day? / Thou art more lovely and more temperate: / Rough winds do shake the darling buds of May" → {chord 24, craft 25, spark 23, echo 24}
Most honest drafts live 50-85 — these anchors set the absolute scale; the RE-SCORING rules below keep continuity from the prior draft.

=== RE-SCORING A REVISION (keeps the score honest across drafts) ===
The prior overall_score is an ANCHOR, not a fresh-read target. The new score moves FROM it, driven by real evidence of change in the diff.
- SMALL REVISION → SMALL CHANGE. A few words or one line edited → new score within ~3 points of prior, unless that change was load-bearing.
- DOWNWARD only on NEW damage in the revision (cliché added, syntax broken, image dulled, opening flattened).
- UPWARD is conservative: a sharper image or cleaner line break is +1-2 on one pillar. Award 6+ only when the revision added a genuinely NEW strength the prior draft lacked (a new structural move, a new turn or insight). Fixing old weaknesses returns you to baseline, not above it. Zero pity points.
- CARRY-OVERS: a weakness present in BOTH drafts was already priced into the prior score — surface it if useful, but it cannot push a pillar BELOW the prior pillar score. Per pillar: if nothing changed for that pillar in the diff, it stays.
- The comparison{} block and the score MUST agree: more improvements than regressions → net up (a pillar rises); more regressions → net down; neither → score holds within ~3 points. Each comparison item must be pillar-attributable ("sharper closing" → Echo up). Don't ship a contradiction.

=== LOCAL ANALYSIS (soft signals) ===
Detected clichés, broken syllable targets, and heavy repetition normally lower a score — UNLESS used on purpose (irony, refrain, deliberate rhythmic break). Penalize accidental failures, not purposeful rule-breaking.

=== STYLE ===
Plain, warm, exact — a sharp friend who reads closely. Concise: every line earns its place. Skip scholarly jargon.

=== RESPONSE SHAPE — return ONLY this JSON, fields in this order ===
Read and perceive FIRST (warm_reaction, strengths, weaknesses), then score from what you actually saw.
{
  "warm_reaction": "<≤14 words — your honest first feeling on the current draft>",
  "strengths": ["<quote or point at a specific line/move, then what it does — ≤16 words>", ...1-4 items],
  "weaknesses": ["<quote the line, then the precise flaw — ≤18 words. DIAGNOSE, no rewrite>", ...0-3 items],
  "pillar_scores": {"chord": <int 0-25>, "craft": <int 0-25>, "spark": <int 0-25>, "echo": <int 0-25>},
  "overall_score": <int 1-100 for the CURRENT draft, MUST equal chord+craft+spark+echo>,
  "strongest_line": {"line": <int, 1-based>, "why": "<one vivid clause — why this is the best line>"},  // OMIT if no single line clearly stands out
  "issues": [
    {
      "id": "<short kebab-case>",
      "severity": "high" | "medium" | "low",
      "line_start": <int, 1-based>,
      "line_end": <int, 1-based>,
      "headline": "<≤6 words>",
      "problem_words": ["<1-2 lowercase tokens — the actual offending word(s), never stopwords like 'the/and/is'>"],  // OMIT for structural issues
      "rationale": "<3 short sentences: name the flaw, why it weakens THIS line, the KIND of move that would help. NEVER a finished rewrite.>",
      "improvements": ["<a direction to explore, not a rewritten line — ≤14 words>", ...1-2 items]
    }
  ],
  "comparison": {
    "improvements": ["<≤6 words — what the revision improved>", ...0-3 items],
    "regressions": ["<≤6 words — what it cost>", ...0-3 items],
    "unchanged": ["<≤6 words — still strong, or still weak>", ...0-3 items]
  },
  "personal_feedback": "<2-3 sentences to 'you': name the central thing the current draft is doing, how the revision moved it, then the ONE direction that reaches the next level. No rewrite, no preamble.>"
}

DISCIPLINE:
- strengths & weaknesses must each QUOTE or point at an actual line — never abstract.
- A strength is a real craft move (a fresh image, a turn, a deliberate echo, controlled syntax), NOT a restated idea or topic ("honest voice", "important message" → omit).
- issues: 0-3, diagnosis only, no rewrite field ever. Prefer single-line. Strong drafts can have zero — never manufacture issues to justify a score.
- NO DOUBLE-COUNTING: anything praised in strengths[] cannot also appear in weaknesses[] or issues[].
- Title and writing focus are CONTEXT, not scoring inputs.

EXAMPLE rationale (good): "The phrase 'gentle breeze' is the dictionary entry for breeze. It collapses a tactile sensation into received language. A weather verb — needling, slack, brackish — would carry real weight." (Names the flaw, why it weakens THIS line, the kind of move — never writes the finished line.)`;

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
    priorAnchor += `\nPrior overall_score: ${priorOverall}. New score moves FROM here, driven by NEW evidence in the diff (see RE-SCORING A REVISION — small revision → ≤3 pts; sharper move → 1-2 pts on one pillar; substantively new strength → up to 5-6 pts).`;
  }
  void previousMatchedProfile; // A-G profiles retired; kept in the cache key only for backward continuity.
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
      // Medium reasoning kept intentionally — scoring quality depends on it.
      // Keep the token ceiling generous: max_completion_tokens caps reasoning +
      // output combined, so a low ceiling truncates long poems mid-JSON.
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
