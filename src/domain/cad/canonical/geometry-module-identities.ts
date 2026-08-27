/**
 * Shared value objects for bounded CAD module evidence.
 *
 * One exact composite PartDefinition and only its immediate children. The
 * child table names each usage, target, placement, canonical child capture
 * and the authoritative STEP reopened for this build. It never copies
 * descendant manifests or source text.
 */

import {
  GEOMETRY_MODULE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_CHILD_CAPTURE_SCHEMAS,
  GEOMETRY_MODULE_CHILD_STEP_MEDIA_TYPE,
  GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
  type GeometryModuleChildCaptureSchema,
} from "../geometry-module-contract.ts";
import type { GeometryModuleInputBundleManifest } from "../module-assembly/geometry-module-input-bundle.ts";
import { validateGeometryModuleInputBundleManifest } from "../module-assembly/geometry-module-input-bundle.ts";
import {
  type CadPlacementAnalysisCaptureLocator,
  cadPlacementAnalysisCaptureLocatorsEqual,
  validateCadPlacementAnalysisCaptureLocator,
} from "../placement/cad-placement-analysis-capture.ts";
import {
  arrayOf,
  exactRecord,
  finite,
  literalValue,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  GEOMETRY_PART_CAPTURE_SCHEMA,
  type GeometryTargetPredecessor,
} from "../geometry-capture-contract.ts";
import {
  type ProjectSourceClosureLocator,
  projectSourceClosureLocatorsEqual,
  validateProjectSourceClosureLocator,
} from "../../project-source-workspace/closure.ts";

export const GEOMETRY_MODULE_MANIFEST_SCHEMA = "geometry-module-manifest/1.0" as const;
export const GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA =
  "geometry-module-draft-capture/1.0" as const;
export const GEOMETRY_MODULE_DRAFT_KIND = "geometry-module-draft" as const;
export const GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA =
  "part-definitions-capture/1.0" as const;
export const GEOMETRY_MODULE_STRUCTURE_CAPTURE_URI_PREFIX =
  "casys://part-definitions-capture/sha256/" as const;
export const GEOMETRY_MODULE_ARCHITECTURE_CAPTURE_URI_PREFIX =
  "casys://architecture-capture/sha256/" as const;

export type { CadPlacementAnalysisCaptureLocator, GeometryModuleChildCaptureSchema };

export interface GeometryModuleArchitectureBasis {
  readonly snapshotId: string;
  readonly revision: number;
  readonly artifactFingerprint: ContentFingerprint;
}

export interface GeometryModuleStructureCapture {
  readonly schemaVersion: typeof GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA;
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
  readonly byteCount: number;
  readonly architecture: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
    readonly uri: string;
  };
}

export interface GeometryModuleTarget {
  readonly partDefinitionElementId: string;
  readonly label: string;
}

export interface GeometryModulePlacement {
  readonly translationMm: readonly [number, number, number];
  readonly rotationDeg: readonly [number, number, number];
}

export interface GeometryModuleChildGeometry {
  readonly schemaVersion: GeometryModuleChildCaptureSchema;
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
}

export interface GeometryModuleAssetIdentity {
  readonly fingerprint: ContentFingerprint;
  readonly bytes: number;
}

export interface GeometryModuleChild {
  readonly usageElementId: string;
  readonly partDefinitionElementId: string;
  readonly placement: GeometryModulePlacement;
  readonly placementCapture: ContentFingerprint;
  readonly childGeometry: GeometryModuleChildGeometry;
  readonly authoritativeStep: GeometryModuleAssetIdentity;
}

export type GeometryModulePredecessor = GeometryTargetPredecessor;

/**
 * Persisted input-bundle identity for draft, manifest and capture.
 *
 * Exact child STEP bytes must be reopened or rebuilt before a canonical
 * seal. This identity is not a proof of those bytes.
 */
export interface GeometryModuleInputBundleIdentity {
  readonly schemaVersion: typeof GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA;
  readonly fingerprint: ContentFingerprint;
  readonly byteCount: number;
  readonly manifest: GeometryModuleInputBundleManifest;
}

