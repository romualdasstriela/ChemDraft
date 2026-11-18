/**
 * File ▸ Insert Artwork: vector artwork (SVG or EPS) brought onto the page as ChemDraft art —
 * frames, borders, logos, decorations. Every shape is reduced to path outlines grouped by how it is
 * painted (fill or stroke, colour, stroke width); each group becomes one path object, and several
 * become one ChemDraft group. Text, embedded pictures, gradients and patterns have no path outline
 * and are skipped with a warning, never silently dropped.
 *
 * SVG: paths, rects (rounded too), circles, ellipses, lines, polylines and polygons, through nested
 * transforms, <use> references and simple class/element CSS rules (Illustrator's .st0 style).
 * EPS: the page's own drawing commands (moveto/lineto/curveto/closepath, rectangles, fill/stroke,
 * gray/RGB/CMYK colour, line width, the transform stack), read without running PostScript; the
 * DOS-binary EPS wrapper Illustrator writes is unwrapped first.
 */
import {
  IDENTITY_ARTWORK_MATRIX,
  multiplyArtworkMatrices,
  artworkPathBounds,
  transformSvgPathToCurves,
  type ArtworkMatrix
} from "@chemdraft/art-engine";

export interface ArtworkLayer {
  mode: "fill" | "stroke";
  color: string;
  /** Stroke width in artwork units (stroke layers). */
  strokeWidth?: number;
  /** Absolute path in artwork units (SVG user units, or PostScript points for EPS). */
  pathD: string;
}

export interface Artwork {
  layers: ArtworkLayer[];
  /** CSS px per artwork unit: 1 for SVG, 96/72 for EPS points. */
  pxPerUnit: number;
  warnings: string[];
}

export class ArtworkImportError extends Error {}

// ---------------------------------------------------------------------------------------- SVG

type Paint = { fill: string; stroke: string; strokeWidth: number; visible: boolean };

const SKIPPED_SVG_ELEMENTS = new Set([
  "defs", "clippath", "mask", "symbol", "pattern", "lineargradient", "radialgradient", "style", "title",
  "desc", "metadata", "marker", "filter", "script", "sodipodi:namedview"
]);

