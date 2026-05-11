# Contributing

Thanks for considering a contribution. This guide covers local setup, conventions, and the PR flow.

---

## Local setup

```sh
git clone <fork-url>
cd Easy-poems/web
npm install      # postinstall syncs the word list
npm run dev      # Vite dev server on localhost:5173
```

Node 20+ recommended.

### AI features locally

Production uses a single project-owned `OPENAI_API_KEY` set in Vercel env vars — users do not bring their own key.

For local dev:
1. Drop `OPENAI_API_KEY=sk-...` into a `.env` at the **repo root**.
2. Run `vercel dev` from the repo root (not `web/`) so `/api/*` serverless routes are served.
3. Without the key, AI panels show a "not configured" notice. Everything else still works.

### Regenerating the stress lexicon

If `web/public/wordlist-en.txt` changes:
```sh
cd web && npm run generate:cmu-stress
```
The build fails with instructions if `cmu-stress.txt` is older than the word list.

---

## Project layout

```
easywriting-poem/
├── api/                       # Vercel serverless functions (OpenAI proxy)
│   ├── analyze.ts             # Poem critique with harshness personas
│   ├── suggest.ts             # Continue / words / rhyme / spark / line
│   ├── chat.ts                # Post-analysis chat
│   ├── compare.ts             # Snapshot comparison
│   ├── generate-background.ts # AI theme generation
│   ├── _openai.ts             # Shared OpenAI client + retries
│   └── _rate-limit.ts         # In-memory rate limiting
├── web/                       # Frontend (Vite + React)
│   └── src/
│       ├── app/               # Root component, global CSS, themes
│       ├── landing/           # Landing page
│       ├── workshop/          # Main workshop UI
│       │   ├── shell/         # Topbar, layout, drawer, main shell
│       │   ├── editor/        # CodeMirror config + extensions
│       │   ├── analysis/      # AI analysis, ribbons, chat, ideas
│       │   ├── meter/         # Meter heuristics + display
│       │   ├── rhyme/         # Rhyme grouping
│       │   ├── goals/         # Writing goals
│       │   ├── library/       # Poem list, virtualized
│       │   ├── sharing/       # Export (DOCX / PDF / image / link)
│       │   ├── reading/       # Reading-mode modal
│       │   ├── appearance/    # Themes + AI background generator
│       │   ├── palette/       # Command palette
│       │   ├── vocabulary/    # Word lookup + dictionary
│       │   ├── voice/         # Speech / TTS
│       │   ├── hints/         # Hover hints context
│       │   └── tour/          # First-visit spotlight tour
│       ├── spellcheck/        # Spell engine + personal dictionary
│       └── shared/            # Storage keys, platform utils, toast
├── docs/                      # Architecture, requirements, priorities
├── design/                    # UX artifacts (flows, mockups, research)
├── server/                    # Legacy Express proxy (kept for reference)
└── vercel.json                # CSP headers + rewrites
```

Source layout is **feature-first**, not layer-first. Cross-cutting helpers live in `web/src/shared/`.

---

## Scripts

```sh
npm run dev        # Vite dev server
npm run build      # type-check + CMU stress check + vite build
npm run preview    # serve the built output
npm test           # vitest unit tests (run-once)
npm run test:watch # vitest watch mode
npm run test:e2e   # playwright end-to-end
npm run test:e2e:ui  # playwright in UI mode
npm run lint       # eslint
```

`npm run build` must pass before merging — it runs type-check and lexicon-freshness check.

---

## Code conventions

- **TypeScript strict** is non-negotiable. No `any` without a comment explaining why.
- **Feature folders** own their types, tests, and styles. Avoid cross-feature imports through deep paths — expose a clean public surface.
- **No new top-level CSS files** — extend the existing token system in `web/src/app/index.css`.
- **Comments:** explain WHY for non-obvious code. Never describe WHAT — names should do that.
- **Decorations on the editor:** any new CodeMirror extension that runs on every doc change must respect the `IS_TOUCH_DEVICE` gating pattern in [PoemBodyEditor.tsx](web/src/workshop/editor/PoemBodyEditor.tsx) or be designed to be cheap on iPad.

---

## Commit messages

Conventional-commit prefixes preferred:

- `feat:` user-visible new feature
- `fix:` bug fix
- `perf:` performance improvement
- `refactor:` non-behavioural code change
- `docs:` documentation only
- `test:` test scaffolding
- `chore:` build / tooling

Subject ≤ 70 chars. Body explains *why*, not *what*.

---

## PR flow

1. Branch from `main`.
2. Keep PRs small and focused. One concern per PR.
3. Run `npm run build` + `npm test` locally before pushing.
4. Update [CHANGELOG.md](CHANGELOG.md) under `## Unreleased` if the change is user-visible.
5. If the change touches the editor decoration pipeline, AI prompts, or storage schema, flag it in the PR description.

---

## Testing

- **Unit:** `vitest` with `jsdom`. Co-locate `*.test.ts` next to source.
- **E2E:** `playwright` under `web/tests/`. Hit the dev server, exercise the golden path.
- **Manual mobile:** if you touch CodeMirror, the tools panel, or topbar, test on a real iPad or `(pointer: coarse)` emulation — the touch perf gates assume this is verified.

---

## Reporting bugs

See `.github/ISSUE_TEMPLATE/bug_report.md`. Include browser, OS, and reproduction steps. For security-sensitive issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
