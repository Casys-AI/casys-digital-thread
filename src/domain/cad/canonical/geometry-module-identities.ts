/**
 * Shared value objects for bounded CAD module evidence.
 *
 * One exact composite PartDefinition and only its immediate children. The
 * child table names each usage, target, placement, canonical child capture
 * and the authoritative STEP reopened for this build. It never copies
 * descendant manifests or source text.
 */

import { GEOMETRY_BUNDLE_PLACEMENT_CONVENTION } from "./geometry-bundle.ts";
import { GEOMETRY_PART_CAPTURE_SCHEMA } from "./geometry-part-manifest.ts";
import {
  arrayOf,
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";
import { fingerprintsEqual } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  type ProjectSourceClosureLocator,
  validateProjectSourceClosureLocator,
} from "../../project-source-workspace/closure.ts";

export const GEOMETRY_MODULE_MANIFEST_SCHEMA = "geometry-module-manifest/1.0" as const;
export const GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA =
  "geometry-module-draft-capture/1.0" as const;
export const GEOMETRY_MODULE_CAPTURE_SCHEMA = "geometry-module-capture/1.0" as const;
export const GEOMETRY_MODULE_DRAFT_KIND = "geometry-module-draft" as const;
export const GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA =
  "part-definitions-capture/1.0" as const;
export const GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA =
  "geometry-module-input-bundle/1.0" as const;
export const CAD_PLACEMENT_ANALYSIS_CAPTURE_SCHEMA =
  "cad-placement-analysis-capture/1.0" as const;
export const CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA =
  "cad-placement-analysis-capture-locator/1.0" as const;
export const CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND =
  "cad-placement-analysis-capture-locator" as const;
export const CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX =
  "casys://cad-placement-analysis-capture/sha256/" as const;
export const CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PATTERN =
  /^casys:\/\/cad-placement-analysis-capture\/sha256\/[a-f0-9]{64}$/;
export const GEOMETRY_MODULE_PLACEMENT_CONVENTION =
  GEOMETRY_BUNDLE_PLACEMENT_CONVENTION;
export const GEOMETRY_MODULE_CHILD_CAPTURE_SCHEMAS = [
  GEOMETRY_PART_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_CAPTURE_SCHEMA,
] as const;
export const GEOMETRY_MODULE_EXPORT_FORMATS = ["step", "glb"] as const;

export type GeometryModuleExportFormat =
  (typeof GEOMETRY_MODULE_EXPORT_FORMATS)[number];
export type GeometryModuleChildCaptureSchema =
  (typeof GEOMETRY_MODULE_CHILD_CAPTURE_SCHEMAS)[number];

export interface GeometryModuleArchitectureBasis {
  readonly snapshotId: string;
  readonly revision: number;
  readonly artifactFingerprint: ContentFingerprint;
}

export interface GeometryModuleStructureCapture {
  readonly schemaVersion: typeof GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA;
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
}

export interface GeometryModuleTarget {
  readonly partDefinitionElementId: string;
  readonly label: string;
}

export interface GeometryModulePlacement {
  readonly translationMm: readonly [number, number, number];
  readonly rotationDeg: readonly [number, number, number];
}

