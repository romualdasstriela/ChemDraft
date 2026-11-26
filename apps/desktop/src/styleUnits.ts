/**
 * Display units for drawing-style lengths. Styles are stored in page pixels (96 to the inch, the
 * unit pages and exports are measured in); settings show them as a chemist reads a journal style:
 * lengths in centimetres, font sizes in points.
 */
export interface StyleDisplayUnit {
  /** Shown after the field's name, e.g. "cm". */
  label: string;
  /** Display units per page pixel. */
  perPx: number;
  /** Decimal places shown and kept when typed. */
  digits: number;
  /** Step of the field's arrows and slider, in display units. */
  step: number;
}

export const PAGE_PX_PER_INCH = 96;

export const CM_UNIT: StyleDisplayUnit = { label: "cm", perPx: 2.54 / PAGE_PX_PER_INCH, digits: 3, step: 0.001 };
export const PT_UNIT: StyleDisplayUnit = { label: "pt", perPx: 72 / PAGE_PX_PER_INCH, digits: 2, step: 0.5 };

/** A page-pixel length in a display unit, rounded to the unit's digits. */
export function pxToDisplay(px: number, unit: StyleDisplayUnit): number {
  return Number((px * unit.perPx).toFixed(unit.digits));
}

/** A display-unit value back in page pixels (what style commands take). */
export function displayToPx(value: number, unit: StyleDisplayUnit): number {
  return value / unit.perPx;
}

/** "0.508 cm", "10 pt": a page-pixel length written in a display unit. */
export function formatStyleLength(px: number, unit: StyleDisplayUnit): string {
  return `${pxToDisplay(px, unit).toFixed(unit.digits).replace(/\.?0+$/, "")} ${unit.label}`;
}
