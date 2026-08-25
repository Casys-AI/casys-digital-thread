/**
 * Closed `cad-immediate-placement-source/1.0` value object.
 *
 * The document names exact immediate PartUsage identities and local
 * transforms. It is order-independent. Labels, occurrence paths, owners,
 * providers, runtimes, MRTR data, geometry and verdicts are forbidden.
 */

import {
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";

export const CAD_IMMEDIATE_PLACEMENT_SOURCE_SCHEMA =
  "cad-immediate-placement-source/1.0" as const;
export const CAD_PLACEMENT_SOURCE_FILE_ROLE = "cad-placement-source" as const;
export const CAD_PLACEMENT_UNIT_SYSTEM = "mm" as const;
export const CAD_PLACEMENT_CONVENTION =
  "right-handed-mm-extrinsic-xyz-degrees" as const;
export const CAD_IMMEDIATE_PLACEMENT_SOURCE_MAX_CHARS = 262_144;
export const CAD_IMMEDIATE_PLACEMENT_SOURCE_MAX_ENTRIES = 256;

const ROOT_KEYS = [
  "schemaVersion",
  "unitSystem",
  "placementConvention",
  "placements",
] as const;

const PLACEMENT_ENTRY_KEYS = [
  "usageElementId",
  "partDefinitionElementId",
  "placement",
] as const;

const PLACEMENT_VECTOR_KEYS = ["translationMm", "rotationDeg"] as const;

const FORBIDDEN_ROOT_KEYS = [
  "label",
  "labels",
  "occurrencePath",
  "parentId",
  "ownerId",
  "structureBasis",
  "provider",
  "tool",
  "runtime",
  "mrtr",
  "geometry",
  "verdict",
  "fingerprint",
  "latest",
  "path",
  "sourceText",
  "profileId",
] as const;

const FORBIDDEN_ENTRY_KEYS = [
  "label",
  "name",
  "occurrencePath",
  "parentId",
  "ownerId",
  "structureBasis",
  "provider",
  "tool",
  "runtime",
] as const;

export interface CadPlacementTransform {
  readonly translationMm: readonly [number, number, number];
  readonly rotationDeg: readonly [number, number, number];
}

export interface CadImmediatePlacementEntry {
  readonly usageElementId: string;
  readonly partDefinitionElementId: string;
  readonly placement: CadPlacementTransform;
}

export interface CadImmediatePlacementSource {
  readonly schemaVersion: typeof CAD_IMMEDIATE_PLACEMENT_SOURCE_SCHEMA;
  readonly unitSystem: typeof CAD_PLACEMENT_UNIT_SYSTEM;
  readonly placementConvention: typeof CAD_PLACEMENT_CONVENTION;
  readonly placements: readonly CadImmediatePlacementEntry[];
}

/** Validate untrusted JSON and return an immutable order-independent source. */
export function validateCadImmediatePlacementSource(
  value: unknown,
  path = "$placementSource",
): CadImmediatePlacementSource {
  rejectForbiddenKeys(value, FORBIDDEN_ROOT_KEYS, path);
  const root = exactRecord(value, ROOT_KEYS, path);
  literalValue(
    root.schemaVersion,
    CAD_IMMEDIATE_PLACEMENT_SOURCE_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(root.unitSystem, CAD_PLACEMENT_UNIT_SYSTEM, `${path}.unitSystem`);
  literalValue(
    root.placementConvention,
    CAD_PLACEMENT_CONVENTION,
    `${path}.placementConvention`,
  );
  if (!Array.isArray(root.placements)) {
    throw new TypeError(`${path}.placements must be an array.`);
  }
  if (root.placements.length === 0) {
    throw new TypeError(`${path}.placements must contain at least one entry.`);
  }
  if (root.placements.length > CAD_IMMEDIATE_PLACEMENT_SOURCE_MAX_ENTRIES) {
    throw new TypeError(
      `${path}.placements may contain at most ${CAD_IMMEDIATE_PLACEMENT_SOURCE_MAX_ENTRIES} entries.`,
    );
  }
  const placements = root.placements.map((entry, index) =>
    parsePlacementEntry(entry, `${path}.placements[${index}]`)
  );
  rejectDuplicates(
    placements.map((entry) => entry.usageElementId),
    `${path}.placements.usageElementId`,
  );
  placements.sort((left, right) =>
    left.usageElementId.localeCompare(right.usageElementId)
  );
  return deepFreeze({
    schemaVersion: CAD_IMMEDIATE_PLACEMENT_SOURCE_SCHEMA,
    unitSystem: CAD_PLACEMENT_UNIT_SYSTEM,
    placementConvention: CAD_PLACEMENT_CONVENTION,
    placements,
  });
}

/** Canonical JSON text of an already-validated source document. */
export function canonicalCadImmediatePlacementSourceText(
  source: CadImmediatePlacementSource,
): string {
  return deterministicJson(validateCadImmediatePlacementSource(source));
}

/** Parse, validate, canonicalize, and prove replay of one source document. */
export function canonicalizeCadImmediatePlacementSource(
  value: unknown,
  path = "$placementSource",
): {
  readonly source: CadImmediatePlacementSource;
  readonly text: string;
} {
  const source = validateCadImmediatePlacementSource(value, path);
  const text = deterministicJson(source);
  const roundtrip = validateCadImmediatePlacementSource(JSON.parse(text), path);
  const replay = deterministicJson(roundtrip);
  if (replay !== text) {
    throw new TypeError(`${path} is not canonical after exact replay.`);
  }
  return { source: roundtrip, text };
}

export async function fingerprintCadImmediatePlacementSource(
  source: CadImmediatePlacementSource,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(validateCadImmediatePlacementSource(source));
}

function parsePlacementEntry(
  value: unknown,
  path: string,
): CadImmediatePlacementEntry {
  rejectForbiddenKeys(value, FORBIDDEN_ENTRY_KEYS, path);
  const entry = exactRecord(value, PLACEMENT_ENTRY_KEYS, path);
  return {
    usageElementId: exactElementId(entry.usageElementId, `${path}.usageElementId`),
    partDefinitionElementId: exactElementId(
      entry.partDefinitionElementId,
      `${path}.partDefinitionElementId`,
    ),
    placement: parseTransform(entry.placement, `${path}.placement`),
  };
}

function parseTransform(value: unknown, path: string): CadPlacementTransform {
  const rec = exactRecord(value, PLACEMENT_VECTOR_KEYS, path);
  return {
    translationMm: parseVector3(rec.translationMm, `${path}.translationMm`),
    rotationDeg: parseVector3(rec.rotationDeg, `${path}.rotationDeg`),
  };
}

function parseVector3(
  value: unknown,
  path: string,
): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${path} must be an array of exactly three finite numbers.`);
  }
  return [
    finite(value[0], `${path}[0]`),
    finite(value[1], `${path}[1]`),
    finite(value[2], `${path}[2]`),
  ];
}

function exactElementId(value: unknown, path: string): string {
  const id = safeId(value, path);
  if (id.toLowerCase() === "latest") {
    throw new TypeError(`${path} cannot use a latest alias.`);
  }
  return id;
}

function rejectForbiddenKeys(
  value: unknown,
  keys: readonly string[],
  path: string,
): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  for (const key of keys) {
    if (Object.hasOwn(value, key)) {
      throw new TypeError(`${path} has unsupported field ${key}.`);
    }
  }
}
