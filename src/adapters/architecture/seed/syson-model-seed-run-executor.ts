import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type EngineeringProjectCommandOrigin,
} from "../../../application/ports/in/engineering-project-command-origin.ts";
import {
  type EngineeringProjectRevisionStore,
} from "../../../application/ports/out/engineering-project-revision-store.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
  EngineeringThreadSnapshotRef,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import {
  materializeSysonModelSeed,
  requireSysonModelSeedDocumentaryBaseline,
  SYSON_MODEL_SEED_OPERATION,
  SYSON_MODEL_SEED_PROVIDER_OUTCOME_UNKNOWN_FAILURE,
  type SysonModelSeedLineage,
  type SysonModelSeedMaterialization,
} from "../../../domain/architecture/seed/syson-model-seed.ts";
import type {
  McpToolClient,
  McpToolResult,
} from "../../../application/ports/out/mcp-tool-client.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import {
  FileSysonModelSeedAttemptStore,
  SysonModelSeedWriteOutcomeUnknownError,
  type SysonModelSeedWriteStep,
} from "./file-syson-model-seed-attempt-store.ts";
import { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import type { LiveThreadUpdateMilestoneJournal } from "../../shared/stores/live-thread-update-store.ts";
import { createSysonModelSeedLiveProjector } from "../../thread/syson-model-seed-live-projector.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "../../shared/thread-write-basis-guard.ts";

type ExactSnapshotPresence = "exact" | "absent" | "unknown";

export interface SysonModelSeedRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface SysonModelSeedRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore & {
    getRevision(
      projectId: string,
      revision: number,
    ): Promise<EngineeringProjectSnapshot | undefined>;
  };
  readonly commands: EngineeringProjectCommandService;
  /** Owns the exact approved-brief documentary r1 and SysON seed result r2. */
  readonly snapshots: ThreadSnapshotStore;
  readonly captures: FileCaptureStore<"syson-model-seed">;
  /** Write-ahead state for non-idempotent SysON mutations. */
  readonly attempts: FileSysonModelSeedAttemptStore;
  /** Server-owned provider client; the MCP tool exposes none of this surface. */
  readonly syson: McpToolClient;
  readonly lease: EngineeringProjectRunLease;
  /** Presentation only. Journal failure never triggers a provider retry. */
  readonly liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly now?: () => string;
}

/**
 * Trusted executor for the first bounded provider-backed V3 operation.
 *
 * It can create only a blank SysON project, blank SysML document and root
 * package. It never receives a provider URL, tool name, tool arguments, SysML
 * text, CAD data or a caller-supplied result. A durable write-ahead journal
 * prevents automatic replay of a possibly successful SysON mutation.
 *
 * WHY THIS EXECUTOR DOES NOT USE executor-run-helpers.ts
 *
 * - `stepCommandId` embeds the operation segment `:syson-model-seed:` which is
 *   written into immutable commandReceipts on disk. Any shared helper that
 *   produces a different segment would break the assertCompleted check for runs
 *   whose receipts were already persisted.
 *
 * - `requiredRunStart` and `requireRun` carry "SysON seed" error context that
 *   is contractual for this operation's observable error surface.
 *
 * - The write-ahead journal (FileSysonModelSeedAttemptStore) introduces
 *   WAL state transitions absent from the standard executor state machine;
 *   refactoring to shared helpers would silently bypass that boundary.
 *
 * Do not align these helpers with the shared module without a deliberate plan
 * that accounts for every persisted commandReceipt and WAL record.
 */
export class SysonModelSeedRunExecutor {
  readonly #projects: SysonModelSeedRunExecutorDependencies["projects"];
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #captures: FileCaptureStore<"syson-model-seed">;
  readonly #attempts: FileSysonModelSeedAttemptStore;
  readonly #syson: McpToolClient;
  readonly #lease: EngineeringProjectRunLease;
  readonly #liveUpdates: LiveThreadUpdateMilestoneJournal | undefined;
  readonly #now: () => string;

