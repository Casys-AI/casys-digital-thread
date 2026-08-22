/** Server-owned, immutable technical-compilation profile catalogue. */

import type {
  TechnicalCompilationProfileCatalogProvider,
} from "../../../application/ports/out/compile/admission/technical-compilation-profile-catalog-provider.ts";
import {
  PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
  TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
  type TechnicalCompilationProfileCatalog,
  validateTechnicalCompilationProfileCatalog,
} from "../../../domain/compile/admission/technical-compilation.ts";
import {
  QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
  QUALIFIED_BUILD123D_SOURCE_ANALYZER_ID,
  QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION,
} from "../../cad/source/qualified-build123d-source-analyzer.ts";
import {
  QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE,
  QUALIFIED_MODELICA_SOURCE_ANALYZER_ID,
  QUALIFIED_MODELICA_SOURCE_ANALYZER_VERSION,
} from "../../modelica/source/qualified-source-analyzer.ts";
import {
  SPICE_CIRCUIT_SOURCE_ANALYSIS_PROFILE,
  SPICE_CIRCUIT_SOURCE_ANALYZER_ID,
  SPICE_CIRCUIT_SOURCE_ANALYZER_VERSION,
} from "../../electrical/spice/circuit-source-analyzer.ts";

/**
 * Registrations correspond to real parser-backed closed subsets: the
 * build123d geometry subset, the executable Modelica closed subset v2, and
 * the circuit-only SPICE closed subset v1. CalculiX remains absent until an
 * independently qualified frontend exists; requesting it therefore fails closed.
 */
export const INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG:
  TechnicalCompilationProfileCatalog = validateTechnicalCompilationProfileCatalog({
    schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
    profiles: [{
      id: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      version: PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
      target: "build123d-source",
      sourceRole: "cad-script",
      language: "python",
      analyzer: {
        id: QUALIFIED_BUILD123D_SOURCE_ANALYZER_ID,
        version: QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION,
      },
      analysisPolicyProfile: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      requiredBindingSymbolKinds: ["artifact", "parameter"],
    }, {
      id: QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE,
      version: "2.0.0",
      target: "modelica-source-qualification",
      sourceRole: "modelica-model",
      language: "modelica",
      analyzer: {
        id: QUALIFIED_MODELICA_SOURCE_ANALYZER_ID,
        version: QUALIFIED_MODELICA_SOURCE_ANALYZER_VERSION,
      },
      analysisPolicyProfile: QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE,
      requiredBindingSymbolKinds: ["parameter"],
    }, {
      id: SPICE_CIRCUIT_SOURCE_ANALYSIS_PROFILE,
      version: "1.0.0",
      target: "spice-circuit-source",
      sourceRole: "spice-circuit",
      language: "spice",
      analyzer: {
        id: SPICE_CIRCUIT_SOURCE_ANALYZER_ID,
        version: SPICE_CIRCUIT_SOURCE_ANALYZER_VERSION,
      },
      analysisPolicyProfile: SPICE_CIRCUIT_SOURCE_ANALYSIS_PROFILE,
      requiredBindingSymbolKinds: ["parameter"],
    }],
  });

export class FixedTechnicalCompilationProfileCatalogProvider
  implements TechnicalCompilationProfileCatalogProvider {
  readonly #catalog: TechnicalCompilationProfileCatalog;

  constructor(value: unknown = INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG) {
    this.#catalog = validateTechnicalCompilationProfileCatalog(
      structuredClone(value),
    );
  }

  get(): Promise<TechnicalCompilationProfileCatalog> {
    // Revalidation returns a new deeply frozen graph and prevents consumers
    // from retaining or mutating the constructor-owned catalogue instance.
    return Promise.resolve(validateTechnicalCompilationProfileCatalog(
      structuredClone(this.#catalog),
    ));
  }
}
