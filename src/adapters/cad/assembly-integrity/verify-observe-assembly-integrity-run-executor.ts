/**
 * Trusted L3 executor for `verify.observe-assembly-integrity@1`.
 *
 * It reopens one human-approved, exact geometry-module basis, journals the
 * one external observation before dispatch, and publishes only factual L3
 * evidence. It never chooses a provider/profile/runtime, emits a product
 * verdict, or turns an L3 observation into a gate satisfaction.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import {
  beginConfiguredCapabilityRuntimeSession,
  isDurableTerminalAgentRunStatus,
  requireConfiguredOperationalCapability,
  settleCapabilityRuntimeSession,
} from "../../../application/control-plane/capability-runtime-execution-admission.ts";
import { requiredQualifiedPersistentComposePublication } from "../../../application/control-plane/capability-runtime-persistent-compose-publication.ts";
import {
  type CapabilityRuntimeExecutionSession,
  type CapabilityRuntimeExecutionSessionCoordinator,
  CapabilityRuntimeSessionUnavailableError,
} from "../../../application/control-plane/capability-runtime-execution-session.ts";
import type { CapabilityRuntimeExecutionEligibility } from "../../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type { ResolvedCapabilityRuntimeOperation } from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import {
  type CapabilityRuntimeBoundMcpClient,
  CapabilityRuntimeConnectionError,
} from "../../../application/ports/out/capability/capability-runtime-connection.ts";
import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import type {
  AssemblyIntegrityInputResolver,
  ResolvedAssemblyIntegrityInput,
} from "../../../application/ports/out/cad/assembly-integrity/exact-assembly-integrity-input-resolver.ts";
import type { AssemblyIntegrityObservationCaptureStore } from "../../../application/ports/out/cad/assembly-integrity/assembly-integrity-observation-capture-store.ts";
import type {
  AssemblyIntegrityObserver,
  AssemblyIntegrityObserverExecution,
  AssemblyIntegrityObserverResult,
} from "../../../application/ports/out/cad/assembly-integrity/assembly-integrity-observer.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type AssemblyIntegrityObservationCapture,
  assemblyIntegrityObservationCaptureUri,
  canonicalAssemblyIntegrityObservationCaptureText,
  createAssemblyIntegrityObservationCapture,
  fingerprintAssemblyIntegrityObservationCapture,
  validateAssemblyIntegrityObservationCapture,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-observation-capture.ts";
import {
  type AssemblyIntegrityObservationAdmission,
  parseAssemblyIntegrityObservationAdmissionParameters,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-observation-proposal.ts";
import {
  parseAssemblyIntegrityObservation,
  VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-observation.ts";
import { sameAssemblyIntegrityObserverProfileRef } from "../../../domain/cad/assembly-integrity/assembly-integrity-observer-profile.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import {
  isProjectBriefGateKind,
  projectBriefContractVersion,
} from "../../../domain/project/project-brief.ts";
import type {
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadEntityKind,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  AssemblyIntegrityObservationRunOutcomeUnknownError,
  FileAssemblyIntegrityObservationAttemptStore,
} from "./file-assembly-integrity-observation-attempt-store.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import { assertThreadSnapshotLineageIntact } from "../../shared/stores/thread-snapshot-lineage.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../../shared/executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "../../shared/thread-write-basis-guard.ts";

export { VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION };

export interface AssemblyIntegrityObservationThreadSnapshotStore
  extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface VerifyObserveAssemblyIntegrityRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export type AssemblyIntegrityObserverFactory = (
  client: McpToolClient,
) => AssemblyIntegrityObserver;

export interface VerifyObserveAssemblyIntegrityRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: AssemblyIntegrityObservationThreadSnapshotStore;
  readonly inputs: AssemblyIntegrityInputResolver;
  /**
   * Lease-bound observation publication. The executor never names a URL, host,
   * port, bearer, provider or tool envelope; composition owns the mapping.
   */
  readonly capabilityRuntimeConnection: CapabilityRuntimeBoundMcpClient;
  /** Opens the named observer only from a lease-bound MCP client. */
  readonly openObserver: AssemblyIntegrityObserverFactory;
  readonly captures: AssemblyIntegrityObservationCaptureStore;
  readonly attempts: FileAssemblyIntegrityObservationAttemptStore;
  readonly lease: EngineeringProjectRunLease;
  /** Cold recheck of the sealed observation binding before H1. */
  readonly capabilityRuntime?: CapabilityRuntimeExecutionEligibility;
  /** JIT host session. Entered only after the final cold recheck. */
  readonly capabilityRuntimeSession?: Pick<
    CapabilityRuntimeExecutionSessionCoordinator,
    "begin" | "releaseRecorded"
  >;
}

interface AssemblyIntegrityAuthorization {
  readonly workItem: EngineeringWorkItem;
  readonly geometryModuleBinding: EngineeringThreadEntityRef;
  readonly admission: AssemblyIntegrityObservationAdmission;
}

interface PreparedAssemblyIntegrityObservation {
  readonly authorization: AssemblyIntegrityAuthorization;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly basisSnapshot: ThreadSnapshot;
  readonly resolved: ResolvedAssemblyIntegrityInput;
  readonly planDigest: string;
}

/**
 * The sole trusted writer for the factual assembly-integrity observation.
 *
 * The durable attempt journal is deliberately outside the observer port:
 * `observe()` is one potentially externally visible call, while this executor
 * owns whether that call may happen at all and how it is recovered.
 */
export class VerifyObserveAssemblyIntegrityRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: VerifyObserveAssemblyIntegrityRunExecutorDependencies["commands"];
  readonly #snapshots: AssemblyIntegrityObservationThreadSnapshotStore;
  readonly #inputs: AssemblyIntegrityInputResolver;
  readonly #capabilityRuntimeConnection: CapabilityRuntimeBoundMcpClient;
  readonly #openObserver: AssemblyIntegrityObserverFactory;
  readonly #captures: AssemblyIntegrityObservationCaptureStore;
  readonly #attempts: FileAssemblyIntegrityObservationAttemptStore;
  readonly #lease: EngineeringProjectRunLease;
  readonly #capabilityRuntime: CapabilityRuntimeExecutionEligibility | undefined;
  readonly #capabilityRuntimeSession:
    | Pick<
      CapabilityRuntimeExecutionSessionCoordinator,
      "begin" | "releaseRecorded"
    >
    | undefined;

  constructor(dependencies: VerifyObserveAssemblyIntegrityRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#inputs = dependencies.inputs;
    this.#capabilityRuntimeConnection = dependencies.capabilityRuntimeConnection;
    this.#openObserver = dependencies.openObserver;
    this.#captures = dependencies.captures;
    this.#attempts = dependencies.attempts;
    this.#lease = dependencies.lease;
    this.#capabilityRuntime = dependencies.capabilityRuntime;
    this.#capabilityRuntimeSession = dependencies.capabilityRuntimeSession;
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyObserveAssemblyIntegrityRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent" || origin.actorId.trim().length === 0) {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only one authenticated agent origin can execute an assembly-integrity observation.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireAssemblyIntegrityShape(project, run);
    await this.#requireMrtrAuthorization(project, run, command.projectId);

    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyObserveAssemblyIntegrityRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let snapshotSaveMayHaveBeenDispatched = false;
    let dispatchedWithoutDurableCapture = false;
    let capabilitySession: CapabilityRuntimeExecutionSession | undefined;

    try {
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      const beforeClaimAuthorization = await this.#requireMrtrAuthorization(
        project,
        run,
        command.projectId,
      );

      if (run.status === "completed") {
        const completed = await this.#prepare(
          project,
          run,
          beforeClaimAuthorization,
        );
        return await this.#verifyCompletedReplay(
          project,
          run,
          completed,
          command,
        );
      }
      if (run.status === "failed" || run.status === "cancelled") {
        throw unexpectedStatus(run, "queued or this agent's running/publishing");
      }
      if (run.status === "queued") {
        await assertThreadWriteBasisAvailable(project, run);
      } else if (run.status === "running" || run.status === "publishing") {
        requireClaimedShape(project, run, origin);
      } else {
        throw unexpectedStatus(run, "queued or this agent's running/publishing");
      }

      const prepared = await this.#prepare(
        project,
        run,
        beforeClaimAuthorization,
      );
      const inspection = await this.#attempts.inspect({
        projectId: command.projectId,
        runId: run.id,
        planDigest: prepared.planDigest,
      });
      if (inspection.action === "dispatched") {
        throw new AssemblyIntegrityObservationRunOutcomeUnknownError();
      }
      if (
        inspection.action === "capture-recorded" || inspection.action === "completed"
      ) {
        const recordedCapability = await this.#lookupOperationalCapabilityCold(
          project,
          run,
        );
        const recovered = await this.#recoverRecordedObservation({
          origin,
          command,
          project,
          run,
          prepared,
          wal: inspection,
          markClaimed: (value) => {
            claimed = value;
          },
          markSnapshotSave: () => {
            snapshotSaveMayHaveBeenDispatched = true;
          },
        });
        await this.#releaseRecordedRuntimeBestEffort(
          recovered,
          command.runId,
          recordedCapability,
        );
        return recovered;
      }

      const operationalCapability = await this.#requireOperationalCapability(
        project,
        run,
      );
      capabilitySession = await beginConfiguredCapabilityRuntimeSession({
        session: this.#capabilityRuntimeSession!,
        project,
        runId: command.runId,
        operationalCapability,
        recheck: async () => {
          const fresh = await this.#requiredProject(command.projectId);
          const freshRun = requireRun(fresh, command.runId);
          requireAssemblyIntegrityShape(fresh, freshRun);
          return await this.#requireOperationalCapability(fresh, freshRun);
        },
      });
      let observer: AssemblyIntegrityObserver;
      try {
        observer = await this.#openBoundObserver(
          capabilitySession,
          operationalCapability,
        );
      } catch (error) {
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: { kind: "release" },
        });
        capabilitySession = undefined;
        if (error instanceof CapabilityRuntimeConnectionError) {
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            error.message,
          );
        }
        throw error;
      }

      if (run.status === "queued") {
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "claim"),
          summary: "Started the exact factual assembly-integrity observation.",
        });
        claimed = true;
      } else {
        requireClaimedShape(project, run, origin);
        claimed = true;
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      const authorization = await this.#requireMrtrAuthorization(
        project,
        run,
        command.projectId,
      );
      requireClaimedShape(project, run, origin);
      const livePrepared = await this.#prepare(project, run, authorization);
      const dispatchedAt = requiredStart(run);
      const wal = await this.#attempts.begin({
        projectId: command.projectId,
        runId: run.id,
        planDigest: livePrepared.planDigest,
        dispatchedAt,
      });

      let capture: AssemblyIntegrityObservationCapture;
      let captureFingerprint: ContentFingerprint;
      if (wal.action === "dispatch") {
        // From this durable boundary onward no second observer invocation is
        // safe until the exact returned capture has been recorded in the WAL.
        dispatchedWithoutDurableCapture = true;
        const result = await observer.observe({
          inputBundle: livePrepared.resolved.inputBundle,
          profile: livePrepared.resolved.profile,
        });
        capture = await captureFromObserverResult({
          result,
          run,
          basis: livePrepared.basis,
          resolved: livePrepared.resolved,
        });
        const persisted = await this.#captures.save(capture);
        const durable = await this.#verifySavedCapture(
          persisted.capture,
          persisted.fingerprint,
          persisted.uri,
          livePrepared,
          run,
        );
        capture = durable.capture;
        captureFingerprint = durable.fingerprint;
        await this.#attempts.recordCapture({
          projectId: command.projectId,
          runId: run.id,
          planDigest: livePrepared.planDigest,
          recordedAt: dispatchedAt,
          captureFingerprint,
          canonicalCaptureText: durable.canonicalText,
        });
        dispatchedWithoutDurableCapture = false;
      } else {
        const replay = await this.#reopenRecordedCapture(
          wal.captureFingerprint,
          wal.canonicalCaptureText,
          livePrepared,
          run,
        );
        capture = replay.capture;
        captureFingerprint = replay.fingerprint;
      }

      const completed = await this.#publishObservation({
        origin,
        command,
        prepared: livePrepared,
        run,
        capture,
        captureFingerprint,
        walAction: wal.action === "dispatch" ? "capture-recorded" : wal.action,
        dispatchedAt,
        markSnapshotSave: () => {
          snapshotSaveMayHaveBeenDispatched = true;
        },
      });
      await settleCapabilityRuntimeSession({
        session: capabilitySession,
        policy: { kind: "release" },
      });
      return completed;
    } catch (error) {
      if (error instanceof AssemblyIntegrityObservationRunOutcomeUnknownError) {
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: { kind: "retain" },
        });
        throw error;
      }
      if (dispatchedWithoutDurableCapture) {
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: { kind: "retain" },
        });
        throw new AssemblyIntegrityObservationRunOutcomeUnknownError(
          `The assembly-integrity observer may have been dispatched but no exact durable capture was recorded: ${
            errorMessage(error)
          }`,
        );
      }
      if (snapshotSaveMayHaveBeenDispatched) {
        const completed = await this.#completedFor(command);
        if (completed) {
          await settleCapabilityRuntimeSession({
            session: capabilitySession,
            policy: { kind: "release" },
          });
          return completed;
        }
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: { kind: "retain" },
        });
        // The successor write may already be durable even when a readback, WAL
        // completion, or project publication failed.  Keep the run resumable:
        // its recorded capture is the only safe recovery path and must never
        // fall through to failRun (which would make that recovery terminal).
        throw error;
      }
      if (claimed) {
        try {
          await this.#commands.failRun(origin, {
            ...command,
            commandId: commandStep(command.commandId, "fail"),
            expectedRevision: (await this.#requiredProject(command.projectId)).revision,
            summary:
              "Assembly-integrity observation failed before durable publication.",
            code: "verify-observe-assembly-integrity-failed",
            message: errorMessage(error),
          });
        } catch {
          // Keep the original causal error visible.
        }
      }
      await settleCapabilityRuntimeSession({
        session: capabilitySession,
        policy: {
          kind: "release-if-terminal",
          run: await this.#currentRun(command.projectId, command.runId),
        },
      });
      throw error;
    }
  }

  async #requireOperationalCapability(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ) {
    try {
      return await requireConfiguredOperationalCapability({
        runtime: this.#capabilityRuntime,
        session: this.#capabilityRuntimeSession,
        project,
        run,
        workItem: requireAssemblyIntegrityShape(project, run).workItem,
        unavailableMessage:
          "Assembly-integrity observation requires the configured JIT capability runtime session before a run can be claimed.",
        missingBindingMessage:
          "Assembly-integrity observation requires the sealed build123d-observe-assembly-integrity@1 operational capability before a run can be claimed.",
      });
    } catch (error) {
      if (error instanceof CapabilityRuntimeSessionUnavailableError) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          error.message,
        );
      }
      throw error;
    }
  }

  async #openBoundObserver(
    session: CapabilityRuntimeExecutionSession,
    operationalCapability: ResolvedCapabilityRuntimeOperation,
  ): Promise<AssemblyIntegrityObserver> {
    const publication = requiredQualifiedPersistentComposePublication(
      operationalCapability,
    );
    const handle = await this.#capabilityRuntimeConnection.broker.connect({
      lease: session.lease,
      binding: publication.binding,
      launchGroup: publication.launchGroup,
    });
    const client = await this.#capabilityRuntimeConnection.openMcpClient(handle);
    return this.#openObserver(client);
  }

  async #recoverRecordedObservation(input: {
    readonly origin: EngineeringProjectCommandOrigin;
    readonly command: VerifyObserveAssemblyIntegrityRunExecutorCommand;
    readonly project: EngineeringProjectSnapshot;
    readonly run: EngineeringAgentRun;
    readonly prepared: PreparedAssemblyIntegrityObservation;
    readonly wal: {
      readonly action: "capture-recorded" | "completed";
      readonly recordedAt: string;
      readonly captureFingerprint: ContentFingerprint;
      readonly canonicalCaptureText: string;
    };
    readonly markClaimed: (claimed: boolean) => void;
    readonly markSnapshotSave: () => void;
  }): Promise<EngineeringProjectSnapshot> {
    let project = input.project;
    let run = input.run;
    if (run.status === "queued") {
      await this.#commands.claimRun(input.origin, {
        ...input.command,
        commandId: commandStep(input.command.commandId, "claim"),
        summary: "Started the exact factual assembly-integrity observation.",
      });
      input.markClaimed(true);
      project = await this.#requiredProject(input.command.projectId);
      run = requireRun(project, input.command.runId);
    } else {
      requireClaimedShape(project, run, input.origin);
      input.markClaimed(true);
    }
    const authorization = await this.#requireMrtrAuthorization(
      project,
      run,
      input.command.projectId,
    );
    requireClaimedShape(project, run, input.origin);
    const prepared = await this.#prepare(project, run, authorization);
    const replay = await this.#reopenRecordedCapture(
      input.wal.captureFingerprint,
      input.wal.canonicalCaptureText,
      prepared,
      run,
    );
    return await this.#publishObservation({
      origin: input.origin,
      command: input.command,
      prepared,
      run,
      capture: replay.capture,
      captureFingerprint: replay.fingerprint,
      walAction: input.wal.action,
      dispatchedAt: requiredStart(run),
      markSnapshotSave: input.markSnapshotSave,
    });
  }

  async #publishObservation(input: {
    readonly origin: EngineeringProjectCommandOrigin;
    readonly command: VerifyObserveAssemblyIntegrityRunExecutorCommand;
    readonly prepared: PreparedAssemblyIntegrityObservation;
    readonly run: EngineeringAgentRun;
    readonly capture: AssemblyIntegrityObservationCapture;
    readonly captureFingerprint: ContentFingerprint;
    readonly walAction: "capture-recorded" | "completed" | "dispatch";
    readonly dispatchedAt: string;
    readonly markSnapshotSave: () => void;
  }): Promise<EngineeringProjectSnapshot> {
    const successor = buildAssemblyIntegrityObservationSuccessor({
      basisSnapshot: input.prepared.basisSnapshot,
      basis: input.prepared.basis,
      run: input.run,
      geometryModule: input.prepared.resolved.primary,
      assemblyStep: input.prepared.resolved.assemblyStep,
      capture: input.capture,
      captureFingerprint: input.captureFingerprint,
      captureUri: assemblyIntegrityObservationCaptureUri(
        input.captureFingerprint.digest,
      ),
    });

    if (input.walAction === "completed") {
      // A prior attempt has already recorded the exact successor and closed
      // its WAL. A later publish/complete failure must remain resumable;
      // falling through to failRun would make the durable recovery terminal.
      input.markSnapshotSave();
      await this.#requireExactPersistedSuccessor(successor.snapshot);
    } else {
      input.markSnapshotSave();
      await this.#snapshots.save(successor.snapshot);
      await this.#requireExactPersistedSuccessor(successor.snapshot);
      await this.#attempts.complete({
        projectId: input.command.projectId,
        runId: input.run.id,
        planDigest: input.prepared.planDigest,
        completedAt: input.dispatchedAt,
        captureFingerprint: input.captureFingerprint,
      });
    }

    let project = await this.#requiredProject(input.command.projectId);
    let run = requireRun(project, input.command.runId);
    if (run.status === "running") {
      await this.#commands.publishRun(input.origin, {
        ...input.command,
        commandId: commandStep(input.command.commandId, "publish"),
        expectedRevision: project.revision,
        summary: "Publishing factual assembly-integrity observations.",
      });
    }
    project = await this.#requiredProject(input.command.projectId);
    run = requireRun(project, input.command.runId);
    if (run.status === "publishing") {
      await this.#commands.completeRun(
        input.origin,
        completionCommand(
          input.command,
          project.revision,
          successor.snapshot,
          successor.artifact,
        ),
      );
    }

    const completed = await this.#requiredProject(input.command.projectId);
    assertCompleted(completed, input.command, successor.snapshot, successor.artifact);
    return completed;
  }

  async #lookupOperationalCapabilityCold(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<ResolvedCapabilityRuntimeOperation | undefined> {
    try {
      return await this.#requireOperationalCapability(project, run);
    } catch {
      return undefined;
    }
  }

  async #releaseRecordedRuntimeBestEffort(
    project: EngineeringProjectSnapshot,
    runId: string,
    operationalCapability: ResolvedCapabilityRuntimeOperation | undefined,
  ): Promise<void> {
    if (!operationalCapability) return;
    const run = requireRun(project, runId);
    if (!isDurableTerminalAgentRunStatus(run.status)) return;
    const session = this.#capabilityRuntimeSession;
    if (!session?.releaseRecorded) return;
    try {
      await session.releaseRecorded({
        project,
        runId,
        operationalCapability,
      });
    } catch {
      // Host-stop or scope failure must not hide the completed engineering
      // result. The exact lease remains for administrative recovery.
    }
  }

  async #currentRun(
    projectId: string,
    runId: string,
  ): Promise<EngineeringAgentRun | undefined> {
    try {
      return requireRun(await this.#requiredProject(projectId), runId);
    } catch {
      return undefined;
    }
  }

  async #prepare(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    authorization: AssemblyIntegrityAuthorization,
  ): Promise<PreparedAssemblyIntegrityObservation> {
    const basis = requireBasis(run);
    const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
    await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);
    const resolved = await this.#inputs.resolve({
      basis: {
        snapshotId: basis.snapshotId,
        revision: basis.revision,
        subjectId: basis.subjectId,
      },
      snapshot: basisSnapshot,
      geometryModule: {
        schemaVersion: "geometry-module-capture/1.0",
        artifactId: authorization.admission.geometryModule.artifactId,
        fingerprint: authorization.admission.geometryModule.fingerprint,
      },
      observerProfile: {
        profile: {
          id: authorization.admission.observer.profile.id,
          version: authorization.admission.observer.profile.version,
        },
        fingerprint: authorization.admission.observer.profile.fingerprint,
      },
    });
    assertResolvedInputMatchesAdmission({
      project,
      run,
      authorization,
      basis,
      resolved,
    });
    const planDigest = (await sha256Fingerprint({
      operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
      runInputFingerprint: run.inputFingerprint,
      basis,
      geometryModule: authorization.admission.geometryModule,
      observer: authorization.admission.observer,
      inputBundle: {
        schemaVersion: resolved.inputBundle.manifest.schemaVersion,
        fingerprint: resolved.inputBundle.fingerprint,
        byteCount: resolved.inputBundle.bytes.byteLength,
      },
    })).digest;
    return { authorization, basis, basisSnapshot, resolved, planDigest };
  }

  async #verifyCompletedReplay(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    prepared: PreparedAssemblyIntegrityObservation,
    command: VerifyObserveAssemblyIntegrityRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    const wal = await this.#attempts.inspect({
      projectId: command.projectId,
      runId: run.id,
      planDigest: prepared.planDigest,
    });
    if (wal.action !== "completed") {
      throw new AssemblyIntegrityObservationRunOutcomeUnknownError(
        "A completed assembly-integrity run does not retain one completed exact capture journal.",
      );
    }
    const replay = await this.#reopenRecordedCapture(
      wal.captureFingerprint,
      wal.canonicalCaptureText,
      prepared,
      run,
    );
    const successor = buildAssemblyIntegrityObservationSuccessor({
      basisSnapshot: prepared.basisSnapshot,
      basis: prepared.basis,
      run,
      geometryModule: prepared.resolved.primary,
      assemblyStep: prepared.resolved.assemblyStep,
      capture: replay.capture,
      captureFingerprint: replay.fingerprint,
      captureUri: assemblyIntegrityObservationCaptureUri(replay.fingerprint.digest),
    });
    await this.#requireExactPersistedSuccessor(successor.snapshot, true);
    assertCompleted(project, command, successor.snapshot, successor.artifact);
    return project;
  }

  async #verifySavedCapture(
    capture: AssemblyIntegrityObservationCapture,
    fingerprint: ContentFingerprint,
    uri: string,
    prepared: PreparedAssemblyIntegrityObservation,
    run: EngineeringAgentRun,
  ): Promise<{
    readonly capture: AssemblyIntegrityObservationCapture;
    readonly fingerprint: ContentFingerprint;
    readonly canonicalText: string;
  }> {
    const canonicalText = await canonicalAssemblyIntegrityObservationCaptureText(
      capture,
    );
    const actual = await fingerprintAssemblyIntegrityObservationCapture(capture);
    if (
      !fingerprintsEqual(actual, fingerprint) ||
      uri !== assemblyIntegrityObservationCaptureUri(fingerprint.digest)
    ) {
      throw new Error(
        "Assembly-integrity capture persistence returned a divergent receipt.",
      );
    }
    const reread = await this.#captures.read(fingerprint);
    if (!reread) {
      throw new Error("Assembly-integrity capture was not durably readable.");
    }
    const rereadText = await canonicalAssemblyIntegrityObservationCaptureText(reread);
    const rereadFingerprint = await fingerprintAssemblyIntegrityObservationCapture(
      reread,
    );
    if (
      rereadText !== canonicalText ||
      !fingerprintsEqual(rereadFingerprint, fingerprint)
    ) {
      throw new Error(
        "Assembly-integrity capture durable reread diverges from the saved capture.",
      );
    }
    assertCaptureMatchesPrepared(reread, prepared, run);
    return { capture: reread, fingerprint: rereadFingerprint, canonicalText };
  }

  async #reopenRecordedCapture(
    fingerprint: ContentFingerprint,
    canonicalText: string,
    prepared: PreparedAssemblyIntegrityObservation,
    run: EngineeringAgentRun,
  ): Promise<{
    readonly capture: AssemblyIntegrityObservationCapture;
    readonly fingerprint: ContentFingerprint;
  }> {
    try {
      const reread = await this.#captures.read(fingerprint);
      if (!reread) {
        throw new Error("The recorded assembly-integrity capture is absent.");
      }
      const capture = await validateAssemblyIntegrityObservationCapture(reread);
      const actual = await fingerprintAssemblyIntegrityObservationCapture(capture);
      const actualText = await canonicalAssemblyIntegrityObservationCaptureText(
        capture,
      );
      if (
        !fingerprintsEqual(actual, fingerprint) ||
        actualText !== canonicalText
      ) {
        throw new Error(
          "The recorded assembly-integrity capture is corrupt or mismatched.",
        );
      }
      assertCaptureMatchesPrepared(capture, prepared, run);
      return { capture, fingerprint: actual };
    } catch (error) {
      if (error instanceof AssemblyIntegrityObservationRunOutcomeUnknownError) {
        throw error;
      }
      throw new AssemblyIntegrityObservationRunOutcomeUnknownError(
        `The exact recorded assembly-integrity capture cannot be replayed: ${
          errorMessage(error)
        }`,
      );
    }
  }

  async #requireExactPersistedSuccessor(
    expected: ThreadSnapshot,
    unknownOnMismatch = false,
  ): Promise<void> {
    const reread = await this.#snapshots.getFresh(expected.id);
    if (reread && deterministicJson(reread) === deterministicJson(expected)) return;
    if (unknownOnMismatch) {
      throw new AssemblyIntegrityObservationRunOutcomeUnknownError(
        "The completed assembly-integrity successor is absent or divergent from its exact capture.",
      );
    }
    throw new Error("Assembly-integrity successor snapshot was not durably readable.");
  }

  async #requireMrtrAuthorization(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    projectId: string,
  ): Promise<AssemblyIntegrityAuthorization> {
    const shape = requireAssemblyIntegrityShape(project, run);
    const basis = requireBasis(run);
    await this.#assertExactPlanSheetAndClaims(project, shape.workItem, basis);
    const candidates: Array<{
      readonly decision: EngineeringDecision;
      readonly approval: EngineeringApproval;
    }> = [];

    for (const decisionId of shape.workItem.decisionIds) {
      const decision = project.decisions.find((candidate) =>
        candidate.id === decisionId && candidate.status === "approved" &&
        candidate.proposal !== undefined && candidate.inputFingerprint !== undefined
      );
      if (!decision) continue;
      const approvalId = decision.approvalIds.at(-1);
      const approval = approvalId === undefined ? undefined : project.approvals.find(
        (candidate) =>
          candidate.id === approvalId && candidate.decisionId === decision.id &&
          candidate.status === "approved" &&
          candidate.decidedByOrigin === "human" &&
          typeof candidate.decidedBy === "string" &&
          candidate.decidedBy.trim().length > 0 &&
          typeof candidate.decidedAt === "string" &&
          !Number.isNaN(Date.parse(candidate.decidedAt)),
      );
      if (
        !approval || !sameSnapshotBasis(decision.baseSnapshot, basis) ||
        !sameSnapshotBasis(approval.baseSnapshot, basis) ||
        !sameEvidenceRefs(approval.inputEvidenceRefs, decision.inputEvidenceRefs) ||
        !fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint)
      ) {
        continue;
      }
      candidates.push({ decision, approval });
    }
    if (candidates.length !== 1) {
      throw invalidTransition(
        candidates.length === 0
          ? "No exact human-approved assembly-integrity MRTR decision is bound to this run basis."
          : "Assembly-integrity execution requires exactly one human-approved MRTR decision.",
      );
    }
    const selected = candidates[0]!;
    const proposal = selected.decision.proposal!;
    const expectedDecisionFingerprint = await sha256Fingerprint({
      baseSnapshot: selected.decision.baseSnapshot,
      inputEvidenceRefs: selected.decision.inputEvidenceRefs,
      proposal: {
        summary: proposal.summary,
        parameters: proposal.parameters,
      },
    });
    if (
      !fingerprintsEqual(
        expectedDecisionFingerprint,
        selected.decision.inputFingerprint,
      )
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The assembly-integrity decision fingerprint no longer seals its exact basis, evidence, summary, and parameters.",
      );
    }
    const admission = parseAssemblyIntegrityAdmission(proposal.parameters);
    if (
      admission.projectId !== projectId ||
      !sameSnapshotBasis(admission.basis, basis) ||
      shape.geometryModuleBinding.snapshotId !== basis.snapshotId ||
      shape.geometryModuleBinding.snapshotRevision !== basis.revision ||
      shape.geometryModuleBinding.kind !== "artifact" ||
      shape.geometryModuleBinding.id !== admission.geometryModule.artifactId ||
      !sameEvidenceRefs(selected.decision.inputEvidenceRefs, [
        shape.geometryModuleBinding,
      ])
    ) {
      throw invalidTransition(
        "The geometry-module binding, signed MRTR evidence, admission, and exact run basis do not identify the same Thread artifact.",
      );
    }
    const approvedDecisions = shape.workItem.decisionIds.map((decisionId) => {
      const decision = project.decisions.find((candidate) =>
        candidate.id === decisionId
      );
      if (!decision || decision.status !== "approved" || !decision.inputFingerprint) {
        throw invalidTransition(
          `Work-item decision ${decisionId} is not exactly approved for this assembly-integrity run.`,
        );
      }
      return { id: decision.id, inputFingerprint: decision.inputFingerprint };
    });
    const expectedRunFingerprint = await sha256Fingerprint({
      workItemId: shape.workItem.id,
      basis,
      operation: {
        id: shape.workItem.operation!.id,
        version: shape.workItem.operation!.version,
        bindings: shape.workItem.operation!.bindings,
      },
      approvedDecisions,
    });
    if (!fingerprintsEqual(run.inputFingerprint, expectedRunFingerprint)) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The assembly-integrity run fingerprint no longer seals its exact operation, basis, and approved MRTR decisions.",
      );
    }
    return {
      workItem: shape.workItem,
      geometryModuleBinding: shape.geometryModuleBinding,
      admission,
    };
  }

  async #assertExactPlanSheetAndClaims(
    project: EngineeringProjectSnapshot,
    workItem: EngineeringWorkItem,
    basis: EngineeringThreadSnapshotBasis,
  ): Promise<void> {
    const changes = (project.planChanges ?? []).filter((change) =>
      change.workItemIds.includes(workItem.id)
    );
    if (changes.length !== 1) {
      throw invalidTransition(
        "The assembly-integrity work item must resolve through exactly one structured project change sheet.",
      );
    }
    const change = changes[0]!;
    if (!sameSnapshotBasis(change.baseSnapshot, basis)) {
      throw invalidTransition(
        "The assembly-integrity plan sheet must name this run's exact Thread basis.",
      );
    }
    const claims = workItem.gateClaims ?? [];
    if (claims.length === 0) return;
    if (
      claims.some((claim) =>
        claim.role !== "contributes-to" || claim.status !== "current"
      )
    ) {
      throw invalidTransition(
        "An L3 assembly-integrity observation may only retain current contributes-to gate claims.",
      );
    }
    const approvedBriefBasis = change.approvedBriefBasis;
    if (!approvedBriefBasis) {
      throw invalidTransition(
        "A claimed assembly-integrity gate requires the exact approved Brief basis retained by its project change sheet.",
      );
    }
    const approvedProject = await this.#projects.getRevision(
      approvedBriefBasis.projectId,
      approvedBriefBasis.projectRevision,
    );
    if (
      !approvedProject ||
      approvedProject.schemaVersion !== "4.0" ||
      approvedProject.project.id !== approvedBriefBasis.projectId ||
      approvedProject.id !== approvedBriefBasis.projectSnapshotId ||
      approvedProject.revision !== approvedBriefBasis.projectRevision
    ) {
      throw invalidTransition(
        "The assembly-integrity plan sheet's exact approved Brief project revision is unavailable.",
      );
    }
    const brief = approvedProject.framing?.currentBrief;
    const approval = approvedProject.framing?.currentBriefApproval;
    if (
      !brief || !approval || approval.status !== "approved" ||
      approval.decidedBy?.origin !== "human" ||
      projectBriefContractVersion(brief) !== "2.0" ||
      brief.briefId !== approvedBriefBasis.briefId ||
      brief.id !== approvedBriefBasis.briefSnapshotId ||
      brief.revision !== approvedBriefBasis.briefRevision ||
      !fingerprintsEqual(
        approval.inputFingerprint,
        approvedBriefBasis.approvedBriefFingerprint,
      )
    ) {
      throw invalidTransition(
        "The assembly-integrity gate claims no longer resolve to their exact human-approved V2 Brief.",
      );
    }
    const gates = new Map(brief.items.map((item) => [item.id, item]));
    for (const claim of claims) {
      const gate = gates.get(claim.gateItemId);
      if (!gate || !isProjectBriefGateKind(gate.kind)) {
        throw invalidTransition(
          "An assembly-integrity contributes-to claim must name a gate from its exact approved Brief.",
        );
      }
    }
  }

  async #requiredProject(projectId: string): Promise<EngineeringProjectSnapshot> {
    const project = await this.#projects.get(projectId);
    if (!project || project.project.id !== projectId) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }

  async #completedFor(
    command: Pick<
      VerifyObserveAssemblyIntegrityRunExecutorCommand,
      "projectId" | "runId"
    >,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    const run = project.agentRuns.find((candidate) => candidate.id === command.runId);
    return run?.status === "completed" ? project : undefined;
  }
}

function requireAssemblyIntegrityShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): {
  readonly workItem: EngineeringWorkItem;
  readonly geometryModuleBinding: EngineeringThreadEntityRef;
} {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  const binding = operation?.bindings[0];
  if (
    project.schemaVersion !== "4.0" || run.basis?.kind !== "thread-snapshot" ||
    !workItem ||
    operation?.id !== VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.id ||
    operation.version !== VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.version ||
    operation.bindings.length !== 1 || binding?.name !== "geometryModule" ||
    binding.source.kind !== "thread-entity" ||
    binding.source.reference.kind !== "artifact"
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to ${VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.id}@${VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.version} with one geometryModule artifact binding.`,
    );
  }
  const basis = requireBasis(run);
  const reference = binding.source.reference;
  if (
    reference.snapshotId !== basis.snapshotId ||
    reference.snapshotRevision !== basis.revision
  ) {
    throw invalidTransition(
      "The geometryModule binding must name an artifact in the run's exact Thread basis revision.",
    );
  }
  return { workItem, geometryModuleBinding: reference };
}

function requireClaimedShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  requireAssemblyIntegrityShape(project, run);
  if (
    run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId
  ) {
    throw invalidTransition(
      "This executor may continue only the exact assembly-integrity run claimed by this agent origin.",
    );
  }
}

function parseAssemblyIntegrityAdmission(
  parameters: NonNullable<EngineeringDecision["proposal"]>["parameters"],
): AssemblyIntegrityObservationAdmission {
  try {
    return parseAssemblyIntegrityObservationAdmissionParameters(parameters);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Assembly-integrity observation parameters are invalid: ${errorMessage(error)}`,
    );
  }
}

