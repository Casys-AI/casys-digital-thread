/**
 * Fixed executor for the one-action `simulate.run-modelica-scenario@2` plan.
 *
 * ROP2 is admitted and every sealed source is reread before the lease, claim,
 * or provider boundary.  There is no caller-supplied tool, path, command, or
 * provider argument.  The WAL is the only authority for post-dispatch routes.
 */

import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandOrigin,
  type EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../../domain/project/engineering-project-command-service.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type { ResolvedRunPlanReader } from "../../domain/project/resolved-run-plan-sealer.ts";
import {
  fingerprintResolvedOperationPlanV2,
  type ResolvedOperationPlanSource,
  type ResolvedOperationPlanV2,
} from "../../domain/analysis/resolved-operation-plan-v2.ts";
import {
  canonicalSimulationCaseText,
  type SimulationCase,
  validateSimulationCase,
} from "../../domain/analysis/simulation-case.ts";
import {
  canonicalModelicaQualifiedManifestDocumentText,
  expectedModelicaResumableResources,
  type ModelicaQualifiedManifestDocument,
  type ModelicaResumableCapturedEvidence,
  type ModelicaResumableCapturedEvidenceNormalizer,
  type ModelicaResumableCompletedRun,
  type ModelicaResumableEvidenceVerifier,
  type ModelicaResumableRequest,
  type ModelicaResumableRequestReader,
  type ModelicaResumableSubmission,
  type ModelicaResumableSubmitter,
  validateModelicaQualifiedManifestDocument,
} from "../../domain/analysis/modelica-resumable-capabilities.ts";
import {
  canonicalProviderResourceAcquisitionLedgerText,
  compareAsciiCodeUnits,
  fingerprintResourceBytes,
  validateProviderResourceAcquisitionLedger,
} from "../../domain/analysis/provider-resource-reader.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../domain/thread/thread-snapshot-extension.ts";
import type {
  ThreadArtifact,
  ThreadEntityKind,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  canonicalModelicaSimulationCaseQualificationCaptureText,
  decodeExactUtf8,
  validateModelicaSimulationCaseQualificationCapture,
} from "../captures/modelica-simulation-case-qualification-capture.ts";
import {
  canonicalModelicaQualifiedSourceCaptureText,
  type ModelicaQualifiedSourceCaptureDocument,
  validateModelicaQualifiedSourceCaptureDocument,
} from "../captures/modelica-qualified-source-capture.ts";
import {
  type ProviderResourceCaptureService,
} from "../captures/provider-resource-capture-service.ts";
import {
  validateProviderArtifactCaptureManifest,
} from "../captures/provider-artifact-capture-manifest.ts";
import { FileByteStore } from "../captures/file-byte-store.ts";
import {
  FileModelicaRecordedScenarioAttemptStore,
  type ModelicaRecordedEvidence,
  type ModelicaRecordedProviderResource,
  type ModelicaRecordedScenarioAttempt,
  ModelicaRecordedScenarioAttemptIntegrityError,
  ModelicaRecordedScenarioOutcomeUnknownError,
} from "../wal/file-modelica-recorded-scenario-attempt-store.ts";
import { requireResolvedRunPlanExecution } from "../plans/resolved-run-plan-execution-guard.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "./thread-write-basis-guard.ts";
import {
  requireBasis,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";
import { SIMULATE_RUN_MODELICA_SCENARIO_V2_OPERATION } from "../../orchestration/operations/recorded-analysis.ts";

const QUEUED = ["queued"] as const;
const LIVE = ["running", "publishing"] as const;

export interface SimulateRunModelicaScenarioV2RunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

/** Read exact local CAS bytes; it intentionally has no discovery capability. */
export interface RecordedAnalysisCasReader {
  read(
    expected: {
      readonly uri: string;
      readonly byteCount: number;
      readonly sha256: string;
      readonly mediaType: string;
    },
  ): Promise<Uint8Array | undefined>;
}

export interface SimulateRunModelicaScenarioV2RunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly plans: ResolvedRunPlanReader;
  readonly lease: EngineeringProjectRunLease;
  readonly attempts: FileModelicaRecordedScenarioAttemptStore;
  readonly sources: RecordedAnalysisCasReader;
  readonly provider:
    & ModelicaResumableSubmitter
    & ModelicaResumableRequestReader
    & ModelicaResumableEvidenceVerifier
    & ModelicaResumableCapturedEvidenceNormalizer;
  readonly captures: ProviderResourceCaptureService<
    "modelica-recorded-resource",
    "modelica-recorded-resource-ledger",
    "modelica-recorded-resource-manifest"
  >;
  readonly capturedResources: FileByteStore<"modelica-recorded-resource">;
  readonly captureLedgers: FileByteStore<"modelica-recorded-resource-ledger">;
  readonly captureManifests: FileByteStore<"modelica-recorded-resource-manifest">;
  readonly now?: () => string;
}

/**
 * Observational only: captures the exact Modelica result and metrics.  It does
 * not evaluate requirements, invent a verdict, or influence a decision.
 */
