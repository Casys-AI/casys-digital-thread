/**
 * Public facade for bounded hierarchical CAD module evidence.
 *
 * Identities, the isolation recross, the signed manifest, the review-only
 * draft, and the canonical capture stay in sibling modules. This file only
 * re-exports that closed family.
 */

export {
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_SCHEMA,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PATTERN,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX,
  type CadPlacementAnalysisCaptureLocator,
  GEOMETRY_MODULE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_CHILD_CAPTURE_SCHEMAS,
  GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_DRAFT_KIND,
  GEOMETRY_MODULE_EXPORT_FORMATS,
  GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
  GEOMETRY_MODULE_MANIFEST_SCHEMA,
  GEOMETRY_MODULE_PLACEMENT_CONVENTION,
  GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
  type GeometryModuleArchitectureBasis,
  type GeometryModuleAssetIdentity,
  type GeometryModuleChild,
  type GeometryModuleChildCaptureSchema,
  type GeometryModuleChildGeometry,
  GeometryModuleEvidenceError,
  type GeometryModuleEvidenceErrorCode,
  type GeometryModuleExportFormat,
  type GeometryModuleInputBundleIdentity,
  type GeometryModulePlacement,
  type GeometryModulePredecessor,
  type GeometryModuleStructureCapture,
  type GeometryModuleTarget,
  validateCadPlacementAnalysisCaptureLocator,
} from "./geometry-module-identities.ts";

export {
  GEOMETRY_MODULE_ASSEMBLY_GLB_OUTPUT,
  GEOMETRY_MODULE_ASSEMBLY_ISOLATED_PROFILE,
  GEOMETRY_MODULE_ASSEMBLY_STEP_OUTPUT,
  recrossGeometryModuleIsolation,
} from "./geometry-module-isolation.ts";

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
