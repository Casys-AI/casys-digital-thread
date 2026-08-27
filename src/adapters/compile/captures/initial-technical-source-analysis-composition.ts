/**
 * One code-owned composition for technical-source capture frontends.
 *
 * Keeping the registration here prevents a server composition root from
 * accidentally pairing the qualified compilation profile with a different
 * parser, version, role, or policy identity.
 */

import {
  QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
  QUALIFIED_BUILD123D_SOURCE_ANALYZER_ID,
  QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION,
  QualifiedBuild123dSourceAnalyzer,
} from "../../cad/source/qualified-build123d-source-analyzer.ts";
import {
  PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
} from "../../../domain/compile/admission/technical-compilation.ts";
import {
  FixedTechnicalSourceAnalysisProfileRegistry,
  TechnicalSourceAnalysisCaptureService,
  type TechnicalSourceAnalysisProfile,
  validateTechnicalSourceAnalysisProfile,
} from "./technical-source-analysis-capture.ts";
import type { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import { qualifiedModelicaSourceAnalysisRegistration } from "../../modelica/source/source-analysis-composition.ts";
import { spiceCircuitSourceAnalysisRegistration } from "../../electrical/spice/source-analysis-composition.ts";

export const INITIAL_QUALIFIED_BUILD123D_MAX_SOURCE_BYTES = 262_144;
export const INITIAL_QUALIFIED_BUILD123D_MAX_CLOSURE_FILES = 32;
export const INITIAL_QUALIFIED_BUILD123D_MAX_CLOSURE_SOURCE_BYTES = 524_288;
/** The executable script is separately capped at the exact closure byte policy. */
export const INITIAL_QUALIFIED_BUILD123D_MAX_EFFECTIVE_SCRIPT_BYTES =
  INITIAL_QUALIFIED_BUILD123D_MAX_CLOSURE_SOURCE_BYTES;

export const INITIAL_QUALIFIED_BUILD123D_TECHNICAL_SOURCE_PROFILE:
  TechnicalSourceAnalysisProfile = validateTechnicalSourceAnalysisProfile({
    id: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
    version: PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
    role: "cad-script",
    language: "python",
    analyzer: {
      id: QUALIFIED_BUILD123D_SOURCE_ANALYZER_ID,
      version: QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION,
    },
    maxSourceBytes: INITIAL_QUALIFIED_BUILD123D_MAX_SOURCE_BYTES,
    workspaceClosureLowering: {
      schemaVersion: "build123d-workspace-closure-lowering/1.0",
      kind: "build123d-workspace-closure-lowering",
      maxClosureFiles: INITIAL_QUALIFIED_BUILD123D_MAX_CLOSURE_FILES,
      maxClosureSourceBytes: INITIAL_QUALIFIED_BUILD123D_MAX_CLOSURE_SOURCE_BYTES,
      maxEffectiveScriptBytes: INITIAL_QUALIFIED_BUILD123D_MAX_EFFECTIVE_SCRIPT_BYTES,
    },
  });

/** Closed registry: Build123d, Modelica, and circuit-only SPICE. CalculiX stays absent. */
export function createInitialTechnicalSourceAnalysisProfileRegistry(): FixedTechnicalSourceAnalysisProfileRegistry {
  return new FixedTechnicalSourceAnalysisProfileRegistry([
    {
      profile: INITIAL_QUALIFIED_BUILD123D_TECHNICAL_SOURCE_PROFILE,
      frontend: new QualifiedBuild123dSourceAnalyzer(),
    },
    qualifiedModelicaSourceAnalysisRegistration(),
    spiceCircuitSourceAnalysisRegistration(),
  ]);
}

export interface InitialTechnicalSourceAnalysisCaptureStores {
  readonly sourceCaptures: FileByteStore<"technical-source">;
  readonly analysisCaptures: FileByteStore<"technical-source-analysis">;
  readonly captureDocuments: FileByteStore<"technical-source-analysis-capture">;
}

/**
 * Construct the capture service with the closed registry above. Callers own
 * the CAS stores; they cannot substitute analyzer identities.
 */
export function createInitialTechnicalSourceAnalysisCaptureService(
  stores: InitialTechnicalSourceAnalysisCaptureStores,
): TechnicalSourceAnalysisCaptureService {
  return new TechnicalSourceAnalysisCaptureService({
    sourceCaptures: stores.sourceCaptures,
    analysisCaptures: stores.analysisCaptures,
    captureDocuments: stores.captureDocuments,
    profiles: createInitialTechnicalSourceAnalysisProfileRegistry(),
  });
}
