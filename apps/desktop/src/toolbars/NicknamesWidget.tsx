import { useMemo, useState } from "react";
import { usePaletteButtonInvoke } from "./toolbarCells";
import { useToolbarWidgetState } from "./toolbarWidgets";
import { nicknameToolCommandId, useUserNicknames } from "../nicknames/userNicknames";
import type { AbbreviationDefinition } from "@chemdraft/document-workflow-core";

/**
 * The Nicknames toolbar: the groups from the user's nickname folder (Preferences ▸ Nicknames), with a
 * search box. Pressing one arms its nickname tool (the canvas then labels each clicked atom with it);
 * the armed one stays highlighted. Groups that join at two atoms (residues, linkers) are marked.
 */
export function NicknamesWidget() {
  const { activeTool, onInvoke } = useToolbarWidgetState();
  const nicknames = useUserNicknames(false);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? nicknames.definitions.filter((definition) =>
          definition.label.toLowerCase().includes(needle) || definition.formula.toLowerCase().includes(needle))
      : nicknames.definitions;
  }, [nicknames.definitions, query]);

  if (!nicknames.folder || nicknames.error) {
    return (
      <div className="nicknames-panel" data-nicknames="true">
        <p className="nicknames-empty">
          {nicknames.error ?? "No nickname folder is set."} Choose the folder in Preferences ▸ Nicknames.
        </p>
      </div>
    );
  }

  return (
    <div className="nicknames-panel" data-nicknames="true">
      <input
        type="search"
        className="nicknames-search"
        aria-label="Search nicknames"
        placeholder={`Search ${nicknames.definitions.length} nicknames`}
        value={query}
        data-palette-control="true"
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <div className="nicknames-list" role="group" aria-label="Nicknames">
        {shown.map((definition) => (
          <NicknameButton
            key={definition.label}
            definition={definition}
            active={activeTool === nicknameToolCommandId(definition.label)}
            onInvoke={onInvoke}
          />
        ))}
        {shown.length === 0 ? <p className="nicknames-empty">No nickname matches “{query}”.</p> : null}
      </div>
    </div>
  );
}

function NicknameButton({
  definition,
  active,
  onInvoke
}: {
  definition: AbbreviationDefinition;
  active: boolean;
  onInvoke: (commandId: string) => void;
}) {
  const commandId = nicknameToolCommandId(definition.label);
  const invokeHandlers = usePaletteButtonInvoke(commandId, onInvoke);
  const sites = definition.attachmentCount;
  return (
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
  );
}