export class SimulateRunModelicaScenarioV2RunExecutor {
  readonly #now: () => string;
  constructor(
    private readonly d: SimulateRunModelicaScenarioV2RunExecutorDependencies,
  ) {
    this.#now = d.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: SimulateRunModelicaScenarioV2RunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw commandError(
        "permission_denied",
        "Only an authenticated agent can execute the recorded Modelica run.",
      );
    }

    // No lease, project claim, WAL, or provider operation occurs before both
    // ROP2 admission and source-byte cross-attestation have succeeded.
    const preClaimProject = await requiredProject(this.d.projects, command.projectId);
    const preClaimRun = requireRun(preClaimProject, command.runId);
    if (preClaimRun.status === "completed") {
      return completedProject(preClaimProject, command);
    }
    const admitted = await requireResolvedRunPlanExecution({
      project: preClaimProject,
      runId: command.runId,
      expectedOperation: SIMULATE_RUN_MODELICA_SCENARIO_V2_OPERATION,
      expectedRunStatuses: preClaimRun.status === "queued" ? QUEUED : LIVE,
      projects: this.d.projects,
      snapshots: this.d.snapshots,
      plans: this.d.plans,
    });
    const sealed = await this.#reopenSealedInputs(admitted.plan.sources, admitted.plan);
    return await this.d.lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(preClaimRun),
      async () => await this.#executeLeased(origin, command, sealed),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: SimulateRunModelicaScenarioV2RunExecutorCommand,
    expected: SealedModelicaInputs,
  ): Promise<EngineeringProjectSnapshot> {
    let project = await requiredProject(this.d.projects, command.projectId);
    let run = requireRun(project, command.runId);
    if (run.status === "completed") return completedProject(project, command);
    if (run.status === "queued") {
      await assertThreadWriteBasisAvailable(project, run);
      await this.d.commands.claimRun(origin, {
        ...command,
        commandId: step(command.commandId, "claim"),
        expectedRevision: project.revision,
        summary: "Started the planned recorded Modelica scenario.",
      });
      project = await requiredProject(this.d.projects, command.projectId);
      run = requireRun(project, command.runId);
    }
    if (run.status !== "running" && run.status !== "publishing") {
      throw unexpectedStatus(run, "running or publishing");
    }

    // The plan is reread after claim too, so a concurrent project revision
    // cannot swap authorization between the pre-lease and provider boundary.
    const admitted = await requireResolvedRunPlanExecution({
      project,
      runId: command.runId,
      expectedOperation: SIMULATE_RUN_MODELICA_SCENARIO_V2_OPERATION,
      expectedRunStatuses: LIVE,
      projects: this.d.projects,
      snapshots: this.d.snapshots,
      plans: this.d.plans,
    });
    const sealed = await this.#reopenSealedInputs(admitted.plan.sources, admitted.plan);
    if (deterministicJson(sealed) !== deterministicJson(expected)) {
      throw commandError(
        "invalid_transition",
        "Recorded Modelica source bytes changed between pre-claim and post-claim rereads.",
      );
    }
    const planSha256 = (await fingerprintResolvedOperationPlanV2(admitted.plan)).digest;
    const submission = submissionFor(admitted.plan, sealed);
    let attempt = await this.d.attempts.begin({
      projectId: command.projectId,
      runId: command.runId,
      planSha256,
      requestId: submission.requestId,
      manifestSha256: submission.manifest.fingerprint,
      preparedAt: this.#now(),
    });
    // A `dispatched` recovery readback already contains the completed run.
    // Reuse it for this invocation after persisting provider-run-known; the
    // next invocation still reopens by request id from the WAL only.
    let readback: ModelicaResumableRequest | undefined;

    if (attempt.status === "pre-dispatch") {
      attempt = await this.d.attempts.markDispatched({
        projectId: command.projectId,
        runId: command.runId,
        dispatchedAt: this.#now(),
      });
      // Mark-before-send: even a thrown transport call is never submitted again.
      const request = await this.d.provider.submit(submission).catch((cause) => {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new ModelicaRecordedScenarioOutcomeUnknownError(
          `Modelica submit failed after the durable dispatched marker: ${detail}`,
        );
      });
      attempt = await this.#recordKnownRequest(command, submission, attempt, request);
    }
    if (attempt.status === "dispatched") {
      readback = await this.d.provider.getRequest(submission);
      attempt = await this.#recordKnownRequest(
        command,
        submission,
        attempt,
        readback,
      );
    }
    if (attempt.status === "provider-run-known") {
      // A known provider run is always re-opened by request id, never submitted.
      const request = readback ?? await this.d.provider.getRequest(submission);
      const completed = requireCompletedRequest(request, attempt, submission);
      const capture = await this.#captureProviderResources(submission, completed);
      const evidence = await this.#verifyCaptured(
        submission,
        completed,
        capture.captured,
      );
      attempt = await this.d.attempts.recordResourcesCaptured({
        projectId: command.projectId,
        runId: command.runId,
        resources: capture.resources.map(resourceTuple),
        captureManifest: capture.captureManifest,
        evidence: evidenceForWal(evidence),
      });
    }
    if (attempt.status === "resources-captured") {
      // Strictly offline path: all provider facts are reread from our CAS.
      const captured = await this.#reopenCapture(attempt, submission);
      const basis = requireBasis(run);
      const base = await exactBasis(this.d.snapshots, basis);
      const materialized = materializeSnapshot(
        base,
        run.id,
        admitted.plan.sources,
        captured,
      );
      await this.d.snapshots.save(materialized);
      await exactSnapshotReadback(this.d.snapshots, materialized);
      attempt = await this.d.attempts.complete({
        projectId: command.projectId,
        runId: command.runId,
        snapshot: snapshotRef(materialized),
      });
    }
    if (attempt.status !== "completed") {
      throw new ModelicaRecordedScenarioOutcomeUnknownError();
    }

    project = await requiredProject(this.d.projects, command.projectId);
    run = requireRun(project, command.runId);
    if (run.status === "running") {
      await this.d.commands.publishRun(origin, {
        ...command,
        commandId: step(command.commandId, "publish"),
        expectedRevision: project.revision,
        summary:
          "Publishing recorded Modelica observations and exact provider resources.",
      });
      project = await requiredProject(this.d.projects, command.projectId);
      run = requireRun(project, command.runId);
    }
    if (run.status === "publishing") {
      const snapshot = await exactSnapshot(this.d.snapshots, attempt.snapshot);
      await this.d.commands.completeRun(origin, {
        ...command,
        commandId: step(command.commandId, "complete"),
        expectedRevision: project.revision,
        summary:
          "Published recorded Modelica observations without a requirement verdict.",
        resultSnapshot: snapshotRef(snapshot),
        evidenceRefs: snapshot.artifacts.filter((artifact) =>
          artifact.producer.runId === command.runId
        ).map((artifact) => ({
          snapshotId: snapshot.id,
          snapshotRevision: snapshot.revision,
          kind: "artifact" as ThreadEntityKind,
          id: artifact.id,
        })),
      });
    }
    return completedProject(
      await requiredProject(this.d.projects, command.projectId),
      command,
    );
  }

  async #recordKnownRequest(
    command: SimulateRunModelicaScenarioV2RunExecutorCommand,
    submission: ModelicaResumableSubmission,
    attempt: ModelicaRecordedScenarioAttempt,
    request: ModelicaResumableRequest,
  ): Promise<ModelicaRecordedScenarioAttempt> {
    if (request.status !== "completed" || !request.completedRun) {
      throw new ModelicaRecordedScenarioOutcomeUnknownError(
        `Modelica request ${submission.requestId} is ${request.status}; it remains recoverable by request_get.`,
      );
    }
    if (
      request.requestId !== submission.requestId ||
      request.manifestSha256 !== submission.manifest.fingerprint
    ) {
      throw new ModelicaRecordedScenarioOutcomeUnknownError(
        "Modelica request readback does not match the sealed request identity.",
      );
    }
    if (attempt.status !== "dispatched" && attempt.status !== "provider-run-known") {
      throw new ModelicaRecordedScenarioOutcomeUnknownError();
    }
    return await this.d.attempts.recordProviderRun({
      projectId: command.projectId,
      runId: command.runId,
      requestSha256: request.requestSha256,
      manifestSha256: request.manifestSha256,
      providerRunId: request.completedRun.runId,
    });
  }

  async #captureProviderResources(
    submission: ModelicaResumableSubmission,
    completed: ModelicaResumableCompletedRun,
  ): Promise<{
    readonly resources: readonly ReturnType<
      typeof expectedModelicaResumableResources
    >[number][];
    readonly captureManifest: {
      readonly uri: string;
      readonly byteCount: number;
      readonly sha256: string;
    };
    /** Provider tuple plus the distinct DT-owned CAS reread location. */
    readonly captured: readonly CapturedModelicaResource[];
  }> {
    const resources = expectedModelicaResumableResources({
      requestId: submission.requestId,
      requestSha256: completed.requestSha256,
      manifestSha256: completed.manifestSha256,
      status: "completed",
      completedRun: completed,
    });
    assertModelicaResourceProfile(
      resources,
      submission.manifest.parameterSchema !== undefined,
      completed.status,
    );
    const result = await this.d.captures.capture({
      provider: { id: "mcp-modelica", runId: completed.runId },
      resources,
    });
    return {
      resources,
      captureManifest: {
        uri: result.storedManifest.uri,
        byteCount: result.storedManifest.byteCount,
        sha256: result.storedManifest.fingerprint.digest,
      },
      captured: result.manifest.artifacts.map((artifact) => ({
        role: artifact.role,
        resource: artifact.resource,
        cas: artifact.cas,
      })),
    };
  }

  async #verifyCaptured(
    submission: ModelicaResumableSubmission,
    completed: ModelicaResumableCompletedRun,
    captured: readonly CapturedModelicaResource[],
  ): Promise<ModelicaResumableCapturedEvidence> {
    const resources = await Promise.all(
      captured.map(async ({ role, resource, cas }) => ({
        role,
        bytes: await exactByteStoreRead(this.d.capturedResources, {
          ...cas,
          mediaType: resource.mediaType,
        }),
      })),
    );
    return await this.d.provider.verifyCapturedEvidence(
      submission,
      completed,
      resources,
    );
  }

  async #reopenCapture(
    attempt: Extract<ModelicaRecordedScenarioAttempt, { status: "resources-captured" }>,
    submission: ModelicaResumableSubmission,
  ): Promise<ReopenedCapture> {
    const manifestBytes = await exactByteStoreRead(this.d.captureManifests, {
      ...attempt.captureManifest,
      mediaType: "application/json",
    });
    const manifestText = decodeExactUtf8(
      manifestBytes,
      "Recorded Modelica capture manifest",
    );
    const manifest = await validateProviderArtifactCaptureManifest(
      JSON.parse(manifestText),
    );
    if (
      deterministicJson(manifest) !== manifestText ||
      manifest.provider.id !== "mcp-modelica" ||
      manifest.provider.runId !== attempt.providerRunId
    ) {
      throw new Error(
        "Recorded Modelica capture manifest is not bound to the durable provider run.",
      );
    }
    const ledgerBytes = await exactByteStoreRead(this.d.captureLedgers, {
      uri: manifest.ledger.casUri,
      byteCount: manifest.ledger.byteCount,
      sha256: manifest.ledger.fingerprint.digest,
      mediaType: "application/json",
    });
    const ledgerText = decodeExactUtf8(
      ledgerBytes,
      "Recorded Modelica acquisition ledger",
    );
    const ledger = validateProviderResourceAcquisitionLedger(JSON.parse(ledgerText));
    if (
      canonicalProviderResourceAcquisitionLedgerText(ledger) !== ledgerText ||
      ledger.provider.id !== "mcp-modelica" ||
      ledger.provider.runId !== attempt.providerRunId
    ) {
      throw new Error(
        "Recorded Modelica acquisition ledger is not canonical or does not bind the provider run.",
      );
    }
    const expected = [...attempt.resources].sort((a, b) =>
      compareAsciiCodeUnits(a.role, b.role)
    );
    if (
      deterministicJson(ledger.resources) !== deterministicJson(expected) ||
      manifest.artifacts.length !== expected.length
    ) {
      throw new Error(
        "Recorded Modelica capture does not cover the durable exact resource set.",
      );
    }
    const resources = await Promise.all(expected.map(async (resource) => {
      const entry = manifest.artifacts.find((candidate) =>
        candidate.role === resource.role
      );
      if (
        !entry ||
        deterministicJson(entry.resource) !==
          deterministicJson({
            uri: resource.uri,
            mediaType: resource.mediaType,
            byteCount: resource.byteCount,
            sha256: resource.sha256,
          })
      ) {
        throw new Error(
          `Recorded Modelica capture manifest diverges for ${resource.role}.`,
        );
      }
      const bytes = await exactByteStoreRead(this.d.capturedResources, {
        ...entry.cas,
        mediaType: resource.mediaType,
      });
      return { resource, bytes, casUri: entry.cas.uri };
    }));
    const normalized = await this.d.provider.normalizeCapturedEvidence(
      submission,
      resources.map(({ resource, bytes }) => ({
        role: resource.role,
        resource: {
          uri: resource.uri,
          mediaType: resource.mediaType,
          byteCount: resource.byteCount,
          sha256: resource.sha256,
        },
        bytes,
      })),
    );
    const evidence = evidenceForWal(normalized);
    if (deterministicJson(evidence) !== deterministicJson(attempt.evidence)) {
      throw new ModelicaRecordedScenarioAttemptIntegrityError(
        "Recorded Modelica WAL evidence diverges from the exact CAS capture.",
      );
    }
    return { resources, evidence };
  }

  async #reopenSealedInputs(
    sources: readonly ResolvedOperationPlanSource[],
    _plan: ResolvedOperationPlanV2,
  ): Promise<SealedModelicaInputs> {
    const byBinding = new Map(sources.map((source) => [source.bindingName, source]));
    const required = [
      "simulationCase",
      "methodManifest",
      "qualificationAuthority",
      "modelSource",
      "scenarioSource",
    ];
    for (const name of required) {
      if (!byBinding.has(name)) {
        throw new Error(`Resolved Modelica plan is missing ${name}.`);
      }
    }
    const caseSource = byBinding.get("simulationCase")!;
    const manifestSource = byBinding.get("methodManifest")!;
    const authoritySource = byBinding.get("qualificationAuthority")!;
    const caseText = decodeExactUtf8(
      await this.#readSource(caseSource),
      "Resolved simulation case",
    );
    const simulationCase = validateSimulationCase(JSON.parse(caseText));
    if (canonicalSimulationCaseText(simulationCase) !== caseText) {
      throw new Error("Resolved simulation case CAS bytes are not canonical.");
    }
    const manifestText = decodeExactUtf8(
      await this.#readSource(manifestSource),
      "Resolved Modelica manifest",
    );
    const manifest = await validateModelicaQualifiedManifestDocument(
      JSON.parse(manifestText),
    );
    if (
      await canonicalModelicaQualifiedManifestDocumentText(manifest) !== manifestText
    ) throw new Error("Resolved Modelica manifest CAS bytes are not canonical.");
    const authorityText = decodeExactUtf8(
      await this.#readSource(authoritySource),
      "Modelica qualification authority",
    );
    const authority = validateModelicaSimulationCaseQualificationCapture(
      JSON.parse(authorityText),
    );
    if (
      canonicalModelicaSimulationCaseQualificationCaptureText(authority) !==
        authorityText
    ) throw new Error("Modelica qualification authority CAS bytes are not canonical.");
    const sourceCaptureBytes = await this.d.sources.read({
      uri: authority.sourceCapture.uri,
      byteCount: authority.sourceCapture.byteCount,
      sha256: authority.sourceCapture.sha256,
      mediaType: "application/json",
    });
    if (
      !sourceCaptureBytes ||
      sourceCaptureBytes.byteLength !== authority.sourceCapture.byteCount ||
      await fingerprintResourceBytes(sourceCaptureBytes) !==
        authority.sourceCapture.sha256
    ) {
      throw new Error("Modelica qualification source capture is absent or divergent.");
    }
    const sourceCaptureText = decodeExactUtf8(
      sourceCaptureBytes,
      "Modelica qualification source capture",
    );
    const sourceCapture = validateModelicaQualifiedSourceCaptureDocument(
      JSON.parse(sourceCaptureText),
    );
    if (
      canonicalModelicaQualifiedSourceCaptureText(sourceCapture) !==
        sourceCaptureText
    ) {
      throw new Error(
        "Modelica qualification source capture CAS bytes are not canonical.",
      );
    }
    assertQualificationBindings({
      sources,
      byBinding,
      caseSource,
      manifestSource,
      simulationCase,
      manifest,
      authority,
      sourceCapture,
    });
    return { simulationCase, manifest, authority };
  }

  async #readSource(source: ResolvedOperationPlanSource): Promise<Uint8Array> {
    const bytes = await this.d.sources.read({
      uri: source.artifact.casUri,
      byteCount: source.artifact.byteCount,
      sha256: source.artifact.fingerprint.digest,
      mediaType: source.artifact.mediaType,
    });
    if (
      !bytes || bytes.byteLength !== source.artifact.byteCount ||
      await fingerprintResourceBytes(bytes) !== source.artifact.fingerprint.digest
    ) {
      throw new Error(
        `Resolved Modelica source ${source.bindingName} is absent or diverges from its exact CAS reference.`,
      );
    }
    return Uint8Array.from(bytes);
  }
}

