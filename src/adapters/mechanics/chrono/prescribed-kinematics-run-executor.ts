/**
 * Registered Thread materialization for the prescribed-kinematics vertical.
 *
 * The public MCP surface queues only an operation/run id. This executor
 * reopens the exact basis and MRTR decision, then reads and writes only the
 * vertical's immutable capture lanes. It deliberately has no provider/tool/
 * image/argument selection surface. L3 remains unavailable unless the fixed
 * server-owned observation binding has reached its required qualification.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type {
  ProjectPrescribedKinematicsCaseCaptureUseCase,
} from "../../../application/ports/in/mechanics/prescribed-kinematics/project-prescribed-kinematics-case-capture.ts";
import type {
  PrescribedKinematicsRuntimeProvenance,
  RunPrescribedKinematicsObservationCommand,
  RunPrescribedKinematicsObservationUseCase,
} from "../../../application/ports/in/mechanics/prescribed-kinematics/run-prescribed-kinematics-observation.ts";
import type {
  SealPrescribedKinematicsMethodUseCase,
} from "../../../application/ports/in/mechanics/prescribed-kinematics/seal-prescribed-kinematics-method.ts";
import type {
  EvaluatePrescribedKinematicsUseCase,
} from "../../../application/ports/in/mechanics/prescribed-kinematics/evaluate-prescribed-kinematics.ts";
import type {
  DecidePrescribedKinematicsCloseoutUseCase,
} from "../../../application/ports/in/mechanics/prescribed-kinematics/decide-prescribed-kinematics-closeout.ts";
import type { RegisteredProjectRunExecutorCommand } from "../../../application/ports/in/project-run-executor.ts";
import type { ProjectRunExecutor } from "../../../application/ports/in/project-run-executor.ts";
import type { PrescribedKinematicsCaptureStore } from "../../../application/ports/out/mechanics/prescribed-kinematics-capture-store.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { prescribedKinematicsEvaluationCloseoutCandidates } from "../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-evaluation-closeout.ts";
import {
  DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
  DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
  VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION,
  VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
  VERIFY_RUN_PRESCRIBED_KINEMATICS_PROVIDER_OUTCOME_UNKNOWN_FAILURE,
  VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION,
  VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION,
} from "../../../domain/mechanism/prescribed-kinematics/operations.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import {
  fingerprintResolvedOperationPlanV2,
  type ResolvedOperationPlanV2,
  type ResolvedPrescribedKinematicsObservationAction,
} from "../../../domain/compile/rop/resolved-operation-plan-v2.ts";
import {
  fingerprintResolvedCapabilityRuntimeOperation,
  type ResolvedCapabilityRuntimeOperation,
} from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import type {
  CapabilityRuntimeExecutionMode,
  CapabilityRuntimeMaterialIdentity,
  CapabilityRuntimeMaterialRuntimeMode,
} from "../../../domain/capability/runtime/capability-runtime-material.ts";
import {
  sameCapabilityRuntimeLaunchGroupReference,
} from "../../../domain/capability/runtime/capability-runtime-launch-group.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../../domain/project/engineering-project.ts";
import type { AgentResourceReference } from "../../../domain/resource/agent-resource-capture.ts";
import type {
  ThreadArtifact,
  ThreadProvenanceLink,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
} from "../../../domain/thread/thread-snapshot-extension.ts";
import {
  parsePrescribedKinematicsCaseProposalParameters,
  parsePrescribedKinematicsRunProposalParameters,
} from "../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-proposal.ts";
import type {
  PrescribedKinematicsCase,
} from "../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-source-closure.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import type { ResolvedRunPlanReader } from "../../../domain/project/resolved-run-plan-sealer.ts";
import type {
  CapabilityRuntimeExecutionEligibility,
  CapabilityRuntimeSecretSnapshot,
  CapabilityRuntimeSecretSnapshotResolver,
} from "../../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type {
  CapabilityRuntimeExecutionSession,
  CapabilityRuntimeExecutionSessionCoordinator,
} from "../../../application/control-plane/capability-runtime-execution-session.ts";
import {
  requireResolvedRunPlanExecution,
  type ResolvedRunPlanExecutionAuthorization,
} from "../../compile/plans/resolved-run-plan-execution-guard.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../../shared/executor-run-helpers.ts";
import {
  closedUncertainWriterLifecycleQualifier,
  type UncertainWriterLifecycleQualifier,
} from "../../../application/ports/out/record/uncertain-writer-lifecycle-qualifier.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "../../shared/thread-write-basis-guard.ts";
import {
  MCP_CHRONO_032_IMAGE_REFERENCE,
} from "../../control-plane/first-party-capability-runtime-identities.ts";
import {
  firstPartyChronoLaunchGroupReference,
} from "../../control-plane/first-party-capability-runtime-launch-groups.ts";

type ExactOperation =
  | typeof VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION
  | typeof VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION
  | typeof VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION
  | typeof VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION
  | typeof DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION
  | typeof DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION;

export interface PrescribedKinematicsRunThreadSnapshotStore
  extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface PrescribedKinematicsRunExecutorDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get" | "getRevision">;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: PrescribedKinematicsRunThreadSnapshotStore;
  readonly lease: EngineeringProjectRunLease;
  readonly caseReview: ProjectPrescribedKinematicsCaseCaptureUseCase;
  readonly captures: PrescribedKinematicsCaptureStore;
  /** Exact recorded plan reader. Required only by fixed L3 execution. */
  readonly plans?: ResolvedRunPlanReader;
  /** Cold operational envelope recheck before L3 can claim its run/WAL. */
  readonly capabilityRuntime?: CapabilityRuntimeExecutionEligibility;
  /** Exact JIT session coordinator; it owns persistent group leases. */
  readonly capabilityRuntimeSession?: Pick<
    CapabilityRuntimeExecutionSessionCoordinator,
    "begin"
  >;
  /**
   * Fixed trusted Chrono runtime composition. It mints a closed secret
   * snapshot and creates the fixed local observer; it exposes no provider
   * URL, image, tool or caller-selected arguments.
   */
  readonly chronoRuntime?: {
    readonly secrets: Pick<CapabilityRuntimeSecretSnapshotResolver, "beginSnapshot">;
    createObservation(
      snapshot: CapabilityRuntimeSecretSnapshot,
    ): RunPrescribedKinematicsObservationUseCase;
  };
  readonly sealMethod: SealPrescribedKinematicsMethodUseCase;
  readonly evaluate: EvaluatePrescribedKinematicsUseCase;
  readonly decideCloseout: DecidePrescribedKinematicsCloseoutUseCase;
  /**
   * Server-computed extra eligibility for historical generic Chrono failures.
   * Closed by default for tests and alternate composition.
   */
  readonly uncertainWriterLifecycle?: UncertainWriterLifecycleQualifier;
}