export function parseSvgArtwork(text: string): Artwork {
  const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = parsed.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg" || parsed.getElementsByTagName("parsererror").length > 0) {
    throw new ArtworkImportError("This is not a readable SVG file.");
  }
  const warnings = new Set<string>();
  const cssRules = parseSimpleCss(Array.from(parsed.getElementsByTagName("style")).map((style) => style.textContent ?? "").join("\n"));
  const layers = new Map<string, ArtworkLayer>();
  const byId = new Map<string, Element>();
  for (const element of Array.from(parsed.getElementsByTagName("*"))) {
    const id = element.getAttribute("id");
    if (id) byId.set(id, element);
  }

  const add = (pathD: string, matrix: ArtworkMatrix, paint: Paint, closedShape: boolean) => {
    if (!pathD.trim() || !paint.visible) return;
    let transformed: string;
    try {
      transformed = transformSvgPathToCurves(pathD, matrix);
    } catch {
      warnings.add("a shape with unreadable path data was skipped");
      return;
    }
    if (!transformed) return;
    const fill = closedShape || /[Zz]/.test(pathD) ? paintColor(paint.fill, warnings) : undefined;
    if (fill) addLayer(layers, { mode: "fill", color: fill, pathD: transformed });
    const stroke = paintColor(paint.stroke, warnings);
    if (stroke && paint.strokeWidth > 0) {
      const scale = Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2])) || 1;
      addLayer(layers, { mode: "stroke", color: stroke, strokeWidth: round(paint.strokeWidth * scale), pathD: transformed });
    }
  };

  const visit = (element: Element, matrix: ArtworkMatrix, inherited: Paint, depth: number) => {
    if (depth > 64) return;
    const tag = element.nodeName.toLowerCase();
    if (SKIPPED_SVG_ELEMENTS.has(tag)) return;
    if (tag === "text" || tag === "tspan" || tag === "textpath") { warnings.add("text (convert it to outlines in the drawing program first)"); return; }
    if (tag === "image") { warnings.add("embedded pictures"); return; }
    if (tag === "foreignobject") { warnings.add("embedded HTML"); return; }
    const own = elementMatrix(element);
    let current = multiplyArtworkMatrices(matrix, own);
    const paint = resolvePaint(element, inherited, cssRules);
    if (tag === "svg" && depth > 0) current = multiplyArtworkMatrices(current, nestedSvgMatrix(element));
    switch (tag) {
      case "svg":
      case "g":
      case "a":
      case "switch":
        for (const child of Array.from(element.children)) visit(child, current, paint, depth + 1);
        return;
      case "use": {
        const href = element.getAttribute("href") ?? element.getAttribute("xlink:href") ?? "";
        const target = href.startsWith("#") ? byId.get(href.slice(1)) : undefined;
        if (!target) { warnings.add("a linked copy (use) whose original was not found"); return; }
        const offset: ArtworkMatrix = [1, 0, 0, 1, number(element, "x"), number(element, "y")];
        const placed = multiplyArtworkMatrices(current, offset);
        if (target.nodeName.toLowerCase() === "symbol") {
          for (const child of Array.from(target.children)) visit(child, placed, paint, depth + 1);
        } else {
          visit(target, placed, paint, depth + 1);
        }
        return;
      }
      case "path":
        add(element.getAttribute("d") ?? "", current, paint, false);
        return;
      case "rect":
        add(rectPath(element), current, paint, true);
        return;
      case "circle": {
        const r = number(element, "r");
        add(ellipsePath(number(element, "cx"), number(element, "cy"), r, r), current, paint, true);
        return;
      }
      case "ellipse":
        add(ellipsePath(number(element, "cx"), number(element, "cy"), number(element, "rx"), number(element, "ry")), current, paint, true);
        return;
      case "line":
        add(`M${number(element, "x1")} ${number(element, "y1")}L${number(element, "x2")} ${number(element, "y2")}`, current, { ...paint, fill: "none" }, false);
        return;
      case "polyline":
      case "polygon": {
        const values = (element.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
        if (values.length < 4) return;
        const pairs: string[] = [];
        for (let index = 0; index + 1 < values.length; index += 2) pairs.push(`${values[index]} ${values[index + 1]}`);
        add(`M${pairs.join("L")}${tag === "polygon" ? "Z" : ""}`, current, tag === "polyline" ? { ...paint, fill: "none" } : paint, tag === "polygon");
        return;
      }
      default:
        for (const child of Array.from(element.children)) visit(child, current, paint, depth + 1);
    }
  };

  visit(root, rootSvgMatrix(root), { fill: "#000000", stroke: "none", strokeWidth: 1, visible: true }, 0);
  return finish(layers, 1, warnings);
}

function paintColor(value: string, warnings: Set<string>): string | undefined {
  const paint = value.trim().toLowerCase();
  if (!paint || paint === "none" || paint === "transparent") return undefined;
  if (paint.startsWith("url(")) {
    warnings.add("gradient or pattern fills (drawn in black)");
    return "#111111";
  }
  if (paint === "currentcolor") return "#111111";
  const hex = cssColorHex(paint);
  if (!hex) warnings.add(`the colour "${value.trim()}" (drawn in black)`);
  return hex ?? "#111111";
}

const NAMED_COLORS: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", lime: "#00ff00", blue: "#0000ff",
  yellow: "#ffff00", cyan: "#00ffff", aqua: "#00ffff", magenta: "#ff00ff", fuchsia: "#ff00ff", gray: "#808080",
  grey: "#808080", silver: "#c0c0c0", maroon: "#800000", olive: "#808000", navy: "#000080", purple: "#800080",
  teal: "#008080", orange: "#ffa500", brown: "#a52a2a", pink: "#ffc0cb", darkgray: "#a9a9a9", darkgrey: "#a9a9a9",
  lightgray: "#d3d3d3", lightgrey: "#d3d3d3", darkblue: "#00008b", darkred: "#8b0000", darkgreen: "#006400"
};

