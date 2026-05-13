import { useMemo } from "react";
import type { SpellHit } from "@/spellcheck/scan";
import type { GoalEvaluation } from "@/workshop/goals/metrics";
import type { ChecklistItem } from "@/workshop/analysis/publication-checklist";
import type { ClicheHit } from "@/workshop/analysis/cliche-scan";
import type { ToolTab } from "@/workshop/shell/workshop-helpers";
import { EmptyState, JumpLineList } from "@/workshop/analysis/tools/shared";
import { checklistJumpLabel } from "@/workshop/analysis/tools/helpers";
import { LiveSectionTitle } from "../ToolTabBar";

export interface IssuesPanelProps {
  wordlist: Set<string> | null;
  goalEvaluation: GoalEvaluation;
  publication: { items: ChecklistItem[]; tips: string[] };
  spellHits: SpellHit[];
  clicheHits: ClicheHit[];
  heavyToolsStale: boolean;
  goToLine: (line1Based: number) => void;
  goToSpellHitAt: (hit: SpellHit) => void;
  applySpellSuggestion: (hit: SpellHit, replacement: string) => boolean;
  applySpellSuggestionAll: (normalized: string, replacement: string) => boolean;
  refreshSpell: () => void;
  onOpenToolTab: (tab: ToolTab) => void;
  focusPoemTitle: () => void;
}

type QueueSeverity = "now" | "soon" | "optional";
interface QueueIssue {
  id: string;
  severity: QueueSeverity;
  category: "spell" | "checklist" | "goal" | "cliche";
  categoryLabel: string;
  title: string;
  detail?: string;
  line?: number;
  onJump?: () => void;
  primary?: { label: string; onClick: () => void; disabled?: boolean };
}

