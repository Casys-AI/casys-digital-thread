/**
 * Bounded hierarchical CAD module evidence.
 *
 * One exact composite PartDefinition and only its immediate children. The
 * child table references canonical child captures; it never copies descendant
 * manifests or source text. Assembly STEP and presentation bytes are the only
 * new geometry. Lowerer and reopened-admission fields prove derivation and
 * grant no execution authority.
 */

import { GEOMETRY_BUNDLE_PLACEMENT_CONVENTION } from "./geometry-bundle.ts";
import {
  type GeometryPartDraftAdmission,
  parseGeometryPartDraftAdmission,
} from "./geometry-draft-admission.ts";
import { GEOMETRY_PART_CAPTURE_SCHEMA } from "./geometry-part-manifest.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "./geometry-proposal.ts";
import {
  arrayOf,
  closedRecord,
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
  safeVersion,
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

export type GeometryModuleExportFormat = "step" | "gltf" | "stl";
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

export interface GeometryModuleChild {
  readonly usageElementId: string;
  readonly partDefinitionElementId: string;
  readonly placement: GeometryModulePlacement;
  readonly placementCapture: ContentFingerprint;
  readonly childGeometry: GeometryModuleChildGeometry;
}

export interface GeometryModulePredecessor {
  readonly schemaVersion: typeof GEOMETRY_MODULE_CAPTURE_SCHEMA;
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly partDefinitionElementId: string;
}

export interface GeometryModuleFile {
  readonly format: GeometryModuleExportFormat;
  readonly name: string;
  readonly fingerprint: ContentFingerprint;
}

export interface GeometryModuleAssembly {
  readonly programDigest: ContentFingerprint;
  readonly files: ReadonlyArray<GeometryModuleFile>;
}

export interface GeometryModuleLowerer {
  readonly id: string;
  readonly version: string;
  readonly fingerprint: ContentFingerprint;
}

export interface GeometryModuleCompilerProfile {
  readonly profileId: string;
  readonly profileVersion: string;
  readonly profileFingerprint: ContentFingerprint;
}

export interface GeometryModuleReopenedAdmission {
  readonly usageElementId: string;
  readonly admission: GeometryPartDraftAdmission;
}

export interface GeometryModuleManifest {
  readonly schemaVersion: typeof GEOMETRY_MODULE_MANIFEST_SCHEMA;
  readonly architectureBasis: GeometryModuleArchitectureBasis;
  readonly structureCapture: GeometryModuleStructureCapture;
  readonly target: GeometryModuleTarget;
  readonly predecessor?: GeometryModulePredecessor;
  readonly sourceClosure?: ProjectSourceClosureLocator;
  readonly placementAnalysis?: CadPlacementAnalysisCaptureLocator;
  readonly children: ReadonlyArray<GeometryModuleChild>;
  readonly unitSystem: "mm";
  readonly placementConvention: typeof GEOMETRY_MODULE_PLACEMENT_CONVENTION;
  readonly exportFormats: ReadonlyArray<GeometryModuleExportFormat>;
  readonly assembly?: GeometryModuleAssembly;
}

export interface GeometryModuleDecisionParameters {
  readonly draftDigest: string;
  readonly manifest: GeometryModuleManifest;
}

export interface GeometryModuleDraftFile extends GeometryModuleFile {
  readonly bytes: number;
}

export interface GeometryModuleDraftCapture {
  readonly schemaVersion: typeof GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA;
  readonly kind: typeof GEOMETRY_MODULE_DRAFT_KIND;
  readonly capturedAt: string;
  readonly architectureBasis: GeometryModuleArchitectureBasis;
  readonly structureCapture: GeometryModuleStructureCapture;
  readonly target: GeometryModuleTarget;
  readonly predecessor?: GeometryModulePredecessor;
  readonly sourceClosure?: ProjectSourceClosureLocator;
  readonly targetAdmission?: GeometryPartDraftAdmission;
  readonly placementAnalysis?: CadPlacementAnalysisCaptureLocator;
  readonly children: ReadonlyArray<GeometryModuleChild>;
  readonly unitSystem: "mm";
  readonly placementConvention: typeof GEOMETRY_MODULE_PLACEMENT_CONVENTION;
  readonly exportFormats: ReadonlyArray<GeometryModuleExportFormat>;
  readonly lowerer: GeometryModuleLowerer;
  readonly compilerProfile: GeometryModuleCompilerProfile;
  readonly assemblyProgramDigest: ContentFingerprint;
  readonly reopenedAdmissions: ReadonlyArray<GeometryModuleReopenedAdmission>;
  readonly assemblyFiles: ReadonlyArray<GeometryModuleDraftFile>;
  readonly fingerprint: ContentFingerprint;
}

export interface GeometryModuleCaptureAssembly {
  readonly programDigest: ContentFingerprint;
  readonly files: ReadonlyArray<GeometryModuleDraftFile>;
  readonly authoritativeStep: {
    readonly fileIndex: number;
    readonly fingerprint: ContentFingerprint;
    readonly bytes: number;
  };
}

export interface GeometryModuleCapture {
  readonly schemaVersion: typeof GEOMETRY_MODULE_CAPTURE_SCHEMA;
  readonly operation: typeof DESIGN_WRITE_GEOMETRY_OPERATION;
  readonly trustedRunId: string;
  readonly draftDigest: string;
  readonly manifest: GeometryModuleManifest;
  readonly architectureBasis: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
    readonly producerRunId: string;
  };
  readonly structureCapture: GeometryModuleStructureCapture;
  readonly sourceClosure?: ProjectSourceClosureLocator;
  readonly targetAdmission?: GeometryPartDraftAdmission;
  readonly placementAnalysis?: CadPlacementAnalysisCaptureLocator;
  readonly children: ReadonlyArray<GeometryModuleChild>;
  readonly predecessor?: GeometryModulePredecessor;
  readonly lowerer: GeometryModuleLowerer;
  readonly compilerProfile: GeometryModuleCompilerProfile;
  readonly assembly: GeometryModuleCaptureAssembly;
  readonly sealedAt: string;
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

export function parseGeometryModuleManifest(
  value: unknown,
  options: { readonly requireCompleted?: boolean } = {},
): GeometryModuleManifest {
  const root = closedRecord(
    value,
    [
      "schemaVersion",
      "architectureBasis",
      "structureCapture",
      "target",
      "predecessor",
      "sourceClosure",
      "placementAnalysis",
      "children",
      "unitSystem",
      "placementConvention",
      "exportFormats",
      "assembly",
    ],
    [
      "schemaVersion",
      "architectureBasis",
      "structureCapture",
      "target",
      "children",
      "unitSystem",
      "placementConvention",
      "exportFormats",
    ],
    "$geometryModuleManifest",
  );
  literalValue(
    root.schemaVersion,
    GEOMETRY_MODULE_MANIFEST_SCHEMA,
    "$geometryModuleManifest.schemaVersion",
  );
  const architectureBasis = parseArchitectureBasis(
    root.architectureBasis,
    "$geometryModuleManifest.architectureBasis",
  );
  const structureCapture = parseStructureCapture(
    root.structureCapture,
    "$geometryModuleManifest.structureCapture",
  );
  const target = parseTarget(root.target, "$geometryModuleManifest.target");
  const predecessor = root.predecessor === undefined ? undefined : parsePredecessor(
    root.predecessor,
    target.partDefinitionElementId,
    "$geometryModuleManifest.predecessor",
  );
  const sourceClosure = root.sourceClosure === undefined
    ? undefined
    : validateProjectSourceClosureLocator(
      root.sourceClosure,
      "$geometryModuleManifest.sourceClosure",
    );
  const children = parseChildren(
    root.children,
    "$geometryModuleManifest.children",
  );
  const placementAnalysis = parseOptionalPlacementAnalysis(
    root.placementAnalysis,
    children,
    "$geometryModuleManifest.placementAnalysis",
  );
  literalValue(root.unitSystem, "mm", "$geometryModuleManifest.unitSystem");
  literalValue(
    root.placementConvention,
    GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    "$geometryModuleManifest.placementConvention",
  );
  const exportFormats = parseFormats(
    root.exportFormats,
    "$geometryModuleManifest.exportFormats",
  );
  const assembly = Object.hasOwn(root, "assembly")
    ? parseAssembly(root.assembly, exportFormats, "$geometryModuleManifest.assembly")
    : undefined;
  if (options.requireCompleted && assembly === undefined) {
    invalid(
      "manifest_incomplete",
      "Completed geometry-module manifest requires assembly program digest and files.",
    );
  }
  recrossChildPlacementCaptures(children, placementAnalysis);
  return deepFreeze({
    schemaVersion: GEOMETRY_MODULE_MANIFEST_SCHEMA,
    architectureBasis,
    structureCapture,
    target,
    ...(predecessor === undefined ? {} : { predecessor }),
    ...(sourceClosure === undefined ? {} : { sourceClosure }),
    ...(placementAnalysis === undefined ? {} : { placementAnalysis }),
    children,
    unitSystem: "mm",
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    exportFormats,
    ...(assembly === undefined ? {} : { assembly }),
  });
}

export function assertGeometryModuleManifest(
  manifest: GeometryModuleManifest,
  options: { readonly requireCompleted?: boolean } = {},
): void {
  parseGeometryModuleManifest(manifest, options);
}

export function encodeGeometryModuleDecisionParameters(
  draftDigest: string,
  manifest: GeometryModuleManifest,
): ReadonlyArray<{ key: string; label: string; value: string | number | boolean }> {
  digest(draftDigest, "geometry.draft.digest");
  const complete = parseGeometryModuleManifest(manifest, { requireCompleted: true });
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
    "geometry.manifest.structureCapture.artifactId",
    "Structure capture artifact ID",
    complete.structureCapture.artifactId,
  );
  add(
    "geometry.manifest.structureCapture.fingerprint",
    "Structure capture SHA-256",
    complete.structureCapture.fingerprint.digest,
  );
  add(
    "geometry.manifest.sourceClosure.present",
    "Admitted source-closure present",
    complete.sourceClosure !== undefined,
  );
  if (complete.sourceClosure) {
    encodeLocator(add, "sourceClosure", complete.sourceClosure);
  }
  add(
    "geometry.manifest.placementAnalysis.present",
    "Placement analysis present",
    complete.placementAnalysis !== undefined,
  );
  if (complete.placementAnalysis) {
    encodeLocator(add, "placementAnalysis", complete.placementAnalysis);
  }
  add(
    "geometry.manifest.predecessor.present",
    "Same-target predecessor present",
    complete.predecessor !== undefined,
  );
  if (complete.predecessor) {
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
    "geometry.manifest.placementConvention",
    "Placement convention",
    complete.placementConvention,
  );
  add(
    "geometry.manifest.exportFormats",
    "Module export formats",
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
    "geometry.manifest.assembly.programDigest",
    "Assembly program SHA-256",
    complete.assembly!.programDigest.digest,
  );
  add(
    "geometry.manifest.assembly.files.count",
    "Assembly file count",
    complete.assembly!.files.length,
  );
  complete.assembly!.files.forEach((file, index) => {
    const prefix = `geometry.manifest.assembly.files.${index}`;
    add(`${prefix}.format`, `Assembly file ${index} format`, file.format);
    add(`${prefix}.name`, `Assembly file ${index} name`, file.name);
    add(
      `${prefix}.fingerprint`,
      `Assembly file ${index} SHA-256`,
      file.fingerprint.digest,
    );
  });
  add(
    "geometry.manifest.children.count",
    "Immediate child count",
    complete.children.length,
  );
  complete.children.forEach((child, index) => {
    const prefix = `geometry.manifest.children.${index}`;
    add(
      `${prefix}.usageElementId`,
      `Child ${index} PartUsage ID`,
      child.usageElementId,
    );
    add(
      `${prefix}.partDefinitionElementId`,
      `Child ${index} PartDefinition ID`,
      child.partDefinitionElementId,
    );
    child.placement.translationMm.forEach((value, axis) =>
      add(
        `${prefix}.translationMm.${axis}`,
        `Child ${index} translation ${axis}`,
        value,
      )
    );
    child.placement.rotationDeg.forEach((value, axis) =>
      add(`${prefix}.rotationDeg.${axis}`, `Child ${index} rotation ${axis}`, value)
    );
    add(
      `${prefix}.placementCapture`,
      `Child ${index} placement-analysis SHA-256`,
      child.placementCapture.digest,
    );
    add(
      `${prefix}.childGeometry.schemaVersion`,
      `Child ${index} capture family`,
      child.childGeometry.schemaVersion,
    );
    add(
      `${prefix}.childGeometry.artifactId`,
      `Child ${index} capture artifact ID`,
      child.childGeometry.artifactId,
    );
    add(
      `${prefix}.childGeometry.fingerprint`,
      `Child ${index} capture SHA-256`,
      child.childGeometry.fingerprint.digest,
    );
  });
  return params;
}