export interface CadPlacementAnalysisCaptureLocator {
  readonly schemaVersion: typeof CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA;
  readonly kind: typeof CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND;
  readonly fingerprint: ContentFingerprint;
  readonly byteCount: number;
  readonly casUri: string;
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

export interface GeometryModulePredecessor {
  readonly schemaVersion: typeof GEOMETRY_MODULE_CAPTURE_SCHEMA;
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly partDefinitionElementId: string;
}

export interface GeometryModuleInputBundleIdentity {
  readonly schemaVersion: typeof GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA;
  readonly fingerprint: ContentFingerprint;
  readonly byteCount: number;
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
    ["schemaVersion", "artifactId", "fingerprint"],
    path,
  );
  literalValue(
    capture.schemaVersion,
    GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  return {
    schemaVersion: GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
    artifactId: safeId(capture.artifactId, `${path}.artifactId`),
    fingerprint: parseFingerprint(capture.fingerprint, `${path}.fingerprint`),
  };
}

export function parseTarget(value: unknown, path: string): GeometryModuleTarget {
  const target = exactRecord(value, ["partDefinitionElementId", "label"], path);
  return {
    partDefinitionElementId: safeId(
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
  literalValue(
    predecessor.schemaVersion,
    GEOMETRY_MODULE_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const partDefinitionElementId = safeId(
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
    schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
    artifactId: safeId(predecessor.artifactId, `${path}.artifactId`),
    fingerprint: parseFingerprint(predecessor.fingerprint, `${path}.fingerprint`),
    partDefinitionElementId,
  };
}

export function parseOptionalPlacementAnalysis(
  value: unknown,
  children: ReadonlyArray<GeometryModuleChild>,
  path: string,
): CadPlacementAnalysisCaptureLocator | undefined {
  if (value === undefined) {
    if (children.length > 0) {
      invalid(
        "unavailable",
        `${path} is required when the module has immediate children.`,
      );
    }
    return undefined;
  }
  if (children.length === 0) {
    invalid(
      "invalid_identity",
      `${path} must be absent when the module has no immediate children.`,
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
  placementAnalysis: CadPlacementAnalysisCaptureLocator | undefined,
): void {
  if (placementAnalysis === undefined) return;
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
  path: string,
): GeometryModuleInputBundleIdentity {
  const bundle = exactRecord(
    value,
    ["schemaVersion", "fingerprint", "byteCount"],
    path,
  );
  literalValue(
    bundle.schemaVersion,
    GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
    `${path}.schemaVersion`,
  );
  return {
    schemaVersion: GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
    fingerprint: parseFingerprint(bundle.fingerprint, `${path}.fingerprint`),
    byteCount: positiveInteger(bundle.byteCount, `${path}.byteCount`),
  };
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

export function validateCadPlacementAnalysisCaptureLocator(
  value: unknown,
  path = "$cadPlacementAnalysisCaptureLocator",
): CadPlacementAnalysisCaptureLocator {
  const root = exactRecord(
    value,
    ["schemaVersion", "kind", "fingerprint", "byteCount", "casUri"],
    path,
  );
  literalValue(
    root.schemaVersion,
    CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(
    root.kind,
    CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
    `${path}.kind`,
  );
  const fingerprint = parseFingerprint(root.fingerprint, `${path}.fingerprint`);
  const byteCount = nonNegativeInteger(root.byteCount, `${path}.byteCount`);
  const casUri = nonEmptyText(root.casUri, `${path}.casUri`);
  if (
    !CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PATTERN.test(casUri) ||
    casUri !== `${CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX}${fingerprint.digest}`
  ) {
    invalid(
      "invalid_identity",
      `${path}.casUri must be ${CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX}<digest>.`,
    );
  }
  return deepFreeze({
    schemaVersion: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
    kind: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
    fingerprint,
    byteCount,
    casUri,
  });
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
      child.placement.translationMm.every((value, axis) =>
        value === other.placement.translationMm[axis]
      ) &&
      child.placement.rotationDeg.every((value, axis) =>
        value === other.placement.rotationDeg[axis]
      ) &&
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
  return left.artifactId === right.artifactId &&
    left.partDefinitionElementId === right.partDefinitionElementId &&
    fingerprintsEqual(left.fingerprint, right.fingerprint);
}

export function sameOptionalSourceClosure(
  left: ProjectSourceClosureLocator | undefined,
  right: ProjectSourceClosureLocator | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.casUri === right.casUri;
}

export function sameOptionalPlacementAnalysis(
  left: CadPlacementAnalysisCaptureLocator | undefined,
  right: CadPlacementAnalysisCaptureLocator | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.casUri === right.casUri;
}

export function sameInputBundle(
  left: GeometryModuleInputBundleIdentity,
  right: GeometryModuleInputBundleIdentity,
): boolean {
  return fingerprintsEqual(left.fingerprint, right.fingerprint) &&
    left.byteCount === right.byteCount;
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
    partDefinitionElementId: safeId(
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
    value !== GEOMETRY_PART_CAPTURE_SCHEMA &&
    value !== GEOMETRY_MODULE_CAPTURE_SCHEMA
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

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    invalid("invalid_format", `${path} must be a non-negative integer.`);
  }
  return Number(value);
}
