/**
 * Recorded CalculiX executor for `verify.run-fea-static-proof@2`.
 *
 * This is deliberately a closed vertical: ROP2 admission, exact proof/CAS
 * inputs, private STEP staging, recorded solve/recovery and capture evidence
 * are all checked before an observation or a SysON evaluation is materialized.
 * It does not expose a provider tool name to an agent and never redispatches a
 * request after a durable dispatch intent exists.
 */

import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandOrigin,
  type EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../../domain/project/engineering-project-command-service.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import {
  fingerprintResolvedOperationPlanV2,
  type ResolvedCalculixStaticStructuralAction,
} from "../../domain/analysis/resolved-operation-plan-v2.ts";
import type { ResolvedRunPlanReader } from "../../domain/project/resolved-run-plan-sealer.ts";
import {
  type CalculixRecordedStaticCapturedResource,
  type CalculixRecordedStaticCompleted,
  type CalculixRecordedStaticEvidenceVerifier,
  type CalculixRecordedStaticPlan,
  type CalculixRecordedStaticReader,
  type CalculixRecordedStaticSolver,
} from "../../domain/analysis/calculix-recorded-capabilities.ts";
import {
  canonicalProviderResourceAcquisitionLedgerText,
  fingerprintResourceBytes,
  validateProviderResourceAcquisitionLedger,
} from "../../domain/analysis/provider-resource-reader.ts";
import { canonicalProofText } from "../../domain/analysis/fea-proof-proposal.ts";
import {
  type MechanicalProofCase,
  validateMechanicalProofCase,
} from "../../domain/analysis/mechanical-proof-case.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/types.ts";
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
} from "../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../domain/thread/thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import type { ProviderResourceCaptureResult } from "../captures/provider-resource-capture-service.ts";
import { validateProviderArtifactCaptureManifest } from "../captures/provider-artifact-capture-manifest.ts";
import {
  canonicalFeaSysonEvaluationCaptureText,
  FEA_SYSON_EVALUATION_CAPTURE_SCHEMA,
  validateFeaSysonEvaluationCapture,
} from "../captures/fea-syson-evaluation-capture.ts";
import type { FileByteStore } from "../captures/file-byte-store.ts";
import type { CanonicalAssetReader } from "./canonical-asset-reader.ts";
import type { ContainerAssetStager } from "./container-asset-stager.ts";
import { requiredStart, requireRun, snapshotRef } from "./executor-run-helpers.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import {
  assertThreadSnapshotLineageIntact,
  threadSnapshotDescendsFrom,
} from "../stores/thread-snapshot-lineage.ts";
import {
  requireResolvedRunPlanExecution,
  type ResolvedRunPlanExecutionAuthorization,
} from "../plans/resolved-run-plan-execution-guard.ts";
import {
  buildOracleValues,
  callCapturedFeaConstraintOracle,
  feaEvaluationsFromOracle,
  parseCapturedFeaConstraintOracleOutcome,
  prepareFeaConstraintOracleCall,
} from "../captures/fea-oracle-adapter.ts";
import type { McpToolClient } from "../mcp/http-mcp-tool-client.ts";
import {
  type CalculixRecordedStaticAttempt,
  type CalculixRecordedStaticCasReference,
  CalculixRecordedStaticOutcomeUnknownError,
  type CalculixRecordedStaticResource,
  FileCalculixRecordedStaticAttemptStore,
} from "../wal/file-calculix-recorded-static-attempt-store.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "./thread-write-basis-guard.ts";

export const VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION = {
  id: "verify.run-fea-static-proof",
  version: "2",
} as const;

const PROFILE = [
  ["input.step", "model/step"],
  ["request.json", "application/json"],
  ["mesh.geo", "text/plain"],
  ["mesh.inp", "text/plain"],
  ["gmsh.log", "text/plain"],
  ["job.inp", "text/plain"],
  ["ccx.log", "text/plain"],
  ["job.dat", "text/plain"],
  ["result.json", "application/json"],
] as const;

export interface VerifyRunFeaStaticProofV2RunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

/** Exact artifact reader: callers cannot pass an arbitrary CAS URI or digest. */
export interface ExactFeaPlanArtifactReader {
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
}

type CaptureResult = ProviderResourceCaptureResult<"calculix-recorded-manifest">;

export interface VerifyRunFeaStaticProofV2RunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly plans: ResolvedRunPlanReader;
  readonly artifacts: ExactFeaPlanArtifactReader;
  readonly canonicalAssets: CanonicalAssetReader;
  /** Code-owned directory paired with canonicalAssets and the private stager. */
  readonly canonicalAssetDirectory: string;
  readonly stager: ContainerAssetStager;
  readonly solver: CalculixRecordedStaticSolver;
  readonly runReader: CalculixRecordedStaticReader;
  readonly evidenceVerifier: CalculixRecordedStaticEvidenceVerifier;
  /** The only component permitted to execute exact provider resources/read. */
  readonly providerCaptures: {
    capture(input: {
      readonly provider: { readonly id: string; readonly runId: string };
      readonly resources: readonly CalculixRecordedStaticResource[];
    }): Promise<CaptureResult>;
  };
  readonly resourceCaptureStore: Pick<
    FileByteStore<"calculix-recorded-resource">,
    "read" | "uriFor"
  >;
  readonly ledgerCaptureStore: Pick<
    FileByteStore<"calculix-recorded-ledger">,
    "read" | "uriFor"
  >;
  readonly manifestCaptureStore: Pick<
    FileByteStore<"calculix-recorded-manifest">,
    "read" | "uriFor"
  >;
  /** CAS for the full exact SysON request/structured response envelope. */
  readonly sysonEvaluationCaptureStore: Pick<
    FileByteStore<"calculix-recorded-syson-evaluation">,
    "read" | "save" | "uriFor"
  >;
  readonly attempts: FileCalculixRecordedStaticAttemptStore;
  readonly syson: McpToolClient;
  readonly lease: EngineeringProjectRunLease;
  readonly now?: () => string;
}

interface ProofCapture {
  readonly case: MechanicalProofCase;
  readonly trustedRunId: string;
  readonly geometry: ArtifactIdentity;
  readonly requirements: ArtifactIdentity;
  readonly step: ArtifactIdentity & { readonly bytes: number };
}

interface ArtifactIdentity {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
}

