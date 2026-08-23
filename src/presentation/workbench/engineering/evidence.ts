import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type { EngineeringPathLaneId } from "../../../domain/project/engineering-path-lane.ts";
import type { LiveThreadWorkbenchSnapshot } from "./live-overlay.ts";
import type { ENGINEERING_WORKBENCH_SCHEMA } from "./schema.ts";

export interface EngineeringWorkbenchBaseSnapshot {
  readonly schemaVersion: typeof ENGINEERING_WORKBENCH_SCHEMA;
  readonly project: EngineeringProjectSnapshot;
}

export interface EngineeringEvidenceWorkbenchSnapshot
  extends EngineeringWorkbenchBaseSnapshot {
  readonly surface: "evidence";
  readonly thread: LiveThreadWorkbenchSnapshot;
  readonly projectPath: EngineeringWorkbenchProjectPathProjection;
  readonly alignment: EngineeringWorkbenchAlignment;
  readonly unresolvedEvidenceReferences:
    readonly EngineeringWorkbenchUnresolvedEvidenceReference[];
}

/**
 * Server-owned presentation metadata over the exact ordered project phases.
 * It classifies registered operations; it does not replace the phase record or
 * imply a provider result, verdict, or execution state.
 */
export interface EngineeringWorkbenchProjectPathProjection {
  readonly phaseLanes: readonly EngineeringWorkbenchPhaseLane[];
}

export interface EngineeringWorkbenchPhaseLane {
  readonly phaseId: string;
  readonly lane: EngineeringPathLaneId;
}

export interface EngineeringWorkbenchUnresolvedEvidenceReference {
  readonly path: string;
  readonly message: string;
}

export interface EngineeringWorkbenchAlignment {
  readonly status: "aligned" | "thread-ahead";
  readonly projectThreadRevision: number;
  readonly currentThreadRevision: number;
}
