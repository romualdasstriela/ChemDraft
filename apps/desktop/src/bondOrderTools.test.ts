import { describe, expect, it } from "vitest";
import type { MoleculeObject } from "@chemdraft/chem-core";
import {
  applyNativeMoleculeBondOrderTarget,
  applyOrderToNewNativeBonds,
  applySingleBondToolAtPoint,
  createPhase4Document,
  insertNativeTemplateMolecule,
  nativeBondOrderForToolCommand,
  nativeBondStyleForToolCommand
} from "./documentWorkflow";

function molecule(document: ReturnType<typeof createPhase4Document>): MoleculeObject {
  const object = document.pages[0].objects.find((candidate): candidate is MoleculeObject => candidate.type === "molecule");
  if (!object) throw new Error("Expected molecule");
  return object;
}

describe("double and triple bond tools", () => {
  it("draw like the single bond tool and raise the bonds they add", () => {
    expect(nativeBondStyleForToolCommand("tool.doubleBond")).toBe("solid");
    expect(nativeBondStyleForToolCommand("tool.tripleBond")).toBe("solid");
    expect(nativeBondOrderForToolCommand("tool.doubleBond")).toBe("double");
    expect(nativeBondOrderForToolCommand("tool.tripleBond")).toBe("triple");
    expect(nativeBondOrderForToolCommand("tool.bond")).toBeUndefined();

    const empty = createPhase4Document("Bond tools");
    const placed = applySingleBondToolAtPoint(empty, { x: 200, y: 200 });
    const double = applyOrderToNewNativeBonds(empty, placed, "double");
    expect(molecule(double).bonds).toEqual([
      expect.objectContaining({ order: "double", display: expect.objectContaining({ doubleBondSide: "center" }) })
    ]);
    expect(molecule(applyOrderToNewNativeBonds(empty, placed, "triple")).bonds[0]).toMatchObject({ order: "triple" });
  });

  it("raises only the bond a gesture added, never the bonds already drawn", () => {
    const empty = createPhase4Document("Bond tools");
    const first = applySingleBondToolAtPoint(empty, { x: 200, y: 200 });
    const end = molecule(first).atoms[1]!;
    const extended = applySingleBondToolAtPoint(first, { x: end.x, y: end.y });
    expect(molecule(extended).bonds).toHaveLength(2);
    const raised = molecule(applyOrderToNewNativeBonds(first, extended, "double"));
    const firstBondId = molecule(first).bonds[0]!.id;
    expect(raised.bonds.find((bond) => bond.id === firstBondId)!.order).toBe("single");
    expect(raised.bonds.find((bond) => bond.id !== firstBondId)!.order).toBe("double");
  });
});

describe("triple bonds are linear", () => {
  function angleAt(mol: MoleculeObject, centreId: string, aId: string, bId: string): number {
    const at = (id: string) => mol.atoms.find((atom) => atom.id === id)!;
    const c = at(centreId), a = at(aId), b = at(bId);
    const v1 = { x: a.x - c.x, y: a.y - c.y }, v2 = { x: b.x - c.x, y: b.y - c.y };
    return Math.acos((v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y))) * 180 / Math.PI;
  }

  it("draws a triple bond straight on from an atom's single bond", () => {
    const empty = createPhase4Document("Alkyne");
    const first = applySingleBondToolAtPoint(empty, { x: 200, y: 200 });
    const [a, b] = molecule(first).atoms;
    const grown = applySingleBondToolAtPoint(first, { x: b!.x, y: b!.y }, { growsTripleBond: true });
    const triple = molecule(applyOrderToNewNativeBonds(first, grown, "triple"));
    const added = triple.atoms.find((atom) => atom.id !== a!.id && atom.id !== b!.id)!;
    expect(triple.bonds.find((bond) => bond.toAtomId === added.id || bond.fromAtomId === added.id)!.order).toBe("triple");
    expect(angleAt(triple, b!.id, a!.id, added.id)).toBeCloseTo(180, 3);
  });

  it("continues straight through a triple-bonded atom when the next bond is grown", () => {
    const empty = createPhase4Document("Alkyne");
    const placed = applySingleBondToolAtPoint(empty, { x: 200, y: 200 });
    const triple = applyOrderToNewNativeBonds(empty, placed, "triple");
    const [a, b] = molecule(triple).atoms;
    const grown = molecule(applySingleBondToolAtPoint(triple, { x: b!.x, y: b!.y }));
    const added = grown.atoms.find((atom) => atom.id !== a!.id && atom.id !== b!.id)!;
    expect(angleAt(grown, b!.id, a!.id, added.id)).toBeCloseTo(180, 3);
    // A plain single bond still zig-zags.
    const zigzag = molecule(applySingleBondToolAtPoint(placed, { x: b!.x, y: b!.y }));
    const zigAdded = zigzag.atoms.find((atom) => atom.id !== a!.id && atom.id !== b!.id)!;
    expect(angleAt(zigzag, b!.id, a!.id, zigAdded.id)).toBeLessThan(170);
  });
});

