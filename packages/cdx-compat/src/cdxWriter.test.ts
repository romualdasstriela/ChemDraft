import { describe, expect, it } from "vitest";
import type { GraphicObject, MoleculeObject, TextObject } from "@chemdraft/chem-core";

import { cdxToCdxml, cdxmlToCdx, exportDocumentToCdxml, isCdxBytes, openChemDraftBytes, openChemDraftPayload } from "./index";

/** A small scheme: an anisole-like fragment with a label, a caption, a box and an arrow. */
const sample = `<?xml version="1.0" encoding="UTF-8"?>
<CDXML CreationProgram="Test" BondLength="14.4" LineWidth="0.6" BoldWidth="2">
<colortable><color r="1" g="1" b="1"/><color r="0" g="0" b="0"/><color r="1" g="0" b="0"/></colortable>
<fonttable><font id="3" name="Arial"/></fonttable>
<page id="page_001" BoundingBox="0 0 612 792">
  <fragment id="frag">
    <n id="a" p="100 50" Element="8" Charge="-1"/>
    <n id="b" p="114.4 50"/>
    <n id="c" p="121.6 62.47" Element="OMe"/>
    <n id="d" xyz="128.8 50 -9.5"/>
    <b id="e" B="a" E="b" Order="1" Display="WedgeBegin"/>
    <b id="f" B="b" E="c" Order="2" DoublePosition="Left"/>
    <b id="g" B="b" E="d" Order="1" Display="Bold"/>
  </fragment>
  <t id="caption" p="100 100"><s font="3" size="12" face="2" color="4">Slow addition;
in situ</s></t>
  <graphic id="box" color="4" GraphicType="Rectangle" RectangleType="RoundEdge" BoundingBox="90 30 160 110"/>
  <arrow id="arrow" ArrowheadHead="Full" ArrowheadType="Solid" Head3D="200 80 0" Tail3D="140 80 0" BoundingBox="140 77 200 83"/>
  <objecttag Name="org.chemdraft/native-document" Persistent="yes" TagType="String" Value="e30="/>
</page>
</CDXML>`;

describe("ChemDraw binary (.cdx) writer", () => {
  it("writes a file the reader takes back to the same drawing", () => {
    const { bytes, warnings } = cdxmlToCdx(sample);
    expect(bytes && isCdxBytes(bytes)).toBe(true);
    // The embedded ChemDraft document cannot go into CDX, and the export says so.
    expect(warnings.map((warning) => warning.code)).toContain("cdx.native_extras_omitted");

    const xml = cdxToCdxml(bytes!).contents!;
    for (const setting of ['BondLength="14.4"', 'BoldWidth="2"', 'LineWidth="0.6"']) expect(xml.match(/<CDXML[^>]*>/)![0]).toContain(setting);
    expect(xml).toContain('<color r="1" g="0" b="0"/>');
    expect(xml).toContain('<font id="3" name="Arial"/>');
    expect(xml).toMatch(/<n id="\d+" p="100 50" Element="8" Charge="-1">/);
    expect(xml).toMatch(/<n id="\d+" xyz="128.8 50 -9.5">/);
    expect(xml).toMatch(/Order="1" Display="WedgeBegin"/);
    expect(xml).toMatch(/Order="2" DoublePosition="Left"/);
    expect(xml).toContain('<s font="3" size="12" face="2" color="4">Slow addition;\nin situ</s>');
    expect(xml).toMatch(/GraphicType="Rectangle"[^>]*RectangleType="RoundEdge"|RectangleType="RoundEdge"[^>]*GraphicType="Rectangle"/);
    expect(xml).toContain('BoundingBox="90 30 160 110"');
    expect(xml).toContain('Head3D="200 80 0"');
  });

  it("renumbers text ids and keeps every bond on its atoms", () => {
    const xml = cdxToCdxml(cdxmlToCdx(sample).bytes!).contents!;
    const ids = [...xml.matchAll(/<n id="(\d+)"/g)].map((match) => match[1]);
    const bonds = [...xml.matchAll(/<b id="\d+"[^>]* B="(\d+)" E="(\d+)"/g)].map((match) => [match[1], match[2]]);
    expect(ids).toHaveLength(4);
    expect(bonds).toEqual([[ids[0], ids[1]], [ids[1], ids[2]], [ids[1], ids[3]]]);
  });

  it("writes a group label as a labelled node, which reads back as that group", () => {
    const opened = openChemDraftBytes(cdxmlToCdx(sample).bytes!);
    const molecule = opened.document!.pages[0]!.objects.find((object): object is MoleculeObject => object.type === "molecule")!;
    expect(molecule.atoms.map((atom) => atom.element)).toEqual(["O", "C", "OMe", "C"]);
    expect(molecule.atoms[2]!.labelLiteral).toBeUndefined();
    expect(molecule.atoms[0]!.formalCharge).toBe(-1);
    expect(molecule.bonds.map((bond) => bond.order)).toEqual(["single", "double", "single"]);
  });

  it("round-trips a ChemDraft drawing through CDX: structures, text, shapes and arrows", () => {
    const original = openChemDraftPayload(sample.replace(/<objecttag[^>]*\/>/, "")).document!;
    const back = openChemDraftBytes(cdxmlToCdx(exportDocumentToCdxml(original).contents).bytes!).document!;
    const kinds = (objects: readonly { type: string }[]) => objects.map((object) => object.type).sort();
    expect(kinds(back.pages[0]!.objects)).toEqual(kinds(original.pages[0]!.objects.filter((object) => object.type !== "unknown-compatibility-object")));
    const text = (document: typeof original) => document.pages[0]!.objects.filter((object): object is TextObject => object.type === "text")[0]!;
    expect(text(back).text).toBe(text(original).text);
    expect(text(back).y).toBeCloseTo(text(original).y, 3);
    const arrow = back.pages[0]!.objects.find((object): object is GraphicObject => object.type === "graphic" && object.data.markerEnd !== undefined);
    expect(arrow?.data.markerEnd?.kind).toBe("filled-arrow");
  });

  it("replaces characters CDX cannot store, and says so", () => {
    const { bytes, warnings } = cdxmlToCdx(sample.replace("Slow addition;", "Slow addition ✓"));
    expect(bytes).toBeDefined();
    expect(warnings.map((warning) => warning.code)).toContain("cdx.characters_replaced");
  });

  it("fails clearly on text that is not CDXML", () => {
    expect(cdxmlToCdx("<svg/>").bytes).toBeUndefined();
    expect(cdxmlToCdx("<svg/>").warnings[0]?.code).toBe("cdx.write_unreadable");
  });
});
