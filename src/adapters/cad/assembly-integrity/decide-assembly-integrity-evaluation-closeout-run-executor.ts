/**
 * Human-only, recoverable L5 assembly-integrity closeout executor.
 *
 * The executor shares the exact evidence resolver used by the public review,
 * persists a deterministic CAS capture, and writes one documentary Thread
 * successor. It never invokes the observer, a provider, SysON, a tolerance,
 * or a remediation operation.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_SCHEMA,
  type AssemblyIntegrityEvaluationCloseoutAdmission,
  type AssemblyIntegrityEvaluationCloseoutConsequence,
  type AssemblyIntegrityEvaluationCloseoutOperation,
  assemblyIntegrityEvaluationCloseoutWorkItemOperation,
  DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
  DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
  parseAssemblyIntegrityEvaluationCloseoutParameters,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-closeout-proposal.ts";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_URI_PREFIX,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import { leafRevisionIdsForActivity } from "../../../domain/project/engineering-activity.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadProvenanceLink,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
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
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX,
  ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_LIMITS,
  type AssemblyIntegrityEvaluationCloseoutCapture,
  canonicalAssemblyIntegrityEvaluationCloseoutCaptureText,
  validateAssemblyIntegrityEvaluationCloseoutCapture,
} from "./assembly-integrity-evaluation-closeout-capture.ts";
import {
  assemblyIntegrityCloseoutAuthorization,
  type AssemblyIntegrityCloseoutEvidenceResolverDependencies,
  AssemblyIntegrityCloseoutResolutionError,
  type AssemblyIntegrityCloseoutResolvedEvidence,
  assemblyIntegrityEvaluationCloseoutAdmission,
  resolveAssemblyIntegrityCloseoutEvidence,
} from "./assembly-integrity-closeout-evidence-resolver.ts";

export {
  DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
  DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
};

export interface AssemblyIntegrityCloseoutSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface AssemblyIntegrityEvaluationCloseoutCaptureStore {
  save(fingerprint: ContentFingerprint, canonicalText: string): Promise<unknown>;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  uriFor(fingerprint: ContentFingerprint): string;
}

export interface DecideAssemblyIntegrityEvaluationCloseoutRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface DecideAssemblyIntegrityEvaluationCloseoutRunExecutorDependencies
  extends AssemblyIntegrityCloseoutEvidenceResolverDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: AssemblyIntegrityCloseoutSnapshotStore;
  readonly closeoutCaptures: AssemblyIntegrityEvaluationCloseoutCaptureStore;
  readonly lease: EngineeringProjectRunLease;
}

export class DecideAssemblyIntegrityEvaluationCloseoutRunExecutor {
  constructor(
    private readonly dependencies:
      DecideAssemblyIntegrityEvaluationCloseoutRunExecutorDependencies,
  ) {}

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: DecideAssemblyIntegrityEvaluationCloseoutRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "human") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only a human operator can execute an assembly-integrity L5 closeout. An L4 pass is not L5, safety, or certification.",
      );
    }
    const project = await this.requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    const operation = requireCloseoutShape(project, run);
    const approval = await requireMrtrApproval(project, run);
    const admission = parseAdmission(approval.proposal.parameters, operation);
    return await this.dependencies.lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.executeLeased(origin, command, approval.decision, admission),
    );
  }

  private async executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: DecideAssemblyIntegrityEvaluationCloseoutRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: AssemblyIntegrityEvaluationCloseoutAdmission,
  ): Promise<EngineeringProjectSnapshot> {
    let newlyClaimed = false;
    let successorPersisted = false;
    try {
      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      const operation = requireCloseoutShape(project, run);
      const basis = requireBasis(run);
      const basisSnapshot = await exactBasisSnapshot(
        this.dependencies.snapshots,
        basis,
      );
      await assertThreadSnapshotLineageIntact(
        basisSnapshot,
        this.dependencies.snapshots,
      );
      await recrossAdmission(
        command,
        project,
        run,
        admission,
        basis,
        basisSnapshot,
        this.dependencies,
      );

      if (run.status === "completed") {
        const persisted = await this.reopenCloseoutCapture(
          run,
          operation,
          approvedDecision.id,
          admission,
        );
        const successor = buildSuccessor({
          basisSnapshot,
          basis,
          run,
          operation,
          capture: persisted.capture,
          captureFingerprint: persisted.captureFingerprint,
        });
        await this.assertSavedSuccessor(successor.snapshot);
        assertCompletedEvidence(project, run, successor.snapshot, successor.artifact);
        return project;
      }
      await assertThreadWriteBasisAvailable(project, run);
      if (run.status === "queued") {
        await this.dependencies.commands.claimRun(
          origin,
          claimCommand(command, operation, admission.consequence),
        );
        newlyClaimed = true;
      } else if (run.status === "running" || run.status === "publishing") {
        requireClaimedByHuman(project, run, origin);
      } else {
        throw unexpectedStatus(
          run,
          "queued or this human operator's running/publishing",
        );
      }

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      requireClaimedByHuman(project, run, origin);
      const currentApproval = await requireMrtrApproval(project, run);
      if (currentApproval.decision.id !== approvedDecision.id) {
        throw invalidTransition(
          "The exact human closeout decision changed after the run was claimed.",
        );
      }
      const currentOperation = requireCloseoutShape(project, run);
      const currentAdmission = parseAdmission(
        currentApproval.proposal.parameters,
        currentOperation,
      );
      if (deterministicJson(currentAdmission) !== deterministicJson(admission)) {
        throw invalidTransition(
          "The signed assembly-integrity closeout admission changed after claim.",
        );
      }
      const currentBasis = requireBasis(run);
      const currentBasisSnapshot = await exactBasisSnapshot(
        this.dependencies.snapshots,
        currentBasis,
      );
      await assertThreadSnapshotLineageIntact(
        currentBasisSnapshot,
        this.dependencies.snapshots,
      );
      await recrossAdmission(
        command,
        project,
        run,
        currentAdmission,
        currentBasis,
        currentBasisSnapshot,
        this.dependencies,
      );

      const persisted = run.status === "publishing"
        ? await this.reopenCloseoutCapture(
          run,
          currentOperation,
          currentApproval.decision.id,
          currentAdmission,
        )
        : await this.persistCloseoutCapture(
          run,
          currentOperation,
          currentApproval.decision.id,
          currentAdmission,
        );
      const successor = buildSuccessor({
        basisSnapshot: currentBasisSnapshot,
        basis: currentBasis,
        run,
        operation: currentOperation,
        capture: persisted.capture,
        captureFingerprint: persisted.captureFingerprint,
      });
      await this.saveOrAssertSuccessor(successor.snapshot);
      successorPersisted = true;

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.dependencies.commands.publishRun(
          origin,
          publishCommand(
            command,
            currentOperation,
            currentAdmission.consequence,
            project.revision,
          ),
        );
      } else if (run.status !== "publishing") {
        throw unexpectedStatus(run, "running or publishing");
      }

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.dependencies.commands.completeRun(
          origin,
          completionCommand(
            command,
            currentOperation,
            currentAdmission.consequence,
            project.revision,
            successor.snapshot,
            successor.artifact,
          ),
        );
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "publishing or completed");
      }
      return await this.requiredProject(command.projectId);
    } catch (error) {
      if (newlyClaimed && !successorPersisted) {
        await this.failUnpublishedBestEffort(origin, command, error);
      }
      throw error;
    }
  }

  private async persistCloseoutCapture(
    run: EngineeringAgentRun,
    operation: AssemblyIntegrityEvaluationCloseoutOperation,
    decisionId: string,
    admission: AssemblyIntegrityEvaluationCloseoutAdmission,
  ): Promise<{
    readonly capture: AssemblyIntegrityEvaluationCloseoutCapture;
    readonly captureFingerprint: ContentFingerprint;
  }> {
    const capture = closeoutCapture(run, operation, decisionId, admission);
    const text = canonicalAssemblyIntegrityEvaluationCloseoutCaptureText(capture);
    const captureFingerprint = await sha256Fingerprint(capture);
    assertCloseoutCaptureStoreUri(
      this.dependencies.closeoutCaptures,
      captureFingerprint,
    );
    await this.dependencies.closeoutCaptures.save(captureFingerprint, text);
    const reread = await this.dependencies.closeoutCaptures.read(captureFingerprint);
    if (reread !== text) {
      throw invalidTransition(
        "The assembly-integrity closeout capture was not durably readable after save.",
      );
    }
    return {
      capture: validateAssemblyIntegrityEvaluationCloseoutCapture(JSON.parse(reread)),
      captureFingerprint,
    };
  }

  private async reopenCloseoutCapture(
    run: EngineeringAgentRun,
    operation: AssemblyIntegrityEvaluationCloseoutOperation,
    decisionId: string,
    admission: AssemblyIntegrityEvaluationCloseoutAdmission,
  ): Promise<{
    readonly capture: AssemblyIntegrityEvaluationCloseoutCapture;
    readonly captureFingerprint: ContentFingerprint;
  }> {
    const expected = closeoutCapture(run, operation, decisionId, admission);
    const text = canonicalAssemblyIntegrityEvaluationCloseoutCaptureText(expected);
    const captureFingerprint = await sha256Fingerprint(expected);
    assertCloseoutCaptureStoreUri(
      this.dependencies.closeoutCaptures,
      captureFingerprint,
    );
    const reread = await this.dependencies.closeoutCaptures.read(captureFingerprint);
    if (reread !== text) {
      throw invalidTransition(
        "The publishing assembly-integrity closeout has no exact durable capture for recovery.",
      );
    }
    return {
      capture: validateAssemblyIntegrityEvaluationCloseoutCapture(JSON.parse(reread)),
      captureFingerprint,
    };
  }

  private async saveOrAssertSuccessor(snapshot: ThreadSnapshot): Promise<void> {
    const known = await this.dependencies.snapshots.getFresh(snapshot.id);
    if (known) {
      if (
        deterministicJson(validateThreadSnapshot(known)) !== deterministicJson(snapshot)
      ) {
        throw invalidTransition(
          "The persisted assembly-integrity closeout successor differs from deterministic reconstruction.",
        );
      }
      return;
    }
    await this.dependencies.snapshots.save(snapshot);
    await this.assertSavedSuccessor(snapshot);
  }

  private async assertSavedSuccessor(snapshot: ThreadSnapshot): Promise<void> {
    const saved = await this.dependencies.snapshots.getFresh(snapshot.id);
    if (
      !saved ||
      deterministicJson(validateThreadSnapshot(saved)) !== deterministicJson(snapshot)
    ) {
      throw invalidTransition(
        "The assembly-integrity closeout has no exact saved Thread successor.",
      );
    }
  }

  private async failUnpublishedBestEffort(
    origin: EngineeringProjectCommandOrigin,
    command: DecideAssemblyIntegrityEvaluationCloseoutRunExecutorCommand,
    cause: unknown,
  ): Promise<void> {
    try {
      const project = await this.requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      const operation = requireCloseoutShape(project, run);
      if (run.status !== "running") return;
      await this.dependencies.commands.failRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, operation, "fail"),
        expectedRevision: project.revision,
        summary:
          "Assembly-integrity evaluation closeout stopped before Thread publication.",
        code: `${operation.id.replaceAll(".", "-")}-not-published`,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } catch {
      // The original integrity error remains authoritative.
    }
  }

  private async requiredProject(
    projectId: string,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.dependencies.projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }
}

async function recrossAdmission(
  command: DecideAssemblyIntegrityEvaluationCloseoutRunExecutorCommand,
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  admission: AssemblyIntegrityEvaluationCloseoutAdmission,
  basis: ReturnType<typeof requireBasis>,
  snapshot: ThreadSnapshot,
  dependencies: AssemblyIntegrityCloseoutEvidenceResolverDependencies,
): Promise<AssemblyIntegrityCloseoutResolvedEvidence> {
  if (
    admission.projectId !== command.projectId ||
    admission.subjectId !== basis.subjectId ||
    admission.basis.snapshotId !== basis.snapshotId ||
    admission.basis.revision !== basis.revision
  ) {
    throw invalidTransition(
      "The signed assembly-integrity closeout does not match the project and Thread basis.",
    );
  }
  try {
    const resolved = await resolveAssemblyIntegrityCloseoutEvidence(
      dependencies,
      { project, basis, snapshot },
    );
    const authorization = assemblyIntegrityCloseoutAuthorization(
      project,
      admission.consequence,
    );
    const expected = assemblyIntegrityEvaluationCloseoutAdmission(
      resolved,
      admission.consequence,
      authorization,
    );
    if (deterministicJson(expected) !== deterministicJson(admission)) {
      throw invalidTransition(
        "The signed assembly-integrity closeout no longer matches the exact current fresh L4 capture and limits.",
      );
    }
    assertAssemblyIntegrityCloseoutGateClaims(
      project,
      run,
      admission,
      resolved,
    );
    return resolved;
  } catch (error) {
    if (error instanceof EngineeringProjectCommandError) throw error;
    if (error instanceof AssemblyIntegrityCloseoutResolutionError) {
      throw invalidTransition(
        `The signed assembly-integrity closeout cannot be recrossed: ${error.message}`,
      );
    }
    throw invalidTransition(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Gate identity stays entirely current-Brief-owned. Review seals the complete
 * compatible authority-derived set into the admission; execution admits only
 * an identical set on the appended human work item.
 */
