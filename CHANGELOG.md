# Changelog

All notable user-visible changes to easywriting-poem.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/) once a first tagged release exists.

---

## Unreleased

### Performance
- Disable backdrop-filter blur on touch devices for the mobile tab bar, drawer, sidebar, and topbar — eliminates iPad scroll jank.
- Pause always-on background animations and the body-wide saturate/brightness filter on touch devices.
- Gate CodeMirror's per-line font-scaling plugin off on touch — biggest source of typing lag on iPad.
- Skip syllable widget rebuilds on cursor moves (touch only); rebuild still fires on document changes.
- Remove redundant 500ms polling interval in `AiLineRibbons` — scroll/resize/ResizeObserver already cover position updates.
- Add `passive: true` to scroll/resize listeners in `HoverHintsContext`.

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
