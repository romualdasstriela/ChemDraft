/**
 * ChemDraw binary (.cdx) files, written from CDXML: the reverse of `cdxToCdxml`.
 *
 * ChemDraft writes its CDXML as usual, and this module turns that object tree into the binary form,
 * element by element and attribute by attribute, using the same tag numbers and value names the
 * reader uses (`cdxTables`), so a file written here reads back through the reader unchanged. It was
 * written from the published description of the CDX format, with no other program's code.
 *
 * What is written is the visible drawing: structures, text, shapes, arrows, colours, fonts and the
 * drawing settings. ChemDraft's own extras (its embedded native document, kept in CDXML object tags
 * for a lossless reopen) have no place in a ChemDraw binary file and are left out, with a warning;
 * a .chemdraft file keeps everything.
 *
 * Every number is written at the size the format gives it (8, 16 or 32 bits), little-endian;
 * coordinates are 32-bit fixed point in 1/65536 pt, a 2D point y first, a 3D point x first, a
 * rectangle top, left, bottom, right. Ids are renumbered from 1 in document order (CDX ids are
 * 32-bit numbers; CDXML ids may be any text), and every reference follows its object.
 */

import { XMLParser } from "fast-xml-parser";
import { CdxSignature, type CdxConversionWarning, cdxTables } from "./cdx";

export interface CdxWriteResult {
  /** The .cdx bytes, or undefined when the CDXML could not be read. */
  bytes?: Uint8Array;
  warnings: CdxConversionWarning[];
}

type Attributes = Readonly<Record<string, string>>;
interface Element {
  name: string;
  attributes: Attributes;
  children: Element[];
  text: string;
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false
});

function toElements(nodes: unknown[]): Element[] {
  const elements: Element[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const record = node as Record<string, unknown>;
    const name = Object.keys(record).find((key) => key !== ":@");
    if (!name || name.startsWith("#") || name.startsWith("?")) continue;
    const childNodes = Array.isArray(record[name]) ? (record[name] as unknown[]) : [];
    const attributes = (record[":@"] && typeof record[":@"] === "object" ? record[":@"] : {}) as Record<string, string>;
    const text = childNodes
      .map((child) => (child && typeof child === "object" && "#text" in child ? String((child as Record<string, unknown>)["#text"]) : ""))
      .join("");
    elements.push({ name, attributes, children: toElements(childNodes), text });
  }
  return elements;
}

/** Little-endian byte buffer. */
class Bytes {
  readonly data: number[] = [];
  u8(value: number) { this.data.push(value & 0xff); return this; }
  u16(value: number) { this.data.push(value & 0xff, (value >>> 8) & 0xff); return this; }
  u32(value: number) { this.data.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff); return this; }
  push(values: readonly number[]) { for (const value of values) this.data.push(value); return this; }
}

const int8 = (value: number) => [value & 0xff];
const int16 = (value: number) => [value & 0xff, (value >> 8) & 0xff];
const int32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
const fixed = (points: number) => int32(Math.round(points * 65536));

function numbers(value: string): number[] | undefined {
  const parts = value.trim().split(/[\s,]+/).filter((part) => part.length > 0).map(Number);
  return parts.length > 0 && parts.every(Number.isFinite) ? parts : undefined;
}

function reverse(names: Readonly<Record<number, string>>): Map<string, number> {
  return new Map(Object.entries(names).map(([value, name]) => [name.toLowerCase(), Number(value)]));
}

/** A flag set from its names ("RoundEdge Shadow"); a name for "no flags" ("Plain") is zero. */
function flagValue(value: string, flags: ReadonlyArray<readonly [number, string]>, none: string): number | undefined {
  const byName = new Map(flags.map(([bit, name]) => [name.toLowerCase(), bit]));
  let total = 0;
  for (const token of value.trim().split(/\s+/)) {
    const lower = token.toLowerCase();
    if (lower === none.toLowerCase() || lower === "") continue;
    const bit = byName.get(lower) ?? (Number.isInteger(Number(token)) ? Number(token) : undefined);
    if (bit === undefined) return undefined;
    total |= bit;
  }
  return total;
}

type IdMap = (value: string) => number | undefined;
type Encoder = (value: string, ids: IdMap) => number[] | undefined;