interface Prepared {
  readonly authorization: ResolvedRunPlanExecutionAuthorization;
  readonly action: ResolvedCalculixStaticStructuralAction;
  readonly proof: ProofCapture;
  readonly proofArtifact: ThreadArtifact;
  readonly geometryArtifact: ThreadArtifact;
  readonly requirementsArtifact: ThreadArtifact;
  readonly stepBytes: Uint8Array;
  readonly planSha256: string;
  readonly solvePlan: CalculixRecordedStaticPlan;
  readonly containerFileName: string;
  readonly plannedContainerPath: string;
}

export class VerifyRunFeaStaticProofV2RunExecutor {
  readonly #now: () => string;

  constructor(private readonly d: VerifyRunFeaStaticProofV2RunExecutorDependencies) {
    this.#now = d.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyRunFeaStaticProofV2RunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw commandError(
        "permission_denied",
        "Only an authenticated agent may execute a recorded CalculiX run.",
      );
    }
    const project = await requiredProject(this.d.projects, command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status === "completed") return project;

    // This first read-only pass resolves the entire ROP/CAS/proof chain before
    // a lease, claim, Docker copy, provider resource read or solve call exists.
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
    command: VerifyRunFeaStaticProofV2RunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await requiredProject(this.d.projects, command.projectId);
    const before = requireRun(project, command.runId);
    if (before.status === "completed") return project;
    const prepared = await this.#prepare(project, command.runId, [
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
        summary: "Started the recorded CalculiX static-structural run.",
      });
    }
    const claimedProject = await requiredProject(this.d.projects, command.projectId);
    const claimedRun = requireRun(claimedProject, command.runId);
    if (claimedRun.status === "completed") return claimedProject;
    if (claimedRun.status !== "running" && claimedRun.status !== "publishing") {
      throw commandError(
        "invalid_transition",
        `Recorded CalculiX run ${claimedRun.id} is not claimable.`,
      );
    }
    const dispatchedAt = requiredStart(claimedRun);

    const existing = await this.d.attempts.read(command.projectId, command.runId);
    const attempt = await this.d.attempts.begin({
      projectId: command.projectId,
      runId: command.runId,
      planSha256: prepared.planSha256,
      requestId: prepared.action.requestId,
      preparedAt: this.#now(),
    });
    if (attempt.status === "completed") {
      return await this.#finishRecordedSnapshot(origin, command, attempt);
    }

    let capturedAttempt: CalculixRecordedStaticAttempt;
    let captured: {
      readonly manifest: Awaited<
        ReturnType<typeof validateProviderArtifactCaptureManifest>
      >;
      readonly reference: CalculixRecordedStaticCasReference;
    };
    if (hasCaptureManifest(attempt)) {
      capturedAttempt = attempt;
      captured = await this.#captureFromCas(attempt);
    } else {
      const known = await this.#ensureProviderRun(
        prepared,
        attempt,
        existing === undefined && attempt.status === "pre-dispatch",
        dispatchedAt,
      );
      captured = await this.#captureProvider(known);
      capturedAttempt = await this.d.attempts.recordResourcesCaptured({
        projectId: command.projectId,
        runId: command.runId,
        captureManifest: captured.reference,
      });
    }

    const completed = completedFromAttempt(capturedAttempt);
    await this.#requireExactCapturedLedger(captured.manifest, completed);
    const evidence = await this.#verifyEvidence(
      prepared.solvePlan,
      completed,
      captured.manifest,
    );
    const evaluation = await this.#ensureEvaluationCapture(
      prepared,
      capturedAttempt,
      evidence.result,
    );
    const snapshot = await this.#materializeSnapshot(
      prepared,
      captured.manifest,
      captured.reference,
      evidence.result,
      evaluation,
      completed.runId,
    );
    await this.d.snapshots.save(snapshot);
    await assertSnapshotReadback(this.d.snapshots, snapshot);
    await this.d.attempts.complete({
      projectId: command.projectId,
      runId: command.runId,
      snapshot: snapshotRef(snapshot),
    });
    const completedAttempt = await this.d.attempts.read(
      command.projectId,
      command.runId,
    );
    if (!completedAttempt) {
      throw new Error(
        "Recorded CalculiX completion journal disappeared after durable completion.",
      );
    }
    return await this.#finishRecordedSnapshot(origin, command, completedAttempt);
  }

  async #prepare(
    project: EngineeringProjectSnapshot,
    runId: string,
    statuses: readonly [
      "queued" | "running" | "publishing",
      ...("queued" | "running" | "publishing")[],
    ],
  ): Promise<Prepared> {
    const authorization = await requireResolvedRunPlanExecution({
      project,
      runId,
      expectedOperation: VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
      expectedRunStatuses: statuses,
      projects: this.d.projects,
      snapshots: this.d.snapshots,
      plans: this.d.plans,
    });
    if (authorization.plan.action.kind !== "static-structural-analysis") {
      throw commandError(
        "invalid_transition",
        "The resolved plan action is not the recorded CalculiX static action.",
      );
    }
    const action = authorization.plan.action;
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
      !declaredBase || declaredBase.id !== proof.case.project.baseThreadSnapshot.id ||
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
        "The proof case base ThreadSnapshot is not an exact ancestor of the run basis.",
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
      await fingerprintResourceBytes(stepBytes) !== geometryArtifact.fingerprint.digest
    ) {
      throw commandError(
        "invalid_transition",
        "Canonical STEP bytes do not match the sealed geometry source.",
      );
    }
    const containerFileName = `fea-${geometryArtifact.fingerprint.digest}.step`;
    const target = this.d.stager.resolveTarget({ containerFileName });
    const solvePlan = this.d.solver.resolve({
      requestId: action.requestId,
      proof: proof.case,
      inputArtifact: {
        fingerprint: geometryArtifact.fingerprint,
        byteCount: stepBytes.byteLength,
        stagedAsset: { location: target.containerPath },
      },
      elementOrder: action.input.effectiveElementOrder,
      timeoutMs: action.input.effectiveTimeoutMs,
    });
    if (solvePlan.requestId !== action.requestId) {
      throw commandError(
        "invalid_transition",
        "CalculiX lowering did not retain the ROP request id.",
      );
    }
    return {
      authorization,
      action,
      proof,
      proofArtifact,
      geometryArtifact,
      requirementsArtifact,
      stepBytes,
      planSha256: (await fingerprintResolvedOperationPlanV2(authorization.plan)).digest,
      solvePlan,
      containerFileName,
      plannedContainerPath: target.containerPath,
    };
  }

  async #ensureProviderRun(
    prepared: Prepared,
    attempt: CalculixRecordedStaticAttempt,
    isFreshAttempt: boolean,
    dispatchedAt: string,
  ): Promise<CalculixRecordedStaticAttempt> {
    let current = attempt;
    if (current.status === "pre-dispatch") {
      current = await this.d.attempts.markDispatched({
        projectId: current.projectId,
        runId: current.runId,
        dispatchedAt,
      });
    }
    if (current.status === "provider-run-known") {
      const recovered = await this.d.runReader.getByRequestId(
        prepared.action.requestId,
      );
      if (recovered.status !== "completed") {
        throw new CalculixRecordedStaticOutcomeUnknownError(
          `Recorded CalculiX provider recovery is ${recovered.status}; a second solve is forbidden.`,
        );
      }
      assertCompletedMatchesPlan(recovered, prepared);
      return await this.d.attempts.recordProviderRun({
        projectId: current.projectId,
        runId: current.runId,
        requestSha256: recovered.requestSha256,
        providerRunId: recovered.runId,
        resources: recovered.resources,
      });
    }
    if (current.status !== "dispatched") {
      throw new CalculixRecordedStaticOutcomeUnknownError(
        "Recorded CalculiX journal has no recoverable provider state.",
      );
    }

    const recovered = await this.d.runReader.getByRequestId(prepared.action.requestId);
    let completed: CalculixRecordedStaticCompleted;
    if (recovered.status === "completed") {
      completed = recovered;
    } else if (recovered.status === "not_found" && isFreshAttempt) {
      // The STEP is staged only for the one newly-created intent. Any existing
      // `dispatched` marker (including a prior crash) cannot reach solve.
      const staged = await this.d.stager.stage({
        sourcePath: `${
          this.d.canonicalAssetDirectory.replace(/\/+$/, "")
        }/${prepared.geometryArtifact.fingerprint.digest}.step`,
        expectedDigest: prepared.geometryArtifact.fingerprint.digest,
        expectedBytes: prepared.stepBytes.byteLength,
        containerFileName: prepared.containerFileName,
      });
      if (staged.containerPath !== prepared.plannedContainerPath) {
        throw commandError(
          "invalid_transition",
          "Private STEP staging returned a different code-owned provider path.",
        );
      }
      try {
        completed = await this.d.solver.solve(prepared.solvePlan);
      } catch (cause) {
        throw new CalculixRecordedStaticOutcomeUnknownError(
          `Recorded CalculiX solve may have reached the provider: ${describe(cause)}.`,
        );
      }
    } else {
      throw new CalculixRecordedStaticOutcomeUnknownError(
        `Recorded CalculiX recovery is ${recovered.status}; a second solve is forbidden.`,
      );
    }
    assertCompletedMatchesPlan(completed, prepared);
    return await this.d.attempts.recordProviderRun({
      projectId: current.projectId,
      runId: current.runId,
      requestSha256: completed.requestSha256,
      providerRunId: completed.runId,
      resources: completed.resources,
    });
  }

  async #captureProvider(attempt: CalculixRecordedStaticAttempt): Promise<
    {
      readonly manifest: Awaited<
        ReturnType<typeof validateProviderArtifactCaptureManifest>
      >;
      readonly reference: CalculixRecordedStaticCasReference;
    }
  > {
    const completed = completedFromAttempt(attempt);
    const result = await this.d.providerCaptures.capture({
      provider: { id: "mcp-calculix", runId: completed.runId },
      resources: completed.resources,
    });
    const reference = receiptReference(result.storedManifest);
    const manifestFingerprint = {
      algorithm: "sha256" as const,
      digest: reference.sha256,
    };
    if (
      reference.uri !== this.d.manifestCaptureStore.uriFor(manifestFingerprint) ||
      result.manifest.provider.id !== "mcp-calculix" ||
      result.manifest.provider.runId !== completed.runId ||
      reference.sha256 !== result.storedManifest.fingerprint.digest ||
      reference.byteCount !== result.storedManifest.byteCount ||
      !sameResourceSet(
        result.manifest.artifacts.map((entry) => ({
          role: entry.role,
          uri: entry.resource.uri,
          mediaType: entry.resource.mediaType,
          byteCount: entry.resource.byteCount,
          sha256: entry.resource.sha256,
        })),
        completed.resources,
      )
    ) {
      throw commandError(
        "invalid_transition",
        "Provider resource capture diverges from the acknowledged CalculiX resource ledger.",
      );
    }
    return { manifest: result.manifest, reference };
  }

  async #captureFromCas(
    attempt: Extract<CalculixRecordedStaticAttempt, {
      readonly captureManifest: CalculixRecordedStaticCasReference;
    }>,
  ): Promise<
    {
      readonly manifest: Awaited<
        ReturnType<typeof validateProviderArtifactCaptureManifest>
      >;
      readonly reference: CalculixRecordedStaticCasReference;
    }
  > {
    const reference = attempt.captureManifest;
    const fingerprint = { algorithm: "sha256" as const, digest: reference.sha256 };
    if (reference.uri !== this.d.manifestCaptureStore.uriFor(fingerprint)) {
      throw commandError(
        "invalid_transition",
        "Recorded CalculiX capture manifest WAL URI is not this exact local CAS object.",
      );
    }
    const opened = await this.d.manifestCaptureStore.read({
      ...fingerprint,
    });
    if (!opened || opened.byteLength !== reference.byteCount) {
      throw commandError(
        "invalid_transition",
        "Recorded CalculiX capture manifest is absent from exact local CAS.",
      );
    }
    const bytes = opened.copy();
    if (await fingerprintResourceBytes(bytes) !== reference.sha256) {
      throw commandError(
        "invalid_transition",
        "Recorded CalculiX capture manifest CAS bytes fail their exact hash.",
      );
    }
    const text = decodeUtf8(bytes, "Recorded CalculiX capture manifest");
    let manifest: Awaited<ReturnType<typeof validateProviderArtifactCaptureManifest>>;
    try {
      manifest = await validateProviderArtifactCaptureManifest(JSON.parse(text));
    } catch (cause) {
      throw commandError(
        "invalid_transition",
        `Recorded CalculiX capture manifest is invalid: ${describe(cause)}.`,
      );
    }
    if (
      deterministicJson(manifest) !== text ||
      manifest.provider.runId !== attempt.providerRunId ||
      !sameResourceSet(
        manifest.artifacts.map((entry) => ({
          role: entry.role,
          uri: entry.resource.uri,
          mediaType: entry.resource.mediaType,
          byteCount: entry.resource.byteCount,
          sha256: entry.resource.sha256,
        })),
        attempt.resources,
      )
    ) {
      throw commandError(
        "invalid_transition",
        "Recorded CalculiX capture manifest does not exactly bind the durable provider run.",
      );
    }
    return { manifest, reference };
  }

  async #requireExactCapturedLedger(
    manifest: Awaited<ReturnType<typeof validateProviderArtifactCaptureManifest>>,
    completed: CalculixRecordedStaticCompleted,
  ): Promise<void> {
    const fingerprint = manifest.ledger.fingerprint;
    if (manifest.ledger.casUri !== this.d.ledgerCaptureStore.uriFor(fingerprint)) {
      throw commandError(
        "invalid_transition",
        "Recorded CalculiX ledger manifest URI is not this exact local CAS object.",
      );
    }
    const opened = await this.d.ledgerCaptureStore.read(fingerprint);
    if (!opened || opened.byteLength !== manifest.ledger.byteCount) {
      throw commandError(
        "invalid_transition",
        "Recorded CalculiX acquisition ledger is absent from exact local CAS.",
      );
    }
    const bytes = opened.copy();
    if (await fingerprintResourceBytes(bytes) !== fingerprint.digest) {
      throw commandError(
        "invalid_transition",
        "Recorded CalculiX acquisition ledger fails its exact CAS hash.",
      );
    }
    const text = decodeUtf8(bytes, "Recorded CalculiX acquisition ledger");
    let ledger: ReturnType<typeof validateProviderResourceAcquisitionLedger>;
    try {
      ledger = validateProviderResourceAcquisitionLedger(JSON.parse(text));
    } catch (cause) {
      throw commandError(
        "invalid_transition",
        `Recorded CalculiX acquisition ledger is invalid: ${describe(cause)}.`,
      );
    }
    const manifestResources = manifest.artifacts.map((entry) => ({
      role: entry.role,
      uri: entry.resource.uri,
      mediaType: entry.resource.mediaType,
      byteCount: entry.resource.byteCount,
      sha256: entry.resource.sha256,
    }));
    if (
      canonicalProviderResourceAcquisitionLedgerText(ledger) !== text ||
      ledger.id !== manifest.ledger.id ||
      ledger.provider.id !== manifest.provider.id ||
      ledger.provider.runId !== manifest.provider.runId ||
      manifest.provider.id !== "mcp-calculix" ||
      manifest.provider.runId !== completed.runId ||
      !sameResourceSet(ledger.resources, completed.resources) ||
      !sameResourceSet(ledger.resources, manifestResources)
    ) {
      throw commandError(
        "invalid_transition",
        "Recorded CalculiX acquisition ledger does not exactly bind provider, run and resources.",
      );
    }
  }

  async #verifyEvidence(
    plan: CalculixRecordedStaticPlan,
    completed: CalculixRecordedStaticCompleted,
    manifest: Awaited<ReturnType<typeof validateProviderArtifactCaptureManifest>>,
  ) {
    const bytes: CalculixRecordedStaticCapturedResource[] = [];
    for (const resource of completed.resources) {
      const entry = manifest.artifacts.find((candidate) =>
        candidate.role === resource.role
      );
      const fingerprint = { algorithm: "sha256" as const, digest: resource.sha256 };
      if (
        !entry || entry.cas.uri !== this.d.resourceCaptureStore.uriFor(fingerprint) ||
        entry.cas.sha256 !== resource.sha256 ||
        entry.cas.byteCount !== resource.byteCount
      ) {
        throw commandError(
          "invalid_transition",
          `Captured CalculiX resource ${resource.role} is not this exact local CAS object.`,
        );
      }
      const opened = await this.d.resourceCaptureStore.read({
        ...fingerprint,
      });
      if (!opened || opened.byteLength !== resource.byteCount) {
        throw commandError(
          "invalid_transition",
          `Captured CalculiX resource ${resource.role} is absent from exact CAS.`,
        );
      }
      const copy = opened.copy();
      if (await fingerprintResourceBytes(copy) !== resource.sha256) {
        throw commandError(
          "invalid_transition",
          `Captured CalculiX resource ${resource.role} fails its exact CAS hash.`,
        );
      }
      bytes.push({ role: resource.role, bytes: copy });
    }
    return await this.d.evidenceVerifier.verifyCapturedEvidence(plan, completed, bytes);
  }

  /**
   * The SysON evaluation has the same recovery posture as the non-idempotent
   * solver call: a durable intent precedes the call, and an interrupted call
   * is outcome-unknown rather than an excuse to silently ask the oracle again.
   */
  async #ensureEvaluationCapture(
    prepared: Prepared,
    attempt: CalculixRecordedStaticAttempt,
    result: Awaited<
      ReturnType<CalculixRecordedStaticEvidenceVerifier["verifyCapturedEvidence"]>
    >["result"],
  ): Promise<{
    readonly reference: CalculixRecordedStaticCasReference;
    readonly outcomes: ReturnType<typeof parseCapturedFeaConstraintOracleOutcome>;
    readonly evaluationDispatchedAt: string;
  }> {
    const values = buildOracleValues({
      maxDisplacement: result.metrics.maximumDisplacement,
      maxVonMises: result.metrics.maximumVonMises,
    }, prepared.proof.case.requirements);
    const expectedRequest = prepareFeaConstraintOracleCall(
      prepared.proof.case.requirements,
      values,
    );
    if (attempt.status === "evaluation-dispatched") {
      throw new CalculixRecordedStaticOutcomeUnknownError(
        "Recorded SysON evaluation may have reached the provider; a second evaluation is forbidden.",
      );
    }
    if (attempt.status === "evaluation-captured" || attempt.status === "completed") {
      return await this.#readEvaluationCapture(
        attempt.evaluationCapture,
        attempt.evaluationDispatchedAt,
        expectedRequest,
        prepared.proof.case.requirements,
      );
    }
    if (attempt.status !== "resources-captured") {
      throw new CalculixRecordedStaticOutcomeUnknownError(
        "Recorded CalculiX journal has no durable resource capture for SysON evaluation.",
      );
    }
    const dispatched = await this.d.attempts.markEvaluationDispatched({
      projectId: attempt.projectId,
      runId: attempt.runId,
      evaluationDispatchedAt: this.#now(),
    });
    if (dispatched.status !== "evaluation-dispatched") {
      throw new CalculixRecordedStaticOutcomeUnknownError(
        "Recorded SysON evaluation journal did not retain the exact dispatch intent.",
      );
    }
    let recorded;
    try {
      recorded = await callCapturedFeaConstraintOracle(
        this.d.syson,
        prepared.proof.case.requirements,
        values,
      );
    } catch (cause) {
      throw new CalculixRecordedStaticOutcomeUnknownError(
        `Recorded SysON evaluation may have reached the provider: ${describe(cause)}.`,
      );
    }
    if (deterministicJson(recorded.request) !== deterministicJson(expectedRequest)) {
      throw commandError(
        "invalid_transition",
        "SysON evaluation call diverges from the exact proof-derived request.",
      );
    }
    const capture = validateFeaSysonEvaluationCapture({
      schemaVersion: FEA_SYSON_EVALUATION_CAPTURE_SCHEMA,
      request: recorded.request,
      response: { structuredContent: recorded.structuredContent },
    });
    const text = canonicalFeaSysonEvaluationCaptureText(capture);
    const bytes = new TextEncoder().encode(text);
    const digest = await fingerprintResourceBytes(bytes);
    const stored = await this.d.sysonEvaluationCaptureStore.save(
      { algorithm: "sha256", digest },
      bytes,
    );
    const reference = receiptReference(stored);
    const fingerprint = { algorithm: "sha256" as const, digest };
    if (reference.uri !== this.d.sysonEvaluationCaptureStore.uriFor(fingerprint)) {
      throw commandError(
        "invalid_transition",
        "Recorded SysON evaluation save receipt is not this exact local CAS object.",
      );
    }
    const durable = await this.#readEvaluationCapture(
      reference,
      dispatched.evaluationDispatchedAt,
      expectedRequest,
      prepared.proof.case.requirements,
    );
    const captured = await this.d.attempts.recordEvaluationCaptured({
      projectId: attempt.projectId,
      runId: attempt.runId,
      evaluationCapture: reference,
    });
    if (captured.status !== "evaluation-captured") {
      throw new Error("Recorded SysON evaluation capture journal did not advance.");
    }
    return durable;
  }

  async #readEvaluationCapture(
    reference: CalculixRecordedStaticCasReference,
    evaluationDispatchedAt: string,
    expectedRequest: ReturnType<typeof prepareFeaConstraintOracleCall>,
    requirements: MechanicalProofCase["requirements"],
  ): Promise<{
    readonly reference: CalculixRecordedStaticCasReference;
    readonly outcomes: ReturnType<typeof parseCapturedFeaConstraintOracleOutcome>;
    readonly evaluationDispatchedAt: string;
  }> {
    const fingerprint = { algorithm: "sha256" as const, digest: reference.sha256 };
    if (reference.uri !== this.d.sysonEvaluationCaptureStore.uriFor(fingerprint)) {
      throw commandError(
        "invalid_transition",
        "Recorded SysON evaluation WAL URI is not this exact local CAS object.",
      );
    }
    const opened = await this.d.sysonEvaluationCaptureStore.read(fingerprint);
    if (!opened || opened.byteLength !== reference.byteCount) {
      throw commandError(
        "invalid_transition",
        "Recorded SysON evaluation capture is absent from exact local CAS.",
      );
    }
    const bytes = opened.copy();
    if (await fingerprintResourceBytes(bytes) !== reference.sha256) {
      throw commandError(
        "invalid_transition",
        "Recorded SysON evaluation capture fails its exact CAS hash.",
      );
    }
    const text = decodeUtf8(bytes, "Recorded SysON evaluation capture");
    let capture: ReturnType<typeof validateFeaSysonEvaluationCapture>;
    try {
      capture = validateFeaSysonEvaluationCapture(JSON.parse(text));
    } catch (cause) {
      throw commandError(
        "invalid_transition",
        `Recorded SysON evaluation capture is invalid: ${describe(cause)}.`,
      );
    }
    if (
      canonicalFeaSysonEvaluationCaptureText(capture) !== text ||
      deterministicJson(capture.request) !== deterministicJson(expectedRequest)
    ) {
      throw commandError(
        "invalid_transition",
        "Recorded SysON evaluation capture does not bind the exact proof-derived request.",
      );
    }
    return {
      reference,
      evaluationDispatchedAt,
      outcomes: parseCapturedFeaConstraintOracleOutcome(
        capture.response.structuredContent,
        requirements,
      ),
    };
  }

  #materializeSnapshot(
    prepared: Prepared,
    manifest: Awaited<ReturnType<typeof validateProviderArtifactCaptureManifest>>,
    manifestReference: CalculixRecordedStaticCasReference,
    result: Awaited<
      ReturnType<CalculixRecordedStaticEvidenceVerifier["verifyCapturedEvidence"]>
    >["result"],
    evaluation: {
      readonly reference: CalculixRecordedStaticCasReference;
      readonly outcomes: ReturnType<typeof parseCapturedFeaConstraintOracleOutcome>;
      readonly evaluationDispatchedAt: string;
    },
    providerRunId: string,
  ): ThreadSnapshot {
    const capturedAt = evaluation.evaluationDispatchedAt;
    const freshness: ThreadFreshness = {
      status: "fresh",
      changedAt: capturedAt,
      invalidatedByChangeIds: [],
    };
    const provider: ThreadOperationRef = {
      serverId: "mcp-calculix",
      tool: "calculix_solve_static_recorded",
      runId: providerRunId,
    };
    const digitalThread: ThreadOperationRef = {
      serverId: "digital-thread",
      tool: "verify.run-fea-static-proof@2",
      runId: prepared.authorization.run.id,
    };
    const sysonOperation: ThreadOperationRef = {
      serverId: "syson",
      tool: "syson_constraint_evaluate",
      runId: `capture:${evaluation.reference.sha256}`,
    };
    const resourceArtifacts = manifest.artifacts.map((entry) =>
      resourceArtifact(entry, provider, freshness)
    );
    const resourceIds = new Map(
      manifest.artifacts.map((
        entry,
      ) => [entry.role, resourceArtifactId(entry.role, entry.cas.sha256)]),
    );
    const inputStepId = requiredMap(resourceIds, "input.step");
    const resultId = requiredMap(resourceIds, "result.json");
    const ledgerId = `calculix-ledger-${manifest.ledger.fingerprint.digest}`;
    const manifestId = `calculix-capture-manifest-${manifestReference.sha256}`;
    const ledgerArtifact: ThreadArtifact = {
      id: ledgerId,
      name: "CalculiX provider resource ledger",
      kind: "evidence",
      version: manifest.ledger.fingerprint.digest,
      fingerprint: manifest.ledger.fingerprint,
      uri: manifest.ledger.casUri,
      mediaType: "application/json",
      producer: digitalThread,
      inputArtifactIds: [],
      freshness,
    };
    const manifestArtifact: ThreadArtifact = {
      id: manifestId,
      name: "CalculiX captured provider artifact manifest",
      kind: "evidence",
      version: manifestReference.sha256,
      fingerprint: { algorithm: "sha256", digest: manifestReference.sha256 },
      uri: manifestReference.uri,
      mediaType: "application/json",
      producer: digitalThread,
      inputArtifactIds: [ledgerId, ...resourceArtifacts.map((artifact) => artifact.id)],
      freshness,
    };
    const resourceById = new Map(
      resourceArtifacts.map((artifact) => [artifact.id, artifact]),
    );
    const inputStep = requiredMap(resourceById, inputStepId);
    const resultArtifact = requiredMap(resourceById, resultId);
    const evaluationArtifact: ThreadArtifact = {
      id: `calculix-syson-evaluation-${evaluation.reference.sha256}`,
      name: "Recorded SysON FEA evaluation",
      kind: "evidence",
      version: evaluation.reference.sha256,
      fingerprint: { algorithm: "sha256", digest: evaluation.reference.sha256 },
      uri: evaluation.reference.uri,
      mediaType: "application/json",
      producer: digitalThread,
      inputArtifactIds: [
        prepared.proofArtifact.id,
        prepared.requirementsArtifact.id,
        resultArtifact.id,
      ],
      freshness,
    };
    const providerConsumptions: ThreadArtifactConsumption[] = [
      consumption(
        `calculix-consumed-source-step-${prepared.geometryArtifact.fingerprint.digest}`,
        prepared.geometryArtifact.id,
        provider,
        prepared.geometryArtifact.fingerprint,
        capturedAt,
      ),
      consumption(
        `calculix-consumed-captured-step-${inputStep.fingerprint.digest}`,
        inputStep.id,
        provider,
        inputStep.fingerprint,
        capturedAt,
      ),
    ];
    const captureConsumptions = [ledgerArtifact, ...resourceArtifacts].map((artifact) =>
      consumption(
        `calculix-capture-read-${artifact.id}`,
        artifact.id,
        digitalThread,
        artifact.fingerprint,
        capturedAt,
      )
    );

    // The provider's captured input proves that the private staged STEP matched
    // the exact geometry source. The solve request/result then derive only from
    // that provider-captured input, never a caller path.
    const inputArtifact = {
      ...inputStep,
      inputArtifactIds: [prepared.geometryArtifact.id],
    };
    const outputArtifacts = resourceArtifacts.map((artifact) => {
      if (artifact.id === inputStep.id) return inputArtifact;
      if (artifact.id === resultArtifact.id) {
        return { ...artifact, inputArtifactIds: [inputStep.id] };
      }
      return artifact;
    });
    const exactResultArtifact = outputArtifacts.find((artifact) =>
      artifact.id === resultId
    )!;
    const evaluationCaptureConsumptions = [
      prepared.proofArtifact,
      prepared.requirementsArtifact,
    ].map((artifact) =>
      consumption(
        `calculix-evaluation-capture-consumed-${artifact.id}`,
        artifact.id,
        digitalThread,
        artifact.fingerprint,
        capturedAt,
      )
    );
    const observations: ThreadObservation[] = prepared.proof.case.requirements.map(
      (requirement) => {
        const displacement = requirement.metric === "maximum-displacement";
        const metric = displacement
          ? result.metrics.maximumDisplacement
          : result.metrics.maximumVonMises;
        return {
          id:
            `calculix-observation-${exactResultArtifact.fingerprint.digest}-${requirement.id}`,
          name: `${requirement.name} measured by CalculiX`,
          metric: requirement.feature,
          quantity: { value: metric.value, unit: metric.unit },
          source: {
            operation: provider,
            artifactIds: [exactResultArtifact.id],
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
          `Proof requirement ${requirement.id} has no unique exact thread requirement.`,
        );
      }
      requirementIds.set(requirement.id, matches[0]!.id);
    }
    const evaluations = feaEvaluationsFromOracle(
      evaluation.outcomes,
      prepared.proof.case.requirements,
      {
        verdictCaptureFp: evaluationArtifact.fingerprint.digest,
        evaluatedAt: capturedAt,
        evidenceArtifactId: evaluationArtifact.id,
        observationIds: observations.map((observation) => observation.id),
        threadRequirementIds: requirementIds,
        evaluator: sysonOperation,
      },
    );
    const violations: ThreadViolation[] = evaluations.flatMap((evaluation) =>
      evaluation.status === "fail"
        ? [{
          id: `${evaluation.id}-violation`,
          name: `${evaluation.name} exceeds the reviewed limit`,
          requirementId: evaluation.requirementId,
          evaluationId: evaluation.id,
          severity: "error" as const,
          status: "open" as const,
          detectedAt: capturedAt,
          observationIds: evaluation.observationIds,
          evidenceArtifactIds: [evaluationArtifact.id, manifestArtifact.id],
          summary: evaluation.message,
          freshness,
        }]
        : []
    );
    const actions: ProposedThreadAction[] = violations.map((violation) => ({
      id: `${violation.id}-review`,
      name: `Review CalculiX limit violation: ${violation.name}`,
      kind: "review",
      readiness: "ready",
      rationale: "A human review is required for a failed engineering constraint.",
      targets: [{ kind: "artifact", id: exactResultArtifact.id }],
      addressesViolationIds: [violation.id],
      dependsOnActionIds: [],
    }));
    const allConsumptions = [
      ...providerConsumptions,
      ...captureConsumptions,
      ...evaluationCaptureConsumptions,
    ];
    const provenance: ThreadProvenanceLink[] = [
      derived(
        inputArtifact.id,
        prepared.geometryArtifact.id,
        "The provider-captured STEP is byte-identical to the exact staged geometry source.",
      ),
      derived(
        exactResultArtifact.id,
        inputArtifact.id,
        "CalculiX recorded result derives from its captured STEP input.",
      ),
      derived(
        evaluationArtifact.id,
        exactResultArtifact.id,
        "The durable SysON evaluation request was derived from exact captured CalculiX observations.",
      ),
      derived(
        evaluationArtifact.id,
        prepared.proofArtifact.id,
        "The durable SysON request contains constraints derived from the exact sealed proof case.",
      ),
      derived(
        evaluationArtifact.id,
        prepared.requirementsArtifact.id,
        "The durable SysON request evaluates the exact requirements capture bound by the sealed proof.",
      ),
      ...[ledgerArtifact, ...outputArtifacts].map((artifact) =>
        derived(
          manifestArtifact.id,
          artifact.id,
          "The persisted capture manifest records this exact reread CAS object.",
        )
      ),
      ...allConsumptions.map((entry) => uses(entry)),
      ...observations.map((observation) => ({
        id: `${observation.id}-from-result`,
        relation: "derived_from" as const,
        from: { kind: "observation" as const, id: observation.id },
        to: { kind: "artifact" as const, id: exactResultArtifact.id },
        rationale: "The observation is reported by the exact captured CalculiX result.",
      })),
      ...evaluations.flatMap((evaluation) =>
        evaluation.observationIds.map((id) => ({
          id: `${evaluation.id}-uses-${id}`,
          relation: "uses" as const,
          from: { kind: "evaluation" as const, id: evaluation.id },
          to: { kind: "observation" as const, id },
          rationale:
            "SysON evaluated this exact observed CalculiX quantity against the reviewed constraint.",
        }))
      ),
      ...evaluations.map((evaluation) => ({
        id: `${evaluation.id}-from-result`,
        relation: "evaluates" as const,
        from: { kind: "evaluation" as const, id: evaluation.id },
        to: { kind: "requirement" as const, id: evaluation.requirementId },
        rationale:
          "SysON evaluated the reviewed requirement against the captured CalculiX observation.",
      })),
      ...evaluations.map((item) => ({
        id: `${item.id}-evidenced-by-syson-capture`,
        relation: "evidences" as const,
        from: { kind: "evaluation" as const, id: item.id },
        to: { kind: "artifact" as const, id: evaluationArtifact.id },
        rationale:
          "The immutable SysON request and structured response capture is the evaluation evidence.",
      })),
    ];
    const extension: ThreadSnapshotExtension = {
      id: `calculix-recorded-${prepared.authorization.run.id}`,
      name: "Recorded CalculiX static proof",
      subjectId: prepared.authorization.basis.subject.id,
      capturedAt,
      artifacts: [
        ...outputArtifacts,
        ledgerArtifact,
        manifestArtifact,
        evaluationArtifact,
      ],
      consumptions: allConsumptions,
      observations,
      requirements: [],
      evaluations,
      violations,
      provenance,
      proposedActions: actions,
    };
    const applied = applyThreadSnapshotExtensionIfNew(
      prepared.authorization.basis,
      extension,
      { appliedAt: capturedAt },
    );
    return applied.snapshot;
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
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
      root = parsed as Record<string, unknown>;
    } catch (cause) {
      throw commandError(
        "invalid_transition",
        `FEA proof capture is not JSON: ${describe(cause)}.`,
      );
    }
    const keys = [
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
    ];
    if (
      Object.keys(root).sort().join("\0") !== [...keys].sort().join("\0") ||
      deterministicJson(root) !== text ||
      root.schemaVersion !== "fea-proof-case-capture/1.0"
    ) {
      throw commandError(
        "invalid_transition",
        "FEA proof capture is not exact canonical seal bytes.",
      );
    }
    const operation = exactObject(root.operation, ["id", "version"], "proof operation");
    if (operation.id !== "verify.seal-proof-case" || operation.version !== "1") {
      throw commandError(
        "invalid_transition",
        "FEA proof capture was not produced by the proof seal operation.",
      );
    }
    const proofText = textValue(root.canonicalProofText, "canonicalProofText");
    let proofCase: MechanicalProofCase;
    try {
      proofCase = validateMechanicalProofCase(JSON.parse(proofText));
    } catch (cause) {
      throw commandError(
        "invalid_transition",
        `FEA proof case is invalid: ${describe(cause)}.`,
      );
    }
    const digest = await fingerprintResourceBytes(new TextEncoder().encode(proofText));
    if (
      canonicalProofText(proofCase) !== proofText ||
      textValue(root.proofDigest, "proofDigest") !== digest
    ) {
      throw commandError(
        "invalid_transition",
        "FEA proof capture does not bind canonical proof bytes.",
      );
    }
    return {
      case: proofCase,
      trustedRunId: textValue(root.trustedRunId, "trustedRunId"),
      geometry: captureArtifact(root.geometryArtifact, "geometryArtifact"),
      requirements: captureArtifact(root.requirementsArtifact, "requirementsArtifact"),
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
        `${label} CAS bytes are absent or do not match the bound URI, byte count and fingerprint.`,
      );
    }
    return Uint8Array.from(bytes);
  }

  async #finishRecordedSnapshot(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyRunFeaStaticProofV2RunExecutorCommand,
    attempt: CalculixRecordedStaticAttempt,
  ): Promise<EngineeringProjectSnapshot> {
    if (attempt.status !== "completed") {
      throw new Error("Recorded CalculiX completion journal is missing.");
    }
    const snapshot = await this.d.snapshots.get(attempt.snapshot.snapshotId);
    if (
      !snapshot || snapshot.id !== attempt.snapshot.snapshotId ||
      snapshot.revision !== attempt.snapshot.revision ||
      snapshot.subject.id !== attempt.snapshot.subjectId
    ) {
      throw commandError(
        "invalid_transition",
        "Recorded CalculiX completion snapshot is absent.",
      );
    }
    const project = await requiredProject(this.d.projects, command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status === "completed") return project;
    if (run.status === "running") {
      await this.d.commands.publishRun(origin, {
        ...command,
        commandId: `${command.commandId}:publish`,
        expectedRevision: project.revision,
        summary: "Published recorded CalculiX evidence.",
      });
    }
    const publishing = await requiredProject(this.d.projects, command.projectId);
    if (requireRun(publishing, command.runId).status === "completed") return publishing;
    return await this.d.commands.completeRun(origin, {
      ...command,
      commandId: `${command.commandId}:complete`,
      expectedRevision: publishing.revision,
      summary: "Completed recorded CalculiX static proof.",
      resultSnapshot: snapshotRef(validateThreadSnapshot(snapshot)),
      evidenceRefs: [
        ...validateThreadSnapshot(snapshot).artifacts
          .filter((artifact) =>
            artifact.producer.runId === attempt.providerRunId ||
            artifact.producer.runId === command.runId
          )
          .map((artifact) => ({
            snapshotId: snapshot.id,
            snapshotRevision: snapshot.revision,
            kind: "artifact" as const,
            id: artifact.id,
          })),
      ],
    });
  }
}

