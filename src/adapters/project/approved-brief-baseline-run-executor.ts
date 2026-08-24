import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type EngineeringProjectCommandOrigin,
} from "../../application/ports/in/engineering-project-command-origin.ts";
import {
  type EngineeringProjectRevisionStore,
} from "../../application/ports/out/engineering-project-revision-store.ts";
import type {
  EngineeringAgentRun,
  EngineeringApprovedBriefBasis,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotRef,
  EngineeringWorkItem,
} from "../../domain/project/engineering-project.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  type SourceAnalysisFrontendRegistry,
} from "../../domain/compile/source/source-analysis-frontend-registry.ts";
import { validateSourceAnalysisBundle } from "../../domain/compile/source/source-analysis.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { APPROVED_BRIEF_BASELINE_OPERATION } from "../../domain/compile/brief/approved-brief-baseline.ts";
import {
  materializeApprovedBriefBaseline,
  prepareApprovedBriefBaselineEligibility,
} from "../../orchestration/operations/approved-brief-baseline.ts";
import type { LiveThreadUpdateMilestoneJournal } from "../shared/stores/live-thread-update-store.ts";
import { FileCaptureStore } from "../shared/cas/file-capture-store.ts";
import {
  BriefSourceAnalysisCaptureService,
  requireBriefSourceAnalysis,
} from "../compile/captures/brief-source-analysis-capture.ts";
import type { BriefSourceAnalysisReference } from "../../domain/compile/brief/brief-source-analysis-reference.ts";
import type { EngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";

type ApprovedBriefBaselineMaterialization = Awaited<
  ReturnType<typeof materializeApprovedBriefBaseline>
>;
type ExactSnapshotPresence = "exact" | "absent" | "unknown";

export interface ApprovedBriefBaselineRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface ApprovedBriefBaselineRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly captures: FileCaptureStore<"approved-brief">;
  /** Passive local parser front-end; it is not an admission or MCP provider. */
  readonly briefSourceAnalysis: BriefSourceAnalysisCaptureService;
  readonly briefSourceCaptures: FileCaptureStore<"brief-source-capture">;
  /** Shared provider-neutral CAS, also used by CAD source analysis. */
  readonly sourceAnalysisCaptures: FileCaptureStore<"source-analysis">;
  /** Exact parser-version registry used to reopen sealed brief analysis. */
  readonly briefSourceAnalysisFrontends: SourceAnalysisFrontendRegistry;
  readonly snapshots: ThreadSnapshotStore;
  /** Cross-process ownership for the exact project/run execution. */
  readonly lease: EngineeringProjectRunLease;
  /** UI-only journal; a journal failure must not invalidate durable evidence. */
  readonly liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly now?: () => string;
}

/**
 * Trusted local executor for the sole provider-less V3 bootstrap operation.
 *
 * It never accepts provider arguments or raw result content. The server reads
 * the exact queued basis, creates a content-addressed documentary capture,
 * persists and re-reads the root ThreadSnapshot, then attaches it through the
 * normal command service. Replaying the same command id is safe at every
 * durable transition.
 *
 * WHY THIS EXECUTOR DOES NOT USE executor-run-helpers.ts
 *
 * - `requireApprovedBriefBaselineShape` checks `run.basis?.kind === "approved-brief"`,
 *   not "thread-snapshot". The shared `requireBasis` asserts thread-snapshot kind
 *   only and would wrongly reject this executor's valid runs.
 *
 * - `stepCommandId` embeds the operation segment `:approved-brief-baseline:` which
 *   is written into immutable commandReceipts. Changing it would break the
 *   assertCompleted check for any run whose receipts were already persisted.
 *
 * - `requiredRunStart` carries the "Baseline run" prefix in its error message,
 *   an intentional contract that differs from the shared generic wording.
 *
 * Do not align these helpers with the shared module without accounting for every
 * persisted commandReceipt that embeds the step IDs.
 */
export class ApprovedBriefBaselineRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #captures: FileCaptureStore<"approved-brief">;
  readonly #briefSourceAnalysis: BriefSourceAnalysisCaptureService;
  readonly #briefSourceCaptures: FileCaptureStore<"brief-source-capture">;
  readonly #sourceAnalysisCaptures: FileCaptureStore<"source-analysis">;
  readonly #briefSourceAnalysisFrontends: SourceAnalysisFrontendRegistry;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #lease: EngineeringProjectRunLease;
  readonly #liveUpdates: LiveThreadUpdateMilestoneJournal | undefined;
  readonly #now: () => string;

  constructor(dependencies: ApprovedBriefBaselineRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#captures = dependencies.captures;
    this.#briefSourceAnalysis = dependencies.briefSourceAnalysis;
    this.#briefSourceCaptures = dependencies.briefSourceCaptures;
    this.#sourceAnalysisCaptures = dependencies.sourceAnalysisCaptures;
    this.#briefSourceAnalysisFrontends = dependencies.briefSourceAnalysisFrontends;
    this.#snapshots = dependencies.snapshots;
    this.#lease = dependencies.lease;
    this.#liveUpdates = dependencies.liveUpdates;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: ApprovedBriefBaselineRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute a human-queued baseline run.",
      );
    }
    const preflight = await this.requiredProject(command.projectId);
    requireApprovedBriefBaselineShape(
      preflight,
      requireRun(preflight, command.runId),
    );
    return await this.#lease.withLease(
      command.projectId,
      command.runId,
      () => this.executeLeased(origin, command),
    );
  }

  private async executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: ApprovedBriefBaselineRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let snapshotPersisted = false;
    let claimSucceeded = false;
    let materialized: ApprovedBriefBaselineMaterialization | undefined;
    try {
      // Reject an ineligible run before claiming it.  Claiming first would
      // mutate an arbitrary queued run (including a readable V1 project)
      // merely to discover that this dedicated executor cannot perform it.
      const beforeClaim = await this.requiredProject(command.projectId);
      requireApprovedBriefBaselineShape(
        beforeClaim,
        requireRun(beforeClaim, command.runId),
      );
      await this.#commands.claimRun(origin, {
        ...command,
        commandId: stepCommandId(command.commandId, "claim"),
        summary: "Started the approved-brief documentary baseline.",
      });
      claimSucceeded = true;
      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      const workItem = requireApprovedBriefBaselineRun(project, run, origin);

      await this.recordLiveOnce({
        subjectId: project.project.subjectId,
        runId: run.id,
        state: "running",
        recordedAt: requiredRunStart(run),
        label: "Recording approved project brief baseline",
        summary:
          "The agent is recording the reviewed project brief and project path as a durable pre-technical document.",
      });

      if (run.status === "completed") {
        assertCompletedByThisExecution(project, command.commandId, command.runId);
        await this.reconcileLive(project.project.subjectId, command.runId);
        return project;
      }
      if (run.status === "failed" || run.status === "cancelled") {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `Baseline run ${run.id} is ${run.status}; a human must review and queue a new attempt.`,
        );
      }

      const capturedAt = requiredRunStart(run);
      materialized = await this.materialize(project, run, workItem, capturedAt);
      await this.#captures.save(materialized.sha256, materialized.text);
      await this.#snapshots.save(materialized.snapshot);
      // From this exact point the root snapshot may be durable even if a
      // subsequent read/attachment fails. Never mark the run failed after it.
      snapshotPersisted = true;
      await this.assertExactPersistedSnapshot(materialized);
      await this.recordLiveOnce({
        subjectId: project.project.subjectId,
        runId: run.id,
        state: "fresh",
        recordedAt: materialized.snapshot.generatedAt,
        label: "Recorded approved project brief baseline",
        summary:
          "A durable pre-technical document was recorded. No CAD, SysML, simulation, measurement, or verification result exists yet.",
      });

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: stepCommandId(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the durable approved-brief documentary baseline.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedRunStatus(run, "publishing");
      }

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        const resultSnapshot = snapshotReference(materialized.snapshot);
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: stepCommandId(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary: "Recorded the approved-brief documentary baseline.",
          resultSnapshot,
          evidenceRefs: [documentEvidenceReference(materialized.snapshot)],
        });
      } else if (run.status !== "completed") {
        throw unexpectedRunStatus(run, "completed");
      }

      const completed = await this.requiredProject(command.projectId);
      assertCompletedByThisExecution(completed, command.commandId, command.runId);
      await this.reconcileLive(completed.project.subjectId, command.runId);
      return completed;
    } catch (error) {
      const snapshotPresence = !snapshotPersisted && materialized
        ? await this.exactPersistedSnapshotPresence(materialized)
        : snapshotPersisted
        ? "exact"
        : "unknown";
      if (snapshotPresence === "exact") snapshotPersisted = true;
      if (
        !snapshotPersisted &&
        claimSucceeded &&
        snapshotPresence === "absent" &&
        materialized
      ) {
        await this.recordFailureIfOwned(origin, command, materialized);
      }
      if (snapshotPersisted) {
        const completed = await this.completedProjectForThisExecution(command);
        if (completed) {
          await this.reconcileLive(completed.project.subjectId, command.runId);
          return completed;
        }
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The documentary baseline is durable, but its project attachment did not finish. Retry the same execution command to resume without recreating evidence.",
        );
      }
      throw error;
    }
  }

  private async materialize(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    workItem: EngineeringWorkItem,
    capturedAt: string,
  ): Promise<ApprovedBriefBaselineMaterialization> {
    const basis = run.basis as EngineeringApprovedBriefBasis;
    const approvedProject = await this.#projects.getRevision(
      basis.projectId,
      basis.projectRevision,
    );
    if (!approvedProject || approvedProject.id !== basis.projectSnapshotId) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The exact project revision containing the approved brief is no longer readable.",
      );
    }
    // This pure probe performs all project/plan/approved-brief eligibility
    // checks before the source service can write any CAS record.
    const eligibility = prepareApprovedBriefBaselineEligibility({
      project,
      approvedProject,
      runId: run.id,
      capturedAt,
    });
    const reference = await this.#briefSourceAnalysis.capture({
      brief: eligibility.brief,
    });
    const verified = await this.reopenBriefSourceAnalysis(reference);
    const first = await materializeApprovedBriefBaseline({
      project,
      approvedProject,
      runId: run.id,
      capturedAt,
      briefSourceAnalysis: { reference: verified.reference, bundle: verified.bundle },
    });
    const result = await materializeApprovedBriefBaseline({
      project,
      approvedProject,
      runId: run.id,
      capturedAt,
      captureUri: this.#captures.uriFor(first.sha256),
      briefSourceAnalysis: { reference: verified.reference, bundle: verified.bundle },
    });
    if (
      deterministicJson(first.capture) !== deterministicJson(result.capture) ||
      deterministicJson(first.sha256) !== deterministicJson(result.sha256) ||
      workItem.id !== result.capture.workItemId
    ) {
      throw new Error("Approved-brief baseline materialization was not stable.");
    }
    return result;
  }

  /**
   * The capture service already checks save/readback. Reopen independently at
   * the execution boundary so the only bundle used for the ThreadSnapshot is
   * the exact content-addressed record named by the sealed reference.
   */
  private async reopenBriefSourceAnalysis(
    reference: BriefSourceAnalysisReference,
  ): Promise<{
    readonly reference: BriefSourceAnalysisReference;
    readonly bundle: ReturnType<typeof validateSourceAnalysisBundle>;
  }> {
    try {
      const replay = await requireBriefSourceAnalysis(reference, {
        sourceCaptures: this.#briefSourceCaptures,
        analysisCaptures: this.#sourceAnalysisCaptures,
        frontends: this.#briefSourceAnalysisFrontends,
      });
      return { reference: replay.reference, bundle: replay.bundle };
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Brief source analysis is invalid after capture: ${errorMessage(error)}`,
      );
    }
  }

  private async assertExactPersistedSnapshot(
    materialized: ApprovedBriefBaselineMaterialization,
  ): Promise<void> {
    if ((await this.exactPersistedSnapshotPresence(materialized)) !== "exact") {
      throw new Error(
        `Documentary ThreadSnapshot ${materialized.snapshot.id} was not durably readable after save.`,
      );
    }
  }

  private async exactPersistedSnapshotPresence(
    materialized: ApprovedBriefBaselineMaterialization,
  ): Promise<ExactSnapshotPresence> {
    try {
      const persisted = await this.#snapshots.get(materialized.snapshot.id);
      if (!persisted) return "absent";
      return deterministicJson(persisted) === deterministicJson(materialized.snapshot)
        ? "exact"
        : "unknown";
    } catch {
      return "unknown";
    }
  }

  private async recordFailureIfOwned(
    origin: EngineeringProjectCommandOrigin,
    command: ApprovedBriefBaselineRunExecutorCommand,
    materialized: ApprovedBriefBaselineMaterialization,
  ): Promise<void> {
    try {
      if ((await this.exactPersistedSnapshotPresence(materialized)) !== "absent") {
        return;
      }
      const project = await this.requiredProject(command.projectId);
      const run = project.agentRuns.find((candidate) => candidate.id === command.runId);
      if (
        !run ||
        !project.commandReceipts?.some((receipt) =>
          receipt.commandId === stepCommandId(command.commandId, "claim")
        ) ||
        !["running", "waiting-for-decision", "publishing"].includes(run.status) ||
        run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId
      ) return;
      if ((await this.exactPersistedSnapshotPresence(materialized)) !== "absent") {
        return;
      }
      await this.#commands.failRun(origin, {
        ...command,
        commandId: stepCommandId(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary:
          "The documentary baseline stopped before a durable snapshot was published.",
        code: "documentary-baseline-not-published",
        message:
          "The initial documentary baseline could not be durably published. No technical evidence was created.",
      });
      await this.recordLiveOnce({
        subjectId: project.project.subjectId,
        runId: command.runId,
        state: "failed",
        recordedAt: safeNow(this.#now),
        label: "Documentary baseline stopped",
        summary:
          "The run stopped before a durable documentary baseline was published. No technical evidence was created.",
      });
    } catch {
      // Failure recording is an audit best effort. Never replace the original
      // execution error or claim that an unrecorded failure was resolved.
    }
  }

  private async recordLiveOnce(input: {
    subjectId: string;
    runId: string;
    state: "running" | "fresh" | "failed";
    recordedAt: string;
    label: string;
    summary: string;
  }): Promise<void> {
    if (!this.#liveUpdates) return;
    try {
      await this.#liveUpdates.appendOnce({
        subjectId: input.subjectId,
        runId: input.runId,
        operationId: "baseline.documentary",
        baseRevision: 0,
        state: input.state,
        recordedAt: input.recordedAt,
        graph: {
          nodes: [{
            id: `${input.runId}:project-brief-document`,
            ref: { kind: "artifact", id: `${input.runId}:project-brief-document` },
            entityKind: "artifact",
            artifactKind: "document",
            label: input.label,
            system: "casys-digital-thread",
            freshness: input.state,
            summary: input.summary,
            recordedAt: input.recordedAt,
          }],
          edges: [],
        },
      });
    } catch {
      // The journal is a live presentation aid, never the source of durable
      // project or evidence truth. A temporary UI journal problem must not
      // cause a second capture or roll back a persisted one.
    }
  }

  private async reconcileLive(subjectId: string, runId: string): Promise<void> {
    if (!this.#liveUpdates) return;
    try {
      await this.#liveUpdates.reconcileRunOnce(
        subjectId,
        runId,
        safeNow(this.#now),
      );
    } catch {
      // See recordLiveOnce: persistence already succeeded and remains true.
    }
  }

  private async completedProjectForThisExecution(
    command: ApprovedBriefBaselineRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    try {
      const project = await this.requiredProject(command.projectId);
      assertCompletedByThisExecution(project, command.commandId, command.runId);
      return project;
    } catch {
      return undefined;
    }
  }

  private async requiredProject(
    projectId: string,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.#projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }
}

function requireRun(
  project: EngineeringProjectSnapshot,
  runId: string,
): EngineeringAgentRun {
  const run = project.agentRuns.find((candidate) => candidate.id === runId);
  if (!run) {
    throw new EngineeringProjectCommandError(
      "entity_not_found",
      `Agent run ${runId} does not exist in project ${project.project.id}.`,
    );
  }
  return run;
}

function requireApprovedBriefBaselineRun(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): EngineeringWorkItem {
  const workItem = requireApprovedBriefBaselineShape(project, run);
  if (
    run.claimedBy?.origin !== origin.kind ||
    run.claimedBy.id !== origin.actorId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact human-queued documentary baseline it claimed.",
    );
  }
  return workItem;
}

function requireApprovedBriefBaselineShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): EngineeringWorkItem {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const current = project.schemaVersion === "4.0" &&
    run.basis?.kind === "approved-brief" &&
    workItem?.operation?.id === APPROVED_BRIEF_BASELINE_OPERATION.id &&
    workItem.operation.version === APPROVED_BRIEF_BASELINE_OPERATION.version;
  if (!workItem || !current) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only an exact queued approved-brief documentary baseline.",
    );
  }
  return workItem;
}

function requiredRunStart(run: EngineeringAgentRun): string {
  if (!run.startedAt || Number.isNaN(Date.parse(run.startedAt))) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Baseline run ${run.id} has no durable start timestamp.`,
    );
  }
  return run.startedAt;
}

