import { describe, expect, it } from "vitest";
import { applyPatches, type ChemDraftDocument, type GraphicObject } from "@chemdraft/chem-core";
import { createLayerActions } from "./commands";
import {
  alignSelectedDocumentObjects,
  applyNativeArtLineToolAtPoint,
  createNewDrawingDocument,
  selectionHasAlignStraightenableLine
} from "./documentWorkflow";

function drawLine(document: ChemDraftDocument, start: { x: number; y: number }, end: { x: number; y: number }, commandId: string) {
  const next = applyNativeArtLineToolAtPoint(document, start, end, commandId);
  return { document: next, id: next.selection.objectIds[0]! };
}

function graphic(document: ChemDraftDocument, id: string): GraphicObject {
  const object = document.pages[0]!.objects.find((candidate) => candidate.id === id);
  if (object?.type !== "graphic") throw new Error(`Expected graphic ${id}`);
  return object;
}

function select(document: ChemDraftDocument, ids: string[]): ChemDraftDocument {
  return applyPatches(document, [{ op: "setSelection", pageId: document.pages[0]!.id, objectIds: ids }]);
}

describe("Align Middle / Align Center straighten slanted lines and arrows", () => {
  it("Align Middle levels a single slanted arrow about its midpoint, keeping length and direction", () => {
    const { document, id } = drawLine(createNewDrawingDocument(), { x: 300, y: 210 }, { x: 100, y: 190 }, "tool.art.reactionArrow");
    expect(selectionHasAlignStraightenableLine(document, "middle")).toBe(true);
    expect(selectionHasAlignStraightenableLine(document, "center")).toBe(false);
    const actions = createLayerActions(document, false);
    expect(actions.find((action) => action.id === "layout.alignMiddle")?.enabled).toBe(true);
    expect(actions.find((action) => action.id === "layout.alignCenter")?.enabled).toBe(false);

    const aligned = alignSelectedDocumentObjects(document, "middle");
    const line = graphic(aligned, id);
    const length = Math.hypot(200, 20);
    expect(line.data.lineStart!.y).toBeCloseTo(200, 6);
    expect(line.data.lineEnd!.y).toBeCloseTo(200, 6);
    // Still pointing right-to-left, centred where it was.
    expect(line.data.lineStart!.x).toBeCloseTo(200 + length / 2, 6);
    expect(line.data.lineEnd!.x).toBeCloseTo(200 - length / 2, 6);
    expect(line.y).toBeLessThan(200);
    expect(line.y + line.height).toBeGreaterThan(200);
  });

  it("Align Center stands a nearly vertical line upright", () => {
    const { document, id } = drawLine(createNewDrawingDocument(), { x: 150, y: 100 }, { x: 160, y: 300 }, "tool.art.line");
    const aligned = alignSelectedDocumentObjects(document, "center");
    const line = graphic(aligned, id);
    expect(line.data.lineStart!.x).toBeCloseTo(155, 6);
    expect(line.data.lineEnd!.x).toBeCloseTo(155, 6);
    expect(line.data.lineEnd!.y).toBeGreaterThan(line.data.lineStart!.y);
  });

  it("leaves a line nearer the other direction, and a level one, unchanged", () => {
    const steep = drawLine(createNewDrawingDocument(), { x: 150, y: 100 }, { x: 170, y: 300 }, "tool.art.line");
    expect(alignSelectedDocumentObjects(steep.document, "middle")).toBe(steep.document);
    const level = drawLine(createNewDrawingDocument(), { x: 100, y: 200 }, { x: 300, y: 200 }, "tool.art.line");
    expect(selectionHasAlignStraightenableLine(level.document, "middle")).toBe(false);
    expect(alignSelectedDocumentObjects(level.document, "middle")).toBe(level.document);
  });

  it("with other objects selected, levels the arrow and then lines everything up on the middle", () => {
    const first = drawLine(createNewDrawingDocument(), { x: 100, y: 100 }, { x: 300, y: 130 }, "tool.art.reactionArrow");
    const second = drawLine(first.document, { x: 400, y: 300 }, { x: 600, y: 300 }, "tool.art.line");
    const both = select(second.document, [first.id, second.id]);
    const aligned = alignSelectedDocumentObjects(both, "middle");
    const arrow = graphic(aligned, first.id), line = graphic(aligned, second.id);
    expect(arrow.data.lineStart!.y).toBeCloseTo(arrow.data.lineEnd!.y, 6);
    expect(arrow.y + arrow.height / 2).toBeCloseTo(line.y + line.height / 2, 6);
  });
});
