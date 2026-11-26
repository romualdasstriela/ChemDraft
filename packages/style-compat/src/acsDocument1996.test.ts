import { describe, expect, it } from "vitest";
import { AcsDocument1996StylePreset } from "@chemdraft/chem-core";
import { importChemDrawStyleSheet } from "./index";

/**
 * A minimal style sheet carrying only the ACS Document 1996 drawing settings, built here so no
 * third-party .cds file is committed: tag (u16), length (u16), little-endian value.
 */
function acsStyleSheetBytes(): Uint8Array {
  const bytes: number[] = [..."VjCD0100"].map((character) => character.charCodeAt(0));
  while (bytes.length < 22) bytes.push(0);
  const fixed = (tag: number, value: number) => {
    const raw = Math.round(value * 65536);
    bytes.push(tag & 0xff, tag >> 8, 4, 0, raw & 0xff, (raw >> 8) & 0xff, (raw >> 16) & 0xff, (raw >>> 24) & 0xff);
  };
  fixed(0x0809, 2.5); // hash spacing, pt
  fixed(0x0808, 1.6); // margin width, pt
  fixed(0x0807, 0.6); // line width, pt
  fixed(0x0806, 2.0); // bold width, pt
  fixed(0x0805, 14.4); // bond length, pt
  bytes.push(0x04, 0x08, 2, 0, 180, 0); // bond spacing, tenths of a percent: 18%
  fixed(0x0803, 120); // chain angle, degrees
  bytes.push(0, 0);
  return new Uint8Array(bytes);
}

describe("ACS Document 1996 preset", () => {
  it("draws the ACS 1996 style-sheet settings at their printed size", () => {
    // The sheet's settings, as the importer reads them (angle and spacing need no unit change).
    const imported = importChemDrawStyleSheet(acsStyleSheetBytes()).preset.drawing;
    const preset = AcsDocument1996StylePreset.drawing;
    expect(preset.chainAngleDegrees).toBe(imported.chainAngleDegrees);
    expect(preset.bondSpacingMode).toBe(imported.bondSpacingMode);
    expect(preset.bondSpacingPercent).toBe(imported.bondSpacingPercent);
    // Point sizes at 96 page px to the inch: what the sheet sets is what the page measures.
    const px = (points: number) => points * 96 / 72;
    expect(preset.bondLengthPx).toBeCloseTo(px(14.4), 6);
    expect(preset.bondStrokeWidthPx).toBeCloseTo(px(0.6), 6);
    expect(preset.bondBoldWidthPx).toBeCloseTo(px(2.0), 6);
    expect(preset.bondMarginWidthPx).toBeCloseTo(px(1.6), 6);
    expect(preset.bondHashSpacingPx).toBeCloseTo(px(2.5), 6);
    expect(preset.multipleBondGapPx).toBeCloseTo(px(14.4) * 0.18, 6);
    expect(preset.atomLabelFontSizePx).toBeCloseTo(px(10), 6);
    expect(preset.atomLabelFontFamily).toBe("Arial, Helvetica, sans-serif");
  });
});