/** A CSS colour as six-digit hex (what every ChemDraft renderer and exporter reads), if recognised. */
export function cssColorHex(value: string): string | undefined {
  const text = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  if (/^#[0-9a-f]{3}$/.test(text)) return `#${[...text.slice(1)].map((c) => c + c).join("")}`;
  if (/^#[0-9a-f]{8}$/.test(text)) return text.slice(0, 7);
  const rgb = /^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)/.exec(text);
  if (rgb) {
    const channel = (part: string) => part.endsWith("%") ? Number(part.slice(0, -1)) / 100 : Number(part) / 255;
    return rgbHex(channel(rgb[1]!), channel(rgb[2]!), channel(rgb[3]!));
  }
  return NAMED_COLORS[text];
}

function resolvePaint(element: Element, inherited: Paint, css: Map<string, Record<string, string>>): Paint {
  const declared: Record<string, string> = {};
  const tag = element.nodeName.toLowerCase();
  Object.assign(declared, css.get(tag) ?? {});
  for (const name of (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)) Object.assign(declared, css.get(`.${name}`) ?? {});
  const id = element.getAttribute("id");
  if (id) Object.assign(declared, css.get(`#${id}`) ?? {});
  for (const attribute of ["fill", "stroke", "stroke-width", "display", "visibility", "opacity", "fill-opacity", "stroke-opacity"]) {
    const value = element.getAttribute(attribute);
    if (value !== null) declared[attribute] = value;
  }
  Object.assign(declared, parseDeclarations(element.getAttribute("style") ?? ""));
  const hidden = declared.display === "none" || declared.visibility === "hidden" || Number(declared.opacity) === 0;
  return {
    fill: declared["fill-opacity"] !== undefined && Number(declared["fill-opacity"]) === 0 ? "none" : declared.fill ?? inherited.fill,
    stroke: declared["stroke-opacity"] !== undefined && Number(declared["stroke-opacity"]) === 0 ? "none" : declared.stroke ?? inherited.stroke,
    strokeWidth: declared["stroke-width"] !== undefined ? parseLength(declared["stroke-width"]) ?? inherited.strokeWidth : inherited.strokeWidth,
    visible: inherited.visible && !hidden
  };
}

function parseDeclarations(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of text.split(";")) {
    const colon = part.indexOf(":");
    if (colon > 0) result[part.slice(0, colon).trim().toLowerCase()] = part.slice(colon + 1).trim().replace(/\s*!important$/, "");
  }
  return result;
}

