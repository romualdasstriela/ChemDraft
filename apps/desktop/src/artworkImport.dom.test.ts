// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { artworkPathBounds } from "@chemdraft/art-engine";
import type { GraphicObject, GroupObject } from "@chemdraft/chem-core";
import { ArtworkImportError, cssColorHex, parseArtworkFile, parseEpsArtwork, parseSvgArtwork } from "./artworkImport";
import { createNewDrawingDocument, insertArtworkLayers, insertedArtworkPageMarginPx, scaleDocumentObjectsAroundPoint } from "./documentWorkflow";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("Insert Artwork: SVG", () => {
  it("reads shapes through transforms, CSS classes and <use>, grouped by paint", () => {
    const artwork = parseSvgArtwork(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 100">
      <style>.st0{fill:none;stroke:#00ff00;stroke-width:2}.st1{fill:#ff0000}</style>
      <defs><rect id="box" width="10" height="10"/></defs>
      <g transform="translate(100 0)"><rect class="st1" x="0" y="0" width="50" height="20"/></g>
      <circle class="st0" cx="20" cy="50" r="10"/>
      <path d="M0 90 h20 v10 h-20 z" fill="blue"/>
      <use xlink:href="#box" x="150" y="80" fill="blue"/>
      <text x="5" y="5">Hello</text>
    </svg>`);
    const red = artwork.layers.find((layer) => layer.color === "#ff0000")!;
    expect(red.mode).toBe("fill");
    expect(artworkPathBounds(red.pathD)).toMatchObject({ x: 100, y: 0, width: 50, height: 20 });
    const green = artwork.layers.find((layer) => layer.color === "#00ff00")!;
    expect(green).toMatchObject({ mode: "stroke", strokeWidth: 2 });
    expect(artworkPathBounds(green.pathD).width).toBeCloseTo(20, 1);
    // Both blue fills (the path and the <use> copy) share one layer, the name read as hex.
    const blue = artwork.layers.filter((layer) => layer.color === "#0000ff");
    expect(blue).toHaveLength(1);
    expect(artworkPathBounds(blue[0]!.pathD)).toMatchObject({ x: 0, y: 80, width: 160, height: 20 });
    expect(artwork.warnings.join(" ")).toContain("text");
    expect(artwork.pxPerUnit).toBe(1);
  });

  it("reads CSS colours as six-digit hex", () => {
    expect(cssColorHex("#d33")).toBe("#dd3333");
    expect(cssColorHex("rgb(255, 0, 128)")).toBe("#ff0080");
    expect(cssColorHex("rgb(100%,50%,0%)")).toBe("#ff8000");
    expect(cssColorHex("Navy")).toBe("#000080");
    expect(cssColorHex("#11223344")).toBe("#112233");
    expect(cssColorHex("hsl(0, 50%, 50%)")).toBeUndefined();
  });

  it("refuses a file with nothing to place", () => {
    expect(() => parseSvgArtwork(`<svg xmlns="http://www.w3.org/2000/svg"><text>Only text</text></svg>`)).toThrow(ArtworkImportError);
    expect(() => parseSvgArtwork("not svg at all")).toThrow(ArtworkImportError);
  });
});

describe("Insert Artwork: EPS", () => {
  const eps = `%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 100 50
%%EndProlog
/sq { 0 0 m } def
0 0 1 rg
10 10 m 90 10 l 90 40 l h f
2 w 0 g 0 0 m 100 50 l S
%%Trailer`;

  it("reads fills and strokes with their colours, y turned to point down, procedures not run", () => {
    const artwork = parseEpsArtwork(bytes(eps));
    expect(artwork.pxPerUnit).toBeCloseTo(96 / 72, 6);
    const fill = artwork.layers.find((layer) => layer.mode === "fill")!;
    expect(fill.color).toBe("#0000ff");
    // PostScript y = 10..40 on a 50-high page reads 10..40 down from the top.
    expect(artworkPathBounds(fill.pathD)).toMatchObject({ x: 10, y: 10, width: 80, height: 30 });
    expect(fill.pathD).toMatch(/^M10 40/);
    const stroke = artwork.layers.find((layer) => layer.mode === "stroke")!;
    expect(stroke).toMatchObject({ color: "#000000", strokeWidth: 2 });
  });

  it("unwraps the DOS-binary EPS that Illustrator writes, and handles its flipped coordinates", () => {
    const body = `%!PS-Adobe-3.1 EPSF-3.0
%%HiResBoundingBox: 0 0 100 50
%%EndSetup
%%EndPageSetup
1 -1 scale 0 -50 translate
[1 0 0 1 0 0 ]ct
0 0 mo 100 0 li 100 50 li 0 50 li cp clp
10 10 mo 30 10 li 30 20 li cp f
%%PageTrailer`;
    const ps = bytes(body);
    const wrapped = new Uint8Array(30 + ps.length);
    const view = new DataView(wrapped.buffer);
    view.setUint32(0, 0xc5d0d3c6, false);
    view.setUint32(4, 30, true);
    view.setUint32(8, ps.length, true);
    wrapped.set(ps, 30);
    const artwork = parseArtworkFile("frame.eps", wrapped);
    expect(artwork.layers).toHaveLength(1);
    expect(artworkPathBounds(artwork.layers[0]!.pathD)).toMatchObject({ x: 10, y: 10, width: 20, height: 10 });
  });
});

describe("Insert Artwork: placing", () => {
  it("fits large artwork inside the page margin, centred, as one grouped selection", () => {
    const document = createNewDrawingDocument();
    const page = document.pages[0]!;
    const placed = insertArtworkLayers(document, [
      { mode: "fill", color: "#111111", pathD: "M0 0H2000V3000H0Z" },
      { mode: "stroke", color: "#ff0000", strokeWidth: 10, pathD: "M0 0L2000 3000" }
    ], 1, "big.svg");
    const objects = placed.pages[0]!.objects;
    const group = objects.find((object): object is GroupObject => object.type === "group")!;
    expect(placed.selection.objectIds).toEqual([group.id]);
    const fill = objects.find((object): object is GraphicObject => object.type === "graphic" && object.style.fillColor === "#111111")!;
    expect(fill.height).toBeCloseTo(page.height - 2 * insertedArtworkPageMarginPx, 6);
    expect(fill.x + fill.width / 2).toBeCloseTo(page.width / 2, 6);
    expect(artworkPathBounds(String(fill.data.pathD))).toMatchObject({ x: 0, y: 0 });
    const stroke = objects.find((object): object is GraphicObject => object.type === "graphic" && object.style.strokeColor === "#ff0000")!;
    expect(stroke.style.strokeWidth).toBeCloseTo(10 * fill.height / 3000, 6);
  });

  it("keeps small artwork at its own size, and a resize scales the drawing inside the box", () => {
    const document = createNewDrawingDocument();
    const placed = insertArtworkLayers(document, [{ mode: "fill", color: "#000", pathD: "M0 0H72V36H0Z" }], 96 / 72, "logo.eps");
    const object = placed.pages[0]!.objects.find((candidate): candidate is GraphicObject => candidate.type === "graphic")!;
    expect(object.width).toBeCloseTo(96, 6);
    expect(object.height).toBeCloseTo(48, 6);
    const center = { x: object.x + object.width / 2, y: object.y + object.height / 2 };
    const resized = scaleDocumentObjectsAroundPoint(placed, [object.id], center, 2, 1.5);
    const after = resized.pages[0]!.objects.find((candidate): candidate is GraphicObject => candidate.id === object.id)!;
    expect(after.width).toBeCloseTo(192, 6);
    expect(artworkPathBounds(String(after.data.pathD))).toMatchObject({ x: 0, y: 0, width: 192, height: 72 });
  });
});