const integerOf = (size: 8 | 16 | 32): Encoder => (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  const rounded = Math.round(number);
  return size === 8 ? int8(rounded) : size === 16 ? int16(rounded) : int32(rounded);
};

const namedOf = (names: Readonly<Record<number, string>>, size: 8 | 16): Encoder => {
  const byName = reverse(names);
  return (value) => {
    const number = byName.get(value.trim().toLowerCase()) ?? (Number.isInteger(Number(value)) ? Number(value) : undefined);
    return number === undefined ? undefined : size === 8 ? int8(number) : int16(number);
  };
};

const flagsOf = (flags: ReadonlyArray<readonly [number, string]>, none: string): Encoder => (value) => {
  const number = flagValue(value, flags, none);
  return number === undefined ? undefined : int16(number);
};

const id: Encoder = (value, ids) => {
  const mapped = ids(value);
  return mapped === undefined ? undefined : int32(mapped);
};

const idList: Encoder = (value, ids) => {
  const mapped = value.trim().split(/\s+/).filter((part) => part.length > 0).map(ids);
  return mapped.length > 0 && mapped.every((entry) => entry !== undefined) ? mapped.flatMap((entry) => int32(entry!)) : undefined;
};

const point2D: Encoder = (value) => {
  const parts = numbers(value);
  return parts && parts.length >= 2 ? [...fixed(parts[1]!), ...fixed(parts[0]!)] : undefined;
};

/** A 3D point; a CDXML "x y" with no z is written at z 0. */
const point3D: Encoder = (value) => {
  const parts = numbers(value);
  return parts && parts.length >= 2 ? [...fixed(parts[0]!), ...fixed(parts[1]!), ...fixed(parts[2] ?? 0)] : undefined;
};

/** CDXML writes a rectangle "left top right bottom"; CDX stores top, left, bottom, right. */
const rectangle: Encoder = (value) => {
  const parts = numbers(value);
  return parts && parts.length >= 4 ? [...fixed(parts[1]!), ...fixed(parts[0]!), ...fixed(parts[3]!), ...fixed(parts[2]!)] : undefined;
};

const fixedPoint: Encoder = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? fixed(number) : undefined;
};

const tenths: Encoder = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? int16(Math.round(number * 10)) : undefined;
};

/** Curve points: a count, then each point y first. */
const curvePoints: Encoder = (value) => {
  const parts = numbers(value);
  if (!parts || parts.length < 2 || parts.length % 2 !== 0) return undefined;
  const out = int16(parts.length / 2);
  for (let index = 0; index < parts.length; index += 2) out.push(...fixed(parts[index + 1]!), ...fixed(parts[index]!));
  return out;
};

/** Bond order: "2", "1.5", or several names meaning "any of these". */
const bondOrder: Encoder = (value) => {
  const number = flagValue(value, cdxTables.bondOrderFlags, "");
  return number === undefined || number === 0 ? undefined : int16(number);
};

/** The double-bond line side, marked as placed on purpose (high byte), as ChemDraw saves it. */
const doublePosition: Encoder = (value) => {
  const side = reverse(cdxTables.doublePositionNames).get(value.trim().toLowerCase());
  return side === undefined ? undefined : int16(0x0100 | side);
};

const fillTypeNames: Readonly<Record<number, string>> = { 0: "Unspecified", 1: "None", 2: "Solid", 4: "Shaded", 8: "Gradient", 16: "Pattern" };

