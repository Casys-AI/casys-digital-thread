/**
 * Targeted PartDefinition geometry draft contract.
 *
 * This is deliberately not a smaller geometry bundle. A targeted export has
 * one exact PartDefinition target and no assembly, occurrence, component, or
 * placement meaning. Keeping it in its own family prevents an eventual sealer
 * from inventing an assembly projection from a part-only review.
 */

import type { ContentFingerprint } from "../../thread/thread-snapshot.ts";
import {
  GEOMETRY_PART_CAPTURE_SCHEMA,
  GEOMETRY_TARGET_CAPTURE_SCHEMAS,
  type GeometryTargetPredecessor,
} from "../geometry-capture-contract.ts";
import {
  closedRecord,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText as opaqueElementId,
  positiveInteger,
  safeId,
} from "../../kernel/case-validation.ts";

export const GEOMETRY_PART_MANIFEST_SCHEMA = "geometry-part-manifest/1.0" as const;

/**
 * Reserved canonical-capture family for the later targeted sealer. P2a only
 * recognizes it as a fail-closed predecessor seam; it never writes or seals
 * this envelope.
 */
export { GEOMETRY_PART_CAPTURE_SCHEMA };

export type GeometryPartExportFormat = "step" | "gltf" | "stl";

export interface GeometryPartManifestFile {
  readonly format: GeometryPartExportFormat;
  readonly name: string;
  readonly fingerprint: ContentFingerprint;
}

export interface GeometryPartManifest {
  readonly schemaVersion: typeof GEOMETRY_PART_MANIFEST_SCHEMA;
  readonly architectureBasis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly artifactFingerprint: ContentFingerprint;
  };
  /** Exact prior canonical capture for this same PartDefinition only. */
  readonly predecessor?: GeometryTargetPredecessor;
  readonly target: {
    /** Exact captured SysON PartDefinition identity, never a label join. */
    readonly partDefinitionElementId: string;
    readonly label: string;
    /** Filled only after the exact admitted source was exported. */
    readonly scriptHash?: ContentFingerprint;
    /** One authoritative STEP plus fixed presentation derivatives. */
    readonly files?: ReadonlyArray<GeometryPartManifestFile>;
  };
  readonly unitSystem: "mm";
  /** Server-owned fixed list; STEP remains authoritative. */
  readonly exportFormats: ReadonlyArray<GeometryPartExportFormat>;
}

export interface GeometryPartDecisionParameters {
  readonly draftDigest: string;
  readonly manifest: GeometryPartManifest;
}

export type GeometryPartManifestErrorCode =
  | "invalid_schema"
  | "missing_parameter"
  | "invalid_fingerprint"
  | "invalid_format"
  | "invalid_identity"
  | "unexpected_parameter"
  | "manifest_incomplete";

export class GeometryPartManifestError extends Error {
  constructor(readonly code: GeometryPartManifestErrorCode, message: string) {
    super(message);
    this.name = "GeometryPartManifestError";
  }
}

/**
 * Strict runtime parser. It rejects every bundle/assembly-shaped field by
 * construction, even when an untyped caller supplies it through JSON.
 */
export function parseGeometryPartManifest(
  value: unknown,
  options: { readonly requireCompleted?: boolean } = {},
): GeometryPartManifest {
  const root = closedRecord(
    value,
    [
      "schemaVersion",
      "architectureBasis",
      "predecessor",
      "target",
      "unitSystem",
      "exportFormats",
    ],
    ["schemaVersion", "architectureBasis", "target", "unitSystem", "exportFormats"],
    "$geometryPartManifest",
  );
  literalValue(
    root.schemaVersion,
    GEOMETRY_PART_MANIFEST_SCHEMA,
    "$geometryPartManifest.schemaVersion",
  );
  const architectureBasis = parseArchitectureBasis(root.architectureBasis);
  const target = parseTarget(root.target);
  const predecessor = root.predecessor === undefined
    ? undefined
    : parsePredecessor(root.predecessor, target.partDefinitionElementId);
  literalValue(root.unitSystem, "mm", "$geometryPartManifest.unitSystem");
  const exportFormats = parseFormats(
    root.exportFormats,
    "$geometryPartManifest.exportFormats",
  );

  if ((target.scriptHash === undefined) !== (target.files === undefined)) {
    invalid(
      "manifest_incomplete",
      "Target scriptHash and files must be absent together or present together.",
    );
  }
  if (target.files !== undefined) {
    assertFiles(target.files, exportFormats, "$geometryPartManifest.target.files");
    if (target.files.filter((file) => file.format === "step").length !== 1) {
      invalid(
        "invalid_format",
        "Target files must carry exactly one authoritative STEP.",
      );
    }
  }
  if (
    options.requireCompleted &&
    (target.scriptHash === undefined || target.files === undefined)
  ) {
    invalid(
      "manifest_incomplete",
      "Completed targeted geometry manifest requires target scriptHash and files.",
    );
  }

  return deepFreeze({
    schemaVersion: GEOMETRY_PART_MANIFEST_SCHEMA,
    architectureBasis,
    ...(predecessor === undefined ? {} : { predecessor }),
    target,
    unitSystem: "mm",
    exportFormats,
  });
}

