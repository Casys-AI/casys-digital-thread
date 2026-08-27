/**
 * Signed geometry-module decision input.
 *
 * A completed manifest names the input-bundle identity and the produced
 * assembly STEP plus binary GLB fingerprints. It does not carry a program,
 * receipt, or provider envelope.
 */

import {
  GEOMETRY_MODULE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
  GEOMETRY_MODULE_PLACEMENT_CONVENTION,
  GEOMETRY_MODULE_UNIT_SYSTEM,
} from "../geometry-module-contract.ts";
import { GEOMETRY_PART_CAPTURE_SCHEMA } from "../geometry-capture-contract.ts";
import {
  closedRecord,
  deepFreeze,
  exactRecord,
  literalValue,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import type { ProjectSourceClosureLocator } from "../../project-source-workspace/closure.ts";
import { validateProjectSourceClosureLocator } from "../../project-source-workspace/closure.ts";
import {
  type CadPlacementAnalysisCaptureLocator,
  digest,
  GEOMETRY_MODULE_MANIFEST_SCHEMA,
  GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
  type GeometryModuleArchitectureBasis,
  type GeometryModuleChild,
  type GeometryModuleInputBundleIdentity,
  type GeometryModulePredecessor,
  type GeometryModuleStructureCapture,
  type GeometryModuleTarget,
  invalid,
  parseArchitectureBasis,
  parseChildren,
  parseInputBundleIdentity,
  parseOptionalSourceClosure,
  parsePlacementAnalysis,
  parsePredecessor,
  parseSignedAssetFingerprint,
  parseStructureCapture,
  parseTarget,
  recrossChildPlacementCaptures,
  recrossStructureCaptureArchitecture,
} from "./geometry-module-identities.ts";

export interface GeometryModuleAssembly {
  readonly inputBundle: GeometryModuleInputBundleIdentity;
  readonly step: { readonly fingerprint: ContentFingerprint };
  readonly glb: { readonly fingerprint: ContentFingerprint };
}

export interface GeometryModuleManifest {
  readonly schemaVersion: typeof GEOMETRY_MODULE_MANIFEST_SCHEMA;
  readonly architectureBasis: GeometryModuleArchitectureBasis;
  readonly structureCapture: GeometryModuleStructureCapture;
  readonly target: GeometryModuleTarget;
  readonly predecessor?: GeometryModulePredecessor;
  readonly sourceClosure?: ProjectSourceClosureLocator;
  readonly placementAnalysis: CadPlacementAnalysisCaptureLocator;
  readonly children: ReadonlyArray<GeometryModuleChild>;
  readonly unitSystem: typeof GEOMETRY_MODULE_UNIT_SYSTEM;
  readonly placementConvention: typeof GEOMETRY_MODULE_PLACEMENT_CONVENTION;
  readonly assembly?: GeometryModuleAssembly;
}

export interface GeometryModuleDecisionParameters {
  readonly draftDigest: string;
  readonly manifest: GeometryModuleManifest;
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
  recrossStructureCaptureArchitecture(structureCapture, architectureBasis);
  const target = parseTarget(root.target, "$geometryModuleManifest.target");
  const predecessor = root.predecessor === undefined ? undefined : parsePredecessor(
    root.predecessor,
    target.partDefinitionElementId,
    "$geometryModuleManifest.predecessor",
  );
  const sourceClosure = parseOptionalSourceClosure(
    root.sourceClosure,
    "$geometryModuleManifest.sourceClosure",
  );
  const children = parseChildren(
    root.children,
    "$geometryModuleManifest.children",
  );
  const placementAnalysis = parsePlacementAnalysis(
    root.placementAnalysis,
    "$geometryModuleManifest.placementAnalysis",
  );
  literalValue(
    root.unitSystem,
    GEOMETRY_MODULE_UNIT_SYSTEM,
    "$geometryModuleManifest.unitSystem",
  );
  literalValue(
    root.placementConvention,
    GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    "$geometryModuleManifest.placementConvention",
  );
  const assembly = Object.hasOwn(root, "assembly")
    ? parseAssembly(root.assembly, children, "$geometryModuleManifest.assembly")
    : undefined;
  if (options.requireCompleted && assembly === undefined) {
    invalid(
      "manifest_incomplete",
      "Completed geometry-module manifest requires the input-bundle identity and assembly STEP plus GLB fingerprints.",
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
    placementAnalysis,
    children,
    unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
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
    "geometry.manifest.structureCapture.uri",
    "Structure capture CAS URI",
    complete.structureCapture.uri,
  );
  add(
    "geometry.manifest.structureCapture.byteCount",
    "Structure capture byte count",
    complete.structureCapture.byteCount,
  );
  add(
    "geometry.manifest.structureCapture.architecture.artifactId",
    "Structure capture architecture artifact ID",
    complete.structureCapture.architecture.artifactId,
  );
  add(
    "geometry.manifest.structureCapture.architecture.fingerprint",
    "Structure capture architecture SHA-256",
    complete.structureCapture.architecture.fingerprint.digest,
  );
  add(
    "geometry.manifest.structureCapture.architecture.uri",
    "Structure capture architecture CAS URI",
    complete.structureCapture.architecture.uri,
  );
  add(
    "geometry.manifest.sourceClosure.present",
    "Module own source-closure present",
    complete.sourceClosure !== undefined,
  );
  if (complete.sourceClosure) {
    encodeLocator(add, "sourceClosure", complete.sourceClosure);
  }
  encodeLocator(add, "placementAnalysis", complete.placementAnalysis);
  add(
    "geometry.manifest.predecessor.present",
    "Same-target predecessor present",
    complete.predecessor !== undefined,
  );
  if (complete.predecessor) {
    add(
      "geometry.manifest.predecessor.schemaVersion",
      "Same-target predecessor capture family",
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
    "geometry.manifest.placementConvention",
    "Placement convention",
    complete.placementConvention,
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
    "geometry.manifest.assembly.inputBundle.fingerprint",
    "Input-bundle SHA-256",
    complete.assembly!.inputBundle.fingerprint.digest,
  );
  add(
    "geometry.manifest.assembly.inputBundle.byteCount",
    "Input-bundle byte count",
    complete.assembly!.inputBundle.byteCount,
  );
  add(
    "geometry.manifest.assembly.inputBundle.manifest",
    "Input-bundle manifest",
    deterministicJson(complete.assembly!.inputBundle.manifest),
  );
  add(
    "geometry.manifest.assembly.step.fingerprint",
    "Assembly STEP SHA-256",
    complete.assembly!.step.fingerprint.digest,
  );
  add(
    "geometry.manifest.assembly.glb.fingerprint",
    "Assembly GLB SHA-256",
    complete.assembly!.glb.fingerprint.digest,
  );
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
    add(
      `${prefix}.authoritativeStep.fingerprint`,
      `Child ${index} authoritative STEP SHA-256`,
      child.authoritativeStep.fingerprint.digest,
    );
    add(
      `${prefix}.authoritativeStep.bytes`,
      `Child ${index} authoritative STEP bytes`,
      child.authoritativeStep.bytes,
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
    uri: string("geometry.manifest.structureCapture.uri"),
    byteCount: integer("geometry.manifest.structureCapture.byteCount"),
    architecture: {
      artifactId: string(
        "geometry.manifest.structureCapture.architecture.artifactId",
      ),
      fingerprint: fingerprint(
        "geometry.manifest.structureCapture.architecture.fingerprint",
      ),
      uri: string("geometry.manifest.structureCapture.architecture.uri"),
    },
  };
  const sourceClosure = bool("geometry.manifest.sourceClosure.present")
    ? parseLocatorParams(string, integer, fingerprint, "sourceClosure")
    : undefined;
  const placementAnalysis = parseLocatorParams(
    string,
    integer,
    fingerprint,
    "placementAnalysis",
  );
  const predecessorSchema = bool("geometry.manifest.predecessor.present")
    ? string("geometry.manifest.predecessor.schemaVersion")
    : undefined;
  if (
    predecessorSchema !== undefined &&
    predecessorSchema !== GEOMETRY_PART_CAPTURE_SCHEMA &&
    predecessorSchema !== GEOMETRY_MODULE_CAPTURE_SCHEMA
  ) {
    invalid(
      "invalid_schema",
      "The same-target predecessor capture family is not canonical geometry.",
    );
  }
  const predecessor = predecessorSchema === undefined ? undefined : {
    schemaVersion: predecessorSchema,
    artifactId: string("geometry.manifest.predecessor.artifactId"),
    fingerprint: fingerprint("geometry.manifest.predecessor.fingerprint"),
    partDefinitionElementId: string(
      "geometry.manifest.predecessor.partDefinitionElementId",
    ),
  };
  if (string("geometry.manifest.unitSystem") !== GEOMETRY_MODULE_UNIT_SYSTEM) {
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
  const target = {
    partDefinitionElementId: string("geometry.manifest.target.partDefinitionElementId"),
    label: string("geometry.manifest.target.label"),
  };
  const childCount = integer("geometry.manifest.children.count");
  const children: GeometryModuleChild[] = [];
  for (let index = 0; index < childCount; index++) {
    const prefix = `geometry.manifest.children.${index}`;
    const schemaVersion = string(`${prefix}.childGeometry.schemaVersion`);
    if (
      schemaVersion !== "geometry-part-capture/1.0" &&
      schemaVersion !== GEOMETRY_MODULE_CAPTURE_SCHEMA
    ) {
      invalid(
        "invalid_schema",
        `${prefix}.childGeometry.schemaVersion must be geometry-part-capture/1.0 or geometry-module-capture/1.0.`,
      );
    }
    children.push({
      usageElementId: string(`${prefix}.usageElementId`),
      partDefinitionElementId: string(`${prefix}.partDefinitionElementId`),
      placement: {
        translationMm: [0, 1, 2].map((axis) =>
          number(`${prefix}.translationMm.${axis}`)
        ) as [number, number, number],
        rotationDeg: [0, 1, 2].map((axis) =>
          number(`${prefix}.rotationDeg.${axis}`)
        ) as [number, number, number],
      },
      placementCapture: fingerprint(`${prefix}.placementCapture`),
      childGeometry: {
        schemaVersion,
        artifactId: string(`${prefix}.childGeometry.artifactId`),
        fingerprint: fingerprint(`${prefix}.childGeometry.fingerprint`),
      },
      authoritativeStep: {
        fingerprint: fingerprint(`${prefix}.authoritativeStep.fingerprint`),
        bytes: integer(`${prefix}.authoritativeStep.bytes`),
      },
    });
  }
  const inputBundle = parseInputBundleIdentity(
    {
      schemaVersion: GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
      fingerprint: fingerprint("geometry.manifest.assembly.inputBundle.fingerprint"),
      byteCount: integer("geometry.manifest.assembly.inputBundle.byteCount"),
      manifest: parseDecisionInputBundleManifest(
        string("geometry.manifest.assembly.inputBundle.manifest"),
      ),
    },
    children,
    "geometry.manifest.assembly.inputBundle",
  );
  const assembly = {
    inputBundle,
    step: {
      fingerprint: fingerprint("geometry.manifest.assembly.step.fingerprint"),
    },
    glb: {
      fingerprint: fingerprint("geometry.manifest.assembly.glb.fingerprint"),
    },
  };
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
    placementAnalysis,
    children,
    unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    assembly,
  }, { requireCompleted: true });
  return { draftDigest, manifest };
}

function parseAssembly(
  value: unknown,
  children: ReadonlyArray<GeometryModuleChild>,
  path: string,
): GeometryModuleAssembly {
  const assembly = exactRecord(value, ["inputBundle", "step", "glb"], path);
  const inputBundle = parseInputBundleIdentity(
    assembly.inputBundle,
    children,
    `${path}.inputBundle`,
  );
  const step = exactRecord(assembly.step, ["fingerprint"], `${path}.step`);
  const glb = exactRecord(assembly.glb, ["fingerprint"], `${path}.glb`);
  const stepFingerprint = parseSignedAssetFingerprint(
    step.fingerprint,
    `${path}.step.fingerprint`,
  );
  const glbFingerprint = parseSignedAssetFingerprint(
    glb.fingerprint,
    `${path}.glb.fingerprint`,
  );
  if (fingerprintsEqual(stepFingerprint, glbFingerprint)) {
    invalid(
      "invalid_identity",
      `${path} STEP and GLB fingerprints must be distinct.`,
    );
  }
  return {
    inputBundle,
    step: { fingerprint: stepFingerprint },
    glb: { fingerprint: glbFingerprint },
  };
}

function parseDecisionInputBundleManifest(value: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    invalid(
      "invalid_format",
      "geometry.manifest.assembly.inputBundle.manifest must be canonical JSON.",
    );
  }
  if (deterministicJson(parsed) !== value) {
    invalid(
      "invalid_format",
      "geometry.manifest.assembly.inputBundle.manifest must be canonical JSON.",
    );
  }
  return parsed;
}

function parseLocatorParams(
  string: (key: string) => string,
  integer: (key: string, allowZero?: boolean) => number,
  fingerprint: (key: string) => ContentFingerprint,
  field: "sourceClosure",
): ProjectSourceClosureLocator;
function parseLocatorParams(
  string: (key: string) => string,
  integer: (key: string, allowZero?: boolean) => number,
  fingerprint: (key: string) => ContentFingerprint,
  field: "placementAnalysis",
): CadPlacementAnalysisCaptureLocator;
function parseLocatorParams(
  string: (key: string) => string,
  integer: (key: string, allowZero?: boolean) => number,
  fingerprint: (key: string) => ContentFingerprint,
  field: "sourceClosure" | "placementAnalysis",
): ProjectSourceClosureLocator | CadPlacementAnalysisCaptureLocator {
  const prefix = `geometry.manifest.${field}`;
  const locator = {
    schemaVersion: string(`${prefix}.schemaVersion`),
    kind: string(`${prefix}.kind`),
    fingerprint: fingerprint(`${prefix}.fingerprint`),
    byteCount: integer(`${prefix}.byteCount`, true),
    casUri: string(`${prefix}.casUri`),
  };
  if (field === "sourceClosure") {
    return validateProjectSourceClosureLocator(locator, `$${field}`);
  }
  return parsePlacementAnalysis(locator, `$${field}`);
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
