import { elementSymbols } from "@chemdraft/chem-core";

/**
 * The Periodic Table toolbar's model: one element tool per element (`tool.element.<Symbol>`, value-
 * encoded like every other command id) and where each element sits in the standard 18-column table.
 * Clicking an element arms its tool; clicking an atom with it sets that atom's element.
 */

export const ELEMENT_TOOL_COMMAND_PREFIX = "tool.element.";

/** English names in atomic-number order, aligned with chem-core's `elementSymbols`. */
const elementNames = [
  "Hydrogen", "Helium", "Lithium", "Beryllium", "Boron", "Carbon", "Nitrogen", "Oxygen", "Fluorine", "Neon",
  "Sodium", "Magnesium", "Aluminium", "Silicon", "Phosphorus", "Sulfur", "Chlorine", "Argon", "Potassium", "Calcium",
  "Scandium", "Titanium", "Vanadium", "Chromium", "Manganese", "Iron", "Cobalt", "Nickel", "Copper", "Zinc",
  "Gallium", "Germanium", "Arsenic", "Selenium", "Bromine", "Krypton", "Rubidium", "Strontium", "Yttrium", "Zirconium",
  "Niobium", "Molybdenum", "Technetium", "Ruthenium", "Rhodium", "Palladium", "Silver", "Cadmium", "Indium", "Tin",
  "Antimony", "Tellurium", "Iodine", "Xenon", "Caesium", "Barium", "Lanthanum", "Cerium", "Praseodymium", "Neodymium",
  "Promethium", "Samarium", "Europium", "Gadolinium", "Terbium", "Dysprosium", "Holmium", "Erbium", "Thulium", "Ytterbium",
  "Lutetium", "Hafnium", "Tantalum", "Tungsten", "Rhenium", "Osmium", "Iridium", "Platinum", "Gold", "Mercury",
  "Thallium", "Lead", "Bismuth", "Polonium", "Astatine", "Radon", "Francium", "Radium", "Actinium", "Thorium",
  "Protactinium", "Uranium", "Neptunium", "Plutonium", "Americium", "Curium", "Berkelium", "Californium", "Einsteinium", "Fermium",
  "Mendelevium", "Nobelium", "Lawrencium", "Rutherfordium", "Dubnium", "Seaborgium", "Bohrium", "Hassium", "Meitnerium", "Darmstadtium",
  "Roentgenium", "Copernicium", "Nihonium", "Flerovium", "Moscovium", "Livermorium", "Tennessine", "Oganesson"
] as const;

export interface PeriodicTableElement {
  atomicNumber: number;
  symbol: string;
  name: string;
  /** 1–7 for the main table; 9 and 10 for the detached lanthanide and actinide rows (8 is a gap). */
  row: number;
  /** 1–18. */
  column: number;
}

function periodicTablePosition(atomicNumber: number): { row: number; column: number } {
  const z = atomicNumber;
  if (z === 1) return { row: 1, column: 1 };
  if (z === 2) return { row: 1, column: 18 };
  if (z <= 18) {
    const row = z <= 10 ? 2 : 3;
    const index = z - (row === 2 ? 3 : 11);
    return { row, column: index < 2 ? index + 1 : index + 11 };
  }
  if (z <= 36) return { row: 4, column: z - 18 };
  if (z <= 54) return { row: 5, column: z - 36 };
  if (z <= 56) return { row: 6, column: z - 54 };
  if (z <= 71) return { row: 9, column: z - 54 };
  if (z <= 86) return { row: 6, column: z - 68 };
  if (z <= 88) return { row: 7, column: z - 86 };
  if (z <= 103) return { row: 10, column: z - 86 };
  return { row: 7, column: z - 100 };
}

export const periodicTableElements: readonly PeriodicTableElement[] = elementSymbols.map((symbol, index) => ({
  atomicNumber: index + 1,
  symbol,
  name: elementNames[index]!,
  ...periodicTablePosition(index + 1)
}));

const elementBySymbol = new Map(periodicTableElements.map((element) => [element.symbol, element]));

export function elementToolCommandId(symbol: string): string {
  return `${ELEMENT_TOOL_COMMAND_PREFIX}${symbol}`;
}

/** The element an element tool sets, or undefined for any other command id. */
export function elementSymbolForToolCommand(commandId: string): string | undefined {
  if (!commandId.startsWith(ELEMENT_TOOL_COMMAND_PREFIX)) {
    return undefined;
  }
  const symbol = commandId.slice(ELEMENT_TOOL_COMMAND_PREFIX.length);
  return elementBySymbol.has(symbol) ? symbol : undefined;
}

export function periodicTableElement(symbol: string): PeriodicTableElement | undefined {
  return elementBySymbol.get(symbol);
}
