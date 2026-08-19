/**
 * Generic geometry bundle v2 contract.
 *
 * The assembly and every PartDefinition have independent, reviewed build123d
 * source. Occurrences bind exact PartUsage identities to exact PartDefinition
 * identities plus an explicit placement. Labels are presentation-only and are
 * never used as joins.
 */

import type { ContentFingerprint } from "../../thread/thread-snapshot.ts";

export const GEOMETRY_BUNDLE_MANIFEST_SCHEMA = "geometry-manifest/2.0" as const;
export const GEOMETRY_BUNDLE_PLACEMENT_CONVENTION =
  "right-handed-mm-extrinsic-xyz-degrees" as const;

/** Exact provenance vocabulary shared by the seal and read-only projectors. */
export const GEOMETRY_BINARY_TRACE_RATIONALE =
  "The preview-produced binary is recorded by exact SHA-256 in the sealed geometry capture; this is a trace, not a claim that the later capture produced the bytes." as const;
export const GEOMETRY_BINARY_DERIVATION_RATIONALE =
  "This legacy draft had no preview run identity; the local seal produced the canonical binary from the exact content-addressed capture." as const;
export const GEOMETRY_BINARY_CAPTURE_USE_RATIONALE =
  "The binary publication reloaded the sealed geometry capture, verified its exact fingerprint, then verified and promoted the binary hash named by that capture." as const;
export const GEOMETRY_ARCHITECTURE_DERIVATION_RATIONALE =
  "The geometry was produced against the exact architecture artifact that provides the component structure and SysON element bindings (D5 verification passed)." as const;
export const GEOMETRY_ARCHITECTURE_CAPTURE_USE_RATIONALE =
  "The executor loaded the exact architecture capture to verify per-component bindings." as const;
export const GEOMETRY_PREDECESSOR_DERIVATION_RATIONALE =
  "The v2 bundle succeeds the exact prior geometry capture that the executor reread by content hash." as const;
export const GEOMETRY_PREDECESSOR_SUPERSEDES_RATIONALE =
  "The signed geometry-manifest/2.0 predecessor identifies the unique prior active geometry tip." as const;
export const GEOMETRY_PREDECESSOR_CAPTURE_USE_RATIONALE =
  "The executor reread the predecessor capture and verified its exact fingerprint before supersession." as const;

export type GeometryBundleExportFormat = "step" | "gltf" | "stl";

export interface GeometryBundleComponentBinding {
  readonly usageName: string;
  readonly elementId: string;
  readonly label: string;
}

export interface GeometryBundleFile {
  readonly format: GeometryBundleExportFormat;
  readonly name: string;
  readonly fingerprint: ContentFingerprint;
}

export interface GeometryBundlePartDefinition {
  /** Exact SysON PartDefinition identity. Never inferred from label or script. */
  readonly elementId: string;
  readonly label: string;
  /** Filled only after the exact definition script has been executed. */
  readonly scriptHash?: ContentFingerprint;
  /** One authoritative STEP plus any reviewed presentation derivatives. */
  readonly files?: ReadonlyArray<GeometryBundleFile>;
}

export interface GeometryBundlePlacement {
  readonly translationMm: readonly [number, number, number];
  readonly rotationDeg: readonly [number, number, number];
}

export interface GeometryBundleOccurrence {
  /** Exact SysON PartUsage identity. */
  readonly usageElementId: string;
  /** Exact SysON PartDefinition target identity. */
  readonly partDefinitionElementId: string;
  /**
   * Transform local to the PartDefinition that owns this PartUsage. Reusing
   * that parent definition repeats this same local placement on every expanded
   * occurrence path; the semantic PartUsage is still declared exactly once.
   */
  readonly placement: GeometryBundlePlacement;
}

