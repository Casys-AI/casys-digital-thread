/**
 * Review-only geometry-module draft.
 *
 * It binds the exact input-bundle identity, the validated assembly receipt,
 * reopened child capture plus STEP identities, and the produced assembly
 * STEP plus binary GLB. A successful draft writes no Thread state.
 */

import {
  GEOMETRY_MODULE_PLACEMENT_CONVENTION,
  GEOMETRY_MODULE_UNIT_SYSTEM,
} from "../geometry-module-contract.ts";
import {
  closedRecord,
  deepFreeze,
  literalValue,
} from "../../kernel/case-validation.ts";
import { fingerprintsEqual } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import type { GeometryModuleAssemblyReceipt } from "../module-assembly/geometry-module-assembly-receipt.ts";
import type { ProjectSourceClosureLocator } from "../../project-source-workspace/closure.ts";
import {
  type CadPlacementAnalysisCaptureLocator,
  GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_DRAFT_KIND,
  GEOMETRY_MODULE_MANIFEST_SCHEMA,
  type GeometryModuleArchitectureBasis,
  type GeometryModuleAssetIdentity,
  type GeometryModuleChild,
  type GeometryModuleInputBundleIdentity,
  type GeometryModulePredecessor,
  type GeometryModuleStructureCapture,
  type GeometryModuleTarget,
  invalid,
  parseArchitectureBasis,
  parseAssetIdentity,
  parseChildren,
  parseInputBundleIdentity,
  parseOptionalSourceClosure,
  parsePlacementAnalysis,
  parsePredecessor,
  parseStructureCapture,
  parseTarget,
  recrossChildPlacementCaptures,
  recrossStructureCaptureArchitecture,
  unsignedDraftRecord,
} from "./geometry-module-identities.ts";
import { recrossGeometryModuleAssembly } from "./geometry-module-assembly-recross.ts";
import {
  type GeometryModuleManifest,
  parseGeometryModuleManifest,
} from "./geometry-module-manifest.ts";

export interface GeometryModuleDraftCapture {
  readonly schemaVersion: typeof GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA;
  readonly kind: typeof GEOMETRY_MODULE_DRAFT_KIND;
  readonly architectureBasis: GeometryModuleArchitectureBasis;
  readonly structureCapture: GeometryModuleStructureCapture;
  readonly target: GeometryModuleTarget;
  readonly predecessor?: GeometryModulePredecessor;
  readonly sourceClosure?: ProjectSourceClosureLocator;
  readonly placementAnalysis: CadPlacementAnalysisCaptureLocator;
  readonly children: ReadonlyArray<GeometryModuleChild>;
  readonly unitSystem: typeof GEOMETRY_MODULE_UNIT_SYSTEM;
  readonly placementConvention: typeof GEOMETRY_MODULE_PLACEMENT_CONVENTION;
  readonly inputBundle: GeometryModuleInputBundleIdentity;
  readonly receipt: GeometryModuleAssemblyReceipt;
  readonly assemblyStep: GeometryModuleAssetIdentity;
  readonly assemblyGlb: GeometryModuleAssetIdentity;
  readonly fingerprint: ContentFingerprint;
}

export function parseGeometryModuleDraftCapture(
  value: unknown,
): Promise<Omit<GeometryModuleDraftCapture, "fingerprint">> {
  try {
    return Promise.resolve(parseGeometryModuleDraftCaptureValue(value));
  } catch (error) {
    return Promise.reject(error);
  }
}

function parseGeometryModuleDraftCaptureValue(
  value: unknown,
): Omit<GeometryModuleDraftCapture, "fingerprint"> {
  const root = closedRecord(
    unsignedDraftRecord(value),
    [
      "schemaVersion",
      "kind",
      "architectureBasis",
      "structureCapture",
      "target",
      "predecessor",
      "sourceClosure",
      "placementAnalysis",
      "children",
      "unitSystem",
      "placementConvention",
      "inputBundle",
      "receipt",
      "assemblyStep",
      "assemblyGlb",
    ],
    [
      "schemaVersion",
      "kind",
      "architectureBasis",
      "structureCapture",
      "target",
      "children",
      "unitSystem",
      "placementConvention",
      "inputBundle",
      "receipt",
      "assemblyStep",
      "assemblyGlb",
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
  recrossStructureCaptureArchitecture(structureCapture, architectureBasis);
  const target = parseTarget(root.target, "$geometryModuleDraft.target");
  const predecessor = root.predecessor === undefined ? undefined : parsePredecessor(
    root.predecessor,
    target.partDefinitionElementId,
    "$geometryModuleDraft.predecessor",
  );
  const sourceClosure = parseOptionalSourceClosure(
    root.sourceClosure,
    "$geometryModuleDraft.sourceClosure",
  );
  const children = parseChildren(root.children, "$geometryModuleDraft.children");
  const placementAnalysis = parsePlacementAnalysis(
    root.placementAnalysis,
    "$geometryModuleDraft.placementAnalysis",
  );
  recrossChildPlacementCaptures(children, placementAnalysis);
  literalValue(
    root.unitSystem,
    GEOMETRY_MODULE_UNIT_SYSTEM,
    "$geometryModuleDraft.unitSystem",
  );
  literalValue(
    root.placementConvention,
    GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    "$geometryModuleDraft.placementConvention",
  );
  const inputBundle = parseInputBundleIdentity(
    root.inputBundle,
    children,
    "$geometryModuleDraft.inputBundle",
  );
  const assemblyStep = parseAssetIdentity(
    root.assemblyStep,
    "$geometryModuleDraft.assemblyStep",
  );
  const assemblyGlb = parseAssetIdentity(
    root.assemblyGlb,
    "$geometryModuleDraft.assemblyGlb",
  );
  if (fingerprintsEqual(assemblyStep.fingerprint, assemblyGlb.fingerprint)) {
    invalid(
      "invalid_identity",
      "$geometryModuleDraft assembly STEP and GLB fingerprints must be distinct.",
    );
  }
  const receipt = recrossGeometryModuleAssembly(
    inputBundle,
    root.receipt,
    assemblyStep,
    assemblyGlb,
    "$geometryModuleDraft",
  );
  return deepFreeze({
    schemaVersion: GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA,
    kind: GEOMETRY_MODULE_DRAFT_KIND,
    architectureBasis,
    structureCapture,
    target,
    ...(predecessor === undefined ? {} : { predecessor }),
    ...(sourceClosure === undefined ? {} : { sourceClosure }),
    placementAnalysis,
    children,
    unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    inputBundle,
    receipt,
    assemblyStep,
    assemblyGlb,
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
    placementAnalysis: draft.placementAnalysis,
    children: draft.children,
    unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    assembly: {
      inputBundle: draft.inputBundle,
      step: { fingerprint: draft.assemblyStep.fingerprint },
      glb: { fingerprint: draft.assemblyGlb.fingerprint },
    },
  }, { requireCompleted: true });
}