export function IssuesPanel({
  wordlist,
  goalEvaluation,
  publication,
  spellHits,
  clicheHits,
  heavyToolsStale,
  goToLine,
  goToSpellHitAt,
  applySpellSuggestion,
  applySpellSuggestionAll,
  refreshSpell,
  onOpenToolTab,
  focusPoemTitle,
}: IssuesPanelProps) {
  const openChecklistItems = publication.items.filter((i) => !i.done);

  const queueIssues = useMemo<QueueIssue[]>(() => {
    const list: QueueIssue[] = [];
    for (const w of goalEvaluation.warnings) {
      list.push({
        id: `goal:${w}`,
        severity: "now",
        category: "goal",
        categoryLabel: "Goal",
        title: w,
        primary: {
          label: "Open Goals",
          onClick: () => onOpenToolTab("goals"),
        },
      });
    }
    for (const item of openChecklistItems) {
      if (item.icon === "spell" || item.icon === "goals") continue;
      list.push({
        id: `chk:${item.text}`,
        severity: "soon",
        category: "checklist",
        categoryLabel: "Checklist",
        title: item.text,
        detail: item.detail,
        primary:
          item.focusTitleField
            ? { label: "Add title", onClick: () => focusPoemTitle() }
            : item.openToolTab
              ? {
                  label: checklistJumpLabel(item),
                  onClick: () => onOpenToolTab(item.openToolTab!),
                }
              : undefined,
      });
    }
    const groupMap = new Map<string, SpellHit[]>();
    for (const h of spellHits) {
      const arr = groupMap.get(h.normalized);
      if (arr) arr.push(h);
      else groupMap.set(h.normalized, [h]);
    }
    for (const [normalized, hits] of groupMap) {
      const first = hits[0]!;
      const count = hits.length;
      const top = first.suggestions[0];
      list.push({
        id: `spell:${normalized}`,
        severity: "soon",
        category: "spell",
        categoryLabel: "Spelling",
        title: `“${first.word}”${count > 1 ? ` ×${count}` : ""}`,
        detail:
          first.suggestions.length > 0
            ? `Try: ${first.suggestions.slice(0, 3).join(", ")}`
            : undefined,
        line: first.lineNumber,
        onJump: () => goToSpellHitAt(first),
        primary: top
          ? {
              label: count > 1 ? `Replace all → “${top}”` : `Use “${top}”`,
              disabled: heavyToolsStale,
              onClick: () => {
                const ok =
                  count > 1
                    ? applySpellSuggestionAll(normalized, top)
                    : applySpellSuggestion(first, top);
                if (ok) refreshSpell();
              },
            }
          : { label: "Jump", onClick: () => goToSpellHitAt(first) },
      });
    }
    for (let i = 0; i < clicheHits.length; i++) {
      const h = clicheHits[i]!;
      list.push({
        id: `cliche:${i}:${h.lineNumber}:${h.phrase}`,
        severity: "optional",
        category: "cliche",
        categoryLabel: "Cliché",
        title: `“${h.phrase}”`,
        line: h.lineNumber,
        onJump: () => goToLine(h.lineNumber),
        primary: { label: "Jump", onClick: () => goToLine(h.lineNumber) },
      });
    }
    return list;
  }, [
    goalEvaluation.warnings,
    openChecklistItems,
    spellHits,
    clicheHits,
    heavyToolsStale,
    onOpenToolTab,
    focusPoemTitle,
    goToLine,
    goToSpellHitAt,
    applySpellSuggestion,
    applySpellSuggestionAll,
    refreshSpell,
  ]);

  const queueBuckets = useMemo(() => {
    const buckets: Record<QueueSeverity, QueueIssue[]> = {
      now: [],
      soon: [],
      optional: [],
    };
    for (const it of queueIssues) buckets[it.severity].push(it);
    return buckets;
  }, [queueIssues]);

  return (
    <div
      className="tool-block tool-block-live"
      id="tool-panel-issues"
      role="tabpanel"
      aria-labelledby="tool-tab-issues"
    >
      <LiveSectionTitle>Revision queue</LiveSectionTitle>
      {!wordlist ? (
        <p className="muted small" aria-busy="true">
          Dictionary loading — spelling flags appear here when ready.
        </p>
      ) : null}
      {queueIssues.length === 0 ? (
        <EmptyState title="All clear — keep writing.">
          <p className="muted small">
            Checklist, goals, spelling, and clichés all satisfied. Issues
            appear here as you draft.
          </p>
        </EmptyState>
      ) : (
        <div className="queue-buckets">
          {(["now", "soon", "optional"] as QueueSeverity[]).map((sev) => {
            const items = queueBuckets[sev];
            if (items.length === 0) return null;
            const label =
              sev === "now" ? "Now" : sev === "soon" ? "Soon" : "Optional";
            return (
              <section
                key={sev}
                className={`queue-bucket queue-bucket-${sev}`}
              >
                <header className="queue-bucket-head">
                  <span className={`queue-sev-dot queue-sev-dot-${sev}`} aria-hidden />
                  <h4 className="tool-subheading queue-bucket-title">
                    {label}
                    <span className="queue-bucket-count">{items.length}</span>
                  </h4>
                </header>
                <ul className="queue-list" aria-label={`${label} issues`}>
                  {items.map((it) => (
                    <li
                      key={it.id}
                      className={`queue-item queue-item-${it.category}`}
                    >
                      <div className="queue-item-header">
                        <span
                          className={`queue-cat queue-cat-${it.category}`}
                          title={it.categoryLabel}
                        >
                          {it.categoryLabel}
                        </span>
                        {it.line != null && it.onJump ? (
                          <button
                            type="button"
                            className="queue-line-link"
                            onClick={it.onJump}
                            title={`Jump to line ${it.line}`}
                          >
                            L{it.line}
                          </button>
                        ) : null}
                      </div>
                      <div className="queue-body">
                        <div className="queue-title-row">
                          <span className="queue-title">{it.title}</span>
                        </div>
                        {it.detail ? (
                          <p className="queue-detail muted small">
                            {it.detail}
                          </p>
                        ) : null}
                      </div>
                      {it.primary ? (
                        <button
                          type="button"
                          className="small-btn queue-primary-btn"
                          disabled={it.primary.disabled}
                          onClick={it.primary.onClick}
                        >
                          {it.primary.label}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {goalEvaluation.syllableOverLines.length > 0 ? (
            <p className="muted small goal-syllable-jumps">
              Lines over syllable cap:{" "}
              <JumpLineList
                lineNumbers={goalEvaluation.syllableOverLines}
                goToLine={goToLine}
              />
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
