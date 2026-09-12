/**
 * Closed `buy-configuration/1.0`.
 *
 * A configuration is sourced PartDefinition/occurrence identity with
 * quantity/UOM. The workspace component catalogue is declared, not a binding
 * proof. JSON that merely looks like a BOM is not this contract.
 */

import {
  arrayOf,
  closedRecord,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../kernel/case-validation.ts";
import { parseBuyDecimal } from "./buy-decimal.ts";
import { DESIGN_WRITE_GEOMETRY_TOOL } from "../cad/canonical/canonical-write-geometry-step.ts";
import { CANONICAL_STEP_MEDIA_TYPE } from "../cad/canonical/canonical-write-geometry-step.ts";

export const BUY_CONFIGURATION_SCHEMA = "buy-configuration/1.0" as const;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const THREAD_ARTIFACT_URI = /^thread-artifact:\/\/[A-Za-z0-9._:-]+\/[A-Za-z0-9._:-]+$/;

export const BUY_LINE_SOURCING = [
  "make",
  "buy",
  "documentary",
  "unresolved",
] as const;
export type BuyLineSourcing = typeof BUY_LINE_SOURCING[number];

export const BUY_CONFIGURATION_GAP_CODES = [
  "occurrence-unresolved",
  "item-mapping-unresolved",
  "quantity-unresolved",
  "uom-unresolved",
  "uom-incompatible",
  "part-definition-unresolved",
  "catalog-not-proof",
  "geometry-unresolved",
] as const;
export type BuyConfigurationGapCode = typeof BUY_CONFIGURATION_GAP_CODES[number];

export interface BuyEvidenceRef {
  readonly kind: "thread-artifact" | "agent-resource" | "workspace-file";
  readonly uri: string;
  readonly fingerprint: string;
}

export interface BuyConfigurationGap {
  readonly code: BuyConfigurationGapCode;
  readonly message: string;
  readonly lineId?: string;
}

export interface BuyOccurrence {
  readonly elementId: string;
  readonly quantity: string;
  readonly uom: string;
}

export interface BuyConfigurationLine {
  readonly id: string;
  readonly partDefinition: { readonly elementId: string };
  readonly occurrences: readonly BuyOccurrence[];
  readonly quantity: string;
  readonly uom: string;
  readonly sourcing: BuyLineSourcing;
  readonly item?: {
    readonly doctype: "Item";
    readonly name: string;
    readonly authority: "catalog-declared" | "source-attested";
  };
  readonly sources: readonly BuyEvidenceRef[];
  readonly gaps: readonly BuyConfigurationGap[];
}

export interface BuyConfigurationGeometry {
  readonly parentOperation: typeof DESIGN_WRITE_GEOMETRY_TOOL;
  readonly parentArtifactId: string;
  readonly parentFingerprint: string;
  readonly stepArtifactId: string;
  readonly stepFingerprint: string;
  readonly stepUri: string;
  readonly mediaType: typeof CANONICAL_STEP_MEDIA_TYPE;
}

export interface BuyConfigurationBasis {
  readonly snapshotId: string;
  readonly revision: number;
  readonly subjectId: string;
}

export interface BuyConfiguration {
  readonly schemaVersion: typeof BUY_CONFIGURATION_SCHEMA;
  readonly projectId: string;
  readonly subjectId: string;
  readonly configurationRevision: number;
  readonly basis: BuyConfigurationBasis;
  readonly geometry: BuyConfigurationGeometry;
  readonly lines: readonly BuyConfigurationLine[];
  readonly sources: readonly BuyEvidenceRef[];
  readonly gaps: readonly BuyConfigurationGap[];
}

const ROOT_KEYS = [
  "schemaVersion",
  "projectId",
  "subjectId",
  "configurationRevision",
  "basis",
  "geometry",
  "lines",
  "sources",
  "gaps",
] as const;

export function validateBuyConfiguration(value: unknown): BuyConfiguration {
  const root = exactRecord(value, ROOT_KEYS, "$buyConfiguration");
  literalValue(
    root.schemaVersion,
    BUY_CONFIGURATION_SCHEMA,
    "$buyConfiguration.schemaVersion",
  );
  const projectId = safeId(root.projectId, "$buyConfiguration.projectId");
  const subjectId = safeId(root.subjectId, "$buyConfiguration.subjectId");
  const configurationRevision = positiveInteger(
    root.configurationRevision,
    "$buyConfiguration.configurationRevision",
  );
  const basis = parseBasis(root.basis);
  if (basis.subjectId !== subjectId) {
    throw new TypeError(
      "$buyConfiguration.basis.subjectId must match subjectId.",
    );
  }
  const geometry = parseGeometry(root.geometry);
  const lines = arrayOf(root.lines, "$buyConfiguration.lines").map((line, i) =>
    parseLine(line, `$buyConfiguration.lines[${i}]`)
  );
  rejectDuplicates(
    lines.map((line) => line.id),
    "$buyConfiguration.lines.id",
  );
  const sources = arrayOf(root.sources, "$buyConfiguration.sources").map(
    (source, i) => parseEvidenceRef(source, `$buyConfiguration.sources[${i}]`),
  );
  const gaps = arrayOf(root.gaps, "$buyConfiguration.gaps").map((gap, i) =>
    parseGap(gap, `$buyConfiguration.gaps[${i}]`)
  );
  return deepFreeze({
    schemaVersion: BUY_CONFIGURATION_SCHEMA,
    projectId,
    subjectId,
    configurationRevision,
    basis,
    geometry,
    lines,
    sources,
    gaps,
  });
}

export function parseBuyTargetArtifactUri(
  artifactUri: string,
): { readonly projectId: string; readonly artifactId: string } {
  if (!THREAD_ARTIFACT_URI.test(artifactUri)) {
    throw new TypeError(
      "Buy STEP URI must be thread-artifact://<project-id>/<artifact-id>.",
    );
  }
  const rest = artifactUri.slice("thread-artifact://".length);
  const slash = rest.indexOf("/");
  return {
    projectId: rest.slice(0, slash),
    artifactId: rest.slice(slash + 1),
  };
}

function parseBasis(value: unknown): BuyConfigurationBasis {
  const input = exactRecord(
    value,
    ["snapshotId", "revision", "subjectId"],
    "$buyConfiguration.basis",
  );
  const snapshotId = safeId(input.snapshotId, "$buyConfiguration.basis.snapshotId");
  if (snapshotId.toLowerCase() === "latest") {
    throw new TypeError("$buyConfiguration.basis.snapshotId must not be latest.");
  }
  return {
    snapshotId,
    revision: positiveInteger(input.revision, "$buyConfiguration.basis.revision"),
    subjectId: safeId(input.subjectId, "$buyConfiguration.basis.subjectId"),
  };
}

function parseGeometry(value: unknown): BuyConfigurationGeometry {
  const input = exactRecord(value, [
    "parentOperation",
    "parentArtifactId",
    "parentFingerprint",
    "stepArtifactId",
    "stepFingerprint",
    "stepUri",
    "mediaType",
  ], "$buyConfiguration.geometry");
  literalValue(
    input.parentOperation,
    DESIGN_WRITE_GEOMETRY_TOOL,
    "$buyConfiguration.geometry.parentOperation",
  );
  literalValue(
    input.mediaType,
    CANONICAL_STEP_MEDIA_TYPE,
    "$buyConfiguration.geometry.mediaType",
  );
  const stepUri = nonEmptyText(input.stepUri, "$buyConfiguration.geometry.stepUri");
  parseBuyTargetArtifactUri(stepUri);
  return {
    parentOperation: DESIGN_WRITE_GEOMETRY_TOOL,
    parentArtifactId: safeId(
      input.parentArtifactId,
      "$buyConfiguration.geometry.parentArtifactId",
    ),
    parentFingerprint: sha256(
      input.parentFingerprint,
      "$buyConfiguration.geometry.parentFingerprint",
    ),
    stepArtifactId: safeId(
      input.stepArtifactId,
      "$buyConfiguration.geometry.stepArtifactId",
    ),
    stepFingerprint: sha256(
      input.stepFingerprint,
      "$buyConfiguration.geometry.stepFingerprint",
    ),
    stepUri,
    mediaType: CANONICAL_STEP_MEDIA_TYPE,
  };
}

function parseLine(value: unknown, path: string): BuyConfigurationLine {
  const input = closedRecord(value, [
    "id",
    "partDefinition",
    "occurrences",
    "quantity",
    "uom",
    "sourcing",
    "item",
    "sources",
    "gaps",
  ], [
    "id",
    "partDefinition",
    "occurrences",
    "quantity",
    "uom",
    "sourcing",
    "sources",
    "gaps",
  ], path);
  const partDefinition = exactRecord(
    input.partDefinition,
    ["elementId"],
    `${path}.partDefinition`,
  );
  const occurrences = arrayOf(input.occurrences, `${path}.occurrences`).map(
    (occurrence, i) => parseOccurrence(occurrence, `${path}.occurrences[${i}]`),
  );
  const sourcing = oneOf(
    input.sourcing,
    BUY_LINE_SOURCING,
    `${path}.sourcing`,
  );
  const quantity = parseBuyDecimal(input.quantity, `${path}.quantity`);
  const uom = uomToken(input.uom, `${path}.uom`);
  const gaps = arrayOf(input.gaps, `${path}.gaps`).map((gap, i) =>
    parseGap(gap, `${path}.gaps[${i}]`)
  );
  if (
    occurrences.length === 0 &&
    !gaps.some((gap) => gap.code === "occurrence-unresolved")
  ) {
    throw new TypeError(
      `${path}.occurrences must name at least one occurrence or record occurrence-unresolved.`,
    );
  }
  const item = input.item === undefined || input.item === null
    ? undefined
    : parseItem(input.item, `${path}.item`);
  if (
    item === undefined && sourcing === "buy" &&
    !gaps.some((gap) => gap.code === "item-mapping-unresolved")
  ) {
    throw new TypeError(
      `${path}.item is required for buy sourcing unless item-mapping-unresolved is recorded.`,
    );
  }
  return {
    id: safeId(input.id, `${path}.id`),
    partDefinition: {
      elementId: safeId(partDefinition.elementId, `${path}.partDefinition.elementId`),
    },
    occurrences,
    quantity,
    uom,
    sourcing,
    ...(item ? { item } : {}),
    sources: arrayOf(input.sources, `${path}.sources`).map((source, i) =>
      parseEvidenceRef(source, `${path}.sources[${i}]`)
    ),
    gaps,
  };
}

function parseOccurrence(value: unknown, path: string): BuyOccurrence {
  const input = exactRecord(value, ["elementId", "quantity", "uom"], path);
  return {
    elementId: safeId(input.elementId, `${path}.elementId`),
    quantity: parseBuyDecimal(input.quantity, `${path}.quantity`),
    uom: uomToken(input.uom, `${path}.uom`),
  };
}

function parseItem(
  value: unknown,
  path: string,
): NonNullable<BuyConfigurationLine["item"]> {
  const input = exactRecord(value, ["doctype", "name", "authority"], path);
  literalValue(input.doctype, "Item", `${path}.doctype`);
  const authority = oneOf(
    input.authority,
    ["catalog-declared", "source-attested"] as const,
    `${path}.authority`,
  );
  return {
    doctype: "Item",
    name: nonEmptyText(input.name, `${path}.name`),
    authority,
  };
}

function parseEvidenceRef(value: unknown, path: string): BuyEvidenceRef {
  const input = exactRecord(value, ["kind", "uri", "fingerprint"], path);
  const kind = oneOf(
    input.kind,
    ["thread-artifact", "agent-resource", "workspace-file"] as const,
    `${path}.kind`,
  );
  return {
    kind,
    uri: nonEmptyText(input.uri, `${path}.uri`),
    fingerprint: sha256(input.fingerprint, `${path}.fingerprint`),
  };
}

function parseGap(value: unknown, path: string): BuyConfigurationGap {
  const input = closedRecord(
    value,
    ["code", "message", "lineId"],
    ["code", "message"],
    path,
  );
  const code = oneOf(input.code, BUY_CONFIGURATION_GAP_CODES, `${path}.code`);
  const message = nonEmptyText(input.message, `${path}.message`);
  if (input.lineId === undefined || input.lineId === null) {
    return { code, message };
  }
  return {
    code,
    message,
    lineId: safeId(input.lineId, `${path}.lineId`),
  };
}

function uomToken(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (text.toLowerCase() === "latest") {
    throw new TypeError(`${path} must not be a latest alias.`);
  }
  return text;
}

function sha256(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!SHA256_HEX.test(text)) {
    throw new TypeError(`${path} must be a lowercase 64-character hex SHA-256 digest.`);
  }
  return text;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new TypeError(`${path} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}