interface CapturedModelicaResource {
  readonly role: string;
  readonly resource: {
    readonly uri: string;
    readonly mediaType: string;
    readonly byteCount: number;
    readonly sha256: string;
  };
  readonly cas: {
    readonly uri: string;
    readonly byteCount: number;
    readonly sha256: string;
  };
}

interface SealedModelicaInputs {
  readonly simulationCase: SimulationCase;
  readonly manifest: ModelicaQualifiedManifestDocument;
  readonly authority: ReturnType<
    typeof validateModelicaSimulationCaseQualificationCapture
  >;
}
interface ReopenedCapture {
  readonly resources: readonly {
    readonly resource: ModelicaRecordedProviderResource;
    readonly bytes: Uint8Array;
    readonly casUri: string;
  }[];
  readonly evidence: ModelicaRecordedEvidence;
}

function submissionFor(
  plan: ResolvedOperationPlanV2,
  sealed: SealedModelicaInputs,
): ModelicaResumableSubmission {
  if (plan.action?.kind !== "dynamic-system-simulation") {
    throw new Error("Resolved operation plan is not a Modelica simulation action.");
  }
  if (
    plan.action.provider.id !== "mcp-modelica" ||
    plan.action.provider.contract.id !== "resumable" ||
    plan.action.provider.contract.version !== "2.1" ||
    plan.expectedProviderResources.resourceProfile.id !==
      "mcp-modelica.resumable-artifacts" ||
    plan.expectedProviderResources.resourceProfile.version !== "2.1" ||
    plan.recovery.policy !== "mcp-modelica.resumable-recovery@2.1" ||
    plan.recovery.mode !== "same-request-readback-no-blind-redispatch" ||
    plan.action.requestId !== plan.recovery?.requestId ||
    plan.action.input.simulationCase.id !== sealed.simulationCase.id ||
    plan.action.input.simulationCase.sourceBinding !== "simulationCase" ||
    plan.action.input.simulationCase.fingerprint.digest !==
      sealed.authority.caseDigest ||
    plan.action.input.methodManifestSourceBinding !== "methodManifest" ||
    plan.action.input.providerManifestFingerprint?.digest !==
      sealed.manifest.fingerprint ||
    plan.action.input.effectiveTimeoutMs !== sealed.simulationCase.timeoutMs ||
    plan.action.input.scenarioStartTimeSeconds !==
      sealed.manifest.scenarioPublic.startTimeS ||
    plan.action.lowering.id !== sealed.manifest.lowering.id ||
    plan.action.lowering.version !== sealed.manifest.lowering.version ||
    plan.action.normalizer.id !== sealed.manifest.resultNormalizer.id ||
    plan.action.normalizer.version !== sealed.manifest.resultNormalizer.version
  ) {
    throw new Error(
      "Resolved Modelica action diverges from its sealed case or manifest.",
    );
  }
  const resources = plan.expectedProviderResources;
  // resourceProfile.id is the discriminant of the ROP2 resource family.
  if (
    resources.resourceProfile.id !== "mcp-modelica.resumable-artifacts" ||
    !("parameterSchema" in resources) ||
    resources.parameterSchema !==
      (sealed.manifest.parameterSchema === undefined ? "absent" : "required")
  ) {
    throw new Error(
      "Resolved Modelica resource profile does not match the sealed method manifest.",
    );
  }
  return {
    requestId: plan.action.requestId,
    manifest: sealed.manifest,
    parameters: Object.fromEntries(
      sealed.simulationCase.parameters.map((
        parameter,
      ) => [parameter.id, { value: parameter.value, unit: parameter.unit }]),
    ),
    timeoutMs: sealed.simulationCase.timeoutMs,
  };
}

