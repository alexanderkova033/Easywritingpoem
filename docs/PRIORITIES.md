# Demand & delivery priorities (MVP → later)

This document turns [REQUIREMENTS.md](./REQUIREMENTS.md) into **what to build first**. **Current shipped focus:** English-only **local workshop**—multiple drafts, writing tools, snapshots, export, and backup—**without** built-in paid AI. Optional **ChatGPT** (external tab) is linked from the UI.

Stakeholder choices that still apply: **website**, **English only**, **local poem storage**, **maximize writing tools**. **Deferred:** in-app **1–100 AI analysis** and server-side OpenAI until/unless you opt in to cost and operations (see [AI_INTEGRATION.md](./AI_INTEGRATION.md)).

## Core user flow (current)

1. Pick or create a **draft** in the browser → **local autosave** (poem library + per-poem snapshots).
2. Use **tools** while writing: syllables, line table, approximate **stress/meter**, rhyme/sound hints, repeats (separate tab under Sound), spelling, plans, publication checklist.
3. **Export** single poem (.txt / .md / .docx) or **backup** all drafts + snapshots as JSON; **import** backups to merge poems in.
4. For human or third-party AI feedback: **copy/export** and paste where you choose (e.g. linked ChatGPT).

## MoSCoW (aligned with shipping app)

### Must (delivered in tools-first MVP)

- Poem editor with line structure, title, optional form note, **local persistence** (multiple drafts).
- Syllable estimates, word/character counts, line table with **jump to line**.
- Suggestive English spelling with ignore / personal dictionary (local); **poetry-friendly vs strict** modes.
- **Revision snapshots** scoped to the active poem; compare and restore.
- **Plans** and **publication checklist** (heuristic).
- **Export** poem files; **workshop backup** import/export (JSON).
- Privacy copy: drafts and tools stay in the browser unless the user exports/copies.

### Should (next)

- Jump from **more** tool hits to lines (ongoing polish).
- Publish a **senior-friendly guide** (plain language, large text, step-by-step): how to create/open drafts, use Commands, enter reading view, and—most importantly—**export a backup (JSON)** and restore it.
- Richer **meter** (dictionary-backed stress) if you add data or a library—still labeled approximate.
- Optional **in-app AI** via `server/` proxy when budget/ops allow ([AI_INTEGRATION.md](./AI_INTEGRATION.md)).

### Could

- Debounced or streaming **AI** results; regenerate one suggestion.
- Reading-time, stanza grouping, or other low-ambiguity stats.
- **Future / community:** poem pages with **threaded comments or critiques** (e.g. AllPoetry-style exchange), optional structured critique prompts, **moderation** and reporting—**only after** accounts, backend storage, and abuse-handling design.

### Won’t (for now)

- Accounts and **cloud sync** in the **local-first MVP** (backups remain manual JSON + export). A later **community phase** may add accounts for comments, publishing, or sync by explicit product decision.
- Real-time multi-user editing.
- Non-English UI and poem tooling at launch.

## Rough phases

| Phase | Focus |
|-------|--------|
| **Done (tools)** | Editor + multi-draft library + autosave + syllables + lines + meter (heuristic) + rhyme + repeats + spell + plans + checklist + snapshots + export + backup |
| **Next** | Tool polish, optional AI via server when desired |
| **Later** | Streaming AI, advanced meter data |
| **Future (community)** | Accounts, optional publish/share, **comments or critiques on poems**, moderation—see [REQUIREMENTS.md](./REQUIREMENTS.md) §7.6 |

## Success metrics (tools-first)

- Time from open to first useful **local** insight (stats, spell, line jump).
- Users who **switch drafts** or **save snapshots** while revising.
- Users who **export or backup** before closing the tab.

---

*Version: 0.5 — tools-first MVP; AI optional / deferred; future poem commentary (Could / Future phase)*
