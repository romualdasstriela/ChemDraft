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
  it("places a closed triangle whose corners touch its frame", () => {
    const { object } = placed("tool.art.triangle");
    expect(object.data).toMatchObject({ artPathKind: "polyline", pathClosed: true, artToolId: "triangle" });
    const nodes = object.data.pathNodes!.map((node) => node.point);
    expect(nodes).toHaveLength(3);
    expect(Math.min(...nodes.map((p) => p.x))).toBeCloseTo(object.x, 6);
    expect(Math.max(...nodes.map((p) => p.x))).toBeCloseTo(object.x + object.width, 6);
    expect(Math.min(...nodes.map((p) => p.y))).toBeCloseTo(object.y, 6);
    expect(Math.max(...nodes.map((p) => p.y))).toBeCloseTo(object.y + object.height, 6);
  });

  it("places a five-pointed star: ten corners alternating out and in, point up", () => {
    const { object } = placed("tool.art.star");
    const nodes = object.data.pathNodes!.map((node) => node.point);
    expect(nodes).toHaveLength(10);
    const center = { x: object.x + object.width / 2, y: nodes[0]!.y + 26 };
    const radii = nodes.map((p) => Math.hypot(p.x - center.x, p.y - center.y));
    radii.forEach((radius, index) => expect(radius).toBeCloseTo(index % 2 === 0 ? 26 : 26 * 0.382, 1));
    expect(nodes[0]!.y).toBeCloseTo(object.y, 6);
    expect(nodes[0]!.x).toBeCloseTo(center.x, 1);
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
