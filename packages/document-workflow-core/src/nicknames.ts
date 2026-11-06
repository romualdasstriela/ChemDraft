// User nicknames: groups defined in files on the user's own computer (one structure per file, with
// connection points marking where it attaches), turned into abbreviation definitions the label
// grammar can read. The data never enters this repository; the desktop app reads the folder at run
// time and registers the result with `setUserAbbreviations`.

import {
  nativeAtomLabelReading,
  nativeAtomValenceForCharge,
  nativeElementFromAtomLabel,
  type NativeElementSymbol
} from "@chemdraft/layout-engine";
import type { MoleculeAtom, MoleculeObject } from "@chemdraft/chem-core";
import { expandNativeLabelGroups } from "./atoms";
import type { AbbreviationAtom, AbbreviationBond, AbbreviationDefinition } from "@chemdraft/template-library";

// The registry the definitions are added to lives with the abbreviation table.
export { setUserAbbreviations, userAbbreviations, type AbbreviationDefinition } from "@chemdraft/template-library";

/** A nickname's structure as read from its file (cdx-compat's `CdxmlNicknameGraph`): y down. */
export interface NicknameGraphInput {
  atoms: ReadonlyArray<{ element: string; charge: number; statedHydrogens?: number; x: number; y: number }>;
  bonds: ReadonlyArray<readonly [from: number, to: number, order: 1 | 2 | 3]>;
  attachments: ReadonlyArray<{ atomIndex: number; x: number; y: number }>;
  /**
   * A drawn group whose atoms carry labels ("OMe"): the drawing as it was, labels kept. Its atom i is
   * `atoms[i]` before expansion (same place), so the two share one frame; `atoms` beyond them are the
   * labels' written-out atoms.
   */
  drawn?: {
    atoms: ReadonlyArray<{ label: string; charge: number; x: number; y: number }>;
    bonds: ReadonlyArray<readonly [from: number, to: number, order: 1 | 2 | 3]>;
  };
}

/**
 * The abbreviation a nickname file defines. The label is the file's name ("Ad", "t-Bu"). The first
 * connection point's atom becomes `atoms[0]`; a group joining at more than one of its atoms lists
 * them in `attachmentAtoms`. Each atom's hydrogens are the ones the file states, or else the ones
 * its element's valence leaves after its bonds, connection bonds included. The layout is put in the
 * table's frame: attachment atom at (0, 0), the first connection point toward (−1, 0), bond length
 * 1, y up. A label that is an element symbol ("Am", "Np") names the group only when typed on an atom
 * with bonds, as "Ac" does among the built-in groups.
 */
