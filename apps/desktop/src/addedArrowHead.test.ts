import { describe, expect, it } from "vitest";
import type { ChemDraftDocument, GraphicObject } from "@chemdraft/chem-core";
import {
  addedFilledArrowWidthScale,
  applyGraphicObjectMarkerKindToSelection,
  createNewDrawingDocument,
  insertNativeArtGraphicObject
} from "./documentWorkflow";

function selectedGraphic(document: ChemDraftDocument): GraphicObject {
  const id = document.selection.objectIds[0];
  const object = document.pages[0]!.objects.find((candidate) => candidate.id === id);
  if (object?.type !== "graphic") throw new Error("Expected a selected graphic");
  return object;
}

describe("Adding an arrowhead", () => {
  it("gives a filled head added to an arc a half-width base", () => {
    const arc = insertNativeArtGraphicObject(createNewDrawingDocument(), { x: 200, y: 200 }, "tool.art.arc90");
    expect(selectedGraphic(arc).data.markerEnd).toBeUndefined();
    const headed = applyGraphicObjectMarkerKindToSelection(arc, "markerEnd", "filled-arrow");
    expect(selectedGraphic(headed).data.markerEnd).toEqual({ kind: "filled-arrow", sizePx: 16, widthScale: addedFilledArrowWidthScale });
    expect(addedFilledArrowWidthScale).toBe(0.5);
    // A tail added later matches the head's base.
    const tailed = applyGraphicObjectMarkerKindToSelection(headed, "markerStart", "filled-arrow");
    expect(selectedGraphic(tailed).data.markerStart?.widthScale).toBe(0.5);
  });

  it("keeps the base width a filled head already has, and gives other kinds none", () => {
    const line = insertNativeArtGraphicObject(createNewDrawingDocument(), { x: 200, y: 200 }, "tool.art.reactionArrow");
    // The plain reaction arrow already carries a full-width filled head: switching to it again keeps it.
    const same = applyGraphicObjectMarkerKindToSelection(line, "markerEnd", "filled-arrow");
    expect(selectedGraphic(same).data.markerEnd?.widthScale).toBeUndefined();
    const open = applyGraphicObjectMarkerKindToSelection(line, "markerEnd", "open-arrow");
    expect(selectedGraphic(open).data.markerEnd).not.toHaveProperty("widthScale");
  });
});
