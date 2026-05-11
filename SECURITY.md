# Security policy

## Privacy posture

- **Poems never leave the browser** unless the user explicitly triggers AI analysis, export, or sharing.
- **No user accounts.** No backend database. All persistence is `localStorage`.
- **No analytics on poem content.** Only anonymous page/session metrics via `@vercel/analytics` and `@vercel/speed-insights`.
- **AI calls** send only the poem text the user submits; nothing is stored server-side.

## AI key handling

- A single project-owned `OPENAI_API_KEY` is set in Vercel environment variables. Users do **not** bring their own key.
- The key lives only inside Vercel serverless functions (`api/`). The browser never sees it.
- This means one shared key serves all traffic — rate limiting and abuse protection are critical.

## Content Security Policy

Defined in [vercel.json](vercel.json). Restricts:

- `script-src` to self + Vercel analytics
- `style-src` to self + Google Fonts
- `connect-src` to self + Datamuse, dictionaryapi.dev, Vercel insights
- `img-src` to self, data:, blob:
- `object-src` to `none`
- `frame-ancestors` blocked via `X-Frame-Options: DENY`

If you add a third-party domain, the CSP must be updated in the same PR.

## Rate limiting

[api/_rate-limit.ts](api/_rate-limit.ts) is currently in-memory per Vercel function instance. This is acceptable for current traffic but is **bypassable across instances**.

**Known issue:** at scale, swap to Vercel KV, Upstash Redis, or Edge Middleware. Tracking under [docs/PRIORITIES.md](docs/PRIORITIES.md).

## Headers

Set by Vercel for every response:

| Header | Value |
|---|---|
| `Content-Security-Policy` | see [vercel.json](vercel.json) |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

## Reporting a vulnerability

**Do not open a public GitHub issue for security-sensitive reports.**

Email the maintainer privately (see git log for current address) with:
1. A description of the issue and its impact.
2. Steps to reproduce.
3. Whether the issue is already public.

Expected response: acknowledgment within 7 days. Fixes prioritized over feature work.

## Out of scope

- Vulnerabilities in third-party services we link to (Datamuse, dictionaryapi.dev, Vercel platform itself).
- Bugs that require physical access to the user's device.
- Browser-platform issues outside our control (e.g. `localStorage` quota exhaustion).