export function abbreviationDefinitionFromNickname(label: string, graph: NicknameGraphInput, source?: string): AbbreviationDefinition {
  // A group with no connection point (a user template kept as drawn) keeps its first atom first and
  // its drawn orientation.
  const first = graph.attachments[0];
  const firstAtom = first?.atomIndex ?? 0;
  // Attachment atom first, the rest in file order.
  const order = [firstAtom, ...graph.atoms.map((_, index) => index).filter((index) => index !== firstAtom)];
  const newIndex = new Map(order.map((oldIndex, index) => [oldIndex, index]));
  const bonds: AbbreviationBond[] = graph.bonds.map(([from, to, bondOrder]) => [newIndex.get(from)!, newIndex.get(to)!, bondOrder]);
  const attachmentAtoms = graph.attachments.map((attachment) => newIndex.get(attachment.atomIndex)!);

  // Valence each atom spends on bonds: its own bonds plus one per connection point it carries.
  const bondValence = order.map(() => 0);
  for (const [from, to, bondOrder] of bonds) {
    bondValence[from]! += bondOrder;
    bondValence[to]! += bondOrder;
  }
  for (const index of attachmentAtoms) bondValence[index]! += 1;

  // Frame: translate the attachment atom to the origin, scale to unit bonds, flip y, and turn so the
  // first connection point lies along −x.
  const origin = graph.atoms[firstAtom] ?? { x: 0, y: 0 };
  const lengths = graph.bonds.map(([from, to]) => Math.hypot(graph.atoms[from]!.x - graph.atoms[to]!.x, graph.atoms[from]!.y - graph.atoms[to]!.y));
  const toConnection = first ? { x: first.x - origin.x, y: -(first.y - origin.y) } : { x: -1, y: 0 };
  const unit = (lengths.length > 0 ? lengths.reduce((sum, length) => sum + length, 0) / lengths.length : first ? Math.hypot(toConnection.x, toConnection.y) : 1) || 1;
  const turn = first ? Math.PI - Math.atan2(toConnection.y, toConnection.x) : 0;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const round = (value: number) => Math.round(value * 1000) / 1000 + 0;

  const framed = (point: { x: number; y: number }) => {
    const x = (point.x - origin.x) / unit;
    const y = -(point.y - origin.y) / unit;
    return { x: round(x * cos - y * sin), y: round(x * sin + y * cos) };
  };
  const atoms: AbbreviationAtom[] = order.map((oldIndex, index) => {
    const atom = graph.atoms[oldIndex]!;
    const element = nativeElementFromAtomLabel(atom.element) ?? atom.element;
    const implicit = Math.max(0, nativeAtomValenceForCharge(element as NativeElementSymbol, atom.charge) - bondValence[index]!);
    return {
      element,
      hydrogens: atom.statedHydrogens ?? implicit,
      ...(atom.charge !== 0 ? { charge: atom.charge } : {}),
      ...framed(atom)
    };
  });
  const display = graph.drawn ? {
    atoms: graph.drawn.atoms.map((atom) => ({
      label: atom.label,
      ...(atom.charge !== 0 ? { charge: atom.charge } : {}),
      ...framed(atom)
    })),
    bonds: graph.drawn.bonds.map(([from, to, bondOrder]): AbbreviationBond => [from, to, bondOrder])
  } : undefined;

  const isElementSymbol = nativeElementFromAtomLabel(label) === label;
  return {
    label,
    aliases: [],
    ...(isElementSymbol ? { bondedSpellings: [label] } : {}),
    name: label,
    smiles: "",
    formula: hillFormula(atoms),
    attachmentCount: graph.attachments.length,
    atoms,
    bonds,
    ...(new Set(attachmentAtoms).size > 1 ? { attachmentAtoms } : {}),
    ...(source ? { source } : {}),
    ...(display ? { display } : {})
  };
}

export type NicknameFromDrawingResult =
  | { ok: true; graph: NicknameGraphInput }
  | { ok: false; reason: string };

/**
 * A nickname's structure taken from a drawing (Define Nickname): the chosen atoms of one molecule.
 * Where it attaches is read from the drawing itself: each single bond from a chosen atom to an atom
 * left out of the choice is one attachment, and so is a chosen "*" atom on a single bond (drawn to
 * mark the site). Only plain element atoms and single, double or triple bonds are taken; anything
 * else (a group label, an aromatic bond, a multiple bond to the rest) is refused with the reason, so
 * the template never holds a structure the drawing does not.
 */