function requireCompletedRequest(
  request: ModelicaResumableRequest,
  attempt: Extract<ModelicaRecordedScenarioAttempt, { status: "provider-run-known" }>,
  submission: ModelicaResumableSubmission,
): ModelicaResumableCompletedRun {
  if (request.status !== "completed" || !request.completedRun) {
    throw new ModelicaRecordedScenarioOutcomeUnknownError(
      `Modelica request ${submission.requestId} is ${request.status}; it remains recoverable by request_get.`,
    );
  }
  if (
    request.requestId !== submission.requestId ||
    request.requestSha256 !== attempt.requestSha256 ||
    request.manifestSha256 !== submission.manifest.fingerprint ||
    request.completedRun.runId !== attempt.providerRunId
  ) {
    throw new Error(
      "Modelica request_get does not match durable provider-run-known identity.",
    );
  }
  return request.completedRun;
}

function assertModelicaResourceProfile(
  resources: readonly { readonly role: string; readonly mediaType: string }[],
  parameterSchemaRequired: boolean,
  status: ModelicaResumableCompletedRun["status"],
): void {
  const roles = new Map(
    resources.map((resource) => [resource.role, resource.mediaType]),
  );
  const always = [
    ["request", "application/json"],
    ["resolved_parameters", "application/json"],
    ["model", "text/x-modelica"],
    ["scenario", "application/json"],
    ["script", "text/plain"],
    ["diagnostics", "text/plain"],
    ["evidence", "application/json"],
    ["run.json", "application/json"],
  ] as const;
  for (const [role, mediaType] of always) {
    if (roles.get(role) !== mediaType) {
      throw new Error(`Modelica provider resource profile lacks ${role}.`);
    }
  }
  if (parameterSchemaRequired !== roles.has("parameter_schema")) {
    throw new Error(
      "Modelica provider parameter-schema resource does not match the sealed method.",
    );
  }
  if (status === "succeeded" && !roles.has("result")) {
    throw new Error("A completed Modelica run must capture result.csv.");
  }
  if (roles.size !== resources.length) {
    throw new Error("Modelica provider resource roles are not unique.");
  }
}