export interface GeometryBundleManifest {
  readonly schemaVersion: typeof GEOMETRY_BUNDLE_MANIFEST_SCHEMA;
  readonly architectureBasis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly artifactFingerprint: ContentFingerprint;
  };
  /** Exact active geometry tip replaced by this bundle; absent for the first seal. */
  readonly predecessor?: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
  /** Retained for reviewed display names; occurrences remain the identity table. */
  readonly components: ReadonlyArray<GeometryBundleComponentBinding>;
  readonly unitSystem: "mm";
  /** Right-handed frame; translation in mm, then extrinsic X/Y/Z rotations. */
  readonly placementConvention: typeof GEOMETRY_BUNDLE_PLACEMENT_CONVENTION;
  /** Assembly formats. V2 always includes authoritative STEP. */
  readonly exportFormats: ReadonlyArray<GeometryBundleExportFormat>;
  /** PartDefinition formats. V2 always includes authoritative STEP. */
  readonly partExportFormats: ReadonlyArray<GeometryBundleExportFormat>;
  readonly partDefinitions: ReadonlyArray<GeometryBundlePartDefinition>;
  readonly occurrences: ReadonlyArray<GeometryBundleOccurrence>;
  /** Hash of the exact assembly source, filled after preview. */
  readonly scriptHash?: ContentFingerprint;
  readonly artifactHashes?: {
    readonly assemblyFiles: ReadonlyArray<GeometryBundleFile>;
    /** Kept empty so legacy callers cannot mistake definition files for occurrences. */
    readonly partMeshes: readonly [];
  };
}

export interface GeometryBundleDecisionParameters {
  readonly draftDigest: string;
  readonly manifest: GeometryBundleManifest;
}

export type GeometryBundleErrorCode =
  | "invalid_schema"
  | "missing_parameter"
  | "invalid_fingerprint"
  | "invalid_format"
  | "invalid_identity"
  | "unexpected_parameter"
  | "manifest_incomplete";

export class GeometryBundleError extends Error {
  constructor(readonly code: GeometryBundleErrorCode, message: string) {
    super(message);
    this.name = "GeometryBundleError";
  }
}

