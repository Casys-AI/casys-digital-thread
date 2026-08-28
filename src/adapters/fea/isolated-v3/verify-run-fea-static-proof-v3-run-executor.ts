/**
 * Product executor for the provider-free `verify.run-fea-static-proof@3` path.
 *
 * The outer WAL separates the one local microVM solve from the one SysON
 * evaluation and the immutable Thread publication.  Recovery follows durable
 * identities only: neither call is repeated after its dispatch outcome became
 * ambiguous.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { CalculixIsolatedExecutionEvidenceStore } from "../../../application/ports/out/fea/isolated-v3/calculix-isolated-execution-evidence-store.ts";
import type {
  CalculixIsolatedExecutionProfile,
  CalculixIsolatedExecutionProfileCatalog,
} from "../../../application/ports/out/fea/isolated-v3/calculix-isolated-execution-profile.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import {
  type ExecuteIsolatedCalculixStaticProof,
  IsolatedCalculixOutputValidationRejectedError,
  IsolatedCalculixRedispatchExhaustedError,
} from "../../../application/use-cases/fea/isolated-v3/execute-isolated-calculix-static-proof.ts";
import { IsolatedCodeExecutionRejectedError } from "../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import {
  assertFailedIsolatedOutputValidationReplay,
  ISOLATED_OUTPUT_VALIDATION_FAILED_CODE,
  isolatedOutputValidationFailedMessage,
} from "../../../application/use-cases/compile/isolation/failed-isolated-output-validation-replay.ts";
import {
  assertCompletedIsolatedStaticProofProjectBinding,
  assertCompletedIsolatedStaticProofProjectReference,
  assertCompletedIsolatedStaticProofSnapshot,
  assertIsolatedCanonicalStepBytes,
  assertIsolatedStaticProofAttemptMatches,
  assertIsolatedStaticProofCrossAttests,
  assertIsolatedStaticProofEvidenceMatches,
  assertIsolatedStaticProofProfileBinding,
  exactIsolatedStaticProofEvidenceRefs,
  isolatedStaticProofLocalOperation,
  isolatedStaticProofPreparedIdentity,
  requireCompletedIsolatedStaticProofRunWal,
  requireCompletedIsolatedStaticProofWal,
  requireIsolatedStaticStructuralAction,
  type StaticProofPreparedEvidenceIdentity,
} from "../../../application/use-cases/fea/isolated-v3/completed-replay-verification.ts";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type CalculixIsolatedExecutionEvidence,
  type CalculixIsolatedInputBundle,
  createCalculixIsolatedInputBundle,
} from "../../../domain/fea/isolated-v3/calculix-isolated-execution.ts";
import {
  fingerprintResolvedOperationPlanV2,
  type ResolvedCalculixIsolatedStaticStructuralAction,
} from "../../../domain/compile/rop/resolved-operation-plan-v2.ts";
import type { MechanicalProofCase } from "../../../domain/fea/seal-case/mechanical-proof-case.ts";
import {
  parseSealedStaticProofCapture,
  type SealedStaticProofCapture,
} from "../../../domain/fea/isolated-v3/sealed-static-proof-capture.ts";
import { buildStaticProofSuccessor } from "../../../domain/fea/isolated-v3/static-proof-thread-evidence.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringAgentRunStatus,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import type { ResolvedRunPlanReader } from "../../../domain/project/resolved-run-plan-sealer.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import {
  buildOracleValues,
  callCapturedFeaConstraintOracle,
  parseCapturedFeaConstraintOracleOutcome,
  prepareFeaConstraintOracleCall,
} from "./fea-oracle-adapter.ts";
import {
  canonicalFeaSysonEvaluationCaptureText,
  FEA_SYSON_EVALUATION_CAPTURE_SCHEMA,
  validateFeaSysonEvaluationCapture,
} from "./fea-syson-evaluation-capture.ts";
import type { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import type { CanonicalAssetReader } from "../../../application/ports/out/canonical-asset-reader.ts";
import type { CapabilityRuntimeExecutionEligibility } from "../../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type {
  CapabilityRuntimeExecutionSessionCoordinator,
} from "../../../application/control-plane/capability-runtime-execution-session.ts";
import {
  requireResolvedRunPlanExecution,
  type ResolvedRunPlanExecutionAuthorization,
} from "../../compile/plans/resolved-run-plan-execution-guard.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import {
  assertThreadSnapshotLineageIntact,
  threadSnapshotDescendsFrom,
} from "../../shared/stores/thread-snapshot-lineage.ts";
import {
  type CalculixIsolatedProductAttempt,
  type CalculixIsolatedProductCasReference,
  FileCalculixIsolatedProductAttemptStore,
} from "./file-calculix-isolated-product-attempt-store.ts";
import {
  requiredStart,
  requireRun,
  snapshotRef,
} from "../../shared/executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "../../shared/thread-write-basis-guard.ts";
import { VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION } from "../../../orchestration/operations/fea-isolated-static-proof.ts";

export interface VerifyRunFeaStaticProofV3RunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface VerifyRunFeaStaticProofV3RunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly plans: ResolvedRunPlanReader;
  readonly artifacts: {
    readArtifact(artifact: Readonly<ThreadArtifact>): Promise<
      | {
        readonly uri: string;
        readonly mediaType: string;
        readonly byteCount: number;
        readonly sha256: string;
        readonly bytes: Uint8Array;
      }
      | undefined
    >;
  };
  readonly canonicalAssets: CanonicalAssetReader;
  readonly profiles: CalculixIsolatedExecutionProfileCatalog;
  readonly executeIsolated: Pick<
    ExecuteIsolatedCalculixStaticProof,
    "execute" | "reopenOutputValidationRejection"
  >;
  readonly executionEvidence: CalculixIsolatedExecutionEvidenceStore;
  readonly sysonEvaluationCaptureStore: Pick<
    FileByteStore<"calculix-isolated-syson-evaluation">,
    "read" | "save" | "uriFor"
  >;
  readonly attempts: FileCalculixIsolatedProductAttemptStore;
  readonly syson: McpToolClient;
  readonly lease: EngineeringProjectRunLease;
  /**
   * Server-owned operational envelope recheck. An absent implementation is
   * fail-closed by the ROP guard; the executor never contacts the microVM
   * before this seam has admitted the exact queued binding.
   */
  readonly capabilityRuntime?: CapabilityRuntimeExecutionEligibility;
  /** JIT host session. It is entered only after the final cold ROP recheck and
   * before this executor can claim its run/WAL boundary. */
  readonly capabilityRuntimeSession?: Pick<
    CapabilityRuntimeExecutionSessionCoordinator,
    "begin"
  >;
  readonly now?: () => string;
}

