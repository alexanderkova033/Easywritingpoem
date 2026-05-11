# Deployment

The app is deployed on Vercel as a static SPA plus Node.js serverless functions.

---

## How it deploys

| Concern | Setup |
|---|---|
| Trigger | Push to `main` |
| Build command | `cd web && npm install && npm run build` (defined in [vercel.json](../vercel.json)) |
| Output directory | `web/dist` |
| API functions | Files under `/api/*.ts` are auto-deployed as Vercel Node.js serverless functions |
| Framework preset | None (`"framework": null`) |
| Rewrites | `/api/*` → function handlers, everything else → `index.html` (SPA fallback) |

---

## Environment variables

Set these in the Vercel project dashboard (Production, Preview, Development as appropriate):

| Variable | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | yes (for AI features) | Project-owned key. AI panels show "not configured" if missing. |
| `OPENAI_MODEL` | optional | Override default model. |

**Never commit `.env` files.** `.gitignore` excludes them; double-check before pushing.

---

## Headers

All responses get security headers via [vercel.json](../vercel.json):

- `Content-Security-Policy` — see [SECURITY.md](../SECURITY.md)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`

If you add a third-party script, style, or fetch target, update the CSP in the same PR.

---

## Build invariants

`npm run build` runs:

1. `npm run check:cmu-stress` — fails if `cmu-stress.txt` is older than `wordlist-en.txt`. Regenerate with `npm run generate:cmu-stress`.
2. `tsc --noEmit -p tsconfig.json` — type-check.
3. `vite build` — produce hashed static files in `web/dist`.

A red build blocks the deploy.

---

## Local Vercel dev

```sh
# from repo root, not web/
vercel dev
```

This serves the Vite frontend and the `/api` functions together, mirroring production routing. Required for testing AI endpoints locally.

---

## Rollback

Vercel keeps every previous deploy. To roll back:

1. Open the Vercel dashboard → Deployments.
2. Find the last good deploy.
3. "Promote to Production".

No DB migration concerns — there's no backend database.

---

## Custom domain

`easywritingpoem.org` is the production domain. DNS configuration lives in the registrar; the Vercel project must list it under Domains with HTTPS auto-provisioned.

---

## Monitoring

- `@vercel/analytics` and `@vercel/speed-insights` provide anonymous Core Web Vitals and page-view metrics.
- Function logs are in the Vercel dashboard under Logs.
- No external APM or error tracking wired up. Consider Sentry if error rates rise.

---

## Scaling considerations

- **Rate limiter** is in-memory per function instance. One key serves all users — switch to Vercel KV / Upstash Redis before traffic grows.
- **OpenAI cost** is unbounded per request type. Consider per-IP daily caps and per-request token budgets if abuse appears.
- **CMU lexicon** is bundled into the client. ~1–2 MB gzipped. Acceptable but watch bundle growth.
