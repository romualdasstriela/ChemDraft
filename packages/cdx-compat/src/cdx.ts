/**
 * ChemDraw binary (.cdx) files, read by turning them into the CDXML they are the binary form of.
 *
 * A CDX file is the same object tree as CDXML (document, page, group, fragment, node, bond, text,
 * graphic, arrow, …), each object a tag and an id followed by its properties and its child objects.
 * This module walks that tree and writes it out as CDXML elements and attributes, so the one CDXML
 * importer reads both formats and the two cannot drift apart. It was written from the published
 * description of the CDX format, with no other program's code; tag numbers were checked against
 * real ChemDraw files.
 *
 * Layout of the file: the 8-byte signature "VjCD0100", 4 bytes and 10 reserved bytes, then objects
 * from byte 22.
 * An object is a 16-bit tag with the top bit set and a 32-bit id; a property is a 16-bit tag without
 * the top bit, a 16-bit length (0xFFFF: a 32-bit length follows) and its data; tag 0 ends an object.
 * Everything is little-endian. Coordinates are 32-bit fixed point, 1/65536 of a point; a 2D point is
 * stored y first, a 3D point x first, a rectangle top, left, bottom, right.
 *
 * Only what the CDXML importer reads is translated. Other properties are left out, which loses
 * nothing the importer would have used; an object kind the importer would not know is skipped and
 * counted in a warning.
 */

export const CdxSignature = "VjCD0100";

export interface CdxConversionWarning {
  code: string;
  message: string;
}

export interface CdxConversionResult {
  /** The CDXML text, or undefined when the bytes could not be read as a CDX file at all. */
  contents?: string;
  warnings: CdxConversionWarning[];
}

/** Whether these bytes start like a ChemDraw binary file. */
export function isCdxBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && String.fromCharCode(...bytes.subarray(0, 8)) === CdxSignature;
}

const objectElementNames: Readonly<Record<number, string>> = {
  0x8000: "CDXML",
  0x8001: "page",
  0x8002: "group",
  0x8003: "fragment",
  0x8004: "n",
  0x8005: "b",
  0x8006: "t",
  0x8007: "graphic",
  0x8008: "curve",
  0x8009: "embeddedobject",
  0x800a: "altgroup",
  0x800d: "scheme",
  0x800e: "step",
  0x8011: "objecttag",
  0x8017: "bracketedgroup",
  0x8018: "bracketattachment",
  0x8019: "crossingbond",
  0x8021: "arrow"
};

/** Objects that carry nothing a drawing shows (a document GUID, saved settings): skipped quietly. */
const silentlySkippedObjectTags = new Set([0x802b]);

type Decoder = (data: DataView, length: number) => string | undefined;

const FIXED = 65536;

const fixed = (value: number) => formatCdxNumber(value / FIXED);

function formatCdxNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}

function signedInteger(data: DataView, length: number): number | undefined {
  if (length === 1) return data.getInt8(0);
  if (length === 2) return data.getInt16(0, true);
  if (length === 4) return data.getInt32(0, true);
  return undefined;
}

function unsignedInteger(data: DataView, length: number): number | undefined {
  if (length === 1) return data.getUint8(0);
  if (length === 2) return data.getUint16(0, true);
  if (length === 4) return data.getUint32(0, true);
  return undefined;
}

const integer: Decoder = (data, length) => {
  const value = signedInteger(data, length);
  return value === undefined ? undefined : String(value);
};

const id: Decoder = (data, length) => {
  const value = unsignedInteger(data, length);
  return value === undefined ? undefined : String(value);
};

const idList: Decoder = (data, length) => {
  if (length % 4 !== 0) return undefined;
  const ids: string[] = [];
  for (let offset = 0; offset < length; offset += 4) ids.push(String(data.getUint32(offset, true)));
  return ids.join(" ");
};

/** 2D point, stored y then x; written "x y". */
const point2D: Decoder = (data, length) =>
  length >= 8 ? `${fixed(data.getInt32(4, true))} ${fixed(data.getInt32(0, true))}` : undefined;

/** 3D point, stored x, y, z; written "x y z". */
const point3D: Decoder = (data, length) =>
  length >= 12 ? `${fixed(data.getInt32(0, true))} ${fixed(data.getInt32(4, true))} ${fixed(data.getInt32(8, true))}` : undefined;

