/**
 * Provider-free executor for `verify.seal-cross-domain-impact-manifest@2`.
 *
 * It replays the exact human-approved MRTR grammar through the read-only
 * recross, saves a closed content-addressed document capture, and appends one
 * Thread document. This is the manifest-seal documentary successor, not the
 * later impact-evaluation transition: it does not evaluate causal branches,
 * alter gate claims, propose work, execute a solver, call a provider, or
 * expose a Workbench command path.
 */

import type { EngineeringProjectCommandOrigin } from "../../application/ports/in/engineering-project-command-origin.ts";
import type { RegisteredProjectRunExecutorCommand } from "../../application/ports/in/project-run-executor.ts";
import type {
  ProjectCrossDomainImpactManifestSealReviewUseCase,
} from "../../application/ports/in/impact/project-cross-domain-impact-manifest-seal-review.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { CrossDomainImpactManifestSealCaptureStore } from "../../application/ports/out/impact/cross-domain-impact-capture-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type CrossDomainImpactManifestSealAdmission,
  parseCrossDomainImpactManifestSealParameters,
  VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION,
} from "../../domain/impact/cross-domain-impact-manifest-proposal.ts";
import {
  CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_CAPTURE_SCHEMA,
  type CrossDomainImpactManifestSealCapture,
  validateCrossDomainImpactManifestSealCapture,
} from "../../domain/impact/cross-domain-impact-manifest-seal-capture.ts";
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
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
} from "../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadOperationRef,
  ThreadProvenanceLink,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import type { EngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { assertThreadSnapshotLineageIntact } from "../shared/stores/thread-snapshot-lineage.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../shared/executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "../shared/thread-write-basis-guard.ts";

export interface CrossDomainImpactThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface VerifySealCrossDomainImpactManifestRunExecutorDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: CrossDomainImpactThreadSnapshotStore;
  readonly review: ProjectCrossDomainImpactManifestSealReviewUseCase;
  readonly captures: CrossDomainImpactManifestSealCaptureStore;
  readonly lease: EngineeringProjectRunLease;
}

export class VerifySealCrossDomainImpactManifestRunExecutor {
  readonly #projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly #commands:
    VerifySealCrossDomainImpactManifestRunExecutorDependencies["commands"];
  readonly #snapshots: CrossDomainImpactThreadSnapshotStore;
  readonly #review: ProjectCrossDomainImpactManifestSealReviewUseCase;
  readonly #captures: CrossDomainImpactManifestSealCaptureStore;
  readonly #lease: EngineeringProjectRunLease;

