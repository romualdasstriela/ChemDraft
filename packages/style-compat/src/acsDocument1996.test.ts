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
  it("is exactly what the style-sheet importer makes of the ACS 1996 settings", () => {
    const imported = importChemDrawStyleSheet(acsStyleSheetBytes()).preset.drawing;
    const { stylePresetId: _importedId, ...importedDrawing } = imported;
    const { stylePresetId: _presetId, ...presetDrawing } = AcsDocument1996StylePreset.drawing;
    expect(presetDrawing).toEqual(importedDrawing);
  });
});
