import { describe, expect, it } from "vitest";
import type { MoleculeObject } from "@chemdraft/chem-core";
import {
  applySingleBondToolAtPoint,
  createPhase4Document,
  createSelectionClipboardPayload,
  insertNativeTemplateMolecule,
  selectDocumentObjects,
  selectionClipboardImageDocument
} from "./documentWorkflow";
import { selectionClipboardTextItems, selectionClipboardWriteItems } from "./MainWindow";

function molecules(document: ReturnType<typeof createPhase4Document>): MoleculeObject[] {
  return document.pages[0].objects.filter((object): object is MoleculeObject => object.type === "molecule");
}

describe("Ctrl+C picture", () => {
  it("draws only the copied objects, cropped to them", () => {
    const withChain = applySingleBondToolAtPoint(createPhase4Document("Copy"), { x: 120, y: 120 });
    const both = insertNativeTemplateMolecule(withChain, { x: 500, y: 400 }, "cyclohexane");
    const [chain, ring] = molecules(both);
    const selected = selectDocumentObjects(both, both.pages[0].id, [ring!.id]);
    const payload = createSelectionClipboardPayload(selected)!;

    const picture = selectionClipboardImageDocument(selected, payload);
    const pictured = molecules(picture);
    expect(pictured.map((molecule) => molecule.id)).toEqual([ring!.id]);
    expect(pictured.map((molecule) => molecule.id)).not.toContain(chain!.id);
    expect(picture.pages[0].width).toBeLessThan(both.pages[0].width);
  });

  it("draws just the copied fragment of a partly selected molecule", () => {
    const ring = insertNativeTemplateMolecule(createPhase4Document("Copy"), { x: 300, y: 300 }, "cyclohexane");
    const molecule = molecules(ring)[0]!;
    const bond = molecule.bonds[0]!;
    const payload = createSelectionClipboardPayload(
      selectDocumentObjects(ring, ring.pages[0].id, []),
      [{ objectId: molecule.id, atomIds: [bond.fromAtomId, bond.toAtomId], bondIds: [bond.id] }]
    )!;

    const pictured = molecules(selectionClipboardImageDocument(ring, payload));
    expect(pictured).toHaveLength(1);
    expect(pictured[0]!.atoms).toHaveLength(2);
    expect(pictured[0]!.bonds).toHaveLength(1);
  });

  it("keeps ChemDraft's own selection on the clipboard, and drops plain text only beside a picture", () => {
    const ring = insertNativeTemplateMolecule(createPhase4Document("Copy"), { x: 300, y: 300 }, "cyclohexane");
    const payload = createSelectionClipboardPayload(ring)!;
    const items = selectionClipboardTextItems(payload);

    expect(selectionClipboardWriteItems(payload, false)).toEqual(items);
    const withPicture = selectionClipboardWriteItems(payload, true);
    expect(withPicture).toEqual(items.filter((item) => item.type !== "text/plain"));
    // The first item is ChemDraft's selection, which in-app paste reads.
    expect(withPicture[0]).toEqual(items[0]);
  });
});