  constructor(dependencies: SysonModelSeedRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#captures = dependencies.captures;
    this.#attempts = dependencies.attempts;
    this.#syson = dependencies.syson;
    this.#lease = dependencies.lease;
    this.#liveUpdates = dependencies.liveUpdates;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: SysonModelSeedRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the reviewed and queued SysON model seed.",
      );
    }
    const preflight = await this.requiredProject(command.projectId);
    const preflightRun = requireRun(preflight, command.runId);
    requireSysonModelSeedShape(preflight, preflightRun);
    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(preflightRun),
      () => this.executeLeased(origin, command),
    );
  }

  private async executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: SysonModelSeedRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimSucceeded = false;
    let providerStateRecorded = false;
    let snapshotPersisted = false;
    let materialized: SysonModelSeedMaterialization | undefined;
    try {
      // Do not claim a queued run merely to discover this executor cannot own
      // it. This also prevents a generic MCP call from changing another
      // work item before the operation boundary is checked.
      const beforeClaim = await this.requiredProject(command.projectId);
      const beforeClaimRun = requireRun(beforeClaim, command.runId);
      requireSysonModelSeedShape(beforeClaim, beforeClaimRun);
      if (beforeClaimRun.status !== "completed") {
        await assertThreadWriteBasisAvailable(beforeClaim, beforeClaimRun);
      }
      const beforeClaimBasis = requireThreadBasis(beforeClaimRun);
      const beforeClaimBase = await this.requiredExactBase(beforeClaimBasis);
      const beforeClaimLineage = await this.requiredPlanningLineage(
        beforeClaim,
        beforeClaimRun,
        beforeClaimBasis,
        beforeClaimBase,
      );
      requireSysonModelSeedDocumentaryBaseline(
        beforeClaimBase,
        beforeClaimLineage,
      );
      await this.#commands.claimRun(origin, {
        ...command,
        commandId: stepCommandId(command.commandId, "claim"),
        summary: "Started the bounded SysON model-container seed.",
      });
      claimSucceeded = true;

      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireSysonModelSeedRun(project, run, origin);
      if (run.status === "completed") {
        assertCompletedByThisExecution(project, command.commandId, command.runId);
        await this.reconcileLive(project.project.subjectId, command.runId);
        return project;
      }
      if (run.status === "failed" || run.status === "cancelled") {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `SysON model seed ${run.id} is ${run.status}; a human must review before a new run is queued.`,
        );
      }

      const basis = requireThreadBasis(run);
      const base = await this.requiredExactBase(basis);
      const lineage = await this.requiredPlanningLineage(project, run, basis, base);
      requireSysonModelSeedDocumentaryBaseline(base, lineage);
      const capturedAt = requiredRunStart(run);
      const live = this.liveRecorder(project, run, basis);
      await live("syson_project_create", "started");
      const projectCreate = await this.fixedWrite({
        project,
        run,
        step: "project-create",
        capturedAt,
        live,
        call: {
          name: "syson_project_create",
          arguments: { name: providerProjectName(project, run) },
        },
        normalize: projectCreateResult,
      });
      providerStateRecorded = true;

      await live("syson_model_create", "started");
      const modelCreate = await this.fixedWrite({
        project,
        run,
        step: "model-create",
        capturedAt,
        live,
        call: {
          name: "syson_model_create",
          arguments: {
            editing_context_id: projectCreate.editingContextId,
            name: providerDocumentName(project),
            create_root_package: true,
          },
        },
        normalize: modelCreateResult,
      });
      providerStateRecorded = true;

      await live("syson_element_get", "started");
      const rootRead = await this.fixedRead(
        {
          name: "syson_element_get",
          arguments: {
            editing_context_id: projectCreate.editingContextId,
            element_id: modelCreate.rootPackageId,
          },
        },
        live,
      );
      const rootPackageGet = rootPackageGetResult(rootRead.structuredContent);

      materialized = await this.materialize(
        base,
        lineage,
        run.id,
        capturedAt,
        projectCreate,
        modelCreate,
        rootPackageGet,
      );
      await this.#captures.save(materialized.sha256, materialized.text);
      await this.assertExactPersistedCapture(materialized);
      await this.#snapshots.save(materialized.snapshot);
      // From here the exact technical r2 is durable. Never mark this run
      // failed after that: replaying the same command resumes only attachment.
      snapshotPersisted = true;
      await this.assertExactPersistedSnapshot(materialized);

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: stepCommandId(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the read-back SysON model-container identity.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedRunStatus(run, "publishing");
      }

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: stepCommandId(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary: "Recorded the first editable SysON system-model container.",
          resultSnapshot: snapshotReference(materialized.snapshot),
          evidenceRefs: [modelEvidenceReference(materialized.snapshot)],
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
      if (snapshotPersisted) {
        const completed = await this.completedProjectForThisExecution(command);
        if (completed) {
          await this.reconcileLive(completed.project.subjectId, command.runId);
          return completed;
        }
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The SysON model-container record is durable, but project attachment did not finish. Retry the same execution command; it will not recreate the provider state.",
        );
      }
      if (
        error instanceof SysonModelSeedWriteOutcomeUnknownError ||
        error instanceof ProviderWriteOutcomeUnknownError
      ) {
        const quarantined = await this.recordUncertainFailureIfOwned(
          origin,
          command,
          error.step,
        );
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          quarantined
            ? `The SysON ${error.step} outcome is unknown. Run ${command.runId} is now failed and quarantined with code ${SYSON_MODEL_SEED_PROVIDER_OUTCOME_UNKNOWN_FAILURE}; it will not retry automatically. Inspect SysON, then use record.reconcile-uncertain-writer@1 before appending a successor seed.`
            : `The SysON ${error.step} outcome is unknown and will not retry automatically. Its terminal quarantine could not be persisted; retry this same execution command so the existing write-ahead marker can be converted into a recoverable failed run without redispatching SysON.`,
        );
      }
      if (providerStateRecorded) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "SysON provider state was recorded, but the model-container record was not published. Retry the same execution command to resume; its recorded write steps will not be repeated.",
        );
      }
      if (claimSucceeded) {
        await this.recordFailureIfOwned(origin, command);
      }
      throw error;
    }
  }

  private async fixedWrite<T extends Readonly<Record<string, string>>>(input: {
    project: EngineeringProjectSnapshot;
    run: EngineeringAgentRun;
    step: SysonModelSeedWriteStep;
    capturedAt: string;
    live: LiveRecorder;
    call: {
      readonly name: "syson_project_create" | "syson_model_create";
      readonly arguments: Record<string, unknown>;
    };
    normalize: (value: unknown) => T;
  }): Promise<T> {
    let begun: Awaited<ReturnType<FileSysonModelSeedAttemptStore["begin"]>>;
    try {
      begun = await this.#attempts.begin({
        projectId: input.project.project.id,
        runId: input.run.id,
        step: input.step,
        dispatchedAt: input.capturedAt,
      });
    } catch (error) {
      await input.live(input.call.name, "failed");
      throw error;
    }
    if (begun.action === "completed") {
      try {
        const normalized = input.normalize(begun.result);
        await input.live(input.call.name, "completed");
        return normalized;
      } catch (error) {
        await input.live(input.call.name, "failed");
        throw error;
      }
    }
    try {
      const response = await this.#syson.callTool(input.call);
      const normalized = input.normalize(response.structuredContent);
      await this.#attempts.complete({
        projectId: input.project.project.id,
        runId: input.run.id,
        step: input.step,
        dispatchedAt: input.capturedAt,
        completedAt: safeNow(this.#now),
        result: normalized,
      });
      await input.live(input.call.name, "completed");
      return normalized;
    } catch {
      await input.live(input.call.name, "failed");
      // The write-ahead record was created first. Any error after that point
      // leaves the provider outcome intentionally unknown rather than risking
      // a duplicate project or document on the next call.
      throw new ProviderWriteOutcomeUnknownError(input.step);
    }
  }

  private async fixedRead(
    call: {
      readonly name: "syson_element_get";
      readonly arguments: Record<string, unknown>;
    },
    live: LiveRecorder,
  ): Promise<McpToolResult> {
    try {
      const result = await this.#syson.callTool(call);
      await live(call.name, "completed");
      return result;
    } catch (error) {
      await live(call.name, "failed");
      throw error;
    }
  }

  private async materialize(
    base: ThreadSnapshot,
    lineage: SysonModelSeedLineage,
    runId: string,
    capturedAt: string,
    projectCreate: Readonly<Record<string, string>>,
    modelCreate: Readonly<Record<string, string>>,
    rootPackageGet: Readonly<Record<string, string>>,
  ): Promise<SysonModelSeedMaterialization> {
    const first = await materializeSysonModelSeed({
      base,
      lineage,
      trustedRunId: runId,
      capturedAt,
      projectCreateResult: projectCreate,
      modelCreateResult: modelCreate,
      rootPackageGetResult: rootPackageGet,
    });
    const result = await materializeSysonModelSeed({
      base,
      lineage,
      trustedRunId: runId,
      capturedAt,
      projectCreateResult: projectCreate,
      modelCreateResult: modelCreate,
      rootPackageGetResult: rootPackageGet,
      captureUri: this.#captures.uriFor(first.sha256),
    });
    if (
      deterministicJson(first.capture) !== deterministicJson(result.capture) ||
      deterministicJson(first.sha256) !== deterministicJson(result.sha256)
    ) {
      throw new Error("SysON model-seed materialization was not stable.");
    }
    return result;
  }

  private async requiredExactBase(
    basis: EngineeringThreadSnapshotBasis,
  ): Promise<ThreadSnapshot> {
    const base = await this.#snapshots.get(basis.snapshotId);
    if (
      !base || base.id !== basis.snapshotId || base.revision !== basis.revision ||
      base.subject.id !== basis.subjectId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The exact documentary ThreadSnapshot required by this SysON model seed is no longer readable.",
      );
    }
    return base;
  }

  private async requiredPlanningLineage(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    basis: EngineeringThreadSnapshotBasis,
    base: ThreadSnapshot,
  ): Promise<SysonModelSeedLineage> {
    const workItem = requireSysonModelSeedShape(project, run);
    const plan = project.plan;
    if (!plan) {
      throw invalidSeedLineage(
        "The V3 SysON model seed requires a reviewed project plan.",
      );
    }
    const changes = (project.planChanges ?? []).filter((change) =>
      change.workItemIds.includes(workItem.id)
    );
    if (changes.length !== 1) {
      throw invalidSeedLineage(
        "The SysON model seed must be introduced by exactly one additive project change.",
      );
    }
    const change = changes[0]!;
    const approvedBriefBasis = change.approvedBriefBasis;
    if (!approvedBriefBasis) {
      throw invalidSeedLineage(
        "The V3 project change introducing the SysON model seed has no exact approved-brief authorization.",
      );
    }
    const approvedProject = await this.#projects.getRevision(
      approvedBriefBasis.projectId,
      approvedBriefBasis.projectRevision,
    );
    if (
      !approvedProject || approvedProject.schemaVersion !== "4.0" ||
      approvedProject.id !== approvedBriefBasis.projectSnapshotId
    ) {
      throw invalidSeedLineage(
        "The exact project revision carrying the approved brief is not durably readable.",
      );
    }
    const brief = approvedProject.framing?.currentBrief;
    const approval = approvedProject.framing?.currentBriefApproval;
    if (
      !brief || !approval || approval.status !== "approved" ||
      approval.decidedBy?.origin !== "human" ||
      brief.briefId !== approvedBriefBasis.briefId ||
      brief.id !== approvedBriefBasis.briefSnapshotId ||
      brief.revision !== approvedBriefBasis.briefRevision ||
      deterministicJson(approval.inputFingerprint) !==
        deterministicJson(approvedBriefBasis.approvedBriefFingerprint)
    ) {
      throw invalidSeedLineage(
        "The project change no longer resolves to its exact human-approved living brief.",
      );
    }

    const baselineRuns = project.agentRuns.filter((candidate) => {
      const item = project.workItems.find((entry) => entry.id === candidate.workItemId);
      return candidate.status === "completed" &&
        candidate.basis?.kind === "approved-brief" &&
        item?.operation?.id === "baseline.from-approved-brief" &&
        item.operation.version === "1" &&
        candidate.resultSnapshot?.snapshotId === base.id &&
        candidate.resultSnapshot.revision === base.revision &&
        candidate.resultSnapshot.subjectId === base.subject.id &&
        deterministicJson(candidate.basis) === deterministicJson(approvedBriefBasis);
    });
    if (baselineRuns.length !== 1) {
      throw invalidSeedLineage(
        "The documentary r1 must be the unique completed baseline.from-approved-brief@1 result for this plan.",
      );
    }
    const baselineRun = baselineRuns[0]!;
    const baselineWorkItem = project.workItems.find((item) =>
      item.id === baselineRun.workItemId
    )!;
    if (!workItem.dependsOnWorkItemIds.includes(baselineWorkItem.id)) {
      // Append already refuses this. Kept for work items accepted before that guard.
      throw invalidSeedLineage(
        "The SysON model seed must explicitly depend on the approved-brief documentary baseline work item.",
      );
    }
    if (
      change.baseSnapshot.snapshotId !== basis.snapshotId ||
      change.baseSnapshot.revision !== basis.revision ||
      change.baseSnapshot.subjectId !== basis.subjectId
    ) {
      throw invalidSeedLineage(
        "The project change introducing the SysON model seed must name its exact documentary r1 run basis.",
      );
    }
    const document = base.artifacts[0];
    if (!document?.uri || document.producer.runId !== baselineRun.id) {
      throw invalidSeedLineage(
        "The approved-brief documentary artifact must retain its content-addressed capture URI and baseline run identity.",
      );
    }
    return {
      approvedBriefBasis: structuredClone(approvedBriefBasis),
      plan: {
        publishedAt: plan.publishedAt,
        publishedBy: structuredClone(plan.publishedBy),
      },
      projectChange: {
        id: change.id,
        commandId: change.commandId,
        publishedAt: change.publishedAt,
        publishedBy: structuredClone(change.publishedBy),
      },
      workItemId: workItem.id,
      baseSnapshot: {
        snapshotId: basis.snapshotId,
        revision: basis.revision,
        subjectId: basis.subjectId,
      },
      documentaryArtifact: {
        id: document.id,
        fingerprint: structuredClone(document.fingerprint),
        uri: document.uri,
        producerRunId: document.producer.runId,
      },
    };
  }

  private async assertExactPersistedCapture(
    materialized: SysonModelSeedMaterialization,
  ): Promise<void> {
    const persisted = await this.#captures.read(materialized.sha256);
    if (persisted !== materialized.text) {
      throw new Error("SysON model-seed capture was not durably readable after save.");
    }
  }

  private async assertExactPersistedSnapshot(
    materialized: SysonModelSeedMaterialization,
  ): Promise<void> {
    if ((await this.exactPersistedSnapshotPresence(materialized)) !== "exact") {
      throw new Error(
        `SysON model-seed ThreadSnapshot ${materialized.snapshot.id} was not durably readable after save.`,
      );
    }
  }

  private async exactPersistedSnapshotPresence(
    materialized: SysonModelSeedMaterialization,
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

  private liveRecorder(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    basis: EngineeringThreadSnapshotBasis,
  ): LiveRecorder {
    const projector = createSysonModelSeedLiveProjector(run.id);
    return async (toolName, phase) => {
      if (!this.#liveUpdates) return;
      try {
        await this.#liveUpdates.appendOnce({
          subjectId: project.project.subjectId,
          runId: run.id,
          operationId: `${SYSON_MODEL_SEED_OPERATION.id}:${toolName}`,
          baseRevision: basis.revision,
          state: phase === "started"
            ? "running"
            : phase === "completed"
            ? "fresh"
            : "failed",
          recordedAt: safeNow(this.#now),
          graph: projector({
            phase,
            subjectId: project.project.subjectId,
            runId: run.id,
            operationId: `${SYSON_MODEL_SEED_OPERATION.id}:${toolName}`,
            serverId: "syson",
            toolName,
            recordedAt: safeNow(this.#now),
            call: { name: toolName },
          }),
        });
      } catch {
        // Live activity is a presentation aid only. It must never cause a
        // provider replay or overturn a durable model-container result.
      }
    };
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
      // Canonical state already succeeded; the live overlay is optional.
    }
  }

  private async recordFailureIfOwned(
    origin: EngineeringProjectCommandOrigin,
    command: SysonModelSeedRunExecutorCommand,
  ): Promise<void> {
    try {
      const project = await this.requiredProject(command.projectId);
      const run = project.agentRuns.find((candidate) => candidate.id === command.runId);
      if (
        !run ||
        !project.commandReceipts?.some((receipt) =>
          receipt.commandId === stepCommandId(command.commandId, "claim")
        ) ||
        !["running", "waiting-for-decision", "publishing"].includes(run.status) ||
        run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId
      ) return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: stepCommandId(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary: "The SysON model seed stopped before any provider state was recorded.",
        code: "syson-model-seed-not-published",
        message:
          "The model-container seed stopped before it recorded provider state or published technical evidence.",
      });
    } catch {
      // Never hide the primary execution error behind a best-effort audit move.
    }
  }

  private async recordUncertainFailureIfOwned(
    origin: EngineeringProjectCommandOrigin,
    command: SysonModelSeedRunExecutorCommand,
    step: SysonModelSeedWriteStep,
  ): Promise<boolean> {
    try {
      const project = await this.requiredProject(command.projectId);
      const run = project.agentRuns.find((candidate) => candidate.id === command.runId);
      if (
        run?.status === "failed" &&
        run.failure?.code === SYSON_MODEL_SEED_PROVIDER_OUTCOME_UNKNOWN_FAILURE
      ) return true;
      if (
        !run ||
        !project.commandReceipts?.some((receipt) =>
          receipt.commandId === stepCommandId(command.commandId, "claim")
        ) ||
        !["running", "waiting-for-decision", "publishing"].includes(run.status) ||
        run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId
      ) return false;
      const failed = await this.#commands.failRun(origin, {
        ...command,
        commandId: stepCommandId(command.commandId, "quarantine"),
        expectedRevision: project.revision,
        summary: `The SysON ${step} outcome is unknown and was quarantined.`,
        code: SYSON_MODEL_SEED_PROVIDER_OUTCOME_UNKNOWN_FAILURE,
        message:
          `The ${step} attempt has a durable dispatched marker but no durable normalized provider response. Inspect SysON and complete record.reconcile-uncertain-writer@1 before any successor seed.`,
      });
      const recorded = failed.agentRuns.find((candidate) =>
        candidate.id === command.runId
      );
      return recorded?.status === "failed" &&
        recorded.failure?.code ===
          SYSON_MODEL_SEED_PROVIDER_OUTCOME_UNKNOWN_FAILURE;
    } catch {
      // The WAL still prevents redispatch. A retry of the same execution
      // command may safely retry only this local quarantine transition.
      return false;
    }
  }

  private async completedProjectForThisExecution(
    command: SysonModelSeedRunExecutorCommand,
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

type LiveRecorder = (
  toolName: "syson_project_create" | "syson_model_create" | "syson_element_get",
  phase: "started" | "completed" | "failed",
) => Promise<void>;

class ProviderWriteOutcomeUnknownError extends Error {
  readonly step: SysonModelSeedWriteStep;

  constructor(step: SysonModelSeedWriteStep) {
    super(`SysON ${step} may have changed provider state without a durable response.`);
    this.name = "ProviderWriteOutcomeUnknownError";
    this.step = step;
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

function requireSysonModelSeedRun(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): EngineeringWorkItem {
  const workItem = requireSysonModelSeedShape(project, run);
  if (
    run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact reviewed SysON model seed it claimed.",
    );
  }
  return workItem;
}

function requireSysonModelSeedShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): EngineeringWorkItem {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (
    run.basis?.kind !== "thread-snapshot" ||
    !workItem || workItem.operation?.id !== SYSON_MODEL_SEED_OPERATION.id ||
    workItem.operation.version !== SYSON_MODEL_SEED_OPERATION.version ||
    workItem.operation.bindings.length !== 1 ||
    workItem.operation.bindings[0]?.name !== "approvedBrief" ||
    workItem.operation.bindings[0]?.source.kind !== "approved-brief"
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact queued V3 SysON model seed declared from an approved brief.",
    );
  }
  return workItem;
}

