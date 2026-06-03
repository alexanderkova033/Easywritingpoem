/**
 * Spend caps for Vercel serverless functions.
 *
 * Three layers:
 *   1. Per-IP, per-calendar-month cap (default $2.00).
 *   2. Global, per-UTC-day cap (default $5.00) — kill switch for the whole app.
 *   3. Per-IP, per-endpoint cooldown (5 s default, 60 s for heavy analysis).
 *
 * State lives in Vercel KV when configured, falling back to a process-local
 * Map in local dev. With KV enabled the counters are durable across cold
 * starts and shared across all concurrent warm containers.
 */

import { kvGetNumber, kvIncrBy, kvSetPxIfAbsent } from "./_kv";

const PER_IP_MONTHLY_CAP_CENTS = 500;
const GLOBAL_DAILY_CAP_CENTS = 500;

const DEFAULT_COOLDOWN_MS = 5_000;
// Cooldown is a soft anti-spam backstop on top of:
//   - the 8-per-60s sliding-window rate limit in _rate-limit.ts
//   - the server-side response cache (cache hits skip this gate entirely)
// Keep it short enough that legitimate users analyzing different poems back-to-back
// aren't blocked, but long enough to discourage accidental rapid resubmits.
const ANALYZE_COOLDOWN_BY_MODEL_MS: Record<string, number> = {
  "gpt-5-nano": 15_000,
  "gpt-5-mini": 30_000,
};
const ANALYZE_COOLDOWN_FALLBACK_MS = 30_000;

interface ModelPrice {
  inCentsPerMTok: number;
  outCentsPerMTok: number;
}
const MODEL_PRICING: Record<string, ModelPrice> = {
  "gpt-5-nano": { inCentsPerMTok: 5, outCentsPerMTok: 40 },
  "gpt-5-mini": { inCentsPerMTok: 25, outCentsPerMTok: 200 },
};
const FALLBACK_PRICE: ModelPrice = MODEL_PRICING["gpt-5-mini"]!;

function priceFor(model: string): ModelPrice {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model]!;
  for (const key of Object.keys(MODEL_PRICING)) {
    if (model.startsWith(key)) return MODEL_PRICING[key]!;
  }
  return FALLBACK_PRICE;
}

export function estimateCostCents(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const p = priceFor(model);
  const cents =
    (promptTokens * p.inCentsPerMTok) / 1_000_000 +
    (completionTokens * p.outCentsPerMTok) / 1_000_000;
  return Math.ceil(cents * 100) / 100;
}

function normalizeIp(rawIp: string | string[] | undefined): string {
  if (!rawIp) return "";
  return Array.isArray(rawIp) ? rawIp[0]! : rawIp.split(",")[0]!.trim();
}

function monthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function dayKey(d = new Date()): string {
  return `${monthKey(d)}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function globalDayKvKey(day: string): string {
  return `spend:global:${day}`;
}

function ipMonthKvKey(ip: string, month: string): string {
  return `spend:ip:${ip}:${month}`;
}

function cooldownKvKey(ip: string, endpoint: string): string {
  return `cooldown:${ip}:${endpoint}`;
}

export interface PrecheckResult {
  ok: boolean;
  ip: string;
  status: number;
  retryAfterSec: number;
  body: { error: string; retryAfterSec?: number; reason: string } | null;
}

export interface PrecheckOpts {
  rawIp: string | string[] | undefined;
  endpoint: string;
  cooldownMs?: number;
}

function block(
  status: number,
  reason: string,
  error: string,
  retryAfterSec: number,
): PrecheckResult {
  return {
    ok: false,
    ip: "",
    status,
    retryAfterSec,
    body:
      retryAfterSec > 0
        ? { error, retryAfterSec, reason }
        : { error, reason },
  };
}

export async function precheckSpend(
  opts: PrecheckOpts,
): Promise<PrecheckResult> {
  if (process.env.OPENAI_DISABLED === "true") {
    return block(503, "kill-switch", "AI features are temporarily disabled.", 0);
  }

  const ip = normalizeIp(opts.rawIp);

  if (!ip) return { ok: true, ip: "", status: 200, retryAfterSec: 0, body: null };

  const day = dayKey();
  const globalCents = await kvGetNumber(globalDayKvKey(day));
  if (globalCents >= GLOBAL_DAILY_CAP_CENTS) {
    return block(
      503,
      "global-daily-cap",
      "Daily AI budget reached for this service. Try again tomorrow.",
      secondsUntilNextUtcMidnight(),
    );
  }

  const month = monthKey();
  const ipCents = await kvGetNumber(ipMonthKvKey(ip, month));
  if (ipCents >= PER_IP_MONTHLY_CAP_CENTS) {
    return block(
      402,
      "user-monthly-cap",
      "Monthly AI usage limit reached. Resets next month.",
      secondsUntilNextUtcMonth(),
    );
  }

  const cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const installed = await kvSetPxIfAbsent(
    cooldownKvKey(ip, opts.endpoint),
    Date.now() + cooldownMs,
    cooldownMs,
  );
  if (!installed) {
    return block(
      429,
      "cooldown",
      `Please wait a moment before retrying this action.`,
      Math.ceil(cooldownMs / 1000),
    );
  }

  return { ok: true, ip, status: 200, retryAfterSec: 0, body: null };
}

export function cooldownFor(endpoint: string, model?: string): number {
  if (endpoint === "analyze" || endpoint === "compare") {
    if (!model) return ANALYZE_COOLDOWN_FALLBACK_MS;
    if (ANALYZE_COOLDOWN_BY_MODEL_MS[model] != null) {
      return ANALYZE_COOLDOWN_BY_MODEL_MS[model]!;
    }
    for (const key of Object.keys(ANALYZE_COOLDOWN_BY_MODEL_MS)) {
      if (model.startsWith(key)) return ANALYZE_COOLDOWN_BY_MODEL_MS[key]!;
    }
    return ANALYZE_COOLDOWN_FALLBACK_MS;
  }
  return DEFAULT_COOLDOWN_MS;
}

export async function recordSpend(
  ip: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
): Promise<{ ipCents: number; globalCents: number; cost: number }> {
  const cost = estimateCostCents(model, promptTokens, completionTokens);
  const costWhole = Math.max(1, Math.ceil(cost));

  const day = dayKey();
  const newGlobal = await kvIncrBy(
    globalDayKvKey(day),
    costWhole,
    secondsUntilNextUtcMidnight() * 1000,
  );

  let newIp = 0;
  if (ip) {
    const month = monthKey();
    newIp = await kvIncrBy(
      ipMonthKvKey(ip, month),
      costWhole,
      secondsUntilNextUtcMonth() * 1000,
    );
  }
  return { ipCents: newIp, globalCents: newGlobal, cost };
}

export function getCaps() {
  return {
    perIpMonthlyCapCents: PER_IP_MONTHLY_CAP_CENTS,
    globalDailyCapCents: GLOBAL_DAILY_CAP_CENTS,
  };
}

function secondsUntilNextUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return Math.ceil((next - now.getTime()) / 1000);
}

function secondsUntilNextUtcMonth(): number {
  const now = new Date();
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() + 1,
    1,
    0,
    0,
    0,
    0,
  );
  return Math.ceil((next - now.getTime()) / 1000);
}