/** Validate a typed manifest and detect unwanted runtime fields. */
export function assertGeometryPartManifest(
  manifest: GeometryPartManifest,
  options: { readonly requireCompleted?: boolean } = {},
): void {
  parseGeometryPartManifest(manifest, options);
}

/** Exact, flat MRTR grammar for one completed targeted part draft. */
export function encodeGeometryPartDecisionParameters(
  draftDigest: string,
  manifest: GeometryPartManifest,
): ReadonlyArray<{ key: string; label: string; value: string | number | boolean }> {
  digest(draftDigest, "geometry.draft.digest");
  const complete = parseGeometryPartManifest(manifest, { requireCompleted: true });
  const params: Array<{
    key: string;
    label: string;
    value: string | number | boolean;
  }> = [];
  const add = (key: string, label: string, value: string | number | boolean) => {
    params.push({ key, label, value });
  };

  add("geometry.draft.digest", "Draft SHA-256 digest", draftDigest);
  add(
    "geometry.manifest.schemaVersion",
    "Manifest schema version",
    complete.schemaVersion,
  );
  add(
    "geometry.manifest.architectureBasis.snapshotId",
    "Architecture basis snapshot ID",
    complete.architectureBasis.snapshotId,
  );
  add(
    "geometry.manifest.architectureBasis.revision",
    "Architecture basis revision",
    complete.architectureBasis.revision,
  );
  add(
    "geometry.manifest.architectureBasis.artifactFingerprint",
    "Architecture artifact SHA-256",
    complete.architectureBasis.artifactFingerprint.digest,
  );
  add(
    "geometry.manifest.predecessor.present",
    "Same-target predecessor present",
    complete.predecessor !== undefined,
  );
  if (complete.predecessor) {
    add(
      "geometry.manifest.predecessor.schemaVersion",
      "Same-target predecessor capture schema",
      complete.predecessor.schemaVersion,
    );
    add(
      "geometry.manifest.predecessor.artifactId",
      "Same-target predecessor artifact ID",
      complete.predecessor.artifactId,
    );
    add(
      "geometry.manifest.predecessor.fingerprint",
      "Same-target predecessor SHA-256",
      complete.predecessor.fingerprint.digest,
    );
    add(
      "geometry.manifest.predecessor.partDefinitionElementId",
      "Same-target predecessor PartDefinition",
      complete.predecessor.partDefinitionElementId,
    );
  }
  add("geometry.manifest.unitSystem", "Unit system", complete.unitSystem);
  add(
    "geometry.manifest.exportFormats",
    "Part export formats",
    complete.exportFormats.join(","),
  );
  add(
    "geometry.manifest.target.partDefinitionElementId",
    "Target PartDefinition element ID",
    complete.target.partDefinitionElementId,
  );
  add(
    "geometry.manifest.target.label",
    "Target PartDefinition label",
    complete.target.label,
  );
  add(
    "geometry.manifest.target.scriptHash",
    "Target script SHA-256",
    complete.target.scriptHash!.digest,
  );
  add(
    "geometry.manifest.target.files.count",
    "Target file count",
    complete.target.files!.length,
  );
  complete.target.files!.forEach((file, index) => {
    const prefix = `geometry.manifest.target.files.${index}`;
    add(`${prefix}.format`, `Target file ${index} format`, file.format);
    add(`${prefix}.name`, `Target file ${index} name`, file.name);
    add(
      `${prefix}.fingerprint`,
      `Target file ${index} SHA-256`,
      file.fingerprint.digest,
    );
  });
  return params;
}

