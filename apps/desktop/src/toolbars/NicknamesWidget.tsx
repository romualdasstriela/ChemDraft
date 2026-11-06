import { useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { usePaletteButtonInvoke } from "./toolbarCells";
import { useToolbarWidgetState } from "./toolbarWidgets";
import { nicknameToolCommandId, useUserNicknames } from "../nicknames/userNicknames";
import {
  loadNicknameDefineRequest,
  loadUserNicknameTemplates,
  NICKNAME_DEFINE_REQUEST_STORAGE_KEY,
  saveNicknameDefineRequest,
  saveUserNicknameTemplates,
  withUserNicknameTemplate,
  type NicknameDefineRequest
} from "../nicknames/userTemplates";
import {
  broadcastNicknameSignal,
  listenForNicknameSignal,
  NICKNAME_DEFINE_REQUEST_EVENT,
  setToolsetWindowFocusable,
  USER_NICKNAMES_CHANGED_EVENT
} from "../window-manager";
import { nativeAtomLabelReading, type AbbreviationDefinition } from "@chemdraft/document-workflow-core";

const NICKNAMES_TOOLSET_ID = "core.nicknames";

type NicknameTab = "folder" | "user";

/**
 * Text fields in a palette window: palettes are not focusable (they never take keyboard focus from
 * the drawing), so a field makes its window focusable while it is in use, and gives it back after.
 */
const focusableFieldHandlers = {
  onPointerDown: () => { void setToolsetWindowFocusable(NICKNAMES_TOOLSET_ID, true); },
  onFocus: () => { void setToolsetWindowFocusable(NICKNAMES_TOOLSET_ID, true); },
  onBlur: (event: FocusEvent<HTMLInputElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof HTMLInputElement)) void setToolsetWindowFocusable(NICKNAMES_TOOLSET_ID, false);
  }
};

/** Why a name cannot be a user template, or undefined when it can. */
export function userTemplateNameProblem(name: string): string | undefined {
  const label = name.trim();
  if (!label) return "Type the abbreviation.";
  if (/\s/.test(label)) return "An abbreviation has no spaces.";
  const reading = nativeAtomLabelReading(label, { bonded: true });
  if (reading.kind === "group" && reading.group.kind === "abbreviation" && reading.group.definition.source === undefined) {
    return `${label} is a built-in group already.`;
  }
  return undefined;
}

/**
 * The Nicknames toolbar: the groups from the user's nickname folder (Preferences ▸ Nicknames) and
 * the user's own templates ("user templ."), each with a search box. Pressing one arms its nickname
 * tool (the canvas then labels each clicked atom with it, or places it on empty page); the armed one
 * stays highlighted. Groups that join at two atoms (residues, linkers) are marked. Define Nickname
 * on the main toolbar opens the "user templ." tab with a name field for the selected structure.
 */