describe("clicking a bond to raise its order", () => {
  it("centres the double bond when asked, even in a ring whose default is the inside", () => {
    const ring = insertNativeTemplateMolecule(createPhase4Document("Ring"), { x: 300, y: 300 }, "cyclohexane");
    const bond = molecule(ring).bonds[0]!;
    const target = {
      objectId: molecule(ring).id, kind: "bond" as const, bondId: bond.id,
      fromAtomId: bond.fromAtomId, toAtomId: bond.toAtomId, distanceToPointer: 0
    };
    const automatic = molecule(applyNativeMoleculeBondOrderTarget(ring, target)).bonds[0]!;
    expect(automatic.order).toBe("double");
    expect(automatic.display?.doubleBondSide).not.toBe("center");

    const centred = molecule(applyNativeMoleculeBondOrderTarget(ring, target, { doubleBondSide: "center" })).bonds[0]!;
    expect(centred).toMatchObject({ order: "double", display: { doubleBondSide: "center" } });
  });

  it("puts a clicked ring bond's second line inside the ring, and a chain bond's centred", () => {
    const ring = insertNativeTemplateMolecule(createPhase4Document("Ring"), { x: 300, y: 300 }, "cyclohexane");
    const ringBond = molecule(ring).bonds[0]!;
    const ringTarget = {
      objectId: molecule(ring).id, kind: "bond" as const, bondId: ringBond.id,
      fromAtomId: ringBond.fromAtomId, toAtomId: ringBond.toAtomId, distanceToPointer: 0
    };
    const inside = molecule(applyNativeMoleculeBondOrderTarget(ring, ringTarget)).bonds[0]!.display?.doubleBondSide;
    expect(["left", "right"]).toContain(inside);
    const clicked = molecule(applyNativeMoleculeBondOrderTarget(ring, ringTarget, { doubleBondSide: "ring-inside-else-center" })).bonds[0]!;
    expect(clicked).toMatchObject({ order: "double", display: { doubleBondSide: inside } });

    const chain = applySingleBondToolAtPoint(createPhase4Document("Chain"), { x: 200, y: 200 });
    const chainBond = molecule(chain).bonds[0]!;
    const chainTarget = {
      objectId: molecule(chain).id, kind: "bond" as const, bondId: chainBond.id,
      fromAtomId: chainBond.fromAtomId, toAtomId: chainBond.toAtomId, distanceToPointer: 0
    };
    expect(molecule(applyNativeMoleculeBondOrderTarget(chain, chainTarget, { doubleBondSide: "ring-inside-else-center" })).bonds[0])
      .toMatchObject({ order: "double", display: { doubleBondSide: "center" } });
  });

  it("gives a double bond drawn into a ring by the double bond tool the inside line", () => {
    const ring = insertNativeTemplateMolecule(createPhase4Document("Ring"), { x: 300, y: 300 }, "cyclohexane");
    const withoutBond = molecule(ring);
    const removed = withoutBond.bonds[0]!;
    // A ring missing one bond, then the same bond added back as if drawn: it closes the ring.
    const open = { ...ring, pages: [{ ...ring.pages[0]!, objects: [{ ...withoutBond, bonds: withoutBond.bonds.slice(1) }] }] };
    const raised = molecule(applyOrderToNewNativeBonds(open, ring, "double")).bonds.find((bond) => bond.id === removed.id)!;
    expect(raised.order).toBe("double");
    expect(["left", "right"]).toContain(raised.display?.doubleBondSide);
  });
});
