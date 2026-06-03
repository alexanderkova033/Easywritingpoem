/**
 * Vercel KV wrapper with in-memory fallback.
 *
 * In production (KV_REST_API_URL + KV_REST_API_TOKEN set) every API call goes
 * to Vercel KV, so counters survive across warm/cold lambda boundaries and
 * are shared between concurrent invocations. In dev (no env vars) the
 * functions degrade to a process-local Map so local invocations still work.
 *
 * Keep the surface tiny: `incrBy`, `get`, `pexpire`, `pttl`, `setPxIfAbsent`.
 */

import { kv } from "@vercel/kv";

const hasRemote =
  !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;

interface MemRecord {
  value: number | string;
  expiresAt: number; // ms epoch; 0 = never
}

const mem = new Map<string, MemRecord>();

function gcMem(now: number): void {
  if (mem.size < 256) return;
  for (const [k, r] of mem) {
    if (r.expiresAt && r.expiresAt <= now) mem.delete(k);
  }
}

function readMem(key: string): MemRecord | undefined {
  const r = mem.get(key);
  if (!r) return undefined;
  if (r.expiresAt && r.expiresAt <= Date.now()) {
    mem.delete(key);
    return undefined;
  }
  return r;
}

export async function kvIncrBy(
  key: string,
  amount: number,
  ttlMs?: number,
): Promise<number> {
  if (hasRemote) {
    const next = await kv.incrby(key, amount);
    if (ttlMs && next === amount) {
      await kv.pexpire(key, ttlMs);
    }
    return next;
  }
  const now = Date.now();
  gcMem(now);
  const existing = readMem(key);
  if (!existing || typeof existing.value !== "number") {
    mem.set(key, {
      value: amount,
      expiresAt: ttlMs ? now + ttlMs : 0,
    });
    return amount;
  }
  existing.value += amount;
  return existing.value;
}

export async function kvGetNumber(key: string): Promise<number> {
  if (hasRemote) {
    const v = await kv.get<number>(key);
    return typeof v === "number" ? v : 0;
  }
  const r = readMem(key);
  return typeof r?.value === "number" ? r.value : 0;
}

export async function kvPttl(key: string): Promise<number> {
  if (hasRemote) {
    const ms = await kv.pttl(key);
    return typeof ms === "number" && ms > 0 ? ms : 0;
  }
  const r = readMem(key);
  if (!r || !r.expiresAt) return 0;
  return Math.max(0, r.expiresAt - Date.now());
}

/**
 * Atomic "set if absent" with TTL. Returns true if this caller installed the
 * value (i.e. won the cooldown race). Used to serialize per-IP cooldowns.
 */
export async function kvSetPxIfAbsent(
  key: string,
  value: number,
  ttlMs: number,
): Promise<boolean> {
  if (hasRemote) {
    const res = await kv.set(key, value, { px: ttlMs, nx: true });
    return res === "OK";
  }
  const now = Date.now();
  gcMem(now);
  const existing = readMem(key);
  if (existing) return false;
  mem.set(key, { value, expiresAt: now + ttlMs });
  return true;
}

export function kvIsRemote(): boolean {
  return hasRemote;
}

/** Read a previously stored string value, or null if missing / expired. */
export async function kvGetString(key: string): Promise<string | null> {
  if (hasRemote) {
    const v = await kv.get<string>(key);
    return typeof v === "string" ? v : null;
  }
  const r = readMem(key);
  return typeof r?.value === "string" ? r.value : null;
}

/** Write a string value with a millisecond TTL. Overwrites any existing entry. */
export async function kvSetStringPx(
  key: string,
  value: string,
  ttlMs: number,
): Promise<void> {
  if (hasRemote) {
    await kv.set(key, value, { px: ttlMs });
    return;
  }
  const now = Date.now();
  gcMem(now);
  mem.set(key, { value, expiresAt: now + ttlMs });
}
