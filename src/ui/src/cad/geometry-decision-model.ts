/**
 * Browser-safe model for a human geometry-sealing decision (design.write-geometry@1).
 *
 * WHY THIS MODULE EXISTS — the MRTR proposal produced by
 * `project_admitted_geometry_export` carries a flat key-value parameter list
 * (matching the `encodeGeometryDecisionParameters`
 * convention from the domain layer).  This module re-parses those parameters into
 * typed view objects so the Workbench can display the draft digest, the architecture
 * basis, and the asset counts without depending on the server-side domain layer.
 *
 * The only authority for the canonical interpretation of the parameter keys is the
 * domain layer (`geometry-proposal.ts`); this model must stay in sync with that
 * encoding.  Any mismatch is surfaced as `{ kind: "invalid" }` so the UI always
 * renders something, never crashes.
 */

// ── Public types ──────────────────────────────────────────────────────────────

export interface GeometryDecisionAssemblyFile {
  readonly format: "step" | "gltf" | "stl";
  readonly name: string;
  /** Hex-64 SHA-256 of the binary asset. */
  readonly digest: string;
}

export interface GeometryDecisionComponent {
  readonly usageName: string;
  readonly elementId: string;
  readonly label: string;
}

export interface GeometryDecisionPartDefinition {
  readonly elementId: string;
  readonly label: string;
  readonly scriptDigest: string;
  readonly files: readonly GeometryDecisionAssemblyFile[];
}

export interface GeometryDecisionOccurrence {
  readonly usageElementId: string;
  readonly partDefinitionElementId: string;
  readonly translationMm: readonly [number, number, number];
  readonly rotationDeg: readonly [number, number, number];
}

export interface GeometryDecisionPredecessor {
  readonly artifactId: string;
  /** Hex-64 SHA-256 of the exact geometry artifact being replaced. */
  readonly digest: string;
}

/** A deliberately non-assembly target capture. */
export interface GeometryDecisionTargetPart {
  readonly partDefinitionElementId: string;
  readonly label: string;
  readonly scriptDigest: string;
  readonly files: readonly GeometryDecisionAssemblyFile[];
}

/** Successfully parsed geometry decision view — all fields are readable. */
export interface GeometryDecisionValid {
  readonly kind: "valid";
  readonly schemaVersion:
    | "geometry-manifest/1.0"
    | "geometry-manifest/2.0"
    | "geometry-part-manifest/1.0";
  /** Hex-64 SHA-256 of the draft JSON capture in the draft store. */
  readonly draftDigest: string;
  readonly architecture: {
    readonly snapshotId: string;
    readonly revision: number;
    /** Hex-64 SHA-256 of the architecture SysML artifact. */
    readonly artifactDigest: string;
  };
  readonly predecessor?: GeometryDecisionPredecessor;
  readonly unitSystem: "mm";
  readonly exportFormats: readonly string[];
  /** Hex-64 SHA-256 of the geometry script that produced this draft. */
  readonly scriptDigest: string;
  readonly assemblyFiles: readonly GeometryDecisionAssemblyFile[];
  readonly components: readonly GeometryDecisionComponent[];
  readonly partDefinitions: readonly GeometryDecisionPartDefinition[];
  readonly occurrences: readonly GeometryDecisionOccurrence[];
  readonly placementConvention?: "right-handed-mm-extrinsic-xyz-degrees";
  readonly partExportFormats: readonly string[];
  /** Present only for a one-PartDefinition decision; no assembly is implied. */
  readonly targetPart?: GeometryDecisionTargetPart;
  /**
   * URL path to preview one assembly file binary on the BFF
   * `/api/draft-assets/<digest>` endpoint.
   */
  readonly primaryAssetPreviewPath: string | undefined;
  /**
   * Format of the primary asset — determines which renderer the view layer
   * should use.  `undefined` when there are no assembly files.
   */
  readonly primaryAssetFormat: "step" | "gltf" | "stl" | undefined;
}

/** The parameter list is present but could not be fully parsed. */
export interface GeometryDecisionInvalid {
  readonly kind: "invalid";
  readonly reason: string;
}

export type GeometryDecisionView =
  | GeometryDecisionValid
  | GeometryDecisionInvalid;

