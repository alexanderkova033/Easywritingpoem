import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { attachMockLocalStorage } from "@/shared/test/mock-local-storage";
import {
  duplicatePoemById,
  loadOrCreateLibrary,
  mergeImportedPoems,
  newBlankPoemAfter,
  poemById,
  removePoem,
  setActivePoem,
  upsertActivePoem,
} from "./local-draft-library";

describe("local-draft-library", () => {
  let detach: () => void;

  beforeEach(() => {
    ({ detach } = attachMockLocalStorage());
  });

  afterEach(() => {
    detach();
  });

  it("creates one poem when storage is empty", () => {
    const lib = loadOrCreateLibrary();
    expect(lib.poems).toHaveLength(1);
    expect(lib.activeId).toBe(lib.poems[0]!.id);
  });

  it("upserts title and body on the active poem", () => {
    const lib = loadOrCreateLibrary();
    const next = upsertActivePoem(lib, {
      title: "Sea",
      body: "one\n",
      form: "haiku",
    });
    const p = poemById(next, next.activeId);
    expect(p?.title).toBe("Sea");
    expect(p?.body).toBe("one\n");
    expect(p?.form).toBe("haiku");
  });

  it("clears form when empty string passed", () => {
    let lib = loadOrCreateLibrary();
    lib = upsertActivePoem(lib, {
      title: "",
      body: "",
      form: "note",
    });
    expect(poemById(lib, lib.activeId)?.form).toBe("note");
    lib = upsertActivePoem(lib, {
      title: "",
      body: "",
      form: "",
    });
    expect(poemById(lib, lib.activeId)?.form).toBeUndefined();
  });

  it("mergeImportedPoems appends poems from backup JSON", () => {
    const lib = loadOrCreateLibrary();
    const raw = JSON.stringify({
      easyPoemsWorkshopExport: true,
      version: 1,
      exportedAt: "2026-01-01T00:00:00.000Z",
      poems: [{ title: "Imported", body: "a\nb\n" }],
    });
    const merged = mergeImportedPoems(lib, raw);
    expect("error" in merged).toBe(false);
    if ("error" in merged) return;
    expect(merged.added).toBe(1);
    expect(merged.lib.poems.length).toBe(lib.poems.length + 1);
    const active = poemById(merged.lib, merged.lib.activeId);
    expect(active?.title).toBe("Imported");
  });

  it("removePoem keeps at least one blank poem", () => {
    let lib = loadOrCreateLibrary();
    const onlyId = lib.poems[0]!.id;
    lib = removePoem(lib, onlyId);
    expect(lib.poems).toHaveLength(1);
    expect(lib.poems[0]!.body).toBe("");
  });

  it("duplicatePoemById copies a chosen draft and activates the copy", () => {
    let lib = loadOrCreateLibrary();
    lib = upsertActivePoem(lib, { title: "Source", body: "alpha\n" });
    const sourceId = lib.activeId;
    lib = newBlankPoemAfter(lib);
    expect(lib.activeId).not.toBe(sourceId);
    const back = setActivePoem(lib, sourceId);
    expect(back).not.toBeNull();
    lib = back!;
    expect(lib.activeId).toBe(sourceId);
    const dupLib = duplicatePoemById(lib, sourceId);
    expect(dupLib).not.toBeNull();
    const copy = poemById(dupLib!, dupLib!.activeId);
    expect(copy?.body).toBe("alpha\n");
    expect(copy?.title).toContain("copy");
  });
});
