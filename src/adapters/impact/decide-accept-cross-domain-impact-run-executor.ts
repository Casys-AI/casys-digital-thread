/**
 * Human-only executor for `decide.accept-cross-domain-impact@2`.
 *
 * It recrosses the exact X07/X08 evaluation capture, Brief V2 gates, and
 * existing work-item claims, writes one documentary Thread successor, then
 * atomically applies the already-proposed gate-claim statuses. X07/X08 keeps
 * workItemInvalidations and rerunProposals as `none`; this decision does not
 * invent work items, change other work-item lifecycle, or queue a rerun. It
 * only completes its own decision run. It never infers an impact or calls a
 * provider.
 */

import type { EngineeringProjectCommandOrigin } from "../../application/ports/in/engineering-project-command-origin.ts";
import type { RegisteredProjectRunExecutorCommand } from "../../application/ports/in/project-run-executor.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { CrossDomainImpactBriefGateReader } from "../../application/ports/out/impact/cross-domain-impact-brief-gate-reader.ts";
import type {
  CrossDomainImpactDecisionCaptureStore,
  CrossDomainImpactEvaluationCaptureStore,
} from "../../application/ports/out/impact/cross-domain-impact-capture-store.ts";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  CrossDomainImpactDecisionRecrossError,
  recrossCrossDomainImpactDecision,
} from "../../application/use-cases/impact/recross-cross-domain-impact-decision.ts";
import {
  CROSS_DOMAIN_IMPACT_DECISION_CAPTURE_SCHEMA,
  type CrossDomainImpactDecisionCapture,
  crossDomainImpactDecisionCaptureUri,
  validateCrossDomainImpactDecisionCapture,
} from "../../domain/impact/cross-domain-impact-decision-capture.ts";
import { crossDomainImpactEvaluationCaptureUri } from "../../domain/impact/cross-domain-impact-evaluation-capture.ts";
import {
  CROSS_DOMAIN_IMPACT_DECISION_LIMITS,
  type CrossDomainImpactDecisionAdmission,
  DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION,
  parseCrossDomainImpactDecisionParameters,
} from "../../domain/impact/cross-domain-impact-decision-proposal.ts";
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
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../shared/executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "../shared/thread-write-basis-guard.ts";

export interface CrossDomainImpactDecisionThreadSnapshotStore
  extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface DecideAcceptCrossDomainImpactRunExecutorDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "acceptCrossDomainImpactDecision"
  >;
  readonly snapshots: CrossDomainImpactDecisionThreadSnapshotStore;
  readonly briefGates: CrossDomainImpactBriefGateReader;
  readonly evaluationCaptures: CrossDomainImpactEvaluationCaptureStore;
  readonly decisionCaptures: CrossDomainImpactDecisionCaptureStore;
  readonly lease: EngineeringProjectRunLease;
}

