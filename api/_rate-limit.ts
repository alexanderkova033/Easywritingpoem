/**
 * Simple in-memory IP-based rate limiter for Vercel serverless functions.
 *
 * Because each function instance can be reused across several requests while
 * the container is warm, this catches burst abuse within a single warm
 * instance.  It is NOT a distributed rate limiter — if you need hard
 * per-user quotas add Vercel KV or an edge middleware.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

// Module-level store; persists as long as the Lambda container is warm.
const store = new Map<string, Bucket>();

const WINDOW_MS = 60_000; // 1-minute sliding window
const MAX_PER_WINDOW = 8; // requests per IP per window

/** Clean up expired buckets to avoid unbounded memory growth. */
function gc(): void {
  const now = Date.now();
  for (const [key, bucket] of store) {
    if (now >= bucket.resetAt) store.delete(key);
  }
}

function normalizeIp(rawIp: string | string[] | undefined): string {
  if (!rawIp) return "";
  return Array.isArray(rawIp) ? rawIp[0]! : rawIp.split(",")[0]!.trim();
}

/**
 * Returns true if the request is allowed, false if the IP is over limit.
 * Pass the raw value of the `x-forwarded-for` (or similar) header.
 */
export function checkRateLimit(rawIp: string | string[] | undefined): boolean {
  // Always allow when running locally (no IP header).
  if (!rawIp) return true;

  const ip = normalizeIp(rawIp);
  if (!ip) return true;

  const now = Date.now();

  // Periodic GC (every ~50 calls on average).
  if (Math.random() < 0.02) gc();

  const bucket = store.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (bucket.count >= MAX_PER_WINDOW) return false;

  bucket.count++;
  return true;
}

/** Seconds until the IP's window resets. 0 if no active bucket. */
export function getRateLimitRetrySec(rawIp: string | string[] | undefined): number {
  const ip = normalizeIp(rawIp);
  if (!ip) return 0;
  const bucket = store.get(ip);
  if (!bucket) return 0;
  return Math.max(0, Math.ceil((bucket.resetAt - Date.now()) / 1000));
}
