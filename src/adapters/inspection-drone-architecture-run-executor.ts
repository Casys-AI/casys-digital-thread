import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandOrigin,
  type EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../domain/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
  EngineeringThreadSnapshotRef,
  EngineeringWorkItem,
} from "../domain/engineering-project.ts";
import { deterministicJson, fingerprintsEqual } from "../domain/deterministic-json.ts";
import {
  currentProjectDiscoveryAnswer,
  type ProjectDiscoverySnapshot,
} from "../domain/project-discovery.ts";
import { validateProjectDiscoverySnapshot } from "../domain/project-discovery-validation.ts";
import type { ThreadSnapshot } from "../domain/thread-snapshot.ts";
import { validateThreadSnapshot } from "../domain/thread-snapshot-validation.ts";
import type { ThreadSnapshotStore } from "../domain/thread-snapshot-store.ts";
import {
  INSPECTION_DRONE_ARCHITECTURE_OPERATION,
  INSPECTION_DRONE_ARCHITECTURE_SYSML,
  type InspectionDroneArchitectureInsertion,
  type InspectionDroneArchitectureMaterialization,
  type InspectionDroneArchitectureSeed,
  inspectionDroneArchitectureSysmlFingerprint,
  materializeInspectionDroneArchitecture,
  requireEmptyInspectionDroneArchitectureRoot,
  requireInspectionDroneArchitecturePackage,
  requireInspectionDroneArchitectureSeed,
  validateInspectionDroneArchitectureInsertion,
} from "../domain/inspection-drone-architecture.ts";
import {
  APPROVED_DISCOVERY_BASELINE_CAPTURE_SCHEMA,
  APPROVED_DISCOVERY_BASELINE_OPERATION,
} from "../orchestration/operations/approved-discovery-baseline.ts";
import { FileApprovedDiscoveryBaselineCaptureStore } from "./file-approved-discovery-baseline-capture-store.ts";
import type { EngineeringProjectRunLease } from "./file-engineering-project-run-lease.ts";
import {
  FileInspectionDroneArchitectureAttemptStore,
  InspectionDroneArchitectureWriteOutcomeUnknownError,
} from "./file-inspection-drone-architecture-attempt-store.ts";
import { FileInspectionDroneArchitectureCaptureStore } from "./file-inspection-drone-architecture-capture-store.ts";
import { FileSysonModelSeedCaptureStore } from "./file-syson-model-seed-capture-store.ts";
import type { McpToolClient, McpToolResult } from "./http-mcp-tool-client.ts";
import type { LiveThreadUpdateMilestoneJournal } from "./live-thread-update-store.ts";
import {
  createInspectionDroneArchitectureLiveProjector,
  type InspectionDroneArchitectureLiveStartStep,
} from "./inspection-drone-architecture-live-projector.ts";

type ExactSnapshotPresence = "exact" | "absent" | "unknown";

export interface InspectionDroneArchitectureRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface InspectionDroneArchitectureRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  /** Owns the exact r1, r2 and subsequently materialized r3 snapshots. */
  readonly snapshots: ThreadSnapshotStore;
  /** Re-readable r1 source; no current discovery state may substitute for it. */
  readonly approvedDiscoveryCaptures: FileApprovedDiscoveryBaselineCaptureStore;
  /** Re-readable r2 model-container identity required for every SysON call. */
  readonly seedCaptures: FileSysonModelSeedCaptureStore;
  /** Immutable normalized r3 evidence bytes. */
  readonly captures: FileInspectionDroneArchitectureCaptureStore;
  /** Write-ahead journal for the sole non-idempotent SysON insertion. */
  readonly attempts: FileInspectionDroneArchitectureAttemptStore;
  /** Server-owned fixed SysON client; no caller controls its URL or tool surface. */
  readonly syson: McpToolClient;
  readonly lease: EngineeringProjectRunLease;
  /** UI-only milestones; their failure never changes canonical execution. */
  readonly liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly now?: () => string;
}

/**
 * The exact immutable inputs that permit the bounded r3 authoring operation.
 *
 * This is intentionally provider-free so queue-time admission can reuse the
 * same checks as the executor.  It does not claim, queue, or otherwise change
 * project state.
 */
export interface InspectionDroneArchitectureEligibility {
  readonly base: ThreadSnapshot;
  readonly seedCapture: unknown;
  readonly seed: InspectionDroneArchitectureSeed;
  readonly discovery: ProjectDiscoverySnapshot;
}

