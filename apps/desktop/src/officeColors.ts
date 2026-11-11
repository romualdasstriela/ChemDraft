/**
 * The colour palette Word, Excel and PowerPoint show in their colour menus (default Office theme),
 * so a drawing can use exactly the colours of the document it goes into: ten theme columns, each a
 * base colour with five lighter/darker variants under it, and the ten standard colours.
 *
 * The values are Office's own, read from Office through automation (a fill set to each theme
 * colour at each Lighter/Darker step of the menu, then its RGB). Recomputing them from the theme
 * with HSL arithmetic lands up to two units off in places, because Office rounds its own way.
 */

export interface OfficeColor {
  /** What Office calls it, e.g. "Accent 1, Lighter 40%". */
  title: string;
  /** "#rrggbb", lower case. */
  color: string;
}

interface OfficeThemeColumn {
  name: string;
  /** Lighter (+) or darker (-) steps of the five variants, in percent, top to bottom. */
  steps: readonly number[];
  /** The base colour, then the five variants. */
  colors: readonly string[];
}

const OFFICE_THEME_COLUMNS: readonly OfficeThemeColumn[] = [
  { name: "Background 1", steps: [-5, -15, -25, -35, -50], colors: ["ffffff", "f2f2f2", "d9d9d9", "bfbfbf", "a6a6a6", "808080"] },
  { name: "Text 1", steps: [50, 35, 25, 15, 5], colors: ["000000", "808080", "595959", "404040", "262626", "0d0d0d"] },
  { name: "Background 2", steps: [-10, -25, -50, -75, -90], colors: ["e8e8e8", "d0d0d0", "adadad", "747474", "393939", "161616"] },
  { name: "Text 2", steps: [90, 75, 50, 25, 10], colors: ["0e2841", "dae9f8", "a6c9ec", "4d93d9", "215c98", "153d64"] },
  { name: "Accent 1", steps: [80, 60, 40, -25, -50], colors: ["156082", "c0e6f5", "83cceb", "44b3e1", "104861", "0b3040"] },
  { name: "Accent 2", steps: [80, 60, 40, -25, -50], colors: ["e97132", "fbe2d5", "f7c7ac", "f1a983", "be5014", "7e350e"] },
  { name: "Accent 3", steps: [80, 60, 40, -25, -50], colors: ["196b24", "c1f0c8", "83e28e", "47d359", "12501a", "0d3512"] },
  { name: "Accent 4", steps: [80, 60, 40, -25, -50], colors: ["0f9ed5", "caedfb", "94dcf8", "61cbf3", "0c769e", "074f69"] },
  { name: "Accent 5", steps: [80, 60, 40, -25, -50], colors: ["a02b93", "f2ceef", "e49edd", "d86dcd", "782170", "51154a"] },
  { name: "Accent 6", steps: [80, 60, 40, -25, -50], colors: ["4ea72e", "daf2d0", "b5e6a2", "8ed973", "3c7d22", "275317"] }
];

export const OFFICE_STANDARD_COLORS: readonly OfficeColor[] = [
  { title: "Dark Red", color: "#c00000" },
  { title: "Red", color: "#ff0000" },
  { title: "Orange", color: "#ffc000" },
  { title: "Yellow", color: "#ffff00" },
  { title: "Light Green", color: "#92d050" },
  { title: "Green", color: "#00b050" },
  { title: "Light Blue", color: "#00b0f0" },
  { title: "Blue", color: "#0070c0" },
  { title: "Dark Blue", color: "#002060" },
  { title: "Purple", color: "#7030a0" }
];

/** The theme grid as Office lays it out: row 0 the ten base colours, rows 1 to 5 their variants. */
export function officeThemeColorRows(): OfficeColor[][] {
  return [0, 1, 2, 3, 4, 5].map((rowIndex) => OFFICE_THEME_COLUMNS.map((column) => {
    const step = rowIndex === 0 ? 0 : column.steps[rowIndex - 1];
    return {
      title: step === 0 ? column.name : `${column.name}, ${step > 0 ? "Lighter" : "Darker"} ${Math.abs(step)}%`,
      color: `#${column.colors[rowIndex]}`
    };
  }));
}
