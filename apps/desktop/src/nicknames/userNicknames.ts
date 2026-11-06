import { useEffect, useState } from "react";
import { readCdxmlNickname } from "@chemdraft/cdx-compat";
import { abbreviationDefinitionFromNickname, setUserAbbreviations, type AbbreviationDefinition } from "@chemdraft/document-workflow-core";
import { decodeDocumentBytes } from "../documentText";
import {
  isDesktopRuntime,
  listenForNicknameSettings,
  listenForNicknameSignal,
  USER_NICKNAMES_CHANGED_EVENT
} from "../window-manager";
import { loadNicknameSettings } from "./nicknameSettings";
import { loadUserNicknameTemplates, USER_NICKNAME_TEMPLATES_STORAGE_KEY, userTemplateDefinitions } from "./userTemplates";

/**
 * The user's nicknames: groups read from the nickname folder set in Preferences (one structure per
 * CDXML file, the file name its label). They are registered with the label grammar, so a label typed
 * as "Ad" or "Boc" reads as that group, and listed in the Nicknames toolbar.
 */
export interface UserNicknameLoad {
  folder: string;
  definitions: AbbreviationDefinition[];
  /** Files that were not read as a group, with the reason. */
  skipped: Array<{ file: string; reason: string }>;
  /** Why nothing was loaded (no folder set, folder unreadable), if so. */
  error?: string;
}

/** Turn a folder's files (name and text) into nickname groups; pure, for tests and the loader. */
export function nicknameDefinitionsFromFiles(files: ReadonlyArray<{ name: string; contents: string }>): Pick<UserNicknameLoad, "definitions" | "skipped"> {
  const definitions: AbbreviationDefinition[] = [];
  const skipped: UserNicknameLoad["skipped"] = [];
  for (const file of [...files].sort((left, right) => left.name.localeCompare(right.name))) {
    const label = file.name.replace(/\.cdxml$/i, "").trim();
    const result = readCdxmlNickname(file.contents);
    if (!label || !result.ok) {
      skipped.push({ file: file.name, reason: result.ok ? "it has no name" : result.reason });
      continue;
    }
    definitions.push(abbreviationDefinitionFromNickname(label, result.graph, file.name));
  }
  return { definitions, skipped };
}

/** Read the nickname folder's .cdxml files (desktop only). */
export async function loadUserNicknames(folder: string): Promise<UserNicknameLoad> {
  if (!folder) {
    return { folder, definitions: [], skipped: [], error: "No nickname folder is set (Preferences ▸ Nicknames)." };
  }
  if (!isDesktopRuntime()) {
    return { folder, definitions: [], skipped: [], error: "Nickname folders are read by the desktop app." };
  }
  try {
    const { readDir, readFile } = await import("@tauri-apps/plugin-fs");
    const entries = await readDir(folder);
    const separator = folder.includes("\\") ? "\\" : "/";
    const base = folder.endsWith(separator) ? folder : `${folder}${separator}`;
    const files = await Promise.all(entries
      .filter((entry) => entry.isFile && /\.cdxml$/i.test(entry.name))
      .map(async (entry) => ({ name: entry.name, contents: decodeDocumentBytes(await readFile(`${base}${entry.name}`)) })));
    return { folder, ...nicknameDefinitionsFromFiles(files) };
  } catch (error) {
    return { folder, definitions: [], skipped: [], error: `Could not read the nickname folder: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export interface UserNicknamesState extends UserNicknameLoad {
  /** The folder's groups (as `definitions` was before user templates). */
  folderDefinitions: AbbreviationDefinition[];
  /** The user's own templates (Define Nickname). */
  templateDefinitions: AbbreviationDefinition[];
  /** Changes on every reload, so views that read labels can redraw. */
  revision: number;
}

/**
 * The window's nicknames: the folder's groups (Preferences ▸ Nicknames) and the user's own
 * templates, kept current with both. `definitions` holds all of them, a template first where it
 * shares a label with a folder group. With `register`, they are also registered with the label
 * grammar (the document window; palettes only list them).
 */
export function useUserNicknames(register: boolean): UserNicknamesState {
  const [state, setState] = useState<UserNicknamesState>(() => ({
    folder: loadNicknameSettings().folder, definitions: [], folderDefinitions: [], templateDefinitions: [], skipped: [], revision: 0
  }));
  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    let folderLoad: UserNicknameLoad = { folder: loadNicknameSettings().folder, definitions: [], skipped: [] };
    const publish = () => {
      const templateDefinitions = userTemplateDefinitions(loadUserNicknameTemplates());
      const templateLabels = new Set(templateDefinitions.map((definition) => definition.label));
      const definitions = [...templateDefinitions, ...folderLoad.definitions.filter((definition) => !templateLabels.has(definition.label))];
      if (register) setUserAbbreviations(definitions);
      setState((current) => ({
        ...folderLoad, definitions, folderDefinitions: folderLoad.definitions, templateDefinitions, revision: current.revision + 1
      }));
    };
    const loadFolder = (folder: string) => {
      void loadUserNicknames(folder).then((result) => {
        if (disposed) return;
        folderLoad = result;
        publish();
      });
    };
    loadFolder(folderLoad.folder);
    const keep = (listener: () => void) => { if (disposed) listener(); else unlisteners.push(listener); };
    void listenForNicknameSettings((settings) => loadFolder(settings.folder)).then(keep);
    void listenForNicknameSignal(USER_NICKNAMES_CHANGED_EVENT, USER_NICKNAME_TEMPLATES_STORAGE_KEY, () => {
      if (!disposed) publish();
    }).then(keep);
    return () => { disposed = true; unlisteners.forEach((listener) => listener()); };
  }, [register]);
  return state;
}

/**
 * The Nicknames toolbar arms one tool per nickname: `tool.nickname.<hex>`, the label's UTF-8 bytes
 * in hex, so any label ("t-Bu", "3'") makes a command id of plain letters and digits.
 */
export const NICKNAME_TOOL_COMMAND_PREFIX = "tool.nickname.";

export function nicknameToolCommandId(label: string): string {
  return `${NICKNAME_TOOL_COMMAND_PREFIX}${[...new TextEncoder().encode(label)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function nicknameLabelForToolCommand(commandId: string): string | undefined {
  if (!commandId.startsWith(NICKNAME_TOOL_COMMAND_PREFIX)) return undefined;
  const hex = commandId.slice(NICKNAME_TOOL_COMMAND_PREFIX.length);
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) return undefined;
  const bytes = new Uint8Array(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));
  return new TextDecoder().decode(bytes);
}