export class DecideAcceptCrossDomainImpactRunExecutor {
  constructor(
    private readonly dependencies: DecideAcceptCrossDomainImpactRunExecutorDependencies,
  ) {}

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "human") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only a human operator can execute decide.accept-cross-domain-impact@2. " +
          "An impact evaluation is not an impact decision.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);
    const approval = await requireMrtrApproval(project, run);
    const admission = parseAdmission(approval.proposal.parameters);
    const approvedDecisionId = approval.decision.id;
    const approvedDecisionFingerprint = approval.decision.inputFingerprint;
    return await this.dependencies.lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () =>
        this.#executeLeased(
          origin,
          command,
          approvedDecisionId,
          approvedDecisionFingerprint,
          admission,
        ),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
    approvedDecisionId: string,
    approvedDecisionFingerprint: ContentFingerprint | undefined,
    admission: CrossDomainImpactDecisionAdmission,
  ): Promise<EngineeringProjectSnapshot> {
    let snapshotWriteMayHaveBeenDispatched = false;
    try {
      const project = await this.#requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      requireShape(project, run);
      const completed = await this.#completedFor(command, admission);
      if (completed) return completed;
      if (run.status !== "queued") {
        throw unexpectedStatus(run, "queued");
      }
      const currentApproval = await requireMrtrApproval(project, run);
      if (
        currentApproval.decision.id !== approvedDecisionId ||
        !fingerprintsEqual(
          currentApproval.decision.inputFingerprint,
          approvedDecisionFingerprint,
        )
      ) {
        throw invalidTransition(
          "The human-approved cross-domain impact decision changed after preflight.",
        );
      }
      const currentAdmission = parseAdmission(currentApproval.proposal.parameters);
      if (deterministicJson(currentAdmission) !== deterministicJson(admission)) {
        throw invalidTransition(
          "The human-reviewed cross-domain impact-decision parameters changed after preflight.",
        );
      }

      await assertThreadWriteBasisAvailable(project, run);
      const basis = requireBasis(run);
      if (!isCurrentProjectBasis(project, basis)) {
        throw invalidTransition(
          "The queued impact-decision basis is not the unique current project Thread head.",
        );
      }
      const basisSnapshot = await exactBasisSnapshot(
        this.dependencies.snapshots,
        basis,
      );
      await assertThreadSnapshotLineageIntact(
        basisSnapshot,
        this.dependencies.snapshots,
      );
      if (
        admission.projectId !== command.projectId ||
        admission.subjectId !== basis.subjectId ||
        admission.basis.snapshotId !== basis.snapshotId ||
        admission.basis.revision !== basis.revision
      ) {
        throw invalidTransition(
          "The signed impact decision does not name this exact project Thread basis.",
        );
      }
      const recrossed = await recrossCrossDomainImpactDecision({
        project,
        basis,
        snapshot: basisSnapshot,
        briefGates: this.dependencies.briefGates,
        captures: this.dependencies.evaluationCaptures,
        snapshots: this.dependencies.snapshots,
        trustedRunId: run.id,
        excludeWorkItemId: run.workItemId,
      });
      if (
        deterministicJson(recrossed.admission) !== deterministicJson(currentAdmission)
      ) {
        throw invalidTransition(
          "The signed impact-decision parameters do not equal the current recross.",
        );
      }

      const capture = validateCrossDomainImpactDecisionCapture({
        schemaVersion: CROSS_DOMAIN_IMPACT_DECISION_CAPTURE_SCHEMA,
        kind: "cross-domain-impact-decision",
        operation: DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION,
        trustedRunId: run.id,
        decisionId: currentApproval.decision.id,
        sealedAt: command.issuedAt,
        admission: currentAdmission,
        evaluationCapture: {
          id: recrossed.artifact.id,
          fingerprint: recrossed.artifact.fingerprint,
          uri: recrossed.artifact.uri ??
            crossDomainImpactEvaluationCaptureUri(
              recrossed.artifact.fingerprint.digest,
            ),
        },
        limits: CROSS_DOMAIN_IMPACT_DECISION_LIMITS,
      });
      const captureFingerprint = await sha256Fingerprint(capture);
      const captureUri = crossDomainImpactDecisionCaptureUri(captureFingerprint.digest);
      const existingCapture = await this.dependencies.decisionCaptures.read(
        captureFingerprint,
      );
      if (!existingCapture) {
        const receipt = await this.dependencies.decisionCaptures.save(capture);
        if (
          !fingerprintsEqual(receipt.fingerprint, captureFingerprint) ||
          receipt.uri !== captureUri
        ) {
          throw new Error(
            "Impact-decision capture save did not retain its content address.",
          );
        }
      } else if (deterministicJson(existingCapture) !== deterministicJson(capture)) {
        throw invalidTransition(
          "The stored impact-decision capture does not match its deterministic reconstruction.",
        );
      }
      const reopened = await this.dependencies.decisionCaptures.read(
        captureFingerprint,
      );
      if (!reopened || deterministicJson(reopened) !== deterministicJson(capture)) {
        throw new Error("Impact-decision capture changed during exact readback.");
      }

      const expectedSuccessor = buildSuccessor({
        basisSnapshot,
        run,
        capture: reopened,
        captureFingerprint,
        captureUri,
        evaluationArtifactId: recrossed.artifact.id,
      });
      snapshotWriteMayHaveBeenDispatched = true;
      const existing = await this.dependencies.snapshots.getFresh(
        expectedSuccessor.snapshot.id,
      );
      if (existing) {
        const validated = validateThreadSnapshot(existing);
        if (
          deterministicJson(validated) !== deterministicJson(expectedSuccessor.snapshot)
        ) {
          throw invalidTransition(
            "The publishing impact-decision successor is not the exact deterministic capture extension.",
          );
        }
      } else {
        await this.dependencies.snapshots.save(expectedSuccessor.snapshot);
        const readback = await this.dependencies.snapshots.getFresh(
          expectedSuccessor.snapshot.id,
        );
        if (
          !readback ||
          deterministicJson(readback) !== deterministicJson(expectedSuccessor.snapshot)
        ) {
          throw new Error(
            "Impact-decision ThreadSnapshot was not exactly readable after save.",
          );
        }
      }

      return await this.dependencies.commands.acceptCrossDomainImpactDecision(origin, {
        commandId: command.commandId,
        projectId: command.projectId,
        expectedRevision: (await this.#requiredProject(command.projectId)).revision,
        issuedAt: command.issuedAt,
        runId: command.runId,
        summary: "Accepted the exact cross-domain impact decision.",
        decisionId: currentApproval.decision.id,
        resultSnapshot: snapshotRef(expectedSuccessor.snapshot),
        evidenceRefs: [{
          snapshotId: expectedSuccessor.snapshot.id,
          snapshotRevision: expectedSuccessor.snapshot.revision,
          kind: "artifact",
          id: expectedSuccessor.artifact.id,
        }],
        evaluationCapture: {
          id: recrossed.artifact.id,
          fingerprint: recrossed.artifact.fingerprint,
        },
        appliedGateClaims: currentAdmission.workItemClaims,
        limits: CROSS_DOMAIN_IMPACT_DECISION_LIMITS,
      });
    } catch (error) {
      if (error instanceof CrossDomainImpactDecisionRecrossError) {
        throw invalidTransition(error.message);
      }
      if (snapshotWriteMayHaveBeenDispatched) {
        const completed = await this.#completedFor(command, admission);
        if (completed) return completed;
        throw invalidTransition(
          "Impact-decision Thread write may have been dispatched, but project attachment did not finish. Retry this exact command to reopen the deterministic successor.",
        );
      }
      throw error;
    }
  }

  async #requiredProject(projectId: string): Promise<EngineeringProjectSnapshot> {
    const project = await this.dependencies.projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Project ${projectId} was not found.`,
      );
    }
    return project;
  }

  async #completedFor(
    command: RegisteredProjectRunExecutorCommand,
    admission: CrossDomainImpactDecisionAdmission,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status !== "completed") return undefined;
    await this.#assertCompletedEvidence(project, command, admission);
    return project;
  }

  async #assertCompletedEvidence(
    project: EngineeringProjectSnapshot,
    command: RegisteredProjectRunExecutorCommand,
    admission: CrossDomainImpactDecisionAdmission,
  ): Promise<void> {
    const run = requireRun(project, command.runId);
    const basis = requireBasis(run);
    if (run.status !== "completed" || !run.resultSnapshot) {
      throw invalidTransition(
        "The cross-domain impact decision did not complete through this exact run.",
      );
    }
    const snapshot = await this.dependencies.snapshots.getFresh(
      run.resultSnapshot.snapshotId,
    );
    if (
      !snapshot || snapshot.id !== run.resultSnapshot.snapshotId ||
      snapshot.revision !== run.resultSnapshot.revision ||
      snapshot.subject.id !== run.resultSnapshot.subjectId ||
      snapshot.revision !== basis.revision + 1 ||
      snapshot.subject.id !== basis.subjectId ||
      snapshot.previous?.snapshotId !== basis.snapshotId ||
      snapshot.previous.revision !== basis.revision
    ) {
      throw invalidTransition(
        "The completed cross-domain impact decision lacks its exact direct Thread successor.",
      );
    }
    const validated = validateThreadSnapshot(snapshot);
    const evidence = exactCompletedEvidence(project, run, validated);
    const artifact = validated.artifacts.find((candidate) =>
      candidate.id === evidence.id
    );
    if (!artifact || artifact.kind !== "document") {
      throw invalidTransition(
        "The completed impact-decision evidence is not a Thread document.",
      );
    }
    const capture = await this.dependencies.decisionCaptures.read(artifact.fingerprint);
    if (
      !capture || capture.trustedRunId !== run.id ||
      deterministicJson(capture.admission) !== deterministicJson(admission)
    ) {
      throw invalidTransition(
        "The completed impact-decision capture no longer equals its exact run.",
      );
    }
    const observedFingerprint = await sha256Fingerprint(capture);
    if (!fingerprintsEqual(observedFingerprint, artifact.fingerprint)) {
      throw invalidTransition(
        "The completed impact-decision capture fingerprint no longer matches its Thread artifact.",
      );
    }
    if (
      artifact.uri !== crossDomainImpactDecisionCaptureUri(observedFingerprint.digest)
    ) {
      throw invalidTransition(
        "The completed impact-decision document does not retain its canonical capture URI.",
      );
    }
    const workItemsById = new Map(project.workItems.map((item) => [item.id, item]));
    for (const claimed of admission.workItemClaims) {
      const workItem = workItemsById.get(claimed.workItemId);
      const match = workItem?.gateClaims?.find((item) =>
        item.gateItemId === claimed.gateItemId && item.role === claimed.role
      );
      if (!match || match.status !== claimed.status) {
        throw invalidTransition(
          "The completed impact decision did not retain the signed work-item gate-claim transitions.",
        );
      }
    }
  }
}

function buildSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly run: EngineeringAgentRun;
  readonly capture: CrossDomainImpactDecisionCapture;
  readonly captureFingerprint: ContentFingerprint;
  readonly captureUri: string;
  readonly evaluationArtifactId: string;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  if (
    input.capture.trustedRunId !== input.run.id ||
    input.captureUri !==
      crossDomainImpactDecisionCaptureUri(input.captureFingerprint.digest) ||
    input.capture.evaluationCapture.id !== input.evaluationArtifactId
  ) {
    throw invalidTransition(
      "Impact-decision capture does not match its exact trusted run and evaluation document.",
    );
  }
  const evaluation = input.basisSnapshot.artifacts.filter((artifact) =>
    artifact.id === input.evaluationArtifactId
  );
  if (evaluation.length !== 1 || evaluation[0]!.kind !== "document") {
    throw invalidTransition(
      "Impact-decision capture does not name one exact evaluation document on its basis.",
    );
  }
  const producer = {
    serverId: "digital-thread",
    tool:
      `${DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.id}@${DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.version}`,
    runId: input.run.id,
  } as const;
  const artifact: ThreadArtifact = {
    id: `cross-domain-impact-decision-${input.captureFingerprint.digest}`,
    name: "Cross-domain impact decision",
    kind: "document",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri: input.captureUri,
    mediaType: "application/json",
    producer,
    inputArtifactIds: [evaluation[0]!.id],
    freshness: {
      status: "fresh",
      changedAt: input.capture.sealedAt,
      invalidatedByChangeIds: [],
    },
  };
  const consumptions: ThreadArtifactConsumption[] = [{
    id: `decide-accept-cross-domain-impact-${input.run.id}:consume:${
      evaluation[0]!.id
    }`,
    artifactId: evaluation[0]!.id,
    consumer: producer,
    observedFingerprint: evaluation[0]!.fingerprint,
    verifiedAt: input.capture.sealedAt,
    status: "verified",
  }];
  const extension: ThreadSnapshotExtension = {
    id: `decide-accept-cross-domain-impact-${input.run.id}`,
    name: "Accept the exact cross-domain impact decision",
    subjectId: input.basisSnapshot.subject.id,
    capturedAt: input.capture.sealedAt,
    artifacts: [artifact],
    consumptions,
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      {
        id: `decide-accept-cross-domain-impact-${input.run.id}:derived-from:${
          evaluation[0]!.id
        }`,
        relation: "derived_from",
        from: { kind: "artifact", id: artifact.id },
        to: { kind: "artifact", id: evaluation[0]!.id },
        rationale: "The impact decision reread this exact evaluation capture.",
      },
      {
        id: `decide-accept-cross-domain-impact-${input.run.id}:uses:${
          evaluation[0]!.id
        }`,
        relation: "uses",
        from: {
          kind: "consumption",
          id: `decide-accept-cross-domain-impact-${input.run.id}:consume:${
            evaluation[0]!.id
          }`,
        },
        to: { kind: "artifact", id: evaluation[0]!.id },
        rationale:
          "The human impact decision verified this exact evaluation fingerprint.",
      },
    ],
    proposedActions: [],
  };
  const applied = applyThreadSnapshotExtensionIfNew(input.basisSnapshot, extension, {
    appliedAt: input.capture.sealedAt,
  });
  if (!applied.applied) {
    throw invalidTransition(
      "This exact cross-domain impact decision document is already present in the basis snapshot.",
    );
  }
  return { snapshot: validateThreadSnapshot(applied.snapshot), artifact };
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  if (
    run.basis?.kind !== "thread-snapshot" ||
    !workItem ||
    operation?.id !== DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.id ||
    operation.version !== DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.version ||
    operation.bindings.length !== 1 ||
    operation.bindings[0]?.name !== "approvedBrief" ||
    operation.bindings[0].source.kind !== "approved-brief"
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to ${DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.id}@${DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.version} with the sole approvedBrief binding.`,
    );
  }
}