/** Minimal read-only boundary used by the reusable r3 eligibility gate. */
export interface InspectionDroneArchitectureEligibilityDependencies {
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly approvedDiscoveryCaptures: Pick<
    FileApprovedDiscoveryBaselineCaptureStore,
    "read"
  >;
  readonly seedCaptures: Pick<FileSysonModelSeedCaptureStore, "read">;
}

/**
 * Trusted executor for one reviewed high-level inspection-drone architecture.
 *
 * It admits no caller SysML, provider URL, tool name or provider result. The
 * sole write is a fixed recipe into the exact r2 root package, protected by a
 * durable write-ahead marker. A completed marker never replays the insertion:
 * it resumes only the two post-write reads and durable evidence publication.
 */
export class InspectionDroneArchitectureRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #approvedDiscoveryCaptures: FileApprovedDiscoveryBaselineCaptureStore;
  readonly #seedCaptures: FileSysonModelSeedCaptureStore;
  readonly #captures: FileInspectionDroneArchitectureCaptureStore;
  readonly #attempts: FileInspectionDroneArchitectureAttemptStore;
  readonly #syson: McpToolClient;
  readonly #lease: EngineeringProjectRunLease;
  readonly #liveUpdates: LiveThreadUpdateMilestoneJournal | undefined;
  readonly #now: () => string;

  constructor(dependencies: InspectionDroneArchitectureRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#approvedDiscoveryCaptures = dependencies.approvedDiscoveryCaptures;
    this.#seedCaptures = dependencies.seedCaptures;
    this.#captures = dependencies.captures;
    this.#attempts = dependencies.attempts;
    this.#syson = dependencies.syson;
    this.#lease = dependencies.lease;
    this.#liveUpdates = dependencies.liveUpdates;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: InspectionDroneArchitectureRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute a human-queued inspection-drone architecture run.",
      );
    }
    const preflight = await this.requiredProject(command.projectId);
    requireInspectionDroneArchitectureShape(
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
    command: InspectionDroneArchitectureRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimSucceeded = false;
    let providerStateRecorded = false;
    let snapshotPersisted = false;
    let materialized: InspectionDroneArchitectureMaterialization | undefined;
    try {
      // Validate all immutable gates before changing even the project-run
      // lifecycle. In particular, a current discovery answer cannot stand in
      // for the exact r1 capture behind this r2 basis.
      const beforeClaim = await this.requiredProject(command.projectId);
      const beforeClaimRun = requireRun(beforeClaim, command.runId);
      requireInspectionDroneArchitectureShape(beforeClaim, beforeClaimRun);
      await this.requiredInputs(beforeClaim, beforeClaimRun);
      await this.#commands.claimRun(origin, {
        ...command,
        commandId: stepCommandId(command.commandId, "claim"),
        summary:
          "Started the bounded inspection-drone SysML architecture authoring run.",
      });
      claimSucceeded = true;

      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireInspectionDroneArchitectureRun(project, run, origin);
      if (run.status === "completed") {
        assertCompletedByThisExecution(project, command.commandId, command.runId);
        await this.reconcileLive(project.project.subjectId, command.runId);
        return project;
      }
      if (run.status === "failed" || run.status === "cancelled") {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `Inspection-drone architecture run ${run.id} is ${run.status}; a human must review before a new run is queued.`,
        );
      }

      const inputs = await this.requiredInputs(project, run);
      const capturedAt = requiredRunStart(run);
      const rootPackageId = inputs.seed.normalizedResults.rootPackage.id;
      let insertion: InspectionDroneArchitectureInsertion;
      const existingAttempt = await this.existingAttemptOrFailClosed(
        project.project.id,
        run.id,
      );
      const live = this.liveRecorder(
        project,
        run,
        requireThreadBasis(run),
        existingAttempt?.status === "completed" ? "root-readback" : "root-preflight",
      );
      if (existingAttempt?.status === "completed") {
        // A durable acknowledgement proves that the only insertion has already
        // been sent. In a resume, skip both root preflight and write: only the
        // two bounded read-backs below may now execute.
        insertion = await insertionFromAttempt(existingAttempt.result, rootPackageId);
        providerStateRecorded = true;
      } else {
        if (existingAttempt?.status === "dispatched") {
          throw new InspectionDroneArchitectureWriteOutcomeUnknownError(
            "architecture-insert",
          );
        }
        const rootPreflight = await this.childrenRead(
          inputs.seed,
          rootPackageId,
          "root-preflight",
          live,
        );
        requireEmptyInspectionDroneArchitectureRoot({
          rootPackageId,
          rootChildrenResult: rootPreflight.structuredContent,
        });
        insertion = await this.fixedWrite({
          projectId: project.project.id,
          runId: run.id,
          capturedAt,
          seed: inputs.seed,
          live,
        });
        providerStateRecorded = true;
      }

      const rootReadback = await this.childrenRead(
        inputs.seed,
        rootPackageId,
        "root-readback",
        live,
      );
      const architecturePackage = requireInspectionDroneArchitecturePackage({
        rootPackageId,
        rootChildrenResult: rootReadback.structuredContent,
      });
      const packageReadback = await this.childrenRead(
        inputs.seed,
        architecturePackage.id,
        "package-readback",
        live,
      );

      materialized = await this.materialize(
        inputs,
        run.id,
        capturedAt,
        insertion,
        rootReadback.structuredContent,
        packageReadback.structuredContent,
      );
      await this.#captures.save(materialized.sha256, materialized.text);
      await this.assertExactPersistedCapture(materialized);
      await this.#snapshots.save(materialized.snapshot);
      // After this point a retry may only attach durable evidence. It must
      // never reinterpret a later read failure as permission to write again.
      snapshotPersisted = true;
      await this.assertExactPersistedSnapshot(materialized);

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: stepCommandId(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the read-back inspection-drone architecture evidence.",
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
          summary:
            "Recorded the bounded high-level inspection-drone SysML architecture and its read-back.",
          resultSnapshot: snapshotReference(materialized.snapshot),
          evidenceRefs: [architectureEvidenceReference(materialized.snapshot)],
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
          "The inspection-drone architecture evidence is durable, but project attachment did not finish. Retry the same execution command; it will not insert a second architecture package.",
        );
      }
      if (
        error instanceof InspectionDroneArchitectureWriteOutcomeUnknownError ||
        error instanceof ProviderWriteOutcomeUnknownError
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The SysON inspection-drone architecture insertion outcome is unknown. It will not be retried automatically because the provider may already contain the architecture package. An operator must inspect SysON before any separately reviewed recovery path.",
        );
      }
      if (providerStateRecorded) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The SysON inspection-drone architecture insertion is durably acknowledged, but its evidence was not published. Retry the same execution command to resume read-back and attachment without another insertion.",
        );
      }
      if (claimSucceeded) await this.recordFailureIfOwned(origin, command);
      throw error;
    }
  }

  private async existingAttemptOrFailClosed(
    projectId: string,
    runId: string,
  ) {
    try {
      return await this.#attempts.read(projectId, runId, "architecture-insert");
    } catch {
      // A corrupted or unreadable attempt record might be the only durable
      // evidence that a prior process dispatched the insertion.
      throw new InspectionDroneArchitectureWriteOutcomeUnknownError(
        "architecture-insert",
      );
    }
  }

  private async fixedWrite(input: {
    projectId: string;
    runId: string;
    capturedAt: string;
    seed: InspectionDroneArchitectureSeed;
    live: LiveRecorder;
  }): Promise<InspectionDroneArchitectureInsertion> {
    let begun: Awaited<
      ReturnType<FileInspectionDroneArchitectureAttemptStore["begin"]>
    >;
    try {
      begun = await this.#attempts.begin({
        projectId: input.projectId,
        runId: input.runId,
        step: "architecture-insert",
        dispatchedAt: input.capturedAt,
      });
    } catch (error) {
      if (error instanceof InspectionDroneArchitectureWriteOutcomeUnknownError) {
        throw error;
      }
      throw error;
    }
    if (begun.action === "completed") {
      try {
        return await insertionFromAttempt(
          begun.result,
          input.seed.normalizedResults.rootPackage.id,
        );
      } catch {
        throw new ProviderWriteOutcomeUnknownError("architecture-insert");
      }
    }

    try {
      await input.live("architecture-insert", "started");
      const response = await this.#syson.callTool({
        name: "syson_element_insert_sysml",
        arguments: {
          editing_context_id: input.seed.normalizedResults.project.editingContextId,
          parent_id: input.seed.normalizedResults.rootPackage.id,
          sysml_text: INSPECTION_DRONE_ARCHITECTURE_SYSML,
        },
      });
      const insertion = await validateInspectionDroneArchitectureInsertion({
        rootPackageId: input.seed.normalizedResults.rootPackage.id,
        insertionResult: response.structuredContent,
      });
      await this.#attempts.complete({
        projectId: input.projectId,
        runId: input.runId,
        step: "architecture-insert",
        dispatchedAt: input.capturedAt,
        completedAt: safeNow(this.#now),
        result: attemptResult(insertion),
      });
      await input.live("architecture-insert", "completed");
      return insertion;
    } catch {
      await input.live("architecture-insert", "failed");
      // The journal's dispatched marker is durable before this call. Any
      // timeout, malformed acknowledgement or durability error leaves the
      // provider outcome unknown rather than risking a second insertion.
      throw new ProviderWriteOutcomeUnknownError("architecture-insert");
    }
  }

  private async childrenRead(
    seed: InspectionDroneArchitectureSeed,
    elementId: string,
    step: InspectionDroneArchitectureLiveStep,
    live: LiveRecorder,
  ): Promise<McpToolResult> {
    const call = {
      name: "syson_element_children",
      arguments: {
        editing_context_id: seed.normalizedResults.project.editingContextId,
        element_id: elementId,
      },
    };
    await live(step, "started");
    try {
      const result = await this.#syson.callTool(call);
      await live(step, "completed");
      return result;
    } catch (error) {
      await live(step, "failed");
      throw error;
    }
  }

  private async requiredInputs(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<InspectionDroneArchitectureEligibility> {
    return await resolveInspectionDroneArchitectureEligibility(
      {
        snapshots: this.#snapshots,
        approvedDiscoveryCaptures: this.#approvedDiscoveryCaptures,
        seedCaptures: this.#seedCaptures,
      },
      {
        project,
        basis: requireThreadBasis(run),
      },
    );
  }

  private async materialize(
    inputs: InspectionDroneArchitectureEligibility,
    runId: string,
    capturedAt: string,
    insertion: InspectionDroneArchitectureInsertion,
    rootChildrenResult: unknown,
    architectureChildrenResult: unknown,
  ): Promise<InspectionDroneArchitectureMaterialization> {
    const first = await materializeInspectionDroneArchitecture({
      base: inputs.base,
      seedCapture: inputs.seedCapture,
      trustedRunId: runId,
      capturedAt,
      insertion,
      rootChildrenResult,
      architectureChildrenResult,
    });
    const result = await materializeInspectionDroneArchitecture({
      base: inputs.base,
      seedCapture: inputs.seedCapture,
      trustedRunId: runId,
      capturedAt,
      insertion,
      rootChildrenResult,
      architectureChildrenResult,
      captureUri: this.#captures.uriFor(first.sha256),
    });
    if (
      deterministicJson(first.capture) !== deterministicJson(result.capture) ||
      deterministicJson(first.sha256) !== deterministicJson(result.sha256)
    ) {
      throw new Error("Inspection-drone architecture materialization was not stable.");
    }
    return result;
  }

  private async assertExactPersistedCapture(
    materialized: InspectionDroneArchitectureMaterialization,
  ): Promise<void> {
    const persisted = await this.#captures.read(materialized.sha256);
    if (persisted !== materialized.text) {
      throw new Error(
        "Inspection-drone architecture capture was not durably readable after save.",
      );
    }
  }

  private async assertExactPersistedSnapshot(
    materialized: InspectionDroneArchitectureMaterialization,
  ): Promise<void> {
    if ((await this.exactPersistedSnapshotPresence(materialized)) !== "exact") {
      throw new Error(
        `Inspection-drone architecture ThreadSnapshot ${materialized.snapshot.id} was not durably readable after save.`,
      );
    }
  }

  private async exactPersistedSnapshotPresence(
    materialized: InspectionDroneArchitectureMaterialization,
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
    startAt: InspectionDroneArchitectureLiveStartStep,
  ): LiveRecorder {
    const projector = createInspectionDroneArchitectureLiveProjector(run.id, {
      startAt,
    });
    return async (step, phase) => {
      if (!this.#liveUpdates) return;
      const toolName = liveToolName(step);
      const operationId = `${INSPECTION_DRONE_ARCHITECTURE_OPERATION.id}:${step}`;
      const recordedAt = safeNow(this.#now);
      try {
        await this.#liveUpdates.appendOnce({
          subjectId: project.project.subjectId,
          runId: run.id,
          operationId,
          baseRevision: basis.revision,
          state: phase === "started"
            ? "running"
            : phase === "completed"
            ? "fresh"
            : "failed",
          recordedAt,
          graph: projector({
            phase,
            subjectId: project.project.subjectId,
            runId: run.id,
            operationId,
            serverId: "syson",
            toolName,
            recordedAt,
            // Presentation projection deliberately receives no provider
            // arguments, results, or error text.
            call: { name: toolName },
          }),
        });
      } catch {
        // Live activity is a presentation aid. A journal problem must never
        // retry, invalidate, or otherwise alter the guarded provider path.
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
      // Canonical evidence already completed; the feed is optional.
    }
  }

  private async recordFailureIfOwned(
    origin: EngineeringProjectCommandOrigin,
    command: InspectionDroneArchitectureRunExecutorCommand,
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
        summary:
          "The inspection-drone architecture stopped before a provider insertion was recorded.",
        code: "inspection-drone-architecture-not-published",
        message:
          "The bounded architecture run stopped before a SysON insertion was recorded or technical evidence was published.",
      });
    } catch {
      // Never obscure the original execution error with best-effort auditing.
    }
  }

  private async completedProjectForThisExecution(
    command: InspectionDroneArchitectureRunExecutorCommand,
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

/**
 * Re-read the complete durable r1 -> r2 chain that authorizes r3 without
 * touching a provider or changing the project.  Queue-time admission and run
 * execution must call this same gate rather than separately reimplementing a
 * looser view of the discovery or model-container state.
 */
export async function resolveInspectionDroneArchitectureEligibility(
  dependencies: InspectionDroneArchitectureEligibilityDependencies,
  input: {
    readonly project: EngineeringProjectSnapshot;
    readonly basis: EngineeringThreadSnapshotBasis;
  },
): Promise<InspectionDroneArchitectureEligibility> {
  const base = await requiredExactR2Snapshot(dependencies.snapshots, input.basis);
  const seedArtifact = onlySeedArtifact(base);
  let seedText: string | undefined;
  try {
    seedText = await dependencies.seedCaptures.read(seedArtifact.fingerprint);
  } catch {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The exact r2 SysON model-seed capture failed its integrity check and cannot authorize SysON.",
    );
  }
  if (seedText === undefined) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The exact r2 SysON model-seed capture required by this architecture run is no longer readable.",
    );
  }
  const seedCapture = parseJson(
    seedText,
    "The r2 SysON model-seed capture is not valid JSON.",
  );
  let seed: InspectionDroneArchitectureSeed;
  try {
    seed = await requireInspectionDroneArchitectureSeed(base, seedCapture);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `The exact r2 SysON model-container basis is not eligible: ${
        errorMessage(error)
      }`,
    );
  }
  const discovery = await requiredApprovedDroneDiscovery(
    dependencies,
    input.project,
    base,
  );
  return { base, seedCapture, seed, discovery };
}

