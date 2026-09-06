/**
 * Public compatibility facade for geometry-module assembler qualification.
 *
 * Candidate construction, capture persistence and durable orchestration live
 * in bounded modules so their individual authority seams stay reviewable.
 */

export {
  assertExactGeometryModuleAssemblerQualificationCandidate,
  createGeometryModuleAssemblerMicrosandboxQualificationCandidate,
  createGeometryModuleAssemblerMicrosandboxQualificationCandidateFromBoundImport,
  createGeometryModuleAssemblerMicrosandboxQualificationFixture,
  GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_QUALIFICATION_CANDIDATE_ID,
  GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_QUALIFICATION_FIXTURE_ID,
  GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_QUALIFICATION_SPEC_ID,
  GEOMETRY_MODULE_ASSEMBLER_QUALIFICATION_UNIT_VERSION,
  type GeometryModuleAssemblerMicrosandboxQualificationCandidate,
  type GeometryModuleAssemblerMicrosandboxQualificationFixture,
} from "./geometry-module-assembly-microsandbox-qualification-candidate.ts";
export {
  createGeometryModuleAssemblerMicrosandboxQualificationCapture,
  FileGeometryModuleAssemblerMicrosandboxQualificationStore,
  GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_QUALIFICATION_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_QUALIFICATION_DESCRIPTOR,
  type GeometryModuleAssemblerMicrosandboxQualificationCapture,
  type GeometryModuleAssemblerMicrosandboxQualificationOutcome,
  type GeometryModuleAssemblerMicrosandboxQualificationReference,
} from "./geometry-module-assembly-microsandbox-qualification-capture.ts";
export {
  type GeometryModuleAssemblerQualificationResult,
  GeometryModuleAssemblerQualificationService,
  type GeometryModuleAssemblerQualificationServiceOptions,
} from "./geometry-module-assembly-microsandbox-qualification-service.ts";