  constructor(
    dependencies: VerifySealCrossDomainImpactManifestRunExecutorDependencies,
  ) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#review = dependencies.review;
    this.#captures = dependencies.captures;
    this.#lease = dependencies.lease;
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute a cross-domain impact-manifest seal.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);
    const approved = await requireMrtrApproval(project, run);
    const admission = parseAdmission(approved.proposal.parameters);
    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command, approved.decision, admission),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: CrossDomainImpactManifestSealAdmission,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let snapshotWriteMayHaveBeenDispatched = false;
    try {
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireShape(project, run);
      const completed = await this.#completedFor(
        command,
        approvedDecision,
        admission,
      );
      if (completed) return completed;

      await assertThreadWriteBasisAvailable(project, run);
      const basis = requireBasis(run);
      const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
      await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);

      if (run.status === "queued") {
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "claim"),
          summary: "Started the provider-free cross-domain impact-manifest seal.",
        });
        claimed = true;
      } else if (run.status === "running" || run.status === "publishing") {
        requireClaimedShape(project, run, origin);
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "claim"),
          summary: "Started the provider-free cross-domain impact-manifest seal.",
        });
        claimed = true;
      } else {
        throw unexpectedStatus(run, "queued or this agent's running/publishing");
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);
      if (run.status === "completed") return project;
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running");
      }

      const currentApproval = await requireMrtrApproval(project, run);
      if (currentApproval.decision.id !== approvedDecision.id) {
        throw invalidTransition(
          "The human-approved impact-manifest decision changed after claim.",
        );
      }
      const currentAdmission = parseAdmission(currentApproval.proposal.parameters);
      if (deterministicJson(currentAdmission) !== deterministicJson(admission)) {
        throw invalidTransition(
          "The human-reviewed impact-manifest parameters changed after claim.",
        );
      }

      const currentBasis = requireBasis(run);
      const currentBasisSnapshot = await exactBasisSnapshot(
        this.#snapshots,
        currentBasis,
      );
      await assertThreadSnapshotLineageIntact(currentBasisSnapshot, this.#snapshots);
      await this.#recrossAdmission(command.projectId, currentBasis, currentAdmission);

      const sealedAt = requiredStart(run);
      const capture = validateCrossDomainImpactManifestSealCapture({
        schemaVersion: CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_CAPTURE_SCHEMA,
        kind: "cross-domain-impact-manifest-seal",
        operation: VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION,
        trustedRunId: run.id,
        decisionId: currentApproval.decision.id,
        sealedAt,
        admission: currentAdmission,
      });
      const receipt = await this.#captures.save(capture);
      const reopenedCapture = await this.#captures.read(receipt.fingerprint);
      if (
        !reopenedCapture ||
        deterministicJson(reopenedCapture) !== deterministicJson(capture)
      ) {
        throw new Error("Impact-manifest seal capture changed during exact readback.");
      }

      const expectedSuccessor = buildSuccessor({
        basisSnapshot: currentBasisSnapshot,
        basis: currentBasis,
        run,
        capture: reopenedCapture,
        captureFingerprint: receipt.fingerprint,
        captureUri: receipt.uri,
      });
      snapshotWriteMayHaveBeenDispatched = true;
      await this.#snapshots.save(expectedSuccessor.snapshot);
      const snapshotReadback = await this.#snapshots.getFresh(
        expectedSuccessor.snapshot.id,
      );
      if (
        !snapshotReadback ||
        deterministicJson(snapshotReadback) !==
          deterministicJson(expectedSuccessor.snapshot)
      ) {
        throw new Error(
          "Impact-manifest seal ThreadSnapshot was not exactly readable after save.",
        );
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the sealed cross-domain impact-manifest document.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(
          origin,
          completionCommand(
            command,
            project.revision,
            expectedSuccessor.snapshot,
            expectedSuccessor.artifact,
          ),
        );
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }

      const complete = await this.#requiredProject(command.projectId);
      await this.#assertCompletedEvidence(
        complete,
        command,
        approvedDecision,
        admission,
      );
      return complete;
    } catch (error) {
      if (snapshotWriteMayHaveBeenDispatched) {
        const completed = await this.#completedFor(
          command,
          approvedDecision,
          admission,
        );
        if (completed) return completed;
        throw invalidTransition(
          "Impact-manifest Thread write may have been dispatched, but project attachment did not finish. Retry this exact command to reopen the deterministic successor.",
        );
      }
      if (claimed) await this.#recordFailure(origin, command);
      throw error;
    }
  }

  async #requiredProject(projectId: string): Promise<EngineeringProjectSnapshot> {
    const project = await this.#projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }

  async #recrossAdmission(
    projectId: string,
    basis: ReturnType<typeof requireBasis>,
    admission: CrossDomainImpactManifestSealAdmission,
  ): Promise<void> {
    if (
      admission.project.id !== projectId ||
      admission.subject.id !== basis.subjectId ||
      admission.basis.snapshotId !== basis.snapshotId ||
      admission.basis.revision !== basis.revision
    ) {
      throw invalidTransition(
        "The signed impact-manifest admission is not bound to this exact project Thread basis.",
      );
    }
    const snapshot = await exactBasisSnapshot(this.#snapshots, basis);
    const snapshotFingerprint = await sha256Fingerprint(snapshot);
    if (!fingerprintsEqual(snapshotFingerprint, admission.basis.fingerprint)) {
      throw invalidTransition(
        "The signed impact-manifest basis fingerprint is not the exact current Thread snapshot.",
      );
    }
    const result = await this.#review.execute({
      projectId,
      manifestRef: { fingerprint: admission.manifest.reference },
    });
    if (result.status !== "resolved") {
      throw invalidTransition(
        `The signed impact-manifest admission cannot be exactly reread (${result.status}).`,
      );
    }
    if (deterministicJson(result.admission) !== deterministicJson(admission)) {
      throw invalidTransition(
        "The reopened impact manifest, Brief V2, or Thread lineage differs from the signed admission.",
      );
    }
  }

  async #completedFor(
    command: RegisteredProjectRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: CrossDomainImpactManifestSealAdmission,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status !== "completed") return undefined;
    await this.#assertCompletedEvidence(project, command, approvedDecision, admission);
    return project;
  }

  async #assertCompletedEvidence(
    project: EngineeringProjectSnapshot,
    command: RegisteredProjectRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: CrossDomainImpactManifestSealAdmission,
  ): Promise<void> {
    const run = requireRun(project, command.runId);
    const basis = requireBasis(run);
    if (run.status !== "completed" || !run.resultSnapshot) {
      throw invalidTransition(
        "The impact-manifest seal did not complete through this exact run.",
      );
    }
    await this.#recrossAdmission(command.projectId, basis, admission);
    const snapshot = await this.#snapshots.getFresh(run.resultSnapshot.snapshotId);
    if (
      !snapshot ||
      snapshot.revision !== basis.revision + 1 ||
      snapshot.subject.id !== basis.subjectId ||
      snapshot.previous?.snapshotId !== basis.snapshotId ||
      snapshot.previous.revision !== basis.revision
    ) {
      throw invalidTransition(
        "The completed impact-manifest seal lacks its exact direct Thread successor.",
      );
    }
    const validated = validateThreadSnapshot(snapshot);
    const evidence = exactCompletedEvidence(project, run, validated);
    const artifact = validated.artifacts.find((candidate) =>
      candidate.id === evidence.id
    );
    if (!artifact || artifact.kind !== "document") {
      throw invalidTransition(
        "The completed impact-manifest seal evidence is not a Thread document.",
      );
    }
    const capture = await this.#captures.read(artifact.fingerprint);
    if (
      !capture ||
      capture.trustedRunId !== run.id ||
      capture.decisionId !== approvedDecision.id ||
      capture.sealedAt !== requiredStart(run) ||
      deterministicJson(capture.admission) !== deterministicJson(admission)
    ) {
      throw invalidTransition(
        "The completed impact-manifest seal capture no longer equals its exact run and MRTR decision.",
      );
    }
    const observedFingerprint = await sha256Fingerprint(capture);
    if (!fingerprintsEqual(observedFingerprint, artifact.fingerprint)) {
      throw invalidTransition(
        "The completed impact-manifest capture fingerprint no longer matches its Thread artifact.",
      );
    }
    const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
    const expected = buildSuccessor({
      basisSnapshot,
      basis,
      run,
      capture,
      captureFingerprint: observedFingerprint,
      captureUri: artifact.uri ?? "",
    });
    if (deterministicJson(expected.snapshot) !== deterministicJson(validated)) {
      throw invalidTransition(
        "The completed impact-manifest successor is not the exact deterministic capture extension.",
      );
    }
  }

  async #recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<void> {
    try {
      const project = await this.#requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (
        (run.status !== "running" && run.status !== "publishing") ||
        run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId
      ) return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary:
          "Impact-manifest seal stopped before a ThreadSnapshot write was dispatched.",
        code: "verify-seal-cross-domain-impact-manifest-not-published",
        message:
          "The provider-free cross-domain impact-manifest seal stopped before its document was published.",
      });
    } catch {
      // Preserve the original failure.
    }
  }
}

function buildSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: ReturnType<typeof requireBasis>;
  readonly run: EngineeringAgentRun;
  readonly capture: CrossDomainImpactManifestSealCapture;
  readonly captureFingerprint: ContentFingerprint;
  readonly captureUri: string;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const sealedAt = requiredStart(input.run);
  const inputArtifacts = exactInputArtifacts(
    input.basisSnapshot,
    input.capture.admission,
  );
  const producer: ThreadOperationRef = {
    serverId: "digital-thread",
    tool:
      `${VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.id}@${VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.version}`,
    runId: input.run.id,
  };
  const artifact: ThreadArtifact = {
    id: `cross-domain-impact-manifest-seal-${input.captureFingerprint.digest}`,
    name: "Sealed cross-domain impact manifest",
    kind: "document",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri: input.captureUri,
    mediaType: "application/json",
    producer,
    inputArtifactIds: inputArtifacts.map((upstream) => upstream.id),
    freshness: {
      status: "fresh",
      changedAt: sealedAt,
      invalidatedByChangeIds: [],
    },
  };
  const consumptions: ThreadArtifactConsumption[] = inputArtifacts.map((upstream) => ({
    id:
      `verify-seal-cross-domain-impact-manifest-${input.run.id}:consume:${upstream.id}`,
    artifactId: upstream.id,
    consumer: producer,
    observedFingerprint: upstream.fingerprint,
    verifiedAt: sealedAt,
    status: "verified",
  }));
  const provenance: ThreadProvenanceLink[] = [
    ...inputArtifacts.map((upstream) => ({
      id:
        `verify-seal-cross-domain-impact-manifest-${input.run.id}:derived-from:${upstream.id}`,
      relation: "derived_from" as const,
      from: { kind: "artifact" as const, id: artifact.id },
      to: { kind: "artifact" as const, id: upstream.id },
      rationale:
        "The sealed impact manifest recrossed this exact declared artifact identity.",
    })),
    ...consumptions.map((consumption) => ({
      id:
        `verify-seal-cross-domain-impact-manifest-${input.run.id}:uses:${consumption.artifactId}`,
      relation: "uses" as const,
      from: { kind: "consumption" as const, id: consumption.id },
      to: { kind: "artifact" as const, id: consumption.artifactId },
      rationale: "The seal executor reread and fingerprint-attested the exact input.",
    })),
  ];
  const extension: ThreadSnapshotExtension = {
    id: `verify-seal-cross-domain-impact-manifest-${input.run.id}`,
    name: "Seal the reviewed cross-domain impact manifest",
    subjectId: input.basis.subjectId,
    capturedAt: sealedAt,
    artifacts: [artifact],
    consumptions,
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance,
    proposedActions: [],
  };
  const applied = applyThreadSnapshotExtensionIfNew(input.basisSnapshot, extension, {
    appliedAt: sealedAt,
  });
  if (!applied.applied) {
    throw invalidTransition(
      "This exact cross-domain impact-manifest seal document is already present in the basis snapshot.",
    );
  }
  return { snapshot: validateThreadSnapshot(applied.snapshot), artifact };
}