async function requiredExactR2Snapshot(
  snapshots: Pick<ThreadSnapshotStore, "get">,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  let candidate: ThreadSnapshot | undefined;
  try {
    candidate = await snapshots.get(basis.snapshotId);
  } catch {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The exact r2 ThreadSnapshot required by this inspection-drone architecture run is not readable.",
    );
  }
  if (
    !candidate || candidate.id !== basis.snapshotId ||
    candidate.revision !== basis.revision || candidate.subject.id !== basis.subjectId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The exact r2 ThreadSnapshot required by this inspection-drone architecture run is no longer readable.",
    );
  }
  try {
    return validateThreadSnapshot(candidate);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `The exact r2 ThreadSnapshot required by this inspection-drone architecture run is invalid: ${
        errorMessage(error)
      }`,
    );
  }
}

async function requiredApprovedDroneDiscovery(
  dependencies: InspectionDroneArchitectureEligibilityDependencies,
  project: EngineeringProjectSnapshot,
  r2: ThreadSnapshot,
): Promise<ProjectDiscoverySnapshot> {
  const r1Reference = r2.previous;
  if (!r1Reference || r1Reference.revision !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The r2 SysON model-container does not point to the exact documentary r1 source.",
    );
  }
  let candidate: ThreadSnapshot | undefined;
  try {
    candidate = await dependencies.snapshots.get(r1Reference.snapshotId);
  } catch {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The exact documentary r1 source required by this architecture run is not readable.",
    );
  }
  if (
    !candidate || candidate.id !== r1Reference.snapshotId ||
    candidate.revision !== r1Reference.revision ||
    candidate.subject.id !== r2.subject.id
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The exact documentary r1 source required by this architecture run is no longer readable.",
    );
  }
  let r1: ThreadSnapshot;
  try {
    r1 = validateThreadSnapshot(candidate);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `The exact documentary r1 source required by this architecture run is invalid: ${
        errorMessage(error)
      }`,
    );
  }
  const document = r1.artifacts.find((artifact) =>
    artifact.id === r1.subject.modelArtifactId && artifact.kind === "document"
  );
  if (
    r1.previous !== undefined || !document || r1.artifacts.length !== 1 ||
    document.producer.serverId !== "casys-digital-thread" ||
    document.producer.tool !== "baseline_from_approved_discovery" ||
    document.inputArtifactIds.length !== 0
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The r1 basis does not expose the exact approved-discovery documentary artifact.",
    );
  }
  let text: string | undefined;
  try {
    text = await dependencies.approvedDiscoveryCaptures.read(document.fingerprint);
  } catch {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The exact approved-discovery capture failed its integrity check and cannot authorize SysON.",
    );
  }
  if (text === undefined) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The exact approved-discovery capture required by this architecture run is no longer readable.",
    );
  }
  return approvedInspectionDroneDiscovery(
    parseJson(text, "The approved-discovery capture is not valid JSON."),
    project,
    document.producer.runId,
  );
}