/** Strict inverse of encodeGeometryPartDecisionParameters. */
export function parseGeometryPartDecisionParameters(
  params: ReadonlyMap<string, string | number | boolean>,
): GeometryPartDecisionParameters {
  const expected = new Set<string>();
  const get = (key: string): string | number | boolean => {
    expected.add(key);
    const value = params.get(key);
    if (value === undefined) invalid("missing_parameter", `Missing parameter: ${key}`);
    return value;
  };
  const string = (key: string) => {
    const value = get(key);
    if (typeof value !== "string" || value.trim() === "") {
      invalid("invalid_format", `${key} must be a non-empty string.`);
    }
    return value;
  };
  const integer = (key: string, allowZero = false) => {
    const value = get(key);
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < (allowZero ? 0 : 1)
    ) {
      invalid(
        "invalid_format",
        `${key} must be a ${allowZero ? "non-negative" : "positive"} integer.`,
      );
    }
    return value;
  };
  const fingerprint = (key: string): ContentFingerprint => ({
    algorithm: "sha256",
    digest: digest(string(key), key),
  });

  const draftDigest = digest(string("geometry.draft.digest"), "geometry.draft.digest");
  if (string("geometry.manifest.schemaVersion") !== GEOMETRY_PART_MANIFEST_SCHEMA) {
    invalid(
      "invalid_schema",
      "Geometry part schema must be geometry-part-manifest/1.0.",
    );
  }
  const architectureBasis = {
    snapshotId: string("geometry.manifest.architectureBasis.snapshotId"),
    revision: integer("geometry.manifest.architectureBasis.revision"),
    artifactFingerprint: fingerprint(
      "geometry.manifest.architectureBasis.artifactFingerprint",
    ),
  };
  const predecessorPresent = get("geometry.manifest.predecessor.present");
  if (typeof predecessorPresent !== "boolean") {
    invalid(
      "invalid_format",
      "geometry.manifest.predecessor.present must be a boolean.",
    );
  }
  const predecessor = predecessorPresent
    ? {
      schemaVersion: string("geometry.manifest.predecessor.schemaVersion"),
      artifactId: string("geometry.manifest.predecessor.artifactId"),
      fingerprint: fingerprint("geometry.manifest.predecessor.fingerprint"),
      partDefinitionElementId: string(
        "geometry.manifest.predecessor.partDefinitionElementId",
      ),
    }
    : undefined;
  if (string("geometry.manifest.unitSystem") !== "mm") {
    invalid("invalid_schema", "Geometry part unitSystem must be mm.");
  }
  const exportFormats = parseFormats(
    string("geometry.manifest.exportFormats").split(","),
    "geometry.manifest.exportFormats",
  );
  const partDefinitionElementId = string(
    "geometry.manifest.target.partDefinitionElementId",
  );
  const label = string("geometry.manifest.target.label");
  const scriptHash = fingerprint("geometry.manifest.target.scriptHash");
  const fileCount = integer("geometry.manifest.target.files.count", true);
  const files: GeometryPartManifestFile[] = [];
  for (let index = 0; index < fileCount; index++) {
    const prefix = `geometry.manifest.target.files.${index}`;
    const format = string(`${prefix}.format`);
    if (format !== "step" && format !== "gltf" && format !== "stl") {
      invalid("invalid_format", `${prefix}.format is unsupported.`);
    }
    files.push({
      format,
      name: string(`${prefix}.name`),
      fingerprint: fingerprint(`${prefix}.fingerprint`),
    });
  }
  for (const key of params.keys()) {
    if (!expected.has(key)) {
      invalid("unexpected_parameter", `Unexpected geometry decision parameter: ${key}`);
    }
  }
  const manifest = parseGeometryPartManifest({
    schemaVersion: GEOMETRY_PART_MANIFEST_SCHEMA,
    architectureBasis,
    ...(predecessor === undefined ? {} : { predecessor }),
    target: { partDefinitionElementId, label, scriptHash, files },
    unitSystem: "mm",
    exportFormats,
  }, { requireCompleted: true });
  return { draftDigest, manifest };
}

function parseArchitectureBasis(
  value: unknown,
): GeometryPartManifest["architectureBasis"] {
  const basis = exactRecord(
    value,
    ["snapshotId", "revision", "artifactFingerprint"],
    "$geometryPartManifest.architectureBasis",
  );
  return {
    snapshotId: safeId(
      basis.snapshotId,
      "$geometryPartManifest.architectureBasis.snapshotId",
    ),
    revision: positiveInteger(
      basis.revision,
      "$geometryPartManifest.architectureBasis.revision",
    ),
    artifactFingerprint: parseFingerprint(
      basis.artifactFingerprint,
      "$geometryPartManifest.architectureBasis.artifactFingerprint",
    ),
  };
}

