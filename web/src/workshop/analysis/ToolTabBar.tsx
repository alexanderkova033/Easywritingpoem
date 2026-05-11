import type { JSX, ReactNode } from "react";
import type { ToolTab } from "@/workshop/shell/workshop-helpers";

function IconTabIssues() {
  return (
    <svg className="tool-tab-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 7v6m0 3.5h.01M9.8 4.5h4.4L18 8.3v7.4l-3.8 3.8H9.8L6 15.7V8.3l3.8-3.8z"
      />
    </svg>
  );
}


function IconTabGoals() {
  return (
    <svg className="tool-tab-svg" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.65" />
      <circle cx="12" cy="12" r="3.25" fill="none" stroke="currentColor" strokeWidth="1.65" />
    </svg>
  );
}

function IconTabLines() {
  return (
    <svg className="tool-tab-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinejoin="round"
        d="M5 6.5h3v3H5zm6 0h9m-9 5.5h9m-9 5.5h9M5 15v3h3v-3z"
      />
    </svg>
  );
}

function IconTabMeter() {
  return (
    <svg className="tool-tab-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 17.5V8.5l3 5 3-7 3 5 3-5v9"
      />
    </svg>
  );
}

function IconTabRhyme() {
  return (
    <svg className="tool-tab-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        d="M8.3 10.2a3.6 3.6 0 104.8 4.4M15.7 13.8a3.6 3.6 0 10-4.8-4.4"
      />
    </svg>
  );
}

function IconTabRepeat() {
  return (
    <svg className="tool-tab-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16 5.5h3v3M8 18.5H5v-3m0-5.5a7.5 7.5 0 0112.85-5.3M19 12a7.5 7.5 0 01-12.85 5.3"
      />
    </svg>
  );
}

function IconTabSpell() {
  return (
    <svg className="tool-tab-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 18.5V6.5l5.5 3.2L16 6.5v12M11 9.2V19"
      />
    </svg>
  );
}

function IconTabSnapshots() {
  return (
    <svg className="tool-tab-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.5 7.5h4l1-2h5l1 2h2.5a1 1 0 011 1v10a1 1 0 01-1 1h-15a1 1 0 01-1-1v-10a1 1 0 011-1z"
      />
      <circle cx="12" cy="13.5" r="3" fill="none" stroke="currentColor" strokeWidth="1.65" />
    </svg>
  );
}

function IconTabSuggest() {
  return (
    <svg className="tool-tab-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 18h6M10 21h4M12 3a6 6 0 014.5 10c.6.7 1 1.6 1 2.5V17H6.5v-1.5c0-.9.4-1.8 1-2.5A6 6 0 0112 3z"
      />
    </svg>
  );
}

/** Order tuned for flow: triage → spelling → line work → polish → versions → external help */
export const TOOL_TABS: {
  id: ToolTab;
  label: string;
  desc: string;
  Icon: () => JSX.Element;
}[] = [
  { id: "issues",    label: "Queue",     desc: "Spelling flags, checklist gaps & goal warnings in one list",   Icon: IconTabIssues },
  { id: "spell",     label: "Spell",     desc: "Find and fix misspelled words",                                Icon: IconTabSpell },
  { id: "lines",     label: "Lines",     desc: "Per-line syllable, word & character counts",                   Icon: IconTabLines },
  { id: "meter",     label: "Meter",     desc: "Stress patterns and iambic-fit per line",                      Icon: IconTabMeter },
  { id: "rhyme",     label: "Rhyme",     desc: "End-rhyme clusters and sound patterns",                        Icon: IconTabRhyme },
  { id: "repeat",    label: "Repeats",   desc: "Words that appear more than once",                             Icon: IconTabRepeat },
  { id: "goals",     label: "Goals",     desc: "Set targets for line, word & syllable counts",                 Icon: IconTabGoals },
  { id: "snapshots", label: "Snapshots", desc: "Save and compare draft snapshots",                             Icon: IconTabSnapshots },
  { id: "suggest",   label: "Ideas",     desc: "AI suggestions when you\u2019re stuck",                        Icon: IconTabSuggest },
];

export function LiveSectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="tool-heading-live">
      <span className="live-dot" aria-hidden />
      <span className="tool-heading-live-text">{children}</span>
      <span className="live-badge">From draft</span>
    </h3>
  );
}
