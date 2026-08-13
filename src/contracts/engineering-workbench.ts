import type {
  EngineeringAgentRunStatus,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../domain/project/engineering-project.ts";
import type { ThreadWorkbenchSnapshot } from "./thread-workbench.ts";

/** Browser-safe schema served by the native Engineering Workbench BFF. */
export const ENGINEERING_WORKBENCH_SCHEMA = "engineering-workbench/0.2" as const;

/** Browser-safe schema for provisional activity over a canonical thread. */
export const LIVE_THREAD_OVERLAY_SCHEMA = "live-thread-overlay/1.0" as const;

export type LiveThreadGraphState = "running" | "fresh" | "failed";
export type LiveThreadUpdateState = LiveThreadGraphState | "reconciled";

/**
 * Public activity metadata only. Provider arguments, results and graph patches
 * remain on the server-side append-only journal.
 */
export interface LiveThreadOverlay {
  readonly schemaVersion: typeof LIVE_THREAD_OVERLAY_SCHEMA;
  readonly version: number;
  readonly active: readonly LiveThreadOverlayActivity[];
}

export interface LiveThreadOverlayActivity {
  readonly runId: string;
  readonly operationId: string;
  readonly state: LiveThreadGraphState;
  readonly recordedAt: string;
  readonly baseRevision: number;
  readonly sequence: number;
}

export type LiveThreadWorkbenchSnapshot = ThreadWorkbenchSnapshot & {
  /** Non-canonical activity overlaid on the canonical snapshot graph. */
  readonly live: LiveThreadOverlay;
};

/** Common BFF fields for a native project surface. */
export interface EngineeringWorkbenchBaseSnapshot {
  readonly schemaVersion: typeof ENGINEERING_WORKBENCH_SCHEMA;
  readonly project: EngineeringProjectSnapshot;
}

/** Project intent and linked technical proof delivered as one atomic BFF read. */
export interface EngineeringEvidenceWorkbenchSnapshot
  extends EngineeringWorkbenchBaseSnapshot {
  readonly surface: "evidence";
  readonly thread: LiveThreadWorkbenchSnapshot;
  readonly alignment: EngineeringWorkbenchAlignment;
}

export interface EngineeringWorkbenchAlignment {
  readonly status: "aligned" | "thread-ahead";
  readonly projectThreadRevision: number;
  readonly currentThreadRevision: number;
}

/**
 * A durable capture of the approved project brief and reviewed path. This has
 * no thread field because documentary provenance is not technical evidence.
 */
export interface EngineeringDocumentaryWorkbenchSnapshot
  extends EngineeringWorkbenchBaseSnapshot {
  readonly surface: "documentary";
  readonly documentary: {
    readonly status: "recorded";
    readonly message: string;
    readonly record: {
      readonly origin: "approved-brief";
      readonly snapshotId: string;
      readonly snapshotRevision: number;
      readonly artifactId: string;
      readonly label: string;
      readonly fingerprint: string;
      readonly uri?: string;
      readonly recordedAt: string;
    };
    readonly technicalEvidence: {
      readonly status: "not-recorded";
      readonly message: string;
    };
    readonly technicalStart?: EngineeringDocumentaryTechnicalStart;
  };
}

export type EngineeringDocumentaryTechnicalStartState =
  | "queued"
  | "running"
  | "publishing"
  | "failed";

/** Closed progress projection for the first bounded SysON container seed. */
export interface EngineeringDocumentaryTechnicalStart {
  readonly kind: "sysml-container-seed";
  readonly state: EngineeringDocumentaryTechnicalStartState;
  readonly message: string;
  readonly activity: {
    readonly version: number;
    readonly steps: readonly EngineeringDocumentaryTechnicalStartStep[];
  };
}

export interface EngineeringDocumentaryTechnicalStartStep {
  readonly id: "project-container" | "sysml-document" | "root-package";
  readonly state: LiveThreadGraphState;
  readonly label: string;
  readonly summary: string;
  readonly recordedAt: string;
  readonly predecessor?: "project-container" | "sysml-document";
}

/** Project intent only, before any documentary or technical baseline exists. */
export interface EngineeringPlanningWorkbenchSnapshot
  extends EngineeringWorkbenchBaseSnapshot {
  readonly surface: "planning";
  readonly planning: {
    readonly technicalBaseline: {
      readonly status: EngineeringTechnicalBaselineStatus;
      readonly message: string;
    };
    readonly baselineRun?: EngineeringPlanningBaselineRun;
    readonly activity: EngineeringPlanningActivity;
  };
}

export type EngineeringTechnicalBaselineStatus =
  | "not-created"
  | "queued"
  | "running"
  | "publishing"
  | "failed";

export type EngineeringPlanningAgentRunStatus = EngineeringAgentRunStatus;

export interface EngineeringPlanningBaselineRun {
  readonly id: string;
  readonly status: EngineeringPlanningAgentRunStatus;
  readonly workItem: {
    readonly id: string;
    readonly title: string;
    readonly kind: EngineeringWorkItem["kind"];
  };
  readonly queuedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly statusHistory: readonly EngineeringPlanningBaselineRunMilestone[];
}

export interface EngineeringPlanningBaselineRunMilestone {
  readonly status: EngineeringPlanningAgentRunStatus;
  readonly at: string;
}

export interface EngineeringPlanningActivity {
  /** Latest append-only journal sequence observed for this subject. */
  readonly version: number;
  readonly milestones: readonly EngineeringPlanningActivityMilestone[];
}

export interface EngineeringPlanningActivityMilestone {
  readonly sequence: number;
  readonly state: LiveThreadUpdateState;
  readonly recordedAt: string;
}

export type EngineeringWorkbenchSnapshot =
  | EngineeringEvidenceWorkbenchSnapshot
  | EngineeringDocumentaryWorkbenchSnapshot
  | EngineeringPlanningWorkbenchSnapshot;