/** CDXML attribute -> property tag and how it is written, the same tags the reader decodes. */
const properties: Readonly<Record<string, readonly [number, Encoder]>> = {
  Z: [0x000a, integerOf(32)],
  SupersededBy: [0x0013, id],
  p: [0x0200, point2D],
  xyz: [0x0201, point3D],
  BoundingBox: [0x0204, rectangle],
  Head3D: [0x0207, point3D],
  Tail3D: [0x0208, point3D],
  TopLeft: [0x0209, point2D],
  TopRight: [0x020a, point2D],
  BottomRight: [0x020b, point2D],
  BottomLeft: [0x020c, point2D],
  Center3D: [0x020d, point3D],
  MajorAxisEnd3D: [0x020e, point3D],
  MinorAxisEnd3D: [0x020f, point3D],
  color: [0x0301, integerOf(16)],
  bgcolor: [0x0302, integerOf(16)],
  ChainAngle: [0x0803, fixedPoint],
  BondSpacing: [0x0804, tenths],
  BondLength: [0x0805, fixedPoint],
  BoldWidth: [0x0806, fixedPoint],
  LineWidth: [0x0807, fixedPoint],
  MarginWidth: [0x0808, fixedPoint],
  HashSpacing: [0x0809, fixedPoint],
  NodeType: [0x0400, namedOf(cdxTables.nodeTypeNames, 16)],
  Element: [0x0402, integerOf(16)],
  Isotope: [0x0420, integerOf(16)],
  Charge: [0x0421, integerOf(8)],
  Radical: [0x0422, namedOf(cdxTables.radicalNames, 8)],
  NumHydrogens: [0x042b, integerOf(16)],
  AS: [0x0437, namedOf(cdxTables.stereoNames, 8)],
  Order: [0x0600, bondOrder],
  Display: [0x0601, namedOf(cdxTables.bondDisplayNames, 16)],
  DoublePosition: [0x0603, doublePosition],
  B: [0x0604, id],
  E: [0x0605, id],
  BondCircularOrdering: [0x060b, idList],
  Justification: [0x0701, namedOf(cdxTables.justificationNames, 8)],
  GraphicType: [0x0a00, namedOf(cdxTables.graphicTypeNames, 16)],
  LineType: [0x0a01, flagsOf(cdxTables.lineTypeFlags, "Solid")],
  ArrowType: [0x0a02, flagsOf(cdxTables.arrowTypeFlags, "NoHead")],
  RectangleType: [0x0a03, flagsOf(cdxTables.rectangleTypeFlags, "Plain")],
  OvalType: [0x0a04, flagsOf(cdxTables.ovalTypeFlags, "Plain")],
  BracketType: [0x0a06, namedOf(cdxTables.bracketTypeNames, 16)],
  CurveType: [0x0a08, integerOf(16)],
  HeadSize: [0x0a20, integerOf(16)],
  AngularSize: [0x0a21, tenths],
  LipSize: [0x0a22, integerOf(16)],
  CurvePoints: [0x0a23, curvePoints],
  BracketedObjectIDs: [0x0a27, idList],
  GraphicID: [0x0a2b, id],
  ArrowheadType: [0x0a2f, namedOf(cdxTables.arrowheadTypeNames, 16)],
  ArrowheadCenterSize: [0x0a30, integerOf(16)],
  ArrowheadWidth: [0x0a31, integerOf(16)],
  ArrowheadHead: [0x0a35, namedOf(cdxTables.arrowheadEndNames, 16)],
  ArrowheadTail: [0x0a36, namedOf(cdxTables.arrowheadEndNames, 16)],
  FillType: [0x0a37, namedOf(fillTypeNames, 16)],
  CornerRadius: [0x0a3c, integerOf(16)],
  ReactionStepReactants: [0x0c01, idList],
  ReactionStepProducts: [0x0c02, idList],
  ReactionStepPlusses: [0x0c03, idList],
  ReactionStepArrows: [0x0c04, idList],
  ReactionStepObjectsAboveArrow: [0x0c05, idList],
  ReactionStepObjectsBelowArrow: [0x0c06, idList]
};

const CREATION_PROGRAM = 0x0003;
const TEXT = 0x0700;
const FONT_TABLE = 0x0100;
const COLOR_TABLE = 0x0300;
/** The font every run uses when the CDXML names none. */
const DEFAULT_FONT_ID = 3;

/** Windows-1252, the character set CDX text is stored in. */
const windows1252Bytes: ReadonlyMap<string, number> = (() => {
  const decoder = new TextDecoder("windows-1252");
  const map = new Map<string, number>();
  for (let byte = 0; byte < 256; byte += 1) {
    const char = decoder.decode(new Uint8Array([byte]));
    if (!map.has(char)) map.set(char, byte);
  }
  return map;
})();

