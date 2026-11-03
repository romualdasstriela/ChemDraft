import { describe, expect, it } from "vitest";
import { createViewportState, stepZoomViewport, steppedZoomScale } from "./index";

describe("Zoom In / Zoom Out steps", () => {
  it("walks 25% to 300% in 25% steps and stops at both ends", () => {
    const levels: number[] = [];
    let scale = 0.25;
    while (true) {
      levels.push(Math.round(scale * 100));
      const next = steppedZoomScale(scale, "in");
      if (next === scale) break;
      scale = next;
    }
    expect(levels).toEqual([25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300]);
    expect(steppedZoomScale(0.25, "out")).toBe(0.25);
    expect(steppedZoomScale(1, "out")).toBe(0.75);
  });

  it("snaps an off-grid zoom to the next grid level in the direction pressed", () => {
    expect(steppedZoomScale(1.1, "in")).toBe(1.25);
    expect(steppedZoomScale(1.1, "out")).toBe(1);
    expect(steppedZoomScale(0.3, "out")).toBe(0.25);
    expect(steppedZoomScale(0.1, "in")).toBe(0.25);
    // Above the button range (a pinch to 425%): Zoom Out comes back to 300%, Zoom In stays.
    expect(steppedZoomScale(4.25, "out")).toBe(3);
    expect(steppedZoomScale(4.25, "in")).toBe(4.25);
  });

  it("reaches 25% even on a view saved with the old 50% floor", () => {
    const view = { ...createViewportState({ scale: 0.5 }), minZoom: 0.5 };
    expect(stepZoomViewport(view, "out", { x: 0, y: 0 }).scale).toBe(0.25);
    expect(createViewportState().minZoom).toBe(0.25);
  });
});
