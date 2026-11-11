import { describe, expect, it } from "vitest";
import {
  createPhase4Document,
  insertNativeArtGraphicObject,
  objectEdgeStretch,
  stretchDocumentObjectFromEdge
} from "./documentWorkflow";
import type { ChemDraftDocument } from "@chemdraft/chem-core";

function frame(document: ChemDraftDocument, objectId: string) {
  const object = document.pages[0].objects.find((candidate) => candidate.id === objectId);
  if (!object) {
    throw new Error("Expected the shape.");
  }
  return { x: object.x, y: object.y, width: object.width, height: object.height, rotation: object.rotation };
}

describe("stretching a shape by one side", () => {
  const box = { x: 100, y: 100, width: 80, height: 40, rotation: 0 };

  it("moves only the dragged side; the opposite side stays", () => {
    // Right side dragged from x 180 to x 220: 120 wide, left side still at 100.
    expect(objectEdgeStretch(box, "right", { x: 220, y: 130 })).toEqual({ scaleX: 1.5, scaleY: 1, dx: 20, dy: 0 });
    // Left side dragged out to x 60: right side stays at 180.
    expect(objectEdgeStretch(box, "left", { x: 60, y: 999 })).toEqual({ scaleX: 1.5, scaleY: 1, dx: -20, dy: 0 });
    // Bottom side up to y 120: top stays at 100, half the height.
    expect(objectEdgeStretch(box, "bottom", { x: 0, y: 120 })).toEqual({ scaleX: 1, scaleY: 0.5, dx: 0, dy: -10 });
    expect(objectEdgeStretch(box, "top", { x: 0, y: 60 })).toEqual({ scaleX: 1, scaleY: 2, dx: 0, dy: -20 });
  });

  it("never flips or collapses the shape when a side is dragged past the other", () => {
    const stretch = objectEdgeStretch(box, "right", { x: 20, y: 130 });
    expect(stretch?.scaleX).toBeCloseTo(2 / 80);
    expect(stretch?.scaleY).toBe(1);
  });

  it("stretches a rotated shape along its own width", () => {
    // Rotated 90° about its centre (140, 120): its width runs down the page, from y 80 to its
    // "right" side at y 160. Dragging that side to y 200 makes it 120 long, the top end kept.
    const turned = { ...box, rotation: 90 };
    const stretch = objectEdgeStretch(turned, "right", { x: 140, y: 200 });
    expect(stretch?.scaleX).toBeCloseTo(1.5);
    expect(stretch?.scaleY).toBe(1);
    expect(stretch?.dx).toBeCloseTo(0);
    expect(stretch?.dy).toBeCloseTo(20);
  });

  it("applies to a drawn rectangle: wider, left side and height unchanged", () => {
    const document = insertNativeArtGraphicObject(createPhase4Document("Stretch"), { x: 220, y: 180 }, "tool.art.rect");
    const objectId = document.selection.objectIds[0]!;
    const before = frame(document, objectId);
    const rightSide = before.x + before.width;
    const stretched = stretchDocumentObjectFromEdge(document, objectId, "right", {
      x: rightSide + 50,
      y: before.y + before.height / 2
    });
    const after = frame(stretched, objectId);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.width).toBeCloseTo(before.width + 50);
    expect(after.y).toBeCloseTo(before.y);
    expect(after.height).toBeCloseTo(before.height);
  });
});