export type GeometryModuleEvidenceErrorCode =
  | "invalid_schema"
  | "missing_parameter"
  | "invalid_fingerprint"
  | "invalid_format"
  | "invalid_identity"
  | "unexpected_parameter"
  | "manifest_incomplete"
  | "unavailable"
  | "unresolved";

export class GeometryModuleEvidenceError extends Error {
  constructor(
    readonly code: GeometryModuleEvidenceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GeometryModuleEvidenceError";
  }
}

export function parseArchitectureBasis(
  value: unknown,
  path: string,
): GeometryModuleArchitectureBasis {
  const basis = exactRecord(
    value,
    ["snapshotId", "revision", "artifactFingerprint"],
    path,
  );
  return {
    snapshotId: safeId(basis.snapshotId, `${path}.snapshotId`),
    revision: positiveInteger(basis.revision, `${path}.revision`),
    artifactFingerprint: parseFingerprint(
      basis.artifactFingerprint,
      `${path}.artifactFingerprint`,
    ),
  };
}

export function parseStructureCapture(
  value: unknown,
  path: string,
): GeometryModuleStructureCapture {
  const capture = exactRecord(
    value,
    [
      "schemaVersion",
      "artifactId",
      "fingerprint",
      "uri",
      "byteCount",
      "architecture",
    ],
    path,
  );
  literalValue(
    capture.schemaVersion,
    GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const fingerprint = parseFingerprint(capture.fingerprint, `${path}.fingerprint`);
  const artifactId = safeId(capture.artifactId, `${path}.artifactId`);
  if (artifactId !== `part-definitions-${fingerprint.digest}`) {
    invalid(
      "invalid_identity",
      `${path}.artifactId must be part-definitions-<digest>.`,
    );
  }
  const uri = nonEmptyText(capture.uri, `${path}.uri`);
  if (uri !== `${GEOMETRY_MODULE_STRUCTURE_CAPTURE_URI_PREFIX}${fingerprint.digest}`) {
    invalid(
      "invalid_identity",
      `${path}.uri must be the exact part-definitions capture CAS URI.`,
    );
  }
  const architectureRecord = exactRecord(
    capture.architecture,
    ["artifactId", "fingerprint", "uri"],
    `${path}.architecture`,
  );
  const architectureFingerprint = parseFingerprint(
    architectureRecord.fingerprint,
    `${path}.architecture.fingerprint`,
  );
  const architectureArtifactId = safeId(
    architectureRecord.artifactId,
    `${path}.architecture.artifactId`,
  );
  if (architectureArtifactId !== `architecture-${architectureFingerprint.digest}`) {
    invalid(
      "invalid_identity",
      `${path}.architecture.artifactId must be architecture-<digest>.`,
    );
  }
  const architectureUri = nonEmptyText(
    architectureRecord.uri,
    `${path}.architecture.uri`,
  );
  if (
    architectureUri !==
      `${GEOMETRY_MODULE_ARCHITECTURE_CAPTURE_URI_PREFIX}${architectureFingerprint.digest}`
  ) {
    invalid(
      "invalid_identity",
      `${path}.architecture.uri must be the exact architecture capture CAS URI.`,
    );
  }
  return {
    schemaVersion: GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
    artifactId,
    fingerprint,
    uri,
    byteCount: positiveInteger(capture.byteCount, `${path}.byteCount`),
    architecture: {
      artifactId: architectureArtifactId,
      fingerprint: architectureFingerprint,
      uri: architectureUri,
    },
  };
}

export function recrossStructureCaptureArchitecture(
  structureCapture: GeometryModuleStructureCapture,
  architectureBasis: GeometryModuleArchitectureBasis,
): void {
  if (
    !fingerprintsEqual(
      structureCapture.architecture.fingerprint,
      architectureBasis.artifactFingerprint,
    )
  ) {
    invalid(
      "unresolved",
      "The structure capture architecture must equal the exact Thread architecture basis.",
    );
  }
}

export function parseTarget(value: unknown, path: string): GeometryModuleTarget {
  const target = exactRecord(value, ["partDefinitionElementId", "label"], path);
  return {
    partDefinitionElementId: nonEmptyText(
      target.partDefinitionElementId,
      `${path}.partDefinitionElementId`,
    ),
    label: nonEmptyText(target.label, `${path}.label`),
  };
}

export function parsePredecessor(
  value: unknown,
  targetId: string,
  path: string,
): GeometryModulePredecessor {
  const predecessor = exactRecord(
    value,
    ["schemaVersion", "artifactId", "fingerprint", "partDefinitionElementId"],
    path,
  );
  const schemaVersion = predecessor.schemaVersion;
  if (
    schemaVersion !== GEOMETRY_PART_CAPTURE_SCHEMA &&
    schemaVersion !== GEOMETRY_MODULE_CAPTURE_SCHEMA
  ) {
    invalid(
      "invalid_schema",
      `${path}.schemaVersion must name a canonical target geometry capture family.`,
    );
  }
  const partDefinitionElementId = nonEmptyText(
    predecessor.partDefinitionElementId,
    `${path}.partDefinitionElementId`,
  );
  if (partDefinitionElementId !== targetId) {
    invalid(
      "unresolved",
      `${path} must name the exact module PartDefinition target.`,
    );
  }
  return {
    schemaVersion,
    artifactId: safeId(predecessor.artifactId, `${path}.artifactId`),
    fingerprint: parseFingerprint(predecessor.fingerprint, `${path}.fingerprint`),
    partDefinitionElementId,
  };
}

export function parsePlacementAnalysis(
  value: unknown,
  path: string,
): CadPlacementAnalysisCaptureLocator {
  if (value === undefined) {
    invalid(
      "unavailable",
      `${path} is required for every geometry module.`,
    );
  }
  return validateCadPlacementAnalysisCaptureLocator(value, path);
}

export function parseOptionalSourceClosure(
  value: unknown,
  path: string,
): ProjectSourceClosureLocator | undefined {
  if (value === undefined) return undefined;
  return validateProjectSourceClosureLocator(value, path);
}

export function parseChildren(value: unknown, path: string): GeometryModuleChild[] {
  const rows = arrayOf(value, path);
  if (rows.length === 0) {
    invalid(
      "invalid_identity",
      `${path} must name at least one immediate child.`,
    );
  }
  const children = rows.map((candidate, index) =>
    parseChild(candidate, `${path}[${index}]`)
  );
  for (let index = 1; index < children.length; index++) {
    if (children[index]!.usageElementId <= children[index - 1]!.usageElementId) {
      invalid(
        "invalid_identity",
        `${path} must be ordered by exact usage identity.`,
      );
    }
  }
  rejectDuplicates(children.map((child) => child.usageElementId), path);
  return children;
}

export function recrossChildPlacementCaptures(
  children: ReadonlyArray<GeometryModuleChild>,
  placementAnalysis: CadPlacementAnalysisCaptureLocator,
): void {
  for (const [index, child] of children.entries()) {
    if (!fingerprintsEqual(child.placementCapture, placementAnalysis.fingerprint)) {
      invalid(
        "unresolved",
        `children[${index}].placementCapture must equal the module placement analysis.`,
      );
    }
  }
}

export function parseInputBundleIdentity(
  value: unknown,
  children: ReadonlyArray<GeometryModuleChild>,
  path: string,
): GeometryModuleInputBundleIdentity {
  const bundle = exactRecord(
    value,
    ["schemaVersion", "fingerprint", "byteCount", "manifest"],
    path,
  );
  literalValue(
    bundle.schemaVersion,
    GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const identity = {
    schemaVersion: GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
    fingerprint: parseFingerprint(bundle.fingerprint, `${path}.fingerprint`),
    byteCount: positiveInteger(bundle.byteCount, `${path}.byteCount`),
    manifest: parseInputBundleManifest(bundle.manifest, `${path}.manifest`),
  };
  recrossGeometryModuleInputBundleToChildren(
    identity.manifest,
    children,
    `${path}.manifest`,
  );
  return identity;
}

/**
 * Recross every sorted runtime occurrence against the evidence child table.
 * Receipt or bundle A cannot be paired with child table B.
 */
export function recrossGeometryModuleInputBundleToChildren(
  manifest: GeometryModuleInputBundleManifest,
  children: ReadonlyArray<GeometryModuleChild>,
  path: string,
): void {
  if (manifest.occurrences.length !== children.length) {
    invalid(
      "unresolved",
      `${path}.occurrences must have the same dense count and order as the child table.`,
    );
  }
  for (const [index, occurrence] of manifest.occurrences.entries()) {
    const child = children[index]!;
    const occurrencePath = `${path}.occurrences[${index}]`;
    if (occurrence.usageElementId !== child.usageElementId) {
      invalid(
        "unresolved",
        `${occurrencePath}.usageElementId must equal children[${index}].usageElementId.`,
      );
    }
    if (occurrence.partDefinitionElementId !== child.partDefinitionElementId) {
      invalid(
        "unresolved",
        `${occurrencePath}.partDefinitionElementId must equal children[${index}].partDefinitionElementId.`,
      );
    }
    if (
      !sameTriple(occurrence.placement.translationMm, child.placement.translationMm) ||
      !sameTriple(occurrence.placement.rotationDeg, child.placement.rotationDeg)
    ) {
      invalid(
        "unresolved",
        `${occurrencePath}.placement must equal children[${index}].placement.`,
      );
    }
    if (
      occurrence.childCapture.schemaVersion !== child.childGeometry.schemaVersion ||
      occurrence.childCapture.artifactId !== child.childGeometry.artifactId ||
      !fingerprintsEqual(
        occurrence.childCapture.fingerprint,
        child.childGeometry.fingerprint,
      )
    ) {
      invalid(
        "unresolved",
        `${occurrencePath}.childCapture must equal children[${index}].childGeometry.`,
      );
    }
    if (occurrence.step.mediaType !== GEOMETRY_MODULE_CHILD_STEP_MEDIA_TYPE) {
      invalid(
        "unresolved",
        `${occurrencePath}.step.mediaType must be ${GEOMETRY_MODULE_CHILD_STEP_MEDIA_TYPE}.`,
      );
    }
    if (occurrence.step.sha256 !== child.authoritativeStep.fingerprint.digest) {
      invalid(
        "unresolved",
        `${occurrencePath}.step.sha256 must equal children[${index}].authoritativeStep digest.`,
      );
    }
    if (occurrence.step.byteCount !== child.authoritativeStep.bytes) {
      invalid(
        "unresolved",
        `${occurrencePath}.step.byteCount must equal children[${index}].authoritativeStep bytes.`,
      );
    }
  }
}

/**
 * Compare a reopened runtime bundle to the persisted draft identity.
 *
 * Exact child STEP bytes must still be reopened or rebuilt before a
 * canonical seal. Matching this identity is not a proof of those bytes.
 */
export function geometryModuleInputBundleMatchesIdentity(
  bundle: {
    readonly fingerprint: ContentFingerprint;
    readonly bytes: { readonly byteLength: number };
    readonly manifest: GeometryModuleInputBundleManifest;
  },
  identity: GeometryModuleInputBundleIdentity,
): boolean {
  return fingerprintsEqual(bundle.fingerprint, identity.fingerprint) &&
    bundle.bytes.byteLength === identity.byteCount &&
    sameInputBundleManifest(bundle.manifest, identity.manifest);
}

export function assertGeometryModuleInputBundleMatchesIdentity(
  bundle: {
    readonly fingerprint: ContentFingerprint;
    readonly bytes: { readonly byteLength: number };
    readonly manifest: GeometryModuleInputBundleManifest;
  },
  identity: GeometryModuleInputBundleIdentity,
  path: string,
): void {
  if (!geometryModuleInputBundleMatchesIdentity(bundle, identity)) {
    invalid(
      "unresolved",
      `${path} does not match the persisted input-bundle identity.`,
    );
  }
}

export function parseAssetIdentity(
  value: unknown,
  path: string,
): GeometryModuleAssetIdentity {
  const asset = exactRecord(value, ["fingerprint", "bytes"], path);
  return {
    fingerprint: parseAssetFingerprint(asset.fingerprint, `${path}.fingerprint`),
    bytes: positiveInteger(asset.bytes, `${path}.bytes`),
  };
}

export function parseSignedAssetFingerprint(
  value: unknown,
  path: string,
): ContentFingerprint {
  return parseAssetFingerprint(value, path);
}

export function sameChildren(
  left: ReadonlyArray<GeometryModuleChild>,
  right: ReadonlyArray<GeometryModuleChild>,
): boolean {
  if (left.length !== right.length) return false;
  return left.every((child, index) => {
    const other = right[index]!;
    return child.usageElementId === other.usageElementId &&
      child.partDefinitionElementId === other.partDefinitionElementId &&
      sameTriple(child.placement.translationMm, other.placement.translationMm) &&
      sameTriple(child.placement.rotationDeg, other.placement.rotationDeg) &&
      fingerprintsEqual(child.placementCapture, other.placementCapture) &&
      child.childGeometry.schemaVersion === other.childGeometry.schemaVersion &&
      child.childGeometry.artifactId === other.childGeometry.artifactId &&
      fingerprintsEqual(
        child.childGeometry.fingerprint,
        other.childGeometry.fingerprint,
      ) &&
      fingerprintsEqual(
        child.authoritativeStep.fingerprint,
        other.authoritativeStep.fingerprint,
      ) &&
      child.authoritativeStep.bytes === other.authoritativeStep.bytes;
  });
}

export function sameOptionalPredecessor(
  left: GeometryModulePredecessor | undefined,
  right: GeometryModulePredecessor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.schemaVersion === right.schemaVersion &&
    left.artifactId === right.artifactId &&
    left.partDefinitionElementId === right.partDefinitionElementId &&
    fingerprintsEqual(left.fingerprint, right.fingerprint);
}

export function sameOptionalSourceClosure(
  left: ProjectSourceClosureLocator | undefined,
  right: ProjectSourceClosureLocator | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return projectSourceClosureLocatorsEqual(left, right);
}

export function samePlacementAnalysis(
  left: CadPlacementAnalysisCaptureLocator,
  right: CadPlacementAnalysisCaptureLocator,
): boolean {
  return cadPlacementAnalysisCaptureLocatorsEqual(left, right);
}

export function sameInputBundle(
  left: GeometryModuleInputBundleIdentity,
  right: GeometryModuleInputBundleIdentity,
): boolean {
  return left.schemaVersion === right.schemaVersion &&
    fingerprintsEqual(left.fingerprint, right.fingerprint) &&
    left.byteCount === right.byteCount &&
    sameInputBundleManifest(left.manifest, right.manifest);
}

export function sameStructureCapture(
  left: GeometryModuleStructureCapture,
  right: GeometryModuleStructureCapture,
): boolean {
  return left.schemaVersion === right.schemaVersion &&
    left.artifactId === right.artifactId &&
    fingerprintsEqual(left.fingerprint, right.fingerprint) &&
    left.uri === right.uri &&
    left.byteCount === right.byteCount &&
    left.architecture.artifactId === right.architecture.artifactId &&
    fingerprintsEqual(
      left.architecture.fingerprint,
      right.architecture.fingerprint,
    ) &&
    left.architecture.uri === right.architecture.uri;
}

export function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  return { algorithm: "sha256", digest: digest(fingerprint.digest, `${path}.digest`) };
}

export function digest(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    invalid("invalid_fingerprint", `${path} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

export function isoDateTime(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (Number.isNaN(Date.parse(text))) {
    invalid("invalid_format", `${path} must be an ISO-8601 timestamp.`);
  }
  return text;
}

export function unsignedDraftRecord(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  if (!Object.hasOwn(value, "fingerprint")) return value;
  const { fingerprint: _fingerprint, ...rest } = value as Record<string, unknown>;
  return rest;
}

export function invalid(
  code: GeometryModuleEvidenceErrorCode,
  message: string,
): never {
  throw new GeometryModuleEvidenceError(code, message);
}

function parseInputBundleManifest(
  value: unknown,
  path: string,
): GeometryModuleInputBundleManifest {
  try {
    return validateGeometryModuleInputBundleManifest(value, path);
  } catch (error) {
    invalid(
      "invalid_schema",
      error instanceof Error ? error.message : `${path} is invalid.`,
    );
  }
}

function sameInputBundleManifest(
  left: GeometryModuleInputBundleManifest,
  right: GeometryModuleInputBundleManifest,
): boolean {
  return deterministicJson(left) === deterministicJson(right);
}

function parseChild(value: unknown, path: string): GeometryModuleChild {
  const child = exactRecord(value, [
    "usageElementId",
    "partDefinitionElementId",
    "placement",
    "placementCapture",
    "childGeometry",
    "authoritativeStep",
  ], path);
  return {
    usageElementId: safeId(child.usageElementId, `${path}.usageElementId`),
    partDefinitionElementId: nonEmptyText(
      child.partDefinitionElementId,
      `${path}.partDefinitionElementId`,
    ),
    placement: parsePlacement(child.placement, `${path}.placement`),
    placementCapture: parseFingerprint(
      child.placementCapture,
      `${path}.placementCapture`,
    ),
    childGeometry: parseChildGeometry(child.childGeometry, `${path}.childGeometry`),
    authoritativeStep: parseAssetIdentity(
      child.authoritativeStep,
      `${path}.authoritativeStep`,
    ),
  };
}

function parsePlacement(value: unknown, path: string): GeometryModulePlacement {
  const placement = exactRecord(value, ["translationMm", "rotationDeg"], path);
  return {
    translationMm: triple(placement.translationMm, `${path}.translationMm`),
    rotationDeg: triple(placement.rotationDeg, `${path}.rotationDeg`),
  };
}

function parseChildGeometry(value: unknown, path: string): GeometryModuleChildGeometry {
  const geometry = exactRecord(
    value,
    ["schemaVersion", "artifactId", "fingerprint"],
    path,
  );
  return {
    schemaVersion: parseChildCaptureSchema(
      geometry.schemaVersion,
      `${path}.schemaVersion`,
    ),
    artifactId: safeId(geometry.artifactId, `${path}.artifactId`),
    fingerprint: parseFingerprint(geometry.fingerprint, `${path}.fingerprint`),
  };
}

function parseChildCaptureSchema(
  value: unknown,
  path: string,
): GeometryModuleChildCaptureSchema {
  if (
    value !== GEOMETRY_MODULE_CHILD_CAPTURE_SCHEMAS[0] &&
    value !== GEOMETRY_MODULE_CHILD_CAPTURE_SCHEMAS[1]
  ) {
    invalid(
      "invalid_schema",
      `${path} must be geometry-part-capture/1.0 or geometry-module-capture/1.0.`,
    );
  }
  return value;
}

function parseAssetFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = parseFingerprint(value, path);
  if (
    fingerprint.digest ===
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  ) {
    invalid("invalid_fingerprint", `${path} cannot attest an empty geometry asset.`);
  }
  return fingerprint;
}

function triple(value: unknown, path: string): readonly [number, number, number] {
  const values = arrayOf(value, path);
  if (values.length !== 3) {
    invalid("invalid_format", `${path} must contain exactly three finite numbers.`);
  }
  return [
    finite(values[0], `${path}[0]`),
    finite(values[1], `${path}[1]`),
    finite(values[2], `${path}[2]`),
  ];
}

function sameTriple(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): boolean {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}
