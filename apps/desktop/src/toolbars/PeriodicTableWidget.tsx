import type { CSSProperties } from "react";
import { usePaletteButtonInvoke } from "./toolbarCells";
import { useToolbarWidgetState } from "./toolbarWidgets";
import { elementToolCommandId, periodicTableElements, type PeriodicTableElement } from "../periodicTable";

/**
 * The Periodic Table toolbar: every element in its place in the 18-column table, the lanthanides
 * and actinides in their own rows below. Pressing an element arms its element tool (the canvas then
 * sets each clicked atom to that element); the armed element stays highlighted.
 */
export function PeriodicTableWidget() {
  const { activeTool, onInvoke } = useToolbarWidgetState();
  return (
    <div className="periodic-table" role="group" aria-label="Periodic table" data-periodic-table="true">
      {periodicTableElements.map((element) => (
        <PeriodicTableCell
          key={element.symbol}
          element={element}
          active={activeTool === elementToolCommandId(element.symbol)}
          onInvoke={onInvoke}
        />
      ))}
      <span className="periodic-table-series-marker" style={{ gridRow: 6, gridColumn: 3 }} aria-hidden="true">57–71</span>
      <span className="periodic-table-series-marker" style={{ gridRow: 7, gridColumn: 3 }} aria-hidden="true">89–103</span>
    </div>
  );
}

function PeriodicTableCell({
  element,
  active,
  onInvoke
}: {
  element: PeriodicTableElement;
  active: boolean;
  onInvoke: (commandId: string) => void;
}) {
  const commandId = elementToolCommandId(element.symbol);
  const invokeHandlers = usePaletteButtonInvoke(commandId, onInvoke);
  const style: CSSProperties = { gridRow: element.row, gridColumn: element.column };
  return (
    <button
      type="button"
      className={["periodic-table-cell", active ? "active" : ""].filter(Boolean).join(" ")}
      style={style}
      aria-label={`${element.name} (${element.symbol})`}
      aria-pressed={active}
      title={`${element.atomicNumber} ${element.name}`}
      data-command-id={commandId}
      data-palette-control="true"
      {...invokeHandlers}
    >
      {element.symbol}
    </button>
  );
}
