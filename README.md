# easywriting-poem

**A quiet place to write poetry.** Private. Local. No account.

Browser-based poetry workshop. Draft on the left; syllables, meter, rhyme, repeats, and spelling update beside you. Optional AI critique on demand. Nothing leaves your browser unless you ask it to.

**Live:** [easywritingpoem.org](https://www.easywritingpoem.org/)

---

## Highlights

- **Local-first** — drafts, snapshots, goals, and personal dictionary live in `localStorage`. Works offline after first load.
- **Poetry-specific tools** — syllables, meter (CMU dictionary + heuristics), rhyme (strict/near/broad), repetition, poetry-aware spelling.
- **Optional AI** — critique with selectable harshness, line rewrites, idea sparks, theme generation. Project-owned key, no user signup.
- **Calm UI** — no popups, no nags. Tools speak when asked.

Full tool list: [docs/FEATURES.md](docs/FEATURES.md).

---

## Quick start

```sh
cd web
npm install      # postinstall syncs the word list
npm run dev      # Vite dev server on localhost:5173
```

Build, test, AI dev setup, and conventions: [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Docs

| Doc | Purpose |
|-----|---------|
| [docs/FEATURES.md](docs/FEATURES.md) | Full feature list grouped by tool bucket |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Design decisions and rationale |
| [docs/AI_INTEGRATION.md](docs/AI_INTEGRATION.md) | OpenAI endpoint contracts and prompt design |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Product requirements |
| [docs/PRIORITIES.md](docs/PRIORITIES.md) | Roadmap and priorities |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Vercel build, env vars, CSP |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Dev setup, commit conventions, PR flow |
| [SECURITY.md](SECURITY.md) | Privacy posture, AI key handling, reporting issues |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [design/DESIGN.md](design/DESIGN.md) | UX principles, IA, design tokens |

---

## Tech stack

React 18 · TypeScript (strict) · Vite 6 · CodeMirror 6 · Vercel serverless · OpenAI · `localStorage` (no DB).

---

## License

See [LICENSE](LICENSE).
