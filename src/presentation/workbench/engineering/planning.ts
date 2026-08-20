import type {
  EngineeringAgentRunStatus,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import type { EngineeringWorkbenchBaseSnapshot } from "./evidence.ts";
import type { LiveThreadUpdateState } from "./live-overlay.ts";

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
  readonly version: number;
  readonly milestones: readonly EngineeringPlanningActivityMilestone[];
}

export interface EngineeringPlanningActivityMilestone {
  readonly sequence: number;
  readonly state: LiveThreadUpdateState;
  readonly recordedAt: string;
}
