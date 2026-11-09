// SVG → Windows Enhanced Metafile (EMF), so a copied drawing pastes into Word, PowerPoint and Excel
// as a vector picture instead of a bitmap. It reads the SVG this package exports (exportDocumentToSvg)
// and writes plain GDI records: paths for lines, polygons, curves, circles and rectangles, and
// TrueType text records for labels and text boxes.
//
// Coordinates are written in hundredths of a millimetre at the SVG's physical size, so Office
// places the picture at the drawing's real size. Text is placed by Helvetica/Arial advance widths
// (the export font), with an explicit spacing array so the player draws the glyphs where the SVG
// does. GDI has no alpha, filters, clip paths or gradients: opacity is blended against white,
// a gradient becomes the average of its stops, and filters (shadows, glows), clip paths and
// patterns are left out. White "halo" copies of labels (stroked, aria-hidden text) are left out:
// the bonds already stop short of the labels.

export interface SvgToEmfOptions {
  domParser?: DOMParser;
}

export interface SvgToEmfResult {
  bytes: Uint8Array;
  /** Picture size in hundredths of a millimetre. */
  widthHmm: number;
  heightHmm: number;
  /** What could not be drawn (filters, clip paths, images...), once each. */
  omitted: string[];
}

type Matrix = [number, number, number, number, number, number]; // a b c d e f

interface Style {
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeLinecap: string;
  strokeLinejoin: string;
  strokeMiterlimit: number;
  strokeDasharray: string;
  fillRule: string;
  fillOpacity: number;
  strokeOpacity: number;
  opacity: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  textAnchor: string;
  textDecoration: string;
  letterSpacing: number;
  color: string;
}

const defaultStyle: Style = {
  fill: "#000000",
  stroke: "none",
  strokeWidth: 1,
  strokeLinecap: "butt",
  strokeLinejoin: "miter",
  strokeMiterlimit: 4,
  strokeDasharray: "none",
  fillRule: "nonzero",
  fillOpacity: 1,
  strokeOpacity: 1,
  opacity: 1,
  fontFamily: "Arial",
  fontSize: 16,
  fontWeight: "400",
  fontStyle: "normal",
  textAnchor: "start",
  textDecoration: "none",
  letterSpacing: 0,
  color: "#000000"
};

const inheritedAttributes: Record<string, keyof Style> = {
  fill: "fill",
  stroke: "stroke",
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-miterlimit": "strokeMiterlimit",
  "stroke-dasharray": "strokeDasharray",
  "fill-rule": "fillRule",
  "fill-opacity": "fillOpacity",
  "stroke-opacity": "strokeOpacity",
  "font-family": "fontFamily",
  "font-size": "fontSize",
  "font-weight": "fontWeight",
  "font-style": "fontStyle",
  "text-anchor": "textAnchor",
  "text-decoration": "textDecoration",
  "letter-spacing": "letterSpacing",
  color: "color"
};

const numericStyleKeys = new Set<keyof Style>(["strokeWidth", "strokeMiterlimit", "fillOpacity", "strokeOpacity", "fontSize", "letterSpacing"]);

// ---------------------------------------------------------------------------------------------
// Record writer

class EmfWriter {
  private readonly chunks: Uint8Array[] = [];
  private size = 0;
  records = 0;

  record(type: number, body: (view: DataView, bytes: Uint8Array) => void, bodyLength: number): void {
    const length = 8 + Math.ceil(bodyLength / 4) * 4;
    const bytes = new Uint8Array(length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, type, true);
    view.setUint32(4, length, true);
    body(new DataView(bytes.buffer, 8), bytes.subarray(8));
    this.chunks.push(bytes);
    this.size += length;
    this.records += 1;
  }

  ints(type: number, values: readonly number[]): void {
    this.record(type, (view) => values.forEach((value, index) => view.setInt32(index * 4, Math.round(value), true)), values.length * 4);
  }

  finish(header: Uint8Array): Uint8Array {
    const output = new Uint8Array(header.length + this.size);
    output.set(header, 0);
    let offset = header.length;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }

  get byteLength(): number {
    return this.size;
  }
}

const EMR = {
  HEADER: 1,
  POLYBEZIERTO: 5,
  SETWINDOWEXTEX: 9,
  SETWINDOWORGEX: 10,
  SETVIEWPORTEXTEX: 11,
  SETVIEWPORTORGEX: 12,
  EOF: 14,
  SETMAPMODE: 17,
  SETBKMODE: 18,
  SETPOLYFILLMODE: 19,
  SETTEXTALIGN: 22,
  SETTEXTCOLOR: 24,
  MOVETOEX: 27,
  SELECTOBJECT: 37,
  CREATEBRUSHINDIRECT: 39,
  DELETEOBJECT: 40,
  LINETO: 54,
  SETMITERLIMIT: 58,
  BEGINPATH: 59,
  ENDPATH: 60,
  CLOSEFIGURE: 61,
  FILLPATH: 62,
  STROKEANDFILLPATH: 63,
  STROKEPATH: 64,
  EXTCREATEFONTINDIRECTW: 82,
  EXTTEXTOUTW: 84,
  EXTCREATEPEN: 95
} as const;

