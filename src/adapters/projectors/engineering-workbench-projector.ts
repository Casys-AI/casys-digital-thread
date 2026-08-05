import type {
  EngineeringAgentRun,
  EngineeringAgentRunStatus,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../domain/engineering-project.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../domain/syson-model-seed.ts";
import type {
  LiveThreadUpdate,
  LiveThreadUpdateState,
  LiveThreadWorkbenchSnapshot,
} from "../live-thread-update-store.ts";

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
}

/** Project intent plus a real, persisted technical evidence projection. */
export interface EngineeringEvidenceWorkbenchSnapshot
  extends EngineeringWorkbenchBaseSnapshot {
  surface: "evidence";
  thread: LiveThreadWorkbenchSnapshot;
  alignment: EngineeringWorkbenchAlignment;
}

/**
 * Durable provenance after the approved-brief baseline has been recorded,
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
      origin: "approved-brief";
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
    /**
     * The one bounded technical operation that may run while r1 remains the
     * only canonical snapshot. This is a browser-safe progress projection,
     * never a provider result or a second, invented technical graph.
     */
    technicalStart?: EngineeringDocumentaryTechnicalStart;
  };
}

export type EngineeringDocumentaryTechnicalStartState =
  | "queued"
  | "running"
  | "publishing"
  | "failed";

/**
 * A deliberately closed projection for the SysON container seed. The server
 * derives each step from a known run and known live-milestone IDs; neither
 * provider IDs, tool arguments nor raw results cross this BFF boundary.
 */
export interface EngineeringDocumentaryTechnicalStart {
  readonly kind: "sysml-container-seed";
  readonly state: EngineeringDocumentaryTechnicalStartState;
  readonly message: string;
  readonly activity: {
    /** Latest relevant live-journal sequence, not a thread revision. */
    readonly version: number;
    readonly steps: readonly EngineeringDocumentaryTechnicalStartStep[];
  };
}

export interface EngineeringDocumentaryTechnicalStartStep {
  readonly id: "project-container" | "sysml-document" | "root-package";
  readonly state: "running" | "fresh" | "failed";
  readonly label: string;
  readonly summary: string;
  readonly recordedAt: string;
  /** The declared containment relation to the preceding visible step. */
  readonly predecessor?: "project-container" | "sysml-document";
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
  liveUpdates: readonly LiveThreadUpdate[] = [],
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
    isDocumentaryBaseline(
      project,
      thread,
      currentThreadRevision,
    )
  ) {
    const document = thread.artifacts[0]!;
    const technicalStart = projectDocumentaryTechnicalStart(
      project,
      liveUpdates,
    );
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
          "The canonical project brief and reviewed path are durably captured in one exact record. This is provenance for the work ahead, not a technical result.",
        record: {
          origin: "approved-brief",
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
        ...(technicalStart ? { technicalStart } : {}),
      },
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
  };
}

const SYSON_MODEL_SEED_LIVE_STEPS = [
  {
    operationId: `${SYSON_MODEL_SEED_OPERATION.id}:syson_project_create`,
    id: "project-container",
    label: "SysON project container",
    predecessor: undefined,
  },
  {
    operationId: `${SYSON_MODEL_SEED_OPERATION.id}:syson_model_create`,
    id: "sysml-document",
    label: "Editable SysML document",
    predecessor: "project-container",
  },
  {
    operationId: `${SYSON_MODEL_SEED_OPERATION.id}:syson_element_get`,
    id: "root-package",
    label: "SysML root package",
    predecessor: "sysml-document",
  },
] as const;

/**
 * Preserve the calm documentary surface while the first fixed technical run
 * is in progress. The projection intentionally reconstructs a tiny allowed
 * sequence from journal metadata instead of forwarding graph patches, which
 * prevents a future arbitrary journal entry from becoming a browser tool view.
 */
