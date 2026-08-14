/** Server-owned, immutable technical-compilation profile catalogue. */

import type {
  TechnicalCompilationProfileCatalogProvider,
} from "../../application/ports/out/technical-compilation-profile-catalog-provider.ts";
import {
  TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
  type TechnicalCompilationProfileCatalog,
  validateTechnicalCompilationProfileCatalog,
} from "../../domain/analysis/technical-compilation.ts";
import {
  QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
  QUALIFIED_BUILD123D_SOURCE_ANALYZER_ID,
  QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION,
} from "../analyzers/qualified-build123d-source-analyzer.ts";

/**
 * The only initial registration corresponds to a real parser-backed, closed
 * build123d subset (3-D primitives, Rectangle/Circle sketches, placements,
 * Compound, same-kind +/−, scale(solid, scalar),
 * fillet(solid.edges(), radius=scalar), chamfer(solid.edges(), length), and
 * extrude(sketch, amount=scalar)). CalculiX and Modelica remain absent until
 * independently qualified frontends exist; requesting either therefore fails
 * closed.
 */
export const INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG:
  TechnicalCompilationProfileCatalog = validateTechnicalCompilationProfileCatalog({
    schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
    profiles: [{
      id: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      version: "1.0.0",
      target: "build123d-source",
      sourceRole: "cad-script",
      language: "python",
      analyzer: {
        id: QUALIFIED_BUILD123D_SOURCE_ANALYZER_ID,
        version: QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION,
      },
      analysisPolicyProfile: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      requiredBindingSymbolKinds: ["artifact", "parameter"],
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
