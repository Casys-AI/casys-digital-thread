import type { TechnicalCompilationProfileCatalog } from "../../../../../domain/compile/admission/technical-compilation.ts";

/** A code-owned catalogue; no command can add or override profiles. */
export interface TechnicalCompilationProfileCatalogProvider {
  get(): Promise<TechnicalCompilationProfileCatalog>;
}