/** Validate both preview plans and completed, signable manifests. */
export function assertGeometryBundleManifest(
  manifest: GeometryBundleManifest,
  options: { readonly requireCompleted?: boolean } = {},
): void {
  if (manifest.schemaVersion !== GEOMETRY_BUNDLE_MANIFEST_SCHEMA) {
    invalid("invalid_schema", "Geometry bundle schema must be geometry-manifest/2.0.");
  }
  nonEmpty(manifest.architectureBasis.snapshotId, "architecture snapshotId");
  if (
    !Number.isSafeInteger(manifest.architectureBasis.revision) ||
    manifest.architectureBasis.revision < 1
  ) {
    invalid("invalid_format", "Geometry architecture revision must be positive.");
  }
  fingerprint(
    manifest.architectureBasis.artifactFingerprint,
    "architecture artifact fingerprint",
  );
  if (manifest.predecessor) {
    nonEmpty(manifest.predecessor.artifactId, "geometry predecessor artifactId");
    fingerprint(manifest.predecessor.fingerprint, "geometry predecessor fingerprint");
  }
  if (manifest.unitSystem !== "mm") {
    invalid("invalid_schema", "Geometry bundle unitSystem must be mm.");
  }
  if (manifest.placementConvention !== GEOMETRY_BUNDLE_PLACEMENT_CONVENTION) {
    invalid(
      "invalid_schema",
      `Geometry bundle placementConvention must be ${GEOMETRY_BUNDLE_PLACEMENT_CONVENTION}.`,
    );
  }
  formats(manifest.exportFormats, "assembly exportFormats");
  formats(manifest.partExportFormats, "partExportFormats");
  if (!manifest.exportFormats.includes("step")) {
    invalid("invalid_format", "Geometry bundle assembly exports must include STEP.");
  }
  if (!manifest.partExportFormats.includes("step")) {
    invalid(
      "invalid_format",
      "Geometry bundle PartDefinition exports must include STEP.",
    );
  }
  if (manifest.partDefinitions.length === 0) {
    invalid("invalid_identity", "Geometry bundle partDefinitions must not be empty.");
  }
  const systemOnly = isSystemOnlyGeometryBundle(manifest);
  if (manifest.components.length === 0 && !systemOnly) {
    invalid("invalid_identity", "Geometry bundle components must not be empty.");
  }
  if (systemOnly && manifest.occurrences.length !== 0) {
    invalid(
      "invalid_identity",
      "A system-only geometry bundle cannot declare occurrences.",
    );
  }

  const componentIds = new Set<string>();
  for (const [index, component] of manifest.components.entries()) {
    nonEmpty(component.elementId, `components[${index}].elementId`);
    nonEmpty(component.usageName, `components[${index}].usageName`);
    nonEmpty(component.label, `components[${index}].label`);
    if (componentIds.has(component.elementId)) {
      invalid(
        "invalid_identity",
        `Geometry bundle has duplicate PartUsage elementId ${component.elementId}.`,
      );
    }
    componentIds.add(component.elementId);
  }

  const definitionIds = new Set<string>();
  for (const [index, definition] of manifest.partDefinitions.entries()) {
    nonEmpty(definition.elementId, `partDefinitions[${index}].elementId`);
    nonEmpty(definition.label, `partDefinitions[${index}].label`);
    if (definitionIds.has(definition.elementId)) {
      invalid(
        "invalid_identity",
        `Geometry bundle has duplicate PartDefinition elementId ${definition.elementId}.`,
      );
    }
    definitionIds.add(definition.elementId);
    if (definition.scriptHash) {
      fingerprint(definition.scriptHash, `partDefinitions[${index}].scriptHash`);
    }
    if (definition.files) {
      assertDefinitionFiles(definition.files, manifest.partExportFormats, index);
    }
  }
  const crossKindCollision = [...definitionIds].find((id) => componentIds.has(id));
  if (crossKindCollision) {
    invalid(
      "invalid_identity",
      `Geometry bundle semantic elementId ${crossKindCollision} is reused across PartUsage and PartDefinition.`,
    );
  }

  const occurrenceUsageIds = new Set<string>();
  const referencedDefinitionIds = new Set<string>();
  for (const [index, occurrence] of manifest.occurrences.entries()) {
    nonEmpty(occurrence.usageElementId, `occurrences[${index}].usageElementId`);
    nonEmpty(
      occurrence.partDefinitionElementId,
      `occurrences[${index}].partDefinitionElementId`,
    );
    if (occurrenceUsageIds.has(occurrence.usageElementId)) {
      invalid(
        "invalid_identity",
        `Geometry bundle has duplicate occurrence for PartUsage ${occurrence.usageElementId}.`,
      );
    }
    occurrenceUsageIds.add(occurrence.usageElementId);
    if (!definitionIds.has(occurrence.partDefinitionElementId)) {
      invalid(
        "invalid_identity",
        `Occurrence ${occurrence.usageElementId} references missing PartDefinition ${occurrence.partDefinitionElementId}.`,
      );
    }
    referencedDefinitionIds.add(occurrence.partDefinitionElementId);
    triple(occurrence.placement.translationMm, `occurrences[${index}].translationMm`);
    triple(occurrence.placement.rotationDeg, `occurrences[${index}].rotationDeg`);
  }
  if (!systemOnly) {
    if (!sameSet(componentIds, occurrenceUsageIds)) {
      invalid(
        "invalid_identity",
        "Geometry bundle occurrences must cover every component PartUsage exactly once.",
      );
    }
    if (!sameSet(definitionIds, referencedDefinitionIds)) {
      invalid(
        "invalid_identity",
        "Every geometry PartDefinition must be referenced by at least one occurrence.",
      );
    }
  }

  if (manifest.scriptHash) fingerprint(manifest.scriptHash, "assembly scriptHash");
  if (manifest.artifactHashes) {
    assertFiles(
      manifest.artifactHashes.assemblyFiles,
      manifest.exportFormats,
      "assemblyFiles",
    );
    if (manifest.artifactHashes.partMeshes.length !== 0) {
      invalid(
        "invalid_identity",
        "Geometry bundle v2 cannot carry occurrence-labelled legacy part meshes.",
      );
    }
  }

  if (options.requireCompleted) {
    if (!manifest.scriptHash || !manifest.artifactHashes) {
      invalid(
        "manifest_incomplete",
        "Completed geometry bundle requires assembly script and artifact hashes.",
      );
    }
    for (const [index, definition] of manifest.partDefinitions.entries()) {
      if (!definition.scriptHash || !definition.files) {
        invalid(
          "manifest_incomplete",
          `Completed geometry bundle PartDefinition ${index} requires script and file hashes.`,
        );
      }
    }
  }
}

/**
 * A single-part system: the unique PartDefinition is the geometry target and
 * there is no PartUsage table. Assembly bytes are that part's bytes.
 */
export function isSystemOnlyGeometryBundle(
  manifest: Pick<GeometryBundleManifest, "components" | "partDefinitions">,
): boolean {
  return manifest.components.length === 0 &&
    manifest.partDefinitions.length === 1;
}

