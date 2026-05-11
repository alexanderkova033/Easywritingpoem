# Design

UX and visual design artifacts for easywriting-poem. Engineering, design, and stakeholders share this folder.

---

## Folder structure

| Folder | Purpose |
|--------|---------|
| `flows/` | User flows: first-visit, draft → analyze → revise, snapshot compare, AI suggest loop |
| `wireframes/` | Low-fi layouts (workshop shell, tools panel, mobile tab bar, reading mode) |
| `mockups/` | Hi-fi screens — Figma exports or links |
| `components/` | Design tokens (color, type, spacing), component specs |
| `themes/` | Theme palettes (light, dusk, aurora, ocean, ember, etc.) and AI-generated backdrop swatches |
| `research/` | Poet interviews, competitive review, usability notes |

Add a `_index.md` inside each subfolder listing the artifacts and their status.

---

## Product principles

1. **Quiet by default.** No suggestion, popup, or animation that interrupts the writer mid-line. Tools live beside the editor and only speak when asked.
2. **Privacy is visible.** Local-only storage is a feature, not a footnote. The UI must signal "this is on your machine" without nagging.
3. **Poetry-specific.** Syllable counts, meter, rhyme breadth, and repeats are first-class — not bolted-on add-ons.
4. **AI is a guest, not a host.** AI suggestions and critiques are optional, gated, and clearly marked as machine output. The poet's voice leads.
5. **Calm aesthetics.** Long-form drift backgrounds, soft contrast, generous line-height. The page should feel like a notebook, not a dashboard.

---

## Current information architecture

```
Landing
 └─ "A quiet place to write poetry"
    └─ Open workshop → Workshop shell
                        ├─ Topbar (search, share, snapshots, settings)
                        ├─ Editor (CodeMirror, format toolbar, selection popover)
                        ├─ Rhyme ribbons (right gutter, end-rhyme labels)
                        ├─ Tools panel (3 buckets):
                        │     Overview  → Issues, Spell, Lines, Goals, Snapshots
                        │     Sound     → Meter, Rhyme, Repeats
                        │     Suggest   → Ideas / line rewrites
                        ├─ Mobile tab bar (collapsed tools, bottom)
                        └─ Modals: Library, Snapshots, Compare, Share,
                                   Reading mode, Settings, Style, Theme
```

---

## Open design questions

- **AI surface.** Panel + ribbons in the gutter + selection popover. Risk of fragmentation — should one be canonical?
- **Reading mode entry.** Currently a topbar button. Worth a keyboard shortcut + hint?
- **First-visit guidance.** SpotlightTour vs single info strip — current `FirstVisitHint` is the strip. Confirm with research before adding back the tour.
- **Bucket labels.** "Suggest" bucket holds a single tab; merge into Overview or keep as discoverable shortcut?

---

## Design tokens (current)

Defined in `web/src/app/index.css` as CSS custom properties:

- **Color:** `--bg`, `--surface`, `--surface-2`, `--text`, `--muted`, `--accent`, `--accent-soft`, `--border`
- **Ambient layers:** `--ambient-a/b/c`, `--after-corner`, `--after-zenith-*`
- **Font:** `--font-ui` (system sans), `--font-poem` (serif), `--font-mono`
- **Radius:** `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`
- **Themes:** 22+ named themes (light, dusk, ember, ocean, aurora, snow, candle, ripple, firefly, studio, zenith…)

Any new theme must define every `--ambient-*` and `--after-*` variable plus an `animation:` for the backdrop layer.

---

## Mobile + iPad guidance

- Backdrop blur is disabled on `(hover: none) and (pointer: coarse)` — use opaque surfaces.
- Background animations stop on touch devices (perf — see [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)).
- Tap targets: minimum 44×44 px.
- Mobile tab bar respects `env(safe-area-inset-bottom)`.

---

## External tools

- **Figma:** add share link here when ready, plus naming convention (`Workshop / Editor-default`, `Workshop / Tools-rhyme`, etc.).
- **Screenshots:** keep under `mockups/screens/` with date prefix (`2026-05-11-tools-panel.png`).

---

*This README is the index. Add artifacts as design progresses; keep links here.*
