import { describe, expect, it } from "vitest";
import type { GraphicObject, MoleculeObject } from "@chemdraft/chem-core";

import { openChemDraftPayload } from "./index";

// CDXML written by other programs (ChemDraw itself, or a converter re-saving a ChemDraw file): the
// shapes these tests write are taken from such files, cut down to the part each test is about.

function cdxml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<CDXML><colortable><color r="1" g="1" b="1"/><color r="0" g="0" b="0"/><color r="1" g="1" b="0"/></colortable>
<page id="1">${body}</page></CDXML>`;
}

function open(body: string) {
  const opened = openChemDraftPayload(cdxml(body));
  const molecules = (opened.document?.pages[0]?.objects ?? []).filter((object): object is MoleculeObject => object.type === "molecule");
  const graphics = (opened.document?.pages[0]?.objects ?? []).filter((object): object is GraphicObject => object.type === "graphic");
  return { opened, molecules, graphics, codes: opened.warnings.map((warning) => warning.code) };
}

const label = (text: string) => `<t><s font="1" size="10">${text}</s></t>`;

describe("CDXML from other programs", () => {
  it("places an atom that has only a 3D position at its x and y, not at the page corner", () => {
    const { molecules } = open(`<fragment id="2">
      <n id="3" p="100 50" Element="6"/>
      <n id="4" xyz="114.4 50 -9.9" Element="6"/>
      <b id="5" B="3" E="4" Order="1"/>
    </fragment>`);
    const [first, second] = molecules[0]!.atoms;
    expect(second!.x - first!.x).toBeCloseTo((114.4 - 100) * (first!.x / 100));
    expect(second!.y).toBeCloseTo(first!.y);
  });

  it("takes Display=\"Solid\" as the ordinary bond it is, without a warning", () => {
    const { codes, molecules } = open(`<fragment id="2">
      <n id="3" p="100 50"/><n id="4" p="114 50"/>
      <b id="5" B="3" E="4" Order="1" Display="Solid"/>
    </fragment>`);
    expect(codes).not.toContain("cdxml.bond_display_unsupported");
    expect(molecules[0]!.bonds[0]!.display?.bondStyle).toBeUndefined();
  });

  /** A ring carbon bearing an abbreviation node whose nested fragment is `inner`. */
  const withAbbreviation = (text: string, inner: string) => `<fragment id="2">
    <n id="3" p="100 50" Element="6"/>
    <n id="4" p="114 50" NodeType="Nickname"><fragment id="10">
      <n id="11" p="100 50" NodeType="ExternalConnectionPoint"/>
      ${inner}
    </fragment>${label(text)}</n>
    <b id="5" B="3" E="4" Order="1"/>
  </fragment>`;

  it("keeps an abbreviation as the labelled atom it was drawn as when it is exactly that group", () => {
    // OMe: an O bonded to the outside and to a CH3 (hydrogens left implicit, as ChemDraw writes them).
    const { molecules } = open(withAbbreviation("OMe", `<n id="12" p="114 50" Element="8"/><n id="13" p="128 50" Element="6"/>
      <b id="14" B="11" E="12" Order="1"/><b id="15" B="12" E="13" Order="1"/>`));
    const atoms = molecules[0]!.atoms;
    expect(atoms.map((atom) => atom.element)).toEqual(["C", "OMe"]);
    expect(atoms[1]!.labelLiteral).toBeUndefined();
    expect(molecules[0]!.bonds).toHaveLength(1);
  });

  it("keeps a hyphenated alkyl spelling such as i-Pr, as the group's own label iPr", () => {
    const { molecules } = open(withAbbreviation("i-Pr", `<n id="12" p="114 50" Element="6" NumHydrogens="1"/>
      <n id="13" p="128 44" Element="6" NumHydrogens="3"/><n id="16" p="128 56" Element="6" NumHydrogens="3"/>
      <b id="14" B="11" E="12" Order="1"/><b id="15" B="12" E="13" Order="1"/><b id="17" B="12" E="16" Order="1"/>`));
    expect(molecules[0]!.atoms.map((atom) => atom.element)).toEqual(["C", "iPr"]);
  });

  it("writes an abbreviation out atom by atom when its atoms are not the group its label names", () => {
    // Labelled "OMe" but holding an ethoxy: the atoms are the chemistry, so they win over the label.
    const { molecules } = open(withAbbreviation("OMe", `<n id="12" p="114 50" Element="8"/><n id="13" p="128 50" Element="6"/>
      <n id="16" p="142 50" Element="6"/>
      <b id="14" B="11" E="12" Order="1"/><b id="15" B="12" E="13" Order="1"/><b id="17" B="13" E="16" Order="1"/>`));
    expect(molecules[0]!.atoms.map((atom) => atom.element)).toEqual(["C", "O", "C", "C"]);
  });

  it("reads an unspecified node as the label drawn on it (R1, X), never as carbon", () => {
    const { molecules } = open(`<fragment id="2">
      <n id="3" p="100 50" Element="6"/>
      <n id="4" p="114 50" NodeType="Unspecified">${label("R1")}</n>
      <n id="6" p="86 50" NodeType="Unspecified">${label("Q7z")}</n>
      <b id="5" B="3" E="4" Order="1"/><b id="7" B="3" E="6" Order="1"/>
    </fragment>`);
    const atoms = molecules[0]!.atoms;
    expect(atoms.map((atom) => atom.element)).toEqual(["C", "R1", "Q7z"]);
    // R1 is a placeholder ChemDraft understands; an unknown label stays the literal text drawn.
    expect(atoms[1]!.labelLiteral).toBeUndefined();
    expect(atoms[2]!.labelLiteral).toBe(true);
  });

  it("imports a curve as a path shape: nodes with their control points, closed, dashed, coloured", () => {
    // Two nodes, each written as control-before, node, control-after.
    const { graphics, codes } = open(`<curve id="2" color="4" CurveType="3"
      CurvePoints="10 20 20 20 30 20 50 60 60 60 70 60"/>`);
    expect(codes).not.toContain("cdxml.object_import_unsupported");
    const curve = graphics[0]!;
    expect(curve.graphicKind).toBe("path");
    expect(curve.data.artPathKind).toBe("bezier");
    expect(curve.data.pathClosed).toBe(true);
    expect(curve.data.pathNodes).toHaveLength(2);
    expect(curve.style.strokeDasharray).toBeDefined();
    expect(curve.style.strokeColor?.toLowerCase()).toBe("#ffff00");
  });

  it("keeps an atom label at its atom when the writer gave the label an empty box at 0,0", () => {
    const { molecules } = open(`<fragment id="2">
      <n id="3" p="100 50" Element="6"/>
      <n id="4" p="114 50" Element="53"><t id="6" BoundingBox="0 0 0 0"><s font="1" size="10">I</s></t></n>
      <b id="5" B="3" E="4" Order="1"/>
    </fragment>`);
    expect(molecules[0]!.atoms[1]!.labelOffset).toBeUndefined();
  });

  it("reads ArrowheadTail=\"NoHead\" as an unheaded end, not a second head", () => {
    const { graphics } = open(`<arrow id="2" ArrowheadType="Solid" ArrowheadHead="Full" ArrowheadTail="NoHead"
      Head3D="289 141 0" Tail3D="203 141 0" BoundingBox="203 141 289 141"/>`);
    expect(graphics[0]!.data.markerEnd?.kind).toBe("filled-arrow");
    expect(graphics[0]!.data.markerStart).toBeUndefined();
  });

  it("places a text by its baseline, so it reads back where it was written", () => {
    const opened = openChemDraftPayload(cdxml(`<t id="2" p="100 50"><s font="1" size="10">THF, reflux</s></t>`));
    const text = opened.document!.pages[0]!.objects.find((object) => object.type === "text")!;
    const at50 = openChemDraftPayload(cdxml(`<t id="2" p="100 60"><s font="1" size="10">x</s></t>`)).document!.pages[0]!.objects[0]!;
    // Ten points further down is the same distance in document units, whatever the baseline offset.
    expect(at50.y - text.y).toBeCloseTo((10 * text.x) / 100);
    // The top sits above the baseline point, not on it.
    expect(text.y).toBeLessThan((50 * text.x) / 100);
  });

  it("imports a curve whose control points sit on its nodes as a polyline, with its arrowhead", () => {
    const { graphics } = open(`<curve id="2" CurveType="8" CurvePoints="10 20 10 20 10 20 50 60 50 60 50 60"/>`);
    expect(graphics[0]!.data.artPathKind).toBe("polyline");
    expect(graphics[0]!.data.pathNodes?.every((node) => node.inControl === undefined)).toBe(true);
    expect(graphics[0]!.data.markerEnd?.kind).toBe("filled-arrow");
  });
});
