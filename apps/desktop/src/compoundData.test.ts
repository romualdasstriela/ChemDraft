import { describe, expect, it } from "vitest";
import { nativeTextStyleFromObjectStyle, type MoleculeObject, type TextObject } from "@chemdraft/chem-core";
import { moleculeInkBoundsForArrangement } from "@chemdraft/layout-engine";
import {
  compoundBoilingPointFromRun,
  compoundDataLines,
  compoundDataModel,
  compoundDataText,
  COMPOUND_BOILING_POINT_METHOD_ID
} from "./compoundData";
import {
  applyNativeAtomElementTarget,
  createPhase4Document,
  insertCompoundDataText,
  insertNativeTemplateMolecule,
  selectDocumentObjects
} from "./documentWorkflow";

function benzene() {
  const document = insertNativeTemplateMolecule(createPhase4Document("Compound"), { x: 300, y: 300 }, "benzene");
  const molecule = document.pages[0].objects.find((object): object is MoleculeObject => object.type === "molecule")!;
  return { document, molecule };
}

const tbResult = (overrides: Record<string, unknown>) => ({
  id: "tb", label: "Normal boiling point", methodId: COMPOUND_BOILING_POINT_METHOD_ID, methodVersion: "1.0.0",
  interpretationId: "source", kind: "scalar", value: 358.55, unit: "kelvin", status: "ok",
  uncertainties: [{ kind: "average-error", value: 12.9, unit: "kelvin" }],
  applicability: { status: "in-domain", reasons: [], unsupportedFeatures: [] },
  ...overrides
});

describe("Compound Data", () => {
  it("shows formula, MW, m/z and the predicted bp in °C for the selected structure", () => {
    const { molecule } = benzene();
    const boiling = compoundBoilingPointFromRun({ results: [tbResult({})] } as never, "benzene-key");
    expect(boiling).toEqual({ subject: "benzene-key", kelvin: 358.55, spreadK: 12.9 });
    const model = compoundDataModel(molecule, boiling, { subject: "benzene-key" });
    expect(model.values).toEqual({ formula: "C6H6", molecularWeight: "78.11", mz: "78.0469", boilingPoint: "85.4 °C" });
    expect(model.boilingPointNote).toContain("estimate, not a measured value");
    expect(model.boilingPointPending).toBeUndefined();
  });

  it("does not show a boiling point computed for another structure, and says why when Joback declines", () => {
    const { molecule } = benzene();
    const other = compoundBoilingPointFromRun({ results: [tbResult({})] } as never, "other");
    expect(compoundDataModel(molecule, other, { subject: "benzene-key", pending: true }))
      .toMatchObject({ boilingPointPending: true, values: { formula: "C6H6" } });
    const declined = compoundBoilingPointFromRun({ results: [tbResult({ status: "unsupported", value: null,
      applicability: { status: "out-of-domain", reasons: ["contains boron"], unsupportedFeatures: [] } })] } as never, "k");
    const model = compoundDataModel(molecule, declined, { subject: "k" });
    expect(model.values.boilingPoint).toBeUndefined();
    expect(model.boilingPointNote).toBe("contains boron");
    expect(compoundDataModel(undefined, undefined).hasStructure).toBe(false);
  });

  it("copies and pastes only the ticked fields, in toolbox order", () => {
    const { molecule } = benzene();
    const model = compoundDataModel(molecule, undefined);
    const lines = compoundDataLines(model, ["mz", "formula", "boilingPoint"]);
    expect(lines.map((line) => line.field)).toEqual(["formula", "mz"]);
    expect(compoundDataText(lines)).toBe("Formula: C6H6\nm/z: 78.0469");
  });

  it("pastes the lines as one centred text object under the structure, formula subscripted", () => {
    const { document, molecule } = benzene();
    const selected = selectDocumentObjects(document, document.pages[0].id, [molecule.id]);
    const lines = compoundDataLines(compoundDataModel(molecule, undefined), ["formula", "molecularWeight"]);
    const next = insertCompoundDataText(selected, molecule.id, lines, { fontSizePx: 40 / 3 });
    const text = next.pages[0].objects.find((object): object is TextObject => object.type === "text")!;
    expect(text.text).toBe("Formula: C6H6\nMolecular Weight: 78.11");
    expect(text.spans.filter((span) => span.script === "subscript").map((span) => span.text)).toEqual(["6", "6"]);
    expect(nativeTextStyleFromObjectStyle(text.style)).toMatchObject({ fontSizePx: 40 / 3, textAlign: "center" });
    const ink = moleculeInkBoundsForArrangement(molecule);
    expect(text.x + text.width / 2).toBeCloseTo(ink.x + ink.width / 2, 6);
    expect(text.y).toBeGreaterThan(ink.y + ink.height);
    expect(next.selection.objectIds).toEqual([molecule.id]);
  });

  it("follows an edited structure: benzene becomes pyridine when a ring atom becomes N", () => {
    const { document, molecule } = benzene();
    const edited = applyNativeAtomElementTarget(document, {
      objectId: molecule.id, kind: "atom", atomId: molecule.atoms[0]!.id, distanceToPointer: 0
    }, "N");
    const after = edited.pages[0].objects.find((object): object is MoleculeObject => object.type === "molecule")!;
    expect(compoundDataModel(after, undefined).values).toMatchObject({ formula: "C5H5N", molecularWeight: "79.10" });
  });
});