export function nicknameGraphFromDrawing(
  molecule: Pick<MoleculeObject, "atoms" | "bonds">,
  atomIds: ReadonlySet<string>
): NicknameFromDrawingResult {
  const isMarker = (atom: MoleculeAtom) => atom.element.trim() === "*";
  const chosen = molecule.atoms.filter((atom) => atomIds.has(atom.id) && !isMarker(atom));
  if (chosen.length === 0) {
    return { ok: false, reason: "Select the atoms of the group first." };
  }
  // Abbreviation labels ("OMe", "Ph", "NHBoc", a nickname) are written out as the atoms they stand
  // for, the same expansion the formula and the exporters use; the drawing itself, labels and all,
  // is kept beside it (`drawn`) so the template is placed looking as it was drawn.
  const expanded = expandNativeLabelGroups(molecule.atoms, molecule.bonds);
  const expansionByAtomId = new Map(expanded.expansions.map((expansion) => [expansion.atomId, expansion]));
  const expandedById = new Map(expanded.atoms.map((atom) => [atom.id, atom]));
  const groupAtomIds: string[] = chosen.map((atom) => atom.id);
  let hasLabels = false;
  // A label spelling one element with its hydrogens ("OH", "NH2") is that element, hydrogens stated.
  const spelledHydrogens = new Map<string, { element: string; hydrogens: number }>();
  for (const atom of chosen) {
    const expansion = expansionByAtomId.get(atom.id);
    if (expansion) {
      hasLabels = true;
      groupAtomIds.push(...expansion.atomIds.filter((id) => id !== atom.id));
      continue;
    }
    const reading = nativeAtomLabelReading(atom.element);
    if (reading.kind === "spelled") {
      hasLabels = true;
      spelledHydrogens.set(atom.id, { element: reading.element, hydrogens: reading.hydrogens });
      continue;
    }
    if (reading.kind !== "element") {
      return {
        ok: false,
        reason: `"${atom.element}" is not an element or a known abbreviation here (or its bonds do not fit it); draw it out as atoms or fix the label first.`
      };
    }
  }
  const groupAtoms = groupAtomIds.map((id) => {
    const atom = expandedById.get(id)!;
    const spelled = spelledHydrogens.get(id);
    return spelled ? { ...atom, element: spelled.element, hydrogenCount: spelled.hydrogens } : atom;
  });
  const indexById = new Map(groupAtomIds.map((id, index) => [id, index]));
  const atomById = new Map(expanded.atoms.map((atom) => [atom.id, atom]));
  const order = { single: 1, double: 2, triple: 3 } as const;
  const bonds: Array<[number, number, 1 | 2 | 3]> = [];
  const attachments: Array<{ atomIndex: number; x: number; y: number }> = [];
  for (const bond of expanded.bonds) {
    const from = indexById.get(bond.fromAtomId);
    const to = indexById.get(bond.toAtomId);
    if (from === undefined && to === undefined) continue;
    const bondOrder = (order as Record<string, 1 | 2 | 3 | undefined>)[bond.order];
    if (from !== undefined && to !== undefined) {
      if (!bondOrder) return { ok: false, reason: `A ${bond.order} bond cannot be kept in a nickname; draw it as single and double bonds.` };
      bonds.push([from, to, bondOrder]);
      continue;
    }
    // One end chosen, the other outside the group (or a "*" marker): an attachment.
    const inside = from ?? to!;
    const outside = atomById.get(from === undefined ? bond.fromAtomId : bond.toAtomId)!;
    if (bondOrder !== 1) return { ok: false, reason: "A group attaches by single bonds only." };
    attachments.push({ atomIndex: inside, x: outside.x, y: outside.y });
  }
  // No attachment marked: the structure is kept whole, as drawn (it is placed on empty page and can
  // label an atom with no bonds).
  const chosenIndex = new Map(chosen.map((atom, index) => [atom.id, index]));
  const drawnBonds: Array<[number, number, 1 | 2 | 3]> = [];
  for (const bond of molecule.bonds) {
    const from = chosenIndex.get(bond.fromAtomId);
    const to = chosenIndex.get(bond.toAtomId);
    const bondOrder = (order as Record<string, 1 | 2 | 3 | undefined>)[bond.order];
    if (from !== undefined && to !== undefined && bondOrder) drawnBonds.push([from, to, bondOrder]);
  }
  return {
    ok: true,
    graph: {
      atoms: groupAtoms.map((atom) => {
        const element = nativeElementFromAtomLabel(atom.element.trim()) ?? atom.element.trim();
        return {
          element,
          charge: atom.formalCharge,
          ...(atom.hydrogenCount !== undefined ? { statedHydrogens: atom.hydrogenCount } : {}),
          x: atom.x,
          y: atom.y
        };
      }),
      bonds,
      attachments,
      ...(hasLabels ? {
        drawn: {
          atoms: chosen.map((atom) => ({ label: atom.element.trim(), charge: atom.formalCharge, x: atom.x, y: atom.y })),
          bonds: drawnBonds
        }
      } : {})
    }
  };
}

/** Hill formula of the group's atoms with their hydrogens: C, then H, then the rest alphabetically. */
function hillFormula(atoms: readonly AbbreviationAtom[]): string {
  const counts = new Map<string, number>();
  const add = (element: string, count: number) => {
    if (count > 0) counts.set(element, (counts.get(element) ?? 0) + count);
  };
  for (const atom of atoms) {
    add(atom.element, 1);
    add("H", atom.hydrogens);
  }
  const ordered = counts.has("C")
    ? ["C", "H", ...[...counts.keys()].filter((element) => element !== "C" && element !== "H").sort()]
    : [...counts.keys()].sort();
  return ordered
    .filter((element) => counts.has(element))
    .map((element) => `${element}${counts.get(element) === 1 ? "" : counts.get(element)}`)
    .join("");
}