function assertProofMatchesAuthorization(
  authorization: ResolvedRunPlanExecutionAuthorization,
  action: ResolvedCalculixStaticStructuralAction,
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
    proof.case.authorization.workItemId !== authorization.workItem.id ||
    proof.case.authorization.decisionId !== authorization.decision.id ||
    proof.case.id !== action.input.proofCase.id ||
    !fingerprintsEqual(proofArtifact.fingerprint, action.input.proofCase.fingerprint) ||
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
    deterministicJson([...proofArtifact.inputArtifactIds].sort()) !==
      deterministicJson(ids)
  ) {
    throw commandError(
      "invalid_transition",
      "Proof, MRTR authority, geometry and exact basis artifacts do not cross-attest.",
    );
  }
}

function assertCompletedMatchesPlan(
  completed: CalculixRecordedStaticCompleted,
  prepared: Prepared,
): void {
  if (
    completed.requestId !== prepared.action.requestId ||
    completed.resources.length !== PROFILE.length ||
    !completed.resources.every((resource, index) =>
      resource.role === PROFILE[index]![0] && resource.mediaType === PROFILE[index]![1]
    ) ||
    !completed.resources.some((resource) =>
      resource.role === "input.step" &&
      resource.sha256 === prepared.geometryArtifact.fingerprint.digest &&
      resource.byteCount === prepared.stepBytes.byteLength
    )
  ) {
    throw commandError(
      "invalid_transition",
      "Recorded CalculiX completion does not match the closed ROP request or exact STEP.",
    );
  }
}

