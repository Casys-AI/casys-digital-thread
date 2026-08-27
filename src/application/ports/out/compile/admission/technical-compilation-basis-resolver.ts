import type { TechnicalCompilationBasis } from "../../../../../domain/compile/admission/technical-compilation.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../../domain/project/engineering-project.ts";

export interface TechnicalCompilationBasisResolutionRequest {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
}

/**
 * Reopens an exact declared Thread revision and its server-selected SysML
 * anchor. Implementations must never resolve a `latest` alias.
 */
export interface TechnicalCompilationBasisResolver {
  resolve(
    request: TechnicalCompilationBasisResolutionRequest,
  ): Promise<TechnicalCompilationBasis | undefined>;
}
