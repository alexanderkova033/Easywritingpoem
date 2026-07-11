/**
 * Token-abuse guard.
 *
 * Two-stage check on user-submitted text before any OpenAI spend:
 *   1. Cheap deterministic heuristics on character/word shape.
 *   2. For borderline cases only, a tiny `gpt-5-nano` JSON classifier call.
 *
 * On a hit, the caller's IP is installed in a 15-minute KV cooldown via
 * `kvSetPxIfAbsent` and subsequent requests short-circuit at the cooldown
 * check without ever touching OpenAI.
 */

import { createHash } from "crypto";
import { kvGetString, kvPttl, kvSetPxIfAbsent, kvSetStringPx } from "./_kv";

export const GIBBERISH_COOLDOWN_MS = 15 * 60 * 1000;
export const GIBBERISH_COOLDOWN_SEC = GIBBERISH_COOLDOWN_MS / 1000;

/** TTL for caching the LLM gibberish verdict per text-hash. Same poem
 *  re-analyzed/refined/chatted-about within this window reuses the verdict
 *  instead of paying for another gpt-5-nano classification call. */
const VERDICT_CACHE_MS = 60 * 60 * 1000;

function gibKey(ip: string): string {
  return `gib-cooldown:${ip}`;
}

function verdictKey(textHash: string): string {
  return `gib-verdict:${textHash}`;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
}

export function normalizeIp(rawIp: string | string[] | undefined): string {
  if (!rawIp) return "";
  return Array.isArray(rawIp) ? rawIp[0]! : rawIp.split(",")[0]!.trim();
}

export async function getGibberishCooldownSec(ip: string): Promise<number> {
  if (!ip) return 0;
  const ms = await kvPttl(gibKey(ip));
  return Math.max(0, Math.ceil(ms / 1000));
}

export async function tripGibberishCooldown(ip: string): Promise<void> {
  if (!ip) return;
  await kvSetPxIfAbsent(
    gibKey(ip),
    Date.now() + GIBBERISH_COOLDOWN_MS,
    GIBBERISH_COOLDOWN_MS,
  );
}

export interface GibberishSignals {
  length: number;
  alphaRatio: number;
  longestToken: number;
  longestTokenVowelless: boolean;
  totalTokens: number;
  wordLikeTokens: number;
  wordLikeRatio: number;
  dominantCharRatio: number;
  averageWordLen: number;
  maxConsonantRun: number;
  tokensWithLongConsonantRun: number;
}

const VOWEL_RE = /[aeiouyAEIOUY]/;
const CONSONANT_RE = /[a-zA-Z]/;