class ProviderWriteOutcomeUnknownError extends Error {
  constructor(step: "architecture-insert") {
    super(`SysON ${step} may have changed provider state without a durable response.`);
    this.name = "ProviderWriteOutcomeUnknownError";
  }
}

type InspectionDroneArchitectureLiveStep =
  | "root-preflight"
  | "architecture-insert"
  | "root-readback"
  | "package-readback";

type LiveRecorder = (
  step: InspectionDroneArchitectureLiveStep,
  phase: "started" | "completed" | "failed",
) => Promise<void>;

function liveToolName(step: InspectionDroneArchitectureLiveStep): string {
  return step === "architecture-insert"
    ? "syson_element_insert_sysml"
    : "syson_element_children";
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

function requireInspectionDroneArchitectureRun(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): EngineeringWorkItem {
  const workItem = requireInspectionDroneArchitectureShape(project, run);
  if (
    run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact human-queued inspection-drone architecture it claimed.",
    );
  }
  return workItem;
}

function requireInspectionDroneArchitectureShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): EngineeringWorkItem {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const bindings = workItem?.operation?.bindings;
  if (
    project.schemaVersion !== "2.0" || run.basis?.kind !== "thread-snapshot" ||
    !workItem ||
    workItem.operation?.id !== INSPECTION_DRONE_ARCHITECTURE_OPERATION.id ||
    workItem.operation.version !== INSPECTION_DRONE_ARCHITECTURE_OPERATION.version ||
    !bindings || bindings.length !== 1 || bindings[0]?.name !== "approvedDiscovery" ||
    bindings[0].source.kind !== "approved-discovery"
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact human-queued V2 inspection-drone architecture operation.",
    );
  }
  return workItem;
}