export function assertAssemblyIntegrityCloseoutGateClaims(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  admission: AssemblyIntegrityEvaluationCloseoutAdmission,
  resolved: AssemblyIntegrityCloseoutResolvedEvidence,
): void {
  const work = project.workItems.find((item) => item.id === run.workItemId);
  if (!work) {
    throw invalidTransition("The assembly-integrity closeout work item is absent.");
  }
  assertCurrentAppendedCloseoutLeaf(project, work, resolved, admission);
  if (!work.dependsOnWorkItemIds.includes(resolved.l4Run.workItemId)) {
    throw invalidTransition(
      "The assembly-integrity closeout work item must depend on the exact selected L4 work item.",
    );
  }
  const claims = work.gateClaims ?? [];
  if (deterministicJson(claims) !== deterministicJson(admission.gateClaims)) {
    throw invalidTransition(
      "The appended assembly-integrity L5 work item gate claims must exactly equal the signed canonical admission claims.",
    );
  }
}

/**
 * Multiple historical L5 dispositions are valid.  This executor authorizes
 * only the one newly appended leaf whose plan change starts from the exact
 * current L4 result selected by the shared resolver.
 */
function assertCurrentAppendedCloseoutLeaf(
  project: EngineeringProjectSnapshot,
  work: EngineeringWorkItem,
  resolved: AssemblyIntegrityCloseoutResolvedEvidence,
  admission: AssemblyIntegrityEvaluationCloseoutAdmission,
): void {
  const revisions = project.workItems.filter((item) =>
    item.activityId === work.activityId
  );
  const leaves = leafRevisionIdsForActivity(revisions);
  if (leaves.length !== 1 || leaves[0] !== work.id) {
    throw invalidTransition(
      "The assembly-integrity L5 work item must be the unique current leaf revision of its activity.",
    );
  }
  const changes = (project.planChanges ?? []).filter((change) =>
    change.workItemIds.includes(work.id)
  );
  if (changes.length !== 1) {
    throw invalidTransition(
      "The assembly-integrity L5 work item must occur in exactly one appended plan change.",
    );
  }
  const change = changes[0]!;
  const l4Result = resolved.l4Run.resultSnapshot;
  if (
    !l4Result ||
    change.baseSnapshot.snapshotId !== l4Result.snapshotId ||
    change.baseSnapshot.revision !== l4Result.revision ||
    change.baseSnapshot.subjectId !== l4Result.subjectId
  ) {
    throw invalidTransition(
      "The appended assembly-integrity L5 work item must start from the exact selected L4 current result snapshot.",
    );
  }
  if (
    deterministicJson(change.approvedBriefBasis) !==
      deterministicJson(admission.approvedBriefBasis)
  ) {
    throw invalidTransition(
      "The appended assembly-integrity L5 plan change must retain the exact signed current approved Brief basis.",
    );
  }
}