function assertResolvedInputMatchesAdmission(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly run: EngineeringAgentRun;
  readonly authorization: AssemblyIntegrityAuthorization;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly resolved: ResolvedAssemblyIntegrityInput;
}): void {
  const { admission } = input.authorization;
  const { resolved } = input;
  if (
    resolved.basis.snapshotId !== input.basis.snapshotId ||
    resolved.basis.revision !== input.basis.revision ||
    resolved.basis.subjectId !== input.basis.subjectId ||
    resolved.geometryModule.artifactId !== admission.geometryModule.artifactId ||
    !fingerprintsEqual(
      resolved.geometryModule.fingerprint,
      admission.geometryModule.fingerprint,
    ) ||
    resolved.primary.id !== input.authorization.geometryModuleBinding.id ||
    !fingerprintsEqual(
      resolved.primary.fingerprint,
      admission.geometryModule.fingerprint,
    ) ||
    !sameAssemblyIntegrityObserverProfileRef(
      resolved.profile.profile,
      admission.observer.profile,
    ) ||
    !fingerprintsEqual(
      resolved.profile.profileFingerprint,
      admission.observer.profile.fingerprint,
    ) ||
    !sameMethod(resolved.profile.method, admission.observer.method) ||
    deterministicJson(resolved.profile.configuredRuntime) !==
      deterministicJson(admission.observer.configuredRuntime) ||
    !sameAssemblyIntegrityObserverProfileRef(
      resolved.observerProfile.profile,
      admission.observer.profile,
    ) ||
    !fingerprintsEqual(
      resolved.observerProfile.fingerprint,
      admission.observer.profile.fingerprint,
    ) ||
    resolved.inputBundle.manifest.geometryModule.artifactId !==
      admission.geometryModule.artifactId ||
    !fingerprintsEqual(
      resolved.inputBundle.manifest.geometryModule.fingerprint,
      admission.geometryModule.fingerprint,
    ) ||
    resolved.inputBundle.manifest.assemblyStep.sha256 !==
      resolved.assemblyStep.fingerprint.digest ||
    !sameMethod(resolved.inputBundle.manifest.method, admission.observer.method)
  ) {
    throw invalidTransition(
      "The reopened assembly-integrity binding, profile, runtime, method, and input bundle do not equal the signed admission.",
    );
  }
  if (
    input.project.project.id !== admission.projectId ||
    input.run.basis?.kind !== "thread-snapshot"
  ) {
    throw invalidTransition(
      "The reopened assembly-integrity input no longer belongs to the admitted project and exact Thread basis.",
    );
  }
}