function encodeText(text: string, lost: { count: number }): number[] {
  const out: number[] = [];
  for (const char of text.replace(/\r\n?|\n/g, "\r")) {
    const byte = windows1252Bytes.get(char);
    if (byte === undefined) lost.count += 1;
    out.push(byte ?? 0x3f);
  }
  return out;
}

interface Run { font: number; face: number; sizePoints: number; color: number; text: string }

/** A CDX string: run count, then start, font, face, size (1/20 pt), colour per run, then the text. */
function textProperty(runs: readonly Run[], lost: { count: number }): number[] {
  const out = int16(runs.length);
  let start = 0;
  const text: number[] = [];
  for (const run of runs) {
    out.push(...int16(start), ...int16(run.font), ...int16(run.face), ...int16(Math.round(run.sizePoints * 20)), ...int16(run.color));
    const bytes = encodeText(run.text, lost);
    text.push(...bytes);
    start += bytes.length;
  }
  return [...out, ...text];
}

function runsOf(element: Element): Run[] {
  const styled = element.children.filter((child) => child.name === "s");
  const runOf = (attributes: Attributes, text: string): Run => ({
    font: Number.isInteger(Number(attributes.font)) && attributes.font !== undefined ? Number(attributes.font) : DEFAULT_FONT_ID,
    face: Number.isInteger(Number(attributes.face)) && attributes.face !== undefined ? Number(attributes.face) : 0,
    sizePoints: Number(attributes.size) > 0 ? Number(attributes.size) : 10,
    color: Number.isInteger(Number(attributes.color)) && attributes.color !== undefined ? Number(attributes.color) : 0,
    text
  });
  return styled.length > 0 ? styled.map((run) => runOf(run.attributes, run.text)) : [runOf({}, element.text)];
}

function colorTable(element: Element | undefined): number[] {
  const colors = element?.children.filter((child) => child.name === "color") ?? [];
  const channel = (value: string | undefined) => Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 65535);
  return [...int16(colors.length), ...colors.flatMap((color) => [
    ...int16(channel(color.attributes.r)), ...int16(channel(color.attributes.g)), ...int16(channel(color.attributes.b))
  ])];
}

/** Font table: platform (Windows), a count, then id, character set (1252) and name for each. */
function fontTable(element: Element | undefined): number[] {
  const fonts = element?.children.filter((child) => child.name === "font") ?? [];
  const entries = fonts.length > 0
    ? fonts.map((font) => ({ id: Number(font.attributes.id) || DEFAULT_FONT_ID, name: font.attributes.name || "Arial" }))
    : [{ id: DEFAULT_FONT_ID, name: "Arial" }];
  const lost = { count: 0 };
  return [...int16(1), ...int16(entries.length), ...entries.flatMap((font) => {
    const name = encodeText(font.name, lost);
    return [...int16(font.id), ...int16(1252), ...int16(name.length), ...name];
  })];
}