function resourceTuple(
  resource: {
    readonly role: string;
    readonly uri: string;
    readonly mediaType: string;
    readonly byteCount: number;
    readonly sha256: string;
  },
): ModelicaRecordedProviderResource {
  return {
    role: resource.role,
    uri: resource.uri,
    mediaType: resource.mediaType,
    byteCount: resource.byteCount,
    sha256: resource.sha256,
  };
}

function evidenceForWal(
  value: ModelicaResumableCapturedEvidence,
): ModelicaRecordedEvidence {
  return {
    runId: value.runId,
    status: value.status,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    resolvedParameters: value.resolvedParameters,
    metrics: value.metrics,
    warnings: value.warnings,
  };
}

async function exactByteStoreRead<K extends string>(
  store: FileByteStore<K>,
  expected: {
    readonly uri: string;
    readonly byteCount: number;
    readonly sha256: string;
    readonly mediaType: string;
  },
): Promise<Uint8Array> {
  const fingerprint = { algorithm: "sha256" as const, digest: expected.sha256 };
  if (store.uriFor(fingerprint) !== expected.uri) {
    throw new Error("CAS reference uses a foreign namespace.");
  }
  const bytes = await store.read(fingerprint);
  if (
    !bytes || bytes.byteLength !== expected.byteCount ||
    await fingerprintResourceBytes(bytes.copy()) !== expected.sha256
  ) throw new Error("CAS bytes are absent or do not match their exact resource tuple.");
  return bytes.copy();
}

