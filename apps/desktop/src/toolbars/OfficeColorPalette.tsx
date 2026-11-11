import { useMemo, type CSSProperties } from "react";
import { normalizeHexColor } from "../commands";
import { OFFICE_STANDARD_COLORS, officeThemeColorRows, type OfficeColor } from "../officeColors";

/**
 * Office's colour menu: the theme grid (base colours, then five lighter/darker rows) and the
 * standard colours, ten columns each, the same colours Word, Excel and PowerPoint offer.
 */
export function OfficeColorPalette({
  activeColor,
  onApply
}: {
  activeColor?: string;
  onApply: (color: string) => void;
}) {
  const themeRows = useMemo(() => officeThemeColorRows(), []);
  const active = normalizeHexColor(activeColor);
  const swatch = (entry: OfficeColor) => (
    <button
      type="button"
      className={["color-palette-swatch", entry.color === active ? "active" : ""].filter(Boolean).join(" ")}
      key={entry.title}
      title={`${entry.title} (${entry.color.slice(1).toUpperCase()})`}
      aria-label={entry.title}
      aria-pressed={entry.color === active}
      data-color-palette-swatch="office"
      data-color={entry.color}
      data-palette-control="true"
      style={{ "--swatch-color": entry.color } as CSSProperties}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={() => onApply(entry.color)}
    />
  );

  return (
    <>
      <section className="color-palette-section office-color-palette" data-color-palette="office">
        <h3>Theme Colors</h3>
        <div className="color-palette-grid office-color-grid">{themeRows[0].map(swatch)}</div>
        <div className="color-palette-grid office-color-grid office-color-variants">
          {themeRows.slice(1).flat().map(swatch)}
        </div>
      </section>
      <section className="color-palette-section office-color-palette" data-color-palette="office-standard">
        <h3>Standard Colors</h3>
        <div className="color-palette-grid office-color-grid">{OFFICE_STANDARD_COLORS.map(swatch)}</div>
      </section>
    </>
  );
}
