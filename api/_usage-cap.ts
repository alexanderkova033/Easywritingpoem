/**
 * Spend caps for Vercel serverless functions.
 *
 * Three layers:
 *   1. Per-IP, per-calendar-month cap (default $2.00).
 *   2. Global, per-UTC-day cap (default $5.00) — kill switch for the whole app.
 *   3. Per-IP, per-endpoint cooldown (5 s default, 60 s for heavy analysis).
 *
 * State is kept in module-level Maps. That works while the Lambda container is
 * warm and silently resets on cold-start. For true enforcement migrate this to
 * Vercel KV / Upstash Redis — see docs/PLANS.md (P0).
 *
 * "Per user" really means "per IP" today; there is no auth (PLANS.md P1).
 */

const PER_IP_MONTHLY_CAP_CENTS = 200;   // $2.00
const GLOBAL_DAILY_CAP_CENTS   = 500;   // $5.00

const DEFAULT_COOLDOWN_MS  = 5_000;
const ANALYZE_COOLDOWN_MS  = 60_000;

/**
 * Model pricing in cents per 1M tokens. Values are conservative — round up
 * rather than down so the cap protects us when pricing shifts.
 * Update when OpenAI pricing changes; missing models fall back to the most
 * expensive entry.
 */
interface ModelPrice { inCentsPerMTok: number; outCentsPerMTok: number; }
const MODEL_PRICING: Record<string, ModelPrice> = {
  "gpt-5-nano": { inCentsPerMTok: 5,    outCentsPerMTok: 40   },
  "gpt-5-mini": { inCentsPerMTok: 25,   outCentsPerMTok: 200  },
  "gpt-5":      { inCentsPerMTok: 125,  outCentsPerMTok: 1000 },
};
const FALLBACK_PRICE: ModelPrice = MODEL_PRICING["gpt-5"]!;

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
    (promptTokens     * p.inCentsPerMTok)  / 1_000_000 +
    (completionTokens * p.outCentsPerMTok) / 1_000_000;
  return Math.ceil(cents * 100) / 100; // keep 2 decimal cents of resolution
}

// --- Storage ----------------------------------------------------------------

const ipMonthSpend  = new Map<string, number>();         // key: `${ip}:${YYYY-MM}` → cents
const globalDaySpend = new Map<string, number>();        // key: YYYY-MM-DD → cents
const cooldownAt    = new Map<string, number>();         // key: `${ip}:${endpoint}` → next-allowed-at ms

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

// --- Kill switch ------------------------------------------------------------

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
    body: retryAfterSec > 0
      ? { error, retryAfterSec, reason }
      : { error, reason },
  };
}

/**
 * Run before each OpenAI call. Returns either `{ok:true}` or a structured
 * block describing why the request was rejected. Caller forwards the block
 * to the HTTP response.
 */
export function precheckSpend(opts: PrecheckOpts): PrecheckResult {
  if (process.env.OPENAI_DISABLED === "true") {
    return block(503, "kill-switch", "AI features are temporarily disabled.", 0);
  }

  const ip = normalizeIp(opts.rawIp);

  // No IP header → local dev / direct invocation. Allow.
  if (!ip) return { ok: true, ip: "", status: 200, retryAfterSec: 0, body: null };

  // Global daily kill switch.
  const day = dayKey();
  const globalCents = globalDaySpend.get(day) ?? 0;
  if (globalCents >= GLOBAL_DAILY_CAP_CENTS) {
    return block(
      503,
      "global-daily-cap",
      "Daily AI budget reached for this service. Try again tomorrow.",
      secondsUntilNextUtcMidnight(),
    );
  }

  // Per-IP monthly cap.
  const month = monthKey();
  const ipCents = ipMonthSpend.get(`${ip}:${month}`) ?? 0;
  if (ipCents >= PER_IP_MONTHLY_CAP_CENTS) {
    return block(
      402,
      "user-monthly-cap",
      "Monthly AI usage limit reached. Resets next month.",
      secondsUntilNextUtcMonth(),
    );
  }

  // Cooldown.
  const cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const cdKey = `${ip}:${opts.endpoint}`;
  const nextAt = cooldownAt.get(cdKey) ?? 0;
  const now = Date.now();
  if (now < nextAt) {
    const retryAfterSec = Math.max(1, Math.ceil((nextAt - now) / 1000));
    return block(
      429,
      "cooldown",
      `Please wait ${retryAfterSec}s before retrying this action.`,
      retryAfterSec,
    );
  }
  cooldownAt.set(cdKey, now + cooldownMs);

  return { ok: true, ip, status: 200, retryAfterSec: 0, body: null };
}

export function cooldownFor(endpoint: string): number {
  if (endpoint === "analyze" || endpoint === "compare") return ANALYZE_COOLDOWN_MS;
  return DEFAULT_COOLDOWN_MS;
}

/**
 * After a successful OpenAI call, charge the actual cost against both
 * the per-IP monthly counter and the global daily counter.
 */
export function recordSpend(
  ip: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
): { ipCents: number; globalCents: number; cost: number } {
  const cost = estimateCostCents(model, promptTokens, completionTokens);
  const day = dayKey();
  const newGlobal = (globalDaySpend.get(day) ?? 0) + cost;
  globalDaySpend.set(day, newGlobal);

  let newIp = 0;
  if (ip) {
    const month = monthKey();
    const key = `${ip}:${month}`;
    newIp = (ipMonthSpend.get(key) ?? 0) + cost;
    ipMonthSpend.set(key, newIp);
  }
  return { ipCents: newIp, globalCents: newGlobal, cost };
}

export function getCaps() {
  return {
    perIpMonthlyCapCents: PER_IP_MONTHLY_CAP_CENTS,
    globalDailyCapCents:  GLOBAL_DAILY_CAP_CENTS,
  };
}

// --- Time helpers -----------------------------------------------------------

function secondsUntilNextUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0,
  );
  return Math.ceil((next - now.getTime()) / 1000);
}

function secondsUntilNextUtcMonth(): number {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0);
  return Math.ceil((next - now.getTime()) / 1000);
}
