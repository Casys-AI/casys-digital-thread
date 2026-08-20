/**
 * Closed composition for the qualified Modelica technical-source profile.
 *
 * Callers cannot substitute analyzer identity, role, language, or the
 * closed-subset profile id. The initial technical-source registry merges this
 * registration next to Build123d; the two languages share the existing
 * technical-source CAS kinds rather than a second store pair.
 */

import {
  QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE,
  QUALIFIED_MODELICA_SOURCE_ANALYZER_ID,
  QUALIFIED_MODELICA_SOURCE_ANALYZER_VERSION,
  QualifiedModelicaSourceAnalyzer,
} from "./qualified-source-analyzer.ts";
import {
  FixedTechnicalSourceAnalysisProfileRegistry,
  type TechnicalSourceAnalysisProfile,
  type TechnicalSourceAnalysisProfileRegistration,
  validateTechnicalSourceAnalysisProfile,
} from "../../compile/captures/technical-source-analysis-capture.ts";

export const QUALIFIED_MODELICA_MAX_SOURCE_BYTES = 262_144;

export const QUALIFIED_MODELICA_TECHNICAL_SOURCE_PROFILE:
  TechnicalSourceAnalysisProfile = validateTechnicalSourceAnalysisProfile({
    id: QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE,
    version: "2.0.0",
    role: "modelica-model",
    language: "modelica",
    analyzer: {
      id: QUALIFIED_MODELICA_SOURCE_ANALYZER_ID,
      version: QUALIFIED_MODELICA_SOURCE_ANALYZER_VERSION,
    },
    maxSourceBytes: QUALIFIED_MODELICA_MAX_SOURCE_BYTES,
  });

export function qualifiedModelicaSourceAnalysisRegistration(): TechnicalSourceAnalysisProfileRegistration {
  return {
    profile: QUALIFIED_MODELICA_TECHNICAL_SOURCE_PROFILE,
    frontend: new QualifiedModelicaSourceAnalyzer(),
  };
}

export function createModelicaTechnicalSourceAnalysisProfileRegistry(): FixedTechnicalSourceAnalysisProfileRegistry {
  return new FixedTechnicalSourceAnalysisProfileRegistry([
    qualifiedModelicaSourceAnalysisRegistration(),
  ]);
}