const NULL_BRUSH = 0x80000005;
const NULL_PEN = 0x80000008;
const SYSTEM_FONT = 0x8000000d;
const PEN_HANDLE = 1;
const BRUSH_HANDLE = 2;
const FONT_HANDLE = 3;

// ---------------------------------------------------------------------------------------------
// Geometry

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function scaleOf(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

function parseTransform(value: string | null): Matrix {
  let result: Matrix = [1, 0, 0, 1, 0, 0];
  if (!value) {
    return result;
  }
  for (const match of value.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const args = (match[2] ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
    let next: Matrix = [1, 0, 0, 1, 0, 0];
    switch (match[1]) {
      case "matrix":
        if (args.length === 6) next = args as Matrix;
        break;
      case "translate":
        next = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
        break;
      case "scale":
        next = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const angle = (args[0] ?? 0) * Math.PI / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const cx = args[1] ?? 0;
        const cy = args[2] ?? 0;
        next = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
        break;
      }
      case "skewX":
        next = [1, 0, Math.tan((args[0] ?? 0) * Math.PI / 180), 1, 0, 0];
        break;
      case "skewY":
        next = [1, Math.tan((args[0] ?? 0) * Math.PI / 180), 0, 1, 0, 0];
        break;
    }
    result = multiply(result, next);
  }
  return result;
}

type Segment =
  | { kind: "move"; x: number; y: number }
  | { kind: "line"; x: number; y: number }
  | { kind: "cubic"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { kind: "close" };

/** SVG path data → absolute moves, lines, cubics and closes (quadratics and arcs as cubics). */
export function parseSvgPathData(d: string): Segment[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const segments: Segment[] = [];
  let index = 0;
  let command = "";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastControl: [number, number] | undefined;
  let lastQuadratic: [number, number] | undefined;
  const number = () => Number(tokens[index++]);
  const hasNumber = () => index < tokens.length && !/^[a-zA-Z]$/.test(tokens[index]!);

  while (index < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[index]!)) {
      command = tokens[index++]!;
    } else if (!command) {
      break;
    }
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();
    const ox = relative ? x : 0;
    const oy = relative ? y : 0;
    if (upper === "Z") {
      segments.push({ kind: "close" });
      x = startX;
      y = startY;
      lastControl = undefined;
      lastQuadratic = undefined;
      continue;
    }
    if (!hasNumber()) {
      break;
    }
    switch (upper) {
      case "M":
        x = ox + number();
        y = oy + number();
        startX = x;
        startY = y;
        segments.push({ kind: "move", x, y });
        command = relative ? "l" : "L";
        lastControl = undefined;
        lastQuadratic = undefined;
        break;
      case "L":
        x = ox + number();
        y = oy + number();
        segments.push({ kind: "line", x, y });
        lastControl = undefined;
        lastQuadratic = undefined;
        break;
      case "H":
        x = ox + number();
        segments.push({ kind: "line", x, y });
        lastControl = undefined;
        lastQuadratic = undefined;
        break;
      case "V":
        y = oy + number();
        segments.push({ kind: "line", x, y });
        lastControl = undefined;
        lastQuadratic = undefined;
        break;
      case "C": {
        const x1 = ox + number(), y1 = oy + number(), x2 = ox + number(), y2 = oy + number();
        x = ox + number();
        y = oy + number();
        segments.push({ kind: "cubic", x1, y1, x2, y2, x, y });
        lastControl = [x2, y2];
        lastQuadratic = undefined;
        break;
      }
      case "S": {
        const [x1, y1] = lastControl ? [2 * x - lastControl[0], 2 * y - lastControl[1]] : [x, y];
        const x2 = ox + number(), y2 = oy + number();
        x = ox + number();
        y = oy + number();
        segments.push({ kind: "cubic", x1, y1, x2, y2, x, y });
        lastControl = [x2, y2];
        lastQuadratic = undefined;
        break;
      }
      case "Q":
      case "T": {
        const [qx, qy] = upper === "Q"
          ? [ox + number(), oy + number()]
          : lastQuadratic ? [2 * x - lastQuadratic[0], 2 * y - lastQuadratic[1]] : [x, y];
        const ex = ox + number(), ey = oy + number();
        segments.push({
          kind: "cubic",
          x1: x + 2 / 3 * (qx - x), y1: y + 2 / 3 * (qy - y),
          x2: ex + 2 / 3 * (qx - ex), y2: ey + 2 / 3 * (qy - ey),
          x: ex, y: ey
        });
        x = ex;
        y = ey;
        lastQuadratic = [qx, qy];
        lastControl = undefined;
        break;
      }
      case "A": {
        const rx = number(), ry = number(), rotation = number(), large = number(), sweep = number();
        const ex = ox + number(), ey = oy + number();
        segments.push(...arcToCubics(x, y, rx, ry, rotation, large !== 0, sweep !== 0, ex, ey));
        x = ex;
        y = ey;
        lastControl = undefined;
        lastQuadratic = undefined;
        break;
      }
      default:
        return segments;
    }
  }
  return segments;
}

