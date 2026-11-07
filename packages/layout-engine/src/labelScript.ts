// Digits an atom label marks as raised or lowered. A plain digit in a label is drawn by its place
// (a count after a symbol is lowered, a mass number before one is raised); a label can instead
// carry the Unicode superscript (⁰¹²³⁴⁵⁶⁷⁸⁹) or subscript (₀₁₂₃₄₅₆₇₈₉) digit, which is always drawn
// that way. To the chemistry the marked digit is the plain digit: "OR²" reads as "OR2".

export type AtomLabelDigitScript = "normal" | "subscript" | "superscript";

const superscriptDigits = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"] as const;
const subscriptDigits = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"] as const;

/** The plain digit (0-9) of a plain, superscript or subscript digit character; undefined otherwise. */
export function atomLabelDigitValue(character: string): number | undefined {
  if (/^\d$/.test(character)) {
    return Number(character);
  }
  const raised = superscriptDigits.indexOf(character as (typeof superscriptDigits)[number]);
  if (raised >= 0) {
    return raised;
  }
  const lowered = subscriptDigits.indexOf(character as (typeof subscriptDigits)[number]);
  return lowered >= 0 ? lowered : undefined;
}

/** How a digit character is marked: "superscript" or "subscript" for the Unicode forms, "normal"
 *  for a plain digit, undefined for anything that is not a digit. */
export function atomLabelDigitScript(character: string): AtomLabelDigitScript | undefined {
  if (/^\d$/.test(character)) {
    return "normal";
  }
  if ((superscriptDigits as readonly string[]).includes(character)) {
    return "superscript";
  }
  return (subscriptDigits as readonly string[]).includes(character) ? "subscript" : undefined;
}

/** The label with every marked digit written as its plain digit: what the label means. */
export function plainAtomLabelDigits(label: string): string {
  let plain = "";
  for (const character of label) {
    const value = atomLabelDigitScript(character) === undefined ? undefined : atomLabelDigitValue(character);
    plain += value === undefined ? character : String(value);
  }
  return plain;
}

function digitInScript(value: number, script: AtomLabelDigitScript): string {
  return script === "superscript" ? superscriptDigits[value]! : script === "subscript" ? subscriptDigits[value]! : String(value);
}

/**
 * Marks digits of a label being typed as superscript or subscript (or back to plain), as the x² and
 * x₂ buttons do. `start`/`end` are the editor's selection, in UTF-16 units (each digit form is one
 * unit). With a selection, its digits change; with only a caret, the digits just before it do, so
 * typing "OR2" and pressing x² gives "OR²". Pressing the same button again on digits already in that
 * script puts them back to plain digits. `changed` is false when there were no digits to mark.
 */
export function atomLabelTextWithDigitScript(
  text: string,
  start: number,
  end: number,
  script: AtomLabelDigitScript
): { text: string; start: number; end: number; changed: boolean } {
  let from = Math.max(0, Math.min(start, end, text.length));
  const to = Math.min(text.length, Math.max(start, end));
  if (from === to) {
    while (from > 0 && atomLabelDigitScript(text[from - 1]!) !== undefined) {
      from -= 1;
    }
  }
  const range = text.slice(from, to);
  const digits = [...range].filter((character) => atomLabelDigitScript(character) !== undefined);
  if (digits.length === 0) {
    return { text, start, end, changed: false };
  }
  const target = script !== "normal" && digits.every((character) => atomLabelDigitScript(character) === script)
    ? "normal"
    : script;
  const marked = [...range].map((character) => {
    const value = atomLabelDigitScript(character) === undefined ? undefined : atomLabelDigitValue(character);
    return value === undefined ? character : digitInScript(value, target);
  }).join("");
  const next = text.slice(0, from) + marked + text.slice(to);
  return { text: next, start: from, end: from + marked.length, changed: next !== text };
}
