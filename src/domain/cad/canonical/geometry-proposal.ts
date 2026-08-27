/**
 * Reviewed geometry proposal types and fail-closed parsers.
 *
 * WHY THIS MODULE EXISTS — the decision MRTR that gates `design.write-geometry@1`
 * carries a flat parameter list that the write executor must parse back into a
 * typed `GeometryManifest`.  The parser here is the only authority allowed to
 * reconstruct the manifeste from human-signed parameters; the executor must not
 * attempt a second interpretation of the raw parameter strings.
 *
 * The `architectureBasis` field binds the geometry to an exact ThreadSnapshot
 * revision — specifically to the artifact whose `kind === "sysml-model"` in that
 * revision.  This prevents a geometry draft produced against an old architecture
 * from being silently promoted into a thread whose architecture has since changed.
 *
 * `scriptHash` and `artifactHashes` are absent from a freshly-constructed manifest
 * (before the preview run) and are filled in by the draft-capture layer once
 * build123d_export returns.  A manifest whose `scriptHash` is undefined has never
 * been executed and cannot be promoted.
 */

import type { ContentFingerprint } from "../../thread/thread-snapshot.ts";
import {
  encodeGeometryBundleDecisionParameters,
  GEOMETRY_BUNDLE_MANIFEST_SCHEMA,
  type GeometryBundleManifest,
  parseGeometryBundleDecisionParameters,
} from "./geometry-bundle.ts";
import {
  encodeGeometryPartDecisionParameters,
  GEOMETRY_PART_MANIFEST_SCHEMA,
  type GeometryPartManifest,
  parseGeometryPartDecisionParameters,
} from "./geometry-part-manifest.ts";
// The proposal consumes only the signed module-manifest contract. The public
// evidence facade also initializes capture parsers that consume this proposal.
import {
  encodeGeometryModuleDecisionParameters,
  type GeometryModuleManifest,
  parseGeometryModuleDecisionParameters,
} from "./geometry-module-manifest.ts";
import { GEOMETRY_MODULE_MANIFEST_SCHEMA } from "./geometry-module-identities.ts";

/**
 * Reviewed operation identities live in the domain so the registry can import
 * them without depending on adapters.
 *
 * `design.preview-geometry@1` is a retired identity. The live registry does
 * not list it. Canonical drafts come from `project_admitted_geometry_export`.
 */
export const DESIGN_PREVIEW_GEOMETRY_OPERATION = {
  id: "design.preview-geometry",
  version: "1",
} as const;

/**
 * Trusted executor reference for `design.write-geometry@1`.
 *
 * WHY DOMAIN LAYER — the registry (orchestration/) and the executor (adapters/) both
 * need this constant.  Defining it in the executor would force the registry to import
 * from adapters, violating the hexagonal layering rule.
 */
export const DESIGN_WRITE_GEOMETRY_OPERATION = {
  id: "design.write-geometry",
  version: "1",
} as const;

export const GEOMETRY_MANIFEST_SCHEMA = "geometry-manifest/1.0" as const;

export type GeometryExportFormat = "step" | "gltf" | "stl";

/**
 * Binding from a manifest component entry to the exact SysON element.
 *
 * `usageName` is the SysML part-usage label (e.g. "driveUnit").
 * `elementId`  is the opaque SysON element UUID.  Both must match what the
 * architecture executor extracted and stored in the architecture capture.
 *
 * The `label` field is human-readable only and is never used for identity
 * matching in the write executor — only `elementId` is authoritative.
 */
export interface GeometryComponentBinding {
  readonly usageName: string;
  readonly elementId: string;
  readonly label: string;
}

/** Hashes of the exported binary assets, filled at preview time. */
export interface GeometryArtifactHashes {
  readonly assemblyFiles: ReadonlyArray<{
    readonly format: GeometryExportFormat;
    readonly name: string;
    readonly fingerprint: ContentFingerprint;
  }>;
  readonly partMeshes: ReadonlyArray<{
    readonly semanticKey: string;
    readonly name: string;
    readonly fingerprint: ContentFingerprint;
  }>;
}

/**
 * Signed manifeste typé that travels through the MRTR decision.
 *
 * `scriptHash` and `artifactHashes` are absent before the preview
 * run; both must be present for a manifeste to be eligible for promotion
 * (the write executor rejects a manifeste without them).
 */