async function captureFromObserverResult(input: {
  readonly result: AssemblyIntegrityObserverResult;
  readonly run: EngineeringAgentRun;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly resolved: ResolvedAssemblyIntegrityInput;
}): Promise<AssemblyIntegrityObservationCapture> {
  assertObserverExecutionMatches(input.result.execution, input.resolved);
  const observation = parseAssemblyIntegrityObservation(
    input.result.observation,
    input.resolved.inputBundle,
  );
  return await createAssemblyIntegrityObservationCapture({
    schemaVersion: "assembly-integrity-observation-capture/1.0",
    kind: "assembly-integrity-observation",
    operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
    trustedRunId: input.run.id,
    observedAt: requiredStart(input.run),
    basis: input.basis,
    geometryModule: {
      schemaVersion: "geometry-module-capture/1.0",
      artifactId: input.resolved.geometryModule.artifactId,
      fingerprint: input.resolved.geometryModule.fingerprint,
    },
    assemblyStep: {
      artifactId: input.resolved.assemblyStep.id,
      fingerprint: input.resolved.assemblyStep.fingerprint,
    },
    inputBundle: {
      schemaVersion: input.resolved.inputBundle.manifest.schemaVersion,
      fingerprint: input.resolved.inputBundle.fingerprint,
      byteCount: input.resolved.inputBundle.bytes.byteLength,
    },
    profile: {
      id: input.resolved.profile.profile.id,
      version: input.resolved.profile.profile.version,
      fingerprint: input.resolved.profile.profileFingerprint,
      configuredRuntime: input.resolved.profile.configuredRuntime,
    },
    execution: input.result.execution,
    observation,
    limits: {
      verdict: "none",
      fitness: "none",
      safety: "none",
      motion: "none",
      strength: "none",
    },
  });
}