function assertQualificationBindings(input: {
  readonly sources: readonly ResolvedOperationPlanSource[];
  readonly byBinding: ReadonlyMap<string, ResolvedOperationPlanSource>;
  readonly caseSource: ResolvedOperationPlanSource;
  readonly manifestSource: ResolvedOperationPlanSource;
  readonly simulationCase: SimulationCase;
  readonly manifest: ModelicaQualifiedManifestDocument;
  readonly authority: ReturnType<
    typeof validateModelicaSimulationCaseQualificationCapture
  >;
  readonly sourceCapture: ModelicaQualifiedSourceCaptureDocument;
}): void {
  const {
    sources,
    byBinding,
    caseSource,
    manifestSource,
    simulationCase,
    manifest,
    authority,
    sourceCapture,
  } = input;
  if (
    authority.simulationCase.sha256 !== caseSource.artifact.fingerprint.digest ||
    authority.simulationCase.uri !== caseSource.artifact.casUri ||
    authority.manifest.sha256 !== manifestSource.artifact.fingerprint.digest ||
    authority.manifest.uri !== manifestSource.artifact.casUri ||
    authority.caseDigest !== caseSource.artifact.fingerprint.digest ||
    authority.manifest.sha256 !== manifestSource.artifact.fingerprint.digest ||
    simulationCase.kit.modelId !== manifest.selection.modelId ||
    simulationCase.kit.modelVersion !== manifest.selection.modelVersion ||
    simulationCase.scenario.id !== manifest.selection.scenarioId ||
    simulationCase.kit.modelSha256 !== manifest.model.sha256 ||
    simulationCase.scenario.sha256 !== manifest.scenarioProjectionSha256
  ) {
    throw new Error(
      "Modelica case, manifest, and qualification authority do not cross-bind exactly.",
    );
  }
  if (
    deterministicJson(sourceCapture.selection) !==
      deterministicJson(manifest.selection) ||
    sourceCapture.manifestFingerprint !== manifest.fingerprint ||
    sourceCapture.artifacts.length !== authority.sources.length
  ) {
    throw new Error(
      "Modelica qualification source capture does not bind the exact qualified manifest.",
    );
  }
  const expectedRoles = [
    "model",
    "scenario",
    ...(manifest.parameterSchema === undefined ? [] : ["parameter_schema"]),
  ];
  if (
    authority.sources.length !== expectedRoles.length ||
    sourceCapture.artifacts.length !== expectedRoles.length ||
    expectedRoles.some((role) =>
      !authority.sources.some((source) => source.role === role) ||
      !sourceCapture.artifacts.some((source) => source.role === role)
    )
  ) {
    throw new Error(
      "Modelica qualification authority does not cover the closed source profile.",
    );
  }
  const expectedBindings = [
    "simulationCase",
    "methodManifest",
    "qualificationAuthority",
    "modelSource",
    "scenarioSource",
    ...(manifest.parameterSchema ? ["parameterSchema"] : []),
  ];
  if (
    sources.length !== expectedBindings.length ||
    expectedBindings.some((name) => !byBinding.has(name))
  ) {
    throw new Error(
      "Resolved Modelica sources are not the closed qualified source set.",
    );
  }
  for (const source of authority.sources) {
    const binding = source.role === "model"
      ? "modelSource"
      : source.role === "scenario"
      ? "scenarioSource"
      : "parameterSchema";
    const planSource = byBinding.get(binding);
    if (
      !planSource || planSource.artifact.casUri !== source.cas.uri ||
      planSource.artifact.fingerprint.digest !== source.cas.sha256 ||
      planSource.artifact.byteCount !== source.cas.byteCount ||
      planSource.artifact.mediaType !== source.mediaType
    ) {
      throw new Error(
        `Modelica qualification source ${source.role} does not match the resolved plan.`,
      );
    }
    const captured = sourceCapture.artifacts.find((entry) =>
      entry.role === source.role
    );
    if (
      !captured || captured.resource.uri !== source.resourceUri ||
      captured.resource.mediaType !== source.mediaType ||
      captured.resource.byteCount !== source.cas.byteCount ||
      captured.resource.sha256 !== source.cas.sha256 ||
      captured.cas.uri !== source.cas.uri ||
      captured.cas.byteCount !== source.cas.byteCount ||
      captured.cas.sha256 !== source.cas.sha256
    ) {
      throw new Error(
        `Modelica qualification source capture diverges for ${source.role}.`,
      );
    }
  }
}