function parsePredecessor(
  value: unknown,
  targetId: string,
): NonNullable<GeometryPartManifest["predecessor"]> {
  const predecessor = exactRecord(
    value,
    ["schemaVersion", "artifactId", "fingerprint", "partDefinitionElementId"],
    "$geometryPartManifest.predecessor",
  );
  const schemaVersion = opaqueElementId(
    predecessor.schemaVersion,
    "$geometryPartManifest.predecessor.schemaVersion",
  );
  if (
    !GEOMETRY_TARGET_CAPTURE_SCHEMAS.includes(
      schemaVersion as (typeof GEOMETRY_TARGET_CAPTURE_SCHEMAS)[number],
    )
  ) {
    invalid(
      "invalid_schema",
      "$geometryPartManifest.predecessor.schemaVersion must name a canonical target capture family.",
    );
  }
  const partDefinitionElementId = opaqueElementId(
    predecessor.partDefinitionElementId,
    "$geometryPartManifest.predecessor.partDefinitionElementId",
  );
  if (partDefinitionElementId !== targetId) {
    invalid(
      "invalid_identity",
      "$geometryPartManifest.predecessor must name the exact target PartDefinition.",
    );
  }
  return {
    schemaVersion: schemaVersion as (typeof GEOMETRY_TARGET_CAPTURE_SCHEMAS)[number],
    artifactId: safeId(
      predecessor.artifactId,
      "$geometryPartManifest.predecessor.artifactId",
    ),
    fingerprint: parseFingerprint(
      predecessor.fingerprint,
      "$geometryPartManifest.predecessor.fingerprint",
    ),
    partDefinitionElementId,
  };
}

function parseTarget(value: unknown): GeometryPartManifest["target"] {
  const target = closedRecord(
    value,
    ["partDefinitionElementId", "label", "scriptHash", "files"],
    ["partDefinitionElementId", "label"],
    "$geometryPartManifest.target",
  );
  const scriptHash = Object.hasOwn(target, "scriptHash")
    ? parseFingerprint(target.scriptHash, "$geometryPartManifest.target.scriptHash")
    : undefined;
  const files = Object.hasOwn(target, "files")
    ? parseFiles(target.files, "$geometryPartManifest.target.files")
    : undefined;
  return {
    partDefinitionElementId: opaqueElementId(
      target.partDefinitionElementId,
      "$geometryPartManifest.target.partDefinitionElementId",
    ),
    label: nonEmptyText(target.label, "$geometryPartManifest.target.label"),
    ...(scriptHash === undefined ? {} : { scriptHash }),
    ...(files === undefined ? {} : { files }),
  };
}

function parseFiles(value: unknown, path: string): GeometryPartManifestFile[] {
  if (!Array.isArray(value)) invalid("invalid_format", `${path} must be an array.`);
  return value.map((candidate, index) => {
    const file = exactRecord(
      candidate,
      ["format", "name", "fingerprint"],
      `${path}[${index}]`,
    );
    const format = file.format;
    if (format !== "step" && format !== "gltf" && format !== "stl") {
      invalid("invalid_format", `${path}[${index}].format is unsupported.`);
    }
    return {
      format,
      name: nonEmptyText(file.name, `${path}[${index}].name`),
      fingerprint: parseFingerprint(file.fingerprint, `${path}[${index}].fingerprint`),
    };
  });
}

function parseFormats(value: unknown, path: string): GeometryPartExportFormat[] {
  if (!Array.isArray(value)) invalid("invalid_format", `${path} must be an array.`);
  const formats: GeometryPartExportFormat[] = [];
  for (const [index, candidate] of value.entries()) {
    if (candidate !== "step" && candidate !== "gltf" && candidate !== "stl") {
      invalid("invalid_format", `${path}[${index}] is unsupported.`);
    }
    formats.push(candidate);
  }
  if (formats.length === 0 || new Set(formats).size !== formats.length) {
    invalid("invalid_format", `${path} must be non-empty and duplicate-free.`);
  }
  if (!formats.includes("step")) {
    invalid("invalid_format", `${path} must include authoritative STEP.`);
  }
  return formats;
}

function assertFiles(
  files: ReadonlyArray<GeometryPartManifestFile>,
  exportFormats: ReadonlyArray<GeometryPartExportFormat>,
  path: string,
): void {
  if (files.length !== exportFormats.length) {
    invalid("invalid_format", `${path} must match the exact export format count.`);
  }
  files.forEach((file, index) => {
    if (file.format !== exportFormats[index]) {
      invalid(
        "invalid_format",
        `${path}[${index}] is not in fixed export format order.`,
      );
    }
    nonEmptyText(file.name, `${path}[${index}].name`);
    parseFingerprint(file.fingerprint, `${path}[${index}].fingerprint`);
  });
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  return { algorithm: "sha256", digest: digest(fingerprint.digest, `${path}.digest`) };
}

function digest(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    invalid("invalid_fingerprint", `${path} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function nonEmptyText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    invalid("invalid_identity", `${path} must be non-empty text.`);
  }
  return value;
}

function invalid(code: GeometryPartManifestErrorCode, message: string): never {
  throw new GeometryPartManifestError(code, message);
}
