/**
 * Trusted executor for `simulate.run-admitted-modelica@1`.
 *
 * Reopens one sealed Modelica compilation and runs those exact `.mo` bytes
 * in the server-owned isolated worker. Callers never supply Modelica text.
 */

import type { EngineeringProjectCommandOrigin } from "../../application/ports/in/engineering-project-command-origin.ts";
import type { RegisteredProjectRunExecutorCommand } from "../../application/ports/in/project-run-executor.ts";
import type {
  IsolatedCodeRunner,
  IsolatedOutputPublicationReader,
} from "../../application/ports/out/isolated-code-runner.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { TechnicalCompilationAdmissionReader } from "../../application/ports/out/technical-compilation-admission-reader.ts";
import type { AdmittedModelicaExecutionProfileCatalog } from "../../application/ports/out/admitted-modelica-execution-profile-catalog.ts";
import { PrepareProjectAdmittedModelicaRunReview } from "../../application/use-cases/prepare-project-admitted-modelica-run-review.ts";
import {
  isolatedRequestFromAdmittedSource,
  ReopenAdmittedCompilationSource,
} from "../../application/use-cases/reopen-admitted-compilation-source.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
  type RunCommand,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  createModelicaAdmittedExecutionCapture,
  deriveAdmittedModelicaExecutionRunId,
  type ModelicaAdmittedExecutionCapture,
  validateModelicaAdmittedExecutionCapture,
} from "../../domain/analysis/admitted-modelica-execution-evidence.ts";
import {
  type IsolatedCodeExecutionReceipt,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRequest,
} from "../../domain/analysis/isolated-code-execution.ts";
import {
  type ModelicaAdmittedRunAdmission,
  parseModelicaAdmittedRunAdmissionParameters,
  SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
} from "../../domain/analysis/modelica-admitted-run-proposal.ts";

import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadObservation,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import { assertThreadSnapshotLineageIntact } from "../stores/thread-snapshot-lineage.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "./thread-write-basis-guard.ts";

export { SIMULATE_RUN_ADMITTED_MODELICA_OPERATION };

export interface AdmittedModelicaThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface AdmittedModelicaExecutionCaptureStore {
  save(
    fingerprint: ContentFingerprint,
    canonicalText: string,
  ): Promise<{ readonly uri: string; readonly fingerprint: ContentFingerprint }>;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  uriFor(fingerprint: ContentFingerprint): string;
}

export interface SimulateRunAdmittedModelicaRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun"
  >;
  readonly snapshots: AdmittedModelicaThreadSnapshotStore;
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly profiles: AdmittedModelicaExecutionProfileCatalog;
  readonly runner: IsolatedCodeRunner;
  readonly publications: IsolatedOutputPublicationReader;
  readonly captures: AdmittedModelicaExecutionCaptureStore;
  readonly lease: EngineeringProjectRunLease;
}

interface ReviewedAuthority {
  readonly decision: EngineeringDecision;
  readonly approval: EngineeringApproval;
  readonly admission: ModelicaAdmittedRunAdmission;
}

interface DocumentarySuccessor {
  readonly snapshot: ThreadSnapshot;
  readonly artifacts: readonly [ThreadArtifact, ThreadArtifact, ThreadArtifact];
  readonly observation: ThreadObservation;
}