function exactInputArtifacts(
  basis: ThreadSnapshot,
  admission: CrossDomainImpactManifestSealAdmission,
): readonly ThreadArtifact[] {
  const declared = new Map<string, ContentFingerprint[]>();
  const add = (id: string, fingerprint: ContentFingerprint) => {
    const fingerprints = declared.get(id);
    if (fingerprints) fingerprints.push(fingerprint);
    else declared.set(id, [fingerprint]);
  };
  for (const anchor of admission.sourceAnchors) {
    if (anchor.source.kind === "artifact") {
      add(anchor.source.id, anchor.source.fingerprint);
    }
  }
  for (const evidence of admission.mechanicalEvidence) {
    add(evidence.evidence.id, evidence.evidence.fingerprint);
    for (const consumption of evidence.consumptions) {
      add(consumption.input.id, consumption.input.fingerprint);
    }
  }
  return [...declared.keys()]
    .sort((left, right) => left.localeCompare(right))
    .map((id) => {
      const matches = basis.artifacts.filter((artifact) => artifact.id === id);
      const fingerprints = declared.get(id)!;
      if (
        matches.length !== 1 ||
        fingerprints.some((fingerprint) =>
          !fingerprintsEqual(fingerprint, matches[0]!.fingerprint)
        )
      ) {
        throw invalidTransition(
          "A signed impact-manifest artifact input is not an exact basis artifact.",
        );
      }
      return matches[0]!;
    });
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  if (
    run.basis?.kind !== "thread-snapshot" || !workItem ||
    operation?.id !== VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.id ||
    operation.version !== VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.version ||
    operation.bindings.length !== 1 ||
    operation.bindings[0]?.name !== "approvedBrief" ||
    operation.bindings[0].source.kind !== "approved-brief"
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to ${VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.id}@${VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.version} with the sole approvedBrief binding.`,
    );
  }
}

function requireClaimedShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  requireShape(project, run);
  if (run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId) {
    throw invalidTransition(
      "This executor may continue only the exact impact-manifest seal run it claimed.",
    );
  }
}

async function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<
  {
    readonly decision: EngineeringDecision;
    readonly proposal: NonNullable<EngineeringDecision["proposal"]>;
  }
> {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!workItem) throw invalidTransition(`Work item for run ${run.id} is absent.`);
  const basis = requireBasis(run);
  const candidates: Array<
    {
      decision: EngineeringDecision;
      proposal: NonNullable<EngineeringDecision["proposal"]>;
    }
  > = [];
  for (const decisionId of workItem.decisionIds) {
    const decision = project.decisions.find((candidate) =>
      candidate.id === decisionId && candidate.status === "approved"
    );
    if (!decision?.proposal || !decision.inputFingerprint) continue;
    const approvals = project.approvals.filter((approval: EngineeringApproval) =>
      approval.decisionId === decision.id && approval.status === "approved" &&
      decision.approvalIds.includes(approval.id) &&
      approval.decidedByOrigin === "human" &&
      typeof approval.decidedBy === "string" && approval.decidedBy.trim().length > 0 &&
      typeof approval.decidedAt === "string" &&
      !Number.isNaN(Date.parse(approval.decidedAt)) &&
      sameSnapshotBasis(approval.baseSnapshot, basis) &&
      sameEvidenceRefs(approval.inputEvidenceRefs, decision.inputEvidenceRefs) &&
      fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint)
    );
    if (approvals.length === 1 && sameSnapshotBasis(decision.baseSnapshot, basis)) {
      candidates.push({ decision, proposal: decision.proposal });
    }
  }
  if (candidates.length !== 1) {
    throw invalidTransition(
      candidates.length === 0
        ? "No exact human-approved impact-manifest seal decision is bound to this run basis."
        : "Ambiguous impact-manifest seal: exactly one human-approved decision is required.",
    );
  }
  const selected = candidates[0]!;
  const expectedDecisionFingerprint = await sha256Fingerprint({
    baseSnapshot: selected.decision.baseSnapshot,
    inputEvidenceRefs: selected.decision.inputEvidenceRefs,
    proposal: {
      summary: selected.proposal.summary,
      parameters: selected.proposal.parameters,
    },
  });
  if (
    !fingerprintsEqual(expectedDecisionFingerprint, selected.decision.inputFingerprint)
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The impact-manifest decision fingerprint no longer seals its exact basis, evidence, summary, and parameters.",
    );
  }
  const approvedDecisions = workItem.decisionIds.map((id) => {
    const decision = project.decisions.find((candidate) => candidate.id === id);
    if (!decision?.inputFingerprint) {
      throw invalidTransition(`Work-item decision ${id} is not exactly approved.`);
    }
    return { id, inputFingerprint: decision.inputFingerprint };
  });
  const expectedRunFingerprint = await sha256Fingerprint({
    workItemId: workItem.id,
    basis,
    operation: {
      id: workItem.operation?.id,
      version: workItem.operation?.version,
      bindings: workItem.operation?.bindings,
    },
    approvedDecisions,
  });
  if (!fingerprintsEqual(run.inputFingerprint, expectedRunFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The impact-manifest run fingerprint no longer seals its exact MRTR decision, operation, and basis.",
    );
  }
  parseAdmission(selected.proposal.parameters);
  return selected;
}

function parseAdmission(
  parameters: NonNullable<EngineeringDecision["proposal"]>["parameters"],
): CrossDomainImpactManifestSealAdmission {
  try {
    return parseCrossDomainImpactManifestSealParameters(parameters);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Cross-domain impact-manifest seal parameters are invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function exactBasisSnapshot(
  snapshots: CrossDomainImpactThreadSnapshotStore,
  basis: ReturnType<typeof requireBasis>,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.getFresh(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision || snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The exact Thread basis snapshot is not available for the impact-manifest seal.",
    );
  }
  return validateThreadSnapshot(snapshot);
}

function completionCommand(
  command: RegisteredProjectRunExecutorCommand,
  expectedRevision: number,
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "complete"),
    expectedRevision,
    summary: "Sealed the exact human-reviewed cross-domain impact manifest.",
    resultSnapshot: snapshotRef(snapshot),
    evidenceRefs: [{
      snapshotId: snapshot.id,
      snapshotRevision: snapshot.revision,
      kind: "artifact",
      id: artifact.id,
    }],
  };
}

function exactCompletedEvidence(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  snapshot: ThreadSnapshot,
): EngineeringThreadEntityRef {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const declared = project.threadSnapshots.filter((reference) =>
    reference.snapshotId === snapshot.id && reference.revision === snapshot.revision &&
    reference.subjectId === snapshot.subject.id
  );
  if (
    !workItem || declared.length !== 1 || run.evidenceRefs.length !== 1 ||
    workItem.evidenceRefs.length !== 1 ||
    !sameEvidenceRefs(run.evidenceRefs, workItem.evidenceRefs)
  ) {
    throw invalidTransition(
      "The completed impact-manifest seal is not attached to exactly one declared document artifact.",
    );
  }
  const evidence = run.evidenceRefs[0]!;
  if (
    evidence.snapshotId !== snapshot.id ||
    evidence.snapshotRevision !== snapshot.revision || evidence.kind !== "artifact"
  ) {
    throw invalidTransition(
      "The completed impact-manifest evidence reference is not the sealed document.",
    );
  }
  return evidence;
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:verify-seal-cross-domain-impact-manifest:${step}`;
}

function sameSnapshotBasis(
  value:
    | EngineeringDecision["baseSnapshot"]
    | EngineeringApproval["baseSnapshot"]
    | EngineeringAgentRun["basis"],
  basis: ReturnType<typeof requireBasis>,
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
  const leftKeys = [...left.map(key)].sort();
  const rightKeys = [...right.map(key)].sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((value, index) => value === rightKeys[index]);
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
