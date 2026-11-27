import { describe, expect, it } from "vitest";
import { applyPatches, type ChemDraftDocument, type GraphicObject } from "@chemdraft/chem-core";
import {
  applyNativeArtLineToolAtPoint,
  createNewDrawingDocument,
  moveDocumentObjects,
  nativeArtEndpointSnap,
  nativeArtMoveMagnet
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

  it("pulls a moved line's end onto another line's end, like a magnet", () => {
    const first = withLine(createNewDrawingDocument(), { x: 100, y: 100 }, { x: 200, y: 100 });
    const second = withLine(first.document, { x: 300, y: 300 }, { x: 400, y: 300 });
    // Moving the second line by (-97, -203) leaves its start 3 px from the first line's end (200,100).
    const magnet = nativeArtMoveMagnet(second.document, [second.id], -97, -203, 6)!;
    expect(magnet.join).toEqual({ x: 200, y: 100 });
    expect(magnet.offset.x).toBeCloseTo(-3, 6);
    expect(magnet.offset.y).toBeCloseTo(3, 6);
    // Applying the nudged move, the ends touch exactly; the lines stay two objects.
    const moved = moveDocumentObjects(second.document, [second.id], -97 + magnet.offset.x, -203 + magnet.offset.y);
    const lines = moved.pages[0]!.objects.filter((object): object is GraphicObject => object.type === "graphic");
    expect(lines).toHaveLength(2);
    expect(lines.find((line) => line.id === second.id)!.data.lineStart).toEqual({ x: 200, y: 100 });
  });

  it("lands a moved line's end anywhere along another line, and another line's end on a moved line's side", () => {
    const first = withLine(createNewDrawingDocument(), { x: 100, y: 100 }, { x: 200, y: 100 });
    const second = withLine(first.document, { x: 150, y: 300 }, { x: 150, y: 400 });
    // The second line's top (150,300) moved up by 196 sits 4 px below the middle of the first line.
    const tee = nativeArtMoveMagnet(second.document, [second.id], 0, -196, 6)!;
    expect(tee.join).toEqual({ x: 150, y: 100 });
    expect(tee.offset).toEqual({ x: 0, y: -4 });
    // Moving the first line instead: the second line's top end lands on the moved line's side.
    const side = nativeArtMoveMagnet(second.document, [first.id], 0, 197, 6)!;
    expect(side.join).toEqual({ x: 150, y: 300 });
    expect(side.offset.y).toBeCloseTo(3, 6);
  });

  it("prefers joining end to end over landing on a side, and leaves far lines alone", () => {
    const first = withLine(createNewDrawingDocument(), { x: 100, y: 100 }, { x: 200, y: 100 });
    const second = withLine(first.document, { x: 400, y: 400 }, { x: 500, y: 400 });
    // The moved start is 2 px from the side point (197,100) but 3.6 px from the end (200,100).
    const magnet = nativeArtMoveMagnet(second.document, [second.id], 197 - 400, 102 - 400, 6)!;
    expect(magnet.join).toEqual({ x: 200, y: 100 });
    expect(nativeArtMoveMagnet(second.document, [second.id], 0, 0, 6)).toBeUndefined();
  });

  it("draws a new line from a snapped end so the two touch exactly", () => {
    const first = withLine(createNewDrawingDocument(), { x: 100, y: 100 }, { x: 200, y: 100 });
    const start = nativeArtEndpointSnap(first.document, { x: 202, y: 98 }, 6)!;
    const second = withLine(first.document, start, { x: 260, y: 160 });
    const line = second.document.pages[0]!.objects.find((object): object is GraphicObject => object.id === second.id)!;
    expect(line.data.lineStart).toEqual({ x: 200, y: 100 });
  });
});
