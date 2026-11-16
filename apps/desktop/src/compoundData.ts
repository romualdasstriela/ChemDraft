/**
 * Compound Data: the small toolbox with the few numbers chemists paste under a structure —
 * formula, molecular weight, m/z and a predicted boiling point — each with a tick box, plus Paste
 * (as text under the structure) and Copy.
 *
 * Formula and masses come from the molecule's own chemistry metadata, kept current by every
 * commit. The boiling point is the Joback estimate from the same analysis run the Molecular
 * Inspector shows, converted to °C and labelled "Predicted": it is an estimate, never a measured
 * value, and declines (shows why) where Joback has no parameters.
 */
import { statusHasValue, type AnalysisRun } from "@chemdraft/analysis-core";
import type { MoleculeObject } from "@chemdraft/chem-core";

export type CompoundDataField = "formula" | "molecularWeight" | "mz" | "boilingPoint";

export const COMPOUND_DATA_FIELDS: readonly CompoundDataField[] = ["formula", "molecularWeight", "mz", "boilingPoint"];

export const COMPOUND_DATA_LABELS: Readonly<Record<CompoundDataField, string>> = {
  formula: "Formula",
  molecularWeight: "Molecular Weight",
  mz: "m/z",
  boilingPoint: "Predicted bp"
};

/** The analysis method id of Joback's normal boiling point (rdkit-adapter `JOBACK_TB_METHOD_ID`). */
export const COMPOUND_BOILING_POINT_METHOD_ID = "joback.normal-boiling-point";

/** The boiling point the last analysis run gave for one structure (`subject` = its analysis key). */
export interface CompoundBoilingPoint {
  subject: string;
  kelvin?: number;
  /** Joback's average error, K (the same size in °C). */
  spreadK?: number;
  /** Why there is no value, when the method declined. */
  reason?: string;
}

/** What the toolbox shows. Plain JSON: it crosses the window boundary to the palette. */
export interface CompoundDataModel {
  hasStructure: boolean;
  values: Partial<Record<CompoundDataField, string>>;
  /** The boiling point is being computed for this structure. */
  boilingPointPending?: boolean;
  /** Shown as the boiling point's tooltip: what the number is, or why there is none. */
  boilingPointNote?: string;
}

export const EMPTY_COMPOUND_DATA: CompoundDataModel = { hasStructure: false, values: {} };

/** The Joback boiling point an analysis run gave (in K), or why it declined. */
export function compoundBoilingPointFromRun(run: Pick<AnalysisRun, "results">, subject: string): CompoundBoilingPoint {
  const result = run.results.find((candidate) => candidate.methodId === COMPOUND_BOILING_POINT_METHOD_ID);
  if (!result || result.kind !== "scalar") {
    return { subject, reason: "No boiling-point estimate was computed for this structure" };
  }
  if (statusHasValue(result.status) && result.value !== null && result.unit === "kelvin") {
    const spread = result.uncertainties.find((entry) => entry.value !== undefined && entry.unit === "kelvin")?.value;
    return { subject, kelvin: result.value, ...(spread !== undefined ? { spreadK: spread } : {}) };
  }
  return { subject, reason: result.applicability.reasons[0] ?? "Joback has no estimate for this structure" };
}

const KELVIN_OFFSET = 273.15;

export function compoundDataModel(
  molecule: MoleculeObject | undefined,
  boilingPoint: CompoundBoilingPoint | undefined,
  options: { subject?: string; pending?: boolean } = {}
): CompoundDataModel {
  if (!molecule) return EMPTY_COMPOUND_DATA;
  const chemistry = molecule.chemistry;
  const values: Partial<Record<CompoundDataField, string>> = {};
  if (chemistry?.formula) values.formula = chemistry.formula;
  if (chemistry?.averageMass !== undefined) values.molecularWeight = chemistry.averageMass.toFixed(2);
  if (chemistry?.exactMass !== undefined) values.mz = chemistry.exactMass.toFixed(4);

  const current = boilingPoint && boilingPoint.subject === options.subject ? boilingPoint : undefined;
  let boilingPointNote: string | undefined;
  if (current?.kelvin !== undefined) {
    values.boilingPoint = `${(current.kelvin - KELVIN_OFFSET).toFixed(1)} °C`;
    boilingPointNote = `Joback group-contribution estimate, not a measured value` +
      (current.spreadK !== undefined ? `; typical error ± ${current.spreadK.toFixed(0)} °C` : "");
  } else if (current?.reason) {
    boilingPointNote = current.reason;
  }
  return {
    hasStructure: true,
    values,
    ...(current === undefined && options.pending ? { boilingPointPending: true } : {}),
    ...(boilingPointNote ? { boilingPointNote } : {})
  };
}

export interface CompoundDataLine {
  field: CompoundDataField;
  label: string;
  value: string;
}

/** The ticked fields that have a value, in toolbox order. */
export function compoundDataLines(model: CompoundDataModel, fields: readonly CompoundDataField[]): CompoundDataLine[] {
  return COMPOUND_DATA_FIELDS
    .filter((field) => fields.includes(field) && model.values[field] !== undefined)
    .map((field) => ({ field, label: COMPOUND_DATA_LABELS[field], value: model.values[field]! }));
}

/** The clipboard text: one "Label: value" line per ticked field. */
export function compoundDataText(lines: readonly CompoundDataLine[]): string {
  return lines.map((line) => `${line.label}: ${line.value}`).join("\n");
}

export function isCompoundDataField(value: unknown): value is CompoundDataField {
  return typeof value === "string" && (COMPOUND_DATA_FIELDS as readonly string[]).includes(value);
}
