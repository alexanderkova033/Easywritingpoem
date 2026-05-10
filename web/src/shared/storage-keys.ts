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
export const STORAGE_KEY_GOALS = "easy-poems:goals:v1";
export const STORAGE_KEY_IDEAS_NOTEBOOK = "easy-poems:ideas-notebook:v1";
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
export const STORAGE_KEY_WORD_LOOKUP_ENABLED = "easy-poems:wordLookupEnabled";

// AI settings
export const STORAGE_KEY_AI_MODEL = "ep_openai_model";
export const STORAGE_KEY_AI_SCORING_ENABLED = "easy-poems:ai-scoring-enabled";

// Landing page
export const STORAGE_KEY_LANDING_DISMISSED = "easy-poems:landing-dismissed";

// Onboarding
export const STORAGE_KEY_SAMPLE_DISMISSED = "easy-poems:sample-dismissed";
export const STORAGE_KEY_TABS_EXPANDED = "easy-poems:tabs-expanded";
export const STORAGE_KEY_MOBILE_NUDGE_DISMISSED = "easy-poems:mobile-nudge-dismissed";

// Layout
export const STORAGE_KEY_TOOLS_WIDTH = "easy-poems:tools-panel-width";
export const STORAGE_KEY_RAIL_WIDTH = "easy-poems:rail-width";
