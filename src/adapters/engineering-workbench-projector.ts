import type {
  EngineeringAgentRun,
  EngineeringAgentRunStatus,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../domain/engineering-project.ts";
import type {
  LiveThreadUpdate,
  LiveThreadUpdateState,
  LiveThreadWorkbenchSnapshot,
} from "./live-thread-update-store.ts";

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
 * Durable provenance after the approved-discovery baseline has been recorded,
 * before a linked technical operation produces any engineering evidence.
 *
 * The record intentionally does not carry the generic thread graph. A
 * documentary capture proves that exact approved intent was retained; it does
 * not prove a model, calculation, measurement, requirement evaluation or
 * compliance conclusion.
 */
export interface EngineeringDocumentaryWorkbenchSnapshot
  extends EngineeringWorkbenchBaseSnapshot {
  surface: "documentary";
  documentary: {
    status: "recorded";
    message: string;
    record: {
      origin: "approved-discovery";
      snapshotId: string;
      snapshotRevision: number;
      artifactId: string;
      label: string;
      fingerprint: string;
      uri?: string;
      recordedAt: string;
    };
    technicalEvidence: {
      status: "not-recorded";
      message: string;
    };
  };
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
      status: EngineeringTechnicalBaselineStatus;
      message: string;
    };
    /**
     * A deliberately redacted summary of the one run that can create the
     * first documentary pre-technical baseline. It is status/provenance only: browser clients
     * never receive tool inputs, structured output or provider diagnostics.
     */
    baselineRun?: EngineeringPlanningBaselineRun;
    /**
     * Non-canonical milestones from the live journal for that one baseline
     * run. The graph patch stays server-side until canonical evidence exists.
     */
    activity: EngineeringPlanningActivity;
  };
}

export type EngineeringTechnicalBaselineStatus =
  | "not-created"
  | "queued"
  | "running"
  | "publishing"
  | "failed";

export interface EngineeringPlanningBaselineRun {
  id: string;
  status: EngineeringAgentRunStatus;
  workItem: {
    id: string;
    title: string;
    kind: EngineeringWorkItem["kind"];
  };
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  /** No command id, actor id or free-text run summary crosses this boundary. */
  statusHistory: readonly EngineeringPlanningBaselineRunMilestone[];
}

export interface EngineeringPlanningBaselineRunMilestone {
  status: EngineeringAgentRunStatus;
  at: string;
}

export interface EngineeringPlanningActivity {
  /** Latest append-only journal sequence observed for this subject. */
  version: number;
  /** Only state/timing from updates belonging to baselineRun. */
  milestones: readonly EngineeringPlanningActivityMilestone[];
}

export interface EngineeringPlanningActivityMilestone {
  sequence: number;
  state: LiveThreadUpdateState;
  recordedAt: string;
}

export type EngineeringWorkbenchSnapshot =
  | EngineeringEvidenceWorkbenchSnapshot
  | EngineeringDocumentaryWorkbenchSnapshot
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
): EngineeringEvidenceWorkbenchSnapshot | EngineeringDocumentaryWorkbenchSnapshot {
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
  if (
    isApprovedDiscoveryDocumentaryBaseline(
      project,
      thread,
      currentThreadRevision,
    )
  ) {
    const document = thread.artifacts[0]!;
    return {
      schemaVersion: ENGINEERING_WORKBENCH_SCHEMA,
      surface: "documentary",
      // The documentary surface has no provider result. Keep the same bounded
      // pre-technical project projection as planning so a legacy free-text run
      // summary cannot be mistaken for proof merely because the capture exists.
      project: publicPlanningProjectSnapshot(project),
      documentary: {
        status: "recorded",
        message:
          "The approved discovery and reviewed project path are durably captured in one exact record. This is provenance for the work ahead, not a technical result.",
        record: {
          origin: "approved-discovery",
          snapshotId: thread.id,
          snapshotRevision: currentThreadRevision,
          artifactId: document.id,
          label: document.label,
          fingerprint: document.fingerprint!,
          ...(document.uri ? { uri: document.uri } : {}),
          recordedAt: thread.generatedAt,
        },
        technicalEvidence: {
          status: "not-recorded",
          message:
            "No CAD, SysML, simulation, measurement, requirement evaluation or compliance proof is recorded yet.",
        },
      },
      capabilities: noOperatorCommands(project),
    };
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
    capabilities: operatorCommands(project, options.operatorCommandsEnabled === true),
  };
}

/**
 * Detect the one narrow V2 root record which is explicitly allowed to exist
 * before technical evidence. This is intentionally structural rather than a
 * label match: a regular document, a fixture or a thread containing any
 * projected engineering fact continues through the technical evidence surface.
 *
 * The generic thread projection omits canonical evaluations and consumptions,
 * but the trusted V2 initial-result validator requires those collections to be
 * empty before this BFF can ever see the snapshot. Here we recheck every
 * browser-visible part of that same boundary before dropping the graph.
 */