async function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<{
  readonly decision: EngineeringDecision;
  readonly proposal: NonNullable<EngineeringDecision["proposal"]>;
}> {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!workItem) throw invalidTransition(`Work item for run ${run.id} is absent.`);
  const basis = requireBasis(run);
  const candidates: Array<{
    decision: EngineeringDecision;
    proposal: NonNullable<EngineeringDecision["proposal"]>;
  }> = [];
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
        ? "No exact human-approved cross-domain impact decision is bound to this run basis."
        : "Ambiguous impact decision: exactly one human-approved decision is required.",
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
      "The impact-decision fingerprint no longer seals its exact basis, evidence, summary, and parameters.",
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
      "The impact-decision run fingerprint no longer seals its exact MRTR decision, operation, and basis.",
    );
  }
  parseAdmission(selected.proposal.parameters);
  return selected;
}

function parseAdmission(
  parameters: NonNullable<EngineeringDecision["proposal"]>["parameters"],
): CrossDomainImpactDecisionAdmission {
  try {
    return parseCrossDomainImpactDecisionParameters(parameters);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      error instanceof Error
        ? error.message
        : "The impact-decision proposal is not the closed MRTR grammar.",
    );
  }
}

async function exactBasisSnapshot(
  snapshots: CrossDomainImpactDecisionThreadSnapshotStore,
  basis: ReturnType<typeof requireBasis>,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.getFresh(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision || snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The exact Thread basis snapshot is not available for the impact decision.",
    );
  }
  return validateThreadSnapshot(snapshot);
}