export interface GeometryManifest {
  readonly schemaVersion: typeof GEOMETRY_MANIFEST_SCHEMA;
  readonly architectureBasis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly artifactFingerprint: ContentFingerprint;
  };
  readonly components: ReadonlyArray<GeometryComponentBinding>;
  readonly unitSystem: "mm";
  readonly exportFormats: ReadonlyArray<GeometryExportFormat>;
  readonly scriptHash?: ContentFingerprint;
  readonly artifactHashes?: GeometryArtifactHashes;
}

/**
 * The existing write-geometry executor predates the part-only family and
 * accesses legacy assembly fields before its schema discriminants. This
 * type-only compatibility surface keeps that executor compiling unchanged;
 * `geometry-part-manifest.ts` remains the runtime authority and rejects these
 * fields from every actual target manifest. P2a never invokes the sealer for
 * this family.
 */
type GeometryPartManifestForLegacySealer = GeometryPartManifest & {
  readonly components: never;
  readonly artifactHashes?: never;
  /** Keep shared legacy reads type-safe without granting a target any assembly fields. */
  readonly scriptHash?: never;
};

type GeometryModuleManifestForLegacySealer = GeometryModuleManifest & {
  readonly components: never;
  readonly artifactHashes?: never;
  readonly scriptHash?: never;
};

/**
 * Additive read/write union. Existing geometry-manifest/1.0 and /2.0 remain
 * unchanged; targeted part and module families keep their own schemas rather
 * than pretending to be a partial assembly bundle.
 */
export type AnyGeometryManifest =
  | GeometryManifest
  | GeometryBundleManifest
  | GeometryPartManifestForLegacySealer
  | GeometryModuleManifestForLegacySealer;

/**
 * Flat parameter encoding carried in an `EngineeringDecisionProposal`.
 *
 * The grammar is designed to be human-readable in the MRTR chat output:
 * the engineer sees the draft digest they previewed, the basis snapshot,
 * and a count of components plus one entry per component so they can verify
 * the bindings before approving.
 *
 * Keys:
 *   geometry.draft.digest                    — hex-64 SHA-256 of the draft
 *   geometry.manifest.schemaVersion
 *   geometry.manifest.architectureBasis.snapshotId
 *   geometry.manifest.architectureBasis.revision
 *   geometry.manifest.architectureBasis.artifactFingerprint
 *   geometry.manifest.unitSystem
 *   geometry.manifest.exportFormats           — comma-separated
 *   geometry.manifest.scriptHash
 *   geometry.manifest.assemblyFiles.count
 *   geometry.manifest.assemblyFiles.{i}.format
 *   geometry.manifest.assemblyFiles.{i}.fingerprint
 *   geometry.manifest.components.count
 *   geometry.manifest.components.{i}.usageName
 *   geometry.manifest.components.{i}.elementId
 *   geometry.manifest.components.{i}.label
 */
export type GeometryDecisionParameterKey = string;

export interface GeometryDecisionParameters {
  readonly draftDigest: string;
  readonly manifest: AnyGeometryManifest;
}

export type GeometryProposalErrorCode =
  | "invalid_schema"
  | "missing_parameter"
  | "invalid_fingerprint"
  | "invalid_format"
  | "invalid_component"
  | "duplicate_parameter"
  | "unexpected_parameter"
  | "manifest_incomplete";

export class GeometryProposalError extends Error {
  constructor(
    readonly code: GeometryProposalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GeometryProposalError";
  }
}

/**
 * Resolve a flat parameter map (from an `EngineeringDecisionProposal`) back
 * into the typed `GeometryDecisionParameters`.
 *
 * Fail-closed: any unexpected or missing key throws `GeometryProposalError`.
 * The executor must call this before touching the draft store or the
 * architecture capture.
 */
