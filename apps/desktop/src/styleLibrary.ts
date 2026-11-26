import {
  DefaultNativeDrawingStyle,
  nativeDrawingStyleFromObjectStyle,
  type ChemDraftStylePreset,
  type NativeDrawingStyle
} from "@chemdraft/chem-core";
import { APP_NEW_STRUCTURE_STYLE_PRESET } from "./appStyle";

/**
 * The user's saved drawing styles, kept in this computer's ChemDraft settings (shared by every
 * ChemDraft window): a style is saved from Drawn Structure Settings under a name, and chosen in
 * Preferences ▸ Style as the style new structures start in.
 */
export const STYLE_LIBRARY_STORAGE_KEY = "chemdraft.styleLibrary.v1";
export const DEFAULT_STYLE_STORAGE_KEY = "chemdraft.defaultStyleId.v1";
export const STYLE_NAME_MAX_LENGTH = 60;
const SAVED_STYLE_ID_PREFIX = "user-style.";

export interface SavedStyle {
  id: string;
  name: string;
  savedAt: string;
  drawing: NativeDrawingStyle;
}

/** The styles always offered: the built-in default first. */
export const BUILT_IN_STYLE_PRESETS: readonly ChemDraftStylePreset[] = [APP_NEW_STRUCTURE_STYLE_PRESET];

export function savedStyleIdForName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${SAVED_STYLE_ID_PREFIX}${slug || "style"}`;
}

/** A style name as typed, trimmed and limited; undefined when nothing usable is left. */
export function normalizedStyleName(name: string): string | undefined {
  const trimmed = name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, STYLE_NAME_MAX_LENGTH).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function loadSavedStyles(storage: Storage | undefined = safeStorage()): SavedStyle[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(STYLE_LIBRARY_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.flatMap((entry) => savedStyleFromJson(entry) ?? []) : [];
  } catch {
    return [];
  }
}

/**
 * Save a style under a name. A style already saved under the same name is replaced (one name, one
 * style); the built-in style's name cannot be taken. Returns the saved entry.
 */
export function saveStyleToLibrary(
  name: string,
  drawing: NativeDrawingStyle,
  storage: Storage | undefined = safeStorage(),
  now: () => Date = () => new Date()
): SavedStyle {
  const styleName = normalizedStyleName(name);
  if (!styleName) {
    throw new Error("Enter a name for the style.");
  }
  if (BUILT_IN_STYLE_PRESETS.some((preset) => preset.name.toLowerCase() === styleName.toLowerCase())) {
    throw new Error(`"${styleName}" is the built-in style's name. Choose another name.`);
  }
  const id = savedStyleIdForName(styleName);
  const entry: SavedStyle = {
    id,
    name: styleName,
    savedAt: now().toISOString(),
    drawing: normalizeDrawing(drawing, id)
  };
  const styles = [...loadSavedStyles(storage).filter((style) => style.id !== id), entry];
  storage?.setItem(STYLE_LIBRARY_STORAGE_KEY, JSON.stringify(styles));
  return entry;
}

export function deleteSavedStyle(id: string, storage: Storage | undefined = safeStorage()): void {
  storage?.setItem(STYLE_LIBRARY_STORAGE_KEY, JSON.stringify(loadSavedStyles(storage).filter((style) => style.id !== id)));
  if (loadDefaultStyleId(storage) === id) {
    storage?.removeItem(DEFAULT_STYLE_STORAGE_KEY);
  }
}

export function stylePresetFromSavedStyle(style: SavedStyle): ChemDraftStylePreset {
  return { id: style.id, name: style.name, source: "imported", drawing: style.drawing };
}

/** Every style Preferences offers, in menu order: the built-in style, then saved styles by name. */
export function availableStylePresets(storage: Storage | undefined = safeStorage()): ChemDraftStylePreset[] {
  const saved = loadSavedStyles(storage)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(stylePresetFromSavedStyle);
  return [...BUILT_IN_STYLE_PRESETS, ...saved];
}

export function loadDefaultStyleId(storage: Storage | undefined = safeStorage()): string | undefined {
  try {
    return storage?.getItem(DEFAULT_STYLE_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveDefaultStyleId(id: string, storage: Storage | undefined = safeStorage()): void {
  try {
    if (id === APP_NEW_STRUCTURE_STYLE_PRESET.id) storage?.removeItem(DEFAULT_STYLE_STORAGE_KEY);
    else storage?.setItem(DEFAULT_STYLE_STORAGE_KEY, id);
  } catch {
    // Settings are best effort, as for other preferences.
  }
}

/** The style new structures start in: the chosen one, or the built-in default when it is gone. */
export function resolveDefaultStylePreset(storage: Storage | undefined = safeStorage()): ChemDraftStylePreset {
  const id = loadDefaultStyleId(storage);
  return availableStylePresets(storage).find((preset) => preset.id === id) ?? APP_NEW_STRUCTURE_STYLE_PRESET;
}

function savedStyleFromJson(value: unknown): SavedStyle | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? normalizedStyleName(record.name) : undefined;
  if (!name || typeof record.id !== "string" || !record.id.startsWith(SAVED_STYLE_ID_PREFIX)) return undefined;
  if (!record.drawing || typeof record.drawing !== "object") return undefined;
  return {
    id: record.id,
    name,
    savedAt: typeof record.savedAt === "string" ? record.savedAt : "",
    drawing: normalizeDrawing(record.drawing as Partial<NativeDrawingStyle>, record.id)
  };
}

function normalizeDrawing(drawing: Partial<NativeDrawingStyle>, id: string): NativeDrawingStyle {
  return nativeDrawingStyleFromObjectStyle({ ...DefaultNativeDrawingStyle, ...drawing, stylePresetId: id });
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}
