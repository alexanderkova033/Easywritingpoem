/**
 * IP-based sliding-window rate limiter.
 *
 * Uses Vercel KV when configured so the window is shared across all warm
 * lambda containers; falls back to a process-local Map in dev.
 */

import { kvIncrBy, kvIsRemote, kvPttl } from "./_kv";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8;

function normalizeIp(rawIp: string | string[] | undefined): string {
  if (!rawIp) return "";
  return Array.isArray(rawIp) ? rawIp[0]! : rawIp.split(",")[0]!.trim();
}

function bucketKey(ip: string): string {
  return `rl:${ip}`;
}

/** True if the request is allowed; false if the IP is over its limit. */
export async function checkRateLimit(
  rawIp: string | string[] | undefined,
): Promise<boolean> {
  const ip = normalizeIp(rawIp);
  if (!ip) {
    // Can't identify the caller, so a per-IP limit can't apply. In local dev
    // (no KV configured) x-forwarded-for is often absent — allow through.
    // In production this should never happen (Vercel's edge always sets it);
    // if it ever does, fail closed rather than grant unlimited requests.
    return !kvIsRemote();
  }
  try {
    const count = await kvIncrBy(bucketKey(ip), 1, WINDOW_MS);
    return count <= MAX_PER_WINDOW;
  } catch {
    // KV outage: fail closed. A blip in the limiter store is not a reason to
    // let cost-incurring requests through unmetered.
    return false;
  }
}

/** Seconds until the IP's window resets. 0 if no active bucket. */
export async function getRateLimitRetrySec(
  rawIp: string | string[] | undefined,
): Promise<number> {
  const ip = normalizeIp(rawIp);
  if (!ip) return 0;
  try {
    const ms = await kvPttl(bucketKey(ip));
    return Math.max(0, Math.ceil(ms / 1000));
  } catch {
    return 0;
  }
}