function invalidSeedLineage(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}

function requireThreadBasis(run: EngineeringAgentRun): EngineeringThreadSnapshotBasis {
  if (run.basis?.kind !== "thread-snapshot") {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `SysON model seed ${run.id} must be bound to an exact ThreadSnapshot.`,
    );
  }
  return structuredClone(run.basis);
}

function requiredRunStart(run: EngineeringAgentRun): string {
  if (!run.startedAt || Number.isNaN(Date.parse(run.startedAt))) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `SysON model seed ${run.id} has no durable start timestamp.`,
    );
  }
  return run.startedAt;
}

function projectCreateResult(value: unknown): Readonly<Record<string, string>> {
  return closedStringRecord(
    value,
    ["id", "name", "editingContextId"],
    "project create",
  );
}

function modelCreateResult(value: unknown): Readonly<Record<string, string>> {
  return closedStringRecord(
    value,
    [
      "documentId",
      "documentName",
      "documentKind",
      "rootPackageId",
      "rootPackageLabel",
    ],
    "model create",
  );
}

function rootPackageGetResult(value: unknown): Readonly<Record<string, string>> {
  // SysON currently also returns iconURLs; it is a presentation detail and is
  // deliberately excluded from the closed evidence capture.
  const source = object(value, "root package read");
  return requiredFields(source, ["id", "kind", "label"], "root package read");
}

