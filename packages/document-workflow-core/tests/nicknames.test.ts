import { afterEach, describe, expect, it } from "vitest";
import type { MoleculeAtom, MoleculeBond } from "@chemdraft/chem-core";
import {
  abbreviationDefinitionFromNickname,
  expandNativeLabelGroupsInGraph,
  nativeAtomLabelReading,
  nativeLabelGroupFreeValence,
  nativeLabelGroupVerdict,
  nicknameGraphFromDrawing,
  setUserAbbreviations,
  type NicknameGraphInput
} from "../src/index";

// A two-site linker written for this test: N(H)–C(=O), joining at the N and at the carbonyl C.
const linker: NicknameGraphInput = {
  atoms: [
    { element: "N", charge: 0, statedHydrogens: 1, x: 100, y: 100 },
    { element: "C", charge: 0, x: 114, y: 92 },
    { element: "O", charge: 0, x: 114, y: 76 }
  ],
  bonds: [[0, 1, 1], [1, 2, 2]],
  attachments: [{ atomIndex: 0, x: 86, y: 92 }, { atomIndex: 1, x: 128, y: 100 }]
};

// Cyclopropyl, with no stated hydrogens: the valence model supplies them.
const cyclopropyl: NicknameGraphInput = {
  atoms: [
    { element: "C", charge: 0, x: 0, y: 0 },
    { element: "C", charge: 0, x: 14, y: -8 },
    { element: "C", charge: 0, x: 14, y: 8 }
  ],
  bonds: [[0, 1, 1], [1, 2, 1], [2, 0, 1]],
  attachments: [{ atomIndex: 0, x: -14, y: 0 }]
};

afterEach(() => setUserAbbreviations([]));