/** Rectangle, stored top, left, bottom, right; written "left top right bottom". */
const rectangle: Decoder = (data, length) =>
  length >= 16
    ? [4, 0, 12, 8].map((offset) => fixed(data.getInt32(offset, true))).join(" ")
    : undefined;

function enumeration(names: Readonly<Record<number, string>>): Decoder {
  return (data, length) => {
    const value = signedInteger(data, length);
    return value === undefined ? undefined : names[value];
  };
}

/** A flag set, written as the names of the flags that are set ("RoundEdge Shadow"), or `none`. */
function flags(names: ReadonlyArray<readonly [number, string]>, none: string): Decoder {
  return (data, length) => {
    const value = unsignedInteger(data, length);
    if (value === undefined) return undefined;
    const set = names.filter(([bit]) => (value & bit) !== 0).map(([, name]) => name);
    return set.length > 0 ? set.join(" ") : none;
  };
}

/** Points of a curve: a count then the points (2D, y first), or the points alone. */
const curvePoints: Decoder = (data, length) => {
  const counted = length >= 2 && (length - 2) % 8 === 0 && data.getUint16(0, true) * 8 === length - 2;
  const start = counted ? 2 : 0;
  if ((length - start) % 8 !== 0) return undefined;
  const values: string[] = [];
  for (let offset = start; offset < length; offset += 8) {
    values.push(fixed(data.getInt32(offset + 4, true)), fixed(data.getInt32(offset, true)));
  }
  return values.join(" ");
};

/** 3D points of a curve (x, y, z each); written as the 2D `CurvePoints` the importer reads. */
const curvePoints3D: Decoder = (data, length) => {
  const counted = length >= 2 && (length - 2) % 12 === 0 && data.getUint16(0, true) * 12 === length - 2;
  const start = counted ? 2 : 0;
  if ((length - start) % 12 !== 0) return undefined;
  const values: string[] = [];
  for (let offset = start; offset < length; offset += 12) {
    values.push(fixed(data.getInt32(offset, true)), fixed(data.getInt32(offset + 4, true)));
  }
  return values.join(" ");
};

/** Bond order: a flag set (single 1, double 2, triple 4, …); several flags mean "any of these". */
const bondOrder: Decoder = (data, length) => {
  const value = unsignedInteger(data, length);
  if (value === undefined) return undefined;
  const names: ReadonlyArray<readonly [number, string]> = [
    [0x0001, "1"], [0x0002, "2"], [0x0004, "3"], [0x0008, "4"], [0x0010, "5"], [0x0020, "6"],
    [0x0040, "0.5"], [0x0080, "1.5"], [0x0100, "2.5"], [0x0200, "3.5"], [0x0400, "4.5"], [0x0800, "5.5"],
    [0x1000, "dative"], [0x2000, "ionic"], [0x4000, "hydrogen"], [0x8000, "threecenter"]
  ];
  const set = names.filter(([bit]) => (value & bit) !== 0).map(([, name]) => name);
  return set.length > 0 ? set.join(" ") : undefined;
};

/** Charge: one byte, or (newer files) four. */
const charge: Decoder = (data, length) => {
  const value = signedInteger(data, length);
  if (value === undefined) return undefined;
  // A four-byte charge larger than any real one is fixed point (whole charges in the top byte).
  return String(length === 4 && Math.abs(value) > 0xffff ? Math.round(value / 0x1000000) : value);
};

/** Arc angle, stored in tenths of a degree; CDXML writes degrees. */
const tenthsOfDegree: Decoder = (data, length) => {
  const value = signedInteger(data, length);
  return value === undefined ? undefined : formatCdxNumber(value / 10);
};

/** One fixed-point number (a length in points, or an angle in degrees). */
const fixedPoint: Decoder = (data, length) => (length === 4 ? fixed(data.getInt32(0, true)) : undefined);

const arrowheadEnd = enumeration({ 0: "Unspecified", 1: "None", 2: "Full", 3: "HalfLeft", 4: "HalfRight" });