interface PreparedPrescribedKinematicsL3 {
  readonly authorization: ResolvedRunPlanExecutionAuthorization;
  readonly action: ResolvedPrescribedKinematicsObservationAction;
  readonly runtime: PrescribedKinematicsRuntimeProvenance;
  readonly secretSnapshot: CapabilityRuntimeSecretSnapshot;
  readonly observe: RunPrescribedKinematicsObservationUseCase;
}

class PrescribedKinematicsUncertainOutcomeError extends EngineeringProjectCommandError {
  constructor(reason: "uncertain" | "absent" | "malformed") {
    super(
      "invalid_transition",
      `Chrono outcome remains recoverable/quarantined: ${reason}.`,
    );
    this.name = "PrescribedKinematicsUncertainOutcomeError";
  }
}

class PrescribedKinematicsKnownRejectionError extends EngineeringProjectCommandError {
  constructor(code: string) {
    super(
      "invalid_transition",
      `Chrono rejected the request before dispatch: ${code}.`,
    );
    this.name = "PrescribedKinematicsKnownRejectionError";
  }
}

export class PrescribedKinematicsRunExecutor implements ProjectRunExecutor {
  readonly #projects: PrescribedKinematicsRunExecutorDependencies["projects"];
  readonly #commands: PrescribedKinematicsRunExecutorDependencies["commands"];
  readonly #snapshots: PrescribedKinematicsRunThreadSnapshotStore;
  readonly #lease: EngineeringProjectRunLease;
  readonly #caseReview: ProjectPrescribedKinematicsCaseCaptureUseCase;
  readonly #captures: PrescribedKinematicsCaptureStore;
  readonly #plans?: ResolvedRunPlanReader;
  readonly #capabilityRuntime?: CapabilityRuntimeExecutionEligibility;
  readonly #capabilityRuntimeSession?: Pick<
    CapabilityRuntimeExecutionSessionCoordinator,
    "begin"
  >;
  readonly #chronoRuntime?:
    PrescribedKinematicsRunExecutorDependencies["chronoRuntime"];
  readonly #sealMethod: SealPrescribedKinematicsMethodUseCase;
  readonly #evaluate: EvaluatePrescribedKinematicsUseCase;
  readonly #decideCloseout: DecidePrescribedKinematicsCloseoutUseCase;
  readonly #uncertainWriterLifecycle: UncertainWriterLifecycleQualifier;