function closeoutCapture(
  run: EngineeringAgentRun,
  operation: AssemblyIntegrityEvaluationCloseoutOperation,
  decisionId: string,
  admission: AssemblyIntegrityEvaluationCloseoutAdmission,
): AssemblyIntegrityEvaluationCloseoutCapture {
  return validateAssemblyIntegrityEvaluationCloseoutCapture({
    schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_SCHEMA,
    kind: "assembly-integrity-evaluation-closeout",
    operation,
    trustedRunId: run.id,
    decisionId,
    sealedAt: requiredStart(run),
    admission,
    evaluationCapture: {
      id: admission.evaluationCapture.id,
      fingerprint: admission.evaluationCapture.fingerprint,
      uri:
        `${ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_URI_PREFIX}${admission.evaluationCapture.fingerprint.digest}`,
    },
    l4Limitations: admission.limitations,
    limits: ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_LIMITS,
  });
}

function assertCloseoutCaptureStoreUri(
  captures: AssemblyIntegrityEvaluationCloseoutCaptureStore,
  fingerprint: ContentFingerprint,
): void {
  const expected =
    `${ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX}sha256/${fingerprint.digest}`;
  if (captures.uriFor(fingerprint) !== expected) {
    throw invalidTransition(
      "The assembly-integrity closeout capture store uses an unexpected CAS URI namespace.",
    );
  }
}

function buildSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: ReturnType<typeof requireBasis>;
  readonly run: EngineeringAgentRun;
  readonly operation: AssemblyIntegrityEvaluationCloseoutOperation;
  readonly capture: AssemblyIntegrityEvaluationCloseoutCapture;
  readonly captureFingerprint: ContentFingerprint;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const sealedAt = requiredStart(input.run);
  const artifactId =
    `assembly-integrity-evaluation-closeout-${input.captureFingerprint.digest}`;
  const operationRef = {
    serverId: "digital-thread",
    tool: `${input.operation.id}@${input.operation.version}`,
    runId: input.run.id,
  };
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: input.capture.admission.consequence === "accept"
      ? "Accepted assembly-integrity evaluation closeout"
      : "Rejected assembly-integrity evaluation closeout",
    kind: "document",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri:
      `${ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX}sha256/${input.captureFingerprint.digest}`,
    mediaType: "application/json",
    producer: operationRef,
    inputArtifactIds: [input.capture.evaluationCapture.id],
    freshness: {
      status: "fresh",
      changedAt: sealedAt,
      invalidatedByChangeIds: [],
    },
  };
  const consumption: ThreadArtifactConsumption = {
    id: `consume-${input.capture.evaluationCapture.id}-by-${artifact.id}`,
    artifactId: input.capture.evaluationCapture.id,
    consumer: operationRef,
    observedFingerprint: input.capture.evaluationCapture.fingerprint,
    verifiedAt: sealedAt,
    status: "verified",
  };
  const provenance: ThreadProvenanceLink[] = [
    {
      id: `${artifact.id}-derived-from-${input.capture.evaluationCapture.id}`,
      relation: "derived_from",
      from: { kind: "artifact", id: artifact.id },
      to: { kind: "artifact", id: input.capture.evaluationCapture.id },
      rationale:
        "The human L5 closeout document is derived from this exact reopened L4 evaluation capture.",
    },
    {
      id: `${consumption.id}-uses`,
      relation: "uses",
      from: { kind: "consumption", id: consumption.id },
      to: { kind: "artifact", id: consumption.artifactId },
      rationale:
        "The closeout executor reread and fingerprint-attested the exact direct L4 input.",
    },
  ];
  const extension: ThreadSnapshotExtension = {
    id: `${input.operation.id.replaceAll(".", "-")}-${input.run.id}`,
    name: input.capture.admission.consequence === "accept"
      ? "Accept assembly-integrity evaluation"
      : "Reject assembly-integrity evaluation",
    subjectId: input.basis.subjectId,
    capturedAt: sealedAt,
    artifacts: [artifact],
    consumptions: [consumption],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance,
    // The reviewed human disposition is already complete. It never schedules a
    // new correction, provider, CAD, FEA, safety, or certification action.
    proposedActions: [],
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    extension,
    { appliedAt: sealedAt },
  );
  if (!applied.applied) {
    throw invalidTransition(
      "This exact assembly-integrity closeout is already present in the basis snapshot.",
    );
  }
  return { snapshot: validateThreadSnapshot(applied.snapshot), artifact };
}

function requireCloseoutShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): AssemblyIntegrityEvaluationCloseoutOperation {
  const work = project.workItems.find((item) => item.id === run.workItemId);
  const operation = operationOf(work?.operation);
  const consequence = operation?.id ===
      DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.id
    ? "accept"
    : operation?.id === DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.id
    ? "reject"
    : undefined;
  if (
    !operation || !consequence ||
    deterministicJson(work?.operation) !==
      deterministicJson(
        assemblyIntegrityEvaluationCloseoutWorkItemOperation(consequence),
      )
  ) {
    throw invalidTransition(
      "The run is not the exact registered assembly-integrity closeout with the sole approvedBrief binding.",
    );
  }
  return operation;
}

function operationOf(
  operation: EngineeringWorkItem["operation"] | undefined,
): AssemblyIntegrityEvaluationCloseoutOperation | undefined {
  if (
    operation?.id === DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.id &&
    operation.version === DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.version
  ) return DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION;
  if (
    operation?.id === DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.id &&
    operation.version === DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.version
  ) return DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION;
  return undefined;
}

async function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<{
  readonly decision: EngineeringDecision;
  readonly proposal: NonNullable<EngineeringDecision["proposal"]>;
}> {
  const work = project.workItems.find((item) => item.id === run.workItemId);
  if (!work) throw invalidTransition(`Work item for run ${run.id} is absent.`);
  const basis = requireBasis(run);
  const candidates: Array<{
    decision: EngineeringDecision;
    proposal: NonNullable<EngineeringDecision["proposal"]>;
  }> = [];
  for (const decisionId of work.decisionIds) {
    const decision = project.decisions.find((item) =>
      item.id === decisionId && item.status === "approved"
    );
    if (!decision?.proposal || !decision.inputFingerprint) continue;
    const approvals = project.approvals.filter((approval: EngineeringApproval) =>
      approval.decisionId === decision.id &&
      approval.status === "approved" &&
      decision.approvalIds.includes(approval.id) &&
      approval.decidedByOrigin === "human" &&
      typeof approval.decidedBy === "string" && approval.decidedBy.trim() !== "" &&
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
        ? "No exact human-approved assembly-integrity closeout MRTR is bound to this run basis."
        : "Assembly-integrity closeout MRTR is ambiguous: exactly one human approval is required.",
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
      "The assembly-integrity closeout MRTR fingerprint no longer seals its exact basis, evidence, summary, and parameters.",
    );
  }
  const approvedDecisions = work.decisionIds.map((id) => {
    const decision = project.decisions.find((item) => item.id === id);
    if (!decision?.inputFingerprint) {
      throw invalidTransition(`Work-item decision ${id} is not exactly approved.`);
    }
    return { id, inputFingerprint: decision.inputFingerprint };
  });
  const expectedRunFingerprint = await sha256Fingerprint({
    workItemId: work.id,
    basis,
    operation: {
      id: work.operation?.id,
      version: work.operation?.version,
      bindings: work.operation?.bindings,
    },
    approvedDecisions,
  });
  if (!fingerprintsEqual(run.inputFingerprint, expectedRunFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The assembly-integrity closeout run fingerprint no longer seals its exact MRTR decision, operation, and basis.",
    );
  }
  return selected;
}