function projectDocumentaryTechnicalStart(
  project: EngineeringProjectSnapshot,
  liveUpdates: readonly LiveThreadUpdate[],
): EngineeringDocumentaryTechnicalStart | undefined {
  const workItems = new Map(project.workItems.map((item) => [item.id, item]));
  const candidates = project.agentRuns.flatMap((run) => {
    const workItem = workItems.get(run.workItemId);
    return workItem && isSysonModelSeedOperation(workItem) ? [{ run, workItem }] : [];
  });
  if (candidates.length === 0) return undefined;
  const run = latestPlanningRun(candidates).run;
  const runState = documentaryTechnicalStartState(run.status);
  if (!runState) return undefined;

  const reconciliationSequence = liveUpdates.reduce(
    (latest, update) =>
      update.runId === run.id && update.state === "reconciled"
        ? Math.max(latest, update.sequence)
        : latest,
    0,
  );
  const visibleUpdates = liveUpdates.filter(
    (update): update is LiveThreadUpdate & {
      state: EngineeringDocumentaryTechnicalStartStep["state"];
    } =>
      update.runId === run.id &&
      update.baseRevision === 1 &&
      update.sequence > reconciliationSequence &&
      (update.state === "running" || update.state === "fresh" ||
        update.state === "failed") &&
      SYSON_MODEL_SEED_LIVE_STEPS.some((step) =>
        step.operationId === update.operationId
      ),
  );
  const latestByOperation = new Map(
    visibleUpdates.map((update) => [update.operationId, update]),
  );
  const steps = SYSON_MODEL_SEED_LIVE_STEPS.flatMap((step) => {
    const update = latestByOperation.get(step.operationId);
    if (!update) return [];
    return [{
      id: step.id,
      state: update.state,
      label: step.label,
      summary: documentaryTechnicalStartStepSummary(step.id, update.state),
      recordedAt: update.recordedAt,
      ...(step.predecessor ? { predecessor: step.predecessor } : {}),
    }];
  });
  const version = Math.max(
    reconciliationSequence,
    ...visibleUpdates.map((update) => update.sequence),
  );
  // A write-ahead record intentionally keeps the authoritative run running
  // when a provider creation outcome is unknown: that state prevents an
  // automatic retry. The latest public failed milestone must nevertheless
  // win in the cockpit so a person sees `needs review`, not a falsely live
  // operation. A later fresh milestone can supersede it only if an explicit
  // reviewed recovery has produced one.
  const latestMilestone = visibleUpdates.reduce<LiveThreadUpdate | undefined>(
    (latest, update) => !latest || update.sequence > latest.sequence ? update : latest,
    undefined,
  );
  const state = latestMilestone?.state === "failed" ? "failed" : runState;
  return {
    kind: "sysml-container-seed",
    state,
    message: documentaryTechnicalStartMessage(state),
    activity: { version, steps },
  };
}

function documentaryTechnicalStartState(
  status: EngineeringAgentRunStatus,
): EngineeringDocumentaryTechnicalStartState | undefined {
  if (status === "queued") return "queued";
  if (status === "running" || status === "waiting-for-decision") {
    return "running";
  }
  if (status === "publishing") return "publishing";
  if (status === "failed") return "failed";
  return undefined;
}

function documentaryTechnicalStartMessage(
  state: EngineeringDocumentaryTechnicalStartState,
): string {
  if (state === "queued") {
    return "A reviewed technical start is queued. It can create only an empty SysON project, document, and root package after the agent begins the authorized run.";
  }
  if (state === "running") {
    return "The agent is creating and reading back the first empty SysON model container. These live steps orient the review; they are not canonical engineering evidence yet.";
  }
  if (state === "publishing") {
    return "The read-back container identity is being persisted as the next exact thread revision. The live sequence remains provisional until that publication completes.";
  }
  return "The technical start did not publish a model-container record. It is not retried automatically; this early slice exposes no recovery action in the cockpit.";
}

function documentaryTechnicalStartStepSummary(
  id: EngineeringDocumentaryTechnicalStartStep["id"],
  state: EngineeringDocumentaryTechnicalStartStep["state"],
): string {
  const subject = id === "project-container"
    ? "empty project container"
    : id === "sysml-document"
    ? "document and empty root package"
    : "root package identity";
  if (state === "running") return `Reading or creating the ${subject}.`;
  if (state === "failed") {
    return "This step did not complete. The provider state is kept for review and is not retried automatically.";
  }
  if (id === "project-container") {
    return "Container created. It does not yet contain a system architecture.";
  }
  if (id === "sysml-document") {
    return "Document created. No drone architecture, requirement, or verification claim has been added.";
  }
  return "Identity read back from SysON; a later reviewed operation may add model semantics.";
}