/** Property tag -> CDXML attribute and how its data reads. */
const properties: Readonly<Record<number, readonly [string, Decoder]>> = {
  0x000a: ["Z", integer],
  0x0013: ["SupersededBy", id],
  0x0200: ["p", point2D],
  0x0201: ["xyz", point3D],
  0x0204: ["BoundingBox", rectangle],
  0x0207: ["Head3D", point3D],
  0x0208: ["Tail3D", point3D],
  0x0209: ["TopLeft", point2D],
  0x020a: ["TopRight", point2D],
  0x020b: ["BottomRight", point2D],
  0x020c: ["BottomLeft", point2D],
  0x020d: ["Center3D", point3D],
  0x020e: ["MajorAxisEnd3D", point3D],
  0x020f: ["MinorAxisEnd3D", point3D],
  0x0301: ["color", id],
  0x0302: ["bgcolor", id],
  // Drawing settings (on the document, or a fragment that overrides them): lengths in points.
  0x0803: ["ChainAngle", fixedPoint],
  0x0804: ["BondSpacing", tenthsOfDegree],
  0x0805: ["BondLength", fixedPoint],
  0x0806: ["BoldWidth", fixedPoint],
  0x0807: ["LineWidth", fixedPoint],
  0x0808: ["MarginWidth", fixedPoint],
  0x0809: ["HashSpacing", fixedPoint],
  // Node
  0x0400: ["NodeType", enumeration({
    0: "Unspecified", 1: "Element", 2: "ElementList", 3: "ElementListNickname", 4: "Nickname", 5: "Fragment",
    6: "Formula", 7: "GenericNickname", 8: "AnonymousAlternativeGroup", 9: "NamedAlternativeGroup",
    10: "MultiAttachment", 11: "VariableAttachment", 12: "ExternalConnectionPoint", 13: "LinkNode"
  })],
  0x0402: ["Element", integer],
  0x0420: ["Isotope", integer],
  0x0421: ["Charge", charge],
  0x0422: ["Radical", enumeration({ 1: "Singlet", 2: "Doublet", 3: "Triplet" })],
  0x042b: ["NumHydrogens", integer],
  0x0437: ["AS", enumeration({ 2: "R", 3: "S", 4: "r", 5: "s" })],
  // Bond
  0x0600: ["Order", bondOrder],
  0x0601: ["Display", enumeration({
    0: "Solid", 1: "Dash", 2: "Hash", 3: "WedgedHashBegin", 4: "WedgedHashEnd", 5: "Bold", 6: "WedgeBegin",
    7: "WedgeEnd", 8: "Wavy", 9: "HollowWedgeBegin", 10: "HollowWedgeEnd", 11: "WavyWedgeBegin",
    12: "WavyWedgeEnd", 13: "Dot", 14: "DashDot"
  })],
  0x0603: ["DoublePosition", (data, length) => {
    const value = unsignedInteger(data, length);
    return value === undefined ? undefined : ({ 0: "Center", 1: "Right", 2: "Left" } as Record<number, string>)[value & 0xff];
  }],
  0x0604: ["B", id],
  0x0605: ["E", id],
  0x060b: ["BondCircularOrdering", idList],
  // Text
  0x0701: ["Justification", enumeration({ [-1]: "Right", 0: "Left", 1: "Center", 2: "Full", 3: "Above", 4: "Below", 5: "Auto" })],
  // Graphic
  0x0a00: ["GraphicType", enumeration({ 1: "Line", 2: "Arc", 3: "Rectangle", 4: "Oval", 5: "Orbital", 6: "Bracket", 7: "Symbol" })],
  0x0a01: ["LineType", flags([[1, "Dashed"], [2, "Bold"], [4, "Wavy"]], "Solid")],
  0x0a02: ["ArrowType", flags([
    [1, "HalfHead"], [2, "FullHead"], [4, "Resonance"], [8, "Equilibrium"], [16, "Hollow"], [32, "RetroSynthetic"]
  ], "NoHead")],
  0x0a03: ["RectangleType", flags([[1, "RoundEdge"], [2, "Shadow"], [4, "Shaded"], [8, "Filled"], [16, "Dashed"], [32, "Bold"]], "Plain")],
  0x0a04: ["OvalType", flags([[1, "Circle"], [2, "Shaded"], [4, "Filled"], [8, "Dashed"], [16, "Bold"], [32, "Shadowed"]], "Plain")],
  0x0a06: ["BracketType", enumeration({ 0: "RoundPair", 1: "SquarePair", 2: "CurlyPair", 3: "Square", 4: "Curly", 5: "Round" })],
  0x0a08: ["CurveType", integer],
  0x0a20: ["HeadSize", integer],
  0x0a21: ["AngularSize", tenthsOfDegree],
  0x0a22: ["LipSize", integer],
  0x0a23: ["CurvePoints", curvePoints],
  0x0a27: ["BracketedObjectIDs", idList],
  0x0a2b: ["GraphicID", id],
  0x0a2e: ["CurvePoints3D", curvePoints3D],
  0x0a2f: ["ArrowheadType", enumeration({ 1: "Solid", 2: "Hollow", 3: "Angle" })],
  0x0a30: ["ArrowheadCenterSize", integer],
  0x0a31: ["ArrowheadWidth", integer],
  0x0a35: ["ArrowheadHead", arrowheadEnd],
  0x0a36: ["ArrowheadTail", arrowheadEnd],
  0x0a37: ["FillType", integer],
  0x0a3c: ["CornerRadius", integer],
  // Reaction steps
  0x0c01: ["ReactionStepReactants", idList],
  0x0c02: ["ReactionStepProducts", idList],
  0x0c03: ["ReactionStepPlusses", idList],
  0x0c04: ["ReactionStepArrows", idList],
  0x0c05: ["ReactionStepObjectsAboveArrow", idList],
  0x0c06: ["ReactionStepObjectsBelowArrow", idList]
};