function maxConsonantRunIn(token: string): number {
  let run = 0;
  let best = 0;
  for (const ch of token) {
    if (CONSONANT_RE.test(ch) && !VOWEL_RE.test(ch)) {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

export function computeGibberishSignals(text: string): GibberishSignals {
  const length = text.length;
  let alpha = 0;
  const charCounts = new Map<string, number>();
  let nonSpace = 0;
  for (const ch of text) {
    if (/[a-zA-Z]/.test(ch)) alpha++;
    if (!/\s/.test(ch)) {
      nonSpace++;
      charCounts.set(ch, (charCounts.get(ch) ?? 0) + 1);
    }
  }
  let dominant = 0;
  for (const c of charCounts.values()) if (c > dominant) dominant = c;

  const tokens = text.split(/\s+/).filter(Boolean);
  let longestToken = 0;
  let longestTokenVowelless = false;
  let wordLike = 0;
  let totalLen = 0;
  let maxRun = 0;
  let tokensWithLongRun = 0;
  for (const t of tokens) {
    totalLen += t.length;
    if (t.length > longestToken) {
      longestToken = t.length;
      longestTokenVowelless = !VOWEL_RE.test(t);
    }
    const run = maxConsonantRunIn(t);
    if (run > maxRun) maxRun = run;
    if (run >= 4) tokensWithLongRun++;
    const hasAlpha = /[a-zA-Z]/.test(t);
    const passesShape =
      t.length >= 1 &&
      t.length <= 22 &&
      (t.length <= 3 || VOWEL_RE.test(t)) &&
      run < 5;
    if (hasAlpha && passesShape) wordLike++;
  }
  return {
    length,
    alphaRatio: nonSpace ? alpha / nonSpace : 1,
    longestToken,
    longestTokenVowelless,
    totalTokens: tokens.length,
    wordLikeTokens: wordLike,
    wordLikeRatio: tokens.length ? wordLike / tokens.length : 1,
    dominantCharRatio: nonSpace ? dominant / nonSpace : 0,
    averageWordLen: tokens.length ? totalLen / tokens.length : 0,
    maxConsonantRun: maxRun,
    tokensWithLongConsonantRun: tokensWithLongRun,
  };
}

export type GibberishVerdict =
  | { kind: "ok" }
  | { kind: "block"; reason: string }
  | { kind: "ask-llm"; reason: string };

export function classifyGibberish(s: GibberishSignals): GibberishVerdict {
  // Very short input — leave it alone; the user may be drafting one line.
  if (s.length < 20) return { kind: "ok" };

  if (s.longestToken >= 25 && s.longestTokenVowelless) {
    return { kind: "block", reason: "long-vowelless-token" };
  }
  if (s.length >= 60 && s.dominantCharRatio >= 0.6) {
    return { kind: "block", reason: "single-char-spam" };
  }
  if (s.length >= 40 && s.totalTokens >= 8 && s.wordLikeRatio < 0.2) {
    return { kind: "block", reason: "low-word-like-ratio" };
  }
  if (s.length >= 80 && s.alphaRatio < 0.35) {
    return { kind: "block", reason: "low-alpha-ratio" };
  }
  if (s.averageWordLen >= 18 && s.totalTokens >= 4) {
    return { kind: "block", reason: "mega-word-tokens" };
  }

  // Borderline — defer to the cheap LLM check so false positives are
  // impossible from heuristics alone. The LLM gets the final say.
  const borderline =
    s.maxConsonantRun >= 6 ||
    s.tokensWithLongConsonantRun >= 3 ||
    (s.totalTokens >= 8 && s.wordLikeRatio < 0.45) ||
    (s.length >= 200 && s.wordLikeRatio < 0.55) ||
    (s.length >= 80 && s.alphaRatio < 0.5) ||
    (s.length >= 20 && s.tokensWithLongConsonantRun >= 2 && s.wordLikeRatio < 0.7);

  if (borderline) return { kind: "ask-llm", reason: "borderline" };
  return { kind: "ok" };
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Returns true if `text` is judged to be keyboard mashing / token-waste noise.
 * Uses gpt-5-nano with `max_completion_tokens: 24` so a misclassification
 * costs a fraction of a cent. Any network or parse failure falls back to
 * "not gibberish" so legit users are never blocked by an upstream outage.
 */
export async function llmIsGibberish(
  apiKey: string,
  text: string,
): Promise<boolean> {
  const sample = text.slice(0, 1600);
  const body: Record<string, unknown> = {
    model: "gpt-5-nano",
    messages: [
      {
        role: "system",
        content:
          "Classify whether the user's input is keyboard mashing, random characters, repeated nonsense, or otherwise NOT a sincere attempt at a poem (even a clumsy or short one counts as sincere). Return JSON only: {\"gibberish\": true} for mashing/nonsense, otherwise {\"gibberish\": false}.",
      },
      { role: "user", content: sample },
    ],
    max_completion_tokens: 24,
    response_format: { type: "json_object" },
    reasoning_effort: "minimal",
  };
  try {
    const r = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) return false;
    const data = (await r.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as { gibberish?: unknown };
    return parsed.gibberish === true;
  } catch {
    return false;
  }
}

export interface GibberishGuardResult {
  ok: boolean;
  ip: string;
  status: number;
  retryAfterSec: number;
  body: { error: string; retryAfterSec?: number; reason: string } | null;
}

function block(reason: string, retryAfterSec: number): GibberishGuardResult {
  return {
    ok: false,
    ip: "",
    status: 429,
    retryAfterSec,
    body: {
      error:
        reason === "gibberish-cooldown"
          ? `Earlier input looked like keyboard mashing rather than a poem. Please wait ${Math.ceil(retryAfterSec / 60)} minute(s) and try again with real text.`
          : "Input looks like keyboard mashing rather than a poem. Try again with real text — a 15 minute cooldown is now in effect.",
      retryAfterSec,
      reason,
    },
  };
}

/**
 * Combined guard: checks the existing cooldown first, then runs heuristics,
 * then (only if heuristics are uncertain) consults gpt-5-nano. On any
 * confirmed hit the IP is tripped into a 15-minute cooldown.
 *
 * Returns `{ ok: true }` for legitimate input; the handler should continue
 * with `precheckSpend` and the real model call.
 */
export async function gibberishGuard(opts: {
  rawIp: string | string[] | undefined;
  text: string;
  apiKey: string;
}): Promise<GibberishGuardResult> {
  // NOTE: unlike checkRateLimit/precheckSpend, a missing IP does NOT skip
  // this guard — classification below is pure/local and doesn't need one.
  // IP is only used to persist a repeat-offender cooldown; without it we
  // simply can't remember this caller across requests, so KV reads/writes
  // keyed on it are best-effort (`.catch(() => {})`) rather than a reason to
  // wave the request through unclassified.
  const ip = normalizeIp(opts.rawIp);

  if (ip) {
    let remaining = 0;
    try {
      remaining = await getGibberishCooldownSec(ip);
    } catch {
      // KV outage reading the cooldown bucket — treat as no active cooldown;
      // the heuristic/LLM classification below still runs regardless.
    }
    if (remaining > 0) return block("gibberish-cooldown", remaining);
  }

  const signals = computeGibberishSignals(opts.text);
  const verdict = classifyGibberish(signals);
  if (verdict.kind === "ok") {
    return { ok: true, ip, status: 200, retryAfterSec: 0, body: null };
  }
  if (verdict.kind === "block") {
    if (ip) await tripGibberishCooldown(ip).catch(() => {});
    return block("gibberish", GIBBERISH_COOLDOWN_SEC);
  }
  // ask-llm — but first check whether we've already classified this exact
  // text in the recent past. Same poem re-submitted (analyze → refine →
  // chat, etc.) should not pay for another gpt-5-nano call.
  const cacheKey = verdictKey(hashText(opts.text));
  let cached: string | null = null;
  try {
    cached = await kvGetString(cacheKey);
  } catch {
    // Cache read failed — fall through and classify fresh.
  }
  let isGib: boolean;
  if (cached === "1") {
    isGib = true;
  } else if (cached === "0") {
    isGib = false;
  } else {
    isGib = await llmIsGibberish(opts.apiKey, opts.text);
    await kvSetStringPx(cacheKey, isGib ? "1" : "0", VERDICT_CACHE_MS).catch(() => {});
  }
  if (isGib) {
    if (ip) await tripGibberishCooldown(ip).catch(() => {});
    return block("gibberish", GIBBERISH_COOLDOWN_SEC);
  }
  return { ok: true, ip, status: 200, retryAfterSec: 0, body: null };
}
