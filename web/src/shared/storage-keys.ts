/** All localStorage/sessionStorage keys used by Easy-poems, in one place. */

// Draft library
export const STORAGE_KEY_LIBRARY = "easy-poems:library:v1";

// Single-slot draft (legacy migration path)
export const STORAGE_KEY_DRAFT = "easy-poems:draft:v2";
export const STORAGE_KEY_DRAFT_LEGACY_V1 = "easy-poems:draft:v1";

// Revision snapshots
/** Legacy global snapshot store (pre-library) */
export const STORAGE_KEY_REVISIONS_V1 = "easy-poems:revisions:v1";
/** Per-poem snapshot map */
export const STORAGE_KEY_REVISIONS_V2 = "easy-poems:revisions:v2";

// Spell check
export const STORAGE_KEY_SPELL_DICT = "easy-poems:spell:personal:v1";
export const STORAGE_KEY_SPELL_IGNORE_SESSION = "easy-poems:spell:ignore-session:v1";

// Workshop metadata
/** Legacy global goals store (pre per-poem) */
export const STORAGE_KEY_GOALS = "easy-poems:goals:v1";
/** Per-poem goals map */
export const STORAGE_KEY_GOALS_V2 = "easy-poems:goals:v2";
export const STORAGE_KEY_IDEAS_NOTEBOOK = "easy-poems:ideas-notebook:v1";
export const STORAGE_KEY_FOCUS_NOTES_POS = "easy-poems:focus-notes-pos:v1";
export const STORAGE_KEY_LIBRARY_META = "easy-poems:libraryMeta:v1";
export const STORAGE_KEY_APPEARANCE = "easy-poems:appearance:v1";
export const STORAGE_KEY_FIRST_HINT_DISMISSED = "easy-poems:first-hint-dismissed";

// Session / UI preferences
export const STORAGE_KEY_LAST_TOOL_TAB = "easy-poems:lastToolTab";
export const STORAGE_KEY_LAST_EXPORT_AT = "easy-poems:lastExportAt";
export const STORAGE_KEY_SHOW_LINE_SYLLABLES = "easy-poems:showLineSyllables";
export const STORAGE_KEY_SHOW_RHYME_SCHEME = "easy-poems:showRhymeScheme";
export const STORAGE_KEY_RHYME_SCHEME_BREADTH = "easy-poems:rhymeSchemeBreadth";
/** Delayed “what does this do?” bubbles on buttons (fine-pointer / hover devices). */
export const STORAGE_KEY_UI_HOVER_HINTS = "easy-poems:uiHoverHints";

// Reading mode
export const STORAGE_KEY_READING_FONT_SIZE = "easy-poems:readingFontSize";
export const STORAGE_KEY_READING_THEME = "easy-poems:readingTheme";
export const STORAGE_KEY_READING_LINE_NUMBERS = "easy-poems:readingLineNumbers";
export const STORAGE_KEY_READING_DROP_CAP = "easy-poems:readingDropCap";
export const STORAGE_KEY_WORD_LOOKUP_ENABLED = "easy-poems:wordLookupEnabled";

// Vocabulary
export const STORAGE_KEY_STARRED_WORDS = "easy-poems:starred-words:v1";
export const STORAGE_KEY_LOOKED_UP_WORDS = "easy-poems:looked-up-words:v1";

// AI settings
export const STORAGE_KEY_AI_SCORING_ENABLED = "easy-poems:ai-scoring-enabled";
/** Draft mode: hides the score AND the issues list for a quieter, judgment-free read. */
export const STORAGE_KEY_AI_DRAFT_MODE = "easy-poems:ai-draft-mode";

// Landing page
export const STORAGE_KEY_LANDING_DISMISSED = "easy-poems:landing-dismissed";

// Eagerly fetch all lazy code-split chunks at startup so the app keeps
// working if the user goes offline before opening rarely-used panels.
export const STORAGE_KEY_PRELOAD_ALL_CHUNKS = "easy-poems:preloadAllChunks";

// Onboarding
export const STORAGE_KEY_SAMPLE_DISMISSED = "easy-poems:sample-dismissed";
export const STORAGE_KEY_TABS_EXPANDED = "easy-poems:tabs-expanded";
export const STORAGE_KEY_MOBILE_NUDGE_DISMISSED = "easy-poems:mobile-nudge-dismissed";

// Layout
export const STORAGE_KEY_TOOLS_WIDTH = "easy-poems:tools-panel-width";
export const STORAGE_KEY_TOOLS_RAIL_WIDTH = "easy-poems:tools-rail-width";
export const STORAGE_KEY_RAIL_WIDTH = "easy-poems:rail-width";