/** Architecture identities a v2 bundle must cover. Labels are not joins. */
export interface GeometryBundleArchitectureCoverage {
  readonly partDefinitions: readonly {
    readonly id: string;
    readonly label: string;
    readonly usages: readonly {
      readonly id: string;
      readonly label: string;
      readonly targetId: string;
    }[];
  }[];
}

/**
 * Join a signed v2 bundle to the captured architecture.
 *
 * Zero PartUsages is a single-part system: the unique system PartDefinition is
 * the geometry target. Otherwise PartDefinitions are usage targets only; the
 * unused system root stays the assembly.
 */
export function assertGeometryBundleArchitectureCoverage(
  manifest: GeometryBundleManifest,
  architecture: GeometryBundleArchitectureCoverage,
): void {
  assertGeometryBundleManifest(manifest);
  const definitionsById = new Map(
    architecture.partDefinitions.map((definition) => [definition.id, definition]),
  );
  const allUsages = new Map<
    string,
    { readonly label: string; readonly targetId: string }
  >();
  for (const definition of architecture.partDefinitions) {
    for (const usage of definition.usages) {
      allUsages.set(usage.id, { label: usage.label, targetId: usage.targetId });
    }
  }

  if (allUsages.size === 0) {
    if (architecture.partDefinitions.length !== 1) {
      invalid(
        "invalid_identity",
        "A system-only architecture must contain exactly one PartDefinition.",
      );
    }
    if (manifest.components.length !== 0 || manifest.occurrences.length !== 0) {
      invalid(
        "invalid_identity",
        "A system-only geometry bundle must not declare PartUsages.",
      );
    }
    const only = architecture.partDefinitions[0]!;
    if (
      manifest.partDefinitions.length !== 1 ||
      manifest.partDefinitions[0]!.elementId !== only.id ||
      manifest.partDefinitions[0]!.label !== only.label
    ) {
      invalid(
        "invalid_identity",
        "A system-only geometry bundle must name the unique system PartDefinition.",
      );
    }
    return;
  }

  const manifestUsageIds = new Set(
    manifest.components.map((component) => component.elementId),
  );
  if (!sameSet(manifestUsageIds, new Set(allUsages.keys()))) {
    invalid(
      "invalid_identity",
      "Geometry bundle PartUsage identities must exactly cover every PartUsage in the captured architecture.",
    );
  }
  const capturedTargetDefinitionIds = new Set(
    [...allUsages.values()].map((usage) => usage.targetId),
  );
  const manifestDefinitionIds = new Set(
    manifest.partDefinitions.map((definition) => definition.elementId),
  );
  if (!sameSet(manifestDefinitionIds, capturedTargetDefinitionIds)) {
    invalid(
      "invalid_identity",
      "Geometry bundle PartDefinition identities must exactly cover the definitions targeted by captured PartUsages; the system root is the separate assembly.",
    );
  }
  for (const definition of manifest.partDefinitions) {
    const captured = definitionsById.get(definition.elementId);
    if (!captured || captured.label !== definition.label) {
      invalid(
        "invalid_identity",
        `Geometry PartDefinition "${definition.elementId}" is not the exact captured architecture definition.`,
      );
    }
  }
  for (const occurrence of manifest.occurrences) {
    const captured = allUsages.get(occurrence.usageElementId);
    if (!captured || captured.targetId !== occurrence.partDefinitionElementId) {
      invalid(
        "invalid_identity",
        `Geometry occurrence "${occurrence.usageElementId}" does not target captured PartDefinition "${occurrence.partDefinitionElementId}".`,
      );
    }
  }
}