  constructor(dependencies: PrescribedKinematicsRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#lease = dependencies.lease;
    this.#caseReview = dependencies.caseReview;
    this.#captures = dependencies.captures;
    this.#plans = dependencies.plans;
    this.#capabilityRuntime = dependencies.capabilityRuntime;
    this.#capabilityRuntimeSession = dependencies.capabilityRuntimeSession;
    this.#chronoRuntime = dependencies.chronoRuntime;
    this.#sealMethod = dependencies.sealMethod;
    this.#evaluate = dependencies.evaluate;
    this.#decideCloseout = dependencies.decideCloseout;
    this.#uncertainWriterLifecycle = dependencies.uncertainWriterLifecycle ??
      closedUncertainWriterLifecycleQualifier;
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await requiredProject(this.#projects, command.projectId);
    const run = requireRun(project, command.runId);
    const operation = exactOperation(project, run);
    if (isL5(operation) ? origin.kind !== "human" : origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        isL5(operation)
          ? "Prescribed-kinematics L5 can execute only with a human origin."
          : "Prescribed-kinematics L1-L4 can execute only with an agent origin.",
      );
    }
    if (
      operation === VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION &&
      (!this.#plans || !this.#capabilityRuntime || !this.#capabilityRuntimeSession ||
        !this.#chronoRuntime)
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The registered prescribed-kinematics L3 operation requires the server's sealed runtime, plan, and host-session composition.",
      );
    }
    if (run.status === "completed") return project;
    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let capabilitySession: CapabilityRuntimeExecutionSession | undefined;
    let retainCapabilitySession = false;
    try {
      let project = await requiredProject(this.#projects, command.projectId);
      let run = requireRun(project, command.runId);
      const operation = exactOperation(project, run);
      await assertThreadWriteBasisAvailable(
        project,
        run,
        this.#uncertainWriterLifecycle,
      );
      const l3 = operation === VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION
        ? await this.#prepareL3(project, run)
        : undefined;
      if (l3) {
        // The session performs a second cold ROP/runtime recheck itself before
        // it may journal or start the trusted group.  This is deliberately
        // before `claimRun`, the Chrono WAL, case submission or provider call.
        capabilitySession = await this.#capabilityRuntimeSession!.begin({
          project,
          runId: run.id,
          operationalCapability: l3.authorization.capabilityRuntime!,
          microsandboxExecutionProfiles: [],
          secretSnapshot: l3.secretSnapshot,
          recheck: async () => {
            const fresh = await requiredProject(this.#projects, command.projectId);
            const authorization = await requireResolvedRunPlanExecution({
              project: fresh,
              runId: command.runId,
              expectedOperation: VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
              expectedRunStatuses: ["queued", "running", "publishing"],
              projects: this.#projects,
              snapshots: this.#snapshots,
              plans: this.#plans!,
              capabilityRuntime: this.#capabilityRuntime,
            });
            if (!authorization.capabilityRuntime) {
              throw new EngineeringProjectCommandError(
                "invalid_transition",
                "The sealed prescribed-kinematics run has no operational capability.",
              );
            }
            return authorization.capabilityRuntime;
          },
        });
      }
      if (run.status === "queued") {
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: step(command.commandId, "claim"),
          summary: `Started ${operation.id}@${operation.version}.`,
        });
        claimed = true;
      } else if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "queued, running, or publishing");
      }
      project = await requiredProject(this.#projects, command.projectId);
      run = requireRun(project, command.runId);
      const currentOperation = exactOperation(project, run);
      const basis = requireBasis(run);
      const base = await exactSnapshot(this.#snapshots, basis);
      const decision = await requiredHumanDecision(project, run, basis);
      const materialized = await this.#materialize({
        project,
        run,
        operation: currentOperation,
        basis,
        base,
        decision,
        l3,
      });
      const capturedAt = requiredStart(run);
      const consumer = producer(currentOperation, run.id);
      const consumptions = materialized.inputArtifacts.map((artifact) => ({
        id: `prescribed-kinematics-consume-${run.id}-${artifact.id}`,
        artifactId: artifact.id,
        consumer,
        observedFingerprint: artifact.fingerprint,
        verifiedAt: capturedAt,
        status: "verified" as const,
      }));
      const successor = applyThreadSnapshotExtensionIfNew(base, {
        id: `prescribed-kinematics-${run.id}`,
        name: materialized.name,
        subjectId: base.subject.id,
        capturedAt,
        artifacts: [materialized.artifact],
        consumptions,
        observations: [],
        requirements: [],
        evaluations: [],
        violations: [],
        provenance: attestedInputProvenance(
          run.id,
          materialized.artifact.id,
          consumptions,
        ),
        proposedActions: [],
      }, { appliedAt: capturedAt }).snapshot;
      await this.#snapshots.save(successor);
      const reread = await this.#snapshots.getFresh(successor.id);
      if (!reread || JSON.stringify(reread) !== JSON.stringify(successor)) {
        throw new Error(
          "The prescribed-kinematics Thread successor was not exactly readable.",
        );
      }
      project = await requiredProject(this.#projects, command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: step(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: `Publishing ${currentOperation.id}@${currentOperation.version}.`,
        });
      }
      project = await requiredProject(this.#projects, command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(
          origin,
          completion(command, project.revision, successor, materialized.artifact),
        );
      }
      const completed = await requiredProject(this.#projects, command.projectId);
      await capabilitySession?.releaseTerminal();
      return completed;
    } catch (error) {
      const uncertain = error instanceof PrescribedKinematicsUncertainOutcomeError;
      const knownRejected = error instanceof PrescribedKinematicsKnownRejectionError;
      if (uncertain) {
        retainCapabilitySession = true;
      }
      if (claimed || uncertain || knownRejected) {
        try {
          const project = await requiredProject(this.#projects, command.projectId);
          const run = requireRun(project, command.runId);
          if (run.status === "running") {
            await this.#commands.failRun(origin, {
              ...command,
              commandId: step(command.commandId, "fail"),
              expectedRevision: project.revision,
              summary: uncertain
                ? "Prescribed-kinematics Chrono outcome remains quarantined."
                : "Prescribed-kinematics execution did not materialize evidence.",
              code: uncertain
                ? VERIFY_RUN_PRESCRIBED_KINEMATICS_PROVIDER_OUTCOME_UNKNOWN_FAILURE
                : "prescribed-kinematics-execution-failed",
              message: error instanceof Error
                ? error.message.slice(0, 400)
                : "Unknown prescribed-kinematics execution error.",
            });
            if (!uncertain) {
              await capabilitySession?.releaseTerminal();
            }
          }
        } catch {
          // Preserve the original evidence/authority error.
          retainCapabilitySession = true;
        }
      }
      if (
        capabilitySession &&
        (retainCapabilitySession || !(claimed || knownRejected))
      ) {
        // No claimed or determined pre-dispatch terminal outcome means the
        // provider/WAL boundary cannot be inferred safe. Preserve the durable
        // lease for recovery.
        capabilitySession.retainForRecovery();
      }
      throw error;
    }
  }

  async #prepareL3(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<PreparedPrescribedKinematicsL3> {
    const authorization = await requireResolvedRunPlanExecution({
      project,
      runId: run.id,
      expectedOperation: VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
      expectedRunStatuses: ["queued", "running", "publishing"],
      projects: this.#projects,
      snapshots: this.#snapshots,
      plans: this.#plans!,
      capabilityRuntime: this.#capabilityRuntime,
    });
    if (authorization.plan.action.kind !== "prescribed-kinematics-observation") {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The sealed prescribed-kinematics ROP has no exact observation action.",
      );
    }
    const operationalCapability = authorization.capabilityRuntime;
    if (!operationalCapability) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The sealed prescribed-kinematics ROP has no operational capability.",
      );
    }
    const runtime = await runtimeProvenance(
      authorization.plan,
      operationalCapability,
    );
    const secretSnapshot = await this.#chronoRuntime!.secrets.beginSnapshot({
      group: runtime.launchGroup,
      slots: ["chrono-mcp-bearer-token"],
    });
    return {
      authorization,
      action: authorization.plan.action,
      runtime,
      secretSnapshot,
      observe: this.#chronoRuntime!.createObservation(secretSnapshot),
    };
  }

  async #materialize(input: {
    project: EngineeringProjectSnapshot;
    run: EngineeringAgentRun;
    operation: ExactOperation;
    basis: EngineeringThreadSnapshotBasis;
    base: ThreadSnapshot;
    decision: EngineeringDecision;
    l3?: PreparedPrescribedKinematicsL3;
  }): Promise<
    {
      readonly name: string;
      readonly artifact: ThreadArtifact;
      readonly inputArtifacts: readonly ThreadArtifact[];
    }
  > {
    const parameters = parameterMap(input.decision);
    if (input.operation === VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION) {
      let caseProposal;
      try {
        caseProposal = parsePrescribedKinematicsCaseProposalParameters(
          input.decision.proposal!.parameters,
        );
      } catch (error) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          error instanceof Error
            ? error.message
            : "The prescribed-kinematics L1 MRTR parameters are not the closed case grammar.",
        );
      }
      const captured = await this.#caseReview.capture({
        projectId: input.project.project.id,
        workspaceRevision: caseProposal.workspaceRevision,
        attachmentId: caseProposal.attachmentId,
        attachmentRevision: caseProposal.attachmentRevision,
      });
      if (captured.status !== "resolved") {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          captured.diagnostic.message,
        );
      }
      const ref = await this.#captures.saveCase(captured.sealedCase);
      return output(
        input,
        "case",
        "Prescribed kinematics case",
        ref.fingerprint,
        ref.uri,
        [],
      );
    }
    const l3 = input.operation === VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION
      ? input.l3
      : undefined;
    if (
      input.operation === VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION &&
      !l3
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The prescribed-kinematics L3 runtime preparation is absent.",
      );
    }
    // L3 consumes the exact Thread artifact named by its sealed ROP source
    // binding. Later stages derive their case artifact from their fixed prior
    // operation because they have no ROP action.
    const caseArtifact = l3
      ? requiredBoundArtifact(
        l3.authorization,
        l3.action.input.prescribedKinematicsCase.sourceBinding,
      )
      : inputArtifact(
        input.base,
        VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION,
      );
    const sealedCase = await required(
      this.#captures.readCase(caseArtifact.fingerprint),
      "The exact prescribed-kinematics case capture is absent.",
    );
    if (l3) {
      let runProposal;
      try {
        runProposal = parsePrescribedKinematicsRunProposalParameters(
          input.decision.proposal!.parameters,
        );
      } catch (error) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          error instanceof Error
            ? error.message
            : "The prescribed-kinematics L3 MRTR parameters are not the closed run grammar.",
        );
      }
      if (
        !fingerprintsEqual(
          runProposal.caseFingerprint,
          sealedCase.fingerprint,
        )
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          "The signed L3 caseFingerprint does not recross the ROP-bound prescribed-kinematics case.",
        );
      }
      // The run-to-request identity is already sealed by the exact ROP and
      // reread by `requireResolvedRunPlanExecution`.  Do not derive a second
      // local spelling from the run id: that would create a parallel request
      // identity convention and could reject a valid sealed plan.
      const caseForLowering = recrossResolvedPrescribedKinematicsCaseArtifact({
        action: l3.action,
        caseArtifact,
        sealedCase,
      });
      const result = await l3.observe.execute(
        prescribedKinematicsObservationCommandFromResolvedAction({
          action: l3.action,
          projectId: input.project.project.id,
          agentRunId: input.run.id,
          startedAt: requiredStart(input.run),
          runtime: l3.runtime,
          sealedCase: caseForLowering,
        }),
      );
      if (result.status !== "recorded") {
        if (result.status === "rejected") {
          throw new PrescribedKinematicsKnownRejectionError(result.code);
        }
        throw new PrescribedKinematicsUncertainOutcomeError(result.reason);
      }
      const ref = await this.#captures.saveObservation({
        schemaVersion: "prescribed-kinematics-observation-capture/4.0",
        observation: result.observation,
        request: result.request,
        receipt: result.receipt,
        providerNotEvaluated: result.providerNotEvaluated,
        digitalThreadLimits: result.observation.limits,
        lowering: result.lowering,
        runtime: l3.runtime,
      }, caseForLowering);
      return output(
        input,
        "observation",
        "Prescribed kinematics observation",
        ref.fingerprint,
        ref.uri,
        [caseArtifact],
      );
    }
    const observationArtifact = inputArtifact(
      input.base,
      VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
    );
    const observationCapture = await required(
      this.#captures.readObservation(observationArtifact.fingerprint, sealedCase),
      "The exact prescribed-kinematics observation capture is absent.",
    );
    if (input.operation === VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION) {
      const resourceRef = methodResource(parameters);
      const method = await this.#sealMethod.execute({
        sealedCase,
        observation: observationCapture.observation,
        resourceRef,
        signedResourceFingerprint: resourceRef.fingerprint,
      });
      const ref = await this.#captures.saveMethod(method);
      return output(
        input,
        "method",
        "Prescribed kinematics method",
        ref.fingerprint,
        ref.uri,
        [caseArtifact, observationArtifact],
      );
    }
    const methodArtifact = inputArtifact(
      input.base,
      VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION,
    );
    const method = await required(
      this.#captures.readMethod(methodArtifact.fingerprint),
      "The exact prescribed-kinematics method capture is absent.",
    );
    if (input.operation === VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION) {
      const evaluation = await this.#evaluate.execute({
        sealedCase,
        observation: observationCapture.observation,
        method,
      });
      const ref = await this.#captures.saveEvaluation(evaluation);
      return output(
        input,
        "evaluation",
        "Prescribed kinematics evaluation",
        ref.fingerprint,
        ref.uri,
        [caseArtifact, observationArtifact, methodArtifact],
      );
    }
    const evaluationArtifact = inputArtifact(
      input.base,
      VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION,
    );
    const evaluation = await required(
      this.#captures.readEvaluation(evaluationArtifact.fingerprint),
      "The exact prescribed-kinematics evaluation capture is absent.",
    );
    const consequence =
      input.operation === DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION
        ? "accept"
        : "reject";
    const candidate = (await prescribedKinematicsEvaluationCloseoutCandidates({
      evaluation,
      sealedCase,
      observation: observationCapture.observation,
      method,
    })).find((entry) => entry.consequence === consequence);
    if (!candidate) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "L5 accept is unavailable unless the exact L4 verdict is pass.",
      );
    }
    const closeout = await this.#decideCloseout.execute({
      origin: "human",
      projectId: input.project.project.id,
      subjectId: input.base.subject.id,
      basis: input.basis,
      candidate,
      sealedCase,
      observation: observationCapture.observation,
      method,
    });
    const ref = await this.#captures.saveCloseout(closeout);
    return output(
      input,
      "closeout",
      `Prescribed kinematics ${consequence} closeout`,
      ref.fingerprint,
      ref.uri,
      [caseArtifact, observationArtifact, methodArtifact, evaluationArtifact],
    );
  }
}

