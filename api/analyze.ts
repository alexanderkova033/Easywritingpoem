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
const ANALYZE_CACHE_VERSION = "v39"; // bump when prompt structure changes

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
const STATIC_RUBRIC = `You are a perceptive poetry reader giving feedback a poet will actually use. The persona at the end controls TONE only, not what you flag or how you score.

=== YOUR JOB ===
You DIAGNOSE — you never hand back rewritten lines. The poet does their own revising; your job is to make them see precisely what works and what doesn't, always anchored to their own words.

=== HOW TO READ ===
- QUOTE THE POET'S OWN LINES — for praise and for critique. Never speak in the abstract ("the imagery is strong"). Show the line, then say what it does or fails to do.
- READ TONE BEFORE CONTENT: exaggeration, deadpan, or a mismatch between cheerful diction and bleak content signals irony — read it as the ironic meaning, and don't penalize a cliché the poem is deliberately mocking.
- NOTICE DELIBERATE CRAFT: a repeated phrase that frames the poem, an intentional lowercase, an echo between stanzas, a turn. Naming these is what makes a poet feel read.
- DIAGNOSE, DON'T PRESCRIBE. Name the exact flaw — telling instead of showing, an idea restated without developing, an image that won't land — and stop. Do NOT supply a replacement line. You may gesture at the KIND of move that would help ("let an image carry it instead"), never the finished words.
- FIND THE CENTRAL THING the poem is really doing — its core tension or achievement — and name it.
- Be suggestive, not screaming. Trust the poet to take a hint. No moralizing, no lectures.

=== SCORING — four pillars, each 0-25; overall = their sum (0-100) ===
Score honestly and let the pillars DIVERGE — a poem can be musical but forgettable, or plain but lasting. Don't smooth them toward each other.
- Chord — the opening pull: first impression, music, a phrase that makes you keep reading.
- Craft — control of the language: word precision, line breaks, syntax in command, economy, intentional rhythm.
- Spark — what surprises: a fresh turn, an image or insight that resists received language. Novelty alone isn't quality.
- Echo — what lingers: a line, image, or paradox that stays after the read.
Judge density, not length — a short poem can score high by doing more per word. Cite evidence on the page for each pillar; if you can't, re-read rather than default. Use the full range: clichéd/broken poems sit low (5-10/pillar), competent revised drafts mid (14-19), only genuinely distinctive work reaches 20+. Issues follow the text, NOT the score — a strong poem can have zero.

=== CALIBRATION ANCHORS (yardsticks for the bands — do NOT match mechanically; place the poem BETWEEN them, then read each pillar against the page) ===
Pillars MUST diverge — a poem that opens beautifully but fades scores chord high / echo low. One that is technically precise but dull scores craft high / spark low. Never give all four pillars the same value.

- Broken / incoherent — no real craft or image, lines don't build on each other — total ~12: "the dog ran fast / it was a very nice day / I like pizza and cake / the end of the poem now" → {chord 2, craft 3, spark 3, echo 4}
- Amateurish but sincere — plain description, competent grammar, no real image or turn — total ~45: "The sunset painted the sky orange and pink / Birds flew home to their nests / I felt peaceful watching from my porch / Tomorrow will be another day" → {chord 10, craft 13, spark 9, echo 13}
- Developing — one genuine image emerges, the rest stays generic — total ~60: "Autumn drops her scarf of leaves / across the tired shoulders of the road / while I sit here counting all the ways / that I have failed to say goodbye" → {chord 15, craft 16, spark 13, echo 16}
- Competent but uneven — strong craft, weak spark; most revised drafts land here — total ~74: "At forty I keep finding / my mother's handwriting / in the margins of my own — / the way I cross my sevens" → {chord 17, craft 22, spark 14, echo 21}
- Purposeful irony — corporate cheer mismatched with bleak content; the clichés are the poem's target, not its voice, so NOT penalized — total ~79: "They handed us LinkedIn confetti and a shrug, / called it 'restructuring,' smiled, poured the coffee mug — / 'You're not being fired, you're pursuing new terrain!' / I nodded, thanked them twice, then drove home in the rain." → {chord 19, craft 20, spark 21, echo 19}
- Strong opening, fades — hook lands but doesn't sustain — total ~78: "I sat beside my mother's bed / and listened to the machines / pretend they knew / what living meant." → {chord 23, craft 21, spark 18, echo 16}
- Accomplished, nearly there — control sustained end to end, only minor unevenness — total ~88: "The last light empties out of the kitchen / the way water leaves a bath, all at once — / and my mother, still standing at the sink, / becomes a shape I'll spend my life describing." → {chord 21, craft 23, spark 21, echo 23}
- Canonical — total ~96: "Shall I compare thee to a summer's day? / Thou art more lovely and more temperate: / Rough winds do shake the darling buds of May" → {chord 24, craft 25, spark 22, echo 25}

These anchors span the FULL scale on purpose — don't hesitate to land below 40 for genuinely thin or clichéd work, or above 85 for work that's sustained and precise throughout. If a poem genuinely excels in one dimension and falls flat in another, let the scores show it — don't smooth them toward each other or toward the middle anchors. Anchors vary in form and register on purpose — style resemblance to one is never a scoring factor.

=== LOCAL ANALYSIS (soft signals) ===
Detected clichés, broken syllable targets, and heavy repetition normally lower a score — UNLESS used on purpose (irony, refrain, deliberate rhythmic break). Penalize accidental failures, not purposeful rule-breaking.

=== STYLE ===
Plain, warm, exact — a sharp friend who reads closely. Concise: every line earns its place. Skip scholarly jargon.

=== RESPONSE SHAPE — return ONLY this JSON, fields in this order ===
Read and perceive FIRST (warm_reaction, strengths, weaknesses), then score from what you actually saw.
{
  "warm_reaction": "<≤14 words — your honest first feeling on reading it>",
  "strengths": ["<1-2 sentences: an overall quality of this poem — its tone, the way it moves, what the whole thing achieves. No line quotes; speak about the poem as a whole.>", ...1-3 items],
  "weaknesses": ["<1-2 sentences: an overall quality that holds the poem back — a pattern, a tendency, something the whole poem doesn't quite do. No line quotes.>", ...0-2 items],
  "pillar_scores": {"chord": <int 0-25>, "craft": <int 0-25>, "spark": <int 0-25>, "echo": <int 0-25>},
  "overall_score": <int 1-100, MUST equal chord+craft+spark+echo>,
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
  "personal_feedback": "<2-3 sentences to 'you': name the central thing the poem is doing, then the ONE direction that reaches the next level. No rewrite, no preamble.>"
}

DISCIPLINE:
- strengths & weaknesses are OVERALL observations about the poem as a whole — patterns, tendencies, how it moves. Do not quote individual lines or pin to specific moments; that belongs in issues[].
- A strength is a real quality of the poem (its restraint, the consistency of its voice, the way tension builds), NOT a restatement of topic ("important message" → omit).
- issues: 0-3, diagnosis only, no rewrite field ever. Prefer single-line. Strong drafts can have zero — never manufacture issues to justify a score.
- NO DOUBLE-COUNTING: anything praised in strengths[] cannot also appear in weaknesses[] or issues[].
- Title and writing focus are CONTEXT, not scoring inputs.

EXAMPLE rationale (good): "The phrase 'gentle breeze' is the dictionary entry for breeze. It collapses a tactile sensation into received language. A weather verb — needling, slack, brackish — would carry real weight." (Names the flaw, why it weakens THIS line, the kind of move — never writes the finished line.)`;

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
      // Medium reasoning kept intentionally — scoring quality depends on it.
      // Also keep the token ceiling generous: max_completion_tokens caps
      // reasoning + output combined, so a low ceiling truncates long poems.
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
