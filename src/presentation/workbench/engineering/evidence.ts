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
  /**
   * Explicit join from a typed Thread case (id + revision) to the Project
   * activity that produced its authority artifact. Every authority artifact
   * must exist, carry a producer run, and name the same exact run; that run,
   * work item and activity must be known. Otherwise the case stays unjoined.
   */
  readonly caseActivityJoins: readonly EngineeringWorkbenchCaseActivityJoin[];
  readonly unresolvedEvidenceReferences:
    readonly EngineeringWorkbenchUnresolvedEvidenceReference[];
}

/** One exact Thread case bound to one Project activity through a producer run. */
export interface EngineeringWorkbenchCaseActivityJoin {
  readonly caseKey: string;
  readonly caseId: string;
  readonly caseRevision: number;
  readonly activityId: string;
  readonly workItemId: string;
  readonly runId: string;
}

/**
 * Server-owned presentation metadata over the exact ordered project phases.
 * It classifies registered operations; it does not replace the phase record or
 * imply a provider result, verdict, or execution state.
 */
export interface EngineeringWorkbenchProjectPathProjection {
  readonly phaseLanes: readonly EngineeringWorkbenchPhaseLane[];
  readonly activities: readonly EngineeringWorkbenchActivity[];
}

/** Server-projected stable activity with ordered revisions. */
export interface EngineeringWorkbenchActivity {
  readonly id: string;
  readonly lane: EngineeringPathLaneId;
  readonly rootRevisionId: string;
  readonly revisionIds: readonly string[];
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