/** `.st0{fill:none;stroke:#000}`, `path{...}`, `#id{...}`, comma lists — the simple rules drawing programs write. */
function parseSimpleCss(text: string): Map<string, Record<string, string>> {
  const rules = new Map<string, Record<string, string>>();
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = parseDeclarations(match[2]!);
    for (const selector of match[1]!.split(",").map((entry) => entry.trim().toLowerCase())) {
      if (/^[.#]?[\w-]+$/.test(selector)) rules.set(selector, { ...(rules.get(selector) ?? {}), ...declarations });
    }
  }
  return rules;
}

function number(element: Element, name: string): number {
  return parseLength(element.getAttribute(name) ?? "") ?? 0;
}

const UNIT_PX: Record<string, number> = { px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };

function parseLength(value: string): number | undefined {
  const match = /^\s*(-?\d*\.?\d+(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(value);
  if (!match) return undefined;
  const unit = match[2]!.toLowerCase();
  return Number(match[1]) * (unit === "" || unit === "%" ? 1 : UNIT_PX[unit] ?? 1);
}

function rootSvgMatrix(svg: Element): ArtworkMatrix {
  // A root with a viewBox and absolute width/height draws its user units at that size.
  const viewBox = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const width = svg.getAttribute("width"), height = svg.getAttribute("height");
  if (viewBox.length !== 4 || !viewBox.every(Number.isFinite) || !width || !height || /%/.test(width + height)) {
    return viewBox.length === 4 && viewBox.every(Number.isFinite) ? [1, 0, 0, 1, -viewBox[0]!, -viewBox[1]!] : IDENTITY_ARTWORK_MATRIX;
  }
  const sx = (parseLength(width) ?? viewBox[2]!) / viewBox[2]!, sy = (parseLength(height) ?? viewBox[3]!) / viewBox[3]!;
  const scale = Math.min(sx, sy);
  return [scale, 0, 0, scale, -viewBox[0]! * scale, -viewBox[1]! * scale];
}

function nestedSvgMatrix(svg: Element): ArtworkMatrix {
  const at: ArtworkMatrix = [1, 0, 0, 1, number(svg, "x"), number(svg, "y")];
  const viewBox = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] === 0 || viewBox[3] === 0) return at;
  const width = number(svg, "width") || viewBox[2]!, height = number(svg, "height") || viewBox[3]!;
  const scale = Math.min(width / viewBox[2]!, height / viewBox[3]!);
  return multiplyArtworkMatrices(at, [scale, 0, 0, scale, -viewBox[0]! * scale, -viewBox[1]! * scale]);
}

function elementMatrix(element: Element): ArtworkMatrix {
  const text = element.getAttribute("transform");
  if (!text) return IDENTITY_ARTWORK_MATRIX;
  let result = IDENTITY_ARTWORK_MATRIX;
  for (const match of text.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi)) {
    const v = match[2]!.trim().split(/[\s,]+/).map(Number);
    const name = match[1]!.toLowerCase();
    let m: ArtworkMatrix = IDENTITY_ARTWORK_MATRIX;
    if (name === "matrix" && v.length === 6) m = v as unknown as ArtworkMatrix;
    else if (name === "translate") m = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
    else if (name === "scale") m = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
    else if (name === "rotate") {
      const angle = (v[0] ?? 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
      const [cx, cy] = [v[1] ?? 0, v[2] ?? 0];
      m = multiplyArtworkMatrices(multiplyArtworkMatrices([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else if (name === "skewx") m = [1, 0, Math.tan((v[0] ?? 0) * Math.PI / 180), 1, 0, 0];
    else if (name === "skewy") m = [1, Math.tan((v[0] ?? 0) * Math.PI / 180), 0, 1, 0, 0];
    result = multiplyArtworkMatrices(result, m);
  }
  return result;
}

function rectPath(element: Element): string {
  const x = number(element, "x"), y = number(element, "y"), w = number(element, "width"), h = number(element, "height");
  if (w <= 0 || h <= 0) return "";
  let rx = number(element, "rx"), ry = number(element, "ry");
  if (!element.hasAttribute("rx")) rx = ry;
  if (!element.hasAttribute("ry")) ry = rx;
  rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
  if (rx <= 0 || ry <= 0) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
  return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}` +
    `H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  if (rx <= 0 || ry <= 0) return "";
  return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
}

// ---------------------------------------------------------------------------------------- EPS

/** The PostScript part of an EPS: as is, or unwrapped from the DOS-binary header Illustrator writes. */
export function epsPostScript(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 30 && view.getUint32(0, false) === 0xc5d0d3c6) {
    const offset = view.getUint32(4, true), length = view.getUint32(8, true);
    return latin1(bytes.subarray(offset, offset + length));
  }
  return latin1(bytes);
}

function latin1(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return text;
}

const EPS_OPERATOR_ALIASES: Record<string, string> = {
  moveto: "m", mo: "m", lineto: "l", li: "l", curveto: "c", cv: "c", closepath: "h", cp: "h",
  rmoveto: "rm", rlineto: "rl", rcurveto: "rc",
  fill: "f", F: "f", eofill: "f", ef: "f", "f*": "f",
  stroke: "S", s: "s", b: "b", "b*": "b", B: "B", "B*": "B",
  newpath: "n", np: "n", clip: "n", eoclip: "n", W: "n", "W*": "n", clp: "n",
  gsave: "q", grestore: "Q", concat: "cm", setlinewidth: "w",
  setgray: "g", setrgbcolor: "rg", setcmykcolor: "k"
};

export function parseEpsArtwork(bytes: Uint8Array): Artwork {
  const postScript = epsPostScript(bytes);
  if (!/^%!PS/.test(postScript.trimStart())) throw new ArtworkImportError("This is not a readable EPS file.");
  const warnings = new Set<string>();
  const bbox = /%%HiResBoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/.exec(postScript)
    ?? /%%BoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/.exec(postScript);
  const top = bbox ? Number(bbox[4]) : 0, left = bbox ? Number(bbox[1]) : 0;
  // Only the page's drawing, not the prolog's procedure definitions.
  const startMarkers = ["%%EndPageSetup", "%%BeginPageSetup", "%%Page:", "%%EndSetup", "%%EndProlog"];
  const start = startMarkers.map((marker) => postScript.indexOf(marker)).find((index) => index >= 0) ?? 0;
  const endMarkers = ["%%PageTrailer", "%%Trailer", "%%EOF"].map((marker) => postScript.indexOf(marker, start)).filter((index) => index > start);
  const body = postScript.slice(start, endMarkers.length > 0 ? Math.min(...endMarkers) : undefined);

  // Device space is PostScript's y-up page; artwork units are y-down from the bounding box's corner.
  const toArtwork: ArtworkMatrix = [1, 0, 0, -1, -left, top];
  type State = { ctm: ArtworkMatrix; color: string; lineWidth: number };
  let state: State = { ctm: IDENTITY_ARTWORK_MATRIX, color: "#000000", lineWidth: 1 };
  const saved: State[] = [];
  const layers = new Map<string, ArtworkLayer>();
  let path = "";
  let point: [number, number] = [0, 0];
  let stack: number[] = [];
  let braceDepth = 0;
  const map = (x: number, y: number) => {
    const [a, b, c, d, e, f] = multiplyArtworkMatrices(toArtwork, state.ctm);
    return `${round(a * x + c * y + e)} ${round(b * x + d * y + f)}`;
  };
  const paint = (mode: "fill" | "stroke") => {
    if (!path) return;
    const scale = Math.sqrt(Math.abs(state.ctm[0] * state.ctm[3] - state.ctm[1] * state.ctm[2])) || 1;
    addLayer(layers, mode === "fill"
      ? { mode, color: state.color, pathD: path }
      : { mode, color: state.color, strokeWidth: round(Math.max(0.25, state.lineWidth * scale)), pathD: path });
  };
  for (const token of body.split(/\s+/)) {
    if (!token || token.startsWith("%")) continue;
    // Array brackets around numbers ("[1 0 0 1 0 0] concat") only group them.
    const raw = token.replace(/^\[+|\]+$/g, "");
    if (!raw) continue;
    if (raw.includes("{")) braceDepth += raw.split("{").length - 1;
    if (raw.includes("}")) { braceDepth = Math.max(0, braceDepth - (raw.split("}").length - 1)); stack = []; continue; }
    if (braceDepth > 0) continue;
    if (/^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(raw)) { stack.push(Number(raw)); continue; }
    const op = EPS_OPERATOR_ALIASES[raw] ?? raw;
    const s = stack;
    switch (op) {
      case "m": if (s.length >= 2) { point = [s[s.length - 2]!, s[s.length - 1]!]; path += `M${map(...point)}`; } break;
      case "l": if (s.length >= 2) { point = [s[s.length - 2]!, s[s.length - 1]!]; path += `L${map(...point)}`; } break;
      case "c": if (s.length >= 6) { const v = s.slice(-6); point = [v[4]!, v[5]!]; path += `C${map(v[0]!, v[1]!)} ${map(v[2]!, v[3]!)} ${map(v[4]!, v[5]!)}`; } break;
      // Illustrator's v / y: a curve whose first or second control point sits on an end point.
      case "v": if (s.length >= 4) { const v = s.slice(-4); path += `C${map(...point)} ${map(v[0]!, v[1]!)} ${map(v[2]!, v[3]!)}`; point = [v[2]!, v[3]!]; } break;
      case "y": if (s.length >= 4) { const v = s.slice(-4); path += `C${map(v[0]!, v[1]!)} ${map(v[2]!, v[3]!)} ${map(v[2]!, v[3]!)}`; point = [v[2]!, v[3]!]; } break;
      case "rm": if (s.length >= 2) { point = [point[0] + s[s.length - 2]!, point[1] + s[s.length - 1]!]; path += `M${map(...point)}`; } break;
      case "rl": if (s.length >= 2) { point = [point[0] + s[s.length - 2]!, point[1] + s[s.length - 1]!]; path += `L${map(...point)}`; } break;
      case "rc": if (s.length >= 6) { const v = s.slice(-6), [x, y] = point; point = [x + v[4]!, y + v[5]!];
        path += `C${map(x + v[0]!, y + v[1]!)} ${map(x + v[2]!, y + v[3]!)} ${map(...point)}`; } break;
      case "re": if (s.length >= 4) { const [x, y, w, h] = s.slice(-4) as [number, number, number, number];
        path += `M${map(x, y)}L${map(x + w, y)}L${map(x + w, y + h)}L${map(x, y + h)}Z`; point = [x, y]; } break;
      case "h": path += "Z"; break;
      case "f": paint("fill"); path = ""; break;
      case "S": paint("stroke"); path = ""; break;
      case "s": path += "Z"; paint("stroke"); path = ""; break;
      case "b": path += "Z"; paint("fill"); paint("stroke"); path = ""; break;
      case "B": paint("fill"); paint("stroke"); path = ""; break;
      case "n": path = ""; break;
      case "q": saved.push({ ...state }); break;
      case "Q": state = saved.pop() ?? state; break;
      case "cm": if (s.length >= 6) state = { ...state, ctm: multiplyArtworkMatrices(state.ctm, s.slice(-6) as unknown as ArtworkMatrix) }; break;
      case "translate": if (s.length >= 2) state = { ...state, ctm: multiplyArtworkMatrices(state.ctm, [1, 0, 0, 1, s[s.length - 2]!, s[s.length - 1]!]) }; break;
      case "scale": if (s.length >= 2) state = { ...state, ctm: multiplyArtworkMatrices(state.ctm, [s[s.length - 2]!, 0, 0, s[s.length - 1]!, 0, 0]) }; break;
      case "rotate": if (s.length >= 1) { const angle = s[s.length - 1]! * Math.PI / 180;
        state = { ...state, ctm: multiplyArtworkMatrices(state.ctm, [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0]) }; } break;
      case "w": if (s.length >= 1) state = { ...state, lineWidth: s[s.length - 1]! }; break;
      case "g": case "G": if (s.length >= 1) state = { ...state, color: grayHex(s[s.length - 1]!) }; break;
      case "rg": case "RG": if (s.length >= 3) state = { ...state, color: rgbHex(...(s.slice(-3) as [number, number, number])) }; break;
      case "k": case "K": if (s.length >= 4) { const [c, m, y, k] = s.slice(-4) as [number, number, number, number];
        state = { ...state, color: rgbHex((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)) }; } break;
      case "image": case "colorimage": case "imagemask": case "BI": warnings.add("embedded pictures"); break;
      case "show": case "ashow": case "widthshow": case "xshow": case "Tj": case "TJ": warnings.add("text (convert it to outlines in the drawing program first)"); break;
      default: break;
    }
    stack = [];
  }
  return finish(layers, 96 / 72, warnings);
}

const grayHex = (g: number) => rgbHex(g, g, g);
function rgbHex(r: number, g: number, b: number): string {
  const channel = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

// ---------------------------------------------------------------------------------------- shared

function addLayer(layers: Map<string, ArtworkLayer>, layer: ArtworkLayer): void {
  const key = `${layer.mode}|${layer.color.toLowerCase()}|${layer.strokeWidth ?? ""}`;
  const existing = layers.get(key);
  if (existing) existing.pathD += layer.pathD;
  else layers.set(key, { ...layer });
}

function finish(layers: Map<string, ArtworkLayer>, pxPerUnit: number, warnings: Set<string>): Artwork {
  const result = [...layers.values()].filter((layer) => {
    try {
      const box = artworkPathBounds(layer.pathD);
      return box.width > 0 || box.height > 0;
    } catch {
      return false;
    }
  });
  if (result.length === 0) throw new ArtworkImportError("The file has no vector shapes ChemDraft can place.");
  return { layers: result, pxPerUnit, warnings: [...warnings] };
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

/** Pick the reader by file name and contents. */
export function parseArtworkFile(name: string, bytes: Uint8Array): Artwork {
  const head = latin1(bytes.subarray(0, 1024)).trimStart();
  if (/\.(eps|epsf|ps|ai)$/i.test(name) || head.startsWith("%!PS") || (bytes[0] === 0xc5 && bytes[1] === 0xd0)) {
    return parseEpsArtwork(bytes);
  }
  if (/\.svgz$/i.test(name)) throw new ArtworkImportError("Compressed SVG (.svgz) is not supported; save it as plain .svg.");
  return parseSvgArtwork(new TextDecoder().decode(bytes));
}
