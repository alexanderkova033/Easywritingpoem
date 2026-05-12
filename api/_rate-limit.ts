/**
 * IP-based sliding-window rate limiter.
 *
 * Uses Vercel KV when configured so the window is shared across all warm
 * lambda containers; falls back to a process-local Map in dev.
 */

import { kvIncrBy, kvPttl } from "./_kv";

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
  if (!rawIp) return true;
  const ip = normalizeIp(rawIp);
  if (!ip) return true;
  const count = await kvIncrBy(bucketKey(ip), 1, WINDOW_MS);
  return count <= MAX_PER_WINDOW;
}

/** Seconds until the IP's window resets. 0 if no active bucket. */
export async function getRateLimitRetrySec(
  rawIp: string | string[] | undefined,
): Promise<number> {
  const ip = normalizeIp(rawIp);
  if (!ip) return 0;
  const ms = await kvPttl(bucketKey(ip));
  return Math.max(0, Math.ceil(ms / 1000));
}
