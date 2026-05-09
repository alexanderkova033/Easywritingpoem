# Easy-poems — Product requirements

## 1. Vision

Make writing, revising, and understanding poetry faster and clearer through **lightweight writing aids** (spelling, meter, structure) in the browser, with a path to **optional interactive AI feedback** later and **transparent “why this rating / suggestion”** when that ships—not a black box.

## 2. Goals

| Goal | Success signal |
|------|----------------|
| Fast critique | User gets structured feedback in seconds after requesting analysis. |
| Actionable improvement | Feedback names concrete issues (e.g. weak line, cliché risk) and 1–3 improvement paths. |
| Trust | Every major AI judgment is paired with a short rationale the user can disagree with. |
| Writing flow | Corrections and counters update without breaking creative momentum; **re-analysis** after edits is one clear action. |

## 3. Stakeholder decisions (locked)

| Topic | Decision |
|--------|-----------|
| **Platform** | **Website** (browser-first). |
| **Language** | **English only** for poem tools, spellcheck, and UI at launch. |
| **Rating scale** | **1–100** overall, plus **dimensional sub-scores** on the same scale (or clearly defined sub-ranges) so the total score is explainable. |
| **AI tone** | **Not user-configurable.** Single voice: **polite and direct** (respectful, workshop-clear, no fluff). |
| **Poem storage** | **Local only** in the browser (poem library + snapshots); **export** and **JSON backup** supported. |
| **Core loop (shipping)** | **Local tools + revise + export/backup**; optional external feedback (e.g. ChatGPT in another tab). |
| **Core loop (optional AI)** | When enabled: **reads feedback → edits → runs analysis again** on the new text. |
| **Writing tools** | **Maximize useful built-in tools** (syllables, counts, rhyme/sound/meter heuristics, etc.). |
| **AI stack** | **Deferred** (optional). Planned: **OpenAI** via **`server/`** per [AI_INTEGRATION.md](./AI_INTEGRATION.md). |

## 4. Assumptions

- **Multiple drafts** in one browser (poem library); user picks the active draft.
- **Optional in-app AI** would send text to a **remote LLM API** only when that feature is on; **drafts** stay on device otherwise.
- Internationalization of UI/other languages is **out of scope** until after English MVP.

## 5. AI integration (optional / deferred)

The **shipping** web app is **static** and does **not** call OpenAI. When you choose to add critique:

- **Provider (planned):** OpenAI.
- **Models:** **`gpt-5-mini`** by default; **`OPENAI_MODEL=gpt-5`** for more depth.
- **Proxy:** **`server/`** would expose **`POST /api/analyze`**; **API key stays on the server**.
- **Contract:** [AI_INTEGRATION.md](./AI_INTEGRATION.md) (1–100 scores, issues with line ranges, improvements).

**Alternatives later:** Anthropic, Gemini, or a local LLM; keep the same response contract for the frontend.

## 6. User stories (summary)

- As a poet, I want **spell/grammar suggestions** that respect poetic license (e.g. dialect, invented words) so I am not forced into “correct” prose.
- As a poet, I want **syllable counts** and **other sound/structure hints** per line so I can tune form.
- As a poet, I want **several drafts** in the same browser and a way to **back them up** so I do not lose work.
- As a poet, I want **AI to highlight what it dislikes** (lines, phrases, or patterns) and **suggest directions**, not only a single score—**when** in-app AI is enabled.
- As a poet, I want an **overall 1–100 rating** with **dimensions** when using AI critique.
- As a poet, I want to **edit after feedback** and **run analysis again** on the latest version without losing my draft locally—**when** AI is enabled.

## 7. Functional requirements

### 7.1 Poem editor & document model

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01 | Editor with **title** and **line-based** poem body; optional metadata (e.g. form) as needed. | Must |
| FR-02 | **Autosave** to **local** persistence; recovery if the tab closes. | Must |
| FR-02b | **Multiple poems** in one browser (library); **per-poem** revision snapshots; **import/export workshop backup** (JSON). | Must |
| FR-03 | **Line-based addressing** so AI and tools refer to “line N” consistently. | Must |
| FR-04 | User may choose among **multiple page backgrounds** and **font presets** (poem text vs UI); choices are stored **locally** and apply on load. | Should |

### 7.2 Spelling and language assistance

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-10 | **Suggestive spelling** (underlines + suggestions); user can **ignore / add to personal dictionary** (local). | Must |
| FR-11 | **Poetic exceptions**: do not auto-correct without confirmation; optional “permissive” vs “strict” spell profile. | Should |
| FR-12 | **English** dictionaries and heuristics for launch. | Must |

### 7.3 Structural & quantitative tools

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-20 | **Syllable counter** per line (and stanza/total where useful). | Must |
| FR-21 | **Word count** and **character count** (including per line if helpful). | Must |
| FR-22 | **Rhyme / assonance / consonance hints** (heuristic / dictionary-backed where possible). | Should |
| FR-23 | **Stress / meter hints** for English (e.g. pattern visualization per line): use **dictionary-backed stress** (CMU-style pronunciations) for words covered by the shipped stress list, with **heuristic fallback** for unknown or invented words; label source in UI. Accuracy is still bounded by NLP/lexicon coverage. | Should |
| FR-24 | Additional **high-value, low-ambiguity** tools as identified in implementation (e.g. line length stats, repeated word highlights). | Could |