function materializeSnapshot(
  base: ThreadSnapshot,
  runId: string,
  sources: readonly ResolvedOperationPlanSource[],
  capture: ReopenedCapture,
): ThreadSnapshot {
  // The artifact is materialized by this trusted DT run, whereas the
  // observation still names the provider run that produced the measurements.
  // Collapsing the two identities makes completeRun unable to bind its exact
  // evidence refs; erasing the provider identity would be false provenance.
  const materializationOperation = {
    serverId: "digital-thread",
    tool: "simulate.run-modelica-scenario@2",
    runId,
  };
  const providerOperation = {
    serverId: "mcp-modelica",
    tool: "modelica_simulation_submit",
    runId: capture.evidence.runId,
  };
  const fresh = {
    status: "fresh" as const,
    changedAt: capture.evidence.completedAt,
    invalidatedByChangeIds: [],
  };
  const sourceIds = sources.map((source) => source.threadRef.id);
  const artifacts: ThreadArtifact[] = capture.resources.map(({ resource, casUri }) => ({
    id: `modelica-v2-${runId}-${resource.role}-${resource.sha256.slice(0, 12)}`,
    name: `Recorded Modelica ${resource.role}`,
    kind: resource.role === "model"
      ? "simulation-model"
      : resource.role === "script"
      ? "script"
      : resource.role === "result"
      ? "solver-result"
      : "evidence",
    version: resource.sha256.slice(0, 12),
    fingerprint: { algorithm: "sha256", digest: resource.sha256 },
    uri: casUri,
    mediaType: resource.mediaType,
    producer: materializationOperation,
    inputArtifactIds: sourceIds,
    freshness: fresh,
  }));
  const evidenceArtifact = artifacts.find((artifact) =>
    artifact.name === "Recorded Modelica evidence"
  );
  if (!evidenceArtifact) {
    throw new Error("Recorded Modelica resource capture lacks evidence.json.");
  }
  const runArtifact = artifacts.find((artifact) =>
    artifact.name === "Recorded Modelica run.json"
  );
  if (!runArtifact) {
    throw new Error("Recorded Modelica resource capture lacks run.json.");
  }
  const observations = Object.keys(capture.evidence.metrics).sort().map((metric) => ({
    id: `modelica-v2-${runId}-observation-${metric}`,
    name: `Recorded Modelica ${metric}`,
    metric,
    quantity: capture.evidence.metrics[metric]!,
    source: {
      operation: providerOperation,
      // evidence.json attests the metric; run.json attests the provider run
      // identity named above. Both exact captured bytes remain independently
      // inspectable from the resulting ThreadSnapshot.
      artifactIds: [evidenceArtifact.id, runArtifact.id],
      capturedAt: capture.evidence.completedAt,
    },
    freshness: fresh,
  }));
  const extension: ThreadSnapshotExtension = {
    id: `simulate-run-modelica-scenario-v2-${runId}`,
    name: "Recorded Modelica observations",
    subjectId: base.subject.id,
    capturedAt: capture.evidence.completedAt,
    artifacts,
    consumptions: sources.map((source) => ({
      id: `consume-${source.threadRef.id}-by-${runId}`,
      artifactId: source.threadRef.id,
      consumer: materializationOperation,
      observedFingerprint: source.artifact.fingerprint,
      verifiedAt: capture.evidence.completedAt,
      status: "verified" as const,
    })),
    observations,
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      ...sources.map((source) => ({
        id: `uses-${source.threadRef.id}-by-${runId}`,
        relation: "uses" as const,
        from: {
          kind: "consumption" as const,
          id: `consume-${source.threadRef.id}-by-${runId}`,
        },
        to: { kind: "artifact" as const, id: source.threadRef.id },
        rationale:
          "The fixed recorded Modelica execution reread this sealed source by exact CAS identity.",
      })),
      ...artifacts.flatMap((artifact) =>
        sources.map((source) => ({
          id: `derived-${artifact.id}-from-${source.threadRef.id}`,
          relation: "derived_from" as const,
          from: { kind: "artifact" as const, id: artifact.id },
          to: { kind: "artifact" as const, id: source.threadRef.id },
          rationale:
            "This recorded provider resource belongs to the fixed run over the sealed Modelica inputs.",
        }))
      ),
      ...observations.flatMap((observation) =>
        [evidenceArtifact, runArtifact].map((artifact) => ({
          id: `evidences-${observation.id}-from-${artifact.id}`,
          relation: "derived_from" as const,
          from: { kind: "observation" as const, id: observation.id },
          to: { kind: "artifact" as const, id: artifact.id },
          rationale: artifact.id === evidenceArtifact.id
            ? "The provider evidence resource records this observed Modelica metric."
            : "The provider run ledger attests the exact provider-run identity of this observation.",
        }))
      ),
    ],
    proposedActions: [],
    bindingProofs: [{
      provider: "mcp-modelica",
      kind: "recorded-run",
      id: capture.evidence.runId,
    }],
  };
  return validateThreadSnapshot(
    applyThreadSnapshotExtensionIfNew(base, extension, {
      appliedAt: capture.evidence.completedAt,
    }).snapshot,
  );
}

