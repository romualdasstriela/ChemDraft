import { describe, expect, it } from "vitest";
import { applyPatches, type ChemDraftDocument, type GraphicObject } from "@chemdraft/chem-core";
import {
  applyNativeArtLineToolAtPoint,
  createNewDrawingDocument,
  nativeArtEndpointSnap
} from "./documentWorkflow";

function withLine(document: ChemDraftDocument, start: { x: number; y: number }, end: { x: number; y: number }, commandId = "tool.art.line") {
  const next = applyNativeArtLineToolAtPoint(document, start, end, commandId);
  return { document: next, id: next.selection.objectIds[0]! };
}

describe("joining line and arrow ends", () => {
  it("snaps a point near another line's end onto that end exactly", () => {
    const { document } = withLine(createNewDrawingDocument(), { x: 100, y: 100 }, { x: 200, y: 100 });
    expect(nativeArtEndpointSnap(document, { x: 203, y: 104 }, 6)).toEqual({ x: 200, y: 100 });
    expect(nativeArtEndpointSnap(document, { x: 97, y: 99 }, 6)).toEqual({ x: 100, y: 100 });
    // Too far away: no snap.
    expect(nativeArtEndpointSnap(document, { x: 210, y: 100 }, 6)).toBeUndefined();
    // The middle of the line is not an end.
    expect(nativeArtEndpointSnap(document, { x: 150, y: 100 }, 6)).toBeUndefined();
  });

  it("joins arrows too, picks the nearest end, and leaves out the line being edited", () => {
    const first = withLine(createNewDrawingDocument(), { x: 100, y: 100 }, { x: 200, y: 100 });
    const second = withLine(first.document, { x: 204, y: 100 }, { x: 300, y: 160 }, "tool.art.reactionArrow");
    // Near both the line's end (200,100) and the arrow's tail (204,100): the nearer one wins.
    expect(nativeArtEndpointSnap(second.document, { x: 203, y: 101 }, 6)).toEqual({ x: 204, y: 100 });
    // Editing the arrow itself: its own tail is not a target, so the line's end is.
    expect(nativeArtEndpointSnap(second.document, { x: 203, y: 101 }, 6, new Set([second.id]))).toEqual({ x: 200, y: 100 });
  });

  it("ignores rotated graphics, whose stored ends are not where they are drawn", () => {
    const { document, id } = withLine(createNewDrawingDocument(), { x: 100, y: 100 }, { x: 200, y: 100 });
    const rotated = applyPatches(document, [{ op: "updateObject", objectId: id, changes: { rotation: 30 } as Partial<GraphicObject> }]);
    expect(nativeArtEndpointSnap(rotated, { x: 200, y: 100 }, 6)).toBeUndefined();
  });

  it("draws a new line from a snapped end so the two touch exactly", () => {
    const first = withLine(createNewDrawingDocument(), { x: 100, y: 100 }, { x: 200, y: 100 });
    const start = nativeArtEndpointSnap(first.document, { x: 202, y: 98 }, 6)!;
    const second = withLine(first.document, start, { x: 260, y: 160 });
    const line = second.document.pages[0]!.objects.find((object): object is GraphicObject => object.id === second.id)!;
    expect(line.data.lineStart).toEqual({ x: 200, y: 100 });
  });
});