function arcToCubics(
  x1: number, y1: number, rxIn: number, ryIn: number, rotationDegrees: number,
  large: boolean, sweep: boolean, x2: number, y2: number
): Segment[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) {
    return [{ kind: "line", x: x2, y: y2 }];
  }
  const phi = rotationDegrees * Math.PI / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let factor = Math.sqrt(Math.max(0, numerator / denominator));
  if (large === sweep) factor = -factor;
  const cxp = factor * rx * y1p / ry;
  const cyp = -factor * ry * x1p / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const parts = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / parts;
  const k = 4 / 3 * Math.tan(step / 4);
  const point = (t: number): [number, number] => [
    cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos
  ];
  const derivative = (t: number): [number, number] => [
    -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos
  ];
  const segments: Segment[] = [];
  for (let part = 0; part < parts; part += 1) {
    const t1 = theta1 + part * step;
    const t2 = t1 + step;
    const [p1x, p1y] = point(t1);
    const [p2x, p2y] = point(t2);
    const [d1x, d1y] = derivative(t1);
    const [d2x, d2y] = derivative(t2);
    segments.push({
      kind: "cubic",
      x1: p1x + k * d1x, y1: p1y + k * d1y,
      x2: p2x - k * d2x, y2: p2y - k * d2y,
      x: p2x, y: p2y
    });
  }
  return segments;
}

function ellipseSegments(cx: number, cy: number, rx: number, ry: number): Segment[] {
  const k = 0.5522847498;
  return [
    { kind: "move", x: cx + rx, y: cy },
    { kind: "cubic", x1: cx + rx, y1: cy + k * ry, x2: cx + k * rx, y2: cy + ry, x: cx, y: cy + ry },
    { kind: "cubic", x1: cx - k * rx, y1: cy + ry, x2: cx - rx, y2: cy + k * ry, x: cx - rx, y: cy },
    { kind: "cubic", x1: cx - rx, y1: cy - k * ry, x2: cx - k * rx, y2: cy - ry, x: cx, y: cy - ry },
    { kind: "cubic", x1: cx + k * rx, y1: cy - ry, x2: cx + rx, y2: cy - k * ry, x: cx + rx, y: cy },
    { kind: "close" }
  ];
}

function pointsSegments(points: string, close: boolean): Segment[] {
  const values = (points.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
  const segments: Segment[] = [];
  for (let i = 0; i + 1 < values.length; i += 2) {
    segments.push({ kind: i === 0 ? "move" : "line", x: values[i]!, y: values[i + 1]! });
  }
  if (close && segments.length > 0) segments.push({ kind: "close" });
  return segments;
}

// ---------------------------------------------------------------------------------------------
// Colours

const namedColors: Record<string, [number, number, number]> = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255],
  gray: [128, 128, 128], grey: [128, 128, 128], yellow: [255, 255, 0], orange: [255, 165, 0],
  purple: [128, 0, 128], silver: [192, 192, 192], maroon: [128, 0, 0], navy: [0, 0, 128],
  teal: [0, 128, 128], lime: [0, 255, 0], aqua: [0, 255, 255], cyan: [0, 255, 255],
  fuchsia: [255, 0, 255], magenta: [255, 0, 255], olive: [128, 128, 0]
};

function parseColor(value: string): [number, number, number, number] | undefined {
  const text = value.trim().toLowerCase();
  if (!text || text === "none" || text === "transparent") return undefined;
  const hex = text.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const digits = hex[1]!;
    const full = digits.length <= 4 ? [...digits].map((c) => c + c).join("") : digits;
    const alpha = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16), alpha];
  }
  const rgb = text.match(/^rgba?\(([^)]*)\)$/);
  if (rgb) {
    const parts = rgb[1]!.split(/[\s,/]+/).filter(Boolean);
    const channel = (part: string | undefined) => part?.endsWith("%") ? Number(part.slice(0, -1)) * 2.55 : Number(part ?? 0);
    const alphaPart = parts[3];
    const alpha = alphaPart === undefined ? 1 : alphaPart.endsWith("%") ? Number(alphaPart.slice(0, -1)) / 100 : Number(alphaPart);
    return [channel(parts[0]), channel(parts[1]), channel(parts[2]), Number.isFinite(alpha) ? alpha : 1];
  }
  const named = namedColors[text];
  return named ? [...named, 1] : undefined;
}

/** Colour blended against white by its opacity, as GDI has none. COLORREF is 0x00BBGGRR. */
function colorRef(rgba: [number, number, number, number], opacity: number): number {
  const alpha = Math.max(0, Math.min(1, rgba[3] * opacity));
  const [r, g, b] = rgba.slice(0, 3).map((channel) => Math.round(Math.max(0, Math.min(255, channel * alpha + 255 * (1 - alpha)))));
  return ((b! << 16) | (g! << 8) | r!) >>> 0;
}

// ---------------------------------------------------------------------------------------------
// Text metrics: Helvetica advance widths (Arial shares them), per 1000 em, for ASCII 32-126.

const helveticaWidths = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
];
const helveticaBoldWidths = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584
];

