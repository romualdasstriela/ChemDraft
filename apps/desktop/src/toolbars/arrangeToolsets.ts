/**
 * Pure placement for View ▸ Arrange Toolbars Top to Bottom: stack palette windows in a column from
 * an anchor point, starting a new column to the right whenever the next window would run past the
 * bottom of the work area. Units are whatever the caller measures in (physical pixels on desktop);
 * the function only adds and compares.
 */

export interface ArrangeWindowSize {
  id: string;
  width: number;
  height: number;
}

export interface ArrangePlacement {
  id: string;
  x: number;
  y: number;
}

export interface ArrangeArea {
  /** Top-left of the first column. */
  left: number;
  top: number;
  /** Lowest y a window's bottom edge may reach before wrapping to the next column. */
  bottom: number;
}

export function stackToolsetWindows(
  windows: readonly ArrangeWindowSize[],
  area: ArrangeArea,
  gap: number
): ArrangePlacement[] {
  const placements: ArrangePlacement[] = [];
  let columnLeft = area.left;
  let columnWidth = 0;
  let y = area.top;

  for (const window of windows) {
    // Wrap only when the column already holds a window: a single window taller than the area still
    // goes at the top rather than being pushed into an endless run of empty columns.
    if (y > area.top && y + window.height > area.bottom) {
      columnLeft += columnWidth + gap;
      columnWidth = 0;
      y = area.top;
    }
    placements.push({ id: window.id, x: columnLeft, y });
    columnWidth = Math.max(columnWidth, window.width);
    y += window.height + gap;
  }

  return placements;
}

/** Mirror of `toolset_window_label` in src-tauri/src/lib.rs: every non-alphanumeric becomes '-'. */
export function toolsetWindowLabel(toolsetId: string): string {
  return `toolset-${toolsetId.replace(/[^A-Za-z0-9]/g, "-")}`;
}
