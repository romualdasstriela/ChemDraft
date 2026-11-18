import { describe, expect, it } from "vitest";
import { artworkPathBounds } from "@chemdraft/art-engine";
import type { ChemDraftDocument, GraphicObject } from "@chemdraft/chem-core";
import { createNewDrawingDocument, insertNativeArtGraphicObject, scaleDocumentObjectsAroundPoint } from "./documentWorkflow";

function placed(commandId: string): { document: ChemDraftDocument; object: GraphicObject } {
  const document = insertNativeArtGraphicObject(createNewDrawingDocument(), { x: 300, y: 300 }, commandId);
  const object = document.pages[0]!.objects.find((candidate): candidate is GraphicObject => candidate.type === "graphic");
  if (!object) throw new Error(`${commandId} placed nothing`);
  return { document, object };
}

describe("Shape tool: triangle, star, ball, cylinder", () => {
  function corners(pathD: string): { x: number; y: number }[] {
    const numbers = pathD.match(/-?[\d.]+/g)!.map(Number);
    return Array.from({ length: numbers.length / 2 }, (_, index) => ({ x: numbers[index * 2]!, y: numbers[index * 2 + 1]! }));
  }

  function resized(commandId: string, scaleX: number, scaleY: number) {
    const { document, object } = placed(commandId);
    const center = { x: object.x + object.width / 2, y: object.y + object.height / 2 };
    const next = scaleDocumentObjectsAroundPoint(document, [object.id], center, scaleX, scaleY);
    return { before: object, after: next.pages[0]!.objects.find((candidate): candidate is GraphicObject => candidate.id === object.id)! };
  }

  it("places a triangle as one whole outline filling its frame", () => {
    const { object } = placed("tool.art.triangle");
    expect(object.data.pathNodes).toBeUndefined();
    expect(object.data.artToolId).toBe("triangle");
    expect(corners(String(object.data.pathD))).toEqual([{ x: 28, y: 0 }, { x: 56, y: 48 }, { x: 0, y: 48 }]);
    expect(artworkPathBounds(String(object.data.pathD))).toMatchObject({ x: 0, y: 0, width: object.width, height: object.height });
  });

  it("places a five-pointed star as one whole outline: ten corners alternating out and in, point up", () => {
    const { object } = placed("tool.art.star");
    expect(object.data.pathNodes).toBeUndefined();
    const points = corners(String(object.data.pathD));
    expect(points).toHaveLength(10);
    const center = { x: object.width / 2, y: 26 };
    points.forEach((p, index) => expect(Math.hypot(p.x - center.x, p.y - center.y)).toBeCloseTo(index % 2 === 0 ? 26 : 26 * 0.382, 1));
    expect(points[0]).toEqual({ x: expect.closeTo(center.x, 1), y: 0 });
    const bounds = artworkPathBounds(String(object.data.pathD));
    expect(bounds.width).toBeCloseTo(object.width, 6);
    expect(bounds.height).toBeCloseTo(object.height, 6);
  });

  it("resizes the star and the triangle as whole objects, the drawing stretching with the box", () => {
    for (const commandId of ["tool.art.star", "tool.art.triangle"]) {
      const { before, after } = resized(commandId, 2, 1.5);
      expect(after.width).toBeCloseTo(before.width * 2, 6);
      expect(after.height).toBeCloseTo(before.height * 1.5, 6);
      const bounds = artworkPathBounds(String(after.data.pathD));
      expect(bounds.width).toBeCloseTo(after.width, 1);
      expect(bounds.height).toBeCloseTo(after.height, 1);
    }
  });

  it("places a ball as a glossy circle", () => {
    const { object } = placed("tool.art.ball");
    expect(object).toMatchObject({ graphicKind: "ellipse", width: 48, height: 48 });
    expect(object.style.fillMode).toBe("gloss");
  });

  it("places a cylinder that fills its box and scales with it", () => {
    const { document, object } = placed("tool.art.cylinder");
    expect(artworkPathBounds(String(object.data.pathD))).toMatchObject({ x: 0, y: 0, width: 48, height: 64 });
    const center = { x: object.x + object.width / 2, y: object.y + object.height / 2 };
    const resized = scaleDocumentObjectsAroundPoint(document, [object.id], center, 1.5, 2);
    const after = resized.pages[0]!.objects.find((candidate): candidate is GraphicObject => candidate.id === object.id)!;
    expect(after.width).toBeCloseTo(72, 6);
    expect(after.height).toBeCloseTo(128, 6);
    const bounds = artworkPathBounds(String(after.data.pathD));
    expect(bounds.width).toBeCloseTo(72, 1);
    expect(bounds.height).toBeCloseTo(128, 1);
  });
});
