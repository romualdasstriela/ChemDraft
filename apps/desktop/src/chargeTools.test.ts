import { describe, expect, it } from "vitest";
import type { ChemDraftDocument, MoleculeObject } from "@chemdraft/chem-core";
import { planMoleculeAtomLabels } from "@chemdraft/layout-engine";
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

  it("shows the plain + and − tools with uncircled icons in the Charge drop-down", () => {
    const main = desktopToolsetRegistry.listToolsets().find((toolset) => toolset.id === "core.main")!;
    const owner = main.groups.flatMap((group) => group.items).find((item) => item.id === "tool.charge")!;
    const asset = (commandId: string) => owner.submenu?.items.find((item) => item.commandId === commandId)?.assetName;
    expect(asset("tool.plusPlain")).toBe("Custom_PlusPlain");
    expect(asset("tool.minusPlain")).toBe("Custom_MinusPlain");
    expect(asset("tool.plus")).toBe("Custom_CirclePlus");
  });
});