function assertObserverExecutionMatches(
  execution: AssemblyIntegrityObserverExecution,
  resolved: ResolvedAssemblyIntegrityInput,
): void {
  const profile = resolved.profile;
  if (
    execution.profile.id !== profile.profile.id ||
    execution.profile.version !== profile.profile.version ||
    !fingerprintsEqual(execution.profile.fingerprint, profile.profileFingerprint) ||
    deterministicJson(execution.configuredRuntime) !==
      deterministicJson(profile.configuredRuntime) ||
    execution.raw.schemaVersion !== profile.producer.rawSchemaVersion ||
    execution.raw.producer.service !== profile.producer.package.id ||
    execution.raw.producer.packageVersion !== profile.producer.package.version ||
    execution.raw.producer.engine.id !== profile.producer.engine.id ||
    execution.raw.producer.engine.version !== profile.producer.engine.version
  ) {
    throw invalidTransition(
      "The observer result does not recross the exact selected profile and configured runtime.",
    );
  }
}

function assertCaptureMatchesPrepared(
  capture: AssemblyIntegrityObservationCapture,
  prepared: PreparedAssemblyIntegrityObservation,
  run: EngineeringAgentRun,
): void {
  const { resolved, basis, authorization } = prepared;
  if (
    capture.trustedRunId !== run.id ||
    !sameSnapshotBasis(capture.basis, basis) ||
    capture.geometryModule.artifactId !==
      authorization.admission.geometryModule.artifactId ||
    !fingerprintsEqual(
      capture.geometryModule.fingerprint,
      authorization.admission.geometryModule.fingerprint,
    ) ||
    capture.assemblyStep.artifactId !== resolved.assemblyStep.id ||
    !fingerprintsEqual(
      capture.assemblyStep.fingerprint,
      resolved.assemblyStep.fingerprint,
    ) ||
    capture.inputBundle.schemaVersion !== resolved.inputBundle.manifest.schemaVersion ||
    capture.inputBundle.byteCount !== resolved.inputBundle.bytes.byteLength ||
    !fingerprintsEqual(
      capture.inputBundle.fingerprint,
      resolved.inputBundle.fingerprint,
    ) ||
    capture.profile.id !== resolved.profile.profile.id ||
    capture.profile.version !== resolved.profile.profile.version ||
    !fingerprintsEqual(
      capture.profile.fingerprint,
      resolved.profile.profileFingerprint,
    ) ||
    deterministicJson(capture.profile.configuredRuntime) !==
      deterministicJson(resolved.profile.configuredRuntime)
  ) {
    throw invalidTransition(
      "The assembly-integrity capture does not bind this exact run, basis, input bundle, profile, and runtime.",
    );
  }
  assertObserverExecutionMatches(capture.execution, resolved);
  parseAssemblyIntegrityObservation(capture.observation, resolved.inputBundle);
}

function buildAssemblyIntegrityObservationSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly run: EngineeringAgentRun;
  readonly geometryModule: ThreadArtifact;
  readonly assemblyStep: ThreadArtifact;
  readonly capture: AssemblyIntegrityObservationCapture;
  readonly captureFingerprint: ContentFingerprint;
  readonly captureUri: string;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const capturedAt = requiredStart(input.run);
  const operation = {
    serverId: "digital-thread",
    tool:
      `${VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.id}@${VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.version}`,
    runId: input.run.id,
  };
  const artifact: ThreadArtifact = {
    id: `assembly-integrity-observation-${input.captureFingerprint.digest}`,
    name: "Factual assembly-integrity observation",
    kind: "evidence",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri: input.captureUri,
    mediaType: "application/json",
    producer: operation,
    inputArtifactIds: [input.geometryModule.id, input.assemblyStep.id],
    freshness: { status: "fresh", changedAt: capturedAt, invalidatedByChangeIds: [] },
  };
  const geometryConsumption: ThreadArtifactConsumption = {
    id: `consume-${input.geometryModule.id}-by-${artifact.id}`,
    artifactId: input.geometryModule.id,
    consumer: operation,
    observedFingerprint: input.geometryModule.fingerprint,
    verifiedAt: capturedAt,
    status: "verified",
  };
  const stepConsumption: ThreadArtifactConsumption = {
    id: `consume-${input.assemblyStep.id}-by-${artifact.id}`,
    artifactId: input.assemblyStep.id,
    consumer: operation,
    observedFingerprint: input.assemblyStep.fingerprint,
    verifiedAt: capturedAt,
    status: "verified",
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    {
      id: `verify-observe-assembly-integrity-${input.run.id}`,
      name: "Observe factual assembly integrity",
      subjectId: input.basis.subjectId,
      capturedAt,
      artifacts: [artifact],
      consumptions: [geometryConsumption, stepConsumption],
      observations: [],
      requirements: [],
      evaluations: [],
      violations: [],
      provenance: [{
        id: `derived-from-${input.geometryModule.id}-by-${artifact.id}`,
        relation: "derived_from",
        from: { kind: "artifact", id: artifact.id },
        to: { kind: "artifact", id: input.geometryModule.id },
        rationale:
          "The factual observation reopens the exact canonical geometry-module capture.",
      }, {
        id: `derived-from-${input.assemblyStep.id}-by-${artifact.id}`,
        relation: "derived_from",
        from: { kind: "artifact", id: artifact.id },
        to: { kind: "artifact", id: input.assemblyStep.id },
        rationale: "The factual observation reopens the exact canonical assembly STEP.",
      }, {
        id: `uses-${geometryConsumption.id}`,
        relation: "uses",
        from: { kind: "consumption", id: geometryConsumption.id },
        to: { kind: "artifact", id: input.geometryModule.id },
        rationale:
          "The executor re-read the exact geometry-module capture named by the observation admission.",
      }, {
        id: `uses-${stepConsumption.id}`,
        relation: "uses",
        from: { kind: "consumption", id: stepConsumption.id },
        to: { kind: "artifact", id: input.assemblyStep.id },
        rationale:
          "The executor re-read the exact canonical assembly STEP bytes in the observation input bundle.",
      }],
      proposedActions: [],
    } satisfies ThreadSnapshotExtension,
    { appliedAt: capturedAt },
  );
  if (!applied.applied) {
    throw invalidTransition(
      "This exact assembly-integrity observation is already present in the basis snapshot.",
    );
  }
  const snapshot = validateThreadSnapshot(applied.snapshot);
  assertFactsOnlySuccessor(input.basisSnapshot, snapshot, artifact);
  return { snapshot, artifact };
}