/**
 * Preserve the unique request identity already sealed on the ROP action.
 * This internal adapter deliberately does not derive a run-id based fallback.
 */
export function prescribedKinematicsObservationCommandFromResolvedAction(input: {
  readonly action: ResolvedPrescribedKinematicsObservationAction;
  readonly projectId: string;
  readonly agentRunId: string;
  readonly startedAt: string;
  readonly runtime: PrescribedKinematicsRuntimeProvenance;
  readonly sealedCase:
    import("../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-source-closure.ts").PrescribedKinematicsCase;
}): RunPrescribedKinematicsObservationCommand {
  return Object.freeze({
    projectId: input.projectId,
    agentRunId: input.agentRunId,
    requestId: input.action.requestId,
    startedAt: input.startedAt,
    runtime: input.runtime,
    sealedCase: input.sealedCase,
  });
}

/**
 * The ROP validator proves that `sourceBinding` names one sealed plan source;
 * `requireResolvedRunPlanExecution` then rereads the exact Thread artifact for
 * that binding. Re-cross the action identity against that artifact here. The
 * reopened domain case has a distinct source-case fingerprint and belongs only
 * to the lowerer and domain validators.
 */
export function recrossResolvedPrescribedKinematicsCaseArtifact(
  input: {
    readonly action: ResolvedPrescribedKinematicsObservationAction;
    readonly caseArtifact: ThreadArtifact;
    readonly sealedCase: PrescribedKinematicsCase;
  },
): PrescribedKinematicsCase {
  const caseIdentity = input.action.input.prescribedKinematicsCase;
  if (
    caseIdentity.id !== input.caseArtifact.id ||
    !fingerprintsEqual(
      caseIdentity.fingerprint,
      input.caseArtifact.fingerprint,
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The sealed prescribed-kinematics ROP does not bind the exact Thread case artifact.",
    );
  }
  return input.sealedCase;
}