function isApprovedDiscoveryDocumentaryBaseline(
  project: EngineeringProjectSnapshot,
  thread: LiveThreadWorkbenchSnapshot,
  currentThreadRevision: number,
): boolean {
  if (
    project.schemaVersion !== "2.0" ||
    project.threadSnapshots.length !== 1 ||
    currentThreadRevision !== 1 ||
    thread.source !== "observed" ||
    thread.artifacts.length !== 1 ||
    thread.observations.length !== 0 ||
    thread.requirements.length !== 0 ||
    thread.violations.length !== 0 ||
    thread.actions.length !== 0
  ) {
    return false;
  }
  const reference = project.threadSnapshots[0]!;
  const document = thread.artifacts[0]!;
  return reference.snapshotId === thread.id &&
    reference.revision === currentThreadRevision &&
    reference.subjectId === thread.subject.id &&
    document.kind === "document" &&
    document.system === "casys-digital-thread" &&
    document.producedBy === "baseline_from_approved_discovery" &&
    document.dependsOn.length === 0 &&
    typeof document.fingerprint === "string" && document.fingerprint.length > 0;
}

function operatorCommands(
  project: EngineeringProjectSnapshot,
  enabled: boolean,
): EngineeringWorkbenchCapabilities {
  return {
    operatorCommands: {
      enabled,
      endpoint: ENGINEERING_OPERATOR_COMMAND_ENDPOINT,
      intents: enabled ? ENGINEERING_OPERATOR_COMMAND_INTENTS : [],
      explicitIntentHeader: ENGINEERING_OPERATOR_INTENT_HEADER,
      expectedRevision: project.revision,
    },
  };
}

function noOperatorCommands(
  project: EngineeringProjectSnapshot,
): EngineeringWorkbenchCapabilities {
  return operatorCommands(project, false);
}

/**
 * Project an approved discovery and an agent-published path before any
 * technical baseline exists. This deliberately accepts no ThreadSnapshot and
 * has no alignment fields: there is nothing technical to align yet.
 */
export function projectEngineeringPlanningWorkbenchSnapshot(
  project: EngineeringProjectSnapshot,
  liveUpdates: readonly LiveThreadUpdate[] = [],
  options: { operatorCommandsEnabled?: boolean } = {},
): EngineeringPlanningWorkbenchSnapshot {
  if (project.threadSnapshots.length !== 0) {
    throw new Error(
      "A planning-only Workbench projection cannot include a technical thread snapshot.",
    );
  }
  const baselineRun = projectPlanningBaselineRun(project);
  const queueableBaseline = project.workItems.find((item) =>
    item.status === "ready" &&
    item.operation?.id === "baseline.from-approved-discovery" &&
    item.operation.version === "1"
  );
  const canQueueBaseline = options.operatorCommandsEnabled === true &&
    queueableBaseline !== undefined;
  return {
    schemaVersion: ENGINEERING_WORKBENCH_SCHEMA,
    surface: "planning",
    project: publicPlanningProjectSnapshot(project),
    planning: {
      technicalBaseline: {
        status: technicalBaselineStatus(baselineRun?.status),
        message: technicalBaselineMessage(baselineRun),
      },
      ...(baselineRun ? { baselineRun } : {}),
      activity: projectPlanningActivity(liveUpdates, baselineRun?.id),
    },
    capabilities: {
      operatorCommands: {
        // The only planning-time operator action is the exact ready first
        // baseline. The browser never supplies its basis or any tool input.
        enabled: canQueueBaseline,
        endpoint: ENGINEERING_OPERATOR_COMMAND_ENDPOINT,
        intents: canQueueBaseline ? ["agent-run.queue"] : [],
        explicitIntentHeader: ENGINEERING_OPERATOR_INTENT_HEADER,
        expectedRevision: project.revision,
      },
    },
  };
}

/**
 * Pick the active baseline attempt first. If no attempt is active, preserve
 * the latest recorded outcome so a failed or cancelled attempt is visible
 * without inventing a ThreadSnapshot.
 */
function projectPlanningBaselineRun(
  project: EngineeringProjectSnapshot,
): EngineeringPlanningBaselineRun | undefined {
  const workItems = new Map(project.workItems.map((item) => [item.id, item]));
  const candidates = project.agentRuns.flatMap((run) => {
    const workItem = workItems.get(run.workItemId);
    return workItem ? [{ run, workItem }] : [];
  });
  if (candidates.length === 0) return undefined;
  const active = candidates.filter(({ run }) => isActiveBaselineRun(run.status));
  const selected = latestPlanningRun(active.length > 0 ? active : candidates);
  return {
    id: selected.run.id,
    status: selected.run.status,
    workItem: {
      id: selected.workItem.id,
      title: selected.workItem.title,
      kind: selected.workItem.kind,
    },
    queuedAt: selected.run.queuedAt,
    ...(selected.run.startedAt ? { startedAt: selected.run.startedAt } : {}),
    ...(selected.run.completedAt ? { completedAt: selected.run.completedAt } : {}),
    statusHistory: (selected.run.statusHistory ?? []).map((transition) => ({
      status: transition.status,
      at: transition.at,
    })),
  };
}

