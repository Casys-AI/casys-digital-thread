/**
 * Closed composition for the circuit-only SPICE technical-source profile.
 *
 * Callers cannot substitute analyzer identity, role, language, or the
 * closed-subset profile id. The initial technical-source registry merges this
 * registration next to Build123d and Modelica; the languages share the
 * existing technical-source CAS kinds rather than a second store pair.
 */

import {
  SPICE_CIRCUIT_SOURCE_ANALYSIS_PROFILE,
  SPICE_CIRCUIT_SOURCE_ANALYZER_ID,
  SPICE_CIRCUIT_SOURCE_ANALYZER_VERSION,
  SpiceCircuitSourceAnalyzer,
} from "./circuit-source-analyzer.ts";
import {
  type TechnicalSourceAnalysisProfile,
  type TechnicalSourceAnalysisProfileRegistration,
  validateTechnicalSourceAnalysisProfile,
} from "../../compile/captures/technical-source-analysis-capture.ts";

export const SPICE_CIRCUIT_MAX_SOURCE_BYTES = 262_144;

export const SPICE_CIRCUIT_TECHNICAL_SOURCE_PROFILE: TechnicalSourceAnalysisProfile =
  validateTechnicalSourceAnalysisProfile({
    id: SPICE_CIRCUIT_SOURCE_ANALYSIS_PROFILE,
    version: "1.0.0",
    role: "spice-circuit",
    language: "spice",
    analyzer: {
      id: SPICE_CIRCUIT_SOURCE_ANALYZER_ID,
      version: SPICE_CIRCUIT_SOURCE_ANALYZER_VERSION,
    },
    maxSourceBytes: SPICE_CIRCUIT_MAX_SOURCE_BYTES,
  });

export function spiceCircuitSourceAnalysisRegistration(): TechnicalSourceAnalysisProfileRegistration {
  return {
    profile: SPICE_CIRCUIT_TECHNICAL_SOURCE_PROFILE,
    frontend: new SpiceCircuitSourceAnalyzer(),
  };
}