export function parseGeometryDecisionParameters(
  params: ReadonlyMap<string, string | number | boolean>,
): GeometryDecisionParameters {
  if (
    String(params.get("geometry.manifest.schemaVersion")) ===
      GEOMETRY_BUNDLE_MANIFEST_SCHEMA
  ) {
    return parseGeometryBundleDecisionParameters(params);
  }
  if (
    String(params.get("geometry.manifest.schemaVersion")) ===
      GEOMETRY_PART_MANIFEST_SCHEMA
  ) {
    // The cast is type-only: the strict target parser returns an object with
    // no legacy fields, and the P2a use case never hands it to the old sealer.
    return parseGeometryPartDecisionParameters(params) as GeometryDecisionParameters;
  }
  if (
    String(params.get("geometry.manifest.schemaVersion")) ===
      GEOMETRY_MODULE_MANIFEST_SCHEMA
  ) {
    return parseGeometryModuleDecisionParameters(params) as GeometryDecisionParameters;
  }
  const draftDigest = requireStringParam(
    params,
    "geometry.draft.digest",
    FINGERPRINT_RE,
    "geometry.draft.digest must be a 64-char lowercase hex SHA-256",
  );
  const schemaVersion = requireStringParam(
    params,
    "geometry.manifest.schemaVersion",
    /^geometry-manifest\/1\.0$/,
    "geometry.manifest.schemaVersion must be geometry-manifest/1.0",
  );
  if (schemaVersion !== GEOMETRY_MANIFEST_SCHEMA) {
    throw new GeometryProposalError(
      "invalid_schema",
      `Unknown geometry manifest schema version: ${schemaVersion}`,
    );
  }
  const snapshotId = requireStringParam(
    params,
    "geometry.manifest.architectureBasis.snapshotId",
    NON_EMPTY_RE,
    "geometry.manifest.architectureBasis.snapshotId must be non-empty",
  );
  const revision = requirePositiveIntParam(
    params,
    "geometry.manifest.architectureBasis.revision",
  );
  const artifactFingerprintDigest = requireStringParam(
    params,
    "geometry.manifest.architectureBasis.artifactFingerprint",
    FINGERPRINT_RE,
    "architectureBasis.artifactFingerprint must be a 64-char hex SHA-256",
  );
  const unitSystem = requireStringParam(
    params,
    "geometry.manifest.unitSystem",
    /^mm$/,
    "geometry.manifest.unitSystem must be mm",
  );
  if (unitSystem !== "mm") {
    throw new GeometryProposalError("invalid_schema", "Unit system must be mm.");
  }
  const exportFormatsStr = requireStringParam(
    params,
    "geometry.manifest.exportFormats",
    NON_EMPTY_RE,
    "geometry.manifest.exportFormats must be non-empty",
  );
  const exportFormats = parseExportFormats(exportFormatsStr);

  const scriptHashDigest = requireStringParam(
    params,
    "geometry.manifest.scriptHash",
    FINGERPRINT_RE,
    "geometry.manifest.scriptHash must be a 64-char hex SHA-256",
  );

  const assemblyFileCount = requirePositiveIntOrZeroParam(
    params,
    "geometry.manifest.assemblyFiles.count",
  );
  const assemblyFiles: GeometryArtifactHashes["assemblyFiles"][number][] = [];
  for (let i = 0; i < assemblyFileCount; i++) {
    const format = requireStringParam(
      params,
      `geometry.manifest.assemblyFiles.${i}.format`,
      /^(step|gltf|stl)$/,
      `assemblyFiles.${i}.format must be step, gltf, or stl`,
    ) as GeometryExportFormat;
    const fingerprint = requireStringParam(
      params,
      `geometry.manifest.assemblyFiles.${i}.fingerprint`,
      FINGERPRINT_RE,
      `assemblyFiles.${i}.fingerprint must be a 64-char hex SHA-256`,
    );
    const name = requireStringParam(
      params,
      `geometry.manifest.assemblyFiles.${i}.name`,
      NON_EMPTY_RE,
      `assemblyFiles.${i}.name must be non-empty`,
    );
    assemblyFiles.push({
      format,
      name,
      fingerprint: { algorithm: "sha256", digest: fingerprint },
    });
  }

  const componentCount = requirePositiveIntOrZeroParam(
    params,
    "geometry.manifest.components.count",
  );
  const components: GeometryComponentBinding[] = [];
  for (let i = 0; i < componentCount; i++) {
    const usageName = requireStringParam(
      params,
      `geometry.manifest.components.${i}.usageName`,
      SYSML_NAME_RE,
      `components.${i}.usageName must match ${SYSML_NAME_RE.source}`,
    );
    const elementId = requireStringParam(
      params,
      `geometry.manifest.components.${i}.elementId`,
      NON_EMPTY_RE,
      `components.${i}.elementId must be non-empty`,
    );
    const label = requireStringParam(
      params,
      `geometry.manifest.components.${i}.label`,
      NON_EMPTY_RE,
      `components.${i}.label must be non-empty`,
    );
    components.push({ usageName, elementId, label });
  }

  const partMeshes: GeometryArtifactHashes["partMeshes"][number][] = [];
  const partMeshCount = requirePositiveIntOrZeroParam(
    params,
    "geometry.manifest.partMeshes.count",
  );
  for (let i = 0; i < partMeshCount; i++) {
    const semanticKey = requireStringParam(
      params,
      `geometry.manifest.partMeshes.${i}.semanticKey`,
      SEMANTIC_KEY_RE,
      `partMeshes.${i}.semanticKey must match ${SEMANTIC_KEY_RE.source}`,
    );
    const name = requireStringParam(
      params,
      `geometry.manifest.partMeshes.${i}.name`,
      NON_EMPTY_RE,
      `partMeshes.${i}.name must be non-empty`,
    );
    const fingerprint = requireStringParam(
      params,
      `geometry.manifest.partMeshes.${i}.fingerprint`,
      FINGERPRINT_RE,
      `partMeshes.${i}.fingerprint must be a 64-char hex SHA-256`,
    );
    partMeshes.push({
      semanticKey,
      name,
      fingerprint: { algorithm: "sha256", digest: fingerprint },
    });
  }

  const expectedKeys = new Set<string>([
    "geometry.draft.digest",
    "geometry.manifest.schemaVersion",
    "geometry.manifest.architectureBasis.snapshotId",
    "geometry.manifest.architectureBasis.revision",
    "geometry.manifest.architectureBasis.artifactFingerprint",
    "geometry.manifest.unitSystem",
    "geometry.manifest.exportFormats",
    "geometry.manifest.scriptHash",
    "geometry.manifest.assemblyFiles.count",
    "geometry.manifest.components.count",
    "geometry.manifest.partMeshes.count",
  ]);
  for (let i = 0; i < assemblyFileCount; i++) {
    for (const field of ["format", "name", "fingerprint"]) {
      expectedKeys.add(`geometry.manifest.assemblyFiles.${i}.${field}`);
    }
  }
  for (let i = 0; i < componentCount; i++) {
    for (const field of ["usageName", "elementId", "label"]) {
      expectedKeys.add(`geometry.manifest.components.${i}.${field}`);
    }
  }
  for (let i = 0; i < partMeshCount; i++) {
    for (const field of ["semanticKey", "name", "fingerprint"]) {
      expectedKeys.add(`geometry.manifest.partMeshes.${i}.${field}`);
    }
  }
  for (const key of params.keys()) {
    if (!expectedKeys.has(key)) {
      throw new GeometryProposalError(
        "unexpected_parameter",
        `Unexpected geometry decision parameter: ${key}`,
      );
    }
  }

  const manifest: GeometryManifest = {
    schemaVersion: GEOMETRY_MANIFEST_SCHEMA,
    architectureBasis: {
      snapshotId,
      revision,
      artifactFingerprint: { algorithm: "sha256", digest: artifactFingerprintDigest },
    },
    components,
    unitSystem: "mm",
    exportFormats,
    scriptHash: { algorithm: "sha256", digest: scriptHashDigest },
    artifactHashes: { assemblyFiles, partMeshes },
  };

  assertGeometryManifestArtifactIdentities(manifest);

  return { draftDigest, manifest };
}