function isActiveBaselineRun(status: EngineeringAgentRunStatus): boolean {
  return status === "queued" || status === "running" ||
    status === "waiting-for-decision" || status === "publishing";
}

function latestPlanningRun<T extends { run: EngineeringAgentRun }>(
  candidates: readonly T[],
): T {
  return [...candidates].sort((left, right) =>
    planningRunTimestamp(right.run).localeCompare(planningRunTimestamp(left.run)) ||
    right.run.id.localeCompare(left.run.id)
  )[0]!;
}

function planningRunTimestamp(run: EngineeringAgentRun): string {
  return run.statusHistory?.at(-1)?.at ?? run.completedAt ?? run.startedAt ??
    run.queuedAt;
}

function technicalBaselineStatus(
  runStatus: EngineeringAgentRunStatus | undefined,
): EngineeringTechnicalBaselineStatus {
  if (runStatus === "queued") return "queued";
  if (runStatus === "running" || runStatus === "waiting-for-decision") {
    return "running";
  }
  if (runStatus === "publishing") return "publishing";
  if (runStatus === "failed") return "failed";
  return "not-created";
}

function technicalBaselineMessage(
  run: EngineeringPlanningBaselineRun | undefined,
): string {
  switch (technicalBaselineStatus(run?.status)) {
    case "queued":
      return "A reviewed first run is queued. The project path is still intent only until that run records an exact documentary pre-technical baseline.";
    case "running":
      return "The agent is preparing the first documentary pre-technical baseline. Live milestones show progress only; no tool result or technical evidence is being shown yet.";
    case "publishing":
      return "The agent is recording the first documentary pre-technical baseline. This planning surface will change only after that record is durably published; the record is not tool evidence.";
    case "failed":
      return "The last baseline run did not publish a documentary baseline. Review the recorded path with your agent before asking for a new run.";
    default:
      if (run?.status === "cancelled") {
        return "The last baseline run was cancelled before a documentary baseline was published. This project remains planning intent only.";
      }
      if (run?.status === "completed") {
        return "The last recorded run completed without a published documentary baseline. This project remains planning intent only.";
      }
      return "Documentary pre-technical baseline not created yet. This project path records intent and planned work only; no engineering tool result is being shown.";
  }
}

function projectPlanningActivity(
  liveUpdates: readonly LiveThreadUpdate[],
  baselineRunId: string | undefined,
): EngineeringPlanningActivity {
  return {
    version: liveUpdates.at(-1)?.sequence ?? 0,
    milestones: baselineRunId
      ? liveUpdates.filter((update) => update.runId === baselineRunId).map(
        (update) => ({
          sequence: update.sequence,
          state: update.state,
          recordedAt: update.recordedAt,
        }),
      )
      : [],
  };
}

/**
 * The project aggregate remains a revision/audit read model for the local
 * reviewer. Before evidence exists, replace agent-provided run prose and
 * provider failure text with bounded, presentation-owned wording. The
 * dedicated `planning.baselineRun` field is the small display model: it omits
 * command ids, actor ids and free-text history by construction.
 */
function publicPlanningProjectSnapshot(
  project: EngineeringProjectSnapshot,
): EngineeringProjectSnapshot {
  const workItems = new Map(project.workItems.map((item) => [item.id, item]));
  return {
    ...structuredClone(project),
    agentRuns: project.agentRuns.map((run) => {
      const workItem = workItems.get(run.workItemId);
      const label = workItem?.title ?? "a recorded engineering task";
      return {
        ...structuredClone(run),
        summary: publicRunSummary(run.status, label),
        ...(run.failure
          ? {
            failure: {
              code: "baseline-run-failed",
              message: "The run stopped before it published a documentary baseline.",
            },
          }
          : {}),
        ...(run.statusHistory
          ? {
            statusHistory: run.statusHistory.map((transition) => ({
              ...structuredClone(transition),
              summary: publicRunSummary(transition.status, label),
            })),
          }
          : {}),
      };
    }),
  };
}

function publicRunSummary(status: EngineeringAgentRunStatus, label: string): string {
  if (status === "failed") {
    return `The baseline run for ${label} stopped before publishing a documentary baseline.`;
  }
  if (status === "cancelled") {
    return `The baseline run for ${label} was cancelled before publishing a documentary baseline.`;
  }
  return `Recorded baseline run for ${label}: ${status}.`;
}