export class SimulateRunAdmittedModelicaRunExecutor {
  constructor(
    private readonly d: SimulateRunAdmittedModelicaRunExecutorDependencies,
  ) {}

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute a reviewed admitted Modelica run.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireExecutionShape(project, run);
    const authority = await requireReviewedAuthority(project, run);
    assertAdmissionScope(project, run, authority.decision, authority.admission);
    if (run.status === "completed") {
      return await this.d.lease.withLease(
        command.projectId,
        threadWriteBasisLeaseScope(run),
        async () => {
          await this.#replayClaim(origin, command);
          return await this.#reopenCompleted(origin, command, authority);
        },
      );
    }
    return await this.d.lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command, authority),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    initial: ReviewedAuthority,
  ): Promise<EngineeringProjectSnapshot> {
    let project = await this.#requiredProject(command.projectId);
    let run = requireRun(project, command.runId);
    requireExecutionShape(project, run);
    if (run.status === "completed") {
      await this.#replayClaim(origin, command);
      return await this.#reopenCompleted(origin, command, initial);
    }
    if (
      run.status !== "queued" && run.status !== "running" &&
      run.status !== "publishing"
    ) {
      throw unexpectedStatus(run, "queued or this agent's running/publishing");
    }
    await assertThreadWriteBasisAvailable(project, run);
    if (run.status === "queued") {
      await this.d.commands.claimRun(origin, claimCommand(command));
    } else {
      requireClaimedShape(project, run, origin);
      await this.#replayClaim(origin, command);
    }
    try {
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);
      if (run.status === "completed") {
        return await this.#reopenCompleted(origin, command, initial);
      }
      const authority = await requireReviewedAuthority(project, run);
      assertAdmissionScope(project, run, authority.decision, authority.admission);
      const basis = requireBasis(run);
      const basisSnapshot = await exactBasisSnapshot(this.d.snapshots, basis, true);
      await assertThreadSnapshotLineageIntact(basisSnapshot, this.d.snapshots);
      const context = await reopenAdmittedExecutionRequest({
        admissions: this.d.admissions,
        profiles: this.d.profiles,
        project,
        run,
        basisSnapshot,
        admission: authority.admission,
      });
      const receipt = await this.d.runner.run(context.request);
      const capture = await this.#persistCapture(project, run, context, receipt);
      const expected = buildDocumentarySuccessor({
        basisSnapshot,
        basis,
        run,
        capture,
        captureUri: this.d.captures.uriFor(await sha256Fingerprint(capture)),
        receipt,
      });
      await this.d.snapshots.save(expected.snapshot);
      const readback = await this.d.snapshots.getFresh(expected.snapshot.id);
      if (
        !readback ||
        deterministicJson(validateThreadSnapshot(readback)) !==
          deterministicJson(expected.snapshot)
      ) {
        throw invalidTransition(
          "The admitted Modelica documentary Thread successor failed exact durable readback.",
        );
      }
      project = await this.#requiredProject(command.projectId);
      await this.#publishExact(origin, project, command);
      project = await this.#requiredProject(command.projectId);
      await this.#completeExact(origin, project, command, expected);
      return await this.#requiredProject(command.projectId);
    } catch (error) {
      throw invalidTransition(
        "The admitted Modelica execution or documentary Thread publication has a durable or uncertain effect. " +
          "Retry this exact command. " +
          `Cause: ${boundedCause(error)}`,
      );
    }
  }

  async #persistCapture(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    context: AdmittedExecutionRequest,
    receipt: IsolatedCodeExecutionReceipt,
  ): Promise<ModelicaAdmittedExecutionCapture> {
    const record = isolatedCodeExecutionReceiptRecord(receipt);
    const outputs = new Map(record.outputs.map((output) => [output.role, output]));
    const evidenceOutput = outputs.get("evidence");
    const resultOutput = outputs.get("result");
    if (!evidenceOutput || !resultOutput || outputs.size !== 2) {
      throw invalidTransition(
        "The admitted Modelica run must publish evidence.json and result.csv.",
      );
    }
    const evidenceBytes = await this.d.publications.readPublishedObject(
      record.publication.ref,
      evidenceOutput,
    );
    if (!evidenceBytes) {
      throw invalidTransition("The admitted Modelica evidence could not be reopened.");
    }
    const evidence = JSON.parse(new TextDecoder().decode(evidenceBytes)) as {
      readonly metrics?: readonly { readonly id?: string; readonly value?: number }[];
    };
    const metric = evidence.metrics?.find((item) => item.id === "temperature_final");
    if (typeof metric?.value !== "number" || !Number.isFinite(metric.value)) {
      throw invalidTransition(
        "The admitted Modelica evidence lacks temperature_final.",
      );
    }
    const capture = await createModelicaAdmittedExecutionCapture({
      projectId: project.project.id,
      agentRunId: run.id,
      executionRunId: context.request.runId,
      admission: context.admission,
      sourceSha256: context.request.source.sha256,
      receipt,
      temperatureFinal: { value: metric.value, unit: "degC" },
    });
    const text = deterministicJson(capture);
    const fingerprint = await sha256Fingerprint(capture);
    const persisted = await this.d.captures.save(fingerprint, text);
    const reopenedText = await this.d.captures.read(persisted.fingerprint);
    if (
      !reopenedText || reopenedText !== text ||
      persisted.uri !== this.d.captures.uriFor(persisted.fingerprint)
    ) {
      throw invalidTransition("The admitted Modelica capture failed exact readback.");
    }
    return await validateModelicaAdmittedExecutionCapture(JSON.parse(reopenedText));
  }

  async #requiredProject(projectId: string): Promise<EngineeringProjectSnapshot> {
    const project = await this.d.projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }

  async #replayClaim(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<void> {
    const project = await this.#requiredProject(command.projectId);
    const receipt = exactCommandReceipt(
      project,
      commandStep(command.commandId, "claim"),
      "agent-run.claim",
      origin,
      command,
    );
    await this.d.commands.claimRun(
      origin,
      claimCommand(command, receipt.resultingSnapshot.revision - 1, receipt.issuedAt),
    );
  }

  async #publishExact(
    origin: EngineeringProjectCommandOrigin,
    project: EngineeringProjectSnapshot,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<void> {
    const run = requireRun(project, command.runId);
    let expectedRevision = project.revision;
    let issuedAt = command.issuedAt;
    if (run.status === "publishing" || run.status === "completed") {
      const receipt = exactCommandReceipt(
        project,
        commandStep(command.commandId, "publish"),
        "agent-run.publish",
        origin,
        command,
      );
      expectedRevision = receipt.resultingSnapshot.revision - 1;
      issuedAt = receipt.issuedAt;
    } else if (run.status !== "running") {
      throw unexpectedStatus(run, "running, publishing, or completed");
    }
    await this.d.commands.publishRun(
      origin,
      publishCommand(command, expectedRevision, issuedAt),
    );
  }

  async #completeExact(
    origin: EngineeringProjectCommandOrigin,
    project: EngineeringProjectSnapshot,
    command: RegisteredProjectRunExecutorCommand,
    expected: DocumentarySuccessor,
  ): Promise<void> {
    const run = requireRun(project, command.runId);
    let expectedRevision = project.revision;
    let issuedAt = command.issuedAt;
    if (run.status === "completed") {
      const receipt = exactCommandReceipt(
        project,
        commandStep(command.commandId, "complete"),
        "agent-run.complete",
        origin,
        command,
      );
      expectedRevision = receipt.resultingSnapshot.revision - 1;
      issuedAt = receipt.issuedAt;
    } else if (run.status !== "publishing") {
      throw unexpectedStatus(run, "publishing or completed");
    }
    await this.d.commands.completeRun(
      origin,
      completionCommand(command, expectedRevision, expected, issuedAt),
    );
  }

  async #reopenCompleted(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    authority: ReviewedAuthority,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status !== "completed") throw unexpectedStatus(run, "completed");
    requireClaimedShape(project, run, origin);
    assertAdmissionScope(project, run, authority.decision, authority.admission);
    return project;
  }
}