async function runtimeProvenance(
  plan: ResolvedOperationPlanV2,
  operationalCapability: ResolvedCapabilityRuntimeOperation,
): Promise<PrescribedKinematicsRuntimeProvenance> {
  const bindings = operationalCapability.bindings.filter((binding) =>
    binding.capability.id === "mechanics.observe-prescribed-kinematics" &&
    binding.capability.version === "1" && binding.capability.use === "execution"
  );
  if (bindings.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The sealed prescribed-kinematics operational capability has no unique mechanics binding.",
    );
  }
  const binding = bindings[0]!;
  if (binding.materials.length !== 1 || binding.hostLifecycles.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The sealed prescribed-kinematics binding must have one exact runtime material and lifecycle.",
    );
  }
  const material = binding.materials[0]!;
  const lifecycle = binding.hostLifecycles[0]!;
  const expectedLaunchGroup = await firstPartyChronoLaunchGroupReference();
  const expectedImageDigest = MCP_CHRONO_032_IMAGE_REFERENCE.slice(
    MCP_CHRONO_032_IMAGE_REFERENCE.lastIndexOf("@sha256:") + "@sha256:".length,
  );
  if (
    binding.binding.id !== "chrono-prescribed-kinematics" ||
    binding.binding.version !== "1" ||
    binding.adapter.id !== "chrono-prescribed-kinematics-adapter" ||
    binding.adapter.version !== "0.3.2" ||
    binding.adapter.source !==
      "src/adapters/mechanics/chrono/chrono-prescribed-kinematics-client.ts" ||
    binding.profile !== null ||
    material.unitId !== "casys.mcp-chrono" ||
    material.materialId !== "mcp-chrono-image" ||
    material.imageDigest !== expectedImageDigest ||
    !sameRuntimeMaterial(material, lifecycle.material) ||
    lifecycle.kind !== "persistent-compose" || lifecycle.launchGroup === null ||
    !sameCapabilityRuntimeLaunchGroupReference(
      lifecycle.launchGroup,
      expectedLaunchGroup,
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The sealed prescribed-kinematics binding does not reference the exact enrolled Chrono runtime identity.",
    );
  }
  return Object.freeze({
    resolvedOperationPlanFingerprint: await fingerprintResolvedOperationPlanV2(plan),
    operationalCapabilityFingerprint:
      await fingerprintResolvedCapabilityRuntimeOperation(
        operationalCapability,
      ),
    binding: { ...binding.binding },
    adapter: { ...binding.adapter },
    // The enrolled Chrono binding deliberately has no separate profile.  The
    // guard above keeps that literal null fact tied to the sealed binding.
    profile: null,
    material: { ...material },
    launchGroup: structuredClone(lifecycle.launchGroup),
    // The mode comes from the exact sealed/rechecked capability binding, never
    // from the controller process architecture or a provider assertion.
    platformMode: exactPrescribedKinematicsRuntimeMode(
      binding.runtimeModes,
      material,
    ),
  });
}

