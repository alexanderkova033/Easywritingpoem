import type { RevisionSnapshot } from "@/workshop/library/revision-snapshots";

export const COMPARE_CURRENT_ID = "__current__";

export type ToolTab =
  | "issues"
  | "goals"
  | "lines"
  | "meter"
  | "rhyme"
  | "repeat"
  | "spell"
  | "snapshots"
  | "suggest"
  | "starred"
  | "echoes";

/** High-level tool groups (right panel); each maps to a subset of {@link ToolTab}. */
export type ToolBucket = "overview" | "sound" | "ideas";

export const TOOL_BUCKET_ORDER: ToolBucket[] = ["overview", "sound", "ideas"];

export const TOOL_BUCKET_LABEL: Record<ToolBucket, string> = {
  overview: "Overview",
  sound: "Sound",
  ideas: "Suggest",
};

export function toolTabBucket(tab: ToolTab): ToolBucket {
  if (tab === "meter" || tab === "rhyme" || tab === "repeat" || tab === "echoes") return "sound";
  if (tab === "suggest" || tab === "starred") return "ideas";
  return "overview";
}

export function tabsForBucket(bucket: ToolBucket): ToolTab[] {
  switch (bucket) {
    case "overview":
      return [
        "issues",
        "spell",
        "lines",
        "goals",
        "snapshots",
      ];
    case "sound":
      return ["meter", "rhyme", "echoes", "repeat"];
    case "ideas":
      return ["suggest", "starred"];
  }
}

export function defaultTabForBucket(bucket: ToolBucket): ToolTab {
  return tabsForBucket(bucket)[0]!;
}

export function compareBodyForId(
  id: string,
  currentBody: string,
  revisions: RevisionSnapshot[],
): string {
  if (id === COMPARE_CURRENT_ID) return currentBody;
  return revisions.find((s) => s.id === id)?.body ?? "";
}

export function formatWhen(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatSnapshotWhen(iso: string): string {
  return formatWhen(iso) ?? iso;
}

/** Short relative label for lists; use {@link formatSnapshotWhen} for full tooltip. */
export function formatRelativeSnapshotWhen(iso: string): string {
  const d = new Date(iso);
  const t = d.getTime();
  if (Number.isNaN(t)) return iso;
  const now = Date.now();
  const sec = Math.floor((now - t) / 1000);
  if (sec < 0) return formatSnapshotWhen(iso);
  if (sec < 45) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
  return formatSnapshotWhen(iso);
}

export function parseGoalInput(raw: string): number | undefined {
  const v = raw.trim();
  if (v === "") return undefined;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return n;
}
