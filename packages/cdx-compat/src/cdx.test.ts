import { describe, expect, it } from "vitest";
import type { GraphicObject, MoleculeObject, TextObject } from "@chemdraft/chem-core";

import { cdxToCdxml, isCdxBytes, openChemDraftBytes, openChemDraftPayload } from "./index";

/** A tiny writer for the CDX layout, enough to build test files: objects, properties, ends. */
class CdxWriter {
  private readonly bytes: number[] = [];

  constructor() {
    // Signature, 4 bytes, 10 reserved: objects start at byte 22.
    this.bytes.push(..."VjCD0100".split("").map((char) => char.charCodeAt(0)), 4, 3, 2, 1, ...new Array(10).fill(0));
  }

  private u16(value: number) { this.bytes.push(value & 0xff, (value >> 8) & 0xff); return this; }
  private i32(value: number) { this.bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff); return this; }

  object(tag: number, id: number) { return this.u16(tag).i32(id); }
  end() { return this.u16(0); }
  property(tag: number, data: number[]) { this.u16(tag).u16(data.length); this.bytes.push(...data); return this; }

  static int16 = (value: number) => [value & 0xff, (value >> 8) & 0xff];
  static int32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
  static fixed = (points: number) => CdxWriter.int32(Math.round(points * 65536));
  /** 2D point: y first. */
  static point2D = (x: number, y: number) => [...CdxWriter.fixed(y), ...CdxWriter.fixed(x)];
  /** 3D point: x, y, z. */
  static point3D = (x: number, y: number, z: number) => [...CdxWriter.fixed(x), ...CdxWriter.fixed(y), ...CdxWriter.fixed(z)];
  /** Text: one style run (start, font, face, size in 1/20 pt, colour), then the characters. */
  static text = (value: string, face = 0) => [
    ...CdxWriter.int16(1), ...CdxWriter.int16(0), ...CdxWriter.int16(3), ...CdxWriter.int16(face), ...CdxWriter.int16(200), ...CdxWriter.int16(0),
    ...value.split("").map((char) => char.charCodeAt(0))
  ];

  toBytes() { return new Uint8Array(this.bytes); }
}

const W = CdxWriter;

/** Document with a colour table, one page, an O=C fragment, a caption, an arrow and an unknown object. */
function sampleCdx(): Uint8Array {
  const writer = new CdxWriter();
  writer.object(0x8000, 1)
    // Colour table: white, black, red (so colour 4 is red).
    .property(0x0300, [...W.int16(3), ...[0xffff, 0xffff, 0xffff, 0, 0, 0, 0xffff, 0, 0].flatMap(W.int16)])
    .object(0x8001, 2)
    .object(0x8003, 3)
    .object(0x8004, 4).property(0x0200, W.point2D(100, 50)).property(0x0402, W.int16(8))
    .object(0x8006, 0).property(0x0200, W.point2D(97, 54)).property(0x0700, W.text("O")).end()
    .end()
    // An atom that has only a 3D position.
    .object(0x8004, 5).property(0x0201, W.point3D(114.4, 50, -9)).end()
    .object(0x8005, 6).property(0x0604, W.int32(4)).property(0x0605, W.int32(5)).property(0x0600, W.int16(2)).end()
    .end()
    .object(0x8006, 7).property(0x0200, W.point2D(100, 100)).property(0x0301, W.int16(4)).property(0x0700, W.text("Slow addition\rin situ")).end()
    .object(0x8021, 8)
    .property(0x0207, W.point3D(200, 80, 0)).property(0x0208, W.point3D(140, 80, 0))
    .property(0x0a35, W.int16(2)).property(0x0a2f, W.int16(1))
    .end()
    .object(0x8099, 9).object(0x8004, 10).end().end()
    .end()
    .end();
  return writer.toBytes();
}

describe("ChemDraw binary (.cdx) files", () => {
  it("recognises the signature", () => {
    expect(isCdxBytes(sampleCdx())).toBe(true);
    expect(isCdxBytes(new TextEncoder().encode("<CDXML/>"))).toBe(false);
  });

  it("writes the object tree as CDXML: points x first, 3D positions, text, colours", () => {
    const { contents } = cdxToCdxml(sampleCdx());
    expect(contents).toContain('<colortable><color r="1" g="1" b="1"/><color r="0" g="0" b="0"/><color r="1" g="0" b="0"/></colortable>');
    expect(contents).toContain('<n id="4" p="100 50" Element="8">');
    expect(contents).toContain('<n id="5" xyz="114.4 50 -9">');
    expect(contents).toContain('<b id="6" B="4" E="5" Order="2">');
    expect(contents).toContain(">Slow addition\nin situ</s>");
    expect(contents).toContain('Head3D="200 80 0"');
    expect(contents).toContain('ArrowheadHead="Full"');
  });

  it("opens as a drawing: the structure, the caption in its colour, the arrow", () => {
    const opened = openChemDraftBytes(sampleCdx());
    const objects = opened.document?.pages[0]?.objects ?? [];
    const molecule = objects.find((object): object is MoleculeObject => object.type === "molecule");
    expect(molecule?.atoms.map((atom) => atom.element)).toEqual(["O", "C"]);
    expect(molecule?.bonds[0]?.order).toBe("double");
    // The 3D-only atom sits at its x and y, beside the oxygen, not at the page corner.
    expect(molecule!.atoms[1]!.x).toBeGreaterThan(molecule!.atoms[0]!.x);
    expect(molecule!.atoms[1]!.y).toBeCloseTo(molecule!.atoms[0]!.y);
    const caption = objects.find((object): object is TextObject => object.type === "text");
    expect(caption?.text).toBe("Slow addition\nin situ");
    const arrow = objects.find((object): object is GraphicObject => object.type === "graphic");
    expect(arrow?.data.artToolId).toBe("reactionArrow");
    expect(opened.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining(["cdx.objects_skipped", "cdx.imported"]));
  });

  it("reads the base64 form the app hands over for a file", () => {
    const bytes = sampleCdx();
    const base64 = btoa(String.fromCharCode(...bytes));
    expect(base64.startsWith("VmpDRDAx")).toBe(true);
    expect(openChemDraftPayload(base64).document).toBeDefined();
  });

  it("shows what it read of a file that stops part-way, and says it was cut short", () => {
    const bytes = sampleCdx();
    const cut = bytes.subarray(0, bytes.length - 40);
    const result = cdxToCdxml(cut);
    expect(result.warnings.map((warning) => warning.code)).toContain("cdx.truncated");
    expect(result.contents).toContain('Element="8"');
  });
});
