import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { textAlignmentCommands, textColorCommands, textCustomColorCommandId } from "../../commands";
import { OfficeColorPalette } from "../OfficeColorPalette";
import { useToolbarWidgetState } from "../toolbarWidgets";
import type { NativeTextStyle } from "@chemdraft/chem-core";
import { loadSystemFonts, type SystemFontFamily } from "../../systemFonts";
import {
  TextFontSelect,
  ToolbarAlignButton,
  ToolbarColorSwatchButton,
  ToolbarTextButton,
  defaultFontFaces,
  fontFamilyLabel,
  usePaletteButtonInvoke,
  type ColorCommand
} from "../toolbarCells";
import { useNativeFloatingTooltip } from "../toolbarTooltip";

/**
 * The Main Toolbar style widget's layout currency: every variant is two rows of cells on the
 * toolbar's 24px grid (cell = 24px, gap = 4px). Expressing rows as data makes the footprint a
 * computable invariant — each row must cost exactly {@link MAIN_STYLE_ROW_CELLS} cells, asserted in
 * tests instead of eyeballed in pixels.
 */
export const MAIN_STYLE_ROW_CELLS = 11;

export interface StyleSelectOption {
  /** The command id to invoke when chosen (or the "mixed" sentinel, which never invokes). */
  value: string;
  label: string;
}

export type StyleToggleSpec = {
  commandId: string;
  label: string;
  active: boolean;
  content: ReactNode;
  disabled?: boolean;
  /** Hover text when it should say more than the label — e.g. why the toggle is currently inert. */
  tooltip?: string;
};

export type StyleCell =
  | { kind: "swatches"; ariaLabel: string; commands: readonly ColorCommand[]; activeColor?: string }
  /** One cell that opens the Office colour palette for text, bonds and atoms. */
  | { kind: "officeColors"; ariaLabel: string; activeColor?: string }
  | { kind: "aligns"; activeAlign: NativeTextStyle["textAlign"] }
  | { kind: "toggle"; toggle: StyleToggleSpec }
  | { kind: "toggleGroup"; ariaLabel: string; toggles: readonly StyleToggleSpec[] }
  | { kind: "action"; commandId: string; label: string; content: ReactNode; disabled?: boolean }
  | {
      kind: "select";
      cells: number;
      ariaLabel: string;
      value: string;
      options: readonly StyleSelectOption[];
      disabled?: boolean;
      labelClassName?: string;
      selectClassName?: string;
    }
  | {
      kind: "fontFamilySelect";
      cells: number;
      ariaLabel: string;
      family: string | null;
      mixed: boolean;
      disabled?: boolean;
      /** Preset families pinned above the system catalog. */
      presetFamilies: readonly { family: string; label: string }[];
      commandIdForFamily: (family: string) => string;
    }
  /** The text toolbar's font select verbatim (preset `text.font.*` ids + system catalog), 4 cells. */
  | { kind: "textFontSelect"; currentTextStyle?: NativeTextStyle }
  | { kind: "gap"; cells: number };

export interface MainStyleRows {
  primary: readonly StyleCell[];
  secondary: readonly StyleCell[];
}

export function cellCost(cell: StyleCell): number {
  switch (cell.kind) {
    case "swatches":
      return cell.commands.length;
    case "aligns":
      return textAlignmentCommands.length;
    case "officeColors":
    case "toggle":
      return 1;
    case "toggleGroup":
      return cell.toggles.length;
    case "action":
      return 1;
    case "textFontSelect":
      return 4;
    case "select":
    case "fontFamilySelect":
    case "gap":
      return cell.cells;
  }
}

export function rowCellCost(row: readonly StyleCell[]): number {
  return row.reduce((total, cell) => total + cellCost(cell), 0);
}

/** The quick swatches the text and molecule layouts lead row 1 with, followed by the Office palette
 *  button in the sixth cell (where gray used to be; Office's grays are in its palette). */
export const mainToolbarSwatchCommands = textColorCommands.filter((command) => (
  command.id === "text.color.black"
  || command.id === "text.color.white"
  || command.id === "text.color.blue"
  || command.id === "text.color.red"
  || command.id === "text.color.green"
));

/**
 * Opens the Office colour palette (the colours of Word's colour menu) for the selection's text,
 * bonds and atoms. In a floating palette it opens in the palette's own popover window; elsewhere
 * (in-window palettes, tests) it opens inline under the button. A chosen colour applies through the
 * text-colour command, which also colours selected bonds and atoms.
 */
