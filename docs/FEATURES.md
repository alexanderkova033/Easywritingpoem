# Features

Tools panel is grouped into three buckets: **Overview**, **Sound**, **Suggest**. Each maps to a set of tabs.

---

## Overview bucket

| Tab | What it shows |
|-----|---------------|
| **Issues** | AI analysis — overall scores, line-level issues with severity dots, harshness selector (4 personas), post-analysis chat |
| **Spell** | Poetry-aware spelling. Strict / permissive modes. Personal dictionary and per-session ignore list. |
| **Lines** | Per-line syllable counts, meter pattern preview, iambic-fit percentage |
| **Goals** | Word, syllable, rhyme-scheme, form-preset (sonnet, haiku, villanelle, etc.), and custom targets |
| **Snapshots** | Manual + automatic revisions (up to 50 per poem). Named labels. Side-by-side diff. |

---

## Sound bucket

| Tab | What it shows |
|-----|---------------|
| **Meter** | Stress patterns from a bundled CMU pronouncing dictionary with a heuristic fallback for unknown words |
| **Rhyme** | End-rhyme scheme labels (A/B/C…). Strict / near / broad breadth. Per-line color coding in the editor gutter. |
| **Repeats** | Repeated and near-repeated words flagged with line numbers and counts |

---

## Suggest bucket

| Tab | What it shows |
|-----|---------------|
| **Suggest / Ideas** | Continuations, word picks, rhyme help, sparks, and line rewrites with a syllable target |

---

## Outside the tools panel

| Feature | What it does |
|---|---|
| **AI Theme** | Generate a custom background theme from a text prompt |
| **Theme picker** | 22+ built-in themes (light, dusk, ember, ocean, aurora, snow, candle, ripple, firefly, studio, zenith…) |
| **Reading mode** | Distraction-free reader for finished drafts |
| **Sharing** | Export to DOCX, PDF, image, or generate a shareable link |
| **Selection popover** | Define (single word) + AI rewrite (with syllable input) on highlighted text |
| **Command palette** | Keyboard-driven navigation across tabs, drafts, and actions |
| **Hover hints** | Optional inline tooltips for poem-specific terms |
| **Format toolbar** | Bold (`**…**`) and underline (`__…__`) markers rendered as decorations |
| **Format marks** | Visual decorations on `**bold**` and `__underline__` syntax |
| **Word lookup** | Optional in-editor definition popover (toggle in Settings) |
| **First-visit hint** | Minimal info strip for new users |

---

## Local-first behaviour

- All poems, snapshots, goals, settings, personal dictionary, and ignore lists live in `localStorage`.
- After first load, the editor and all local tools work without a network connection.
- The library list is virtualized (TanStack Virtual) so even hundreds of poems scroll smoothly.

---

## AI behaviour

- **Project-owned key.** Users don't sign up or bring their own OpenAI key — one project key serves all traffic.
- **Explicit only.** No AI request fires while typing. Every call is user-triggered.
- **Endpoints** ([api/](../api/)): `analyze`, `suggest`, `chat`, `compare`, `generate-background`. See [AI_INTEGRATION.md](AI_INTEGRATION.md) for contracts.
- **Rate limiting** in-memory per function instance — see [SECURITY.md](../SECURITY.md).

---

## Mobile + iPad

- Backdrop blur disabled on `(hover: none) and (pointer: coarse)` — solid surfaces for perf.
- Background animations and global filters paused on touch devices.
- CodeMirror's heaviest live-update plugins (line-font-scaling, full-doc syllable rebuild on every cursor move) are gated off on touch. All decorations (spell, rhyme, format) still work.
- Mobile tab bar respects `env(safe-area-inset-bottom)`.
- Minimum tap target: 44×44 px.
