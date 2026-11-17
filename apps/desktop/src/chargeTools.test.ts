import { describe, expect, it } from "vitest";
import type { ChemDraftDocument, MoleculeObject } from "@chemdraft/chem-core";
import { CHARGE_MARK_HIT_MARGIN_PX, planMoleculeAtomLabels } from "@chemdraft/layout-engine";
import { exportDocumentToSvg } from "@chemdraft/export-engine";
import {
  applyChargeToolAtNativeAtom,
  applyNativeAtomElementTarget,
  createPhase4Document,
  insertNativeTemplateMolecule,
  normalizeCommittedDocument,
  reconcileNativeChargeMarks
} from "./documentWorkflow";
import {
  HOVER_KEY_NEGATIVE_CHARGE,
  HOVER_KEY_POSITIVE_CHARGE,
  hoverChargeKey,
  hoveredNativeTargetShortcutCommand
} from "./MainWindow";
import { desktopToolsetRegistry } from "./toolsets";

function ring(): { document: ChemDraftDocument; molecule: MoleculeObject } {
  const document = insertNativeTemplateMolecule(createPhase4Document("Charges"), { x: 300, y: 300 }, "cyclohexane");
  return { document, molecule: document.pages[0].objects.find((object): object is MoleculeObject => object.type === "molecule")! };
}

/** What every in-app change goes through: charge marks give their atom its charge here. */
const commit = (document: ChemDraftDocument) => normalizeCommittedDocument(reconcileNativeChargeMarks(document));

const moleculeOf = (document: ChemDraftDocument) =>
  document.pages[0].objects.find((object): object is MoleculeObject => object.type === "molecule")!;