interface Prepared {
  readonly authorization: ResolvedRunPlanExecutionAuthorization;
  readonly action: ResolvedCalculixIsolatedStaticStructuralAction;
  readonly proof: SealedStaticProofCapture;
  readonly proofArtifact: ThreadArtifact;
  readonly geometryArtifact: ThreadArtifact;
  readonly requirementsArtifact: ThreadArtifact;
  readonly stepBytes: Uint8Array;
  readonly profile: CalculixIsolatedExecutionProfile;
  readonly bundle: CalculixIsolatedInputBundle;
  readonly planFingerprint: ContentFingerprint;
  readonly executionRunId: string;
  readonly identity: StaticProofPreparedEvidenceIdentity;
}

interface DurableEvaluation {
  readonly reference: CalculixIsolatedProductCasReference;
  readonly outcomes: ReturnType<typeof parseCapturedFeaConstraintOracleOutcome>;
  readonly evaluationDispatchedAt: string;
}

export class CalculixIsolatedProductOutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalculixIsolatedProductOutcomeUnknownError";
  }
}

export async function deriveCalculixIsolatedExecutionRunId(input: {
  readonly projectId: string;
  readonly agentRunId: string;
}): Promise<string> {
  const fingerprint = await sha256Fingerprint({
    schemaVersion: "calculix-isolated-execution-run-id/1.0",
    operation: VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
    projectId: input.projectId,
    agentRunId: input.agentRunId,
  });
  return `calculix-isolated-${fingerprint.digest}`;
}

function requiredBoundArtifact(
  authorization: ResolvedRunPlanExecutionAuthorization,
  binding: string,
): ThreadArtifact {
  const artifact = authorization.artifactsByBinding.get(binding);
  if (!artifact) {
    throw commandError(
      "invalid_transition",
      `Resolved plan source ${binding} is absent.`,
    );
  }
  return artifact;
}

function requiredBasisArtifact(
  basis: ThreadSnapshot,
  id: string,
): ThreadArtifact {
  const matches = basis.artifacts.filter((artifact) => artifact.id === id);
  if (matches.length !== 1) {
    throw commandError(
      "invalid_transition",
      `Exact basis artifact ${id} is absent or ambiguous.`,
    );
  }
  return matches[0]!;
}

function requiredSource(
  authorization: ResolvedRunPlanExecutionAuthorization,
  binding: string,
) {
  const source = authorization.plan.sources.find((candidate) =>
    candidate.bindingName === binding
  );
  if (!source) {
    throw commandError(
      "invalid_transition",
      `Resolved plan source ${binding} is absent.`,
    );
  }
  return source;
}

function casReference(value: {
  readonly uri: string;
  readonly byteCount: number;
  readonly fingerprint: ContentFingerprint;
}): CalculixIsolatedProductCasReference {
  if (
    value.fingerprint.algorithm !== "sha256" ||
    !value.uri.endsWith(`/sha256/${value.fingerprint.digest}`)
  ) {
    throw commandError(
      "invalid_transition",
      "The evaluation save receipt is not an exact local CAS object.",
    );
  }
  return {
    uri: value.uri,
    byteCount: value.byteCount,
    sha256: value.fingerprint.digest,
  };
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw commandError("invalid_transition", `${label} is not exact UTF-8.`);
  }
}

async function requiredProject(
  projects: EngineeringProjectRevisionStore,
  projectId: string,
): Promise<EngineeringProjectSnapshot> {
  const project = await projects.get(projectId);
  if (!project) {
    throw commandError(
      "project_not_found",
      `Engineering project ${projectId} does not exist.`,
    );
  }
  return project;
}

async function assertSnapshotReadback(
  store: ThreadSnapshotStore,
  snapshot: ThreadSnapshot,
): Promise<void> {
  const reread = await store.get(snapshot.id);
  if (!reread || deterministicJson(reread) !== deterministicJson(snapshot)) {
    throw new Error("The isolated CalculiX ThreadSnapshot was not durably reread.");
  }
}

function commandError(
  code: ConstructorParameters<typeof EngineeringProjectCommandError>[0],
  message: string,
): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError(code, message);
}

function throwDomain(cause: unknown): never {
  if (cause instanceof TypeError) {
    throw commandError("invalid_transition", cause.message);
  }
  throw cause;
}