function closedStringRecord(
  value: unknown,
  fields: readonly string[],
  label: string,
): Readonly<Record<string, string>> {
  const source = object(value, label);
  const actual = Object.keys(source).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new Error(`SysON ${label} result has an unexpected shape.`);
  }
  return requiredFields(source, fields, label);
}

function requiredFields(
  source: Record<string, unknown>,
  fields: readonly string[],
  label: string,
): Readonly<Record<string, string>> {
  return Object.fromEntries(fields.map((field) => {
    const value = source[field];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`SysON ${label} result lacks ${field}.`);
    }
    return [field, value];
  }));
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`SysON ${label} result must be an object.`);
  }
  return value as Record<string, unknown>;
}

function providerProjectName(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): string {
  return `${project.project.name} · system model seed · ${run.id}`;
}

function providerDocumentName(project: EngineeringProjectSnapshot): string {
  return `${project.project.name} system model`;
}

function snapshotReference(
  snapshot: ThreadSnapshot,
): EngineeringThreadSnapshotRef {
  return {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  };
}

function modelEvidenceReference(snapshot: ThreadSnapshot): EngineeringThreadEntityRef {
  const model = snapshot.artifacts.find((artifact) => artifact.kind === "sysml-model");
  if (!model) throw new Error("SysON model seed snapshot has no SysML model artifact.");
  return {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact",
    id: model.id,
  };
}

function assertCompletedByThisExecution(
  project: EngineeringProjectSnapshot,
  commandId: string,
  runId: string,
): void {
  const run = requireRun(project, runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some((receipt) =>
      receipt.commandId === stepCommandId(commandId, "complete")
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `SysON model seed ${runId} did not complete through this exact execution command.`,
    );
  }
}

function unexpectedRunStatus(
  run: EngineeringAgentRun,
  expected: "publishing" | "completed",
): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError(
    "invalid_transition",
    `SysON model seed ${run.id} is ${run.status}; expected ${expected} while resuming this exact execution command.`,
  );
}

function stepCommandId(commandId: string, step: string): string {
  return `${commandId}:syson-model-seed:${step}`;
}

function safeNow(now: () => string): string {
  const value = now();
  return Number.isNaN(Date.parse(value)) ? new Date().toISOString() : value;
}