function isSysonModelSeedOperation(workItem: EngineeringWorkItem): boolean {
  return workItem.operation?.id === SYSON_MODEL_SEED_OPERATION.id &&
    workItem.operation.version === SYSON_MODEL_SEED_OPERATION.version;
}

/**
 * Detect the one narrow approved-brief root record which is explicitly allowed to exist
 * before technical evidence. This is intentionally structural rather than a
 * label match: a regular document, a fixture or a thread containing any
 * projected engineering fact continues through the technical evidence surface.
 *
 * The generic thread projection omits canonical evaluations and consumptions,
 * but the trusted initial-result validator requires those collections to be
 * empty before this BFF can ever see the snapshot. Here we recheck every
 * browser-visible part of that same boundary before dropping the graph.
 */
function isDocumentaryBaseline(
  project: EngineeringProjectSnapshot,
  thread: LiveThreadWorkbenchSnapshot,
  currentThreadRevision: number,
): boolean {
  if (
    project.schemaVersion !== "3.0" ||
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
    document.producedBy === "baseline_from_approved_brief" &&
    document.dependsOn.length === 0 &&
    typeof document.fingerprint === "string" && document.fingerprint.length > 0;
}

/**
 * Project an approved brief and an agent-published path before any
 * technical baseline exists. This deliberately accepts no ThreadSnapshot and
 * has no alignment fields: there is nothing technical to align yet.
 */
export function projectEngineeringPlanningWorkbenchSnapshot(
  project: EngineeringProjectSnapshot,
  liveUpdates: readonly LiveThreadUpdate[] = [],
): EngineeringPlanningWorkbenchSnapshot {
  if (project.threadSnapshots.length !== 0) {
    throw new Error(
      "A planning-only Workbench projection cannot include a technical thread snapshot.",
    );
  }
  const baselineRun = projectPlanningBaselineRun(project);
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
 * project aggregate drops its command receipts and execution anchors; the
 * dedicated `planning.baselineRun` field is the small display model for the
 * first baseline attempt and omits command ids, actor ids and free-text
 * history by construction.
 */
function publicPlanningProjectSnapshot(
  project: EngineeringProjectSnapshot,
): EngineeringProjectSnapshot {
  const workItems = new Map(project.workItems.map((item) => [item.id, item]));
  const { commandReceipts: _commandReceipts, ...publicProject } = structuredClone(
    project,
  );
  return {
    ...publicProject,
    agentRuns: project.agentRuns.map((run) => {
      const workItem = workItems.get(run.workItemId);
      const label = workItem?.title ?? "a recorded engineering task";
      return {
        // Keep only the status fields that this pre-evidence surface actually
        // renders. In particular, command receipts, actors, exact bases,
        // fingerprints, result references and free-text transition history do
        // not cross the browser boundary here.
        id: run.id,
        workItemId: run.workItemId,
        status: run.status,
        summary: publicRunSummary(run.status, label),
        queuedAt: run.queuedAt,
        ...(run.startedAt ? { startedAt: run.startedAt } : {}),
        ...(run.completedAt ? { completedAt: run.completedAt } : {}),
        evidenceRefs: [],
        ...(run.failure
          ? {
            failure: {
              code: "agent-run-failed",
              message: "The agent run stopped before it published its bounded result.",
            },
          }
          : {}),
      };
    }),
  };
}

function publicRunSummary(status: EngineeringAgentRunStatus, label: string): string {
  if (status === "failed") {
    return `The agent run for ${label} stopped before publishing its bounded result.`;
  }
  if (status === "cancelled") {
    return `The agent run for ${label} was cancelled before publishing its bounded result.`;
  }
  return `Recorded agent run for ${label}: ${status}.`;
}