function completedFromAttempt(
  attempt: CalculixRecordedStaticAttempt,
): CalculixRecordedStaticCompleted {
  if (
    attempt.status !== "provider-run-known" &&
    attempt.status !== "resources-captured" &&
    attempt.status !== "evaluation-dispatched" &&
    attempt.status !== "evaluation-captured" &&
    attempt.status !== "completed"
  ) {
    throw new CalculixRecordedStaticOutcomeUnknownError();
  }
  return {
    status: "completed",
    requestId: attempt.requestId,
    requestSha256: attempt.requestSha256,
    runId: attempt.providerRunId,
    resources: attempt.resources.map((resource) => ({
      uri: resource.uri,
      mediaType: resource.mediaType,
      byteCount: resource.byteCount,
      sha256: resource.sha256,
      role: resource.role,
    })),
  };
}

function hasCaptureManifest(
  attempt: CalculixRecordedStaticAttempt,
): attempt is Extract<CalculixRecordedStaticAttempt, {
  readonly captureManifest: CalculixRecordedStaticCasReference;
}> {
  return "captureManifest" in attempt;
}

function requiredBoundArtifact(
  auth: ResolvedRunPlanExecutionAuthorization,
  binding: string,
): ThreadArtifact {
  const artifact = auth.artifactsByBinding.get(binding);
  if (!artifact) {
    throw commandError(
      "invalid_transition",
      `Resolved plan source ${binding} is absent.`,
    );
  }
  return artifact;
}