function requireThreadBasis(run: EngineeringAgentRun): EngineeringThreadSnapshotBasis {
  if (run.basis?.kind !== "thread-snapshot") {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Inspection-drone architecture run ${run.id} must be bound to an exact ThreadSnapshot.`,
    );
  }
  return structuredClone(run.basis);
}

function requiredRunStart(run: EngineeringAgentRun): string {
  if (!run.startedAt || Number.isNaN(Date.parse(run.startedAt))) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Inspection-drone architecture run ${run.id} has no durable start timestamp.`,
    );
  }
  return run.startedAt;
}

function onlySeedArtifact(base: ThreadSnapshot) {
  const artifacts = base.artifacts.filter((artifact) =>
    artifact.kind === "sysml-model"
  );
  if (artifacts.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The exact r2 basis must expose one SysON model-container artifact.",
    );
  }
  return artifacts[0]!;
}

function approvedInspectionDroneDiscovery(
  value: unknown,
  project: EngineeringProjectSnapshot,
  expectedBaselineRunId: string,
): ProjectDiscoverySnapshot {
  const root = closedRecord(
    value,
    [
      "schemaVersion",
      "kind",
      "scope",
      "statement",
      "runId",
      "capturedAt",
      "operation",
      "workItemId",
      "projectDefinition",
      "discoverySnapshot",
    ],
    "approved-discovery capture",
  );
  if (
    root.schemaVersion !== APPROVED_DISCOVERY_BASELINE_CAPTURE_SCHEMA ||
    root.kind !== "approved-discovery-documentary-baseline" ||
    root.scope !== "pre-technical-documentation" ||
    root.runId !== expectedBaselineRunId ||
    typeof root.statement !== "string" || !root.statement.trim() ||
    typeof root.capturedAt !== "string" || Number.isNaN(Date.parse(root.capturedAt))
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The exact r1 approved-discovery capture has an invalid identity.",
    );
  }
  const operation = closedRecord(
    root.operation,
    ["id", "version"],
    "approved-discovery capture operation",
  );
  if (
    operation.id !== APPROVED_DISCOVERY_BASELINE_OPERATION.id ||
    operation.version !== APPROVED_DISCOVERY_BASELINE_OPERATION.version
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The exact r1 capture was not produced by the approved-discovery baseline operation.",
    );
  }
  const definition = closedRecord(
    root.projectDefinition,
    ["identity", "discoveryHandoff", "plan", "workItem"],
    "approved-discovery project definition",
  );
  const expectedDefinition = currentBaselineProjectDefinition(
    project,
    root.workItemId,
  );
  if (
    !expectedDefinition ||
    !canonicallyEqual(definition, expectedDefinition)
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The r1 approved-discovery capture does not exactly match this engineering project's identity, approved handoff, reviewed plan, and baseline work item.",
    );
  }
  const handoff = project.discoveryHandoff;
  if (!handoff) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The engineering project no longer carries the approved discovery handoff captured in r1.",
    );
  }
  let discovery: ProjectDiscoverySnapshot;
  try {
    discovery = validateProjectDiscoverySnapshot(root.discoverySnapshot);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `The discovery embedded in the exact r1 capture is invalid: ${
        errorMessage(error)
      }`,
    );
  }
  if (
    discovery.status !== "approved" || !discovery.brief || !discovery.review ||
    discovery.review.status !== "approved" ||
    discovery.discoveryId !== handoff.discoveryId ||
    discovery.id !== handoff.snapshotId || discovery.revision !== handoff.revision ||
    discovery.brief.id !== handoff.briefId ||
    discovery.review.briefId !== handoff.briefId ||
    !fingerprintsEqual(
      discovery.review.inputFingerprint,
      handoff.approvedBriefFingerprint,
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The r1 capture does not carry the exact human-approved discovery used by this project.",
    );
  }
  requireDiscoveryAnswer(discovery, "primary-mission", "inspection-controlled");
  requireDiscoveryAnswer(discovery, "payload-class", "light-inspection-camera");
  return discovery;
}

