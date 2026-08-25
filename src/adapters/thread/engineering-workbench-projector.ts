import type {
  EngineeringAgentRun,
  EngineeringAgentRunStatus,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../domain/project/engineering-project.ts";
import {
  collectEngineeringActivities,
} from "../../domain/project/engineering-activity.ts";
import type { EngineeringPathLaneId } from "../../domain/project/engineering-path-lane.ts";
import type {
  EngineeringOperationPathLaneDeclaration,
  EngineeringOperationPathLaneResolver,
} from "../../application/ports/out/project/engineering-operation-path-lane-resolver.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../domain/architecture/seed/syson-model-seed.ts";
import { ENGINEERING_WORKBENCH_SCHEMA } from "../../presentation/workbench/engineering/schema.ts";
import type {
  EngineeringDocumentaryTechnicalStart,
  EngineeringDocumentaryTechnicalStartState,
  EngineeringDocumentaryTechnicalStartStep,
  EngineeringDocumentaryWorkbenchSnapshot,
} from "../../presentation/workbench/engineering/documentary.ts";
import type {
  EngineeringEvidenceWorkbenchSnapshot,
  EngineeringWorkbenchUnresolvedEvidenceReference,
} from "../../presentation/workbench/engineering/evidence.ts";
import type {
  EngineeringPlanningActivity,
  EngineeringPlanningBaselineRun,
  EngineeringPlanningWorkbenchSnapshot,
  EngineeringTechnicalBaselineStatus,
} from "../../presentation/workbench/engineering/planning.ts";
import type { LiveThreadWorkbenchSnapshot } from "../../presentation/workbench/engineering/live-overlay.ts";
import type { LiveThreadUpdate } from "../shared/stores/live-thread-update-store.ts";

export { ENGINEERING_WORKBENCH_SCHEMA } from "../../presentation/workbench/engineering/schema.ts";
export type {
  EngineeringDocumentaryTechnicalStart,
  EngineeringDocumentaryTechnicalStartState,
  EngineeringDocumentaryTechnicalStartStep,
  EngineeringDocumentaryWorkbenchSnapshot,
} from "../../presentation/workbench/engineering/documentary.ts";
export type {
  EngineeringEvidenceWorkbenchSnapshot,
  EngineeringWorkbenchAlignment,
  EngineeringWorkbenchBaseSnapshot,
  EngineeringWorkbenchCaseActivityJoin,
} from "../../presentation/workbench/engineering/evidence.ts";
export type {
  EngineeringPlanningActivity,
  EngineeringPlanningActivityMilestone,
  EngineeringPlanningAgentRunStatus,
  EngineeringPlanningBaselineRun,
  EngineeringPlanningBaselineRunMilestone,
  EngineeringPlanningWorkbenchSnapshot,
  EngineeringTechnicalBaselineStatus,
} from "../../presentation/workbench/engineering/planning.ts";
export type { EngineeringWorkbenchSnapshot } from "../../presentation/workbench/engineering/snapshot.ts";

/**
 * Compose project intent and observed thread evidence without deriving new
 * engineering truth. The BFF owns this presentation boundary only.
 */
export function projectEngineeringWorkbenchSnapshot(
  project: EngineeringProjectSnapshot,
  thread: LiveThreadWorkbenchSnapshot,
  currentThreadRevision: number,
  liveUpdates: readonly LiveThreadUpdate[] = [],
  unresolvedEvidenceReferences:
    readonly EngineeringWorkbenchUnresolvedEvidenceReference[] = [],
  operationPathLanes?: EngineeringOperationPathLaneResolver,
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
    projectPath: projectPhaseLanes(project, operationPathLanes),
    alignment: {
      status: currentThreadRevision === projectThreadRevision
        ? "aligned"
        : "thread-ahead",
      projectThreadRevision,
      currentThreadRevision,
    },
    caseActivityJoins: projectCaseActivityJoins(project, thread),
    // Project the two published fields only: a spread would leak future
    // domain-issue fields past the exact-keys browser guard.
    unresolvedEvidenceReferences: unresolvedEvidenceReferences.map((issue) => ({
      path: issue.path,
      message: issue.message,
    })),
  };
}

