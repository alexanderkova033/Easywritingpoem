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

import { kvPttl, kvSetPxIfAbsent } from "./_kv";

export const GIBBERISH_COOLDOWN_MS = 15 * 60 * 1000;
export const GIBBERISH_COOLDOWN_SEC = GIBBERISH_COOLDOWN_MS / 1000;

function gibKey(ip: string): string {
  return `gib-cooldown:${ip}`;
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
}

const VOWEL_RE = /[aeiouyAEIOUY]/;

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
  for (const t of tokens) {
    totalLen += t.length;
    if (t.length > longestToken) {
      longestToken = t.length;
      longestTokenVowelless = !VOWEL_RE.test(t);
    }
    const hasAlpha = /[a-zA-Z]/.test(t);
    const passesShape =
      t.length >= 1 && t.length <= 22 && (t.length <= 3 || VOWEL_RE.test(t));
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
  };
}

export type GibberishVerdict =
  | { kind: "ok" }
  | { kind: "block"; reason: string }
  | { kind: "ask-llm"; reason: string };

export function classifyGibberish(s: GibberishSignals): GibberishVerdict {
  // Very short input — leave it alone; the user may be drafting one line.
  if (s.length < 40) return { kind: "ok" };

  if (s.longestToken >= 25 && s.longestTokenVowelless) {
    return { kind: "block", reason: "long-vowelless-token" };
  }
  if (s.length >= 60 && s.dominantCharRatio >= 0.6) {
    return { kind: "block", reason: "single-char-spam" };
  }
  if (s.totalTokens >= 8 && s.wordLikeRatio < 0.2) {
    return { kind: "block", reason: "low-word-like-ratio" };
  }
  if (s.length >= 80 && s.alphaRatio < 0.35) {
    return { kind: "block", reason: "low-alpha-ratio" };
  }
  if (s.averageWordLen >= 18 && s.totalTokens >= 4) {
    return { kind: "block", reason: "mega-word-tokens" };
  }

  const borderline =
    (s.totalTokens >= 8 && s.wordLikeRatio < 0.45) ||
    (s.length >= 200 && s.wordLikeRatio < 0.55) ||
    (s.length >= 80 && s.alphaRatio < 0.5);

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
  const ip = normalizeIp(opts.rawIp);
  if (!ip) return { ok: true, ip: "", status: 200, retryAfterSec: 0, body: null };

  const remaining = await getGibberishCooldownSec(ip);
  if (remaining > 0) return block("gibberish-cooldown", remaining);

  const signals = computeGibberishSignals(opts.text);
  const verdict = classifyGibberish(signals);
  if (verdict.kind === "ok") {
    return { ok: true, ip, status: 200, retryAfterSec: 0, body: null };
  }
  if (verdict.kind === "block") {
    await tripGibberishCooldown(ip);
    return block("gibberish", GIBBERISH_COOLDOWN_SEC);
  }
  // ask-llm
  const isGib = await llmIsGibberish(opts.apiKey, opts.text);
  if (isGib) {
    await tripGibberishCooldown(ip);
    return block("gibberish", GIBBERISH_COOLDOWN_SEC);
  }
  return { ok: true, ip, status: 200, retryAfterSec: 0, body: null };
}