/** Write CDXML as a ChemDraw binary (.cdx) file. */
export function cdxmlToCdx(cdxml: string): CdxWriteResult {
  let root: Element | undefined;
  try {
    root = toElements(parser.parse(cdxml) as unknown[]).find((element) => element.name === "CDXML");
  } catch (error) {
    return { warnings: [{ code: "cdx.write_unreadable", message: `The drawing could not be read for CDX export: ${String(error)}` }] };
  }
  if (!root) return { warnings: [{ code: "cdx.write_unreadable", message: "The drawing has no CDXML document to write as CDX." }] };

  const objectTags = new Map(Object.entries(cdxTables.objectElementNames).map(([tag, name]) => [name, Number(tag)]));
  // Number every object in document order; references follow their object.
  const ids = new Map<string, number>();
  let nextId = 1;
  const collect = (element: Element) => {
    if (element.attributes.id !== undefined && !ids.has(element.attributes.id)) ids.set(element.attributes.id, nextId++);
    element.children.forEach(collect);
  };
  collect(root);
  const idOf: IdMap = (value) => ids.get(value.trim());

  const skipped = new Map<string, number>();
  const unwritten = new Map<string, number>();
  const lost = { count: 0 };
  let tagsLeftOut = 0;
  const out = new Bytes();
  out.push([...CdxSignature].map((char) => char.charCodeAt(0))).push([4, 3, 2, 1]).push(new Array(10).fill(0));

  const property = (tag: number, data: readonly number[]) => {
    out.u16(tag);
    if (data.length >= 0xffff) out.u16(0xffff).u32(data.length);
    else out.u16(data.length);
    out.push(data);
  };

  const writeObject = (element: Element) => {
    const tag = objectTags.get(element.name);
    out.u16(tag!).u32(element.name === "CDXML" ? 0 : idOf(element.attributes.id ?? "") ?? nextId++);
    if (element.name === "CDXML") {
      const creationProgram = element.attributes.CreationProgram?.trim() || "ChemDraft";
      property(CREATION_PROGRAM, [...int16(0), ...encodeText(creationProgram, lost)]);
      property(COLOR_TABLE, colorTable(element.children.find((child) => child.name === "colortable")));
      property(FONT_TABLE, fontTable(element.children.find((child) => child.name === "fonttable")));
    }
    for (const [name, value] of Object.entries(element.attributes)) {
      if (name === "id" || name === "CreationProgram") continue;
      const entry = properties[name];
      const data = entry?.[1](value, idOf);
      if (!entry || !data) {
        // An "Unknown" graphic type is a shape the CDXML export already reported it could not write.
        if (!(name === "GraphicType" && value === "Unknown")) unwritten.set(name, (unwritten.get(name) ?? 0) + 1);
        continue;
      }
      property(entry[0], data);
    }
    if (element.name === "t") property(TEXT, textProperty(runsOf(element), lost));
    for (const child of element.children) {
      if (["colortable", "fonttable", "s"].includes(child.name)) continue;
      if (child.name === "objecttag") { tagsLeftOut += 1; continue; }
      if (child.name === "n") writeNode(child);
      else if (objectTags.has(child.name)) writeObject(child);
      else skipped.set(child.name, (skipped.get(child.name) ?? 0) + 1);
    }
    out.u16(0);
  };

  /**
   * A node. ChemDraft writes a label ("OMe", "R1") in Element as text; CDX keeps elements as numbers,
   * so such a node is written as a nickname-style node carrying its label as text. An element node is
   * written as the CDXML has it.
   */
  const writeNode = (node: Element) => {
    const element = node.attributes.Element?.trim();
    const numeric = element !== undefined && /^\d+$/.test(element);
    const hasText = node.children.some((child) => child.name === "t");
    const attributes: Record<string, string> = { ...node.attributes };
    let label: string | undefined;
    if (element !== undefined && !numeric) {
      delete attributes.Element;
      attributes.NodeType ??= "GenericNickname";
      label = element;
    }
    const children = [...node.children];
    if (label && !hasText) {
      const point = numbers(node.attributes.p ?? "");
      const labelPoint = point ? `${point[0]! - 3.5} ${point[1]! + 3.5}` : undefined;
      children.push({ name: "t", attributes: labelPoint ? { p: labelPoint } : {}, children: [], text: label });
    }
    writeObject({ ...node, attributes, children });
  };

  writeObject(root);

  const warnings: CdxConversionWarning[] = [];
  if (tagsLeftOut > 0) {
    warnings.push({
      code: "cdx.native_extras_omitted",
      message: "CDX files hold the drawing only: ChemDraft's own details (kept in its CDXML and .chemdraft files) are not included."
    });
  }
  if (skipped.size > 0) {
    warnings.push({
      code: "cdx.objects_not_written",
      message: `Some objects have no CDX form and were left out: ${[...skipped].map(([name, count]) => `${count} ${name}`).join(", ")}.`
    });
  }
  const meaningful = [...unwritten].filter(([name]) => !["Start", "End", "CrossingBonds", "Persistent"].includes(name));
  if (meaningful.length > 0) {
    warnings.push({
      code: "cdx.attributes_not_written",
      message: `Some settings have no CDX form here and were left out: ${meaningful.map(([name]) => name).join(", ")}.`
    });
  }
  if (lost.count > 0) {
    warnings.push({
      code: "cdx.characters_replaced",
      message: `${lost.count} character${lost.count === 1 ? "" : "s"} outside the CDX character set ${lost.count === 1 ? "was" : "were"} written as "?".`
    });
  }
  return { bytes: new Uint8Array(out.data), warnings };
}