/**
 * Select the one host-qualified mode sealed for the exact Chrono material.
 *
 * This is deliberately fail-closed rather than treating a missing mode as an
 * unavailable execution: an L3 run reaches this point only after runtime
 * admission has established the exact qualified material.
 */
export function exactPrescribedKinematicsRuntimeMode(
  runtimeModes: readonly CapabilityRuntimeMaterialRuntimeMode[],
  material: CapabilityRuntimeMaterialIdentity,
): CapabilityRuntimeExecutionMode {
  const matches = runtimeModes.filter((candidate) =>
    sameRuntimeMaterial(candidate.material, material)
  );
  if (matches.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The sealed prescribed-kinematics binding must have one exact qualified runtime mode for its material.",
    );
  }
  return matches[0]!.mode;
}

function sameRuntimeMaterial(
  left: {
    readonly unitId: string;
    readonly materialId: string;
    readonly imageDigest: string;
  },
  right: {
    readonly unitId: string;
    readonly materialId: string;
    readonly imageDigest: string;
  },
): boolean {
  return left.unitId === right.unitId && left.materialId === right.materialId &&
    left.imageDigest === right.imageDigest;
}

function exactOperation(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): ExactOperation {
  const operation = project.workItems.find((item) => item.id === run.workItemId)
    ?.operation;
  const operations = [
    VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION,
    VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
    VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION,
    VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION,
    DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
    DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
  ] as const;
  const exact = operations.find((candidate) =>
    candidate.id === operation?.id && candidate.version === operation.version
  );
  if (!exact) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor accepts only one exact prescribed-kinematics operation.",
    );
  }
  return exact;
}
function isL5(operation: ExactOperation): boolean {
  return operation === DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION ||
    operation === DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION;
}
async function requiredHumanDecision(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  basis: EngineeringThreadSnapshotBasis,
): Promise<EngineeringDecision> {
  const work = project.workItems.find((item) => item.id === run.workItemId);
  const candidates = (work?.decisionIds ?? []).map((id) =>
    project.decisions.find((decision) => decision.id === id)
  ).filter((decision): decision is EngineeringDecision =>
    Boolean(
      decision?.proposal && decision.status === "approved" &&
        decision.baseSnapshot?.snapshotId === basis.snapshotId &&
        decision.baseSnapshot.revision === basis.revision &&
        decision.baseSnapshot.subjectId === basis.subjectId,
    )
  );
  if (candidates.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Prescribed-kinematics execution requires one exact approved human MRTR decision on its run basis.",
    );
  }
  const approvals = project.approvals.filter((approval) =>
    approval.decisionId === candidates[0]!.id && approval.status === "approved" &&
    approval.decidedByOrigin === "human"
  );
  const decision = candidates[0]!;
  const approval = approvals[0];
  if (
    approvals.length !== 1 || !approval || !decision.inputFingerprint ||
    !approval.baseSnapshot || approval.baseSnapshot.snapshotId !== basis.snapshotId ||
    approval.baseSnapshot.revision !== basis.revision ||
    approval.baseSnapshot.subjectId !== basis.subjectId ||
    deterministicJson(approval.inputEvidenceRefs) !==
      deterministicJson(decision.inputEvidenceRefs) ||
    !fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint)
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Prescribed-kinematics execution requires one human MRTR approval bound to the exact project Thread basis and evidence.",
    );
  }
  const expectedFingerprint = await sha256Fingerprint({
    baseSnapshot: decision.baseSnapshot,
    inputEvidenceRefs: decision.inputEvidenceRefs,
    proposal: {
      summary: decision.proposal!.summary,
      parameters: decision.proposal!.parameters,
    },
  });
  if (!fingerprintsEqual(expectedFingerprint, decision.inputFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The prescribed-kinematics MRTR fingerprint does not seal its exact basis, evidence, and parameters.",
    );
  }
  return decision;
}
async function exactSnapshot(
  store: PrescribedKinematicsRunThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await store.getFresh(basis.snapshotId);
  if (
    !snapshot || snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The exact prescribed-kinematics Thread basis is unavailable.",
    );
  }
  return snapshot;
}
function inputArtifact(
  base: ThreadSnapshot,
  operation: ExactOperation,
): ThreadArtifact {
  const matches = base.artifacts.filter((artifact) =>
    artifact.producer.tool === `${operation.id}@${operation.version}`
  );
  if (matches.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `The basis must contain exactly one ${operation.id}@${operation.version} artifact.`,
    );
  }
  return matches[0]!;
}