function isMetricFont(family: string): boolean {
  return /^(arial|helvetica|liberation sans|arimo|sans-serif)$/i.test(family);
}

function advanceEm(character: string, bold: boolean): number {
  const code = character.codePointAt(0) ?? 63;
  const table = bold ? helveticaBoldWidths : helveticaWidths;
  if (code >= 32 && code <= 126) return table[code - 32]! / 1000;
  if (code === 0xb7 || code === 0x2022) return 0.35; // middle dot, bullet
  if (code >= 0x2070 && code <= 0x209f) return 0.35; // super/subscript digits
  return 0.6;
}

function firstFontFamily(value: string): string {
  const first = value.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "") ?? "Arial";
  return /^(sans-serif|system-ui)$/i.test(first) ? "Arial" : /^serif$/i.test(first) ? "Times New Roman" : /^monospace$/i.test(first) ? "Courier New" : first || "Arial";
}

// ---------------------------------------------------------------------------------------------
// Converter

function lengthInMm(value: string | null, fallbackPx: number): number {
  if (!value) return fallbackPx * 25.4 / 96;
  const match = value.trim().match(/^([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)\s*(px|pt|pc|in|mm|cm|%)?$/);
  if (!match) return fallbackPx * 25.4 / 96;
  const amount = Number(match[1]);
  switch (match[2]) {
    case "pt": return amount * 25.4 / 72;
    case "pc": return amount * 25.4 / 6;
    case "in": return amount * 25.4;
    case "mm": return amount;
    case "cm": return amount * 10;
    case "%": return fallbackPx * amount / 100 * 25.4 / 96;
    default: return amount * 25.4 / 96;
  }
}

export function svgToEmf(svg: string, options: SvgToEmfOptions = {}): SvgToEmfResult {
  const parser = options.domParser ?? (globalThis.DOMParser ? new globalThis.DOMParser() : undefined);
  if (!parser) {
    throw new Error("Cannot write EMF: DOMParser is not available in this environment.");
  }
  const parsed = parser.parseFromString(svg, "image/svg+xml");
  const root = parsed.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg" || parsed.getElementsByTagName("parsererror").length > 0) {
    throw new Error("Cannot write EMF: the SVG could not be parsed.");
  }

  const viewBox = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
  const vbX = viewBox.length === 4 ? viewBox[0]! : 0;
  const vbY = viewBox.length === 4 ? viewBox[1]! : 0;
  const vbWidth = viewBox.length === 4 && viewBox[2]! > 0 ? viewBox[2]! : Number.parseFloat(root.getAttribute("width") ?? "") || 100;
  const vbHeight = viewBox.length === 4 && viewBox[3]! > 0 ? viewBox[3]! : Number.parseFloat(root.getAttribute("height") ?? "") || 100;
  const widthMm = lengthInMm(root.getAttribute("width"), vbWidth);
  const heightMm = lengthInMm(root.getAttribute("height"), vbHeight);
  const widthHmm = Math.max(1, Math.round(widthMm * 100));
  const heightHmm = Math.max(1, Math.round(heightMm * 100));
  const rootMatrix: Matrix = [widthHmm / vbWidth, 0, 0, heightHmm / vbHeight, -vbX * widthHmm / vbWidth, -vbY * heightHmm / vbHeight];

  const writer = new EmfWriter();
  const omitted = new Set<string>();
  const byId = new Map<string, Element>();
  for (const element of Array.from(root.getElementsByTagName("*"))) {
    const id = element.getAttribute("id");
    if (id) byId.set(id, element);
  }

  // Logical units are 0.01 mm, mapped onto a 96 dpi reference screen. Word sizes a pasted picture
  // from its device bounds at screen resolution, not from the millimetre frame, so the device
  // must be a realistic screen (a 0.01 mm device made Word read a 2 m wide picture).
  const deviceWidth = Math.max(1, Math.round(widthHmm / 2540 * 96));
  const deviceHeight = Math.max(1, Math.round(heightHmm / 2540 * 96));
  writer.ints(EMR.SETMAPMODE, [8]); // MM_ANISOTROPIC
  writer.ints(EMR.SETWINDOWORGEX, [0, 0]);
  writer.ints(EMR.SETWINDOWEXTEX, [widthHmm, heightHmm]);
  writer.ints(EMR.SETVIEWPORTORGEX, [0, 0]);
  writer.ints(EMR.SETVIEWPORTEXTEX, [deviceWidth, deviceHeight]);
  writer.ints(EMR.SETBKMODE, [1]); // TRANSPARENT
  writer.ints(EMR.SETTEXTALIGN, [24]); // TA_BASELINE | TA_LEFT
  let polyFillMode = 0;
  let miterLimit = -1;

  const paintColor = (paint: string, opacity: number): number | undefined => {
    const reference = paint.match(/^url\(\s*#([^)\s]+)\s*\)/);
    if (reference) {
      const gradient = byId.get(reference[1]!);
      const stops = gradient ? Array.from(gradient.getElementsByTagName("stop")) : [];
      const colors = stops.flatMap((stop) => {
        const color = parseColor(styleValue(stop, "stop-color") ?? "#000000");
        const stopOpacity = Number(styleValue(stop, "stop-opacity") ?? 1);
        return color ? [[color[0], color[1], color[2], color[3] * (Number.isFinite(stopOpacity) ? stopOpacity : 1)] as [number, number, number, number]] : [];
      });
      if (colors.length === 0) return undefined;
      omitted.add("gradients (drawn as one colour)");
      const average = [0, 1, 2, 3].map((channel) => colors.reduce((sum, color) => sum + color[channel]!, 0) / colors.length) as [number, number, number, number];
      return colorRef(average, opacity);
    }
    const color = parseColor(paint);
    return color ? colorRef(color, opacity) : undefined;
  };

  const drawSegments = (segments: readonly Segment[], matrix: Matrix, style: Style) => {
    if (segments.length === 0) return;
    const fill = paintColor(style.fill === "currentColor" ? style.color : style.fill, style.fillOpacity * style.opacity);
    const strokeWidth = style.strokeWidth * scaleOf(matrix);
    const stroke = strokeWidth > 0 ? paintColor(style.stroke === "currentColor" ? style.color : style.stroke, style.strokeOpacity * style.opacity) : undefined;
    if (fill === undefined && stroke === undefined) return;

    if (stroke !== undefined) {
      const cap = style.strokeLinecap === "round" ? 0 : style.strokeLinecap === "square" ? 0x100 : 0x200;
      const join = style.strokeLinejoin === "round" ? 0 : style.strokeLinejoin === "bevel" ? 0x1000 : 0x2000;
      const dashes = style.strokeDasharray === "none" ? [] : style.strokeDasharray.split(/[\s,]+/).map(Number).filter((value) => Number.isFinite(value) && value >= 0);
      const scaledDashes = dashes.length % 2 === 1 ? [...dashes, ...dashes] : dashes;
      const userStyle = scaledDashes.length > 0 && scaledDashes.some((value) => value > 0);
      const entries = userStyle ? scaledDashes.map((value) => Math.max(1, Math.round(value * scaleOf(matrix)))) : [];
      const penStyle = 0x10000 | cap | join | (userStyle ? 7 : 0);
      writer.record(EMR.EXTCREATEPEN, (view) => {
        view.setUint32(0, PEN_HANDLE, true);
        view.setUint32(4, 0, true); // offBmi
        view.setUint32(8, 0, true); // cbBmi
        view.setUint32(12, 0, true); // offBits
        view.setUint32(16, 0, true); // cbBits
        view.setUint32(20, penStyle, true);
        view.setUint32(24, Math.max(1, Math.round(strokeWidth)), true);
        view.setUint32(28, 0, true); // BS_SOLID
        view.setUint32(32, stroke, true);
        view.setUint32(36, 0, true); // hatch
        view.setUint32(40, entries.length, true);
        entries.forEach((entry, index) => view.setUint32(44 + index * 4, entry, true));
      }, 44 + entries.length * 4);
      writer.ints(EMR.SELECTOBJECT, [PEN_HANDLE]);
      if (join === 0x2000 && style.strokeMiterlimit !== miterLimit) {
        miterLimit = style.strokeMiterlimit;
        writer.ints(EMR.SETMITERLIMIT, [Math.max(1, Math.round(miterLimit))]);
      }
    } else {
      writer.ints(EMR.SELECTOBJECT, [NULL_PEN]);
    }
    if (fill !== undefined) {
      writer.record(EMR.CREATEBRUSHINDIRECT, (view) => {
        view.setUint32(0, BRUSH_HANDLE, true);
        view.setUint32(4, 0, true); // BS_SOLID
        view.setUint32(8, fill, true);
        view.setUint32(12, 0, true);
      }, 16);
      writer.ints(EMR.SELECTOBJECT, [BRUSH_HANDLE]);
      const mode = style.fillRule === "evenodd" ? 1 : 2; // ALTERNATE / WINDING
      if (mode !== polyFillMode) {
        polyFillMode = mode;
        writer.ints(EMR.SETPOLYFILLMODE, [mode]);
      }
    } else {
      writer.ints(EMR.SELECTOBJECT, [NULL_BRUSH]);
    }

    writer.record(EMR.BEGINPATH, () => undefined, 0);
    let pendingCubics: number[] = [];
    const flushCubics = () => {
      if (pendingCubics.length === 0) return;
      const points = pendingCubics;
      pendingCubics = [];
      writer.record(EMR.POLYBEZIERTO, (view) => {
        view.setInt32(0, 0, true);
        view.setInt32(4, 0, true);
        view.setInt32(8, -1, true);
        view.setInt32(12, -1, true);
        view.setUint32(16, points.length / 2, true);
        points.forEach((value, index) => view.setInt32(20 + index * 4, Math.round(value), true));
      }, 20 + points.length * 4);
    };
    for (const segment of segments) {
      if (segment.kind === "cubic") {
        pendingCubics.push(...apply(matrix, segment.x1, segment.y1), ...apply(matrix, segment.x2, segment.y2), ...apply(matrix, segment.x, segment.y));
        continue;
      }
      flushCubics();
      if (segment.kind === "close") {
        writer.record(EMR.CLOSEFIGURE, () => undefined, 0);
      } else {
        writer.ints(segment.kind === "move" ? EMR.MOVETOEX : EMR.LINETO, apply(matrix, segment.x, segment.y));
      }
    }
    flushCubics();
    writer.record(EMR.ENDPATH, () => undefined, 0);
    const bounds = (view: DataView) => {
      view.setInt32(0, 0, true);
      view.setInt32(4, 0, true);
      view.setInt32(8, -1, true);
      view.setInt32(12, -1, true);
    };
    const type = fill !== undefined && stroke !== undefined ? EMR.STROKEANDFILLPATH : fill !== undefined ? EMR.FILLPATH : EMR.STROKEPATH;
    writer.record(type, bounds, 16);
    if (stroke !== undefined) {
      writer.ints(EMR.SELECTOBJECT, [NULL_PEN]);
      writer.ints(EMR.DELETEOBJECT, [PEN_HANDLE]);
    }
    if (fill !== undefined) {
      writer.ints(EMR.SELECTOBJECT, [NULL_BRUSH]);
      writer.ints(EMR.DELETEOBJECT, [BRUSH_HANDLE]);
    }
  };

  const drawText = (text: string, x: number, y: number, matrix: Matrix, style: Style) => {
    const content = text.replace(/\s+/g, " ");
    if (!content.trim()) return;
    const color = paintColor(style.fill === "currentColor" ? style.color : style.fill, style.fillOpacity * style.opacity);
    if (color === undefined) return;
    const scale = scaleOf(matrix);
    const fontSize = style.fontSize * scale;
    if (!(fontSize > 0)) return;
    const family = firstFontFamily(style.fontFamily);
    const bold = /bold|[6-9]00/.test(style.fontWeight);
    const weight = /bold/.test(style.fontWeight) ? 700 : Math.max(100, Math.min(900, Number(style.fontWeight) || 400));
    const italic = /italic|oblique/.test(style.fontStyle);
    const characters = Array.from(content);
    const metric = isMetricFont(family);
    const letterSpacing = style.letterSpacing * scale;
    const advances = characters.map((character) => advanceEm(character, bold) * fontSize + letterSpacing);
    const width = advances.reduce((sum, advance) => sum + advance, 0);
    const direction = [matrix[0], matrix[1]];
    const directionLength = Math.hypot(direction[0]!, direction[1]!) || 1;
    const ux = direction[0]! / directionLength;
    const uy = direction[1]! / directionLength;
    const shift = style.textAnchor === "middle" ? width / 2 : style.textAnchor === "end" ? width : 0;
    const [px, py] = apply(matrix, x, y);
    const startX = px - ux * shift;
    const startY = py - uy * shift;
    const escapement = Math.round(-Math.atan2(uy, ux) * 1800 / Math.PI);

    writer.record(EMR.EXTCREATEFONTINDIRECTW, (view) => {
      view.setUint32(0, FONT_HANDLE, true);
      view.setInt32(4, -Math.max(1, Math.round(fontSize)), true); // lfHeight: em height
      view.setInt32(8, 0, true);
      view.setInt32(12, escapement, true);
      view.setInt32(16, escapement, true);
      view.setInt32(20, weight, true);
      view.setUint8(24, italic ? 1 : 0);
      view.setUint8(25, /underline/.test(style.textDecoration) ? 1 : 0);
      view.setUint8(26, /line-through/.test(style.textDecoration) ? 1 : 0);
      view.setUint8(27, 1); // DEFAULT_CHARSET
      view.setUint8(28, 4); // OUT_TT_PRECIS
      view.setUint8(29, 0);
      view.setUint8(30, 4); // ANTIALIASED_QUALITY
      view.setUint8(31, 0);
      const name = family.slice(0, 31);
      for (let i = 0; i < name.length; i += 1) view.setUint16(32 + i * 2, name.charCodeAt(i), true);
    }, 4 + 92);
    writer.ints(EMR.SELECTOBJECT, [FONT_HANDLE]);
    writer.ints(EMR.SETTEXTCOLOR, [color]);

    const units: number[] = [];
    const unitAdvances: number[] = [];
    characters.forEach((character, index) => {
      const code = character.codePointAt(0)!;
      if (code > 0xffff) {
        const offset = code - 0x10000;
        units.push(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
        unitAdvances.push(advances[index]!, 0);
      } else {
        units.push(code);
        unitAdvances.push(advances[index]!);
      }
    });
    const stringOffset = 76;
    const stringBytes = Math.ceil(units.length * 2 / 4) * 4;
    const dxOffset = metric ? stringOffset + stringBytes : 0;
    // Round the running position, not each advance, so rounding never drifts along the label.
    const dx: number[] = [];
    let running = 0;
    let placed = 0;
    for (const advance of unitAdvances) {
      running += advance;
      const next = Math.round(running);
      dx.push(next - placed);
      placed = next;
    }
    writer.record(EMR.EXTTEXTOUTW, (view) => {
      view.setInt32(0, 0, true); // Bounds: ignored
      view.setInt32(4, 0, true);
      view.setInt32(8, -1, true);
      view.setInt32(12, -1, true);
      view.setUint32(16, 1, true); // GM_COMPATIBLE
      view.setFloat32(20, 0, true);
      view.setFloat32(24, 0, true);
      view.setInt32(28, Math.round(startX), true);
      view.setInt32(32, Math.round(startY), true);
      view.setUint32(36, units.length, true);
      view.setUint32(40, stringOffset, true);
      view.setUint32(44, 0, true); // options
      view.setInt32(48, 0, true);
      view.setInt32(52, 0, true);
      view.setInt32(56, -1, true);
      view.setInt32(60, -1, true);
      view.setUint32(64, dxOffset, true);
      units.forEach((unit, index) => view.setUint16(stringOffset - 8 + index * 2, unit, true));
      if (metric) dx.forEach((value, index) => view.setInt32(dxOffset - 8 + index * 4, value, true));
    }, stringOffset - 8 + stringBytes + (metric ? dx.length * 4 : 0));
    writer.ints(EMR.SELECTOBJECT, [SYSTEM_FONT]); // release the font before deleting it
    writer.ints(EMR.DELETEOBJECT, [FONT_HANDLE]);
    return width;
  };

  const resolvedStyle = (element: Element, parent: Style): Style => {
    const style: Style = { ...parent, opacity: parent.opacity };
    const set = (name: string, raw: string) => {
      const key = inheritedAttributes[name];
      const value = raw.trim();
      if (!key || value === "" || value === "inherit") return;
      if (numericStyleKeys.has(key)) {
        const number = Number.parseFloat(value);
        if (!Number.isFinite(number)) return;
        // Sizes relative to the parent's font: "72%" (rich-text sub/superscripts), "0.8em".
        const relativeTo = name === "font-size" ? parent.fontSize : style.fontSize;
        (style[key] as number) = value.endsWith("%") ? number / 100 * relativeTo
          : value.endsWith("em") ? number * relativeTo
            : number;
      } else {
        (style[key] as string) = value;
      }
    };
    for (const attribute of Array.from(element.attributes)) set(attribute.name, attribute.value);
    for (const declaration of (element.getAttribute("style") ?? "").split(";")) {
      const [name, ...rest] = declaration.split(":");
      if (name && rest.length > 0) set(name.trim(), rest.join(":"));
    }
    const opacity = Number.parseFloat(styleValue(element, "opacity") ?? "1");
    style.opacity = parent.opacity * (Number.isFinite(opacity) ? opacity : 1);
    return style;
  };

  const number = (element: Element, name: string, fallback = 0) => {
    const value = Number.parseFloat(element.getAttribute(name) ?? "");
    return Number.isFinite(value) ? value : fallback;
  };
  const lengthAttribute = (element: Element, name: string, fontSize: number): number | undefined => {
    const raw = element.getAttribute(name)?.trim().split(/[\s,]+/)[0];
    if (!raw) return undefined;
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return undefined;
    return raw.endsWith("em") ? value * fontSize : value;
  };

  const drawTextElement = (element: Element, matrix: Matrix, style: Style) => {
    // A white stroked copy behind a label (its halo) is left out: GDI cannot stroke glyphs cleanly.
    if (style.stroke !== "none" && element.getAttribute("aria-hidden") === "true") return;
    let x = lengthAttribute(element, "x", style.fontSize) ?? 0;
    let y = lengthAttribute(element, "y", style.fontSize) ?? 0;
    x += lengthAttribute(element, "dx", style.fontSize) ?? 0;
    y += lengthAttribute(element, "dy", style.fontSize) ?? 0;
    const runs: Array<{ text: string; element: Element; style: Style }> = [];
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === 3) {
        runs.push({ text: child.textContent ?? "", element, style });
      } else if (child.nodeType === 1 && (child as Element).tagName === "tspan") {
        const span = child as Element;
        runs.push({ text: span.textContent ?? "", element: span, style: resolvedStyle(span, style) });
      }
    }
    const nonEmpty = runs.filter((run) => run.text.trim().length > 0);
    nonEmpty.forEach((run, index) => {
      if (run.element !== element) {
        const spanX = lengthAttribute(run.element, "x", run.style.fontSize);
        const spanY = lengthAttribute(run.element, "y", run.style.fontSize);
        if (spanX !== undefined) x = spanX;
        if (spanY !== undefined) y = spanY;
        x += lengthAttribute(run.element, "dx", run.style.fontSize) ?? 0;
        y += lengthAttribute(run.element, "dy", run.style.fontSize) ?? 0;
      }
      const baselineShift = styleValue(run.element, "baseline-shift");
      const shiftY = baselineShift === "super" ? -run.style.fontSize * 0.4 : baselineShift === "sub" ? run.style.fontSize * 0.25 : 0;
      const text = index === 0 ? run.text.replace(/^\s+/, "") : run.text;
      const finalText = index === nonEmpty.length - 1 ? text.replace(/\s+$/, "") : text;
      const width = drawText(finalText, x, y + shiftY, matrix, run.style) ?? 0;
      // Width came back in device units; continue the next run after it, in user units.
      x += width / (scaleOf(matrix) || 1);
    });
  };

  const visit = (element: Element, parentMatrix: Matrix, parentStyle: Style) => {
    const tag = element.tagName;
    if (tag === "defs" || tag === "metadata" || tag === "title" || tag === "desc" || tag === "style" ||
      tag === "clipPath" || tag === "linearGradient" || tag === "radialGradient" || tag === "pattern" ||
      tag === "filter" || tag === "marker" || tag === "symbol" || tag === "mask") {
      return;
    }
    if (element.getAttribute("display") === "none" || element.getAttribute("visibility") === "hidden") return;
    if (element.getAttribute("filter")) omitted.add("filter effects (shadows, glows)");
    if (element.getAttribute("clip-path")) omitted.add("clip paths");
    const matrix = multiply(parentMatrix, parseTransform(element.getAttribute("transform")));
    const style = resolvedStyle(element, parentStyle);
    switch (tag) {
      case "svg":
      case "g":
      case "a":
        for (const child of Array.from(element.children)) visit(child, matrix, style);
        return;
      case "path":
        drawSegments(parseSvgPathData(element.getAttribute("d") ?? ""), matrix, style);
        return;
      case "line":
        drawSegments([
          { kind: "move", x: number(element, "x1"), y: number(element, "y1") },
          { kind: "line", x: number(element, "x2"), y: number(element, "y2") }
        ], matrix, { ...style, fill: "none" });
        return;
      case "polyline":
        drawSegments(pointsSegments(element.getAttribute("points") ?? "", false), matrix, style);
        return;
      case "polygon":
        drawSegments(pointsSegments(element.getAttribute("points") ?? "", true), matrix, style);
        return;
      case "rect": {
        const x = number(element, "x"), y = number(element, "y"), w = number(element, "width"), h = number(element, "height");
        if (w <= 0 || h <= 0) return;
        drawSegments([
          { kind: "move", x, y }, { kind: "line", x: x + w, y }, { kind: "line", x: x + w, y: y + h },
          { kind: "line", x, y: y + h }, { kind: "close" }
        ], matrix, style);
        return;
      }
      case "circle": {
        const r = number(element, "r");
        if (r > 0) drawSegments(ellipseSegments(number(element, "cx"), number(element, "cy"), r, r), matrix, style);
        return;
      }
      case "ellipse": {
        const rx = number(element, "rx"), ry = number(element, "ry");
        if (rx > 0 && ry > 0) drawSegments(ellipseSegments(number(element, "cx"), number(element, "cy"), rx, ry), matrix, style);
        return;
      }
      case "text":
        drawTextElement(element, matrix, style);
        return;
      case "image":
        omitted.add("embedded images");
        return;
      default:
        return;
    }
  };

  visit(root, rootMatrix, defaultStyle);
  writer.record(EMR.EOF, (view) => {
    view.setUint32(0, 0, true);
    view.setUint32(4, 16, true);
    view.setUint32(8, 20, true);
  }, 12);

  const headerLength = 108;
  const header = new Uint8Array(headerLength);
  const view = new DataView(header.buffer);
  const totalRecords = writer.records + 1;
  view.setUint32(0, EMR.HEADER, true);
  view.setUint32(4, headerLength, true);
  view.setInt32(8, 0, true); // rclBounds, reference-device pixels, inclusive
  view.setInt32(12, 0, true);
  view.setInt32(16, deviceWidth - 1, true);
  view.setInt32(20, deviceHeight - 1, true);
  view.setInt32(24, 0, true); // rclFrame, 0.01 mm, inclusive
  view.setInt32(28, 0, true);
  view.setInt32(32, widthHmm - 1, true);
  view.setInt32(36, heightHmm - 1, true);
  view.setUint32(40, 0x464d4520, true); // " EMF"
  view.setUint32(44, 0x10000, true);
  view.setUint32(48, headerLength + writer.byteLength, true);
  view.setUint32(52, totalRecords, true);
  view.setUint16(56, 4, true); // handles: 0 reserved, pen, brush, font
  view.setUint16(58, 0, true);
  view.setUint32(60, 0, true); // description
  view.setUint32(64, 0, true);
  view.setUint32(68, 0, true); // palette entries
  // Reference device: a 1920 × 1080 screen at 96 dpi (508 × 285.75 mm).
  view.setInt32(72, 1920, true);
  view.setInt32(76, 1080, true);
  view.setInt32(80, 508, true);
  view.setInt32(84, 286, true);
  view.setUint32(88, 0, true); // pixel format
  view.setUint32(92, 0, true);
  view.setUint32(96, 0, true); // OpenGL
  view.setInt32(100, 508000, true); // micrometres
  view.setInt32(104, 285750, true);

  return { bytes: writer.finish(header), widthHmm, heightHmm, omitted: [...omitted] };
}

function styleValue(element: Element, name: string): string | undefined {
  const fromStyle = (element.getAttribute("style") ?? "").split(";")
    .map((declaration) => declaration.split(":"))
    .find(([key]) => key?.trim() === name)?.slice(1).join(":").trim();
  return fromStyle ?? element.getAttribute(name) ?? undefined;
}