/**
 * Reconstruct the r1 capture's intentionally stable project projection from
 * the current project. Runtime status, receipts and evidence links are
 * excluded because those necessarily change after the baseline run; identity,
 * plan and operation shape must remain byte-for-byte identical.
 */
function currentBaselineProjectDefinition(
  project: EngineeringProjectSnapshot,
  captureWorkItemId: unknown,
): {
  readonly identity: EngineeringProjectSnapshot["project"];
  readonly discoveryHandoff: NonNullable<
    EngineeringProjectSnapshot["discoveryHandoff"]
  >;
  readonly plan: NonNullable<EngineeringProjectSnapshot["plan"]>;
  readonly workItem: {
    readonly id: string;
    readonly phaseId: string;
    readonly title: string;
    readonly description: string;
    readonly kind: EngineeringWorkItem["kind"];
    readonly owner: EngineeringWorkItem["owner"];
    readonly dependsOnWorkItemIds: readonly string[];
    readonly operation: NonNullable<EngineeringWorkItem["operation"]>;
  };
} | undefined {
  if (
    typeof captureWorkItemId !== "string" || !project.discoveryHandoff || !project.plan
  ) {
    return undefined;
  }
  const candidates = project.workItems.filter((item) =>
    item.operation?.id === APPROVED_DISCOVERY_BASELINE_OPERATION.id &&
    item.operation.version === APPROVED_DISCOVERY_BASELINE_OPERATION.version
  );
  const workItem = candidates.length === 1 && candidates[0]?.id === captureWorkItemId
    ? candidates[0]
    : undefined;
  if (!workItem?.operation) return undefined;
  return {
    identity: structuredClone(project.project),
    discoveryHandoff: structuredClone(project.discoveryHandoff),
    plan: structuredClone(project.plan),
    workItem: {
      id: workItem.id,
      phaseId: workItem.phaseId,
      title: workItem.title,
      description: workItem.description,
      kind: workItem.kind,
      owner: workItem.owner,
      dependsOnWorkItemIds: structuredClone(workItem.dependsOnWorkItemIds),
      operation: structuredClone(workItem.operation),
    },
  };
}

