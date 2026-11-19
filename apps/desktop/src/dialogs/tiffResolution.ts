import type { ExportDialogFormat, RasterDialogExportOptions } from "./exportOptions";

/** TIFF export resolution: 600 DPI unless the user picks another value from 100 to 1000. */
export const TIFF_DEFAULT_DPI = 600;
export const TIFF_MIN_DPI = 100;
export const TIFF_MAX_DPI = 1000;
/** The drawing's own units are CSS pixels, 96 to the inch. */
export const DRAWING_PX_PER_INCH = 96;

export function validTiffDpi(dpi: unknown): dpi is number {
  return typeof dpi === "number" && Number.isFinite(dpi) && dpi >= TIFF_MIN_DPI && dpi <= TIFF_MAX_DPI;
}

/** The DPI a TIFF export renders and records: the chosen one, else the default. */
export function tiffDpi(raster: Pick<RasterDialogExportOptions, "dpi">): number {
  return validTiffDpi(raster.dpi) ? raster.dpi : TIFF_DEFAULT_DPI;
}

/** The DPI range the size section's DPI box allows for a format. */
export function presentationDpiRange(format: ExportDialogFormat): { min: number; max: number } {
  return format === "tiff" ? { min: TIFF_MIN_DPI, max: TIFF_MAX_DPI } : { min: 36, max: 1200 };
}

export const tiffDpiRangeMessage = `TIFF resolution must be between ${TIFF_MIN_DPI} and ${TIFF_MAX_DPI} DPI. Enter a value in that range.`;
