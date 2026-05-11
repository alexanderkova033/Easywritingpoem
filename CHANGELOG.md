# Changelog

All notable user-visible changes to easywriting-poem.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/) once a first tagged release exists.

---

## Unreleased

### Network / first-load
- `<link rel="dns-prefetch">` for Datamuse, dictionaryapi.dev, Vercel analytics and insights origins — warms DNS/TLS before the first AI or rhyme/define call.
- Lazy-load `ReadingModeModal`, `ShareModal`, `ViewSharedPoem`, and `BackgroundPicker` via `React.lazy`. Each ships its own dynamic chunk; the initial workshop bundle drops ~200–300 KB.
- Tightened Vite `manualChunks` so lazy-loaded modules don't get re-merged into the eager `workshop-tools` chunk.

### Off-main-thread
- New Web Worker (`workshop/analysis/heavy-analysis-worker.ts`) + `useHeavyAnalysis` hook. Repetition analysis (heaviest per-keystroke pass) now runs off the main thread. Race protection via request ids; synchronous main-thread fallback when `Worker` isn't available.

### Refactor
- Extracted helpers, leaf components, goal cards, and repetition cards from `WorkshopToolPanels.tsx` (2728 → 1908 lines) into:
  - `analysis/tools/helpers.tsx` — regex, meter-source labels, jump labels
  - `analysis/tools/shared.tsx` — `EmptyState`, `NumberInput`, `SoftPill`, `JumpLineList`, `NoLinesYetHint`
  - `analysis/tools/GoalCards.tsx` — `MetricGoalCard`, `SyllableCapCard`, `RhymeSchemeCard`
  - `analysis/tools/RepetitionCards.tsx` — `RepeatedWordCard`, `PhraseRepeatCard`, `EdgeRepeatCard`, `RepetitionSummary`
- Per-tab panel branches still inside `WorkshopToolPanels.tsx`; their split deferred to a focused session.

### Performance
- Disable backdrop-filter blur on touch devices for the mobile tab bar, drawer, sidebar, and topbar — eliminates iPad scroll jank.
- Pause always-on background animations and the body-wide saturate/brightness filter on touch devices.
- Gate CodeMirror's per-line font-scaling plugin off on touch — biggest source of typing lag on iPad.
- Skip syllable widget rebuilds on cursor moves (touch only); rebuild still fires on document changes.
- Remove redundant 500ms polling interval in `AiLineRibbons` — scroll/resize/ResizeObserver already cover position updates.
- Add `passive: true` to scroll/resize listeners in `HoverHintsContext`.
- Panel splitter drag: write to CSS variable inside `requestAnimationFrame`; defer React state update + persistence until pointerup. Stops the full workshop tree re-rendering on every pointermove frame.
- Tune debounces: body→React 100→180ms (desktop) / 280ms (touch); spell analysis 320→600ms on touch. Halves render frequency during continuous typing without making feedback feel sluggish.

### Docs
- Split the root `README.md` into focused docs: `CONTRIBUTING.md`, `SECURITY.md`, `docs/FEATURES.md`, `docs/DEPLOYMENT.md`, `CHANGELOG.md`.
- Renamed `design/README.md` to `design/DESIGN.md` to remove the duplicate README name.
- Added GitHub issue templates.
- Corrected stale tool-panel listing (now 3 buckets: Overview / Sound / Suggest).
- Clarified that AI calls use a project-owned OpenAI key (no user signup or BYO key).

### Cleanup
- Removed dead `.topbar-title` CSS block.

---

*Earlier history is recorded in git log.*