describe("a nickname from the drawing", () => {
  // Propyl drawn on an O: O1–C2–C3–C4.
  const atoms: MoleculeAtom[] = [
    { id: "o", element: "O", x: 0, y: 0, formalCharge: 0 },
    { id: "c1", element: "C", x: 20, y: -10, formalCharge: 0 },
    { id: "c2", element: "C", x: 40, y: 0, formalCharge: 0 },
    { id: "c3", element: "C", x: 60, y: -10, formalCharge: 0 }
  ];
  const bonds: MoleculeBond[] = [
    { id: "b1", fromAtomId: "o", toAtomId: "c1", order: "single" },
    { id: "b2", fromAtomId: "c1", toAtomId: "c2", order: "single" },
    { id: "b3", fromAtomId: "c2", toAtomId: "c3", order: "single" }
  ];

  it("takes the selected atoms, and the bond to the unselected rest as where it attaches", () => {
    const result = nicknameGraphFromDrawing({ atoms, bonds }, new Set(["c1", "c2", "c3"]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.attachments).toEqual([{ atomIndex: 0, x: 0, y: 0 }]);
    expect(abbreviationDefinitionFromNickname("Prp", result.graph)).toMatchObject({ formula: "C3H7", attachmentCount: 1 });
  });

  it("reads a selected * atom as a drawn attachment mark", () => {
    const marked = atoms.map((atom) => atom.id === "o" ? { ...atom, element: "*" } : atom);
    const result = nicknameGraphFromDrawing({ atoms: marked, bonds }, new Set(["o", "c1", "c2", "c3"]));
    expect(result.ok && result.graph.atoms.length).toBe(3);
    expect(result.ok && result.graph.attachments.length).toBe(1);
  });

  it("refuses a group with no attachment, or with a label that is not a plain element", () => {
    const whole = nicknameGraphFromDrawing({ atoms, bonds }, new Set(atoms.map((atom) => atom.id)));
    expect(whole).toMatchObject({ ok: false, reason: expect.stringContaining("Mark where the group attaches") });
    const labelled = atoms.map((atom) => atom.id === "c3" ? { ...atom, element: "OMe" } : atom);
    expect(nicknameGraphFromDrawing({ atoms: labelled, bonds }, new Set(["c1", "c2", "c3"])))
      .toMatchObject({ ok: false, reason: expect.stringContaining("not a plain element") });
  });
});

describe("nickname definitions", () => {
  it("turns a single-site group into a table entry: hydrogens, formula, frame", () => {
    const definition = abbreviationDefinitionFromNickname("cPr", cyclopropyl, "cPr.cdxml");
    expect(definition).toMatchObject({ label: "cPr", formula: "C3H5", attachmentCount: 1, source: "cPr.cdxml" });
    expect(definition.atoms.map((atom) => atom.hydrogens)).toEqual([1, 2, 2]);
    expect(definition.atoms[0]).toMatchObject({ x: 0, y: 0 });
    expect(definition.attachmentAtoms).toBeUndefined();
  });

  it("records where a two-site group joins and checks it takes exactly one bond at each", () => {
    const definition = abbreviationDefinitionFromNickname("Lnk", linker);
    expect(definition).toMatchObject({ formula: "CHNO", attachmentCount: 2, attachmentAtoms: [0, 1] });
    expect(definition.atoms.map((atom) => atom.hydrogens)).toEqual([1, 0, 0]);
    setUserAbbreviations([definition]);
    const reading = nativeAtomLabelReading("Lnk", { bonded: true });
    expect(reading.kind).toBe("group");
    if (reading.kind !== "group") return;
    expect(nativeLabelGroupFreeValence(reading.group)).toBe(2);
    expect(nativeLabelGroupVerdict(reading.group, 2, 0).valid).toBe(true);
    expect(nativeLabelGroupVerdict(reading.group, 1, 0)).toMatchObject({ valid: false, expectedBondCount: 2 });
  });

  it("joins a two-site group's bonds in reading order: the left neighbour at the first site", () => {
    setUserAbbreviations([abbreviationDefinitionFromNickname("Lnk", linker)]);
    const reading = nativeAtomLabelReading("Lnk", { bonded: true });
    if (reading.kind !== "group") throw new Error("Expected a group");
    const atoms: MoleculeAtom[] = [
      { id: "right", element: "C", x: 60, y: 0, formalCharge: 0 },
      { id: "label", element: "Lnk", x: 30, y: 0, formalCharge: 0, labelLiteral: true },
      { id: "left", element: "C", x: 0, y: 0, formalCharge: 0 }
    ];
    const bonds: MoleculeBond[] = [
      { id: "b1", fromAtomId: "label", toAtomId: "right", order: "single" },
      { id: "b2", fromAtomId: "left", toAtomId: "label", order: "single" }
    ];
    const expanded = expandNativeLabelGroupsInGraph(atoms, bonds, new Map([["label", reading.group]]));
    const byId = new Map(expanded.atoms.map((atom) => [atom.id, atom]));
    expect(byId.get("label")!.element).toBe("N");
    // The left neighbour stays on the N; the right one is moved to the carbonyl carbon.
    expect(expanded.bonds.find((bond) => bond.id === "b2")).toMatchObject({ fromAtomId: "left", toAtomId: "label" });
    const rightBond = expanded.bonds.find((bond) => bond.id === "b1")!;
    expect(rightBond.toAtomId).toBe("right");
    expect(byId.get(rightBond.fromAtomId)!.element).toBe("C");
    expect(rightBond.fromAtomId).not.toBe("label");
  });

  it("names the group only on a bond when its label is an element symbol, and never overrides a built-in", () => {
    setUserAbbreviations([
      abbreviationDefinitionFromNickname("Am", cyclopropyl),
      abbreviationDefinitionFromNickname("OMe", cyclopropyl)
    ]);
    expect(nativeAtomLabelReading("Am", { bonded: true }).kind).toBe("group");
    expect(nativeAtomLabelReading("Am", { bonded: false })).toMatchObject({ kind: "element", element: "Am" });
    const methoxy = nativeAtomLabelReading("OMe", { bonded: true });
    expect(methoxy.kind === "group" && methoxy.group.kind === "abbreviation" && methoxy.group.definition.name).toBe("methoxy");
  });
});
