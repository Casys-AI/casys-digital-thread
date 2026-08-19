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
import { canonicalProofText } from "../../../domain/fea/seal-case/fea-proof-proposal.ts";
import {
  type MechanicalProofCase,
  validateMechanicalProofCase,
} from "../../../domain/fea/seal-case/mechanical-proof-case.ts";
import {
  fingerprintResourceBytes,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRunStatus,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
} from "../../../domain/project/engineering-project.ts";
import type { ResolvedRunPlanReader } from "../../../domain/project/resolved-run-plan-sealer.ts";
import type {
  ProposedThreadAction,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadFreshness,
  ThreadObservation,
  ThreadOperationRef,
  ThreadProvenanceLink,
  ThreadSnapshot,
  ThreadViolation,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../../domain/thread/thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import {
  buildOracleValues,
  callCapturedFeaConstraintOracle,
  feaEvaluationsFromOracle,
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

interface ArtifactIdentity {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
}

interface ProofCapture {
  readonly case: MechanicalProofCase;
  readonly trustedRunId: string;
  readonly geometry: ArtifactIdentity;
  readonly requirements: ArtifactIdentity;
  readonly step: ArtifactIdentity & { readonly bytes: number };
}

interface Prepared {
  readonly authorization: ResolvedRunPlanExecutionAuthorization;
  readonly action: ResolvedCalculixIsolatedStaticStructuralAction;
  readonly proof: ProofCapture;
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

function assertEvidenceMatchesPrepared(
  evidence: CalculixIsolatedExecutionEvidence,
  prepared: Prepared,
): void {
  if (
    evidence.projectId !== prepared.authorization.plan.run.projectId ||
    evidence.agentRunId !== prepared.authorization.run.id ||
    evidence.executionRunId !== prepared.executionRunId ||
    !fingerprintsEqual(evidence.bundleFingerprint, prepared.bundle.fingerprint) ||
    !fingerprintsEqual(
      evidence.proofFingerprint,
      prepared.bundle.manifest.proofFingerprint,
    ) ||
    !fingerprintsEqual(
      evidence.executionProfileFingerprint,
      prepared.profile.profileFingerprint,
    ) ||
    !fingerprintsEqual(
      evidence.authority.resolvedOperationPlanFingerprint,
      prepared.planFingerprint,
    ) ||
    evidence.result.requestId !== prepared.action.requestId ||
    evidence.receipt.runId !== prepared.executionRunId ||
    evidence.receipt.sourceSha256 !== prepared.bundle.fingerprint.digest ||
    evidence.result.inputArtifact.byteCount !== prepared.stepBytes.byteLength ||
    evidence.result.inputArtifact.sha256 !==
      prepared.geometryArtifact.fingerprint.digest
  ) {
    throw commandError(
      "invalid_transition",
      "The isolated CalculiX evidence does not cross-bind the exact plan, profile, proof, bundle and STEP.",
    );
  }
}

function assertAttemptMatchesPrepared(
  attempt: CalculixIsolatedProductAttempt,
  prepared: Prepared,
): void {
  if (
    attempt.projectId !== prepared.authorization.plan.run.projectId ||
    attempt.runId !== prepared.authorization.run.id ||
    attempt.planSha256 !== prepared.planFingerprint.digest ||
    attempt.executionRunId !== prepared.executionRunId ||
    attempt.bundleSha256 !== prepared.bundle.fingerprint.digest ||
    attempt.profileSha256 !== prepared.profile.profileFingerprint.digest ||
    !("evidenceSha256" in attempt)
  ) {
    throw commandError(
      "invalid_transition",
      "The isolated CalculiX product WAL does not bind the exact completed plan, profile and bundle.",
    );
  }
}

function assertExactLocalArtifacts(
  snapshot: ThreadSnapshot,
  runId: string,
): readonly ThreadArtifact[] {
  const artifacts = snapshot.artifacts.filter((artifact) =>
    artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === "verify.run-fea-static-proof@3" &&
    artifact.producer.runId === runId
  );
  if (
    artifacts.length !== 11 ||
    artifacts.filter((artifact) => artifact.name.startsWith("Local CalculiX "))
        .length !== 9 ||
    artifacts.filter((artifact) =>
        artifact.name === "Isolated local CalculiX execution evidence"
      ).length !== 1 ||
    artifacts.filter((artifact) =>
        artifact.name === "SysON evaluation of isolated CalculiX evidence"
      ).length !== 1
  ) {
    throw commandError(
      "invalid_transition",
      "The isolated CalculiX completion requires exactly nine outputs, execution evidence and SysON evidence.",
    );
  }
  return artifacts;
}

function exactLocalEvidenceRefs(
  snapshot: ThreadSnapshot,
  runId: string,
): readonly EngineeringThreadEntityRef[] {
  return assertExactLocalArtifacts(snapshot, runId).map((artifact) => ({
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact" as const,
    id: artifact.id,
  }));
}

function assertExactCompletedProjectBinding(
  project: EngineeringProjectSnapshot,
  runId: string,
  snapshot: ThreadSnapshot,
): void {
  const run = requireRun(project, runId);
  const expectedSnapshot = snapshotRef(snapshot);
  const expectedEvidence = exactLocalEvidenceRefs(snapshot, runId);
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (
    run.status !== "completed" ||
    deterministicJson(run.resultSnapshot) !== deterministicJson(expectedSnapshot) ||
    deterministicJson(run.evidenceRefs) !== deterministicJson(expectedEvidence) ||
    !workItem || workItem.status !== "completed" ||
    deterministicJson(workItem.evidenceRefs) !== deterministicJson(expectedEvidence)
  ) {
    throw commandError(
      "invalid_transition",
      "The completed project run and work item do not bind the exact isolated CalculiX snapshot and evidence refs.",
    );
  }
}

function assertProofMatchesAuthorization(
  authorization: ResolvedRunPlanExecutionAuthorization,
  action: ResolvedCalculixIsolatedStaticStructuralAction,
  proof: ProofCapture,
  proofArtifact: ThreadArtifact,
  step: ThreadArtifact,
  geometry: ThreadArtifact,
  requirements: ThreadArtifact,
): void {
  const ids = [proof.geometry.id, proof.requirements.id, proof.step.id].sort();
  if (
    proof.case.project.id !== authorization.plan.run.projectId ||
    proof.case.project.subjectId !== authorization.basis.subject.id ||
    proof.case.id !== action.input.proofCase.id ||
    !fingerprintsEqual(
      proofArtifact.fingerprint,
      action.input.proofCase.fingerprint,
    ) ||
    proof.trustedRunId !== proofArtifact.producer.runId ||
    proofArtifact.producer.serverId !== "digital-thread" ||
    proofArtifact.producer.tool !== "verify.seal-proof-case@1" ||
    geometry.id !== proof.geometry.id ||
    !fingerprintsEqual(geometry.fingerprint, proof.geometry.fingerprint) ||
    geometry.producer.runId !== proof.geometry.producerRunId ||
    step.id !== proof.step.id ||
    !fingerprintsEqual(step.fingerprint, proof.step.fingerprint) ||
    step.producer.runId !== proof.step.producerRunId ||
    step.fingerprint.digest !== proof.case.expectedCadArtifact.sha256 ||
    proof.step.bytes !== proof.case.expectedCadArtifact.bytes ||
    requirements.id !== proof.requirements.id ||
    !fingerprintsEqual(requirements.fingerprint, proof.requirements.fingerprint) ||
    requirements.producer.runId !== proof.requirements.producerRunId ||
    deterministicJson([...proofArtifact.inputArtifactIds].sort()) !==
      deterministicJson(ids)
  ) {
    throw commandError(
      "invalid_transition",
      "The local CalculiX proof, geometry and requirements do not cross-attest.",
    );
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

function outputArtifactId(role: string, digest: string): string {
  return `calculix-isolated-${role.replaceAll(".", "-")}-${digest}`;
}

function outputArtifactKind(
  role: string,
): ThreadArtifact["kind"] {
  if (role === "input.step" || role === "request.json") return "solver-input";
  if (role.startsWith("mesh.")) return "mesh";
  if (role === "result.json") return "solver-result";
  return "evidence";
}

function requiredOutput(
  evidence: CalculixIsolatedExecutionEvidence,
  role: string,
): CalculixIsolatedExecutionEvidence["outputs"][number] {
  const matches = evidence.outputs.filter((output) => output.role === role);
  if (matches.length !== 1) {
    throw commandError(
      "invalid_transition",
      `The isolated CalculiX evidence has no unique ${role} output.`,
    );
  }
  return matches[0]!;
}

function requiredOutputArtifact(
  artifacts: readonly ThreadArtifact[],
  role: string,
): ThreadArtifact {
  const prefix = `calculix-isolated-${role.replaceAll(".", "-")}-`;
  const matches = artifacts.filter((artifact) => artifact.id.startsWith(prefix));
  if (matches.length !== 1) {
    throw commandError(
      "invalid_transition",
      `The local CalculiX Thread branch has no unique ${role} artifact.`,
    );
  }
  return matches[0]!;
}

function consumption(
  id: string,
  artifactId: string,
  consumer: ThreadOperationRef,
  observedFingerprint: ContentFingerprint,
  verifiedAt: string,
): ThreadArtifactConsumption {
  return {
    id,
    artifactId,
    consumer,
    observedFingerprint,
    verifiedAt,
    status: "verified",
  };
}

function derived(
  from: string,
  to: string,
  rationale: string,
): ThreadProvenanceLink {
  return {
    id: `${from}-from-${to}`,
    relation: "derived_from",
    from: { kind: "artifact", id: from },
    to: { kind: "artifact", id: to },
    rationale,
  };
}

function uses(entry: ThreadArtifactConsumption): ThreadProvenanceLink {
  return {
    id: `${entry.id}-uses`,
    relation: "uses",
    from: { kind: "consumption", id: entry.id },
    to: { kind: "artifact", id: entry.artifactId },
    rationale: "Exact bytes were reread and fingerprint-attested.",
  };
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

function exactObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new TypeError(`${label} has unexpected fields.`);
  }
  return record;
}

function captureArtifact(value: unknown, label: string): ArtifactIdentity {
  const record = exactObject(value, ["id", "fingerprint", "producerRunId"], label);
  return {
    id: textValue(record.id, `${label}.id`),
    fingerprint: fingerprintValue(record.fingerprint, `${label}.fingerprint`),
    producerRunId: textValue(record.producerRunId, `${label}.producerRunId`),
  };
}

function captureStepArtifact(
  value: unknown,
): ArtifactIdentity & { readonly bytes: number } {
  const record = exactObject(
    value,
    ["id", "fingerprint", "producerRunId", "bytes"],
    "stepArtifact",
  );
  if (!Number.isSafeInteger(record.bytes) || Number(record.bytes) < 1) {
    throw new TypeError("stepArtifact.bytes must be a positive integer.");
  }
  return {
    id: textValue(record.id, "stepArtifact.id"),
    fingerprint: fingerprintValue(record.fingerprint, "stepArtifact.fingerprint"),
    producerRunId: textValue(record.producerRunId, "stepArtifact.producerRunId"),
    bytes: Number(record.bytes),
  };
}

function fingerprintValue(value: unknown, label: string): ContentFingerprint {
  const record = exactObject(value, ["algorithm", "digest"], label);
  if (
    record.algorithm !== "sha256" || typeof record.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.digest)
  ) {
    throw new TypeError(`${label} is not a SHA-256 fingerprint.`);
  }
  return { algorithm: "sha256", digest: record.digest };
}

function textValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new TypeError(`${label} must be non-empty text.`);
  }
  return value;
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
    if (
      !fingerprintsEqual(
        action.executor.profileFingerprint,
        profile.profileFingerprint,
      ) ||
      action.executor.id !== "casys-local-microsandbox" ||
      action.executor.contract.id !== "calculix-static-proof-v1" ||
      action.executor.contract.version !== "1.0.0" ||
      action.lowering.id !== profile.lowering.id ||
      action.lowering.version !== profile.lowering.version
    ) {
      throw commandError(
        "invalid_transition",
        "The resolved CalculiX plan does not bind the exact active local profile.",
      );
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
    if (
      stepBytes.byteLength !== stepSource.artifact.byteCount ||
      stepBytes.byteLength !== proof.step.bytes ||
      await fingerprintResourceBytes(stepBytes) !==
        geometryArtifact.fingerprint.digest
    ) {
      throw commandError(
        "invalid_transition",
        "Canonical STEP bytes do not match the sealed local CalculiX source.",
      );
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
    const capturedAt = evaluation.evaluationDispatchedAt;
    const freshness: ThreadFreshness = {
      status: "fresh",
      changedAt: capturedAt,
      invalidatedByChangeIds: [],
    };
    const localOperation: ThreadOperationRef = {
      serverId: "digital-thread",
      tool: "verify.run-fea-static-proof@3",
      runId: prepared.authorization.run.id,
    };
    const sysonOperation: ThreadOperationRef = {
      serverId: "syson",
      tool: "syson_constraint_evaluate",
      runId: `capture:${evaluation.reference.sha256}`,
    };
    const outputArtifacts = evidence.outputs.map((output) => ({
      id: outputArtifactId(output.role, output.sha256),
      name: `Local CalculiX ${output.role}`,
      kind: outputArtifactKind(output.role),
      version: output.sha256,
      fingerprint: { algorithm: "sha256" as const, digest: output.sha256 },
      uri: output.casUri,
      mediaType: output.mediaType,
      producer: localOperation,
      inputArtifactIds: output.role === "input.step"
        ? [prepared.geometryArtifact.id]
        : [
          outputArtifactId(
            "input.step",
            requiredOutput(evidence, "input.step").sha256,
          ),
          prepared.proofArtifact.id,
        ],
      freshness,
    } satisfies ThreadArtifact));
    if (outputArtifacts.length !== 9) {
      throw commandError(
        "invalid_transition",
        "The local CalculiX Thread branch requires exactly nine outputs.",
      );
    }
    const resultArtifact = requiredOutputArtifact(outputArtifacts, "result.json");
    const evidenceArtifact: ThreadArtifact = {
      id: `calculix-isolated-evidence-${evidence.fingerprint.digest}`,
      name: "Isolated local CalculiX execution evidence",
      kind: "evidence",
      version: evidence.fingerprint.digest,
      fingerprint: evidence.fingerprint,
      uri: this.d.executionEvidence.uriFor(evidence.fingerprint),
      mediaType: "application/json",
      producer: localOperation,
      inputArtifactIds: [
        prepared.proofArtifact.id,
        ...outputArtifacts.map((artifact) => artifact.id),
      ],
      freshness,
    };
    const evaluationArtifact: ThreadArtifact = {
      id: `calculix-isolated-syson-evaluation-${evaluation.reference.sha256}`,
      name: "SysON evaluation of isolated CalculiX evidence",
      kind: "evidence",
      version: evaluation.reference.sha256,
      fingerprint: { algorithm: "sha256", digest: evaluation.reference.sha256 },
      uri: evaluation.reference.uri,
      mediaType: "application/json",
      producer: localOperation,
      inputArtifactIds: [
        evidenceArtifact.id,
        resultArtifact.id,
        prepared.proofArtifact.id,
        prepared.requirementsArtifact.id,
      ],
      freshness,
    };
    const inputConsumptions: ThreadArtifactConsumption[] = [
      prepared.proofArtifact,
      prepared.geometryArtifact,
      prepared.requirementsArtifact,
    ].map((artifact) =>
      consumption(
        `calculix-isolated-input-${artifact.id}`,
        artifact.id,
        localOperation,
        artifact.fingerprint,
        capturedAt,
      )
    );
    const outputConsumptions = outputArtifacts.map((artifact) =>
      consumption(
        `calculix-isolated-cas-reread-${artifact.id}`,
        artifact.id,
        localOperation,
        artifact.fingerprint,
        capturedAt,
      )
    );
    const evidenceConsumption = consumption(
      `calculix-isolated-cas-reread-${evidenceArtifact.id}`,
      evidenceArtifact.id,
      localOperation,
      evidenceArtifact.fingerprint,
      capturedAt,
    );
    const observations: ThreadObservation[] = prepared.proof.case.requirements.map(
      (requirement) => {
        const metric = requirement.metric === "maximum-displacement"
          ? evidence.result.metrics.maximumDisplacement
          : evidence.result.metrics.maximumVonMises;
        return {
          id:
            `calculix-isolated-observation-${resultArtifact.fingerprint.digest}-${requirement.id}`,
          name: `${requirement.name} measured by local CalculiX`,
          metric: requirement.feature,
          quantity: { value: metric.value, unit: metric.unit },
          source: {
            operation: localOperation,
            artifactIds: [resultArtifact.id, evidenceArtifact.id],
            capturedAt,
          },
          freshness,
        };
      },
    );
    const requirementIds = new Map<string, string>();
    for (const requirement of prepared.proof.case.requirements) {
      const matches = prepared.authorization.basis.requirements.filter((candidate) =>
        candidate.trace.sourceArtifactId === prepared.requirementsArtifact.id &&
        candidate.criterion.metric === requirement.feature
      );
      if (matches.length !== 1) {
        throw commandError(
          "invalid_transition",
          `Proof requirement ${requirement.id} has no unique Thread requirement.`,
        );
      }
      requirementIds.set(requirement.id, matches[0]!.id);
    }
    const evaluations = feaEvaluationsFromOracle(
      evaluation.outcomes,
      prepared.proof.case.requirements,
      {
        verdictCaptureFp: evaluation.reference.sha256,
        evaluatedAt: capturedAt,
        evidenceArtifactId: evaluationArtifact.id,
        observationIds: observations.map((observation) => observation.id),
        threadRequirementIds: requirementIds,
        evaluator: sysonOperation,
      },
    );
    const violations: ThreadViolation[] = evaluations.flatMap((item) =>
      item.status === "fail"
        ? [{
          id: `${item.id}-violation`,
          name: `${item.name} exceeds the reviewed limit`,
          requirementId: item.requirementId,
          evaluationId: item.id,
          severity: "error" as const,
          status: "open" as const,
          detectedAt: capturedAt,
          observationIds: item.observationIds,
          evidenceArtifactIds: [evidenceArtifact.id, evaluationArtifact.id],
          summary: item.message,
          freshness,
        }]
        : []
    );
    const actions: ProposedThreadAction[] = violations.map((violation) => ({
      id: `${violation.id}-review`,
      name: `Review local CalculiX violation: ${violation.name}`,
      kind: "review",
      readiness: "ready",
      rationale: "A human review is required for a failed engineering constraint.",
      targets: [{ kind: "artifact", id: resultArtifact.id }],
      addressesViolationIds: [violation.id],
      dependsOnActionIds: [],
    }));
    const consumptions = [
      ...inputConsumptions,
      ...outputConsumptions,
      evidenceConsumption,
    ];
    const newArtifacts = [
      ...outputArtifacts,
      evidenceArtifact,
      evaluationArtifact,
    ];
    const provenance: ThreadProvenanceLink[] = [
      ...newArtifacts.flatMap((artifact) =>
        artifact.inputArtifactIds.map((inputArtifactId) =>
          derived(
            artifact.id,
            inputArtifactId,
            "The downstream local evidence was derived from this exact fingerprint-attested input.",
          )
        )
      ),
      ...consumptions.map(uses),
      ...observations.flatMap((observation) =>
        observation.source.artifactIds.map((artifactId) => ({
          id: `${observation.id}-from-${artifactId}`,
          relation: "derived_from" as const,
          from: { kind: "observation" as const, id: observation.id },
          to: { kind: "artifact" as const, id: artifactId },
          rationale:
            "The observation is reported by the exact local result and its durable execution evidence.",
        }))
      ),
      ...evaluations.flatMap((item) =>
        item.observationIds.map((observationId) => ({
          id: `${item.id}-uses-${observationId}`,
          relation: "uses" as const,
          from: { kind: "evaluation" as const, id: item.id },
          to: { kind: "observation" as const, id: observationId },
          rationale: "SysON evaluated this exact observed quantity.",
        }))
      ),
      ...evaluations.map((item) => ({
        id: `${item.id}-evaluates-requirement`,
        relation: "evaluates" as const,
        from: { kind: "evaluation" as const, id: item.id },
        to: { kind: "requirement" as const, id: item.requirementId },
        rationale: "SysON evaluated the reviewed Thread requirement.",
      })),
      ...evaluations.map((item) => ({
        id: `${item.id}-evidenced-by-capture`,
        relation: "evidences" as const,
        from: { kind: "evaluation" as const, id: item.id },
        to: { kind: "artifact" as const, id: evaluationArtifact.id },
        rationale: "The immutable SysON envelope is the evaluation evidence.",
      })),
    ];
    const extension: ThreadSnapshotExtension = {
      id: `calculix-isolated-${prepared.authorization.run.id}`,
      name: "Isolated local CalculiX static proof",
      subjectId: prepared.authorization.basis.subject.id,
      capturedAt,
      artifacts: newArtifacts,
      consumptions,
      observations,
      requirements: [],
      evaluations,
      violations,
      provenance,
      proposedActions: actions,
    };
    return applyThreadSnapshotExtensionIfNew(
      prepared.authorization.basis,
      extension,
      { appliedAt: capturedAt },
    ).snapshot;
  }

  async #readProofCapture(
    artifact: ThreadArtifact,
    expectedByteCount: number,
  ): Promise<ProofCapture> {
    const bytes = await this.#readExactArtifact(
      artifact,
      expectedByteCount,
      "Proof-case artifact",
    );
    const text = decodeUtf8(bytes, "FEA proof capture");
    let root: Record<string, unknown>;
    try {
      root = exactObject(JSON.parse(text), [
        "schemaVersion",
        "operation",
        "trustedRunId",
        "proofDigest",
        "canonicalProofText",
        "geometryArtifact",
        "stepArtifact",
        "requirementsArtifact",
        "requirementsElementId",
        "seedIdentity",
        "sealedAt",
      ], "FEA proof capture");
    } catch (cause) {
      throw commandError(
        "invalid_transition",
        `The FEA proof capture is not exact JSON: ${describe(cause)}.`,
      );
    }
    if (
      deterministicJson(root) !== text ||
      root.schemaVersion !== "fea-proof-case-capture/1.0"
    ) {
      throw commandError(
        "invalid_transition",
        "The FEA proof capture is not a canonical supported seal.",
      );
    }
    const operation = exactObject(
      root.operation,
      ["id", "version"],
      "proof operation",
    );
    if (operation.id !== "verify.seal-proof-case" || operation.version !== "1") {
      throw commandError(
        "invalid_transition",
        "The FEA proof capture was not produced by the proof-seal operation.",
      );
    }
    const proofText = textValue(root.canonicalProofText, "canonicalProofText");
    let proofCase: MechanicalProofCase;
    try {
      proofCase = validateMechanicalProofCase(JSON.parse(proofText));
    } catch (cause) {
      throw commandError(
        "invalid_transition",
        `The FEA proof case is invalid: ${describe(cause)}.`,
      );
    }
    const proofDigest = (await sha256Fingerprint(proofCase)).digest;
    if (
      canonicalProofText(proofCase) !== proofText ||
      textValue(root.proofDigest, "proofDigest") !== proofDigest
    ) {
      throw commandError(
        "invalid_transition",
        "The FEA proof capture does not bind canonical proof bytes.",
      );
    }
    const seed = exactObject(
      root.seedIdentity,
      ["editingContextId", "elementId"],
      "seedIdentity",
    );
    textValue(seed.editingContextId, "seedIdentity.editingContextId");
    textValue(seed.elementId, "seedIdentity.elementId");
    textValue(root.requirementsElementId, "requirementsElementId");
    const sealedAt = textValue(root.sealedAt, "sealedAt");
    if (new Date(sealedAt).toISOString() !== sealedAt) {
      throw commandError(
        "invalid_transition",
        "The FEA proof capture has no canonical seal timestamp.",
      );
    }
    return {
      case: proofCase,
      trustedRunId: textValue(root.trustedRunId, "trustedRunId"),
      geometry: captureArtifact(root.geometryArtifact, "geometryArtifact"),
      requirements: captureArtifact(
        root.requirementsArtifact,
        "requirementsArtifact",
      ),
      step: captureStepArtifact(root.stepArtifact),
    };
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