### 7.4 Interactive AI analysis (not in default static build)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-30 | User explicitly **runs analysis** (button); optional **debounced auto-run** after idle (toggle later). | Future (when AI on) |
| FR-31 | Output includes **issues**: what the model flags, tied to **lines or spans**. | Future |
| FR-32 | Per issue: **short rationale** + **1–3 improvement directions**; voice **polite and direct**. | Future |
| FR-33 | **Overall score 1–100** plus **dimensional scores 1–100** (e.g. imagery, musicality, originality, clarity)—definitions stable in prompt/UI. | Future |
| FR-34 | After edits, user can **re-run analysis** on current text; show **which version** or **timestamp** of last run to avoid confusion. | Future |
| FR-35 | **Expand/collapse** issues; **click feedback → jump to line** in editor. | Future |
| FR-36 | **Regenerate** alternative phrasing for one issue (optional). | Could |

### 7.5 Privacy, safety, and content

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-40 | Clear copy: **drafts stay local** by default; if **Analyze** exists, text goes to **your backend** then **OpenAI**—cite terms in UI. | Must |
| FR-41 | When AI is on: align with **OpenAI** on **data retention**; prefer minimal retention if available. | Should |
| FR-42 | **Content policy** for harmful requests (refusal, safe messaging)—define before public launch. | Should |

### 7.6 Future: poem commentary and community (not in local-first MVP)

Poem-level **comments** or **critiques** between users (similar in spirit to large poetry communities such as AllPoetry) require **identity**, **server-side storage**, **moderation**, and **abuse handling**. They are **out of scope** until a dedicated community phase; see also §9, §11, and [PRIORITIES.md](./PRIORITIES.md).

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-50 | **Comment threads** (or structured critique posts) per **shared/published** poem; author controls visibility (e.g. public, link-only, private group). | Future |
| FR-51 | **Notifications** for new comments or replies (**opt-in**; frequency and channel TBD). | Future |
| FR-52 | **Block** and **report** for comments/users; operator **moderation** workflow (queue, removal, appeals TBD). | Future |
| FR-53 | **Workshop export and JSON backup** exclude third-party comments **by default**; optional include only with explicit user consent. | Future |
| FR-54 | Optional **structured critique** prompts (e.g. what works, what to sharpen, encouragement)—aligned with healthy workshop norms. | Could |

## 8. Non-functional requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-01 | Analysis latency (when AI exists; typical short poem) | Under ~10–30 s P95, or streaming partial results |
| NFR-02 | Editor responsiveness | Typing stays smooth; heavy work off main thread or debounced |
| NFR-03 | Accessibility | Keyboard nav, readable contrast, screen reader for core panels |
| NFR-05 | Senior-friendly onboarding | Provide a **plain-language**, **large-text** guide that covers the core workflow (drafts, tools, reading view) and emphasizes **backup/export** and restore steps |
| NFR-04 | Future i18n | English-only UI now; avoid hard-coding strings in a way that blocks later translation |

## 9. Out of scope (initial release)

- User accounts and **cloud sync** of poems.
- **Automatic** cloud backup (manual JSON backup and per-poem export are supported).
- Full collaborative real-time co-editing.
- Paid marketplace for poems.
- Training custom models on user corpora.
- Non-English poem tooling and UI.

## 10. Open decisions (remaining)

- **Ops** for `server/` and APIs: CORS allowlist for the website origin, monitoring, **budget / rate limits** per IP or per deploy (optional guardrails).
- **`gpt-5-mini` vs `gpt-5`** per environment—validate with real poems.

## 11. Future exploration (not committed)

**Poem commentary:** see **§7.6** (FR-50–FR-54) for threaded comments/critiques, notifications, moderation, and export boundaries.

Possible later direction: **community poems** with **anonymous ratings** so readers can engage with others’ work, while authors control **whether they see ratings** (e.g. submit for community feedback only, blind scoring until a chosen moment, or never show the author their own aggregate—exact UX TBD).

Implications to resolve before building:

| Topic | Notes |
|--------|--------|
| **Accounts / identity** | Anonymous *to other users* still usually needs sign-in or device-bound tokens for abuse prevention and consent records; legal/privacy copy must match reality. |
| **“AI learns”** | Default OpenAI API usage does **not** mean the public model “learns” from your users’ poems. Product-side “learning” typically means **your** stored data (with consent) used for **RAG**, **analytics**, or **separate fine-tuning**—each with different cost, quality, and policy requirements. |
| **Consent & retention** | Opt-in to share text for community or model improvement; retention windows; right to withdraw; alignment with provider and regional privacy rules. |
| **Safety** | Moderation, reporting, and rules for published/shared content. |

Until this is scoped, it remains **out of scope** for the English local-first MVP in §9.

---

*Version: 0.5 — Future commentary (§7.6) + community/rating exploration (§11); OpenAI + proxy (see [AI_INTEGRATION.md](./AI_INTEGRATION.md))*