/**
 * Preserve the parameter-list boundary until duplicate keys have been rejected.
 * A Map alone cannot prove this invariant because constructing it already loses
 * the earlier signed value.
 */
export function geometryDecisionParametersToMap(
  parameters: ReadonlyArray<{
    readonly key: string;
    readonly value: string | number | boolean;
  }>,
): ReadonlyMap<string, string | number | boolean> {
  const result = new Map<string, string | number | boolean>();
  for (const parameter of parameters) {
    if (result.has(parameter.key)) {
      throw new GeometryProposalError(
        "duplicate_parameter",
        `Duplicate geometry decision parameter: ${parameter.key}`,
      );
    }
    result.set(parameter.key, parameter.value);
  }
  return result;
}

/**
 * Convert a `GeometryManifest` into the flat parameter map for an
 * `EngineeringDecisionProposal`.
 *
 * The caller supplies the `draftDigest` (the fingerprint of the draft store
 * entry) alongside the completed manifest (with `scriptHash` and
 * `artifactHashes` filled by the draft-capture layer).
 */
export function encodeGeometryDecisionParameters(
  draftDigest: string,
  manifest: AnyGeometryManifest | GeometryPartManifest | GeometryModuleManifest,
): ReadonlyArray<{ key: string; label: string; value: string | number | boolean }> {
  if (manifest.schemaVersion === GEOMETRY_BUNDLE_MANIFEST_SCHEMA) {
    return encodeGeometryBundleDecisionParameters(draftDigest, manifest);
  }
  if (manifest.schemaVersion === GEOMETRY_PART_MANIFEST_SCHEMA) {
    return encodeGeometryPartDecisionParameters(draftDigest, manifest);
  }
  if (manifest.schemaVersion === GEOMETRY_MODULE_MANIFEST_SCHEMA) {
    return encodeGeometryModuleDecisionParameters(draftDigest, manifest);
  }
  if (!manifest.scriptHash || !manifest.artifactHashes) {
    throw new GeometryProposalError(
      "manifest_incomplete",
      "Cannot encode decision parameters from a manifest without scriptHash and artifactHashes.",
    );
  }
  assertGeometryManifestArtifactIdentities(manifest);
  const params: Array<
    { key: string; label: string; value: string | number | boolean }
  > = [];
  const p = (key: string, label: string, value: string | number | boolean) => {
    params.push({ key, label, value });
  };

  p("geometry.draft.digest", "Draft SHA-256 digest", draftDigest);
  p(
    "geometry.manifest.schemaVersion",
    "Manifest schema version",
    manifest.schemaVersion,
  );
  p(
    "geometry.manifest.architectureBasis.snapshotId",
    "Architecture basis snapshot ID",
    manifest.architectureBasis.snapshotId,
  );
  p(
    "geometry.manifest.architectureBasis.revision",
    "Architecture basis revision",
    manifest.architectureBasis.revision,
  );
  p(
    "geometry.manifest.architectureBasis.artifactFingerprint",
    "Architecture artifact SHA-256",
    manifest.architectureBasis.artifactFingerprint.digest,
  );
  p("geometry.manifest.unitSystem", "Unit system", manifest.unitSystem);
  p(
    "geometry.manifest.exportFormats",
    "Export formats",
    manifest.exportFormats.join(","),
  );
  p("geometry.manifest.scriptHash", "Script SHA-256", manifest.scriptHash.digest);

  p(
    "geometry.manifest.assemblyFiles.count",
    "Assembly files count",
    manifest.artifactHashes.assemblyFiles.length,
  );
  for (const [i, f] of manifest.artifactHashes.assemblyFiles.entries()) {
    p(
      `geometry.manifest.assemblyFiles.${i}.format`,
      `Assembly file ${i} format`,
      f.format,
    );
    p(`geometry.manifest.assemblyFiles.${i}.name`, `Assembly file ${i} name`, f.name);
    p(
      `geometry.manifest.assemblyFiles.${i}.fingerprint`,
      `Assembly file ${i} SHA-256`,
      f.fingerprint.digest,
    );
  }

  p(
    "geometry.manifest.components.count",
    "Component count",
    manifest.components.length,
  );
  for (const [i, c] of manifest.components.entries()) {
    p(
      `geometry.manifest.components.${i}.usageName`,
      `Component ${i} usage name`,
      c.usageName,
    );
    p(
      `geometry.manifest.components.${i}.elementId`,
      `Component ${i} element ID`,
      c.elementId,
    );
    p(`geometry.manifest.components.${i}.label`, `Component ${i} label`, c.label);
  }

  p(
    "geometry.manifest.partMeshes.count",
    "Part mesh count",
    manifest.artifactHashes.partMeshes.length,
  );
  for (const [i, m] of manifest.artifactHashes.partMeshes.entries()) {
    p(
      `geometry.manifest.partMeshes.${i}.semanticKey`,
      `Part mesh ${i} semantic key`,
      m.semanticKey,
    );
    p(`geometry.manifest.partMeshes.${i}.name`, `Part mesh ${i} name`, m.name);
    p(
      `geometry.manifest.partMeshes.${i}.fingerprint`,
      `Part mesh ${i} SHA-256`,
      m.fingerprint.digest,
    );
  }

  return params;
}