function requiredBoundArtifact(
  authorization: ResolvedRunPlanExecutionAuthorization,
  binding: string,
): ThreadArtifact {
  const artifact = authorization.artifactsByBinding.get(binding);
  if (!artifact) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `The sealed prescribed-kinematics ROP source ${binding} is absent.`,
    );
  }
  return artifact;
}
async function required<T>(value: Promise<T | undefined>, message: string): Promise<T> {
  const resolved = await value;
  if (!resolved) {
    throw new EngineeringProjectCommandError("invalid_transition", message);
  }
  return resolved;
}
function parameterMap(
  decision: EngineeringDecision,
): ReadonlyMap<string, string | number | boolean> {
  const values = decision.proposal!.parameters;
  const map = new Map(values.map((entry) => [entry.key, entry.value]));
  if (map.size !== values.length) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "Prescribed-kinematics MRTR parameters contain duplicate keys.",
    );
  }
  return map;
}
function text(
  values: ReadonlyMap<string, string | number | boolean>,
  key: string,
): string {
  const value = values.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Prescribed-kinematics MRTR parameter ${key} is required.`,
    );
  }
  return value;
}
function positive(
  values: ReadonlyMap<string, string | number | boolean>,
  key: string,
): number {
  const value = values.get(key);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Prescribed-kinematics MRTR parameter ${key} must be a positive integer.`,
    );
  }
  return value;
}
function methodResource(
  values: ReadonlyMap<string, string | number | boolean>,
): AgentResourceReference {
  const digest = text(values, "methodResourceSha256");
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "methodResourceSha256 must be a lowercase SHA-256 digest.",
    );
  }
  const representation = text(values, "methodResourceRepresentation");
  if (representation !== "text" && representation !== "blob") {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "methodResourceRepresentation must be text or blob.",
    );
  }
  return {
    schemaVersion: "agent-resource-capture/1.0",
    uri: text(values, "methodResourceUri"),
    name: text(values, "methodResourceName"),
    mimeType: text(values, "methodResourceMimeType"),
    representation,
    byteCount: positive(values, "methodResourceByteCount"),
    fingerprint: { algorithm: "sha256", digest },
  };
}
function producer(operation: ExactOperation, runId: string) {
  return {
    serverId: "digital-thread",
    tool: `${operation.id}@${operation.version}`,
    runId,
  } as const;
}