interface AdmittedExecutionRequest {
  readonly admission: ModelicaAdmittedRunAdmission;
  readonly request: IsolatedCodeExecutionRequest;
}

export async function reopenAdmittedExecutionRequest(input: {
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly profiles: AdmittedModelicaExecutionProfileCatalog;
  readonly project: EngineeringProjectSnapshot;
  readonly run: EngineeringAgentRun;
  readonly basisSnapshot: ThreadSnapshot;
  readonly admission: ModelicaAdmittedRunAdmission;
}): Promise<AdmittedExecutionRequest> {
  const basis = requireBasis(input.run);
  const review = await new PrepareProjectAdmittedModelicaRunReview({
    admissions: input.admissions,
    profiles: input.profiles,
  }).execute({
    projectId: input.project.project.id,
    basis,
    artifactId: input.admission.admissionArtifact.id,
    artifactFingerprint: input.admission.admissionArtifact.fingerprint,
  });
  if (deterministicJson(review.admission) !== deterministicJson(input.admission)) {
    throw invalidTransition(
      "The reopened admitted Modelica review differs from the signed MRTR.",
    );
  }
  let admitted;
  try {
    admitted = await new ReopenAdmittedCompilationSource({
      admissions: input.admissions,
    }).execute({
      projectId: input.project.project.id,
      basis,
      artifactId: input.admission.admissionArtifact.id,
      artifactFingerprint: input.admission.admissionArtifact.fingerprint,
      expectedTarget: "modelica-source-qualification",
    });
  } catch {
    throw invalidTransition(
      "The reopened admission is not a ready Modelica compilation.",
    );
  }
  if (
    !fingerprintsEqual(
      admitted.sourceFingerprint,
      input.admission.compilation.source.sourceFingerprint,
    ) ||
    !fingerprintsEqual(
      admitted.documentFingerprint,
      input.admission.compilation.document.fingerprint,
    )
  ) {
    throw invalidTransition(
      "The reopened Modelica source is not the signed admission.",
    );
  }
  const profile = await input.profiles.initial();
  const executionRunId = await deriveAdmittedModelicaExecutionRunId(
    input.project.project.id,
    input.run.id,
  );
  const request = await isolatedRequestFromAdmittedSource({
    runId: executionRunId,
    sourceText: admitted.sourceText,
    sourceSha256: admitted.sourceFingerprint.digest,
    profile: profile.executionProfile,
    policy: profile.isolationPolicy,
    outputs: profile.outputManifest,
    maximumSourceBytes: profile.maximumSourceBytes,
  });
  return {
    admission: review.admission,
    request,
  };
}

function requireExecutionShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  const binding = operation?.bindings[0];
  if (
    project.schemaVersion !== "3.0" || run.basis?.kind !== "thread-snapshot" ||
    !workItem || operation?.id !== SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.id ||
    operation.version !== SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.version ||
    operation.bindings.length !== 1 || binding?.name !== "compilationAdmission" ||
    binding.source.kind !== "thread-entity" ||
    binding.source.reference.kind !== "artifact"
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to simulate.run-admitted-modelica@1 with compilationAdmission.`,
    );
  }
}

function requireClaimedShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  requireExecutionShape(project, run);
  if (
    run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId
  ) {
    throw invalidTransition(
      "This executor may continue only the exact admitted Modelica run it claimed.",
    );
  }
}

async function requireReviewedAuthority(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<ReviewedAuthority> {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!workItem || workItem.decisionIds.length !== 1) {
    throw invalidTransition("The admitted Modelica work item must name one decision.");
  }
  const decision = project.decisions.find((item) =>
    item.id === workItem.decisionIds[0]
  );
  const approval = project.approvals.find((item) =>
    item.id === decision?.approvalIds[0]
  );
  if (
    !decision || decision.status !== "approved" || !decision.proposal ||
    !approval || approval.status !== "approved"
  ) {
    throw invalidTransition("The admitted Modelica run requires one approved MRTR.");
  }
  const admission = parseModelicaAdmittedRunAdmissionParameters(
    decision.proposal.parameters,
  );
  return { decision, approval, admission };
}

function assertAdmissionScope(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  decision: EngineeringDecision,
  admission: ModelicaAdmittedRunAdmission,
): void {
  const basis = requireBasis(run);
  const evidence = decision.inputEvidenceRefs[0];
  const workItem = project.workItems.find((item) => item.id === run.workItemId)!;
  const binding = workItem.operation!.bindings[0]!;
  if (
    decision.inputEvidenceRefs.length !== 1 || evidence?.kind !== "artifact" ||
    evidence.snapshotId !== basis.snapshotId ||
    evidence.snapshotRevision !== basis.revision ||
    evidence.id !== admission.admissionArtifact.id ||
    binding.source.kind !== "thread-entity" ||
    deterministicJson(binding.source.reference) !== deterministicJson(evidence)
  ) {
    throw invalidTransition(
      "The admitted Modelica binding, MRTR evidence, and admission artifact disagree.",
    );
  }
}

async function exactBasisSnapshot(
  snapshots: AdmittedModelicaThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
  fresh: boolean,
): Promise<ThreadSnapshot> {
  const snapshot = fresh
    ? await snapshots.getFresh(basis.snapshotId)
    : await snapshots.get(basis.snapshotId);
  if (!snapshot || snapshot.revision !== basis.revision) {
    throw invalidTransition(
      "The admitted Modelica Thread basis could not be reopened.",
    );
  }
  return validateThreadSnapshot(snapshot);
}

function buildDocumentarySuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly run: EngineeringAgentRun;
  readonly capture: ModelicaAdmittedExecutionCapture;
  readonly captureUri: string;
  readonly receipt: IsolatedCodeExecutionReceipt;
}): DocumentarySuccessor {
  const capturedAt = requiredStart(input.run);
  const operation = {
    serverId: "digital-thread",
    tool:
      `${SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.id}@${SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.version}`,
    runId: input.run.id,
  };
  const freshness = {
    status: "fresh" as const,
    changedAt: capturedAt,
    invalidatedByChangeIds: [],
  };
  const outputs = new Map(
    input.receipt.outputs.map((output) => [output.role, output]),
  );
  const evidenceOutput = outputs.get("evidence")!;
  const resultOutput = outputs.get("result")!;
  const captureArtifact: ThreadArtifact = {
    id: `modelica-admitted-capture-${input.capture.receipt.runId}`,
    name: "Admitted Modelica execution capture",
    kind: "document",
    version: input.capture.sourceSha256,
    fingerprint: {
      algorithm: "sha256",
      digest: input.capture.sourceSha256,
    },
    uri: input.captureUri,
    mediaType: "application/json",
    producer: operation,
    inputArtifactIds: [],
    freshness,
  };
  const evidenceArtifact: ThreadArtifact = {
    id: `modelica-admitted-evidence-${evidenceOutput.sha256}`,
    name: "Admitted Modelica normalized evidence",
    kind: "evidence",
    version: evidenceOutput.sha256,
    fingerprint: { algorithm: "sha256", digest: evidenceOutput.sha256 },
    uri: evidenceOutput.casUri,
    mediaType: evidenceOutput.mediaType,
    producer: operation,
    inputArtifactIds: [],
    freshness,
  };
  const resultArtifact: ThreadArtifact = {
    id: `modelica-admitted-result-${resultOutput.sha256}`,
    name: "Admitted OpenModelica result",
    kind: "solver-result",
    version: resultOutput.sha256,
    fingerprint: { algorithm: "sha256", digest: resultOutput.sha256 },
    uri: resultOutput.casUri,
    mediaType: resultOutput.mediaType,
    producer: operation,
    inputArtifactIds: [],
    freshness,
  };
  const observation: ThreadObservation = {
    id: `modelica-admitted-temperature-final-${input.run.id}`,
    name: "Admitted Modelica final temperature",
    metric: "temperature_final",
    quantity: input.capture.temperatureFinal,
    source: {
      operation,
      artifactIds: [evidenceArtifact.id, resultArtifact.id],
      capturedAt,
    },
    freshness,
  };
  const extension: ThreadSnapshotExtension = {
    id: `simulate-run-admitted-modelica-${input.run.id}`,
    name: "Record admitted Modelica isolated run",
    subjectId: input.basis.subjectId,
    capturedAt,
    artifacts: [captureArtifact, evidenceArtifact, resultArtifact],
    consumptions: [],
    observations: [observation],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    extension,
    { appliedAt: capturedAt },
  );
  if (!applied.applied) {
    throw invalidTransition(
      "The admitted Modelica documentary branch is already present.",
    );
  }
  return {
    snapshot: validateThreadSnapshot(applied.snapshot),
    artifacts: [captureArtifact, evidenceArtifact, resultArtifact],
    observation,
  };
}

function artifactEvidence(
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): EngineeringThreadEntityRef {
  return {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact",
    id: artifact.id,
  };
}

function claimCommand(
  command: RegisteredProjectRunExecutorCommand,
  expectedRevision = command.expectedRevision,
  issuedAt = command.issuedAt,
): RunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "claim"),
    expectedRevision,
    issuedAt,
    summary: "Started the exact reviewed admitted Modelica run.",
  };
}

function publishCommand(
  command: RegisteredProjectRunExecutorCommand,
  expectedRevision: number,
  issuedAt = command.issuedAt,
): RunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "publish"),
    expectedRevision,
    issuedAt,
    summary: "Publishing the admitted Modelica documentary evidence.",
  };
}

function completionCommand(
  command: RegisteredProjectRunExecutorCommand,
  expectedRevision: number,
  expected: DocumentarySuccessor,
  issuedAt = command.issuedAt,
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "complete"),
    expectedRevision,
    issuedAt,
    summary: "Recorded the exact admitted Modelica isolated run.",
    resultSnapshot: snapshotRef(expected.snapshot),
    evidenceRefs: expected.artifacts.map((artifact) =>
      artifactEvidence(expected.snapshot, artifact)
    ),
  };
}

function exactCommandReceipt(
  project: EngineeringProjectSnapshot,
  commandId: string,
  type: "agent-run.claim" | "agent-run.publish" | "agent-run.complete",
  origin: EngineeringProjectCommandOrigin,
  command: RegisteredProjectRunExecutorCommand,
): EngineeringProjectCommandReceipt {
  const matches =
    project.commandReceipts?.filter((receipt) => receipt.commandId === commandId) ??
      [];
  const receipt = matches[0];
  if (
    matches.length !== 1 || !receipt || receipt.type !== type ||
    receipt.actor.origin !== origin.kind || receipt.actor.id !== origin.actorId
  ) {
    throw invalidTransition(
      `The admitted Modelica run has no unique exact ${type} receipt.`,
    );
  }
  return receipt;
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:simulate-run-admitted-modelica:${step}`;
}

function boundedCause(error: unknown, maximum = 300): string {
  const message = error instanceof Error
    ? `${error.name}: ${error.message}`
    : `non-error throw: ${String(error)}`;
  return message.length <= maximum ? message : `${message.slice(0, maximum)}…`;
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