// ── Private helpers ──────────────────────────────────────────────────────────

const FINGERPRINT_RE = /^[a-f0-9]{64}$/;
const NON_EMPTY_RE = /^.+$/s;
const SYSML_NAME_RE = /^[a-z][A-Za-z0-9_]*$/;
const SEMANTIC_KEY_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const VALID_FORMATS = new Set<string>(["step", "gltf", "stl"]);

function requireStringParam(
  params: ReadonlyMap<string, string | number | boolean>,
  key: string,
  pattern: RegExp,
  message: string,
): string {
  const value = params.get(key);
  if (value === undefined) {
    throw new GeometryProposalError("missing_parameter", `Missing parameter: ${key}`);
  }
  const str = String(value);
  if (!pattern.test(str)) {
    throw new GeometryProposalError(
      "invalid_format",
      `${message} (got: ${str.slice(0, 64)})`,
    );
  }
  return str;
}

function requirePositiveIntParam(
  params: ReadonlyMap<string, string | number | boolean>,
  key: string,
): number {
  const value = params.get(key);
  if (value === undefined) {
    throw new GeometryProposalError("missing_parameter", `Missing parameter: ${key}`);
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new GeometryProposalError(
      "invalid_format",
      `${key} must be a positive integer (got: ${value})`,
    );
  }
  return n;
}

