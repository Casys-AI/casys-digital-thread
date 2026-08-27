/**
 * Optional unique join of a sealed thermal method sheet onto a compilation
 * basis. Absence is not a gap. Ambiguity must fail closed.
 */

import type { ModelicaThermalMethodSheet } from "../../../../../domain/modelica/thermal-method-sheet.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../../domain/project/engineering-project.ts";

export interface ThermalMethodSheetCompilationJoinRequest {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
}

export interface ThermalMethodSheetCompilationJoin {
  read(
    request: ThermalMethodSheetCompilationJoinRequest,
  ): Promise<ModelicaThermalMethodSheet | undefined>;
}