// ── Flat-parameter type (mirrors EngineeringDecisionProposal.parameters shape) ─

export interface GeometryDecisionParameter {
  readonly key: string;
  readonly label: string;
  readonly value: string | number | boolean;
}

// ── Parser ────────────────────────────────────────────────────────────────────

/**
 * Parse a geometry MRTR decision's flat parameter list into a typed view.
 *
 * Returns `{ kind: "invalid", reason }` on any parse failure — the caller
 * must never throw for a missing or malformed parameter; the UI degrades
 * gracefully.
 */
export function parseGeometryDecisionView(
  params: readonly GeometryDecisionParameter[],
): GeometryDecisionView {
  try {
    return parseOrThrow(params);
  } catch (error) {
    return {
      kind: "invalid",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

const FINGERPRINT_RE = /^[a-f0-9]{64}$/;

function parseOrThrow(
  params: readonly GeometryDecisionParameter[],
): GeometryDecisionValid {
  if (params.length === 0) throw new Error("The geometry proposal is empty");
  const map = new Map<string, string | number | boolean>(
    params.map((p) => [p.key, p.value]),
  );
  if (map.size !== params.length) {
    const seen = new Set<string>();
    const duplicate = params.find((parameter) => {
      if (seen.has(parameter.key)) return true;
      seen.add(parameter.key);
      return false;
    });
    throw new Error(`Duplicate parameter: ${duplicate?.key ?? "unknown"}`);
  }

  const draftDigest = hex64(map, "geometry.draft.digest");
  const schemaVersion = oneOfSchema(map, "geometry.manifest.schemaVersion");
  const snapshotId = nonEmpty(
    map,
    "geometry.manifest.architectureBasis.snapshotId",
  );
  const revision = positiveInt(
    map,
    "geometry.manifest.architectureBasis.revision",
  );
  const artifactDigest = hex64(
    map,
    "geometry.manifest.architectureBasis.artifactFingerprint",
  );
  const unitSystem = exactString(
    map,
    "geometry.manifest.unitSystem",
    "mm" as const,
  );
  const exportFormats = parseFormats(
    nonEmpty(map, "geometry.manifest.exportFormats"),
    "geometry.manifest.exportFormats",
    schemaVersion === "geometry-manifest/1.0",
  );
  if (schemaVersion === "geometry-part-manifest/1.0") {
    return parseTargetPartDecision(map, {
      draftDigest,
      snapshotId,
      revision,
      artifactDigest,
      unitSystem,
      exportFormats,
    });
  }
  const scriptDigest = hex64(map, "geometry.manifest.scriptHash");

  const assemblyFileCount = nonNegativeInt(
    map,
    "geometry.manifest.assemblyFiles.count",
  );
  const assemblyFiles: GeometryDecisionAssemblyFile[] = [];
  for (let i = 0; i < assemblyFileCount; i++) {
    const format = oneOfFormat(
      map,
      `geometry.manifest.assemblyFiles.${i}.format`,
    );
    const name = nonEmpty(map, `geometry.manifest.assemblyFiles.${i}.name`);
    const digest = hex64(
      map,
      `geometry.manifest.assemblyFiles.${i}.fingerprint`,
    );
    assemblyFiles.push({ format, name, digest });
  }

  const componentCount = nonNegativeInt(
    map,
    "geometry.manifest.components.count",
  );
  const components: GeometryDecisionComponent[] = [];
  for (let i = 0; i < componentCount; i++) {
    const usageName = nonEmpty(
      map,
      `geometry.manifest.components.${i}.usageName`,
    );
    const elementId = nonEmpty(
      map,
      `geometry.manifest.components.${i}.elementId`,
    );
    const label = nonEmpty(map, `geometry.manifest.components.${i}.label`);
    components.push({ usageName, elementId, label });
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
  const partDefinitions: GeometryDecisionPartDefinition[] = [];
  const occurrences: GeometryDecisionOccurrence[] = [];
  let placementConvention:
    | "right-handed-mm-extrinsic-xyz-degrees"
    | undefined;
  let partExportFormats: string[] = [];
  let predecessor: GeometryDecisionPredecessor | undefined;
  if (schemaVersion === "geometry-manifest/1.0") {
    for (const [index, component] of components.entries()) {
      if (!/^[a-z][A-Za-z0-9_]*$/.test(component.usageName)) {
        throw new Error(
          `geometry.manifest.components.${index}.usageName has an invalid value`,
        );
      }
    }
    uniqueIds(
      components.map((component) => component.elementId),
      "component elementId",
    );
    const partMeshCount = nonNegativeInt(
      map,
      "geometry.manifest.partMeshes.count",
    );
    const partMeshDigests: string[] = [];
    expectedKeys.add("geometry.manifest.partMeshes.count");
    for (let i = 0; i < partMeshCount; i++) {
      exactPattern(
        map,
        `geometry.manifest.partMeshes.${i}.semanticKey`,
        /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
      );
      nonEmpty(map, `geometry.manifest.partMeshes.${i}.name`);
      partMeshDigests.push(
        hex64(map, `geometry.manifest.partMeshes.${i}.fingerprint`),
      );
      for (const field of ["semanticKey", "name", "fingerprint"]) {
        expectedKeys.add(`geometry.manifest.partMeshes.${i}.${field}`);
      }
    }
    uniqueIds(
      [...assemblyFiles.map((file) => file.digest), ...partMeshDigests],
      "geometry artifact fingerprint",
    );
  } else {
    const predecessorPresent = strictBoolean(
      map,
      "geometry.manifest.predecessor.present",
    );
    expectedKeys.add("geometry.manifest.predecessor.present");
    if (predecessorPresent) {
      predecessor = {
        artifactId: nonEmpty(
          map,
          "geometry.manifest.predecessor.artifactId",
        ),
        digest: hex64(map, "geometry.manifest.predecessor.fingerprint"),
      };
      expectedKeys.add("geometry.manifest.predecessor.artifactId");
      expectedKeys.add("geometry.manifest.predecessor.fingerprint");
    }
    placementConvention = exactString(
      map,
      "geometry.manifest.placementConvention",
      "right-handed-mm-extrinsic-xyz-degrees" as const,
    );
    expectedKeys.add("geometry.manifest.placementConvention");
    partExportFormats = parseFormats(
      nonEmpty(map, "geometry.manifest.partExportFormats"),
      "geometry.manifest.partExportFormats",
    );
    if (!partExportFormats.includes("step")) {
      throw new Error("geometry.manifest.partExportFormats must include step");
    }
    expectedKeys.add("geometry.manifest.partExportFormats");
    if (!exportFormats.includes("step")) {
      throw new Error(
        "geometry.manifest.exportFormats must include step in v2",
      );
    }
    const definitionCount = nonNegativeInt(
      map,
      "geometry.manifest.partDefinitions.count",
    );
    expectedKeys.add("geometry.manifest.partDefinitions.count");
    for (let i = 0; i < definitionCount; i++) {
      const prefix = `geometry.manifest.partDefinitions.${i}`;
      const elementId = nonEmpty(map, `${prefix}.elementId`);
      const label = nonEmpty(map, `${prefix}.label`);
      const definitionScriptDigest = hex64(map, `${prefix}.scriptHash`);
      const fileCount = nonNegativeInt(map, `${prefix}.files.count`);
      const files: GeometryDecisionAssemblyFile[] = [];
      for (let j = 0; j < fileCount; j++) {
        const filePrefix = `${prefix}.files.${j}`;
        files.push({
          format: oneOfFormat(map, `${filePrefix}.format`),
          name: nonEmpty(map, `${filePrefix}.name`),
          digest: hex64(map, `${filePrefix}.fingerprint`),
        });
        for (const field of ["format", "name", "fingerprint"]) {
          expectedKeys.add(`${filePrefix}.${field}`);
        }
      }
      partDefinitions.push({
        elementId,
        label,
        scriptDigest: definitionScriptDigest,
        files,
      });
      assertFormatOrder(
        files,
        partExportFormats,
        `${prefix}.files`,
      );
      for (const field of ["elementId", "label", "scriptHash", "files.count"]) {
        expectedKeys.add(`${prefix}.${field}`);
      }
    }
    const occurrenceCount = nonNegativeInt(
      map,
      "geometry.manifest.occurrences.count",
    );
    expectedKeys.add("geometry.manifest.occurrences.count");
    for (let i = 0; i < occurrenceCount; i++) {
      const prefix = `geometry.manifest.occurrences.${i}`;
      const usageElementId = nonEmpty(map, `${prefix}.usageElementId`);
      const partDefinitionElementId = nonEmpty(
        map,
        `${prefix}.partDefinitionElementId`,
      );
      const translationMm = vector3(map, `${prefix}.translationMm`);
      const rotationDeg = vector3(map, `${prefix}.rotationDeg`);
      occurrences.push({
        usageElementId,
        partDefinitionElementId,
        translationMm,
        rotationDeg,
      });
      for (const field of ["usageElementId", "partDefinitionElementId"]) {
        expectedKeys.add(`${prefix}.${field}`);
      }
      for (const vector of ["translationMm", "rotationDeg"]) {
        for (let axis = 0; axis < 3; axis++) {
          expectedKeys.add(`${prefix}.${vector}.${axis}`);
        }
      }
    }

    assertV2IdentityContract(components, partDefinitions, occurrences);
    assertFormatOrder(
      assemblyFiles,
      exportFormats,
      "geometry.manifest.assemblyFiles",
    );
  }
  for (const key of map.keys()) {
    if (!expectedKeys.has(key)) throw new Error(`Unexpected parameter: ${key}`);
  }

  // The primary asset is the first gltf (preferred for in-browser preview) or
  // the first assembly file.
  const gltfFile = assemblyFiles.find((f) => f.format === "gltf");
  const primaryFile = gltfFile ?? assemblyFiles[0];
  const primaryAssetPreviewPath = primaryFile
    ? `/api/draft-assets/${primaryFile.digest}`
    : undefined;

  return {
    kind: "valid",
    schemaVersion,
    draftDigest,
    architecture: { snapshotId, revision, artifactDigest },
    predecessor,
    unitSystem,
    exportFormats,
    scriptDigest,
    assemblyFiles,
    components,
    partDefinitions,
    occurrences,
    placementConvention,
    partExportFormats,
    primaryAssetPreviewPath,
    primaryAssetFormat: primaryFile?.format,
  };
}

/** Strict browser mirror of `encodeGeometryPartDecisionParameters`. */
function parseTargetPartDecision(
  map: ReadonlyMap<string, string | number | boolean>,
  base: {
    readonly draftDigest: string;
    readonly snapshotId: string;
    readonly revision: number;
    readonly artifactDigest: string;
    readonly unitSystem: "mm";
    readonly exportFormats: readonly string[];
  },
): GeometryDecisionValid {
  const expectedKeys = new Set<string>([
    "geometry.draft.digest",
    "geometry.manifest.schemaVersion",
    "geometry.manifest.architectureBasis.snapshotId",
    "geometry.manifest.architectureBasis.revision",
    "geometry.manifest.architectureBasis.artifactFingerprint",
    "geometry.manifest.predecessor.present",
    "geometry.manifest.unitSystem",
    "geometry.manifest.exportFormats",
    "geometry.manifest.target.partDefinitionElementId",
    "geometry.manifest.target.label",
    "geometry.manifest.target.scriptHash",
    "geometry.manifest.target.files.count",
  ]);
  let predecessor: GeometryDecisionPredecessor | undefined;
  if (strictBoolean(map, "geometry.manifest.predecessor.present")) {
    predecessor = {
      artifactId: nonEmpty(map, "geometry.manifest.predecessor.artifactId"),
      digest: hex64(map, "geometry.manifest.predecessor.fingerprint"),
    };
    expectedKeys.add("geometry.manifest.predecessor.artifactId");
    expectedKeys.add("geometry.manifest.predecessor.fingerprint");
  }
  const partDefinitionElementId = nonEmpty(
    map,
    "geometry.manifest.target.partDefinitionElementId",
  );
  const label = nonEmpty(map, "geometry.manifest.target.label");
  const scriptDigest = hex64(map, "geometry.manifest.target.scriptHash");
  const fileCount = nonNegativeInt(map, "geometry.manifest.target.files.count");
  const files: GeometryDecisionAssemblyFile[] = [];
  for (let index = 0; index < fileCount; index++) {
    const prefix = `geometry.manifest.target.files.${index}`;
    files.push({
      format: oneOfFormat(map, `${prefix}.format`),
      name: nonEmpty(map, `${prefix}.name`),
      digest: hex64(map, `${prefix}.fingerprint`),
    });
    for (const field of ["format", "name", "fingerprint"]) {
      expectedKeys.add(`${prefix}.${field}`);
    }
  }
  assertFormatOrder(
    files,
    base.exportFormats,
    "geometry.manifest.target.files",
  );
  for (const key of map.keys()) {
    if (!expectedKeys.has(key)) throw new Error(`Unexpected parameter: ${key}`);
  }
  const primaryFile = files.find((file) => file.format === "gltf") ?? files[0];
  return {
    kind: "valid",
    schemaVersion: "geometry-part-manifest/1.0",
    draftDigest: base.draftDigest,
    architecture: {
      snapshotId: base.snapshotId,
      revision: base.revision,
      artifactDigest: base.artifactDigest,
    },
    predecessor,
    unitSystem: base.unitSystem,
    exportFormats: base.exportFormats,
    scriptDigest,
    assemblyFiles: [],
    components: [],
    partDefinitions: [],
    occurrences: [],
    partExportFormats: [],
    targetPart: { partDefinitionElementId, label, scriptDigest, files },
    primaryAssetPreviewPath: primaryFile
      ? `/api/draft-assets/${primaryFile.digest}`
      : undefined,
    primaryAssetFormat: primaryFile?.format,
  };
}

function hex64(
  map: ReadonlyMap<string, string | number | boolean>,
  key: string,
): string {
  const raw = map.get(key);
  if (raw === undefined) throw new Error(`Missing parameter: ${key}`);
  const s = String(raw);
  if (!FINGERPRINT_RE.test(s)) {
    throw new Error(
      `${key} must be a 64-char lowercase hex SHA-256 (got: ${
        s.slice(0, 16)
      }…)`,
    );
  }
  return s;
}

function nonEmpty(
  map: ReadonlyMap<string, string | number | boolean>,
  key: string,
): string {
  const raw = map.get(key);
  if (raw === undefined) throw new Error(`Missing parameter: ${key}`);
  const value = String(raw);
  if (value.trim().length === 0) throw new Error(`${key} must not be empty`);
  return value;
}

function positiveInt(
  map: ReadonlyMap<string, string | number | boolean>,
  key: string,
): number {
  const raw = map.get(key);
  if (raw === undefined) throw new Error(`Missing parameter: ${key}`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error(`${key} must be a positive integer (got: ${raw})`);
  }
  return n;
}

function nonNegativeInt(
  map: ReadonlyMap<string, string | number | boolean>,
  key: string,
): number {
  const raw = map.get(key);
  if (raw === undefined) throw new Error(`Missing parameter: ${key}`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`${key} must be a non-negative integer (got: ${raw})`);
  }
  return n;
}

function exactString<const T extends string>(
  map: ReadonlyMap<string, string | number | boolean>,
  key: string,
  expected: T,
): T {
  const s = nonEmpty(map, key);
  if (s !== expected) {
    throw new Error(`${key} must be "${expected}" (got: ${s})`);
  }
  return expected;
}

function oneOfFormat(
  map: ReadonlyMap<string, string | number | boolean>,
  key: string,
): "step" | "gltf" | "stl" {
  const s = nonEmpty(map, key);
  if (s !== "step" && s !== "gltf" && s !== "stl") {
    throw new Error(`${key} must be step, gltf, or stl (got: ${s})`);
  }
  return s;
}

function oneOfSchema(
  map: ReadonlyMap<string, string | number | boolean>,
  key: string,
):
  | "geometry-manifest/1.0"
  | "geometry-manifest/2.0"
  | "geometry-part-manifest/1.0" {
  const value = nonEmpty(map, key);
  if (
    value !== "geometry-manifest/1.0" && value !== "geometry-manifest/2.0" &&
    value !== "geometry-part-manifest/1.0"
  ) {
    throw new Error(`${key} is not a supported manifest schema`);
  }
  return value;
}

function parseFormats(
  raw: string,
  key: string,
  trimLegacyWhitespace = false,
): string[] {
  const parts = raw.split(",");
  const formats = trimLegacyWhitespace
    ? parts.map((value) => value.trim())
    : parts;
  if (
    formats.length === 0 || new Set(formats).size !== formats.length ||
    formats.some((format) =>
      format !== "step" && format !== "gltf" && format !== "stl"
    )
  ) {
    throw new Error(`${key} must contain unique step, gltf, or stl values`);
  }
  return formats;
}

function strictBoolean(
  map: ReadonlyMap<string, string | number | boolean>,
  key: string,
): boolean {
  const value = map.get(key);
  if (value !== true && value !== false) {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
}

function assertFormatOrder(
  files: readonly GeometryDecisionAssemblyFile[],
  requestedFormats: readonly string[],
  context: string,
): void {
  if (files.length !== requestedFormats.length) {
    throw new Error(`${context} must match the exact requested format count`);
  }
  for (let index = 0; index < files.length; index++) {
    if (files[index]?.format !== requestedFormats[index]) {
      throw new Error(`${context}.${index} is not in requested format order`);
    }
  }
  if (files.filter((file) => file.format === "step").length !== 1) {
    throw new Error(`${context} must carry exactly one authoritative STEP`);
  }
}

function assertV2IdentityContract(
  components: readonly GeometryDecisionComponent[],
  partDefinitions: readonly GeometryDecisionPartDefinition[],
  occurrences: readonly GeometryDecisionOccurrence[],
): void {
  if (components.length === 0) {
    throw new Error("geometry.manifest.components must not be empty in v2");
  }
  if (partDefinitions.length === 0) {
    throw new Error(
      "geometry.manifest.partDefinitions must not be empty in v2",
    );
  }

  const componentIds = uniqueIds(
    components.map((component) => component.elementId),
    "PartUsage elementId",
  );
  const definitionIds = uniqueIds(
    partDefinitions.map((definition) => definition.elementId),
    "PartDefinition elementId",
  );
  const crossKindCollision = [...definitionIds].find((id) =>
    componentIds.has(id)
  );
  if (crossKindCollision) {
    throw new Error(
      `Semantic elementId ${crossKindCollision} is reused across PartUsage and PartDefinition`,
    );
  }

  const occurrenceUsageIds = uniqueIds(
    occurrences.map((occurrence) => occurrence.usageElementId),
    "occurrence PartUsage",
  );
  const referencedDefinitionIds = new Set<string>();
  for (const occurrence of occurrences) {
    if (!definitionIds.has(occurrence.partDefinitionElementId)) {
      throw new Error(
        `Occurrence ${occurrence.usageElementId} references missing PartDefinition ${occurrence.partDefinitionElementId}`,
      );
    }
    referencedDefinitionIds.add(occurrence.partDefinitionElementId);
  }
  if (!sameSet(componentIds, occurrenceUsageIds)) {
    throw new Error(
      "Geometry occurrences must cover every component PartUsage exactly once",
    );
  }
  if (!sameSet(definitionIds, referencedDefinitionIds)) {
    throw new Error(
      "Every geometry PartDefinition must be referenced by at least one occurrence",
    );
  }
}

function uniqueIds(values: readonly string[], context: string): Set<string> {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value)) throw new Error(`Duplicate ${context}: ${value}`);
    ids.add(value);
  }
  return ids;
}

function sameSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return left.size === right.size &&
    [...left].every((value) => right.has(value));
}

function vector3(
  map: ReadonlyMap<string, string | number | boolean>,
  prefix: string,
): [number, number, number] {
  return [0, 1, 2].map((axis) => finiteNumber(map, `${prefix}.${axis}`)) as [
    number,
    number,
    number,
  ];
}

function finiteNumber(
  map: ReadonlyMap<string, string | number | boolean>,
  key: string,
): number {
  const value = map.get(key);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }
  return value;
}

function exactPattern(
  map: ReadonlyMap<string, string | number | boolean>,
  key: string,
  pattern: RegExp,
): string {
  const value = nonEmpty(map, key);
  if (!pattern.test(value)) throw new Error(`${key} has an invalid value`);
  return value;
}