const TEXT = 0x0700;
const FONT_TABLE = 0x0100;
const COLOR_TABLE = 0x0300;

interface CdxElement {
  name: string;
  attributes: Array<[string, string]>;
  children: CdxElement[];
  /** Text style runs, for a `<t>`. */
  runs?: Array<{ font: number; face: number; size: number; color: number; text: string }>;
  /** Raw XML for the document's tables. */
  prefix?: string;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const windows1252 = new TextDecoder("windows-1252");

/** A CDX string: a run count, then per run start, font, face, size (1/20 pt), colour; then the text. */
function readText(data: DataView, length: number): CdxElement["runs"] {
  if (length < 2) return undefined;
  const count = data.getUint16(0, true);
  const textStart = 2 + count * 10;
  if (textStart > length) return undefined;
  const text = windows1252
    .decode(new Uint8Array(data.buffer, data.byteOffset + textStart, length - textStart))
    .replace(/\r\n?/g, "\n");
  const starts = Array.from({ length: count }, (_, index) => data.getUint16(2 + index * 10, true));
  const runs = Array.from({ length: count }, (_, index) => {
    const offset = 2 + index * 10;
    return {
      font: data.getUint16(offset + 2, true),
      face: data.getUint16(offset + 4, true),
      size: data.getUint16(offset + 6, true) / 20,
      color: data.getUint16(offset + 8, true),
      text: text.slice(starts[index], starts[index + 1] ?? text.length)
    };
  });
  return count === 0 ? [{ font: 0, face: 0, size: 10, color: 0, text }] : runs;
}

/** Colour table: a count, then red, green, blue for each, 0–65535. */
function readColorTable(data: DataView, length: number): string {
  const count = length >= 2 ? data.getUint16(0, true) : 0;
  const colors: string[] = [];
  for (let index = 0; index < count && 2 + index * 6 + 6 <= length; index += 1) {
    const at = 2 + index * 6;
    const channel = (offset: number) => formatCdxNumber(data.getUint16(at + offset, true) / 65535);
    colors.push(`<color r="${channel(0)}" g="${channel(2)}" b="${channel(4)}"/>`);
  }
  return `<colortable>${colors.join("")}</colortable>`;
}

/** Font table: platform, a count, then id, character set and name for each. */
function readFontTable(data: DataView, length: number): string {
  const fonts: string[] = [];
  if (length >= 4) {
    const count = data.getUint16(2, true);
    let offset = 4;
    for (let index = 0; index < count && offset + 6 <= length; index += 1) {
      const fontId = data.getUint16(offset, true);
      const nameLength = data.getUint16(offset + 4, true);
      const name = windows1252.decode(new Uint8Array(data.buffer, data.byteOffset + offset + 6, Math.min(nameLength, length - offset - 6)));
      fonts.push(`<font id="${fontId}" name="${escapeXml(name)}"/>`);
      offset += 6 + nameLength;
    }
  }
  return `<fonttable>${fonts.join("")}</fonttable>`;
}

function writeElement(element: CdxElement, out: string[]): void {
  const attributes = element.attributes.map(([name, value]) => ` ${name}="${escapeXml(value)}"`).join("");
  out.push(`<${element.name}${attributes}>`);
  if (element.prefix) out.push(element.prefix);
  for (const run of element.runs ?? []) {
    out.push(`<s font="${run.font}" size="${formatCdxNumber(run.size)}" face="${run.face}" color="${run.color}">${escapeXml(run.text)}</s>`);
  }
  for (const child of element.children) writeElement(child, out);
  out.push(`</${element.name}>`);
}

/** Read a ChemDraw binary file as the CDXML it stands for. */
export function cdxToCdxml(bytes: Uint8Array): CdxConversionResult {
  if (!isCdxBytes(bytes)) {
    return { warnings: [{ code: "cdx.not_cdx", message: "The file does not start like a ChemDraw binary (.cdx) file." }] };
  }
  if (bytes.length < 22) {
    return { warnings: [{ code: "cdx.truncated", message: "The ChemDraw binary (.cdx) file ends before its first object; it holds no drawing." }] };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const skippedByTag = new Map<number, number>();
  let offset = 22;
  let root: CdxElement | undefined;
  const stack: Array<CdxElement | null> = [];
  let truncated = false;

  while (offset + 2 <= bytes.length) {
    const tag = view.getUint16(offset, true);
    offset += 2;
    if (tag === 0) {
      stack.pop();
      if (stack.length === 0) break;
      continue;
    }
    if (tag & 0x8000) {
      if (offset + 4 > bytes.length) { truncated = true; break; }
      const objectId = view.getUint32(offset, true);
      offset += 4;
      const parent = stack[stack.length - 1];
      const name = objectElementNames[tag];
      // An object inside a skipped one is skipped with it; null marks the skipped subtree.
      if (parent === null || name === undefined || (stack.length === 0 && tag !== 0x8000)) {
        if (parent !== null && !silentlySkippedObjectTags.has(tag)) skippedByTag.set(tag, (skippedByTag.get(tag) ?? 0) + 1);
        stack.push(null);
        continue;
      }
      const element: CdxElement = { name, attributes: objectId !== 0 && tag !== 0x8000 ? [["id", String(objectId)]] : [], children: [] };
      if (parent) parent.children.push(element);
      else root = element;
      stack.push(element);
      continue;
    }
    if (offset + 2 > bytes.length) { truncated = true; break; }
    let length = view.getUint16(offset, true);
    offset += 2;
    if (length === 0xffff) {
      if (offset + 4 > bytes.length) { truncated = true; break; }
      length = view.getUint32(offset, true);
      offset += 4;
    }
    if (offset + length > bytes.length) { truncated = true; break; }
    const element = stack[stack.length - 1];
    if (element) {
      const data = new DataView(bytes.buffer, bytes.byteOffset + offset, length);
      if (tag === TEXT) {
        element.runs = readText(data, length);
      } else if (tag === COLOR_TABLE && element.name === "CDXML") {
        element.prefix = readColorTable(data, length) + (element.prefix ?? "");
      } else if (tag === FONT_TABLE && element.name === "CDXML") {
        element.prefix = (element.prefix ?? "") + readFontTable(data, length);
      } else {
        const property = properties[tag];
        const value = property?.[1](data, length);
        if (property && value !== undefined && !element.attributes.some(([name]) => name === property[0])) {
          element.attributes.push([property[0], value]);
        }
      }
    }
    offset += length;
  }

  const warnings: CdxConversionWarning[] = [];
  if (!root) {
    return { warnings: [{ code: "cdx.no_document", message: "The ChemDraw binary file holds no document object." }] };
  }
  if (truncated) {
    warnings.push({ code: "cdx.truncated", message: "The ChemDraw binary file ends part-way through an object; what was read before that point is shown." });
  }
  // A curve that has only 3D points is drawn from their x and y.
  const promoteCurvePoints = (element: CdxElement) => {
    if (element.name === "curve" && !element.attributes.some(([name]) => name === "CurvePoints")) {
      const points3D = element.attributes.find(([name]) => name === "CurvePoints3D");
      if (points3D) element.attributes.push(["CurvePoints", points3D[1]]);
    }
    element.children.forEach(promoteCurvePoints);
  };
  promoteCurvePoints(root);
  const skipped = [...skippedByTag.values()].reduce((total, count) => total + count, 0);
  if (skipped > 0) {
    const kinds = [...skippedByTag.keys()].map((tag) => `0x${tag.toString(16)}`).join(", ");
    warnings.push({
      code: "cdx.objects_skipped",
      message: `${skipped} object${skipped === 1 ? "" : "s"} of a kind ChemDraft does not read (${kinds}) ${skipped === 1 ? "was" : "were"} left out.`
    });
  }

  const out: string[] = ["<?xml version=\"1.0\" encoding=\"UTF-8\"?>"];
  writeElement(root, out);
  return { contents: out.join(""), warnings };
}
