import { afterEach, describe, expect, it } from "vitest";
import { AcsDocument1996StylePreset, ChemDraftSyntheticStylePreset, type MoleculeObject } from "@chemdraft/chem-core";
import {
  applySingleBondToolAtPoint,
  createPhase4Document,
  insertNativeTemplateMolecule,
  insertSmilesMolecule,
  setNewNativeMoleculeStylePreset
} from "./documentWorkflow";
import { APP_NEW_STRUCTURE_STYLE_PRESET } from "./MainWindow";

function molecules(document: ReturnType<typeof createPhase4Document>): MoleculeObject[] {
  return document.pages[0].objects.filter((object): object is MoleculeObject => object.type === "molecule");
}

describe("new structure style", () => {
  afterEach(() => setNewNativeMoleculeStylePreset(ChemDraftSyntheticStylePreset));

  it("is ACS Document 1996 in the app", () => {
    expect(APP_NEW_STRUCTURE_STYLE_PRESET).toBe(AcsDocument1996StylePreset);
  });

  it("styles drawn, templated and pasted structures, and leaves existing ones alone", () => {
    const drawnBefore = applySingleBondToolAtPoint(createPhase4Document("Style"), { x: 120, y: 120 });
    setNewNativeMoleculeStylePreset(AcsDocument1996StylePreset);

    const withBond = applySingleBondToolAtPoint(drawnBefore, { x: 400, y: 120 });
    const withRing = insertNativeTemplateMolecule(withBond, { x: 300, y: 400 }, "cyclohexane");
    const pasted = insertSmilesMolecule(withRing, { x: 500, y: 500 }, {
      atoms: [{ element: "C", x: 0, y: 0, charge: 0 }, { element: "O", x: 1, y: 0, charge: 0 }],
      bonds: [{ from: 0, to: 1, order: "single", wedge: null }]
    }, "CO", AcsDocument1996StylePreset);

    const [old, drawn, ring, smiles] = molecules(pasted);
    expect(old!.style).toMatchObject({ stylePresetId: "chemdraft.synthetic", bondStrokeWidthPx: 2 });
    for (const molecule of [drawn, ring, smiles]) {
      expect(molecule!.style).toMatchObject({
        stylePresetId: "chemdraft.acs-document-1996",
        bondStrokeWidthPx: 1.058,
        bondBoldWidthPx: 4.233,
        bondSpacingMode: "percent",
        bondSpacingPercent: 18
      });
    }
  });
});