function requiredBasisArtifact(basis: ThreadSnapshot, id: string): ThreadArtifact {
  const matches = basis.artifacts.filter((artifact) => artifact.id === id);
  if (matches.length !== 1) {
    throw commandError(
      "invalid_transition",
      `Exact basis artifact ${id} is absent or ambiguous.`,
    );
  }
  return matches[0]!;
}

function requiredSource(auth: ResolvedRunPlanExecutionAuthorization, binding: string) {
  const source = auth.plan.sources.find((candidate) =>
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

function resourceArtifact(
  entry: Awaited<
    ReturnType<typeof validateProviderArtifactCaptureManifest>
  >["artifacts"][number],
  producer: ThreadOperationRef,
  freshness: ThreadFreshness,
): ThreadArtifact {
  const kind = entry.role === "input.step" || entry.role === "request.json"
    ? "solver-input"
    : entry.role.startsWith("mesh.")
    ? "mesh"
    : entry.role === "result.json"
    ? "solver-result"
    : "evidence";
  return {
    id: resourceArtifactId(entry.role, entry.cas.sha256),
    name: `CalculiX ${entry.role}`,
    kind,
    version: entry.cas.sha256,
    fingerprint: { algorithm: "sha256", digest: entry.cas.sha256 },
    uri: entry.cas.uri,
    mediaType: entry.resource.mediaType,
    producer,
    inputArtifactIds: [],
    freshness,
  };
}

function resourceArtifactId(role: string, digest: string): string {
  return `calculix-${role.replaceAll(".", "-")}-${digest}`;
}

function receiptReference(receipt: {
  readonly uri: string;
  readonly byteCount: number;
  readonly fingerprint: ContentFingerprint;
}): CalculixRecordedStaticCasReference {
  if (
    receipt.fingerprint.algorithm !== "sha256" ||
    !receipt.uri.endsWith(`/sha256/${receipt.fingerprint.digest}`)
  ) {
    throw new TypeError(
      "Provider capture receipt does not name an exact canonical CAS object.",
    );
  }
  return {
    uri: receipt.uri,
    byteCount: receipt.byteCount,
    sha256: receipt.fingerprint.digest,
  };
}

function sameResourceSet(
  left: readonly CalculixRecordedStaticResource[],
  right: readonly CalculixRecordedStaticResource[],
): boolean {
  const byRole = (resources: readonly CalculixRecordedStaticResource[]) =>
    resources.toSorted((first, second) =>
      first.role < second.role ? -1 : first.role > second.role ? 1 : 0
    );
  return deterministicJson(byRole(left)) === deterministicJson(byRole(right));
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

function derived(from: string, to: string, rationale: string): ThreadProvenanceLink {
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
    rationale:
      "Exact bytes were reread and fingerprint-attested by the consuming operation.",
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
  const fp = exactObject(
    record.fingerprint,
    ["algorithm", "digest"],
    `${label}.fingerprint`,
  );
  if (
    fp.algorithm !== "sha256" || typeof fp.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fp.digest)
  ) {
    throw new TypeError(`${label}.fingerprint is not sha256.`);
  }
  return {
    id: textValue(record.id, `${label}.id`),
    fingerprint: { algorithm: "sha256", digest: fp.digest },
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
    throw new TypeError("stepArtifact.bytes must be positive.");
  }
  const fp = exactObject(
    record.fingerprint,
    ["algorithm", "digest"],
    "stepArtifact.fingerprint",
  );
  if (
    fp.algorithm !== "sha256" || typeof fp.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fp.digest)
  ) {
    throw new TypeError("stepArtifact.fingerprint is not sha256.");
  }
  return {
    id: textValue(record.id, "stepArtifact.id"),
    fingerprint: { algorithm: "sha256", digest: fp.digest },
    producerRunId: textValue(record.producerRunId, "stepArtifact.producerRunId"),
    bytes: Number(record.bytes),
  };
}

function textValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be non-empty text.`);
  }
  return value;
}

function requiredMap<T>(map: ReadonlyMap<string, T>, key: string): T {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Missing required value: ${key}.`);
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
    throw new Error("Recorded CalculiX ThreadSnapshot was not durably reread.");
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