function describe(cause: unknown): string {
  const text = cause instanceof Error
    ? `${cause.name}: ${cause.message}`
    : String(cause);
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

const CALCULIX_ISOLATED_OUTPUT_VALIDATION_FAILED = {
  summary:
    "Isolated CalculiX output validation was rejected before Thread publication.",
  code: ISOLATED_OUTPUT_VALIDATION_FAILED_CODE,
} as const;

function isolatedExecutionRejectionMessage(
  error: IsolatedCodeExecutionRejectedError,
): string {
  const termination = error.diagnostic.termination;
  const outcome = termination.kind === "exited"
    ? `exited ${termination.exitCode}`
    : termination.kind;
  const excerpt = error.diagnostic.logs.stderr.excerpt.trim() ||
    error.diagnostic.logs.stdout.excerpt.trim();
  const text = excerpt.length === 0
    ? `Isolated execution was rejected (${outcome}).`
    : `Isolated execution was rejected (${outcome}): ${excerpt}`;
  return describe(text);
}

export class VerifyRunFeaStaticProofV3RunExecutor {
  readonly #now: () => string;

  constructor(private readonly d: VerifyRunFeaStaticProofV3RunExecutorDependencies) {
    this.#now = d.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyRunFeaStaticProofV3RunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw commandError(
        "permission_denied",
        "Only an authenticated agent may execute an isolated CalculiX run.",
      );
    }
    const project = await requiredProject(this.d.projects, command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status === "completed") {
      return await this.#reopenCompleted(project, command);
    }
    if (run.status === "failed") {
      return await this.#reopenFailedOutputValidation(origin, command, project);
    }

    const prepared = await this.#prepare(project, command.runId, [
      "queued",
      "running",
      "publishing",
    ]);
    return await this.d.lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(prepared.authorization.run),
      async () => await this.#executeLeased(origin, command),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyRunFeaStaticProofV3RunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let project = await requiredProject(this.d.projects, command.projectId);
    const before = requireRun(project, command.runId);
    if (before.status === "completed") {
      return await this.#reopenCompleted(project, command);
    }
    if (before.status === "failed") {
      return await this.#reopenFailedOutputValidation(origin, command, project);
    }
    let prepared = await this.#prepare(project, command.runId, [
      "queued",
      "running",
      "publishing",
    ]);
    await assertThreadWriteBasisAvailable(project, prepared.authorization.run);
    await assertThreadSnapshotLineageIntact(
      prepared.authorization.basis,
      this.d.snapshots,
    );

    // A terminal replay is always cold. The outer check protects the common
    // path; this second check closes the race while the project lease waited.
    project = await requiredProject(this.d.projects, command.projectId);
    const beforeSession = requireRun(project, command.runId);
    if (beforeSession.status === "completed") {
      return await this.#reopenCompleted(project, command);
    }
    if (beforeSession.status === "failed") {
      return await this.#reopenFailedOutputValidation(origin, command, project);
    }
    // The project lease can wait behind a writer. Re-open the exact current
    // snapshot and recompute every sealed source immediately before JIT so a
    // stale prepare cannot observe/acquire a host for superseded work.
    prepared = await this.#prepare(project, command.runId, [
      "queued",
      "running",
      "publishing",
    ]);
    await assertThreadWriteBasisAvailable(project, prepared.authorization.run);
    await assertThreadSnapshotLineageIntact(
      prepared.authorization.basis,
      this.d.snapshots,
    );

    const operationalCapability = prepared.authorization.capabilityRuntime;
    if (
      !operationalCapability || !this.d.capabilityRuntimeSession ||
      !this.d.capabilityRuntime
    ) {
      throw commandError(
        "invalid_transition",
        "Isolated CalculiX execution requires the configured JIT capability runtime session before a run can be claimed.",
      );
    }
    const microsandboxLifecycles = operationalCapability.bindings.flatMap((binding) =>
      binding.hostLifecycles.filter((lifecycle) =>
        lifecycle.kind === "ephemeral-microsandbox"
      )
    );
    if (microsandboxLifecycles.length !== 1) {
      throw commandError(
        "invalid_transition",
        "Isolated CalculiX execution requires exactly one sealed Microsandbox material before host activation.",
      );
    }
    // The session performs one more cold supervisor comparison immediately
    // before any host observation/mutation. This is deliberately after the
    // final #prepare and before claimRun, so a failed host leaves no WAL,
    // SysON or provider dispatch and no project lifecycle mutation.
    const capabilitySession = await this.d.capabilityRuntimeSession.begin({
      project,
      runId: command.runId,
      operationalCapability,
      microsandboxExecutionProfiles: [{
        material: microsandboxLifecycles[0]!.material,
        executionProfileFingerprint: prepared.profile.profileFingerprint,
      }],
      recheck: async () => {
        const rechecked = await this.d.capabilityRuntime!.requireExecution({
          project,
          run: prepared.authorization.run,
          workItem: prepared.authorization.workItem,
          operation: prepared.authorization.workItem.operation!,
        });
        if (!rechecked) {
          throw commandError(
            "invalid_transition",
            "Isolated CalculiX execution lost its required operational capability binding before host activation.",
          );
        }
        return rechecked;
      },
    });
    const terminal = async (result: EngineeringProjectSnapshot) => {
      await capabilitySession.releaseTerminal();
      return result;
    };

    if (prepared.authorization.run.status === "queued") {
      try {
        await this.d.commands.claimRun(origin, {
          ...command,
          commandId: `${command.commandId}:claim`,
          summary: "Started the isolated local CalculiX static-structural run.",
        });
      } catch (error) {
        if (error instanceof EngineeringProjectCommandError) {
          await capabilitySession.releaseTerminal();
        } else {
          capabilitySession.retainForRecovery();
        }
        throw error;
      }
    }
    project = await requiredProject(this.d.projects, command.projectId);
    const claimedRun = requireRun(project, command.runId);
    if (claimedRun.status === "completed") {
      return await terminal(await this.#reopenCompleted(project, command));
    }
    if (claimedRun.status === "failed") {
      return await terminal(
        await this.#reopenFailedOutputValidation(origin, command, project),
      );
    }
    if (claimedRun.status !== "running" && claimedRun.status !== "publishing") {
      throw commandError(
        "invalid_transition",
        `Isolated CalculiX run ${claimedRun.id} is not executable.`,
      );
    }
    prepared = await this.#prepare(project, command.runId, [
      "running",
      "publishing",
    ]);
    const startedAt = requiredStart(claimedRun);

    let attempt = await this.d.attempts.begin({
      projectId: command.projectId,
      runId: command.runId,
      planSha256: prepared.planFingerprint.digest,
      executionRunId: prepared.executionRunId,
      bundleSha256: prepared.bundle.fingerprint.digest,
      profileSha256: prepared.profile.profileFingerprint.digest,
      preparedAt: this.#now(),
    });
    if (attempt.status === "completed") {
      return await terminal(
        await this.#finishSnapshot(origin, command, prepared, attempt),
      );
    }

    let evidence: CalculixIsolatedExecutionEvidence;
    try {
      evidence = attempt.status === "prepared"
        ? await this.#executeAndRecord(prepared, startedAt)
        : await this.#readEvidence(prepared, attempt);
    } catch (error) {
      if (error instanceof IsolatedCodeExecutionRejectedError) {
        return await terminal(await this.#failRejected(origin, command, error));
      }
      if (error instanceof IsolatedCalculixOutputValidationRejectedError) {
        return await terminal(
          await this.#failOutputValidationRejected(
            origin,
            command,
            error,
            prepared.executionRunId,
          ),
        );
      }
      if (error instanceof IsolatedCalculixRedispatchExhaustedError) {
        return await terminal(await this.#failExhausted(origin, command, error));
      }
      capabilitySession.retainForRecovery();
      throw error;
    }
    attempt = await this.d.attempts.recordEvidence({
      projectId: command.projectId,
      runId: command.runId,
      evidenceSha256: evidence.fingerprint.digest,
    });

    const evaluation = await this.#ensureEvaluation(prepared, evidence, attempt);
    const snapshot = this.#materializeSnapshot(prepared, evidence, evaluation);
    await this.d.snapshots.save(snapshot);
    await assertSnapshotReadback(this.d.snapshots, snapshot);
    await this.d.attempts.complete({
      projectId: command.projectId,
      runId: command.runId,
      snapshot: snapshotRef(snapshot),
    });
    const completed = await this.d.attempts.read(command.projectId, command.runId);
    if (!completed) throw new Error("The isolated CalculiX product WAL disappeared.");
    return await terminal(
      await this.#finishSnapshot(origin, command, prepared, completed),
    );
  }

  async #prepare(
    project: EngineeringProjectSnapshot,
    runId: string,
    statuses: readonly [
      EngineeringAgentRunStatus,
      ...EngineeringAgentRunStatus[],
    ],
  ): Promise<Prepared> {
    const authorization = await requireResolvedRunPlanExecution({
      project,
      runId,
      expectedOperation: VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
      expectedRunStatuses: statuses,
      projects: this.d.projects,
      snapshots: this.d.snapshots,
      plans: this.d.plans,
      capabilityRuntime: this.d.capabilityRuntime,
    });
    const action = requireIsolatedStaticStructuralAction(
      authorization.plan.action,
    );
    const profile = await this.d.profiles.initial();
    assertIsolatedStaticProofProfileBinding(action, profile);

    const proofArtifact = requiredBoundArtifact(
      authorization,
      action.input.proofCase.sourceBinding,
    );
    const geometryArtifact = requiredBoundArtifact(
      authorization,
      action.input.geometrySourceBinding,
    );
    const proof = await this.#readProofCapture(
      proofArtifact,
      requiredSource(authorization, action.input.proofCase.sourceBinding).artifact
        .byteCount,
    );
    const requirementsArtifact = requiredBasisArtifact(
      authorization.basis,
      proof.requirements.id,
    );
    const proofGeometryArtifact = requiredBasisArtifact(
      authorization.basis,
      proof.geometry.id,
    );
    assertIsolatedStaticProofCrossAttests({
      projectId: authorization.plan.run.projectId,
      subjectId: authorization.basis.subject.id,
      action,
      proof,
      proofArtifact,
      step: geometryArtifact,
      geometry: proofGeometryArtifact,
      requirements: requirementsArtifact,
    });
    await this.#readExactArtifact(
      requirementsArtifact,
      undefined,
      "Requirements capture",
    );
    const declaredBase = await this.d.snapshots.get(
      proof.case.project.baseThreadSnapshot.id,
    );
    if (
      !declaredBase ||
      declaredBase.id !== proof.case.project.baseThreadSnapshot.id ||
      declaredBase.revision !== proof.case.project.baseThreadSnapshot.revision ||
      declaredBase.subject.id !== proof.case.project.baseThreadSnapshot.subjectId ||
      !await threadSnapshotDescendsFrom(
        authorization.basis,
        validateThreadSnapshot(declaredBase),
        this.d.snapshots,
      )
    ) {
      throw commandError(
        "invalid_transition",
        "The proof-case base ThreadSnapshot is not an exact run-basis ancestor.",
      );
    }

    const stepBytes = await this.d.canonicalAssets.read(
      geometryArtifact.fingerprint.digest,
    );
    const stepSource = requiredSource(
      authorization,
      action.input.geometrySourceBinding,
    );
    assertIsolatedCanonicalStepBytes({
      stepByteLength: stepBytes.byteLength,
      sourceByteCount: stepSource.artifact.byteCount,
      proofStepBytes: proof.step.bytes,
      stepSha256: await fingerprintResourceBytes(stepBytes),
      geometryDigest: geometryArtifact.fingerprint.digest,
    });
    const bundle = await createCalculixIsolatedInputBundle({
      requestId: action.requestId,
      proof: proof.case,
      stepBytes,
      elementOrder: action.input.effectiveElementOrder,
      timeoutMs: action.input.effectiveTimeoutMs,
    });
    const planFingerprint = await fingerprintResolvedOperationPlanV2(
      authorization.plan,
    );
    const executionRunId = await deriveCalculixIsolatedExecutionRunId({
      projectId: project.project.id,
      agentRunId: authorization.run.id,
    });
    return {
      authorization,
      action,
      proof,
      proofArtifact,
      geometryArtifact,
      requirementsArtifact,
      stepBytes: Uint8Array.from(stepBytes),
      profile,
      bundle,
      planFingerprint,
      executionRunId,
      identity: isolatedStaticProofPreparedIdentity({
        projectId: authorization.plan.run.projectId,
        agentRunId: authorization.run.id,
        executionRunId,
        bundle,
        profileFingerprint: profile.profileFingerprint,
        planFingerprint,
        requestId: action.requestId,
        stepByteCount: stepBytes.byteLength,
        stepSha256: geometryArtifact.fingerprint.digest,
      }),
    };
  }

  async #reopenCompleted(
    project: EngineeringProjectSnapshot,
    command: VerifyRunFeaStaticProofV3RunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    const prepared = await this.#prepare(project, command.runId, ["completed"]);
    await assertThreadSnapshotLineageIntact(
      prepared.authorization.basis,
      this.d.snapshots,
    );
    const attempt = requireCompletedIsolatedStaticProofRunWal(
      await this.d.attempts.read(command.projectId, command.runId),
    );
    const reopened = await this.#reopenAttemptSnapshot(prepared, attempt);
    assertCompletedIsolatedStaticProofProjectReference(project, reopened);
    assertCompletedIsolatedStaticProofProjectBinding(
      project,
      command.runId,
      reopened,
    );
    return project;
  }

  async #reopenAttemptSnapshot(
    prepared: Prepared,
    attempt: CalculixIsolatedProductAttempt,
  ): Promise<ThreadSnapshot> {
    const completed = requireCompletedIsolatedStaticProofWal(attempt);
    assertIsolatedStaticProofAttemptMatches(completed, prepared.identity);
    const evidence = await this.#readEvidence(prepared, completed);
    const evaluation = await this.#ensureEvaluation(prepared, evidence, completed);
    const expectedSnapshot = this.#materializeSnapshot(
      prepared,
      evidence,
      evaluation,
    );
    const reopened = assertCompletedIsolatedStaticProofSnapshot({
      persisted: await this.d.snapshots.get(completed.snapshot.snapshotId),
      rematerialized: expectedSnapshot,
      attemptSnapshot: completed.snapshot,
      runId: prepared.authorization.run.id,
    });
    await assertThreadSnapshotLineageIntact(reopened, this.d.snapshots);
    return reopened;
  }

  async #failRejected(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyRunFeaStaticProofV3RunExecutorCommand,
    error: IsolatedCodeExecutionRejectedError,
  ): Promise<EngineeringProjectSnapshot> {
    return await this.#failClaimedRun(origin, command, {
      summary: "Isolated CalculiX execution was rejected before Thread publication.",
      code: "isolated_execution_rejected",
      message: isolatedExecutionRejectionMessage(error),
    });
  }

  async #reopenFailedOutputValidation(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyRunFeaStaticProofV3RunExecutorCommand,
    project: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    const run = requireRun(project, command.runId);
    if (run.status !== "failed") {
      throw commandError(
        "invalid_transition",
        `Isolated CalculiX run ${run.id} is not executable.`,
      );
    }
    const prepared = await this.#prepare(project, command.runId, ["failed"]);
    try {
      await this.d.executeIsolated.reopenOutputValidationRejection({
        projectId: command.projectId,
        agentRunId: command.runId,
      });
    } catch (error) {
      if (error instanceof IsolatedCalculixOutputValidationRejectedError) {
        assertDerivedOutputValidationExecutionRunId(
          error,
          prepared.executionRunId,
        );
        await this.#assertFailedOutputValidationReplay(
          origin,
          command,
          project,
          run,
          isolatedOutputValidationFailure(error.observation),
        );
        return project;
      }
      throw error;
    }
    throw commandError(
      "invalid_transition",
      `Isolated CalculiX run ${run.id} has no exact output-validation-rejected WAL.`,
    );
  }

  async #failOutputValidationRejected(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyRunFeaStaticProofV3RunExecutorCommand,
    error: IsolatedCalculixOutputValidationRejectedError,
    expectedExecutionRunId: string,
  ): Promise<EngineeringProjectSnapshot> {
    assertDerivedOutputValidationExecutionRunId(error, expectedExecutionRunId);
    const project = await requiredProject(this.d.projects, command.projectId);
    const run = requireRun(project, command.runId);
    const failure = isolatedOutputValidationFailure(error.observation);
    if (run.status === "failed") {
      await this.#assertFailedOutputValidationReplay(
        origin,
        command,
        project,
        run,
        failure,
      );
      return project;
    }
    if (run.status !== "running") {
      throw commandError(
        "invalid_transition",
        `Isolated CalculiX run ${run.id} is not executable.`,
      );
    }
    if (run.resultSnapshot || run.evidenceRefs.length !== 0) {
      throw commandError(
        "invalid_transition",
        "The claimed isolated CalculiX run already carries Thread evidence and cannot take an evidence-free terminal failure.",
      );
    }
    const startedAt = run.startedAt;
    await this.d.commands.failRun(
      origin,
      failCommand(command, failure, project.revision),
    );
    const failed = await requiredProject(this.d.projects, command.projectId);
    await this.#assertFailedOutputValidationReplay(
      origin,
      command,
      failed,
      requireRun(failed, command.runId),
      failure,
      startedAt,
    );
    return failed;
  }

  async #assertFailedOutputValidationReplay(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyRunFeaStaticProofV3RunExecutorCommand,
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    failure: {
      readonly summary: string;
      readonly code: string;
      readonly message: string;
    },
    originalStartedAt = run.startedAt,
  ): Promise<void> {
    await assertFailedIsolatedOutputValidationReplay({
      project,
      run,
      origin,
      originalStartedAt,
      failure,
      claimCommandId: `${command.commandId}:claim`,
      failCommandId: `${command.commandId}:fail`,
      buildClaimCommand: (expectedRevision, issuedAt) =>
        claimCommand(command, expectedRevision, issuedAt),
      buildFailCommand: (expectedRevision, issuedAt) =>
        failCommand(command, failure, expectedRevision, issuedAt),
    });
  }

  async #failExhausted(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyRunFeaStaticProofV3RunExecutorCommand,
    error: IsolatedCalculixRedispatchExhaustedError,
  ): Promise<EngineeringProjectSnapshot> {
    return await this.#failClaimedRun(origin, command, {
      summary: "Isolated CalculiX redispatch was exhausted before Thread publication.",
      code: "isolated_redispatch_exhausted",
      message: describe(
        `Isolated execution producer generation ${error.producerGeneration} was unpublished and cleaned up; no third dispatch occurs.`,
      ),
    });
  }

  async #failClaimedRun(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyRunFeaStaticProofV3RunExecutorCommand,
    failure: {
      readonly summary: string;
      readonly code: string;
      readonly message: string;
    },
  ): Promise<EngineeringProjectSnapshot> {
    const project = await requiredProject(this.d.projects, command.projectId);
    await this.d.commands.failRun(origin, {
      ...command,
      commandId: `${command.commandId}:fail`,
      expectedRevision: project.revision,
      summary: failure.summary,
      code: failure.code,
      message: failure.message,
    });
    return await requiredProject(this.d.projects, command.projectId);
  }

  async #executeAndRecord(
    prepared: Prepared,
    startedAt: string,
  ): Promise<CalculixIsolatedExecutionEvidence> {
    const result = await this.d.executeIsolated.execute({
      identity: {
        projectId: prepared.authorization.plan.run.projectId,
        agentRunId: prepared.authorization.run.id,
        executionRunId: prepared.executionRunId,
        requestId: prepared.action.requestId,
        startedAt,
        resolvedOperationPlanFingerprint: prepared.planFingerprint,
        proofFingerprint: prepared.bundle.manifest.proofFingerprint,
        step: {
          byteCount: prepared.bundle.manifest.step.byteCount,
          sha256: prepared.bundle.manifest.step.sha256,
        },
        bundleFingerprint: prepared.bundle.fingerprint,
        profile: prepared.profile,
      },
      bundle: prepared.bundle,
    });
    assertIsolatedStaticProofEvidenceMatches(result.evidence, prepared.identity);
    const reopened = await this.d.executionEvidence.read(
      result.evidence.fingerprint,
    );
    if (
      !reopened ||
      deterministicJson(reopened) !== deterministicJson(result.evidence)
    ) {
      throw commandError(
        "invalid_transition",
        "The isolated CalculiX evidence was not durably reopened.",
      );
    }
    return reopened;
  }

  async #readEvidence(
    prepared: Prepared,
    attempt: CalculixIsolatedProductAttempt,
  ): Promise<CalculixIsolatedExecutionEvidence> {
    if (!("evidenceSha256" in attempt)) {
      throw commandError(
        "invalid_transition",
        "The local CalculiX WAL has no durable evidence identity.",
      );
    }
    const evidence = await this.d.executionEvidence.read({
      algorithm: "sha256",
      digest: attempt.evidenceSha256,
    });
    if (!evidence) {
      throw commandError(
        "invalid_transition",
        "The local CalculiX evidence named by the product WAL is absent.",
      );
    }
    assertIsolatedStaticProofEvidenceMatches(evidence, prepared.identity);
    return evidence;
  }

  async #ensureEvaluation(
    prepared: Prepared,
    evidence: CalculixIsolatedExecutionEvidence,
    attempt: CalculixIsolatedProductAttempt,
  ): Promise<DurableEvaluation> {
    const values = buildOracleValues({
      maxDisplacement: evidence.result.metrics.maximumDisplacement,
      maxVonMises: evidence.result.metrics.maximumVonMises,
    }, prepared.proof.case.requirements);
    const expectedRequest = prepareFeaConstraintOracleCall(
      prepared.proof.case.requirements,
      values,
    );
    if (attempt.status === "evaluation-dispatched") {
      throw new CalculixIsolatedProductOutcomeUnknownError(
        "The SysON evaluation may have completed; a second oracle call is forbidden.",
      );
    }
    if (attempt.status === "evaluation-captured" || attempt.status === "completed") {
      return await this.#readEvaluation(
        attempt.evaluationCapture,
        attempt.evaluationDispatchedAt,
        expectedRequest,
        prepared.proof.case,
      );
    }
    if (attempt.status !== "evidence-captured") {
      throw commandError(
        "invalid_transition",
        "SysON evaluation requires durably captured isolated CalculiX evidence.",
      );
    }
    const dispatched = await this.d.attempts.markEvaluationDispatched({
      projectId: attempt.projectId,
      runId: attempt.runId,
      evaluationDispatchedAt: this.#now(),
    });
    if (dispatched.status !== "evaluation-dispatched") {
      throw new CalculixIsolatedProductOutcomeUnknownError(
        "The SysON dispatch intent was not durably retained.",
      );
    }
    let called;
    try {
      called = await callCapturedFeaConstraintOracle(
        this.d.syson,
        prepared.proof.case.requirements,
        values,
      );
    } catch (cause) {
      throw new CalculixIsolatedProductOutcomeUnknownError(
        `The SysON evaluation may have completed: ${describe(cause)}.`,
      );
    }
    if (deterministicJson(called.request) !== deterministicJson(expectedRequest)) {
      throw commandError(
        "invalid_transition",
        "The SysON evaluation call differs from the proof-derived request.",
      );
    }
    const capture = validateFeaSysonEvaluationCapture({
      schemaVersion: FEA_SYSON_EVALUATION_CAPTURE_SCHEMA,
      request: called.request,
      response: { structuredContent: called.structuredContent },
    });
    const bytes = new TextEncoder().encode(
      canonicalFeaSysonEvaluationCaptureText(capture),
    );
    const fingerprint = {
      algorithm: "sha256" as const,
      digest: await fingerprintResourceBytes(bytes),
    };
    const saved = await this.d.sysonEvaluationCaptureStore.save(
      fingerprint,
      bytes,
    );
    const reference = casReference(saved);
    const durable = await this.#readEvaluation(
      reference,
      dispatched.evaluationDispatchedAt,
      expectedRequest,
      prepared.proof.case,
    );
    const captured = await this.d.attempts.recordEvaluation({
      projectId: attempt.projectId,
      runId: attempt.runId,
      evaluationCapture: reference,
    });
    if (captured.status !== "evaluation-captured") {
      throw new Error("The local CalculiX evaluation capture WAL did not advance.");
    }
    return durable;
  }

  async #readEvaluation(
    reference: CalculixIsolatedProductCasReference,
    evaluationDispatchedAt: string,
    expectedRequest: ReturnType<typeof prepareFeaConstraintOracleCall>,
    proof: MechanicalProofCase,
  ): Promise<DurableEvaluation> {
    const fingerprint = { algorithm: "sha256" as const, digest: reference.sha256 };
    if (
      reference.uri !== this.d.sysonEvaluationCaptureStore.uriFor(fingerprint)
    ) {
      throw commandError(
        "invalid_transition",
        "The SysON evaluation WAL URI is not the exact local CAS object.",
      );
    }
    const opened = await this.d.sysonEvaluationCaptureStore.read(fingerprint);
    if (!opened || opened.byteLength !== reference.byteCount) {
      throw commandError(
        "invalid_transition",
        "The SysON evaluation capture is absent from exact local CAS.",
      );
    }
    const bytes = opened.copy();
    if (await fingerprintResourceBytes(bytes) !== reference.sha256) {
      throw commandError(
        "invalid_transition",
        "The SysON evaluation capture fails its exact CAS hash.",
      );
    }
    const text = decodeUtf8(bytes, "SysON evaluation capture");
    let capture: ReturnType<typeof validateFeaSysonEvaluationCapture>;
    try {
      capture = validateFeaSysonEvaluationCapture(JSON.parse(text));
    } catch (cause) {
      throw commandError(
        "invalid_transition",
        `The SysON evaluation capture is invalid: ${describe(cause)}.`,
      );
    }
    if (
      canonicalFeaSysonEvaluationCaptureText(capture) !== text ||
      deterministicJson(capture.request) !== deterministicJson(expectedRequest)
    ) {
      throw commandError(
        "invalid_transition",
        "The SysON evaluation capture does not bind the exact proof request.",
      );
    }
    return {
      reference,
      evaluationDispatchedAt,
      outcomes: parseCapturedFeaConstraintOracleOutcome(
        capture.response.structuredContent,
        proof.requirements,
      ),
    };
  }

  #materializeSnapshot(
    prepared: Prepared,
    evidence: CalculixIsolatedExecutionEvidence,
    evaluation: DurableEvaluation,
  ): ThreadSnapshot {
    try {
      return buildStaticProofSuccessor({
        basis: prepared.authorization.basis,
        capturedAt: evaluation.evaluationDispatchedAt,
        localOperation: isolatedStaticProofLocalOperation(
          prepared.authorization.run.id,
        ),
        oracleOperation: {
          serverId: "syson",
          tool: "syson_constraint_evaluate",
          runId: `capture:${evaluation.reference.sha256}`,
        },
        proofArtifact: prepared.proofArtifact,
        geometryArtifact: prepared.geometryArtifact,
        requirementsArtifact: prepared.requirementsArtifact,
        proofRequirements: prepared.proof.case.requirements,
        evidence: {
          fingerprint: evidence.fingerprint,
          uri: this.d.executionEvidence.uriFor(evidence.fingerprint),
          outputs: evidence.outputs,
          metrics: evidence.result.metrics,
        },
        evaluation: {
          sha256: evaluation.reference.sha256,
          uri: evaluation.reference.uri,
          outcomes: evaluation.outcomes,
        },
      });
    } catch (cause) {
      throwDomain(cause);
    }
  }

  async #readProofCapture(
    artifact: ThreadArtifact,
    expectedByteCount: number,
  ): Promise<SealedStaticProofCapture> {
    const bytes = await this.#readExactArtifact(
      artifact,
      expectedByteCount,
      "Proof-case artifact",
    );
    try {
      return await parseSealedStaticProofCapture(bytes);
    } catch (cause) {
      throwDomain(cause);
    }
  }

  async #readExactArtifact(
    artifact: ThreadArtifact,
    expectedByteCount: number | undefined,
    label: string,
  ): Promise<Uint8Array> {
    const opened = await this.d.artifacts.readArtifact(artifact);
    const bytes = opened?.bytes;
    if (
      !opened || !bytes || opened.uri !== artifact.uri ||
      opened.mediaType !== artifact.mediaType ||
      opened.sha256 !== artifact.fingerprint.digest ||
      opened.byteCount !== bytes.byteLength ||
      (expectedByteCount !== undefined && opened.byteCount !== expectedByteCount) ||
      await fingerprintResourceBytes(bytes) !== artifact.fingerprint.digest
    ) {
      throw commandError(
        "invalid_transition",
        `${label} bytes do not match their exact Thread CAS identity.`,
      );
    }
    return Uint8Array.from(bytes);
  }

  async #finishSnapshot(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyRunFeaStaticProofV3RunExecutorCommand,
    prepared: Prepared,
    attempt: CalculixIsolatedProductAttempt,
  ): Promise<EngineeringProjectSnapshot> {
    if (attempt.status !== "completed") {
      throw new Error("The isolated CalculiX completion journal is missing.");
    }
    const snapshot = await this.#reopenAttemptSnapshot(prepared, attempt);
    let project = await requiredProject(this.d.projects, command.projectId);
    let run = requireRun(project, command.runId);
    if (run.status === "completed") {
      return await this.#reopenCompleted(project, command);
    }
    if (run.status === "running") {
      await this.d.commands.publishRun(origin, {
        ...command,
        commandId: `${command.commandId}:publish`,
        expectedRevision: project.revision,
        summary: "Published isolated local CalculiX evidence.",
      });
    }
    project = await requiredProject(this.d.projects, command.projectId);
    run = requireRun(project, command.runId);
    if (run.status === "completed") {
      return await this.#reopenCompleted(project, command);
    }
    if (run.status !== "publishing") {
      throw commandError(
        "invalid_transition",
        "The isolated CalculiX run is not ready for completion.",
      );
    }
    const exactSnapshot = validateThreadSnapshot(snapshot);
    const evidenceRefs = exactIsolatedStaticProofEvidenceRefs(
      exactSnapshot,
      command.runId,
    );
    await this.d.commands.completeRun(origin, {
      ...command,
      commandId: `${command.commandId}:complete`,
      expectedRevision: project.revision,
      summary: "Completed isolated local CalculiX static proof.",
      resultSnapshot: snapshotRef(exactSnapshot),
      evidenceRefs,
    });
    project = await requiredProject(this.d.projects, command.projectId);
    return await this.#reopenCompleted(project, command);
  }
}