function sameSnapshotBasis(
  value:
    | EngineeringDecision["baseSnapshot"]
    | EngineeringApproval["baseSnapshot"]
    | EngineeringAgentRun["basis"],
  basis: ReturnType<typeof requireBasis>,
): boolean {
  return !!value && "snapshotId" in value &&
    value.snapshotId === basis.snapshotId && value.revision === basis.revision &&
    value.subjectId === basis.subjectId;
}

function sameEvidenceRefs(
  left: readonly EngineeringThreadEntityRef[],
  right: readonly EngineeringThreadEntityRef[],
): boolean {
  const key = (value: EngineeringThreadEntityRef) =>
    deterministicJson({
      snapshotId: value.snapshotId,
      snapshotRevision: value.snapshotRevision,
      kind: value.kind,
      id: value.id,
    });
  const a = [...left.map(key)].sort();
  const b = [...right.map(key)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function parseAdmission(
  parameters: NonNullable<EngineeringDecision["proposal"]>["parameters"],
  operation: AssemblyIntegrityEvaluationCloseoutOperation,
): AssemblyIntegrityEvaluationCloseoutAdmission {
  try {
    return parseAssemblyIntegrityEvaluationCloseoutParameters(parameters, operation);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Assembly-integrity closeout parameters are invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function exactBasisSnapshot(
  snapshots: AssemblyIntegrityCloseoutSnapshotStore,
  basis: ReturnType<typeof requireBasis>,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.getFresh(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision || snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The exact Thread basis snapshot is unavailable for the assembly-integrity closeout.",
    );
  }
  return validateThreadSnapshot(snapshot);
}

function requireClaimedByHuman(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  requireCloseoutShape(project, run);
  if (run.claimedBy?.origin !== "human" || run.claimedBy.id !== origin.actorId) {
    throw invalidTransition(
      "The assembly-integrity closeout was not claimed by this human operator.",
    );
  }
}

function assertCompletedEvidence(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  successor: ThreadSnapshot,
  artifact: ThreadArtifact,
): void {
  const expectedRef = snapshotRef(successor);
  const expectedEvidence: EngineeringThreadEntityRef[] = [{
    snapshotId: successor.id,
    snapshotRevision: successor.revision,
    kind: "artifact",
    id: artifact.id,
  }];
  if (
    run.status !== "completed" ||
    deterministicJson(run.resultSnapshot) !== deterministicJson(expectedRef) ||
    !sameEvidenceRefs(run.evidenceRefs, expectedEvidence) ||
    !project.threadSnapshots.some((item) =>
      deterministicJson(item) === deterministicJson(expectedRef)
    )
  ) {
    throw invalidTransition(
      "The completed assembly-integrity closeout does not retain its exact successor evidence.",
    );
  }
}

function claimCommand(
  command: DecideAssemblyIntegrityEvaluationCloseoutRunExecutorCommand,
  operation: AssemblyIntegrityEvaluationCloseoutOperation,
  consequence: AssemblyIntegrityEvaluationCloseoutConsequence,
): RunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, operation, "claim"),
    summary: closeoutSummary(consequence, "started"),
  };
}