function canonicallyEqual(left: unknown, right: unknown): boolean {
  try {
    return deterministicJson(left) === deterministicJson(right);
  } catch {
    return false;
  }
}

function requireDiscoveryAnswer(
  discovery: ProjectDiscoverySnapshot,
  questionId: string,
  expectedValue: string,
): void {
  const answer = currentProjectDiscoveryAnswer(discovery, questionId);
  if (answer?.kind !== "provided" || answer.value !== expectedValue) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `The exact approved discovery must provide ${questionId}=${expectedValue} before this architecture run can call SysON.`,
    );
  }
}

function attemptResult(
  insertion: InspectionDroneArchitectureInsertion,
): Readonly<Record<string, string>> {
  return {
    inserted: "true",
    parentId: insertion.parentId,
    textSha256: insertion.textSha256.digest,
  };
}

async function insertionFromAttempt(
  value: Readonly<Record<string, string>> | undefined,
  rootPackageId: string,
): Promise<InspectionDroneArchitectureInsertion> {
  if (!value) {
    throw new Error(
      "Completed inspection-drone architecture attempt has no acknowledgement.",
    );
  }
  const actual = Object.keys(value).sort();
  const expected = ["inserted", "parentId", "textSha256"];
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index]) ||
    value.inserted !== "true" || value.parentId !== rootPackageId
  ) {
    throw new Error(
      "Completed inspection-drone architecture attempt has an invalid acknowledgement.",
    );
  }
  const expectedFingerprint = await inspectionDroneArchitectureSysmlFingerprint();
  if (value.textSha256 !== expectedFingerprint.digest) {
    throw new Error(
      "Completed inspection-drone architecture attempt does not match the reviewed SysML recipe.",
    );
  }
  return {
    inserted: true,
    parentId: rootPackageId,
    textSha256: expectedFingerprint,
  };
}