function OfficeColorsCell({
  cell,
  onInvoke
}: {
  cell: Extract<StyleCell, { kind: "officeColors" }>;
  onInvoke: (commandId: string) => void;
}) {
  const { onRequestTextColorPopover } = useToolbarWidgetState();
  const [open, setOpen] = useState(false);
  const shellRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !shellRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeOnOutsidePress, { capture: true });
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePress, { capture: true });
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <span className="office-color-cell" ref={shellRef}>
      <button
        type="button"
        className="toolbar-text-button office-color-button"
        aria-label={`${cell.ariaLabel}: Office colors`}
        aria-haspopup="dialog"
        aria-expanded={onRequestTextColorPopover ? undefined : open}
        data-palette-control="true"
        style={{ "--picker-color": cell.activeColor ?? "#000000" } as CSSProperties}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => {
          event.stopPropagation();
          // Keep an atom label being typed in edit, as the other style buttons do.
          const focused = event.currentTarget.ownerDocument.activeElement;
          if (focused instanceof HTMLElement && focused.dataset.atomLabelEditor === "true") {
            event.preventDefault();
          }
        }}
        onClick={(event) => {
          if (onRequestTextColorPopover) {
            const rect = event.currentTarget.getBoundingClientRect();
            onRequestTextColorPopover({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
            return;
          }
          setOpen((current) => !current);
        }}
      >
        <svg className="office-color-glyph" viewBox="0 0 16 16" aria-hidden="true">
          {[0, 1, 2].flatMap((row) => [0, 1, 2].map((column) => (
            <rect key={`${row}-${column}`} x={1 + column * 5} y={1 + row * 4} width="4" height="3" rx="0.5" />
          )))}
        </svg>
        <span className="office-color-bar" aria-hidden="true" />
      </button>
      {open && !onRequestTextColorPopover ? (
        <div className="toolbar-color-popover office-color-popover" role="dialog" aria-label={`${cell.ariaLabel}: Office colors`}>
          <OfficeColorPalette
            activeColor={cell.activeColor}
            onApply={(color) => {
              setOpen(false);
              onInvoke(textCustomColorCommandId(color));
            }}
          />
        </div>
      ) : null}
    </span>
  );
}

export function closestPreset(value: number, presets: readonly number[]): number {
  return presets.reduce((best, preset) => (
    Math.abs(preset - value) < Math.abs(best - value) ? preset : best
  ), presets[0]);
}

const MIXED_OPTION_VALUE = "mixed";

/** Options for a numeric preset select; a leading "Mixed" sentinel appears only while mixed. */
export function numericSelectOptions(
  presets: readonly number[],
  commandIdForValue: (value: number) => string,
  labelForValue: (value: number) => string
): StyleSelectOption[] {
  return presets.map((preset) => ({ value: commandIdForValue(preset), label: labelForValue(preset) }));
}

export function numericSelectValue(
  value: number | null,
  mixed: boolean,
  fallback: number,
  presets: readonly number[],
  commandIdForValue: (value: number) => string
): string {
  if (mixed) {
    return MIXED_OPTION_VALUE;
  }
  return commandIdForValue(closestPreset(value ?? fallback, presets));
}

function spanStyle(cells: number): CSSProperties {
  // Literal multipliers only — WKWebView drops a calc() whose product mixes two var()-dependent
  // operands (length-var × number-var), which left these labels at intrinsic width in the native
  // app and overflowed the pinned row. Same shape as the long-proven .toolbar-font-control rule.
  return { width: `calc(var(--cd-control-height) * ${cells} + var(--cd-space-2) * ${cells - 1})` };
}

/** Single-visible-tooltip state for the widget's cells, provided by MainStyleWidget from the shared
 *  usePaletteTooltipState hook. The no-op default keeps bare renders (tests) working. */
export const WidgetTooltipContext = createContext<{
  visibleTooltipId: string | undefined;
  requestTooltip: (tooltipId: string) => void;
  clearTooltip: (tooltipId?: string) => void;
}>({
  visibleTooltipId: undefined,
  requestTooltip: () => undefined,
  clearTooltip: () => undefined
});

/**
 * Hover-tooltip wrapper for one widget control, mirroring the grid icons' shell contract: the
 * delayed `.tool-tooltip` span shows via `data-tooltip-visible` in browser/in-window palettes, and
 * the native-palette relay announces the same text to the floating tooltip window. The shell is
 * layout-transparent (it hugs whatever control it wraps).
 */
