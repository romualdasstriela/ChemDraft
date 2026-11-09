import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { parseSvgPathData, svgToEmf } from "./emf";

const domParser = new new JSDOM("").window.DOMParser();

interface EmfRecord { type: number; size: number; offset: number }

function records(bytes: Uint8Array): EmfRecord[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const list: EmfRecord[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const type = view.getUint32(offset, true);
    const size = view.getUint32(offset + 4, true);
    expect(size % 4).toBe(0);
    expect(size).toBeGreaterThanOrEqual(8);
    list.push({ type, size, offset });
    offset += size;
  }
  expect(offset).toBe(bytes.length);
  return list;
}

function textOf(bytes: Uint8Array, record: EmfRecord): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(record.offset + 44, true);
  const offString = view.getUint32(record.offset + 48, true);
  let text = "";
  for (let i = 0; i < count; i += 1) text += String.fromCharCode(view.getUint16(record.offset + offString + i * 2, true));
  return text;
}

const sample = `<svg xmlns="http://www.w3.org/2000/svg" width="96px" height="48px" viewBox="0 0 96 48">
  <rect width="96" height="48" fill="#ffffff" />
  <line x1="10" y1="10" x2="40" y2="10" stroke="#000000" stroke-width="2" />
  <path d="M 50 10 Q 60 0 70 10 A 5 5 0 0 1 80 10 Z" fill="#ff0000" fill-opacity="0.5" />
  <circle cx="20" cy="30" r="5" fill="#0000ff" />
  <g transform="translate(60 30)" font-family="Arial, Helvetica, sans-serif" font-size="15">
    <text x="0" y="0" text-anchor="middle" fill="#ffffff" stroke="#ffffff" stroke-width="4" aria-hidden="true">NH</text>
    <text x="0" y="0" dy="0.35em" text-anchor="middle">NH</text>
    <text x="9.9" y="5.1" dy="0.35em" font-size="10.8">2</text>
  </g>
  <g filter="url(#shadow)"><rect x="1" y="1" width="2" height="2" /></g>
</svg>`;

describe("svgToEmf", () => {
  it("writes a well-formed metafile at the drawing's physical size", () => {
    const result = svgToEmf(sample, { domParser });
    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(1); // EMR_HEADER
    expect(view.getUint32(40, true)).toBe(0x464d4520); // " EMF"
    // 96 px = 1 inch = 25.4 mm wide, 12.7 mm high.
    expect(result.widthHmm).toBe(2540);
    expect(result.heightHmm).toBe(1270);
    expect(view.getInt32(32, true)).toBe(2539);
    const list = records(result.bytes);
    expect(view.getUint32(48, true)).toBe(result.bytes.length);
    expect(view.getUint32(52, true)).toBe(list.length);
    expect(list[list.length - 1]!.type).toBe(14); // EMR_EOF
    expect(result.omitted).toContain("filter effects (shadows, glows)");
  });

  it("writes labels as text records, without their white halo copies", () => {
    const result = svgToEmf(sample, { domParser });
    const texts = records(result.bytes).filter((record) => record.type === 84).map((record) => textOf(result.bytes, record));
    expect(texts).toEqual(["NH", "2"]);
    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
    const first = records(result.bytes).find((record) => record.type === 84)!;
    // "NH" centred on x = 60 px: starts half its Helvetica width (0.722 + 0.722 em × 15 px) left.
    const expectedStartPx = 60 - (0.722 + 0.722) * 15 / 2;
    expect(view.getInt32(first.offset + 36, true)).toBeCloseTo(expectedStartPx * 2540 / 96, -1);
  });

  it("blends opacity against white and fills, strokes and closes paths", () => {
    const result = svgToEmf(sample, { domParser });
    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
    const brushColors = records(result.bytes)
      .filter((record) => record.type === 39)
      .map((record) => view.getUint32(record.offset + 16, true));
    expect(brushColors).toContain(0x008080ff); // 50 % red on white, as 0x00BBGGRR
    expect(brushColors).toContain(0x00ff0000); // blue
    const types = new Set(records(result.bytes).map((record) => record.type));
    for (const type of [5, 59, 60, 61, 62, 64, 95]) expect(types.has(type)).toBe(true);
  });

  it("reads SVG path data into absolute lines and cubics", () => {
    const segments = parseSvgPathData("m 10 10 h 5 v 5 l -5 0 z M 0 0 C 1 1 2 2 3 3 S 5 5 6 6 Q 7 7 8 8 A 2 2 0 0 1 12 8");
    expect(segments[0]).toEqual({ kind: "move", x: 10, y: 10 });
    expect(segments[1]).toEqual({ kind: "line", x: 15, y: 10 });
    expect(segments[2]).toEqual({ kind: "line", x: 15, y: 15 });
    expect(segments[4]).toEqual({ kind: "close" });
    const last = segments[segments.length - 1]!;
    expect(last).toMatchObject({ kind: "cubic" });
    expect(last.kind === "cubic" && [Math.round(last.x), Math.round(last.y)]).toEqual([12, 8]);
  });

  it("refuses something that is not an SVG", () => {
    expect(() => svgToEmf("<html />", { domParser })).toThrow(/could not be parsed/);
  });
});