function claimCommand(
  command: VerifyRunFeaStaticProofV3RunExecutorCommand,
  expectedRevision = command.expectedRevision,
  issuedAt = command.issuedAt,
): RunCommand {
  return {
    ...command,
    commandId: `${command.commandId}:claim`,
    expectedRevision,
    issuedAt,
    summary: "Started the isolated local CalculiX static-structural run.",
  };
}

function failCommand(
  command: VerifyRunFeaStaticProofV3RunExecutorCommand,
  failure: {
    readonly summary: string;
    readonly code: string;
    readonly message: string;
  },
  expectedRevision = command.expectedRevision,
  issuedAt = command.issuedAt,
): FailRunCommand {
  return {
    ...command,
    commandId: `${command.commandId}:fail`,
    expectedRevision,
    issuedAt,
    summary: failure.summary,
    code: failure.code,
    message: failure.message,
  };
}

function assertDerivedOutputValidationExecutionRunId(
  error: IsolatedCalculixOutputValidationRejectedError,
  expectedExecutionRunId: string,
): void {
  if (error.executionRunId !== expectedExecutionRunId) {
    throw commandError(
      "invalid_transition",
      "The isolated CalculiX output-validation rejection does not bind the exact derived execution run identity.",
    );
  }
}

function isolatedOutputValidationFailure(observation: {
  readonly role: string;
  readonly byteCount: number;
  readonly sha256: string;
}): {
  readonly summary: string;
  readonly code: string;
  readonly message: string;
} {
  return {
    summary: CALCULIX_ISOLATED_OUTPUT_VALIDATION_FAILED.summary,
    code: CALCULIX_ISOLATED_OUTPUT_VALIDATION_FAILED.code,
    message: isolatedOutputValidationFailedMessage(observation),
  };
}