function assertFactsOnlySuccessor(
  basis: ThreadSnapshot,
  successor: ThreadSnapshot,
  artifact: ThreadArtifact,
): void {
  const added = successor.artifacts.slice(basis.artifacts.length);
  if (
    added.length !== 1 || added[0]?.id !== artifact.id ||
    added[0]?.kind !== "evidence" || added[0]?.mediaType !== "application/json" ||
    deterministicJson(added[0]?.inputArtifactIds) !==
      deterministicJson(artifact.inputArtifactIds) ||
    successor.observations.length !== basis.observations.length ||
    successor.requirements.length !== basis.requirements.length ||
    successor.evaluations.length !== basis.evaluations.length ||
    successor.violations.length !== basis.violations.length ||
    successor.proposedActions.length !== basis.proposedActions.length
  ) {
    throw invalidTransition(
      "The assembly-integrity successor must append exactly one facts-only evidence artifact and no L4/L5 entities.",
    );
  }
}

async function exactBasisSnapshot(
  snapshots: AssemblyIntegrityObservationThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.getFresh(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision || snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The exact Thread basis snapshot is not available for the assembly-integrity observation.",
    );
  }
  return validateThreadSnapshot(snapshot);
}

function completionCommand(
  command: VerifyObserveAssemblyIntegrityRunExecutorCommand,
  expectedRevision: number,
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "complete"),
    expectedRevision,
    summary: "Published factual assembly-integrity observations.",
    resultSnapshot: snapshotRef(snapshot),
    evidenceRefs: [{
      snapshotId: snapshot.id,
      snapshotRevision: snapshot.revision,
      kind: "artifact" as ThreadEntityKind,
      id: artifact.id,
    }],
  };
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: Pick<VerifyObserveAssemblyIntegrityRunExecutorCommand, "runId">,
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): void {
  const run = requireRun(project, command.runId);
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const expectedEvidence: EngineeringThreadEntityRef = {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact",
    id: artifact.id,
  };
  if (
    run.status !== "completed" ||
    run.resultSnapshot?.snapshotId !== snapshot.id ||
    run.resultSnapshot.revision !== snapshot.revision ||
    run.resultSnapshot.subjectId !== snapshot.subject.id ||
    !workItem ||
    !sameEvidenceRefs(run.evidenceRefs, [expectedEvidence]) ||
    !sameEvidenceRefs(workItem.evidenceRefs, [expectedEvidence]) ||
    !project.threadSnapshots.some((reference) =>
      reference.snapshotId === snapshot.id &&
      reference.revision === snapshot.revision &&
      reference.subjectId === snapshot.subject.id
    )
  ) {
    throw invalidTransition(
      "The completed assembly-integrity run is not attached to its one exact factual evidence successor.",
    );
  }
}

function sameMethod(
  left: {
    readonly id: string;
    readonly version: string;
    readonly linearToleranceMm: number;
  },
  right: {
    readonly id: string;
    readonly version: string;
    readonly linearToleranceMm: number;
  },
): boolean {
  return left.id === right.id && left.version === right.version &&
    Object.is(left.linearToleranceMm, right.linearToleranceMm);
}

function sameSnapshotBasis(
  value:
    | EngineeringDecision["baseSnapshot"]
    | EngineeringApproval["baseSnapshot"]
    | EngineeringAgentRun["basis"]
    | EngineeringThreadSnapshotBasis,
  basis: EngineeringThreadSnapshotBasis,
): boolean {
  return !!value && "snapshotId" in value && value.snapshotId === basis.snapshotId &&
    value.revision === basis.revision && value.subjectId === basis.subjectId;
}

function sameEvidenceRefs(
  left: readonly EngineeringThreadEntityRef[],
  right: readonly EngineeringThreadEntityRef[],
): boolean {
  const key = (reference: EngineeringThreadEntityRef) =>
    deterministicJson({
      snapshotId: reference.snapshotId,
      snapshotRevision: reference.snapshotRevision,
      kind: reference.kind,
      id: reference.id,
    });
  const leftKeys = left.map(key).sort();
  const rightKeys = right.map(key).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((value, index) => value === rightKeys[index]);
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:verify-observe-assembly-integrity:${step}`;
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