describe("charge tools", () => {
  it.each([
    ["circled +", 1, undefined],
    ["plain +", 1, "plain"],
    ["circled −", -1, undefined],
    ["plain −", -1, "plain"]
  ] as const)("a %s on a ring carbon keeps it a bare vertex, with no C or CH label", (_name, charge, chargeStyle) => {
    const { document, molecule } = ring();
    const atomId = molecule.atoms[0]!.id;
    const charged = commit(applyChargeToolAtNativeAtom(document, { kind: "charge", charge, ...(chargeStyle ? { chargeStyle } : {}) },
      { objectId: molecule.id, kind: "atom", atomId, distanceToPointer: 0 }));
    const after = moleculeOf(charged);
    expect(after.atoms.find((atom) => atom.id === atomId)?.formalCharge).toBe(charge);
    expect(planMoleculeAtomLabels(after).map((plan) => plan.atom.id)).not.toContain(atomId);
    const mark = charged.pages[0].objects.find((object) => object.type === "electron-mark");
    expect(mark).toMatchObject({ charge, ...(chargeStyle ? { chargeStyle } : {}) });
  });

  it("still labels a charged heteroatom (N+ shows its N)", () => {
    const { document, molecule } = ring();
    const target = { objectId: molecule.id, kind: "atom" as const, atomId: molecule.atoms[0]!.id, distanceToPointer: 0 };
    const nitrogen = applyNativeAtomElementTarget(document, target, "N");
    const charged = commit(applyChargeToolAtNativeAtom(nitrogen, 1, target));
    expect(planMoleculeAtomLabels(moleculeOf(charged)).map((plan) => plan.atom.id)).toContain(target.atomId);
  });

  it("reads + and − hover keys by physical key too, for layouts without + on the =/+ key", () => {
    expect(hoverChargeKey({ key: "+", code: "Equal", shiftKey: true })).toBe("+");
    expect(hoverChargeKey({ key: "-", code: "Minus", shiftKey: false })).toBe("-");
    expect(hoverChargeKey({ key: "+", code: "NumpadAdd", shiftKey: false })).toBe("+");
    expect(hoverChargeKey({ key: "-", code: "NumpadSubtract", shiftKey: false })).toBe("-");
    // Lithuanian layout: the =/+ key types ž / Ž.
    expect(hoverChargeKey({ key: "Ž", code: "Equal", shiftKey: true })).toBe("+");
    expect(hoverChargeKey({ key: "ž", code: "Equal", shiftKey: false })).toBe("ž");
    expect(hoverChargeKey({ key: "o", code: "KeyO", shiftKey: false })).toBe("o");
    const atom = { objectId: "m", kind: "atom" as const, atomId: "a", distanceToPointer: 0 };
    expect(hoveredNativeTargetShortcutCommand(atom, hoverChargeKey({ key: "Ž", code: "Equal", shiftKey: true })))
      .toBe("atom.addPositiveChargeToHoveredAtom");
    expect(hoveredNativeTargetShortcutCommand(atom, hoverChargeKey({ key: "-", code: "NumpadSubtract", shiftKey: false })))
      .toBe("atom.addNegativeChargeToHoveredAtom");
  });

  it("hover + and − keys place plain (uncircled) charges, and a second + on the same atom raises it", () => {
    const { document, molecule } = ring();
    const target = { objectId: molecule.id, kind: "atom" as const, atomId: molecule.atoms[0]!.id, distanceToPointer: 0 };
    const plus = commit(applyChargeToolAtNativeAtom(document, HOVER_KEY_POSITIVE_CHARGE, target));
    expect(plus.pages[0].objects.find((object) => object.type === "electron-mark")).toMatchObject({ charge: 1, chargeStyle: "plain" });
    const minus = commit(applyChargeToolAtNativeAtom(document, HOVER_KEY_NEGATIVE_CHARGE, target));
    expect(minus.pages[0].objects.find((object) => object.type === "electron-mark")).toMatchObject({ charge: -1, chargeStyle: "plain" });
    const twice = commit(applyChargeToolAtNativeAtom(plus, HOVER_KEY_POSITIVE_CHARGE, target));
    expect(moleculeOf(twice).atoms[0]!.formalCharge).toBe(2);
    expect(planMoleculeAtomLabels(moleculeOf(twice)).map((plan) => plan.atom.id)).not.toContain(target.atomId);
  });

  it("puts a ring carbon's charge outside the ring, three quarters of a bond out", () => {
    const { document, molecule } = ring();
    const atom = molecule.atoms[0]!;
    const charged = commit(applyChargeToolAtNativeAtom(document, HOVER_KEY_POSITIVE_CHARGE,
      { objectId: molecule.id, kind: "atom", atomId: atom.id, distanceToPointer: 0 }));
    const mark = charged.pages[0].objects.find((object) => object.type === "electron-mark")!;
    const center = { x: mark.x + mark.width / 2, y: mark.y + mark.height / 2 };
    const ringCenter = molecule.atoms.reduce((sum, a) => ({ x: sum.x + a.x / 6, y: sum.y + a.y / 6 }), { x: 0, y: 0 });
    expect(Math.hypot(center.x - atom.x, center.y - atom.y)).toBeCloseTo(22 * 0.75, 0);
    expect(Math.hypot(center.x - ringCenter.x, center.y - ringCenter.y))
      .toBeGreaterThan(Math.hypot(atom.x - ringCenter.x, atom.y - ringCenter.y) + 10);
  });

  it("puts a branch-point carbon's charge in the gap facing away from the molecule", () => {
    // An isopropyl CH on a ring (three equal 120° gaps): the charge goes to the gap away from the ring.
    const { document, molecule } = ring();
    const ringAtom = molecule.atoms[0]!;
    const ringCenter = molecule.atoms.reduce((sum, a) => ({ x: sum.x + a.x / 6, y: sum.y + a.y / 6 }), { x: 0, y: 0 });
    const out = { x: ringAtom.x - ringCenter.x, y: ringAtom.y - ringCenter.y };
    const unit = Math.hypot(out.x, out.y);
    const dir = { x: out.x / unit, y: out.y / unit };
    const at = (angle: number, from: { x: number; y: number }) => ({
      x: from.x + 22 * (Math.cos(angle) * dir.x - Math.sin(angle) * dir.y),
      y: from.y + 22 * (Math.sin(angle) * dir.x + Math.cos(angle) * dir.y)
    });
    const branch = at(0, ringAtom);
    const methylA = at(Math.PI / 3, branch), methylB = at(-Math.PI / 3, branch);
    const grown: MoleculeObject = {
      ...molecule,
      atoms: [...molecule.atoms,
        { id: "b", element: "C", formalCharge: 0, ...branch },
        { id: "m1", element: "C", formalCharge: 0, ...methylA },
        { id: "m2", element: "C", formalCharge: 0, ...methylB }],
      bonds: [...molecule.bonds,
        { id: "x1", fromAtomId: ringAtom.id, toAtomId: "b", order: "single" },
        { id: "x2", fromAtomId: "b", toAtomId: "m1", order: "single" },
        { id: "x3", fromAtomId: "b", toAtomId: "m2", order: "single" }]
    } as MoleculeObject;
    const withBranch = { ...document, pages: [{ ...document.pages[0], objects: [grown] }] } as ChemDraftDocument;
    const charged = commit(applyChargeToolAtNativeAtom(withBranch, HOVER_KEY_POSITIVE_CHARGE,
      { objectId: molecule.id, kind: "atom", atomId: "b", distanceToPointer: 0 }));
    const mark = charged.pages[0].objects.find((object) => object.type === "electron-mark")!;
    const center = { x: mark.x + mark.width / 2, y: mark.y + mark.height / 2 };
    // Straight on, away from the ring (between the two methyls' outer sides, not toward the ring or a methyl).
    const along = ((center.x - branch.x) * dir.x + (center.y - branch.y) * dir.y) / Math.hypot(center.x - branch.x, center.y - branch.y);
    expect(along).toBeGreaterThan(0.95);
  });

  it("gives a charge mark a click area a little wider than the mark, hidden from exports", () => {
    const { document, molecule } = ring();
    const charged = commit(applyChargeToolAtNativeAtom(document, HOVER_KEY_POSITIVE_CHARGE,
      { objectId: molecule.id, kind: "atom", atomId: molecule.atoms[0]!.id, distanceToPointer: 0 }));
    const mark = charged.pages[0].objects.find((object) => object.type === "electron-mark")!;
    const svg = exportDocumentToSvg(charged).contents as string;
    expect(svg).not.toContain("charge-hit-area");
    expect(CHARGE_MARK_HIT_MARGIN_PX).toBeGreaterThan(0);
    expect(mark.width).toBe(13.5);
  });

  it("shows the plain + and − tools with uncircled icons in the Charge drop-down", () => {
    const main = desktopToolsetRegistry.listToolsets().find((toolset) => toolset.id === "core.main")!;
    const owner = main.groups.flatMap((group) => group.items).find((item) => item.id === "tool.charge")!;
    const asset = (commandId: string) => owner.submenu?.items.find((item) => item.commandId === commandId)?.assetName;
    expect(asset("tool.plusPlain")).toBe("Custom_PlusPlain");
    expect(asset("tool.minusPlain")).toBe("Custom_MinusPlain");
    expect(asset("tool.plus")).toBe("Custom_CirclePlus");
  });
});
