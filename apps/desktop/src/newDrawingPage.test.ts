import { describe, expect, it } from "vitest";
import { mmToCssPx } from "@chemdraft/chem-core";
import { createNewDrawingDocument, createPhase4Document } from "./documentWorkflow";

describe("a new drawing's page", () => {
  it("is A4 portrait, measured in millimetres", () => {
    const page = createNewDrawingDocument().pages[0]!;
    expect(page.layout.presetId).toBe("a4");
    expect(page.layout.orientation).toBe("portrait");
    expect(page.layout.sourceUnit).toBe("mm");
    expect(page.width).toBeCloseTo(mmToCssPx(210));
    expect(page.height).toBeCloseTo(mmToCssPx(297));
  });

  it("keeps the title and is otherwise the same blank document", () => {
    const fresh = createNewDrawingDocument("Scheme.chemdraft");
    expect(fresh.title).toBe("Scheme.chemdraft");
    expect(fresh.pages[0]!.objects).toEqual([]);
    expect(fresh.pages[0]!.margin).toEqual(createPhase4Document().pages[0]!.margin);
  });
});
