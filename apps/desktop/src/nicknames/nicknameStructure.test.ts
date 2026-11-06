import { afterEach, describe, expect, it } from "vitest";
import { AcsDocument1996StylePreset, ChemDraftSyntheticStylePreset, type MoleculeObject } from "@chemdraft/chem-core";
import { abbreviationDefinitionFromNickname, nicknameGraphFromDrawing } from "@chemdraft/document-workflow-core";
import { createPhase4Document, insertNicknameStructure, setNewNativeMoleculeStylePreset } from "../documentWorkflow";

// Acetyl written for this test: C(=O)–CH3, joining at the carbonyl carbon.
const acetyl = abbreviationDefinitionFromNickname("Acl", {
  atoms: [
    { element: "C", charge: 0, x: 0, y: 0 },
    { element: "O", charge: 0, x: 0, y: -14 },
    { element: "C", charge: 0, x: 12, y: 7 }
  ],
  bonds: [[0, 1, 2], [0, 2, 1]],
  attachments: [{ atomIndex: 0, x: -12, y: 7 }]
});

afterEach(() => setNewNativeMoleculeStylePreset(ChemDraftSyntheticStylePreset));

describe("placing a nickname's structure", () => {
  it("puts the group's atoms and bonds on the page at the click, in the new-structure style, selected", () => {
    setNewNativeMoleculeStylePreset(AcsDocument1996StylePreset);
    const point = { x: 300, y: 250 };
    const document = insertNicknameStructure(createPhase4Document("Nickname"), point, acetyl);
    const molecule = document.pages[0].objects.find((object): object is MoleculeObject => object.type === "molecule")!;

    expect(molecule.atoms.map((atom) => atom.element)).toEqual(["C", "O", "C"]);
    expect(molecule.bonds.map((bond) => bond.order)).toEqual(["double", "single"]);
    expect(molecule.style).toMatchObject({ stylePresetId: AcsDocument1996StylePreset.id, bondLengthPx: AcsDocument1996StylePreset.drawing.bondLengthPx });
    // Plain atoms: the attachment site takes an implicit hydrogen (acetaldehyde), no label.
    expect(molecule.atoms.every((atom) => atom.labelLiteral !== true)).toBe(true);
    const xs = molecule.atoms.map((atom) => atom.x);
    const ys = molecule.atoms.map((atom) => atom.y);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(point.x, 0);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(point.y, 0);
    const [a, b] = [molecule.atoms[0]!, molecule.atoms[2]!];
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(AcsDocument1996StylePreset.drawing.bondLengthPx, 0);
    expect(document.selection.objectIds).toEqual([molecule.id]);
  });

  it("places a template drawn with an abbreviation label with the label kept", () => {
    // Drawn as C–C–OMe and stored with the label; placed, it is OMe again, not O–CH3.
    const drawing = nicknameGraphFromDrawing({
      atoms: [
        { id: "a", element: "C", x: 0, y: 0, formalCharge: 0 },
        { id: "b", element: "C", x: 20, y: -10, formalCharge: 0 },
        { id: "c", element: "OMe", x: 40, y: 0, formalCharge: 0 }
      ],
      bonds: [
        { id: "ab", fromAtomId: "a", toAtomId: "b", order: "single" },
        { id: "bc", fromAtomId: "b", toAtomId: "c", order: "single" }
      ]
    }, new Set(["a", "b", "c"]));
    if (!drawing.ok) throw new Error(drawing.reason);
    const definition = abbreviationDefinitionFromNickname("EtOMe", drawing.graph);
    const document = insertNicknameStructure(createPhase4Document("Nickname"), { x: 300, y: 250 }, definition);
    const molecule = document.pages[0].objects.find((object): object is MoleculeObject => object.type === "molecule")!;
    expect(molecule.atoms.map((atom) => atom.element)).toEqual(["C", "C", "OMe"]);
    expect(molecule.bonds).toHaveLength(2);
    // The label still counts as its atoms.
    expect(molecule.chemistry?.formula).toBe("C3H8O");
  });
});