/** Exact flat MRTR encoding for a completed geometry bundle. */
export function encodeGeometryBundleDecisionParameters(
  draftDigest: string,
  manifest: GeometryBundleManifest,
): ReadonlyArray<{ key: string; label: string; value: string | number | boolean }> {
  digest(draftDigest, "geometry.draft.digest");
  assertGeometryBundleManifest(manifest, { requireCompleted: true });
  const result: Array<{
    key: string;
    label: string;
    value: string | number | boolean;
  }> = [];
  const p = (key: string, label: string, value: string | number | boolean) =>
    result.push({ key, label, value });

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
  p(
    "geometry.manifest.predecessor.present",
    "Geometry predecessor present",
    manifest.predecessor !== undefined,
  );
  if (manifest.predecessor) {
    p(
      "geometry.manifest.predecessor.artifactId",
      "Geometry predecessor artifact ID",
      manifest.predecessor.artifactId,
    );
    p(
      "geometry.manifest.predecessor.fingerprint",
      "Geometry predecessor SHA-256",
      manifest.predecessor.fingerprint.digest,
    );
  }
  p("geometry.manifest.unitSystem", "Unit system", manifest.unitSystem);
  p(
    "geometry.manifest.placementConvention",
    "Placement convention",
    manifest.placementConvention,
  );
  p(
    "geometry.manifest.exportFormats",
    "Assembly export formats",
    manifest.exportFormats.join(","),
  );
  p(
    "geometry.manifest.partExportFormats",
    "PartDefinition export formats",
    manifest.partExportFormats.join(","),
  );
  p(
    "geometry.manifest.scriptHash",
    "Assembly script SHA-256",
    manifest.scriptHash!.digest,
  );
  encodeFiles(p, "assemblyFiles", manifest.artifactHashes!.assemblyFiles);

  p(
    "geometry.manifest.components.count",
    "Component count",
    manifest.components.length,
  );
  manifest.components.forEach((component, index) => {
    p(
      `geometry.manifest.components.${index}.usageName`,
      `Component ${index} usage name`,
      component.usageName,
    );
    p(
      `geometry.manifest.components.${index}.elementId`,
      `Component ${index} element ID`,
      component.elementId,
    );
    p(
      `geometry.manifest.components.${index}.label`,
      `Component ${index} label`,
      component.label,
    );
  });

  p(
    "geometry.manifest.partDefinitions.count",
    "PartDefinition count",
    manifest.partDefinitions.length,
  );
  manifest.partDefinitions.forEach((definition, index) => {
    const prefix = `geometry.manifest.partDefinitions.${index}`;
    p(
      `${prefix}.elementId`,
      `PartDefinition ${index} element ID`,
      definition.elementId,
    );
    p(`${prefix}.label`, `PartDefinition ${index} label`, definition.label);
    p(
      `${prefix}.scriptHash`,
      `PartDefinition ${index} script SHA-256`,
      definition.scriptHash!.digest,
    );
    encodeFiles(p, `partDefinitions.${index}.files`, definition.files!);
  });

  p(
    "geometry.manifest.occurrences.count",
    "Occurrence count",
    manifest.occurrences.length,
  );
  manifest.occurrences.forEach((occurrence, index) => {
    const prefix = `geometry.manifest.occurrences.${index}`;
    p(
      `${prefix}.usageElementId`,
      `Occurrence ${index} PartUsage ID`,
      occurrence.usageElementId,
    );
    p(
      `${prefix}.partDefinitionElementId`,
      `Occurrence ${index} PartDefinition ID`,
      occurrence.partDefinitionElementId,
    );
    occurrence.placement.translationMm.forEach((value, axis) =>
      p(
        `${prefix}.translationMm.${axis}`,
        `Occurrence ${index} translation ${axis}`,
        value,
      )
    );
    occurrence.placement.rotationDeg.forEach((value, axis) =>
      p(`${prefix}.rotationDeg.${axis}`, `Occurrence ${index} rotation ${axis}`, value)
    );
  });
  return result;
}

