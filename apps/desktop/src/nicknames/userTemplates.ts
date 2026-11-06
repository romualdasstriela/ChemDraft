import {
  abbreviationDefinitionFromNickname,
  type AbbreviationDefinition,
  type NicknameGraphInput
} from "@chemdraft/document-workflow-core";

/**
 * User templates: nicknames the user defines from their own drawing (Define Nickname). Each keeps
 * the drawn structure and where it attaches, and is rebuilt into a table entry the same way a
 * nickname file is, so it works like every other nickname. Stored on this computer only.
 */
export interface UserNicknameTemplate {
  label: string;
  graph: NicknameGraphInput;
}

export const USER_NICKNAME_TEMPLATES_STORAGE_KEY = "chemdraft.user-nickname-templates.v1";
/** The structure Define Nickname took from the drawing, waiting for its name in the toolbox. */
export const NICKNAME_DEFINE_REQUEST_STORAGE_KEY = "chemdraft.nickname-define-request.v1";
/** A request older than this is stale (the toolbox opened much later); it is not shown. */
export const NICKNAME_DEFINE_REQUEST_LIFETIME_MS = 60_000;

export interface NicknameDefineRequest {
  graph: NicknameGraphInput;
  formula: string;
  sites: number;
  at: number;
}

function isGraph(value: unknown): value is NicknameGraphInput {
  if (!value || typeof value !== "object") return false;
  const graph = value as NicknameGraphInput;
  const number = (item: unknown) => typeof item === "number" && Number.isFinite(item);
  return Array.isArray(graph.atoms) && graph.atoms.length > 0 &&
    graph.atoms.every((atom) => typeof atom?.element === "string" && number(atom.charge) && number(atom.x) && number(atom.y)) &&
    Array.isArray(graph.bonds) &&
    graph.bonds.every((bond) => Array.isArray(bond) && bond.length === 3 && bond.every(number) &&
      bond[0]! < graph.atoms.length && bond[1]! < graph.atoms.length && [1, 2, 3].includes(bond[2]!)) &&
    Array.isArray(graph.attachments) &&
    graph.attachments.every((attachment) => number(attachment?.atomIndex) && attachment.atomIndex < graph.atoms.length &&
      number(attachment.x) && number(attachment.y));
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (value === undefined) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch { /* Best-effort, matching the existing settings storage policy. */ }
}

export function loadUserNicknameTemplates(): UserNicknameTemplate[] {
  const value = readJson(USER_NICKNAME_TEMPLATES_STORAGE_KEY);
  return Array.isArray(value)
    ? value.filter((entry): entry is UserNicknameTemplate =>
        !!entry && typeof entry.label === "string" && entry.label.trim().length > 0 && isGraph(entry.graph))
    : [];
}

export function saveUserNicknameTemplates(templates: readonly UserNicknameTemplate[]): void {
  writeJson(USER_NICKNAME_TEMPLATES_STORAGE_KEY, templates);
}

/** Add or replace (same label) one template. */
export function withUserNicknameTemplate(
  templates: readonly UserNicknameTemplate[],
  template: UserNicknameTemplate
): UserNicknameTemplate[] {
  return [...templates.filter((entry) => entry.label !== template.label), template]
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function userTemplateDefinitions(templates: readonly UserNicknameTemplate[]): AbbreviationDefinition[] {
  return templates.map((template) => abbreviationDefinitionFromNickname(template.label, template.graph, "user template"));
}

export function saveNicknameDefineRequest(request: NicknameDefineRequest | undefined): void {
  writeJson(NICKNAME_DEFINE_REQUEST_STORAGE_KEY, request);
}

/** The pending Define Nickname request, if one was made in the last minute. */
export function loadNicknameDefineRequest(now = Date.now()): NicknameDefineRequest | undefined {
  const value = readJson(NICKNAME_DEFINE_REQUEST_STORAGE_KEY) as Partial<NicknameDefineRequest> | null;
  if (!value || !isGraph(value.graph) || typeof value.at !== "number" || now - value.at > NICKNAME_DEFINE_REQUEST_LIFETIME_MS) {
    return undefined;
  }
  return value as NicknameDefineRequest;
}