export function parseGeometryModuleDecisionParameters(
  params: ReadonlyMap<string, string | number | boolean>,
): GeometryModuleDecisionParameters {
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
  const number = (key: string) => {
    const value = get(key);
    if (typeof value !== "number" || !Number.isFinite(value)) {
      invalid("invalid_format", `${key} must be a finite number.`);
    }
    return value;
  };
  const fingerprint = (key: string): ContentFingerprint => ({
    algorithm: "sha256",
    digest: digest(string(key), key),
  });
  const bool = (key: string) => {
    const value = get(key);
    if (typeof value !== "boolean") {
      invalid("invalid_format", `${key} must be a boolean.`);
    }
    return value;
  };

  const draftDigest = digest(string("geometry.draft.digest"), "geometry.draft.digest");
  if (string("geometry.manifest.schemaVersion") !== GEOMETRY_MODULE_MANIFEST_SCHEMA) {
    invalid(
      "invalid_schema",
      "Geometry module schema must be geometry-module-manifest/1.0.",
    );
  }
  const architectureBasis = {
    snapshotId: string("geometry.manifest.architectureBasis.snapshotId"),
    revision: integer("geometry.manifest.architectureBasis.revision"),
    artifactFingerprint: fingerprint(
      "geometry.manifest.architectureBasis.artifactFingerprint",
    ),
  };
  const structureCapture = {
    schemaVersion: GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
    artifactId: string("geometry.manifest.structureCapture.artifactId"),
    fingerprint: fingerprint("geometry.manifest.structureCapture.fingerprint"),
  };
  const sourceClosure = bool("geometry.manifest.sourceClosure.present")
    ? parseLocatorParams(string, integer, fingerprint, "sourceClosure")
    : undefined;
  const placementAnalysis = bool("geometry.manifest.placementAnalysis.present")
    ? parseLocatorParams(string, integer, fingerprint, "placementAnalysis")
    : undefined;
  const predecessor = bool("geometry.manifest.predecessor.present")
    ? {
      schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
      artifactId: string("geometry.manifest.predecessor.artifactId"),
      fingerprint: fingerprint("geometry.manifest.predecessor.fingerprint"),
      partDefinitionElementId: string(
        "geometry.manifest.predecessor.partDefinitionElementId",
      ),
    }
    : undefined;
  if (string("geometry.manifest.unitSystem") !== "mm") {
    invalid("invalid_schema", "Geometry module unitSystem must be mm.");
  }
  if (
    string("geometry.manifest.placementConvention") !==
      GEOMETRY_MODULE_PLACEMENT_CONVENTION
  ) {
    invalid(
      "invalid_schema",
      `Geometry module placementConvention must be ${GEOMETRY_MODULE_PLACEMENT_CONVENTION}.`,
    );
  }
  const exportFormats = parseFormats(
    string("geometry.manifest.exportFormats").split(","),
    "geometry.manifest.exportFormats",
  );
  const target = {
    partDefinitionElementId: string("geometry.manifest.target.partDefinitionElementId"),
    label: string("geometry.manifest.target.label"),
  };
  const programDigest = fingerprint("geometry.manifest.assembly.programDigest");
  const fileCount = integer("geometry.manifest.assembly.files.count", true);
  const files: GeometryModuleFile[] = [];
  for (let index = 0; index < fileCount; index++) {
    const prefix = `geometry.manifest.assembly.files.${index}`;
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
  const childCount = integer("geometry.manifest.children.count", true);
  const children: GeometryModuleChild[] = [];
  for (let index = 0; index < childCount; index++) {
    const prefix = `geometry.manifest.children.${index}`;
    children.push({
      usageElementId: string(`${prefix}.usageElementId`),
      partDefinitionElementId: string(`${prefix}.partDefinitionElementId`),
      placement: {
        translationMm: [0, 1, 2].map((axis) =>
          number(`${prefix}.translationMm.${axis}`)
        ) as [
          number,
          number,
          number,
        ],
        rotationDeg: [0, 1, 2].map((axis) =>
          number(`${prefix}.rotationDeg.${axis}`)
        ) as [
          number,
          number,
          number,
        ],
      },
      placementCapture: fingerprint(`${prefix}.placementCapture`),
      childGeometry: {
        schemaVersion: parseChildCaptureSchema(
          string(`${prefix}.childGeometry.schemaVersion`),
          `${prefix}.childGeometry.schemaVersion`,
        ),
        artifactId: string(`${prefix}.childGeometry.artifactId`),
        fingerprint: fingerprint(`${prefix}.childGeometry.fingerprint`),
      },
    });
  }
  for (const key of params.keys()) {
    if (!expected.has(key)) {
      invalid("unexpected_parameter", `Unexpected geometry decision parameter: ${key}`);
    }
  }
  const manifest = parseGeometryModuleManifest({
    schemaVersion: GEOMETRY_MODULE_MANIFEST_SCHEMA,
    architectureBasis,
    structureCapture,
    target,
    ...(predecessor === undefined ? {} : { predecessor }),
    ...(sourceClosure === undefined ? {} : { sourceClosure }),
    ...(placementAnalysis === undefined ? {} : { placementAnalysis }),
    children,
    unitSystem: "mm",
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    exportFormats,
    assembly: {
      programDigest,
      files,
    },
  }, { requireCompleted: true });
  return { draftDigest, manifest };
}

export function parseGeometryModuleDraftCapture(
  value: unknown,
): Omit<GeometryModuleDraftCapture, "fingerprint"> {
  const root = closedRecord(
    unsignedDraftRecord(value),
    [
      "schemaVersion",
      "kind",
      "capturedAt",
      "architectureBasis",
      "structureCapture",
      "target",
      "predecessor",
      "sourceClosure",
      "targetAdmission",
      "placementAnalysis",
      "children",
      "unitSystem",
      "placementConvention",
      "exportFormats",
      "lowerer",
      "compilerProfile",
      "assemblyProgramDigest",
      "reopenedAdmissions",
      "assemblyFiles",
    ],
    [
      "schemaVersion",
      "kind",
      "capturedAt",
      "architectureBasis",
      "structureCapture",
      "target",
      "children",
      "unitSystem",
      "placementConvention",
      "exportFormats",
      "lowerer",
      "compilerProfile",
      "assemblyProgramDigest",
      "reopenedAdmissions",
      "assemblyFiles",
    ],
    "$geometryModuleDraft",
  );
  literalValue(
    root.schemaVersion,
    GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA,
    "$geometryModuleDraft.schemaVersion",
  );
  literalValue(root.kind, GEOMETRY_MODULE_DRAFT_KIND, "$geometryModuleDraft.kind");
  const architectureBasis = parseArchitectureBasis(
    root.architectureBasis,
    "$geometryModuleDraft.architectureBasis",
  );
  const structureCapture = parseStructureCapture(
    root.structureCapture,
    "$geometryModuleDraft.structureCapture",
  );
  const target = parseTarget(root.target, "$geometryModuleDraft.target");
  const predecessor = root.predecessor === undefined ? undefined : parsePredecessor(
    root.predecessor,
    target.partDefinitionElementId,
    "$geometryModuleDraft.predecessor",
  );
  const sourceClosure = root.sourceClosure === undefined
    ? undefined
    : validateProjectSourceClosureLocator(
      root.sourceClosure,
      "$geometryModuleDraft.sourceClosure",
    );
  const targetAdmission = root.targetAdmission === undefined
    ? undefined
    : parseTargetAdmission(
      root.targetAdmission,
      target,
      "$geometryModuleDraft.targetAdmission",
    );
  if ((sourceClosure === undefined) !== (targetAdmission === undefined)) {
    invalid(
      "unresolved",
      "Module authored geometry requires source-closure and target admission together.",
    );
  }
  const children = parseChildren(root.children, "$geometryModuleDraft.children");
  const placementAnalysis = parseOptionalPlacementAnalysis(
    root.placementAnalysis,
    children,
    "$geometryModuleDraft.placementAnalysis",
  );
  recrossChildPlacementCaptures(children, placementAnalysis);
  literalValue(root.unitSystem, "mm", "$geometryModuleDraft.unitSystem");
  literalValue(
    root.placementConvention,
    GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    "$geometryModuleDraft.placementConvention",
  );
  const exportFormats = parseFormats(
    root.exportFormats,
    "$geometryModuleDraft.exportFormats",
  );
  const assemblyFiles = parseDraftFiles(
    root.assemblyFiles,
    exportFormats,
    "$geometryModuleDraft.assemblyFiles",
  );
  const reopenedAdmissions = parseReopenedAdmissions(
    root.reopenedAdmissions,
    children,
    "$geometryModuleDraft.reopenedAdmissions",
  );
  return deepFreeze({
    schemaVersion: GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA,
    kind: GEOMETRY_MODULE_DRAFT_KIND,
    capturedAt: isoDateTime(root.capturedAt, "$geometryModuleDraft.capturedAt"),
    architectureBasis,
    structureCapture,
    target,
    ...(predecessor === undefined ? {} : { predecessor }),
    ...(sourceClosure === undefined ? {} : { sourceClosure }),
    ...(targetAdmission === undefined ? {} : { targetAdmission }),
    ...(placementAnalysis === undefined ? {} : { placementAnalysis }),
    children,
    unitSystem: "mm" as const,
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    exportFormats,
    lowerer: parseLowerer(root.lowerer, "$geometryModuleDraft.lowerer"),
    compilerProfile: parseCompilerProfile(
      root.compilerProfile,
      "$geometryModuleDraft.compilerProfile",
    ),
    assemblyProgramDigest: parseFingerprint(
      root.assemblyProgramDigest,
      "$geometryModuleDraft.assemblyProgramDigest",
    ),
    reopenedAdmissions,
    assemblyFiles,
  });
}

export function geometryModuleManifestFromDraft(
  draft: Omit<GeometryModuleDraftCapture, "fingerprint">,
): GeometryModuleManifest {
  return parseGeometryModuleManifest({
    schemaVersion: GEOMETRY_MODULE_MANIFEST_SCHEMA,
    architectureBasis: draft.architectureBasis,
    structureCapture: draft.structureCapture,
    target: draft.target,
    ...(draft.predecessor === undefined ? {} : { predecessor: draft.predecessor }),
    ...(draft.sourceClosure === undefined
      ? {}
      : { sourceClosure: draft.sourceClosure }),
    ...(draft.placementAnalysis === undefined
      ? {}
      : { placementAnalysis: draft.placementAnalysis }),
    children: draft.children,
    unitSystem: "mm",
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    exportFormats: draft.exportFormats,
    assembly: {
      programDigest: draft.assemblyProgramDigest,
      files: draft.assemblyFiles.map(({ format, name, fingerprint }) => ({
        format,
        name,
        fingerprint,
      })),
    },
  }, { requireCompleted: true });
}

export function parseGeometryModuleCapture(value: unknown): GeometryModuleCapture {
  const root = closedRecord(
    value,
    [
      "schemaVersion",
      "operation",
      "trustedRunId",
      "draftDigest",
      "manifest",
      "architectureBasis",
      "structureCapture",
      "sourceClosure",
      "targetAdmission",
      "placementAnalysis",
      "children",
      "predecessor",
      "lowerer",
      "compilerProfile",
      "assembly",
      "sealedAt",
    ],
    [
      "schemaVersion",
      "operation",
      "trustedRunId",
      "draftDigest",
      "manifest",
      "architectureBasis",
      "structureCapture",
      "children",
      "lowerer",
      "compilerProfile",
      "assembly",
      "sealedAt",
    ],
    "$geometryModuleCapture",
  );
  literalValue(
    root.schemaVersion,
    GEOMETRY_MODULE_CAPTURE_SCHEMA,
    "$geometryModuleCapture.schemaVersion",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$geometryModuleCapture.operation",
  );
  literalValue(
    operation.id,
    DESIGN_WRITE_GEOMETRY_OPERATION.id,
    "$geometryModuleCapture.operation.id",
  );
  literalValue(
    operation.version,
    DESIGN_WRITE_GEOMETRY_OPERATION.version,
    "$geometryModuleCapture.operation.version",
  );
  const manifest = parseGeometryModuleManifest(root.manifest, {
    requireCompleted: true,
  });
  const architectureBasis = exactRecord(
    root.architectureBasis,
    ["artifactId", "fingerprint", "producerRunId"],
    "$geometryModuleCapture.architectureBasis",
  );
  const structureCapture = parseStructureCapture(
    root.structureCapture,
    "$geometryModuleCapture.structureCapture",
  );
  if (
    !fingerprintsEqual(
      structureCapture.fingerprint,
      manifest.structureCapture.fingerprint,
    )
  ) {
    invalid(
      "unresolved",
      "Module capture structure capture must equal the signed manifest structure capture.",
    );
  }
  const targetAdmission = root.targetAdmission === undefined
    ? undefined
    : parseTargetAdmission(
      root.targetAdmission,
      manifest.target,
      "$geometryModuleCapture.targetAdmission",
    );
  const sourceClosure = root.sourceClosure === undefined
    ? undefined
    : validateProjectSourceClosureLocator(
      root.sourceClosure,
      "$geometryModuleCapture.sourceClosure",
    );
  if ((sourceClosure === undefined) !== (targetAdmission === undefined)) {
    invalid(
      "unresolved",
      "Module authored geometry requires source-closure and target admission together.",
    );
  }
  if (
    (sourceClosure === undefined) !== (manifest.sourceClosure === undefined) ||
    (sourceClosure !== undefined &&
      manifest.sourceClosure !== undefined &&
      sourceClosure.casUri !== manifest.sourceClosure.casUri)
  ) {
    invalid(
      "unresolved",
      "Module capture source-closure must equal the signed manifest source-closure.",
    );
  }
  const children = parseChildren(root.children, "$geometryModuleCapture.children");
  if (!sameChildren(children, manifest.children)) {
    invalid(
      "unresolved",
      "Module capture children must equal the signed immediate-child table.",
    );
  }
  const placementAnalysis = parseOptionalPlacementAnalysis(
    root.placementAnalysis,
    children,
    "$geometryModuleCapture.placementAnalysis",
  );
  recrossChildPlacementCaptures(children, placementAnalysis);
  if (
    (placementAnalysis === undefined) !== (manifest.placementAnalysis === undefined) ||
    (placementAnalysis !== undefined &&
      manifest.placementAnalysis !== undefined &&
      placementAnalysis.casUri !== manifest.placementAnalysis.casUri)
  ) {
    invalid(
      "unresolved",
      "Module capture placement analysis must equal the signed manifest placement analysis.",
    );
  }
  const predecessor = root.predecessor === undefined ? undefined : parsePredecessor(
    root.predecessor,
    manifest.target.partDefinitionElementId,
    "$geometryModuleCapture.predecessor",
  );
  if (!sameOptionalPredecessor(predecessor, manifest.predecessor)) {
    invalid(
      "unresolved",
      "Module capture predecessor must equal the signed same-target predecessor.",
    );
  }
  const assembly = parseCaptureAssembly(
    root.assembly,
    manifest,
    "$geometryModuleCapture.assembly",
  );
  return deepFreeze({
    schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
    operation: DESIGN_WRITE_GEOMETRY_OPERATION,
    trustedRunId: safeId(root.trustedRunId, "$geometryModuleCapture.trustedRunId"),
    draftDigest: digest(root.draftDigest, "$geometryModuleCapture.draftDigest"),
    manifest,
    architectureBasis: {
      artifactId: safeId(
        architectureBasis.artifactId,
        "$geometryModuleCapture.architectureBasis.artifactId",
      ),
      fingerprint: parseFingerprint(
        architectureBasis.fingerprint,
        "$geometryModuleCapture.architectureBasis.fingerprint",
      ),
      producerRunId: safeId(
        architectureBasis.producerRunId,
        "$geometryModuleCapture.architectureBasis.producerRunId",
      ),
    },
    structureCapture,
    ...(sourceClosure === undefined ? {} : { sourceClosure }),
    ...(targetAdmission === undefined ? {} : { targetAdmission }),
    ...(placementAnalysis === undefined ? {} : { placementAnalysis }),
    children,
    ...(predecessor === undefined ? {} : { predecessor }),
    lowerer: parseLowerer(root.lowerer, "$geometryModuleCapture.lowerer"),
    compilerProfile: parseCompilerProfile(
      root.compilerProfile,
      "$geometryModuleCapture.compilerProfile",
    ),
    assembly,
    sealedAt: isoDateTime(root.sealedAt, "$geometryModuleCapture.sealedAt"),
  });
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

function parseArchitectureBasis(
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

function parseStructureCapture(
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

function parseTarget(value: unknown, path: string): GeometryModuleTarget {
  const target = exactRecord(value, ["partDefinitionElementId", "label"], path);
  return {
    partDefinitionElementId: safeId(
      target.partDefinitionElementId,
      `${path}.partDefinitionElementId`,
    ),
    label: nonEmptyText(target.label, `${path}.label`),
  };
}

function parsePredecessor(
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

function parseOptionalPlacementAnalysis(
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

function parseChildren(value: unknown, path: string): GeometryModuleChild[] {
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

function parseChild(value: unknown, path: string): GeometryModuleChild {
  const child = exactRecord(value, [
    "usageElementId",
    "partDefinitionElementId",
    "placement",
    "placementCapture",
    "childGeometry",
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

function recrossChildPlacementCaptures(
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

function parseAssembly(
  value: unknown,
  exportFormats: ReadonlyArray<GeometryModuleExportFormat>,
  path: string,
): GeometryModuleAssembly {
  const assembly = exactRecord(value, ["programDigest", "files"], path);
  const files = parseFiles(assembly.files, `${path}.files`);
  assertFiles(files, exportFormats, `${path}.files`);
  return {
    programDigest: parseFingerprint(assembly.programDigest, `${path}.programDigest`),
    files,
  };
}

function parseDraftFiles(
  value: unknown,
  exportFormats: ReadonlyArray<GeometryModuleExportFormat>,
  path: string,
): GeometryModuleDraftFile[] {
  const files = arrayOf(value, path).map((candidate, index) => {
    const file = exactRecord(
      candidate,
      ["format", "name", "fingerprint", "bytes"],
      `${path}[${index}]`,
    );
    const parsed = parseFile(file, `${path}[${index}]`);
    return {
      ...parsed,
      bytes: positiveInteger(file.bytes, `${path}[${index}].bytes`),
    };
  });
  assertFiles(files, exportFormats, path);
  return files;
}

function parseCaptureAssembly(
  value: unknown,
  manifest: GeometryModuleManifest,
  path: string,
): GeometryModuleCaptureAssembly {
  const assembly = exactRecord(
    value,
    ["programDigest", "files", "authoritativeStep"],
    path,
  );
  const files = parseDraftFiles(
    assembly.files,
    manifest.exportFormats,
    `${path}.files`,
  );
  const programDigest = parseFingerprint(
    assembly.programDigest,
    `${path}.programDigest`,
  );
  if (
    manifest.assembly === undefined ||
    !fingerprintsEqual(programDigest, manifest.assembly.programDigest)
  ) {
    invalid(
      "unresolved",
      `${path}.programDigest must equal the signed assembly program digest.`,
    );
  }
  if (files.length !== manifest.assembly.files.length) {
    invalid("unresolved", `${path}.files must equal the signed assembly files.`);
  }
  files.forEach((file, index) => {
    const signed = manifest.assembly!.files[index]!;
    if (
      file.format !== signed.format ||
      file.name !== signed.name ||
      !fingerprintsEqual(file.fingerprint, signed.fingerprint)
    ) {
      invalid(
        "unresolved",
        `${path}.files[${index}] must equal the signed assembly file.`,
      );
    }
  });
  const step = exactRecord(
    assembly.authoritativeStep,
    ["fileIndex", "fingerprint", "bytes"],
    `${path}.authoritativeStep`,
  );
  const fileIndex = nonNegativeInteger(
    step.fileIndex,
    `${path}.authoritativeStep.fileIndex`,
  );
  const authoritative = files[fileIndex];
  if (authoritative === undefined || authoritative.format !== "step") {
    invalid(
      "invalid_format",
      `${path}.authoritativeStep must name the unique assembly STEP.`,
    );
  }
  const fingerprint = parseFingerprint(
    step.fingerprint,
    `${path}.authoritativeStep.fingerprint`,
  );
  const bytes = positiveInteger(step.bytes, `${path}.authoritativeStep.bytes`);
  if (
    !fingerprintsEqual(fingerprint, authoritative.fingerprint) ||
    bytes !== authoritative.bytes
  ) {
    invalid(
      "unresolved",
      `${path}.authoritativeStep must reopen the exact assembly STEP metadata.`,
    );
  }
  return { programDigest, files, authoritativeStep: { fileIndex, fingerprint, bytes } };
}

function parseFiles(value: unknown, path: string): GeometryModuleFile[] {
  return arrayOf(value, path).map((candidate, index) =>
    parseFile(
      exactRecord(candidate, ["format", "name", "fingerprint"], `${path}[${index}]`),
      `${path}[${index}]`,
    )
  );
}

function parseFile(file: Record<string, unknown>, path: string): GeometryModuleFile {
  const format = file.format;
  if (format !== "step" && format !== "gltf" && format !== "stl") {
    invalid("invalid_format", `${path}.format is unsupported.`);
  }
  return {
    format,
    name: nonEmptyText(file.name, `${path}.name`),
    fingerprint: parseAssetFingerprint(file.fingerprint, `${path}.fingerprint`),
  };
}

function parseFormats(value: unknown, path: string): GeometryModuleExportFormat[] {
  const formats: GeometryModuleExportFormat[] = [];
  for (const [index, candidate] of arrayOf(value, path).entries()) {
    if (candidate !== "step" && candidate !== "gltf" && candidate !== "stl") {
      invalid("invalid_format", `${path}[${index}] is unsupported.`);
    }
    formats.push(candidate);
  }
  if (formats.length === 0) {
    invalid("invalid_format", `${path} must be non-empty and duplicate-free.`);
  }
  rejectDuplicates(formats, path);
  if (!formats.includes("step")) {
    invalid("invalid_format", `${path} must include authoritative STEP.`);
  }
  return formats;
}

function assertFiles(
  files: ReadonlyArray<GeometryModuleFile>,
  exportFormats: ReadonlyArray<GeometryModuleExportFormat>,
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
  });
  if (files.filter((file) => file.format === "step").length !== 1) {
    invalid("invalid_format", `${path} must carry exactly one authoritative STEP.`);
  }
}

function parseLowerer(value: unknown, path: string): GeometryModuleLowerer {
  const lowerer = exactRecord(value, ["id", "version", "fingerprint"], path);
  return {
    id: safeId(lowerer.id, `${path}.id`),
    version: safeVersion(lowerer.version, `${path}.version`),
    fingerprint: parseFingerprint(lowerer.fingerprint, `${path}.fingerprint`),
  };
}

function parseCompilerProfile(
  value: unknown,
  path: string,
): GeometryModuleCompilerProfile {
  const profile = exactRecord(
    value,
    ["profileId", "profileVersion", "profileFingerprint"],
    path,
  );
  return {
    profileId: safeId(profile.profileId, `${path}.profileId`),
    profileVersion: safeVersion(profile.profileVersion, `${path}.profileVersion`),
    profileFingerprint: parseFingerprint(
      profile.profileFingerprint,
      `${path}.profileFingerprint`,
    ),
  };
}

function parseReopenedAdmissions(
  value: unknown,
  children: ReadonlyArray<GeometryModuleChild>,
  path: string,
): GeometryModuleReopenedAdmission[] {
  const rows = arrayOf(value, path);
  if (rows.length !== children.length) {
    invalid(
      "unresolved",
      `${path} must recross one admission per immediate child usage.`,
    );
  }
  return rows.map((candidate, index) => {
    const row = exactRecord(
      candidate,
      ["usageElementId", "admission"],
      `${path}[${index}]`,
    );
    const usageElementId = safeId(
      row.usageElementId,
      `${path}[${index}].usageElementId`,
    );
    const admission = parseGeometryPartDraftAdmission(
      row.admission,
      `${path}[${index}].admission`,
    );
    const child = children[index]!;
    if (
      usageElementId !== child.usageElementId ||
      admission.target.partDefinitionElementId !== child.partDefinitionElementId
    ) {
      invalid(
        "unresolved",
        `${path}[${index}] must name the exact child usage and definition.`,
      );
    }
    return { usageElementId, admission };
  });
}

function parseTargetAdmission(
  value: unknown,
  target: GeometryModuleTarget,
  path: string,
): GeometryPartDraftAdmission {
  const admission = parseGeometryPartDraftAdmission(value, path);
  if (
    admission.target.partDefinitionElementId !== target.partDefinitionElementId ||
    admission.target.label !== target.label
  ) {
    invalid("unresolved", `${path} must name the exact module PartDefinition.`);
  }
  return admission;
}

function parseLocatorParams(
  string: (key: string) => string,
  integer: (key: string, allowZero?: boolean) => number,
  fingerprint: (key: string) => ContentFingerprint,
  field: "sourceClosure" | "placementAnalysis",
): ProjectSourceClosureLocator | CadPlacementAnalysisCaptureLocator {
  const prefix = `geometry.manifest.${field}`;
  if (field === "sourceClosure") {
    return validateProjectSourceClosureLocator({
      schemaVersion: string(`${prefix}.schemaVersion`),
      kind: string(`${prefix}.kind`),
      fingerprint: fingerprint(`${prefix}.fingerprint`),
      byteCount: integer(`${prefix}.byteCount`, true),
      casUri: string(`${prefix}.casUri`),
    }, `$${field}`);
  }
  return validateCadPlacementAnalysisCaptureLocator({
    schemaVersion: string(`${prefix}.schemaVersion`),
    kind: string(`${prefix}.kind`),
    fingerprint: fingerprint(`${prefix}.fingerprint`),
    byteCount: integer(`${prefix}.byteCount`, true),
    casUri: string(`${prefix}.casUri`),
  }, `$${field}`);
}

function encodeLocator(
  add: (key: string, label: string, value: string | number | boolean) => void,
  field: "sourceClosure" | "placementAnalysis",
  locator: {
    readonly schemaVersion: string;
    readonly kind: string;
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
    readonly casUri: string;
  },
): void {
  const prefix = `geometry.manifest.${field}`;
  add(`${prefix}.schemaVersion`, `${field} schema version`, locator.schemaVersion);
  add(`${prefix}.kind`, `${field} kind`, locator.kind);
  add(`${prefix}.fingerprint`, `${field} SHA-256`, locator.fingerprint.digest);
  add(`${prefix}.byteCount`, `${field} byte count`, locator.byteCount);
  add(`${prefix}.casUri`, `${field} CAS URI`, locator.casUri);
}

function sameChildren(
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
      );
  });
}

function sameOptionalPredecessor(
  left: GeometryModulePredecessor | undefined,
  right: GeometryModulePredecessor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.artifactId === right.artifactId &&
    left.partDefinitionElementId === right.partDefinitionElementId &&
    fingerprintsEqual(left.fingerprint, right.fingerprint);
}

function unsignedDraftRecord(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  if (!Object.hasOwn(value, "fingerprint")) return value;
  const { fingerprint: _fingerprint, ...rest } = value as Record<string, unknown>;
  return rest;
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

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  return { algorithm: "sha256", digest: digest(fingerprint.digest, `${path}.digest`) };
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

function digest(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    invalid("invalid_fingerprint", `${path} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function isoDateTime(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (Number.isNaN(Date.parse(text))) {
    invalid("invalid_format", `${path} must be an ISO-8601 timestamp.`);
  }
  return text;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    invalid("invalid_format", `${path} must be a non-negative integer.`);
  }
  return Number(value);
}

function invalid(code: GeometryModuleEvidenceErrorCode, message: string): never {
  throw new GeometryModuleEvidenceError(code, message);
}