/** One derived_from and one uses link per verified input; ids include run and artifact. */
function attestedInputProvenance(
  runId: string,
  outputArtifactId: string,
  consumptions: readonly { readonly id: string; readonly artifactId: string }[],
): ThreadProvenanceLink[] {
  return consumptions.flatMap((consumption) => [
    {
      id: `prescribed-kinematics-derived-from-${runId}-${consumption.artifactId}`,
      relation: "derived_from",
      from: { kind: "artifact", id: outputArtifactId },
      to: { kind: "artifact", id: consumption.artifactId },
      rationale: "The captured evidence is derived from this exact consumed artifact.",
    },
    {
      id: `prescribed-kinematics-uses-${runId}-${consumption.artifactId}`,
      relation: "uses",
      from: { kind: "consumption", id: consumption.id },
      to: { kind: "artifact", id: consumption.artifactId },
      rationale:
        "The verified consumption attests this exact consumed artifact fingerprint.",
    },
  ]);
}
function output(
  input: { readonly run: EngineeringAgentRun; readonly operation: ExactOperation },
  lane: string,
  name: string,
  fingerprint: ContentFingerprint,
  uri: string,
  inputArtifacts: readonly ThreadArtifact[],
) {
  const artifact: ThreadArtifact = {
    id: `prescribed-kinematics-${lane}-${fingerprint.digest}`,
    name,
    kind: "evidence",
    version: "1",
    fingerprint,
    uri,
    mediaType: "application/json",
    producer: producer(input.operation, input.run.id),
    inputArtifactIds: inputArtifacts.map((artifact) => artifact.id),
    freshness: {
      status: "fresh",
      changedAt: requiredStart(input.run),
      invalidatedByChangeIds: [],
    },
  };
  return { name, artifact, inputArtifacts };
}
function completion(
  command: RegisteredProjectRunExecutorCommand,
  revision: number,
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): CompleteRunCommand {
  return {
    ...command,
    commandId: step(command.commandId, "complete"),
    expectedRevision: revision,
    summary: "Captured prescribed-kinematics evidence.",
    resultSnapshot: snapshotRef(snapshot),
    evidenceRefs: [{
      snapshotId: snapshot.id,
      snapshotRevision: snapshot.revision,
      kind: "artifact",
      id: artifact.id,
    }],
  };
}
function step(commandId: string, phase: string): string {
  return `${commandId}:prescribed-kinematics:${phase}`;
}
async function requiredProject(
  projects: Pick<EngineeringProjectRevisionStore, "get">,
  projectId: string,
): Promise<EngineeringProjectSnapshot> {
  const project = await projects.get(projectId);
  if (!project) {
    throw new EngineeringProjectCommandError(
      "project_not_found",
      `Project ${projectId} was not found.`,
    );
  }
  return project;
}