function CellShell({
  tooltipId,
  title,
  children
}: {
  tooltipId: string;
  title: string;
  children: ReactNode;
}) {
  const { visibleTooltipId, requestTooltip, clearTooltip } = useContext(WidgetTooltipContext);
  const visible = visibleTooltipId === tooltipId;
  const shellRef = useRef<HTMLSpanElement | null>(null);
  useNativeFloatingTooltip(shellRef, visible);

  return (
    <span
      className="toolbar-cell-shell"
      data-tooltip-owner-id={tooltipId}
      data-tooltip-visible={visible ? "true" : undefined}
      ref={shellRef}
      onClickCapture={() => clearTooltip(tooltipId)}
      onPointerDownCapture={() => clearTooltip(tooltipId)}
      onPointerEnter={() => requestTooltip(tooltipId)}
      onPointerLeave={() => clearTooltip(tooltipId)}
    >
      {children}
      <span className="tool-tooltip" role="tooltip" aria-hidden="true">
        <span>{title}</span>
      </span>
    </span>
  );
}

function StyleActionButton({
  commandId,
  label,
  content,
  disabled,
  onInvoke
}: {
  commandId: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
  onInvoke: (commandId: string) => void;
}) {
  const invokeHandlers = usePaletteButtonInvoke(commandId, onInvoke, disabled);

  return (
    <button
      type="button"
      className="toolbar-text-button"
      aria-label={label}
      disabled={disabled}
      data-command-id={commandId}
      data-palette-control="true"
      {...invokeHandlers}
    >
      {content}
    </button>
  );
}

/** "Text Color: Blue" → "Blue"; commands whose titles carry a category prefix keep just the value
 *  so the tooltip can lead with the cell's own contextual label instead. */
function commandValueLabel(title: string): string {
  const separator = title.indexOf(": ");
  return separator >= 0 ? title.slice(separator + 2) : title;
}

