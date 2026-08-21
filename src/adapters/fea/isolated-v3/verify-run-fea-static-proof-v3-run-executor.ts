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
import type { ExecuteIsolatedCalculixStaticProof } from "../../../application/use-cases/fea/isolated-v3/execute-isolated-calculix-static-proof.ts";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
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
import {
  assertCanonicalStepBytes,
  assertStaticProofAttemptMatches,
  assertStaticProofCrossAttests,
  assertStaticProofEvidenceMatches,
  assertStaticProofProfileBinding,
} from "../../../domain/fea/isolated-v3/static-proof-identity.ts";
import {
  assertExactCompletedStaticProofProjectBinding,
  assertExactStaticProofLocalArtifacts,
  buildStaticProofSuccessor,
  exactStaticProofEvidenceRefs,
} from "../../../domain/fea/isolated-v3/static-proof-thread-evidence.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRunStatus,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import type { ResolvedRunPlanReader } from "../../../domain/project/resolved-run-plan-sealer.ts";
import type {
  ThreadArtifact,
  ThreadOperationRef,
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
  readonly executeIsolated: Pick<ExecuteIsolatedCalculixStaticProof, "execute">;
  readonly executionEvidence: CalculixIsolatedExecutionEvidenceStore;
  readonly sysonEvaluationCaptureStore: Pick<
    FileByteStore<"calculix-isolated-syson-evaluation">,
    "read" | "save" | "uriFor"
  >;
  readonly attempts: FileCalculixIsolatedProductAttemptStore;
  readonly syson: McpToolClient;
  readonly lease: EngineeringProjectRunLease;
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

function localOperation(runId: string): ThreadOperationRef {
  return {
    serverId: "digital-thread",
    tool: "verify.run-fea-static-proof@3",
    runId,
  };
}

function assertEvidenceMatchesPrepared(
  evidence: CalculixIsolatedExecutionEvidence,
  prepared: Prepared,
): void {
  try {
    assertStaticProofEvidenceMatches({
      projectId: evidence.projectId,
      agentRunId: evidence.agentRunId,
      executionRunId: evidence.executionRunId,
      bundleFingerprint: evidence.bundleFingerprint,
      proofFingerprint: evidence.proofFingerprint,
      executionProfileFingerprint: evidence.executionProfileFingerprint,
      planFingerprint: evidence.authority.resolvedOperationPlanFingerprint,
      requestId: evidence.result.requestId,
      receiptRunId: evidence.receipt.runId,
      receiptSourceSha256: evidence.receipt.sourceSha256,
      resultInputByteCount: evidence.result.inputArtifact.byteCount,
      resultInputSha256: evidence.result.inputArtifact.sha256,
    }, {
      projectId: prepared.authorization.plan.run.projectId,
      agentRunId: prepared.authorization.run.id,
      executionRunId: prepared.executionRunId,
      bundleFingerprint: prepared.bundle.fingerprint,
      proofFingerprint: prepared.bundle.manifest.proofFingerprint,
      executionProfileFingerprint: prepared.profile.profileFingerprint,
      planFingerprint: prepared.planFingerprint,
      requestId: prepared.action.requestId,
      stepByteCount: prepared.stepBytes.byteLength,
      stepSha256: prepared.geometryArtifact.fingerprint.digest,
    });
  } catch (cause) {
    throwDomain(cause);
  }
}

function assertAttemptMatchesPrepared(
  attempt: CalculixIsolatedProductAttempt,
  prepared: Prepared,
): void {
  try {
    assertStaticProofAttemptMatches({
      projectId: attempt.projectId,
      runId: attempt.runId,
      planSha256: attempt.planSha256,
      executionRunId: attempt.executionRunId,
      bundleSha256: attempt.bundleSha256,
      profileSha256: attempt.profileSha256,
      hasEvidenceSha256: "evidenceSha256" in attempt,
    }, {
      projectId: prepared.authorization.plan.run.projectId,
      agentRunId: prepared.authorization.run.id,
      executionRunId: prepared.executionRunId,
      bundleFingerprint: prepared.bundle.fingerprint,
      proofFingerprint: prepared.bundle.manifest.proofFingerprint,
      executionProfileFingerprint: prepared.profile.profileFingerprint,
      planFingerprint: prepared.planFingerprint,
      requestId: prepared.action.requestId,
      stepByteCount: prepared.stepBytes.byteLength,
      stepSha256: prepared.geometryArtifact.fingerprint.digest,
    });
  } catch (cause) {
    throwDomain(cause);
  }
}

function assertExactLocalArtifacts(
  snapshot: ThreadSnapshot,
  runId: string,
): readonly ThreadArtifact[] {
  try {
    return assertExactStaticProofLocalArtifacts(snapshot, localOperation(runId));
  } catch (cause) {
    throwDomain(cause);
  }
}

function exactLocalEvidenceRefs(
  snapshot: ThreadSnapshot,
  runId: string,
): ReturnType<typeof exactStaticProofEvidenceRefs> {
  try {
    return exactStaticProofEvidenceRefs(snapshot, localOperation(runId));
  } catch (cause) {
    throwDomain(cause);
  }
}

function assertExactCompletedProjectBinding(
  project: EngineeringProjectSnapshot,
  runId: string,
  snapshot: ThreadSnapshot,
): void {
  const run = requireRun(project, runId);
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  try {
    assertExactCompletedStaticProofProjectBinding({
      runStatus: run.status,
      resultSnapshot: run.resultSnapshot,
      evidenceRefs: run.evidenceRefs,
      workItemStatus: workItem?.status,
      workItemEvidenceRefs: workItem?.evidenceRefs,
      expectedSnapshot: snapshotRef(snapshot),
      expectedEvidenceRefs: exactLocalEvidenceRefs(snapshot, runId),
    });
  } catch (cause) {
    throwDomain(cause);
  }
}

function assertProofMatchesAuthorization(
  authorization: ResolvedRunPlanExecutionAuthorization,
  action: ResolvedCalculixIsolatedStaticStructuralAction,
  proof: SealedStaticProofCapture,
  proofArtifact: ThreadArtifact,
  step: ThreadArtifact,
  geometry: ThreadArtifact,
  requirements: ThreadArtifact,
): void {
  try {
    assertStaticProofCrossAttests({
      projectId: authorization.plan.run.projectId,
      subjectId: authorization.basis.subject.id,
      actionProofCaseId: action.input.proofCase.id,
      actionProofCaseFingerprint: action.input.proofCase.fingerprint,
      expectedProofProducerServerId: "digital-thread",
      expectedProofProducerTool: "verify.seal-proof-case@1",
    }, {
      projectId: proof.case.project.id,
      subjectId: proof.case.project.subjectId,
      proofCaseId: proof.case.id,
      trustedRunId: proof.trustedRunId,
      expectedCadSha256: proof.case.expectedCadArtifact.sha256,
      expectedCadBytes: proof.case.expectedCadArtifact.bytes,
      geometry: proof.geometry,
      requirements: proof.requirements,
      step: proof.step,
    }, {
      id: proofArtifact.id,
      fingerprint: proofArtifact.fingerprint,
      producerRunId: proofArtifact.producer.runId,
      producerServerId: proofArtifact.producer.serverId,
      producerTool: proofArtifact.producer.tool,
      inputArtifactIds: proofArtifact.inputArtifactIds,
    }, {
      id: step.id,
      fingerprint: step.fingerprint,
      producerRunId: step.producer.runId,
    }, {
      id: geometry.id,
      fingerprint: geometry.fingerprint,
      producerRunId: geometry.producer.runId,
    }, {
      id: requirements.id,
      fingerprint: requirements.fingerprint,
      producerRunId: requirements.producer.runId,
    });
  } catch (cause) {
    throwDomain(cause);
  }
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

    if (prepared.authorization.run.status === "queued") {
      await this.d.commands.claimRun(origin, {
        ...command,
        commandId: `${command.commandId}:claim`,
        summary: "Started the isolated local CalculiX static-structural run.",
      });
    }
    project = await requiredProject(this.d.projects, command.projectId);
    const claimedRun = requireRun(project, command.runId);
    if (claimedRun.status === "completed") {
      return await this.#reopenCompleted(project, command);
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
      return await this.#finishSnapshot(origin, command, prepared, attempt);
    }

    const evidence = attempt.status === "prepared"
      ? await this.#executeAndRecord(prepared, startedAt)
      : await this.#readEvidence(prepared, attempt);
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
    return await this.#finishSnapshot(origin, command, prepared, completed);
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
    });
    if (authorization.plan.action.kind !== "isolated-static-structural-analysis") {
      throw commandError(
        "invalid_transition",
        "The resolved plan action is not the isolated local CalculiX action.",
      );
    }
    const action = authorization.plan.action;
    const profile = await this.d.profiles.initial();
    try {
      assertStaticProofProfileBinding({
        actionProfileFingerprint: action.executor.profileFingerprint,
        activeProfileFingerprint: profile.profileFingerprint,
        executorId: action.executor.id,
        expectedExecutorId: "casys-local-microsandbox",
        contractId: action.executor.contract.id,
        expectedContractId: "calculix-static-proof-v1",
        contractVersion: action.executor.contract.version,
        expectedContractVersion: "1.0.0",
        loweringId: action.lowering.id,
        expectedLoweringId: profile.lowering.id,
        loweringVersion: action.lowering.version,
        expectedLoweringVersion: profile.lowering.version,
      });
    } catch (cause) {
      throwDomain(cause);
    }

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
    assertProofMatchesAuthorization(
      authorization,
      action,
      proof,
      proofArtifact,
      geometryArtifact,
      proofGeometryArtifact,
      requirementsArtifact,
    );
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
    try {
      assertCanonicalStepBytes({
        stepByteLength: stepBytes.byteLength,
        sourceByteCount: stepSource.artifact.byteCount,
        proofStepBytes: proof.step.bytes,
        stepSha256: await fingerprintResourceBytes(stepBytes),
        geometryDigest: geometryArtifact.fingerprint.digest,
      });
    } catch (cause) {
      throwDomain(cause);
    }
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
    const attempt = await this.d.attempts.read(command.projectId, command.runId);
    if (!attempt || attempt.status !== "completed") {
      throw commandError(
        "invalid_transition",
        "The completed isolated CalculiX run has no exact completed product WAL.",
      );
    }
    const reopened = await this.#reopenAttemptSnapshot(prepared, attempt);
    const projectReference = project.threadSnapshots.filter((reference) =>
      reference.snapshotId === reopened.id &&
      reference.revision === reopened.revision &&
      reference.subjectId === reopened.subject.id
    );
    if (projectReference.length !== 1) {
      throw commandError(
        "invalid_transition",
        "The completed project does not retain the exact isolated CalculiX snapshot reference.",
      );
    }
    assertExactCompletedProjectBinding(project, command.runId, reopened);
    return project;
  }

  async #reopenAttemptSnapshot(
    prepared: Prepared,
    attempt: CalculixIsolatedProductAttempt,
  ): Promise<ThreadSnapshot> {
    if (attempt.status !== "completed") {
      throw commandError(
        "invalid_transition",
        "The isolated CalculiX product WAL is not complete.",
      );
    }
    assertAttemptMatchesPrepared(attempt, prepared);
    const evidence = await this.#readEvidence(prepared, attempt);
    const evaluation = await this.#ensureEvaluation(prepared, evidence, attempt);
    const expectedSnapshot = this.#materializeSnapshot(
      prepared,
      evidence,
      evaluation,
    );
    const reopened = await this.d.snapshots.get(attempt.snapshot.snapshotId);
    if (
      !reopened ||
      attempt.snapshot.snapshotId !== expectedSnapshot.id ||
      attempt.snapshot.revision !== expectedSnapshot.revision ||
      attempt.snapshot.subjectId !== expectedSnapshot.subject.id ||
      deterministicJson(reopened) !== deterministicJson(expectedSnapshot)
    ) {
      throw commandError(
        "invalid_transition",
        "The completed isolated CalculiX ThreadSnapshot is absent or divergent.",
      );
    }
    await assertThreadSnapshotLineageIntact(reopened, this.d.snapshots);
    assertExactLocalArtifacts(reopened, prepared.authorization.run.id);
    return reopened;
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
    assertEvidenceMatchesPrepared(result.evidence, prepared);
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
    assertEvidenceMatchesPrepared(evidence, prepared);
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
        localOperation: localOperation(prepared.authorization.run.id),
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
    const evidenceRefs = exactLocalEvidenceRefs(exactSnapshot, command.runId);
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
