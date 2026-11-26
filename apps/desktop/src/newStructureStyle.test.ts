import { afterEach, describe, expect, it } from "vitest";
import { AcsDocument1996StylePreset, ChemDraftSyntheticStylePreset, type MoleculeObject } from "@chemdraft/chem-core";
import {
  applyNativeTemplateToolAtTarget,
  applySingleBondToolAtPoint,
  createPhase4Document,
  insertNativeTemplateMolecule,
  insertSmilesMolecule,
  setNewNativeMoleculeStylePreset
} from "./documentWorkflow";
import { APP_NEW_STRUCTURE_STYLE_PRESET, APP_NEW_TEXT_STYLE } from "./MainWindow";

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
    // The ACS Document 1996 values at printed size (page px are 96 to the inch).
    const cm = (value: number) => value / 2.54 * 96;
    for (const molecule of [drawn, ring, smiles]) {
      expect(molecule!.style).toMatchObject({ stylePresetId: "chemdraft.acs-document-1996", bondSpacingMode: "percent", bondSpacingPercent: 18 });
      expect(molecule!.style.bondLengthPx).toBeCloseTo(cm(0.508), 2);
      expect(molecule!.style.bondStrokeWidthPx).toBeCloseTo(cm(0.0212), 2);
      expect(molecule!.style.bondBoldWidthPx).toBeCloseTo(cm(0.0706), 2);
      expect(molecule!.style.bondMarginWidthPx).toBeCloseTo(cm(0.0564), 2);
      expect(molecule!.style.bondHashSpacingPx).toBeCloseTo(cm(0.0882), 2);
      expect(molecule!.style.atomLabelFontSizePx).toBeCloseTo(10 * 96 / 72, 6);
      expect(molecule!.style.atomLabelFontFamily).toBe("Arial, Helvetica, sans-serif");
    }
    // And the structures are drawn at that bond length: the new bond and every ring bond.
    const bondLengths = (molecule: MoleculeObject) => molecule.bonds.map((bond) => {
      const from = molecule.atoms.find((atom) => atom.id === bond.fromAtomId)!;
      const to = molecule.atoms.find((atom) => atom.id === bond.toAtomId)!;
      return Math.hypot(from.x - to.x, from.y - to.y);
    });
    for (const length of [...bondLengths(drawn!), ...bondLengths(ring!), ...bondLengths(smiles!)]) {
      expect(length).toBeCloseTo(cm(0.508), 1);
    }
    // The structure drawn before keeps its own size.
    expect(bondLengths(old!)[0]).toBeCloseTo(22, 1);
  });

  it("starts new text at the journal style's Arial 10 pt", () => {
    expect(APP_NEW_TEXT_STYLE).toMatchObject({ fontFamily: "Arial, Helvetica, sans-serif", textAlign: "left" });
    expect(APP_NEW_TEXT_STYLE.fontSizePx).toBeCloseTo(10 * 96 / 72, 6);
  });

  it("joins a spiro ring at the bond length of the structure it joins", () => {
    // An older structure (22 px bonds) keeps 22 px when a ring is added at one of its atoms, even
    // though new structures now start at the ACS length.
    const older = applySingleBondToolAtPoint(createPhase4Document("Spiro"), { x: 300, y: 300 });
    setNewNativeMoleculeStylePreset(AcsDocument1996StylePreset);
    const molecule = molecules(older)[0]!;
    const atom = molecule.atoms[0]!;
    const withRing = applyNativeTemplateToolAtTarget(older, { kind: "atom", objectId: molecule.id, atomId: atom.id, distanceToPointer: 0 }, { x: atom.x, y: atom.y - 30 }, "cyclohexane");
    const joined = molecules(withRing)[0]!;
    expect(joined.atoms.length).toBe(molecule.atoms.length + 5);
    const lengths = joined.bonds.map((bond) => {
      const from = joined.atoms.find((candidate) => candidate.id === bond.fromAtomId)!;
      const to = joined.atoms.find((candidate) => candidate.id === bond.toAtomId)!;
      return Math.hypot(from.x - to.x, from.y - to.y);
    });
    for (const length of lengths) expect(length).toBeCloseTo(22, 0);
  });
});