function publishCommand(
  command: DecideAssemblyIntegrityEvaluationCloseoutRunExecutorCommand,
  operation: AssemblyIntegrityEvaluationCloseoutOperation,
  consequence: AssemblyIntegrityEvaluationCloseoutConsequence,
  expectedRevision: number,
): RunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, operation, "publish"),
    expectedRevision,
    summary: closeoutSummary(consequence, "publishing"),
  };
}

function completionCommand(
  command: DecideAssemblyIntegrityEvaluationCloseoutRunExecutorCommand,
  operation: AssemblyIntegrityEvaluationCloseoutOperation,
  consequence: AssemblyIntegrityEvaluationCloseoutConsequence,
  expectedRevision: number,
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, operation, "complete"),
    expectedRevision,
    summary: closeoutSummary(consequence, "completed"),
    resultSnapshot: snapshotRef(snapshot),
    evidenceRefs: [{
      snapshotId: snapshot.id,
      snapshotRevision: snapshot.revision,
      kind: "artifact",
      id: artifact.id,
    }],
  };
}

function closeoutSummary(
  consequence: AssemblyIntegrityEvaluationCloseoutConsequence,
  phase: "started" | "publishing" | "completed",
): string {
  const verb = consequence === "accept" ? "accept" : "reject";
  if (phase === "started") {
    return `Started the human ${verb} closeout of the assembly-integrity evaluation.`;
  }
  if (phase === "publishing") {
    return `Publishing the human ${verb} closeout of the assembly-integrity evaluation.`;
  }
  return `Recorded the human ${verb} closeout of the exact assembly-integrity evaluation.`;
}

function commandStep(
  commandId: string,
  operation: AssemblyIntegrityEvaluationCloseoutOperation,
  step: string,
): string {
  return `${commandId}:${operation.id}:${step}`;
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
