# Architecture Decision Records

This document records the key design decisions in Easy-poems and the reasoning behind them.

---

## 1. Offline-first with localStorage

**Decision:** All poem data (drafts, snapshots, plans, settings) is stored in the browser's `localStorage`. No automatic sync to any server.

**Why:**
- Privacy-preserving: poems never leave the user's browser unless they explicitly export or use AI analysis.
- Works without a network connection — the writing tools (syllables, meter, rhyme, spell check) all run entirely client-side.
- Eliminates the need for user accounts, session management, or a database.

**Trade-offs:**
- Data is scoped to a single browser profile. Clearing site data deletes poems.
- localStorage quota varies by browser (typically 5–10 MB). The app warns at 80% and prompts to export.
- No multi-device sync. The export/import workflow is the intended migration path.

**Where the keys live:** All storage key strings are centralized in [`web/src/shared/storage-keys.ts`](../web/src/shared/storage-keys.ts).

---

## 2. CodeMirror 6 for the poem editor

**Decision:** Use CodeMirror 6 (`@codemirror/view`, `@uiw/react-codemirror`) as the poem body editor instead of a plain `<textarea>`, Monaco, or Ace.

**Why:**
- CodeMirror 6 is designed for programmable editors with custom decorations — exactly what's needed for spell-check highlighting, format marks, and line-level meter hints.
- The extension system allows layering spell highlights and format markers without forking editor internals.
- Much lighter than Monaco (which is built for full IDE use cases) and more actively maintained than Ace.
- First-class TypeScript support and a well-defined extension API.

**Trade-offs:**
- Adds ~300 KB to the bundle (gzipped: ~100 KB).
- API surface is large; learning curve for future contributors.
- Virtualization for very long documents is managed by CodeMirror internally but tested only up to ~500 lines.

---

## 3. Client-side heuristic writing tools

**Decision:** Syllable counting, meter estimation, rhyme grouping, and repeated-word detection all run in the browser via heuristics and local lexicons — no server round-trips.

**Why:**
- Instant feedback: all tools update within milliseconds of typing.
- Works offline.
- No API costs or latency per keystroke.

**Implementation details:**
- **Syllables** (`writing-tools/syllables.ts`): vowel-counting heuristic with common English rules.
- **Meter** (`writing-tools/meter-hints.ts`): CMU Pronouncing Dictionary stress patterns (`public/cmu-stress.txt`) with a heuristic fallback for unknown words.
- **Rhyme** (`writing-tools/rhyme-hints.ts`): orthographic "vowel tail" clustering (groups lines by their terminal vowel+consonant pattern).
- **Spell check** (`spellcheck/`): local `wordlist-en.txt` dictionary loaded once on startup, combined with a personal dictionary and per-session ignores stored in localStorage/sessionStorage.

**CMU stress lexicon:**
`public/cmu-stress.txt` is a generated file. If `wordlist-en.txt` is updated, regenerate it with:
```sh
cd web && npm run generate:cmu-stress
```
The build process (`npm run build`) checks that `cmu-stress.txt` is newer than `wordlist-en.txt` and fails with instructions if not.

---

## 4. Optional AI analysis via Vercel serverless functions

**Decision:** AI critique (OpenAI) is an optional feature gated behind Vercel serverless functions. The browser never touches the OpenAI API key.

**Why:**
- Keeps the OpenAI key on the server — the client never sees it.
- Feature can be disabled entirely by not setting `OPENAI_API_KEY` in Vercel environment variables. The UI shows a clear "not configured" notice.
- Rate limiting (`api/_rate-limit.ts`) is in-memory per Vercel function instance; suitable for low traffic.

**Rate limiting + usage caps use Vercel KV.** [`api/_rate-limit.ts`](../api/_rate-limit.ts) and [`api/_usage-cap.ts`](../api/_usage-cap.ts) read and write counters through [`api/_kv.ts`](../api/_kv.ts), which targets Vercel KV when `KV_REST_API_URL` + `KV_REST_API_TOKEN` are present and falls back to a process-local Map in local dev. With KV configured, sliding-window IP limits, per-IP monthly $ caps, and the global daily kill switch all survive cold starts and are shared across concurrent warm containers.

**Common OpenAI call logic** is shared in [`api/_openai.ts`](../api/_openai.ts) and used by both `/api/analyze` and `/api/compare`.

### 4a. Two backends in the repo — `api/` is the production path

There are two server-side trees:

- [`api/`](../api/) — Vercel serverless functions. **This is the production path.** [easywritingpoem.org](https://www.easywritingpoem.org) routes `/api/*` here.
- [`server/`](../server/) — a standalone Express app (`server/index.ts`, `server/presentation/http/create-app.ts`). Not deployed; useful only if you want to run the API outside Vercel for local debugging.

**Why the split exists:** historical experimentation. The two trees are not kept in sync — `server/` is missing the rate limiter, usage caps, and recent endpoint additions. Treat `api/` as authoritative; do not assume parity.

**Open decision (tracked for future cleanup):** either
1. Delete `server/` entirely and rely on `vercel dev` for local API work, or
2. Move endpoint logic into shared modules and make `api/*.ts` thin Vercel adapters around `createApp()` so dev and prod hit the same code path.

Until that decision is made, **all new endpoint work goes in `api/`**.

---

## 5. Vite + React 18 + TypeScript

**Decision:** Standard Vite SPA with React 18 and TypeScript in strict mode.

**Why:**
- Vite provides fast HMR during development and tree-shaken, hashed production builds.
- React 18's `useTransition` is used for expensive spell-check recalculations to avoid blocking the editor.
- TypeScript `strict: true` throughout prevents entire categories of bugs at compile time.

**Build output:** Static files in `web/dist/`, deployed to Vercel. The API functions in `/api/` are deployed as Vercel Node.js serverless functions.

---

## 6. Per-poem revision snapshots (not git-like history)

**Decision:** Each poem has a list of named snapshots stored in localStorage (`easy-poems:revisions:v2`). Users save snapshots manually; there is no automatic commit history.

**Why:**
- A full git-like history for every keystroke would quickly exhaust the localStorage quota.
- Poets tend to think in discrete drafts ("draft 1", "after workshop feedback"), not in line-level diffs.
- Named snapshots fit naturally in the UI (compare two snapshots side by side with a diff view).

**Limit:** Up to 50 snapshots per poem (`MAX_SNAPSHOTS = 50` in `revision-snapshots.ts`).

---

## 7. No backend database

**Decision:** There is no server-side database. All persistence is client-side (localStorage) with manual JSON export/import.

**Why:**
- Eliminates operational complexity (no database provisioning, migrations, backups).
- Aligns with the offline-first and privacy-preserving goals.
- The JSON export format is human-readable and versionable.

**Future path:** If multi-device sync becomes a requirement, IndexedDB with a lightweight sync layer (e.g., CRDTs) would be the natural next step — the data model is already serializable JSON.

---

## 8. Feature-first source layout

**Decision:** `web/src/` is organized by feature (`draft-library/`, `poem-editor/`, `poem-workshop/`, `spellcheck/`, `writing-tools/`) rather than by layer (`components/`, `hooks/`, `utils/`).

**Why:**
- Co-locates related logic, types, and tests.
- Makes it obvious which module owns each domain concept.
- Reduces cross-cutting imports; each feature exposes a clean public surface.

**Cross-cutting utilities** live in `web/src/shared/` (localStorage wrappers, storage key constants).
