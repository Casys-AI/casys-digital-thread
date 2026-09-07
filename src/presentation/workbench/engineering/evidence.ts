import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type { EngineeringPathLaneId } from "../../../domain/project/engineering-path-lane.ts";
import type { ProjectBriefItem } from "../../../domain/project/project-brief.ts";
import type {
  RequirementsBriefRevisionIdentity,
  RequirementsBriefSourceImpactState,
} from "../../../domain/architecture/requirements/requirements-brief-impact.ts";
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
  /**
   * Optional read-only comparison of a requirements capture's sealed brief
   * clauses.  It is populated only by BFFs that can reopen the capture and
   * historical Project revision; its absence is not a browser-side fallback.
   */
  readonly requirementsBriefTraces?:
    readonly EngineeringWorkbenchRequirementsBriefTrace[];
}

/** Literal historical-source state. It never authorizes a retry or rewrite. */
export const ENGINEERING_REQUIREMENTS_BRIEF_TRACE_GAP = "TRACE GAP" as const;

/** One exact Thread requirement's immutable source clause. */
export interface EngineeringWorkbenchRequirementsBriefRequirementTrace {
  /** Canonical Thread requirement identity; never a label or metric slug. */
  readonly threadRequirementId: string;
  /** Canonical metric sealed by the exact capture ConstraintUsage. */
  readonly requirementId: string;
  readonly sourceItemId: string;
  readonly originalSourceItem: ProjectBriefItem;
  readonly currentSourceItem?: ProjectBriefItem;
  readonly state: RequirementsBriefSourceImpactState;
}

interface EngineeringWorkbenchRequirementsBriefTraceBase {
  /** Exact requirements-capture artifact addressed by this record. */
  readonly artifactId: string;
  /** Explicit requirements from that artifact which remain visible in Thread. */
  readonly threadRequirementIds: readonly string[];
}

/** A traceable requirements-capture/5.0 or /6.0 family. */
export interface EngineeringWorkbenchRequirementsBriefTraceAvailable
  extends EngineeringWorkbenchRequirementsBriefTraceBase {
  readonly status: "available";
  /**
   * A later documentary declaration for a historical capture. It does not
   * change the capture's original provenance, requirement semantics, or any
   * engineering verdict.
   */
  readonly declaration?: {
    readonly kind: "retrospective-documentary";
    readonly linkedAt: string;
    /** Exact Thread artifact for this immutable documentary claim. */
    readonly artifactId: string;
    /** Exact Thread artifact for the requirements capture named by the claim. */
    readonly requirementsArtifactId: string;
    /** Canonical claim-series identity, not a display label. */
    readonly claimId: string;
    /** Monotone revision inside the exact claim series. */
    readonly revision: number;
  };
  readonly originalBrief: RequirementsBriefRevisionIdentity;
  readonly currentBrief?: RequirementsBriefRevisionIdentity;
  readonly container: {
    readonly sourceItemId: string;
    readonly originalSourceItem: ProjectBriefItem;
    readonly currentSourceItem?: ProjectBriefItem;
    readonly state: RequirementsBriefSourceImpactState;
  };
  readonly requirements:
    readonly EngineeringWorkbenchRequirementsBriefRequirementTrace[];
}

/** Historical requirements-capture/3.0 or /4.0: no clause source was sealed. */
export interface EngineeringWorkbenchRequirementsBriefTraceGap
  extends EngineeringWorkbenchRequirementsBriefTraceBase {
  readonly status: typeof ENGINEERING_REQUIREMENTS_BRIEF_TRACE_GAP;
}

export type EngineeringWorkbenchRequirementsBriefTrace =
  | EngineeringWorkbenchRequirementsBriefTraceAvailable
  | EngineeringWorkbenchRequirementsBriefTraceGap;

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
