# Plans — cost control & monetization

Deferred work tracked here. As of 2026-05-11 the live caps are:

- **Per-IP**: $2.00 / calendar month of OpenAI spend (in-memory, best-effort).
- **Global**: $5.00 / UTC day across all callers (kill-switch).
- **Cooldown**: 5 s between calls per IP per endpoint; 60 s for `/api/analyze` and `/api/compare`.
- **Env kill-switch**: `OPENAI_DISABLED=true` returns 503 immediately.

Implementation lives in `api/_usage-cap.ts` and `api/_rate-limit.ts`.

## P0 — Storage durability

The current caps live in `Map` instances inside `api/_usage-cap.ts`. Vercel serverless containers are recycled, so a cold-start resets every counter and the cap silently re-opens. Move state to **Vercel KV** (or Upstash Redis) before treating the cap as a real spend ceiling. Keys to migrate:

- `ipMonth:<ip>:<YYYY-MM>` → cents spent.
- `globalDay:<YYYY-MM-DD>` → cents spent.
- `cooldown:<ip>:<endpoint>` → last-call timestamp (or a sliding-window count).

KV adds ~5 ms per request but makes the limit actually hold across instances.

## P1 — Real user identity

There is no auth in this repo. "Per user" today means "per IP". Two users on the same NAT share a cap; one user on mobile + wifi gets two caps. Real fix:

- Add a lightweight auth (Clerk, Supabase, or a magic-link of our own).
- Key all usage by `user_id` instead of IP. Keep IP as a secondary throttle for anon endpoints.
- Migrate the cooldown map to user-scoped keys.

## P2 — Spend notifications

When a user crosses thresholds of their monthly cap, surface it in the UI and (optionally) by email:

- 50 % spent → soft inline notice ("you're halfway through this month's free AI").
- 80 % spent → banner.
- 100 % spent → modal explaining the cap and pointing at the upgrade option (see P3).

Server returns `X-AI-Usage-Cents` and `X-AI-Usage-Cap-Cents` headers on every AI response; the client renders the banner from those. Email requires P1 (we need to know the address) and a transactional provider (Resend / Postmark).

## P3 — Paid subscription tier

Once P1 ships:

- Stripe (or Lemon Squeezy) checkout: a "Plus" plan with a higher monthly cap (e.g. $20).
- Webhook updates `user.plan` and `user.cap_cents`.
- `_usage-cap.ts` reads the per-user cap from the user record instead of the global constant.
- One-time top-ups ("buy $5 more credit this month") are a nice-to-have after recurring works.

## P4 — Token reduction

Free spend goes further if every call sends fewer tokens. Concrete moves:

- **System-prompt trim**: `api/analyze.ts` and `api/compare.ts` system prompts are ~600 words each. Compress; move long descriptions to few-shot examples that cache.
- **Per-call `max_completion_tokens` audit**: `analyze` (5 000) and `compare` (6 000) likely overshoot real output sizes. Measure p95 and cut to p95 × 1.2.
- **Chat history cap**: already capped at 6 turns + 4 000 chars/turn — drop to 4 turns + 2 000 chars/turn after a usability check.
- **Local pre-filter**: skip the API entirely when `lines` are unchanged from the last analysis (cache by `(title, lines)` hash for ~5 min).
- **Prompt caching**: prefix-cacheable system prompts saves ~50 % on input tokens for repeat-prompt endpoints (`analyze`, `compare`, `suggest`).
- **Model tier-down for previews**: the first analyze pass on a short draft can use `gpt-5-nano` with reduced reasoning; promote to `gpt-5-mini` only on user request.

Track this work under a single epic; each bullet is a separate PR with a before/after token measurement.

## P5 — Observability

You cannot tune what you cannot see.

- Log `{userId, endpoint, model, prompt_tokens, completion_tokens, cost_cents}` per call to a durable sink (Vercel logs are ephemeral).
- Daily aggregate in a dashboard. Alert when global daily spend > 80 % of the $5 ceiling.

## P6 — OpenAI platform hard cap

Belt and suspenders: set a **monthly budget** in the OpenAI dashboard at whatever number we are willing to lose in the worst case. This is the only limit that does not depend on our code being correct. Owner: whoever holds the OpenAI billing account.