async function requiredProject(
  store: EngineeringProjectRevisionStore,
  projectId: string,
): Promise<EngineeringProjectSnapshot> {
  const project = await store.get(projectId);
  if (!project) {
    throw commandError(
      "project_not_found",
      `Engineering project ${projectId} does not exist.`,
    );
  }
  return project;
}
async function exactBasis(
  store: ThreadSnapshotStore,
  basis: ReturnType<typeof requireBasis>,
): Promise<ThreadSnapshot> {
  const snapshot = await store.get(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision || snapshot.subject.id !== basis.subjectId
  ) {
    throw commandError(
      "invalid_transition",
      "Exact Modelica ThreadSnapshot basis is unavailable.",
    );
  }
  return validateThreadSnapshot(snapshot);
}
async function exactSnapshot(
  store: ThreadSnapshotStore,
  ref: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  },
): Promise<ThreadSnapshot> {
  const snapshot = await store.get(ref.snapshotId);
  if (
    !snapshot || snapshot.revision !== ref.revision ||
    snapshot.subject.id !== ref.subjectId
  ) throw new Error("Recorded Modelica completion snapshot is absent or divergent.");
  return validateThreadSnapshot(snapshot);
}
async function exactSnapshotReadback(
  store: ThreadSnapshotStore,
  snapshot: ThreadSnapshot,
): Promise<void> {
  const reread = await store.get(snapshot.id);
  if (!reread || deterministicJson(reread) !== deterministicJson(snapshot)) {
    throw new Error("Recorded Modelica ThreadSnapshot was not durably reread.");
  }
}
function completedProject(
  project: EngineeringProjectSnapshot,
  command: SimulateRunModelicaScenarioV2RunExecutorCommand,
): EngineeringProjectSnapshot {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some((receipt) =>
      receipt.commandId === step(command.commandId, "complete")
    )
  ) {
    throw commandError(
      "invalid_transition",
      "Recorded Modelica run did not complete through its fixed command sequence.",
    );
  }
  return project;
}
function step(commandId: string, action: string): string {
  return `${commandId}:simulate-run-modelica-scenario-v2:${action}`;
}
function commandError(
  code: ConstructorParameters<typeof EngineeringProjectCommandError>[0],
  message: string,
): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError(code, message);
}
