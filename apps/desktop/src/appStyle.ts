import {
  AcsDocument1996StylePreset,
  AcsDocument1996TextStyle,
  DefaultNativeTextStyle,
  type NativeTextStyle
} from "@chemdraft/chem-core";

/** The style the app draws new structures in: the ACS Document 1996 journal style. */
export const APP_NEW_STRUCTURE_STYLE_PRESET = AcsDocument1996StylePreset;

/** The style new text starts with: the same journal style's Arial 10 pt. */
export const APP_NEW_TEXT_STYLE: NativeTextStyle = { ...DefaultNativeTextStyle, ...AcsDocument1996TextStyle };
