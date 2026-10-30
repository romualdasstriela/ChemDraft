import { describe, expect, it } from "vitest";
import type { MoleculeObject } from "@chemdraft/chem-core";
import {
  applyNativeAtomElementTarget,
  applySingleBondToolAtPoint,
  createPhase4Document,
  insertNativeTemplateMolecule,
  nativeMoleculeInvalidAtomStates
} from "./documentWorkflow";
import { nativeHoverLetterLabels } from "./commands";

function molecule(document: ReturnType<typeof createPhase4Document>): MoleculeObject {
  const object = document.pages[0].objects.find((candidate): candidate is MoleculeObject => candidate.type === "molecule");
  if (!object) throw new Error("Expected molecule");
  return object;
}

describe("hover letter labels", () => {
  it("never carry the unrecognised-label badge, on a ring carbon or a chain end", () => {
    const ring = insertNativeTemplateMolecule(createPhase4Document("Ring"), { x: 300, y: 300 }, "cyclohexane");
    const chain = applySingleBondToolAtPoint(createPhase4Document("Chain"), { x: 200, y: 200 });
    for (const letter of nativeHoverLetterLabels) {
      for (const document of [ring, chain]) {
        const before = molecule(document);
        const atomId = before.atoms[0]!.id;
        const labelled = molecule(applyNativeAtomElementTarget(document, { objectId: before.id, kind: "atom", atomId, distanceToPointer: 0 }, letter));
        expect(labelled.atoms[0]!.element).toBe(letter);
        expect(nativeMoleculeInvalidAtomStates(labelled).find((state) => state.atomId === atomId)?.invalidReason, letter).toBeUndefined();
      }
    }
  });
});