function requirePositiveIntOrZeroParam(
  params: ReadonlyMap<string, string | number | boolean>,
  key: string,
): number {
  const value = params.get(key);
  if (value === undefined) {
    throw new GeometryProposalError("missing_parameter", `Missing parameter: ${key}`);
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new GeometryProposalError(
      "invalid_format",
      `${key} must be a non-negative integer (got: ${value})`,
    );
  }
  return n;
}

function parseExportFormats(raw: string): ReadonlyArray<GeometryExportFormat> {
  const parts = raw.split(",").map((s) => s.trim());
  if (parts.length === 0) {
    throw new GeometryProposalError(
      "invalid_format",
      "exportFormats must be non-empty",
    );
  }
  for (const fmt of parts) {
    if (!VALID_FORMATS.has(fmt)) {
      throw new GeometryProposalError(
        "invalid_format",
        `Unknown export format: ${fmt}. Allowed: step, gltf, stl`,
      );
    }
  }
  if (new Set(parts).size !== parts.length) {
    throw new GeometryProposalError(
      "invalid_format",
      "exportFormats must not contain duplicates",
    );
  }
  return parts as ReadonlyArray<GeometryExportFormat>;
}

/**
 * Prove that each reviewed component has one provider identity and each binary
 * maps to one ThreadArtifact identity. Duplicate IDs or content digests would
 * otherwise become ambiguous after provider acknowledgement and promotion.
 */
export function assertGeometryManifestArtifactIdentities(
  manifest: GeometryManifest,
): void {
  const componentElementIds = manifest.components.map((component) =>
    component.elementId
  );
  if (new Set(componentElementIds).size !== componentElementIds.length) {
    throw new GeometryProposalError(
      "invalid_format",
      "Geometry components must not contain duplicate provider element IDs.",
    );
  }
  if (new Set(manifest.exportFormats).size !== manifest.exportFormats.length) {
    throw new GeometryProposalError(
      "invalid_format",
      "exportFormats must not contain duplicates",
    );
  }
  const fingerprints = [
    ...(manifest.artifactHashes?.assemblyFiles ?? []).map((file) =>
      file.fingerprint.digest
    ),
    ...(manifest.artifactHashes?.partMeshes ?? []).map((mesh) =>
      mesh.fingerprint.digest
    ),
  ];
  if (new Set(fingerprints).size !== fingerprints.length) {
    throw new GeometryProposalError(
      "invalid_fingerprint",
      "Geometry artifact fingerprints must be unique across assembly files and part meshes.",
    );
  }
}