/** Strict inverse of encodeGeometryBundleDecisionParameters. */
export function parseGeometryBundleDecisionParameters(
  params: ReadonlyMap<string, string | number | boolean>,
): GeometryBundleDecisionParameters {
  const expected = new Set<string>();
  const get = (key: string): string | number | boolean => {
    expected.add(key);
    const value = params.get(key);
    if (value === undefined) {
      invalid("missing_parameter", `Missing parameter: ${key}`);
    }
    return value;
  };
  const str = (key: string) => {
    const value = String(get(key));
    nonEmpty(value, key);
    return value;
  };
  const integer = (key: string, allowZero = false) => {
    const value = Number(get(key));
    if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
      invalid(
        "invalid_format",
        `${key} must be a ${allowZero ? "non-negative" : "positive"} integer.`,
      );
    }
    return value;
  };
  const number = (key: string) => {
    const value = Number(get(key));
    if (!Number.isFinite(value)) invalid("invalid_format", `${key} must be finite.`);
    return value;
  };
  const fp = (key: string): ContentFingerprint => ({
    algorithm: "sha256",
    digest: digest(str(key), key),
  });

  const draftDigest = digest(str("geometry.draft.digest"), "geometry.draft.digest");
  if (str("geometry.manifest.schemaVersion") !== GEOMETRY_BUNDLE_MANIFEST_SCHEMA) {
    invalid("invalid_schema", "Geometry bundle schema must be geometry-manifest/2.0.");
  }
  const architectureBasis = {
    snapshotId: str("geometry.manifest.architectureBasis.snapshotId"),
    revision: integer("geometry.manifest.architectureBasis.revision"),
    artifactFingerprint: fp(
      "geometry.manifest.architectureBasis.artifactFingerprint",
    ),
  };
  const predecessorPresent = get("geometry.manifest.predecessor.present");
  if (predecessorPresent !== true && predecessorPresent !== false) {
    invalid(
      "invalid_format",
      "geometry.manifest.predecessor.present must be a boolean.",
    );
  }
  const predecessor = predecessorPresent
    ? {
      artifactId: str("geometry.manifest.predecessor.artifactId"),
      fingerprint: fp("geometry.manifest.predecessor.fingerprint"),
    }
    : undefined;
  if (str("geometry.manifest.unitSystem") !== "mm") {
    invalid("invalid_schema", "Geometry bundle unitSystem must be mm.");
  }
  if (
    str("geometry.manifest.placementConvention") !==
      GEOMETRY_BUNDLE_PLACEMENT_CONVENTION
  ) {
    invalid(
      "invalid_schema",
      `Geometry bundle placementConvention must be ${GEOMETRY_BUNDLE_PLACEMENT_CONVENTION}.`,
    );
  }
  const exportFormats = parseFormats(str("geometry.manifest.exportFormats"));
  const partExportFormats = parseFormats(
    str("geometry.manifest.partExportFormats"),
  );
  const scriptHash = fp("geometry.manifest.scriptHash");
  const assemblyFiles = parseFiles(get, integer, fp, "assemblyFiles");

  const componentCount = integer("geometry.manifest.components.count", true);
  const components: GeometryBundleComponentBinding[] = [];
  for (let index = 0; index < componentCount; index++) {
    components.push({
      usageName: str(`geometry.manifest.components.${index}.usageName`),
      elementId: str(`geometry.manifest.components.${index}.elementId`),
      label: str(`geometry.manifest.components.${index}.label`),
    });
  }

  const definitionCount = integer("geometry.manifest.partDefinitions.count", true);
  const partDefinitions: GeometryBundlePartDefinition[] = [];
  for (let index = 0; index < definitionCount; index++) {
    const prefix = `geometry.manifest.partDefinitions.${index}`;
    partDefinitions.push({
      elementId: str(`${prefix}.elementId`),
      label: str(`${prefix}.label`),
      scriptHash: fp(`${prefix}.scriptHash`),
      files: parseFiles(get, integer, fp, `partDefinitions.${index}.files`),
    });
  }

  const occurrenceCount = integer("geometry.manifest.occurrences.count", true);
  const occurrences: GeometryBundleOccurrence[] = [];
  for (let index = 0; index < occurrenceCount; index++) {
    const prefix = `geometry.manifest.occurrences.${index}`;
    occurrences.push({
      usageElementId: str(`${prefix}.usageElementId`),
      partDefinitionElementId: str(`${prefix}.partDefinitionElementId`),
      placement: {
        translationMm: [0, 1, 2].map((axis) =>
          number(`${prefix}.translationMm.${axis}`)
        ) as unknown as [number, number, number],
        rotationDeg: [0, 1, 2].map((axis) =>
          number(`${prefix}.rotationDeg.${axis}`)
        ) as unknown as [number, number, number],
      },
    });
  }

  for (const key of params.keys()) {
    if (!expected.has(key)) {
      invalid("unexpected_parameter", `Unexpected geometry decision parameter: ${key}`);
    }
  }
  const manifest: GeometryBundleManifest = {
    schemaVersion: GEOMETRY_BUNDLE_MANIFEST_SCHEMA,
    architectureBasis,
    ...(predecessor ? { predecessor } : {}),
    components,
    unitSystem: "mm",
    placementConvention: GEOMETRY_BUNDLE_PLACEMENT_CONVENTION,
    exportFormats,
    partExportFormats,
    partDefinitions,
    occurrences,
    scriptHash,
    artifactHashes: { assemblyFiles, partMeshes: [] },
  };
  assertGeometryBundleManifest(manifest, { requireCompleted: true });
  return { draftDigest, manifest };
}

