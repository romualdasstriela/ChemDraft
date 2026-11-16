import { useState } from "react";
import {
  COMPOUND_DATA_FIELDS,
  COMPOUND_DATA_LABELS,
  compoundDataLines,
  EMPTY_COMPOUND_DATA,
  isCompoundDataField,
  type CompoundDataField,
  type CompoundDataModel
} from "../compoundData";

const TICKED_FIELDS_STORAGE_KEY = "chemdraft.compoundData.fields";

function loadTickedFields(): CompoundDataField[] {
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(TICKED_FIELDS_STORAGE_KEY) ?? "null") as unknown;
    if (Array.isArray(stored)) return stored.filter(isCompoundDataField);
  } catch {
    // Unreadable storage: every field ticked.
  }
  return [...COMPOUND_DATA_FIELDS];
}

function saveTickedFields(fields: readonly CompoundDataField[]): void {
  try {
    globalThis.localStorage?.setItem(TICKED_FIELDS_STORAGE_KEY, JSON.stringify(fields));
  } catch {
    // The ticks still apply for this session.
  }
}

/**
 * The Compound Data toolbox: the selected structure's formula, molecular weight, m/z and predicted
 * boiling point, each with a tick box (remembered), and Paste / Copy for the ticked ones.
 */
export function CompoundDataPane({
  model = EMPTY_COMPOUND_DATA,
  onAction
}: {
  model?: CompoundDataModel;
  onAction?: (action: "paste" | "copy", fields: CompoundDataField[]) => void;
}) {
  const [ticked, setTicked] = useState<CompoundDataField[]>(loadTickedFields);
  const toggle = (field: CompoundDataField) => {
    setTicked((current) => {
      const next = current.includes(field) ? current.filter((entry) => entry !== field) : [...current, field];
      saveTickedFields(next);
      return next;
    });
  };
  const usable = compoundDataLines(model, ticked).length > 0;
  const valueFor = (field: CompoundDataField) => {
    if (!model.hasStructure) return "—";
    if (field === "boilingPoint" && model.boilingPointPending) return "calculating…";
    const value = model.values[field];
    if (value === undefined) return "—";
    // The formula's counts as subscripts, as on the page.
    return field === "formula"
      ? value.split(/(\d+)/).map((part, index) => (index % 2 === 1 ? <sub key={index}>{part}</sub> : part))
      : value;
  };
  return (
    <div className="compound-data-pane" data-testid="compound-data-pane">
      {model.hasStructure ? null : <p className="compound-data-empty">Select a structure</p>}
      <ul className="compound-data-rows">
        {COMPOUND_DATA_FIELDS.map((field) => (
          <li key={field} className="compound-data-row" data-compound-field={field}>
            <label title={field === "boilingPoint" ? model.boilingPointNote : undefined}>
              <input
                type="checkbox"
                checked={ticked.includes(field)}
                onChange={() => toggle(field)}
                aria-label={`Include ${COMPOUND_DATA_LABELS[field]}`}
              />
              <span className="compound-data-label">{COMPOUND_DATA_LABELS[field]}</span>
              <span className="compound-data-value" data-compound-value={field}>{valueFor(field)}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="compound-data-actions">
        <button type="button" disabled={!usable || !onAction} onClick={() => onAction?.("paste", ticked)}
          title="Add the ticked data as text under the selected structure">Paste</button>
        <button type="button" disabled={!usable || !onAction} onClick={() => onAction?.("copy", ticked)}
          title="Copy the ticked data to the clipboard">Copy</button>
      </div>
    </div>
  );
}