function snapshotReference(
  snapshot: ApprovedBriefBaselineMaterialization["snapshot"],
): EngineeringThreadSnapshotRef {
  return {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  };
}

function documentEvidenceReference(
  snapshot: ApprovedBriefBaselineMaterialization["snapshot"],
): EngineeringThreadEntityRef {
  const document = snapshot.artifacts[0];
  if (!document) throw new Error("Documentary baseline has no document artifact.");
  return {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact",
    id: document.id,
  };
}

function assertCompletedByThisExecution(
  project: EngineeringProjectSnapshot,
  commandId: string,
  runId: string,
): void {
  const run = requireRun(project, runId);
  if (
    run.status !== "completed" ||
    !run.resultSnapshot ||
    !project.commandReceipts?.some((receipt) =>
      receipt.commandId === stepCommandId(commandId, "complete")
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Baseline run ${runId} did not complete through this exact execution command.`,
    );
  }
}

function unexpectedRunStatus(
  run: EngineeringAgentRun,
  expected: "publishing" | "completed",
): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError(
    "invalid_transition",
    `Baseline run ${run.id} is ${run.status}; expected ${expected} while resuming this exact execution command.`,
  );
}

function stepCommandId(commandId: string, step: string): string {
  return `${commandId}:approved-brief-baseline:${step}`;
}

function safeNow(now: () => string): string {
  const value = now();
  return Number.isNaN(Date.parse(value)) ? new Date().toISOString() : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
