/**
 * Public facade for bounded hierarchical CAD module evidence.
 *
 * Identities, the isolation recross, the signed manifest, the review-only
 * draft, and the canonical capture stay in sibling modules. This file only
 * re-exports that closed family.
 */

export type { CadPlacementAnalysisCaptureLocator } from "../placement/cad-placement-analysis-capture.ts";

export {
  GEOMETRY_MODULE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_CHILD_CAPTURE_SCHEMAS,
  GEOMETRY_MODULE_CHILD_STEP_MEDIA_TYPE,
  GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
  GEOMETRY_MODULE_PLACEMENT_CONVENTION,
  GEOMETRY_MODULE_UNIT_SYSTEM,
  type GeometryModuleChildCaptureSchema,
} from "../geometry-module-contract.ts";

export {
  assertGeometryModuleInputBundleMatchesIdentity,
  GEOMETRY_MODULE_ARCHITECTURE_CAPTURE_URI_PREFIX,
  GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_DRAFT_KIND,
  GEOMETRY_MODULE_MANIFEST_SCHEMA,
  GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_STRUCTURE_CAPTURE_URI_PREFIX,
  type GeometryModuleArchitectureBasis,
  type GeometryModuleAssetIdentity,
  type GeometryModuleChild,
  type GeometryModuleChildGeometry,
  GeometryModuleEvidenceError,
  type GeometryModuleEvidenceErrorCode,
  type GeometryModuleInputBundleIdentity,
  geometryModuleInputBundleMatchesIdentity,
  type GeometryModulePlacement,
  type GeometryModulePredecessor,
  type GeometryModuleStructureCapture,
  type GeometryModuleTarget,
  recrossGeometryModuleInputBundleToChildren,
  recrossStructureCaptureArchitecture,
  sameInputBundle,
} from "./geometry-module-identities.ts";

export { recrossGeometryModuleIsolation } from "./geometry-module-isolation.ts";

export {
  assertGeometryModuleManifest,
  encodeGeometryModuleDecisionParameters,
  type GeometryModuleAssembly,
  type GeometryModuleDecisionParameters,
  type GeometryModuleManifest,
  parseGeometryModuleDecisionParameters,
  parseGeometryModuleManifest,
} from "./geometry-module-manifest.ts";

export {
  type GeometryModuleDraftCapture,
  geometryModuleManifestFromDraft,
  parseGeometryModuleDraftCapture,
} from "./geometry-module-draft.ts";

export {
  type GeometryModuleCapture,
  parseGeometryModuleCapture,
} from "./geometry-module-capture.ts";

export {
  type CanonicalGeometryCapture,
  type GeometryPartCapture,
  type GeometryPartCaptureArchitectureBasis,
  type GeometryPartCapturePreviewProducer,
  type GeometryPartCaptureSourceScript,
  parseCanonicalGeometryCapture,
  parseGeometryPartCapture,
} from "./geometry-part-capture.ts";
