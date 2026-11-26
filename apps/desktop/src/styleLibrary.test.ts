import { describe, expect, it } from "vitest";
import { AcsDocument1996StylePreset, ChemDraftSyntheticStylePreset } from "@chemdraft/chem-core";
import { MemoryStorage } from "./testSupport/memoryStorage";
import { drawnStructureSettingsStyleSaveCommandId, styleNameFromSaveCommandId } from "./commands";
import {
  DEFAULT_STYLE_STORAGE_KEY,
  STYLE_LIBRARY_STORAGE_KEY,
  availableStylePresets,
  deleteSavedStyle,
  loadSavedStyles,
  resolveDefaultStylePreset,
  saveDefaultStyleId,
  saveStyleToLibrary
} from "./styleLibrary";

const drawing = { ...AcsDocument1996StylePreset.drawing, bondLengthPx: 25, bondStrokeWidthPx: 1.2 };

describe("style library", () => {
  it("saves a named style, replacing an earlier one with the same name", () => {
    const storage = new MemoryStorage();
    const first = saveStyleToLibrary("  My Journal  ", drawing, storage);
    expect(first).toMatchObject({ name: "My Journal", id: "user-style.my-journal" });
    expect(first.drawing).toMatchObject({ bondLengthPx: 25, bondStrokeWidthPx: 1.2, stylePresetId: "user-style.my-journal" });
    saveStyleToLibrary("my journal", { ...drawing, bondLengthPx: 30 }, storage);
    const saved = loadSavedStyles(storage);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.drawing.bondLengthPx).toBe(30);
  });

  it("refuses an empty name and the built-in style's name", () => {
    const storage = new MemoryStorage();
    expect(() => saveStyleToLibrary("   ", drawing, storage)).toThrow("Enter a name");
    expect(() => saveStyleToLibrary("ACS Document 1996", drawing, storage)).toThrow("built-in");
    expect(loadSavedStyles(storage)).toEqual([]);
  });

  it("offers the built-in ACS style first, then saved styles by name", () => {
    const storage = new MemoryStorage();
    saveStyleToLibrary("Zeta", drawing, storage);
    saveStyleToLibrary("Alpha", drawing, storage);
    expect(availableStylePresets(storage).map((preset) => preset.name)).toEqual(["ACS Document 1996", "Alpha", "Zeta"]);
  });

  it("uses the chosen default style, falling back to ACS when it is deleted", () => {
    const storage = new MemoryStorage();
    expect(resolveDefaultStylePreset(storage)).toBe(AcsDocument1996StylePreset);
    const saved = saveStyleToLibrary("Thesis", drawing, storage);
    saveDefaultStyleId(saved.id, storage);
    expect(resolveDefaultStylePreset(storage)).toMatchObject({ id: saved.id, name: "Thesis", drawing: { bondLengthPx: 25 } });
    deleteSavedStyle(saved.id, storage);
    expect(storage.getItem(DEFAULT_STYLE_STORAGE_KEY)).toBeNull();
    expect(resolveDefaultStylePreset(storage)).toBe(AcsDocument1996StylePreset);
    // Choosing the built-in style clears the stored choice.
    saveDefaultStyleId(saveStyleToLibrary("Again", drawing, storage).id, storage);
    saveDefaultStyleId(AcsDocument1996StylePreset.id, storage);
    expect(storage.getItem(DEFAULT_STYLE_STORAGE_KEY)).toBeNull();
  });

  it("ignores damaged entries in the stored library", () => {
    const storage = new MemoryStorage();
    storage.setItem(STYLE_LIBRARY_STORAGE_KEY, JSON.stringify([
      { id: "user-style.ok", name: "OK", drawing: { bondLengthPx: 20 } },
      { id: "other.id", name: "Wrong prefix", drawing: {} },
      { id: "user-style.no-drawing", name: "No drawing" },
      "not an object"
    ]));
    const saved = loadSavedStyles(storage);
    expect(saved.map((style) => style.name)).toEqual(["OK"]);
    // Missing fields come from the defaults, so the style is always complete.
    expect(saved[0]!.drawing.chainAngleDegrees).toBe(ChemDraftSyntheticStylePreset.drawing.chainAngleDegrees);
    storage.setItem(STYLE_LIBRARY_STORAGE_KEY, "{broken");
    expect(loadSavedStyles(storage)).toEqual([]);
  });

  it("carries the style name through the Save Style command", () => {
    const id = drawnStructureSettingsStyleSaveCommandId("Mono 10 pt: draft/2");
    expect(styleNameFromSaveCommandId(id)).toBe("Mono 10 pt: draft/2");
    expect(styleNameFromSaveCommandId("drawnStructureSettings.template.export")).toBeUndefined();
  });
});