function exactCompletedEvidence(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  snapshot: ThreadSnapshot,
): EngineeringThreadEntityRef {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const declared = project.threadSnapshots.filter((reference) =>
    reference.snapshotId === snapshot.id &&
    reference.revision === snapshot.revision &&
    reference.subjectId === snapshot.subject.id
  );
  if (
    !workItem || declared.length !== 1 || run.evidenceRefs.length !== 1 ||
    workItem.evidenceRefs.length !== 1 ||
    !sameEvidenceRefs(run.evidenceRefs, workItem.evidenceRefs)
  ) {
    throw invalidTransition(
      "The completed impact-decision run is not attached to exactly one declared document artifact.",
    );
  }
  const evidence = run.evidenceRefs[0]!;
  if (
    evidence.snapshotId !== snapshot.id ||
    evidence.snapshotRevision !== snapshot.revision ||
    evidence.kind !== "artifact"
  ) {
    throw invalidTransition(
      "The completed impact-decision evidence reference is not the sealed document.",
    );
  }
  return evidence;
}

function sameSnapshotBasis(
  value: { snapshotId: string; revision: number; subjectId: string } | undefined,
  basis: ReturnType<typeof requireBasis>,
): boolean {
  return !!value &&
    value.snapshotId === basis.snapshotId &&
    value.revision === basis.revision &&
    value.subjectId === basis.subjectId;
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
    leftKeys.every((item, index) => item === rightKeys[index]);
}

function isCurrentProjectBasis(
  project: EngineeringProjectSnapshot,
  basis: ReturnType<typeof requireBasis>,
): boolean {
  const subjectReferences = project.threadSnapshots.filter(
    (reference) => reference.subjectId === basis.subjectId,
  );
  const highestRevision = subjectReferences.reduce(
    (highest, reference) => Math.max(highest, reference.revision),
    -1,
  );
  const heads = subjectReferences.filter((reference) =>
    reference.revision === highestRevision
  );
  return project.project.subjectId === basis.subjectId && heads.length === 1 &&
    heads[0]!.snapshotId === basis.snapshotId &&
    heads[0]!.revision === basis.revision;
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