function StyleSelectCell({
  cell,
  onInvoke
}: {
  cell: Extract<StyleCell, { kind: "select" }>;
  onInvoke: (commandId: string) => void;
}) {
  const mixed = cell.value === MIXED_OPTION_VALUE;

  return (
    <label className={cell.labelClassName ?? "toolbar-control-label"} style={cell.labelClassName ? undefined : spanStyle(cell.cells)}>
      <span className="visually-hidden">{cell.ariaLabel}</span>
      <select
        className={cell.selectClassName ?? "toolbar-select"}
        value={cell.value}
        aria-label={cell.ariaLabel}
        disabled={cell.disabled}
        data-palette-control="true"
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => {
          if (event.currentTarget.value !== MIXED_OPTION_VALUE) {
            onInvoke(event.currentTarget.value);
          }
        }}
      >
        {mixed ? <option value={MIXED_OPTION_VALUE}>Mixed</option> : null}
        {cell.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A font-family select bound to dynamic per-family command ids (atom labels today): the preset
 *  families stay pinned on top, the shared system catalog follows — the same shape as the text
 *  variant's TextFontSelect, but command-id-parameterized. */
function FontFamilySelectCell({
  cell,
  onInvoke
}: {
  cell: Extract<StyleCell, { kind: "fontFamilySelect" }>;
  onInvoke: (commandId: string) => void;
}) {
  const presetFamily = cell.presetFamilies.find((preset) => preset.family === cell.family);
  const customFamily = presetFamily ? undefined : cell.family?.trim() || undefined;
  const [systemFonts, setSystemFonts] = useState<SystemFontFamily[]>([]);

  useEffect(() => {
    let disposed = false;
    void loadSystemFonts(customFamily ? [customFamily] : []).then((fonts) => {
      if (!disposed) {
        setSystemFonts(fonts);
      }
    });
    return () => {
      disposed = true;
    };
  }, [customFamily]);

  const systemFontFamilies = systemFonts.length > 0
    ? systemFonts
    : customFamily
      ? [{ family: customFamily, faces: defaultFontFaces() }]
      : [];
  const value = cell.mixed
    ? MIXED_OPTION_VALUE
    : cell.commandIdForFamily(cell.family ?? cell.presetFamilies[0].family);

  return (
    <label className="toolbar-control-label" style={spanStyle(cell.cells)}>
      <span className="visually-hidden">{cell.ariaLabel}</span>
      <select
        className="toolbar-select toolbar-font-select"
        value={value}
        aria-label={cell.ariaLabel}
        disabled={cell.disabled}
        data-palette-control="true"
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => {
          if (event.currentTarget.value !== MIXED_OPTION_VALUE) {
            onInvoke(event.currentTarget.value);
          }
        }}
      >
        {cell.mixed ? <option value={MIXED_OPTION_VALUE}>Mixed</option> : null}
        <optgroup label="Suggested">
          {cell.presetFamilies.map((preset) => (
            <option key={preset.family} value={cell.commandIdForFamily(preset.family)}>
              {preset.label}
            </option>
          ))}
        </optgroup>
        {systemFontFamilies.length > 0 ? (
          <optgroup label="System fonts">
            {systemFontFamilies.map((font) => (
              <option key={font.family} value={cell.commandIdForFamily(font.family)}>
                {fontFamilyLabel(font.family)}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </label>
  );
}

export function StyleCellView({
  cell,
  onInvoke,
  tooltipScope
}: {
  cell: StyleCell;
  onInvoke: (commandId: string) => void;
  /** Unique prefix for this cell's tooltip ids (variant + row + index). */
  tooltipScope: string;
}) {
  switch (cell.kind) {
    case "swatches":
      return (
        <div className="toolbar-swatch-group" role="group" aria-label={cell.ariaLabel}>
          {cell.commands.map((command) => (
            <CellShell
              key={command.id}
              tooltipId={`${tooltipScope}-${command.id}`}
              title={`${cell.ariaLabel}: ${commandValueLabel(command.title)}`}
            >
              <ToolbarColorSwatchButton
                active={command.color.toLowerCase() === cell.activeColor?.toLowerCase()}
                command={command}
                title={null}
                onInvoke={onInvoke}
              />
            </CellShell>
          ))}
        </div>
      );
    case "officeColors":
      return (
        <CellShell tooltipId={`${tooltipScope}-office-colors`} title={`${cell.ariaLabel}: Office colors`}>
          <OfficeColorsCell cell={cell} onInvoke={onInvoke} />
        </CellShell>
      );
    case "aligns":
      return (
        <div className="toolbar-align-group" role="group" aria-label="Text alignment">
          {textAlignmentCommands.map((command) => (
            <CellShell key={command.id} tooltipId={`${tooltipScope}-${command.id}`} title={command.title}>
              <ToolbarAlignButton
                active={cell.activeAlign === command.textAlign}
                command={command}
                title={null}
                onInvoke={onInvoke}
              />
            </CellShell>
          ))}
        </div>
      );
    case "toggle":
      return (
        <CellShell
          tooltipId={`${tooltipScope}-${cell.toggle.commandId}`}
          title={cell.toggle.tooltip ?? cell.toggle.label}
        >
          <ToolbarTextButton
            commandId={cell.toggle.commandId}
            label={cell.toggle.label}
            active={cell.toggle.active}
            disabled={cell.toggle.disabled}
            title={null}
            onInvoke={onInvoke}
          >
            {cell.toggle.content}
          </ToolbarTextButton>
        </CellShell>
      );
    case "toggleGroup":
      return (
        <div className="toolbar-type-group" role="group" aria-label={cell.ariaLabel}>
          {cell.toggles.map((toggle) => (
            <CellShell
              key={toggle.commandId}
              tooltipId={`${tooltipScope}-${toggle.commandId}`}
              title={toggle.tooltip ?? toggle.label}
            >
              <ToolbarTextButton
                commandId={toggle.commandId}
                label={toggle.label}
                active={toggle.active}
                disabled={toggle.disabled}
                title={null}
                onInvoke={onInvoke}
              >
                {toggle.content}
              </ToolbarTextButton>
            </CellShell>
          ))}
        </div>
      );
    case "action":
      return (
        <CellShell tooltipId={`${tooltipScope}-${cell.commandId}`} title={cell.label}>
          <StyleActionButton
            commandId={cell.commandId}
            label={cell.label}
            content={cell.content}
            disabled={cell.disabled}
            onInvoke={onInvoke}
          />
        </CellShell>
      );
    case "select":
      return (
        <CellShell tooltipId={`${tooltipScope}-select`} title={cell.ariaLabel}>
          <StyleSelectCell cell={cell} onInvoke={onInvoke} />
        </CellShell>
      );
    case "fontFamilySelect":
      return (
        <CellShell tooltipId={`${tooltipScope}-font-family`} title={cell.ariaLabel}>
          <FontFamilySelectCell cell={cell} onInvoke={onInvoke} />
        </CellShell>
      );
    case "textFontSelect":
      return (
        <CellShell tooltipId={`${tooltipScope}-text-font`} title="Text font">
          <TextFontSelect
            currentTextStyle={cell.currentTextStyle}
            labelClassName="toolbar-control-label toolbar-font-control"
            onInvoke={onInvoke}
          />
        </CellShell>
      );
    case "gap":
      return <span className="toolbar-cell-gap" style={spanStyle(cell.cells)} aria-hidden="true" />;
  }
}