export function NicknamesWidget() {
  const { activeTool, onInvoke } = useToolbarWidgetState();
  const nicknames = useUserNicknames(false);
  const [tab, setTab] = useState<NicknameTab>("folder");
  const [query, setQuery] = useState("");
  const [request, setRequest] = useState<NicknameDefineRequest | undefined>(() => loadNicknameDefineRequest());
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | undefined>();
  const nameRef = useRef<HTMLInputElement>(null);

  // A Define Nickname request: switch to the user tab and ask for the name.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const pick = () => {
      const pending = loadNicknameDefineRequest();
      if (disposed || !pending) return;
      setRequest(pending);
      setTab("user");
      setName("");
      setProblem(undefined);
    };
    pick();
    void listenForNicknameSignal(NICKNAME_DEFINE_REQUEST_EVENT, NICKNAME_DEFINE_REQUEST_STORAGE_KEY, pick).then((listener) => {
      if (disposed) listener(); else unlisten = listener;
    });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    if (!request) return;
    void (async () => {
      await setToolsetWindowFocusable(NICKNAMES_TOOLSET_ID, true);
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setFocus();
      } catch { /* Browser build: the page already has focus. */ }
      nameRef.current?.focus();
    })();
  }, [request]);

  const finishRequest = () => {
    saveNicknameDefineRequest(undefined);
    setRequest(undefined);
    setName("");
    setProblem(undefined);
    void setToolsetWindowFocusable(NICKNAMES_TOOLSET_ID, false);
  };

  const saveTemplate = () => {
    if (!request) return;
    const issue = userTemplateNameProblem(name);
    if (issue) {
      setProblem(issue);
      return;
    }
    saveUserNicknameTemplates(withUserNicknameTemplate(loadUserNicknameTemplates(), { label: name.trim(), graph: request.graph }));
    void broadcastNicknameSignal(USER_NICKNAMES_CHANGED_EVENT);
    finishRequest();
  };

  const removeTemplate = (label: string) => {
    saveUserNicknameTemplates(loadUserNicknameTemplates().filter((template) => template.label !== label));
    void broadcastNicknameSignal(USER_NICKNAMES_CHANGED_EVENT);
  };

  const source = tab === "folder" ? nicknames.folderDefinitions : nicknames.templateDefinitions;
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? source.filter((definition) =>
          definition.label.toLowerCase().includes(needle) || definition.formula.toLowerCase().includes(needle))
      : source;
  }, [source, query]);

  return (
    <div className="nicknames-panel" data-nicknames="true">
      <div className="nicknames-tabs" role="tablist" aria-label="Nickname sources">
        <button type="button" role="tab" aria-selected={tab === "folder"} data-palette-control="true" onClick={() => setTab("folder")}>
          Folder
        </button>
        <button type="button" role="tab" aria-selected={tab === "user"} data-palette-control="true" onClick={() => setTab("user")}>
          user templ.
        </button>
      </div>

      {tab === "user" && request ? (
        <form
          className="nickname-define"
          data-nickname-define="true"
          onSubmit={(event) => { event.preventDefault(); saveTemplate(); }}
        >
          <span className="nickname-define-what">
            New template: {request.formula}, {request.sites} attachment site{request.sites === 1 ? "" : "s"}
          </span>
          <input
            ref={nameRef}
            type="text"
            aria-label="Abbreviation"
            placeholder="Abbreviation"
            value={name}
            data-palette-control="true"
            onChange={(event) => { setName(event.currentTarget.value); setProblem(undefined); }}
            onKeyDown={(event) => { if (event.key === "Escape") finishRequest(); }}
            {...focusableFieldHandlers}
          />
          <div className="nickname-define-actions">
            <button type="submit" data-palette-control="true">OK</button>
            <button type="button" data-palette-control="true" onClick={finishRequest}>Cancel</button>
          </div>
          {problem ? <p className="nicknames-empty" role="alert">{problem}</p> : null}
        </form>
      ) : null}

      {tab === "folder" && (!nicknames.folder || nicknames.error) ? (
        <p className="nicknames-empty">
          {nicknames.error ?? "No nickname folder is set."} Choose the folder in Preferences ▸ Nicknames.
        </p>
      ) : tab === "user" && source.length === 0 && !request ? (
        <p className="nicknames-empty">
          No templates yet. Draw a group, select it without the atom it attaches to (or mark that bond with a *
          atom), and press Define Nickname on the main toolbar.
        </p>
      ) : (
        <>
          <input
            type="search"
            className="nicknames-search"
            aria-label="Search nicknames"
            placeholder={`Search ${source.length} ${tab === "folder" ? "nicknames" : "templates"}`}
            value={query}
            data-palette-control="true"
            onChange={(event) => setQuery(event.currentTarget.value)}
            {...focusableFieldHandlers}
          />
          <div className="nicknames-list" role="group" aria-label={tab === "folder" ? "Nicknames" : "User templates"}>
            {shown.map((definition) => (
              <NicknameButton
                key={definition.label}
                definition={definition}
                active={activeTool === nicknameToolCommandId(definition.label)}
                onInvoke={onInvoke}
                onRemove={tab === "user" ? () => removeTemplate(definition.label) : undefined}
              />
            ))}
            {shown.length === 0 ? <p className="nicknames-empty">No nickname matches “{query}”.</p> : null}
          </div>
        </>
      )}
    </div>
  );
}

function NicknameButton({
  definition,
  active,
  onInvoke,
  onRemove
}: {
  definition: AbbreviationDefinition;
  active: boolean;
  onInvoke: (commandId: string) => void;
  onRemove?: () => void;
}) {
  const commandId = nicknameToolCommandId(definition.label);
  const invokeHandlers = usePaletteButtonInvoke(commandId, onInvoke);
  const sites = definition.attachmentCount;
  return (
    <span className="nickname-item">
      <button
        type="button"
        className={["nickname-button", active ? "active" : ""].filter(Boolean).join(" ")}
        aria-pressed={active}
        title={`${definition.label}: ${definition.formula}${sites > 1 ? `, joins at ${sites} sites` : ""}`}
        data-command-id={commandId}
        data-palette-control="true"
        {...invokeHandlers}
      >
        {definition.label}
        {sites > 1 ? <span className="nickname-sites" aria-label={`${sites} attachment sites`}>×{sites}</span> : null}
      </button>
      {onRemove ? (
        <button
          type="button"
          className="nickname-remove"
          aria-label={`Remove template ${definition.label}`}
          title={`Remove template ${definition.label}`}
          data-palette-control="true"
          onClick={onRemove}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
