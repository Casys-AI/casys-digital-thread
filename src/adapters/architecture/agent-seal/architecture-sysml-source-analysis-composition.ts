/**
 * Closed composition for the agent-authored architecture SysML profile.
 *
 * Callers own only the two CAS stores. They cannot substitute analyzer
 * identity, role, language, or the closed-subset profile id.
 */

import {
  QUALIFIED_ARCHITECTURE_SYSML_ANALYSIS_PROFILE,
  QUALIFIED_ARCHITECTURE_SYSML_ANALYZER_ID,
  QUALIFIED_ARCHITECTURE_SYSML_ANALYZER_VERSION,
  QualifiedArchitectureSysmlAnalyzer,
} from "./qualified-architecture-sysml-analyzer.ts";
import {
  type ArchitectureSysmlAnalysisProfile,
  ArchitectureSysmlSourceAnalysisCaptureService,
  FixedArchitectureSysmlAnalysisProfileRegistry,
  validateArchitectureSysmlAnalysisProfile,
} from "./architecture-sysml-source-analysis-capture.ts";
import type { FileByteStore } from "../../shared/cas/file-byte-store.ts";

export const INITIAL_ARCHITECTURE_SYSML_MAX_SOURCE_BYTES = 262_144;

export const INITIAL_ARCHITECTURE_SYSML_ANALYSIS_PROFILE:
  ArchitectureSysmlAnalysisProfile = validateArchitectureSysmlAnalysisProfile({
    id: QUALIFIED_ARCHITECTURE_SYSML_ANALYSIS_PROFILE,
    version: "1.0.0",
    role: "sysml-model",
    language: "sysml-v2",
    analyzer: {
      id: QUALIFIED_ARCHITECTURE_SYSML_ANALYZER_ID,
      version: QUALIFIED_ARCHITECTURE_SYSML_ANALYZER_VERSION,
    },
    maxSourceBytes: INITIAL_ARCHITECTURE_SYSML_MAX_SOURCE_BYTES,
  });

export function createArchitectureSysmlAnalysisProfileRegistry(): FixedArchitectureSysmlAnalysisProfileRegistry {
  return new FixedArchitectureSysmlAnalysisProfileRegistry([{
    profile: INITIAL_ARCHITECTURE_SYSML_ANALYSIS_PROFILE,
    frontend: new QualifiedArchitectureSysmlAnalyzer(),
  }]);
}

export interface ArchitectureSysmlSourceAnalysisCaptureStores {
  readonly sourceCaptures: FileByteStore<"architecture-sysml-source">;
  readonly analysisCaptures: FileByteStore<"architecture-sysml-source-analysis">;
}

export function createArchitectureSysmlSourceAnalysisCaptureService(
  stores: ArchitectureSysmlSourceAnalysisCaptureStores,
): ArchitectureSysmlSourceAnalysisCaptureService {
  return new ArchitectureSysmlSourceAnalysisCaptureService({
    sourceCaptures: stores.sourceCaptures,
    analysisCaptures: stores.analysisCaptures,
    profiles: createArchitectureSysmlAnalysisProfileRegistry(),
  });
}