function snapshotReference(snapshot: ThreadSnapshot): EngineeringThreadSnapshotRef {
  return {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  };
}

function architectureEvidenceReference(
  snapshot: ThreadSnapshot,
): EngineeringThreadEntityRef {
  const artifact = snapshot.artifacts.find((candidate) =>
    candidate.id.startsWith("inspection-drone-architecture-")
  );
  if (!artifact) {
    throw new Error(
      "Inspection-drone architecture snapshot has no architecture artifact.",
    );
  }
  return {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact",
    id: artifact.id,
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
      `Inspection-drone architecture run ${runId} did not complete through this exact execution command.`,
    );
  }
}

function unexpectedRunStatus(
  run: EngineeringAgentRun,
  expected: "publishing" | "completed",
): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError(
    "invalid_transition",
    `Inspection-drone architecture run ${run.id} is ${run.status}; expected ${expected} while resuming this exact execution command.`,
  );
}

function stepCommandId(commandId: string, step: string): string {
  return `${commandId}:inspection-drone-architecture:${step}`;
}

function safeNow(now: () => string): string {
  const value = now();
  return Number.isNaN(Date.parse(value)) ? new Date().toISOString() : value;
}

function parseJson(text: string, message: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new EngineeringProjectCommandError("invalid_input", message);
  }
}

function closedRecord(
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `${path} must be an object.`,
    );
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `${path} has an unreviewed shape.`,
    );
  }
  return record;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
