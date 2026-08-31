/**
 * Closed `led-driver-human-source/1.0` fiche.
 *
 * This is the human decision sheet, not a netlist, IR, ngspice payload or
 * D1 representation choice. Identity, provenance, revision, named circuit,
 * named test condition and the explicit status of unknowns are required.
 * Physical numbers are not admitted fields.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";

export const LED_DRIVER_HUMAN_SOURCE_SCHEMA = "led-driver-human-source/1.0" as const;

export type LedDriverSourceProvenanceKind = "human" | "document" | "expert";

export interface LedDriverSourceProvenance {
  readonly kind: LedDriverSourceProvenanceKind;
  readonly authorId: string;
  readonly reference: string;
}

export interface LedDriverNamedCircuit {
  readonly id: string;
  readonly name: string;
}

export interface LedDriverNamedTestCondition {
  readonly id: string;
  readonly name: string;
}

export interface LedDriverSourceUnknown {
  readonly id: string;
  readonly status: "unresolved";
  readonly name: string;
}

export interface LedDriverHumanSource {
  readonly schemaVersion: typeof LED_DRIVER_HUMAN_SOURCE_SCHEMA;
  readonly id: string;
  readonly revision: number;
  readonly provenance: LedDriverSourceProvenance;
  readonly circuit: LedDriverNamedCircuit;
  readonly testCondition: LedDriverNamedTestCondition;
  readonly unknowns: readonly LedDriverSourceUnknown[];
}

const ROOT_KEYS = [
  "schemaVersion",
  "id",
  "revision",
  "provenance",
  "circuit",
  "testCondition",
  "unknowns",
] as const;

const PROVENANCE_KINDS = ["human", "document", "expert"] as const;

export function validateLedDriverHumanSource(
  value: unknown,
  path = "$ledDriverHumanSource",
): LedDriverHumanSource {
  const root = exactRecord(value, ROOT_KEYS, path);
  literalValue(
    root.schemaVersion,
    LED_DRIVER_HUMAN_SOURCE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const provenance = parseProvenance(root.provenance, `${path}.provenance`);
  const circuit = parseNamedRef(root.circuit, `${path}.circuit`);
  const testCondition = parseNamedRef(
    root.testCondition,
    `${path}.testCondition`,
  );
  const unknowns = arrayOf(root.unknowns, `${path}.unknowns`).map(
    (item, index) => parseUnknown(item, `${path}.unknowns[${index}]`),
  );
  rejectDuplicates(
    unknowns.map((item) => item.id),
    `${path}.unknowns`,
  );
  return deepFreeze({
    schemaVersion: LED_DRIVER_HUMAN_SOURCE_SCHEMA,
    id: safeId(root.id, `${path}.id`),
    revision: positiveInteger(root.revision, `${path}.revision`),
    provenance,
    circuit,
    testCondition,
    unknowns,
  });
}

function parseProvenance(
  value: unknown,
  path: string,
): LedDriverSourceProvenance {
  const input = exactRecord(value, ["kind", "authorId", "reference"], path);
  const kind = nonEmptyText(input.kind, `${path}.kind`);
  if (!PROVENANCE_KINDS.includes(kind as LedDriverSourceProvenanceKind)) {
    throw new TypeError(`${path}.kind must be human, document or expert.`);
  }
  return {
    kind: kind as LedDriverSourceProvenanceKind,
    authorId: safeId(input.authorId, `${path}.authorId`),
    reference: nonEmptyText(input.reference, `${path}.reference`),
  };
}

function parseNamedRef(
  value: unknown,
  path: string,
): { readonly id: string; readonly name: string } {
  const input = exactRecord(value, ["id", "name"], path);
  return {
    id: safeId(input.id, `${path}.id`),
    name: nonEmptyText(input.name, `${path}.name`),
  };
}

function parseUnknown(value: unknown, path: string): LedDriverSourceUnknown {
  const input = exactRecord(value, ["id", "status", "name"], path);
  literalValue(input.status, "unresolved", `${path}.status`);
  return {
    id: safeId(input.id, `${path}.id`),
    status: "unresolved",
    name: nonEmptyText(input.name, `${path}.name`),
  };
}