function encodeFiles(
  p: (key: string, label: string, value: string | number | boolean) => void,
  path: string,
  files: ReadonlyArray<GeometryBundleFile>,
): void {
  p(`geometry.manifest.${path}.count`, `${path} count`, files.length);
  files.forEach((file, index) => {
    const prefix = `geometry.manifest.${path}.${index}`;
    p(`${prefix}.format`, `${path} ${index} format`, file.format);
    p(`${prefix}.name`, `${path} ${index} name`, file.name);
    p(`${prefix}.fingerprint`, `${path} ${index} SHA-256`, file.fingerprint.digest);
  });
}

function parseFiles(
  get: (key: string) => string | number | boolean,
  integer: (key: string, allowZero?: boolean) => number,
  fp: (key: string) => ContentFingerprint,
  path: string,
): GeometryBundleFile[] {
  const count = integer(`geometry.manifest.${path}.count`, true);
  const files: GeometryBundleFile[] = [];
  for (let index = 0; index < count; index++) {
    const prefix = `geometry.manifest.${path}.${index}`;
    const format = String(get(`${prefix}.format`));
    if (format !== "step" && format !== "gltf" && format !== "stl") {
      invalid("invalid_format", `${prefix}.format is unsupported.`);
    }
    const name = String(get(`${prefix}.name`));
    nonEmpty(name, `${prefix}.name`);
    files.push({ format, name, fingerprint: fp(`${prefix}.fingerprint`) });
  }
  return files;
}

function assertDefinitionFiles(
  files: ReadonlyArray<GeometryBundleFile>,
  requested: ReadonlyArray<GeometryBundleExportFormat>,
  definitionIndex: number,
): void {
  assertFiles(files, requested, `partDefinitions[${definitionIndex}].files`);
  if (files.filter((file) => file.format === "step").length !== 1) {
    invalid(
      "invalid_format",
      `partDefinitions[${definitionIndex}] must carry exactly one authoritative STEP.`,
    );
  }
}

function assertFiles(
  files: ReadonlyArray<GeometryBundleFile>,
  requested: ReadonlyArray<GeometryBundleExportFormat>,
  context: string,
): void {
  if (files.length !== requested.length) {
    invalid(
      "invalid_format",
      `${context} must match the exact requested format count.`,
    );
  }
  files.forEach((file, index) => {
    if (file.format !== requested[index]) {
      invalid(
        "invalid_format",
        `${context}[${index}] is not in requested format order.`,
      );
    }
    nonEmpty(file.name, `${context}[${index}].name`);
    fingerprint(file.fingerprint, `${context}[${index}].fingerprint`);
  });
}

function parseFormats(raw: string): GeometryBundleExportFormat[] {
  const parsed = raw.split(",");
  formats(parsed as GeometryBundleExportFormat[], "export formats");
  return parsed as GeometryBundleExportFormat[];
}

function formats(
  values: ReadonlyArray<GeometryBundleExportFormat>,
  context: string,
): void {
  if (values.length === 0 || new Set(values).size !== values.length) {
    invalid("invalid_format", `${context} must be non-empty and duplicate-free.`);
  }
  if (values.some((value) => value !== "step" && value !== "gltf" && value !== "stl")) {
    invalid("invalid_format", `${context} contains an unsupported format.`);
  }
}

function triple(value: readonly number[], context: string): void {
  if (value.length !== 3 || value.some((part) => !Number.isFinite(part))) {
    invalid("invalid_format", `${context} must contain exactly three finite numbers.`);
  }
}

function fingerprint(value: ContentFingerprint, context: string): void {
  if (value.algorithm !== "sha256") {
    invalid("invalid_fingerprint", `${context} must use SHA-256.`);
  }
  digest(value.digest, context);
}

function digest(value: string, context: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    invalid("invalid_fingerprint", `${context} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function nonEmpty(value: string, context: string): void {
  if (value.trim() === "") invalid("invalid_format", `${context} must be non-empty.`);
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function invalid(code: GeometryBundleErrorCode, message: string): never {
  throw new GeometryBundleError(code, message);
}