function projectCaseActivityJoins(
  project: EngineeringProjectSnapshot,
  thread: LiveThreadWorkbenchSnapshot,
): EngineeringEvidenceWorkbenchSnapshot["caseActivityJoins"] {
  const cases = thread.engineeringCases?.cases ?? [];
  if (cases.length === 0) return [];
  const runById = new Map(project.agentRuns.map((run) => [run.id, run]));
  const workById = new Map(project.workItems.map((item) => [item.id, item]));
  const artifactById = new Map(
    thread.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  return cases.flatMap((verificationCase) => {
    const runId = uniqueAuthorityProducerRunId(
      verificationCase.authorityArtifactIds,
      artifactById,
    );
    if (runId === undefined) return [];
    const run = runById.get(runId);
    const workItem = run ? workById.get(run.workItemId) : undefined;
    if (!run || !workItem?.activityId) return [];
    return [{
      caseKey: verificationCase.key,
      caseId: verificationCase.id,
      caseRevision: verificationCase.revision,
      activityId: workItem.activityId,
      workItemId: workItem.id,
      runId,
    }];
  }).toSorted((left, right) => left.caseKey.localeCompare(right.caseKey));
}

function uniqueAuthorityProducerRunId(
  authorityArtifactIds: readonly string[],
  artifactById: ReadonlyMap<
    string,
    LiveThreadWorkbenchSnapshot["artifacts"][number]
  >,
): string | undefined {
  if (authorityArtifactIds.length === 0) return undefined;
  let runId: string | undefined;
  for (const artifactId of authorityArtifactIds) {
    const producerRunId = artifactById.get(artifactId)?.producerRunId;
    if (!producerRunId) return undefined;
    if (runId === undefined) runId = producerRunId;
    else if (producerRunId !== runId) return undefined;
  }
  return runId;
}

function projectPhaseLanes(
  project: EngineeringProjectSnapshot,
  resolver: EngineeringOperationPathLaneResolver | undefined,
): EngineeringEvidenceWorkbenchSnapshot["projectPath"] {
  const phases = [...project.phases].sort((left, right) => left.order - right.order);
  if (phases.length > 0 && !resolver) {
    throw new Error(
      "Engineering project path lanes require the registered operation lane resolver.",
    );
  }
  const workItems = new Map(project.workItems.map((item) => [item.id, item]));
  const declarations = phases.map((phase) =>
    phase.workItemIds.flatMap((workItemId) => {
      const operation = workItems.get(workItemId)?.operation;
      const declaration = operation && resolver?.resolve(operation);
      return declaration ? [declaration] : [];
    })
  );
  const fixedLanes = declarations.map(uniqueFixedLane);
  const phaseLanes = phases.map((phase, index) => ({
    phaseId: phase.id,
    lane: resolvePhaseLane(
      phase.id,
      declarations[index] ?? [],
      fixedLanes.slice(index + 1),
    ),
  }));
  const laneByPhase = new Map(
    phaseLanes.map((entry) => [entry.phaseId, entry.lane]),
  );

  return {
    phaseLanes,
    activities: collectEngineeringActivities(project.workItems).map(
      (activity) => {
        const root = workItems.get(activity.rootRevisionId);
        const operation = root?.operation;
        const declaration = operation && resolver?.resolve(operation);
        const lane = declaration?.kind === "fixed"
          ? declaration.lane
          : laneByPhase.get(root?.phaseId ?? "") ??
            (declaration?.kind === "contextual" ? declaration.fallback : undefined);
        if (!lane) {
          throw new Error(
            `Engineering activity ${activity.id} has no unique registered path lane.`,
          );
        }
        return {
          id: activity.id,
          lane,
          rootRevisionId: activity.rootRevisionId,
          revisionIds: activity.revisionIds,
        };
      },
    ),
  };
}

function uniqueFixedLane(
  declarations: readonly EngineeringOperationPathLaneDeclaration[],
): EngineeringPathLaneId | undefined {
  const fixed = fixedPathLanes(declarations);
  return fixed.size === 1 ? [...fixed][0] : undefined;
}

function fixedPathLanes(
  declarations: readonly EngineeringOperationPathLaneDeclaration[],
): ReadonlySet<EngineeringPathLaneId> {
  return new Set(
    declarations.flatMap((declaration) =>
      declaration.kind === "fixed" ? [declaration.lane] : []
    ),
  );
}

function resolvePhaseLane(
  phaseId: string,
  declarations: readonly EngineeringOperationPathLaneDeclaration[],
  downstreamFixed: readonly (EngineeringPathLaneId | undefined)[],
): EngineeringPathLaneId {
  const fixed = uniqueFixedLane(declarations);
  if (fixed) return fixed;

  const contextual = declarations.filter((declaration) =>
    declaration.kind === "contextual"
  );
  const mixedFixed = fixedPathLanes(declarations);
  // A scheduling phase may hold several activities. phaseLanes is not activity
  // identity: when several fixed lanes coexist and none is contextual, keep
  // the contract total with the lexicographically first registered lane.
  // Overview still places each activity in its own registered lane.
  if (mixedFixed.size > 1 && contextual.length === 0) {
    return [...mixedFixed].toSorted()[0]!;
  }
  if (contextual.length === 0) {
    throw new Error(
      `Engineering project phase ${phaseId} has no unique registered path lane.`,
    );
  }

  const nextFixed = downstreamFixed.find((candidate) => candidate !== undefined);
  const resolved = new Set(
    contextual.map((declaration) =>
      nextFixed && declaration.allowedNext.includes(nextFixed)
        ? nextFixed
        : declaration.fallback
    ),
  );
  if (resolved.size !== 1) {
    throw new Error(
      `Engineering project phase ${phaseId} resolves to conflicting path lanes.`,
    );
  }
  return [...resolved][0]!;
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
  // The write-ahead record prevents an automatic provider retry. Current
  // executors also seal the authoritative run as a terminal uncertain failure;
  // the live failed milestone remains the presentation fallback for historical
  // runs that predate that lifecycle transition.
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
  return "The technical start did not publish a model-container record. It is not retried automatically; inspect SysON, then complete the uncertain-writer reconciliation through the paired agent before creating a successor.";
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
    project.schemaVersion !== "4.0" ||
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
