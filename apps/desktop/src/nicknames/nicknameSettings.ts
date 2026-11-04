/**
 * Where the user's nickname files live: a folder of one-structure CDXML files on their own computer
 * (Preferences ▸ Nicknames). Empty means none. The files are read at run time and never copied into
 * the app or its repository.
 */
export interface NicknameSettings { folder: string }
export const NICKNAME_SETTINGS_STORAGE_KEY = "chemdraft.nickname-folder.v1";

export function isNicknameSettings(value: unknown): value is NicknameSettings {
  return !!value && typeof value === "object" && typeof (value as NicknameSettings).folder === "string";
}

export function loadNicknameSettings(): NicknameSettings {
  try {
    const value: unknown = JSON.parse(globalThis.localStorage?.getItem(NICKNAME_SETTINGS_STORAGE_KEY) ?? "null");
    if (isNicknameSettings(value)) return value;
  } catch { /* Missing/corrupt/blocked storage: no nickname folder. */ }
  return { folder: "" };
}

export function saveNicknameSettings(settings: NicknameSettings): void {
  try { globalThis.localStorage?.setItem(NICKNAME_SETTINGS_STORAGE_KEY, JSON.stringify(settings)); }
  catch { /* Best-effort, matching the existing Preferences storage policy. */ }
}
