import type { EngineeringProjectSnapshot } from "../domain/engineering-project.ts";
import type { LiveThreadWorkbenchSnapshot } from "./live-thread-update-store.ts";

export const ENGINEERING_WORKBENCH_SCHEMA = "engineering-workbench/0.2" as const;

/**
 * Complete, browser-facing read model for one engineering project.
 *
 * A project can legitimately exist before any technical baseline. Keep that
 * state distinct from an observed engineering thread: the browser must never
 * receive an invented empty ThreadSnapshot merely to satisfy a single shape.
 */
export interface EngineeringWorkbenchBaseSnapshot {
  schemaVersion: typeof ENGINEERING_WORKBENCH_SCHEMA;
  project: EngineeringProjectSnapshot;
  capabilities: EngineeringWorkbenchCapabilities;
}

/** Project intent plus a real, persisted technical evidence projection. */
export interface EngineeringEvidenceWorkbenchSnapshot
  extends EngineeringWorkbenchBaseSnapshot {
  surface: "evidence";
  thread: LiveThreadWorkbenchSnapshot;
  alignment: EngineeringWorkbenchAlignment;
}

/**
 * Project intent only. There is no technical observation, graph or tool state
 * until a deterministic operation publishes an exact ThreadSnapshot.
 */
export interface EngineeringPlanningWorkbenchSnapshot
  extends EngineeringWorkbenchBaseSnapshot {
  surface: "planning";
  planning: {
    technicalBaseline: {
      status: "not-created";
      message: string;
    };
  };
}

export type EngineeringWorkbenchSnapshot =
  | EngineeringEvidenceWorkbenchSnapshot
  | EngineeringPlanningWorkbenchSnapshot;

export const ENGINEERING_OPERATOR_COMMAND_ENDPOINT = "/api/project/commands" as const;
export const ENGINEERING_OPERATOR_INTENT_HEADER = "X-Casys-Operator-Intent" as const;

export const ENGINEERING_OPERATOR_COMMAND_INTENTS = [
  "decision.propose",
  "decision.approve",
  "decision.reject",
  "agent-run.queue",
] as const;

export interface EngineeringWorkbenchCapabilities {
  operatorCommands: {
    enabled: boolean;
    endpoint: typeof ENGINEERING_OPERATOR_COMMAND_ENDPOINT;
    intents: readonly (typeof ENGINEERING_OPERATOR_COMMAND_INTENTS)[number][];
    explicitIntentHeader: typeof ENGINEERING_OPERATOR_INTENT_HEADER;
    expectedRevision: number;
  };
}

export interface EngineeringWorkbenchAlignment {
  status: "aligned" | "thread-ahead";
  projectThreadRevision: number;
  currentThreadRevision: number;
}

/**
 * Compose project intent and observed thread evidence without deriving new
 * engineering truth. The BFF owns this presentation boundary only.
 */
export function projectEngineeringWorkbenchSnapshot(
  project: EngineeringProjectSnapshot,
  thread: LiveThreadWorkbenchSnapshot,
  currentThreadRevision: number,
  options: { operatorCommandsEnabled?: boolean } = {},
): EngineeringEvidenceWorkbenchSnapshot {
  if (project.project.subjectId !== thread.subject.id) {
    throw new Error(
      `Engineering project subject ${project.project.subjectId} does not match thread subject ${thread.subject.id}.`,
    );
  }
  if (project.threadSnapshots.length === 0) {
    throw new Error("Engineering project must reference an exact thread snapshot.");
  }
  const projectThreadRevision = Math.max(
    ...project.threadSnapshots.map((reference) => reference.revision),
  );
  if (!Number.isSafeInteger(currentThreadRevision) || currentThreadRevision <= 0) {
    throw new Error("Current thread revision must be a positive safe integer.");
  }
  if (currentThreadRevision < projectThreadRevision) {
    throw new Error(
      `Current thread revision ${currentThreadRevision} precedes project thread revision ${projectThreadRevision}.`,
    );
  }
  return {
    schemaVersion: ENGINEERING_WORKBENCH_SCHEMA,
    surface: "evidence",
    project: structuredClone(project),
    thread: structuredClone(thread),
    alignment: {
      status: currentThreadRevision === projectThreadRevision
        ? "aligned"
        : "thread-ahead",
      projectThreadRevision,
      currentThreadRevision,
    },
    capabilities: {
      operatorCommands: {
        enabled: options.operatorCommandsEnabled === true,
        endpoint: ENGINEERING_OPERATOR_COMMAND_ENDPOINT,
        intents: options.operatorCommandsEnabled === true
          ? ENGINEERING_OPERATOR_COMMAND_INTENTS
          : [],
        explicitIntentHeader: ENGINEERING_OPERATOR_INTENT_HEADER,
        expectedRevision: project.revision,
      },
    },
  };
}

/**
 * Project an approved discovery and an agent-published path before any
 * technical baseline exists. This deliberately accepts no ThreadSnapshot and
 * has no alignment fields: there is nothing technical to align yet.
 */
export function projectEngineeringPlanningWorkbenchSnapshot(
  project: EngineeringProjectSnapshot,
): EngineeringPlanningWorkbenchSnapshot {
  if (project.threadSnapshots.length !== 0) {
    throw new Error(
      "A planning-only Workbench projection cannot include a technical thread snapshot.",
    );
  }
  return {
    schemaVersion: ENGINEERING_WORKBENCH_SCHEMA,
    surface: "planning",
    project: structuredClone(project),
    planning: {
      technicalBaseline: {
        status: "not-created",
        message:
          "Technical baseline not created yet. This project path records intent and planned work only; no engineering tool result is being shown.",
      },
    },
    capabilities: {
      operatorCommands: {
        // There is no operator command that can safely act on a project before
        // an exact technical baseline exists. The browser must not expose a
        // generic command channel merely because this BFF is loopback-bound.
        enabled: false,
        endpoint: ENGINEERING_OPERATOR_COMMAND_ENDPOINT,
        intents: [],
        explicitIntentHeader: ENGINEERING_OPERATOR_INTENT_HEADER,
        expectedRevision: project.revision,
      },
    },
  };
}
