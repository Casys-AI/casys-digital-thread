import type {
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotRef,
} from "../project/engineering-project.ts";
import { applyThreadSnapshotExtension } from "../thread-snapshot-extension.ts";
import type {
  RequirementEvaluation,
  ThreadProvenanceLink,
  ThreadSnapshot,
  TracedRequirement,
} from "../thread-snapshot.ts";

export const CM01_V3_PROJECT_ID = "coffee-machine-cm01-v3" as const;
export const CM01_V3_SUBJECT_ID = "project:coffee-machine-cm01-v3" as const;
export const CM01_V3_FAILED_R2_WORK_ITEM_ID =
  "verify-cm01-v3-drip-tray-height-30-mechanical" as const;
export const CM01_V3_FAILED_R2_RUN_ID =
  "run:cm01-v3-r7-r10-28-to-30-queue-mechanical-r2" as const;
export const CM01_V3_R3_RECOVERY_WORK_ITEM_ID =
  "recover-cm01-v3-drip-tray-height-30-mechanical-r3-identity" as const;
export const CM01_V3_R3_RECOVERY_RUN_ID =
  "run:cm01-v3-r10-r11-mechanical-r3-identity-recovery-queue" as const;

const R11_SOLVE_ID = /^coffee-machine-cm01-v3-mechanical-r3-[a-f0-9]{64}-solve$/;
const CORRECTION_CHANGE_ID = "coffee-machine-cm01-v3-drip-tray-height-28-to-30:applied";
export const CM01_V3_R12_REQUIREMENT_CLOSEOUT_EXTENSION_ID =
  "coffee-machine-cm01-v3-r11-r12-requirement-family-closeout" as const;

export interface CoffeeMachineCm01V3R11CloseoutReady {
  readonly status: "ready-to-close";
  readonly failedWorkItemId: typeof CM01_V3_FAILED_R2_WORK_ITEM_ID;
  readonly failedRunId: typeof CM01_V3_FAILED_R2_RUN_ID;
  readonly successorRunId: typeof CM01_V3_R3_RECOVERY_RUN_ID;
  readonly successorRunSnapshot: EngineeringThreadSnapshotRef;
  readonly successorEvidenceRefs: readonly EngineeringThreadEntityRef[];
}

export interface CoffeeMachineCm01V3R11CloseoutClosed {
  readonly status: "closed";
  readonly failedWorkItemId: typeof CM01_V3_FAILED_R2_WORK_ITEM_ID;
  readonly successorRunId: typeof CM01_V3_R3_RECOVERY_RUN_ID;
  readonly successorRunSnapshot: EngineeringThreadSnapshotRef;
  readonly successorSnapshot: EngineeringThreadSnapshotRef;
  readonly successorEvidenceRefs: readonly EngineeringThreadEntityRef[];
}

export type CoffeeMachineCm01V3R11Closeout =
  | CoffeeMachineCm01V3R11CloseoutReady
  | CoffeeMachineCm01V3R11CloseoutClosed;

/**
 * Add the two missing requirement-family edges to the immutable R11 thread.
 *
 * R3 already supersedes the mislabeled R2 requirement identities. This closes
 * the historical R1 branch only after proving that the R1 evaluation is stale
 * for the named 28→30 correction and that R3 passes the identical criterion.
 * No provider is called and no measurement is recreated.
 */
export function materializeCoffeeMachineCm01V3R12RequirementCloseout(
  base: ThreadSnapshot,
  appliedAt: string,
): ThreadSnapshot {
  if (base.subject.id !== CM01_V3_SUBJECT_ID) {
    throw new Error("CM-01 R12 closeout requires the CM-01 V3 thread subject.");
  }
  if (base.revision === 12) {
    assertR12RequirementFamilyCloseout(base);
    return base;
  }
  if (
    base.revision !== 11 || !base.id.includes(":r11:") ||
    !base.id.includes("mechanical-r3-")
  ) {
    throw new Error("CM-01 requirement closeout requires the exact R11 R3 head.");
  }
  const links = deriveCoffeeMachineCm01V3R12RequirementFamilyLinks(base);
  return applyThreadSnapshotExtension(base, {
    id: CM01_V3_R12_REQUIREMENT_CLOSEOUT_EXTENSION_ID,
    name: "Close the R1 to R3 CM-01 requirement family",
    subjectId: base.subject.id,
    capturedAt: appliedAt,
    artifacts: [],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    proposedActions: [],
    provenance: links,
  }, { appliedAt });
}

/** Verify that the R1/R2/R3 requirement family is explicitly closed at R12. */
export function assertR12RequirementFamilyCloseout(snapshot: ThreadSnapshot): void {
  if (
    snapshot.subject.id !== CM01_V3_SUBJECT_ID || snapshot.revision !== 12 ||
    !snapshot.id.includes(":r12:") ||
    !snapshot.id.includes(CM01_V3_R12_REQUIREMENT_CLOSEOUT_EXTENSION_ID)
  ) {
    throw new Error(
      "CM-01 requirement-family closeout must be the exact R12 snapshot.",
    );
  }
  const links = deriveCoffeeMachineCm01V3R12RequirementFamilyLinks(snapshot);
  for (const link of links) {
    if (!snapshot.provenance.some((candidate) => candidate.id === link.id)) {
      throw new Error(`CM-01 R12 is missing requirement supersession ${link.id}.`);
    }
  }
}

/**
 * Inspect the exact R11 correction boundary without calling a provider.
 *
 * The correction is closed only by a completed R3 successor.  R2 remains a
 * failed attempt with no evidence, rather than being silently renamed or
 * treated as successful merely because a later run passed.
 */
export function inspectCoffeeMachineCm01V3R11Closeout(
  project: EngineeringProjectSnapshot,
): CoffeeMachineCm01V3R11Closeout {
  if (
    project.project.id !== CM01_V3_PROJECT_ID ||
    project.project.subjectId !== CM01_V3_SUBJECT_ID
  ) {
    throw new Error("CM-01 R11 closeout requires the canonical CM-01 V3 project.");
  }
  const r11 = project.threadSnapshots.find((snapshot) =>
    snapshot.revision === 11 && snapshot.subjectId === CM01_V3_SUBJECT_ID &&
    snapshot.snapshotId.includes(":r11:") &&
    snapshot.snapshotId.includes("mechanical-r3-")
  );
  if (
    !r11
  ) {
    throw new Error(
      "CM-01 R11 closeout requires the exact current R11 mechanical-r3 ThreadSnapshot.",
    );
  }
  const failedWork = requiredWork(project, CM01_V3_FAILED_R2_WORK_ITEM_ID);
  const failedRun = requiredRun(project, CM01_V3_FAILED_R2_RUN_ID);
  if (
    failedRun.workItemId !== failedWork.id || failedRun.status !== "failed" ||
    failedRun.failure?.code !== "cm01-r2-mechanical-not-published" ||
    failedRun.evidenceRefs.length !== 0
  ) {
    throw new Error(
      "CM-01 R11 closeout requires the retained evidence-free R2 mechanical failure.",
    );
  }
  const successorWork = requiredWork(project, CM01_V3_R3_RECOVERY_WORK_ITEM_ID);
  const successorRun = requiredRun(project, CM01_V3_R3_RECOVERY_RUN_ID);
  if (
    successorWork.status !== "completed" ||
    successorRun.workItemId !== successorWork.id ||
    successorRun.status !== "completed" || !successorRun.resultSnapshot ||
    !sameSnapshot(successorRun.resultSnapshot, r11) ||
    !sameEvidenceSet(successorWork.evidenceRefs, successorRun.evidenceRefs) ||
    successorRun.evidenceRefs.length !== 1 ||
    !R11_SOLVE_ID.test(successorRun.evidenceRefs[0]!.id)
  ) {
    throw new Error(
      "CM-01 R11 closeout requires the completed R3 recovery and its exact R11 solve evidence.",
    );
  }
  const evidence = successorRun.evidenceRefs;
  if (failedWork.status === "cancelled") {
    const reconciliation = failedWork.reconciliation;
    if (
      !reconciliation ||
      reconciliation.kind !== "superseded-by-successor" ||
      reconciliation.failedRunId !== failedRun.id ||
      reconciliation.successorRunId !== successorRun.id ||
      !sameSnapshot(reconciliation.successorRunSnapshot, r11) ||
      reconciliation.successorSnapshot.revision !== 12 ||
      reconciliation.successorSnapshot.subjectId !== CM01_V3_SUBJECT_ID ||
      !reconciliation.successorSnapshot.snapshotId.includes(":r12:") ||
      !sameEvidenceSet(reconciliation.successorEvidenceRefs, evidence)
    ) {
      throw new Error(
        "CM-01 R11 closed work must retain its exact R2 failure and R3 successor reconciliation.",
      );
    }
    return {
      status: "closed",
      failedWorkItemId: CM01_V3_FAILED_R2_WORK_ITEM_ID,
      successorRunId: CM01_V3_R3_RECOVERY_RUN_ID,
      successorRunSnapshot: r11,
      successorSnapshot: reconciliation.successorSnapshot,
      successorEvidenceRefs: evidence,
    };
  }
  if (failedWork.status !== "ready" || failedWork.evidenceRefs.length !== 0) {
    throw new Error(
      "CM-01 R11 failed R2 work must be ready without evidence before explicit closeout.",
    );
  }
  return {
    status: "ready-to-close",
    failedWorkItemId: CM01_V3_FAILED_R2_WORK_ITEM_ID,
    failedRunId: CM01_V3_FAILED_R2_RUN_ID,
    successorRunId: CM01_V3_R3_RECOVERY_RUN_ID,
    successorRunSnapshot: r11,
    successorEvidenceRefs: evidence,
  };
}

function requiredWork(project: EngineeringProjectSnapshot, id: string) {
  const work = project.workItems.find((item) => item.id === id);
  if (!work) throw new Error(`CM-01 R11 closeout is missing work item ${id}.`);
  return work;
}

function requiredRun(project: EngineeringProjectSnapshot, id: string) {
  const run = project.agentRuns.find((item) => item.id === id);
  if (!run) throw new Error(`CM-01 R11 closeout is missing agent run ${id}.`);
  return run;
}

function sameSnapshot(
  left: EngineeringThreadSnapshotRef,
  right: EngineeringThreadSnapshotRef,
): boolean {
  return left.snapshotId === right.snapshotId &&
    left.revision === right.revision &&
    left.subjectId === right.subjectId;
}

function sameEvidenceSet(
  left: readonly EngineeringThreadEntityRef[],
  right: readonly EngineeringThreadEntityRef[],
): boolean {
  return left.length === right.length &&
    left.every((reference) =>
      right.some((candidate) =>
        reference.snapshotId === candidate.snapshotId &&
        reference.snapshotRevision === candidate.snapshotRevision &&
        reference.kind === candidate.kind && reference.id === candidate.id
      )
    );
}

/**
 * Derive only the missing R3 -> R1 links after proving the full R1 -> R2 ->
 * R3 family. Requirement IDs are deliberately not parsed: the proof is the
 * structured criterion, evaluation freshness, and explicit artifact plus
 * requirement supersession lineage.
 */
export function deriveCoffeeMachineCm01V3R12RequirementFamilyLinks(
  snapshot: ThreadSnapshot,
): ThreadProvenanceLink[] {
  const historical = snapshot.requirements.filter((requirement) => {
    const evaluation = evaluationFor(snapshot, requirement.id);
    return evaluation.freshness.status === "stale" &&
      evaluation.freshness.invalidatedByChangeIds.includes(CORRECTION_CHANGE_ID);
  });
  if (historical.length !== 2) {
    throw new Error(
      "CM-01 R12 closeout requires exactly two stale evaluations caused by the named correction.",
    );
  }
  return [...historical].sort((left, right) =>
    metricKey(left).localeCompare(metricKey(right))
  ).map((prior) => {
    const metric = metricKey(prior);
    const candidates = snapshot.requirements.filter((requirement) => {
      if (!sameCriterion(requirement, prior)) return false;
      const evaluation = evaluationFor(snapshot, requirement.id);
      return evaluation.freshness.status === "fresh" && evaluation.status === "pass" &&
        hasSupersessionLineage(snapshot, requirement, prior) &&
        isTerminalRequirementCandidate(snapshot, requirement, prior);
    });
    if (candidates.length !== 1) {
      throw new Error(
        `CM-01 R12 closeout requires one terminal fresh passing successor for ${metric}.`,
      );
    }
    const current = candidates[0]!;
    const historicalEvaluation = evaluationFor(snapshot, prior.id);
    const currentEvaluation = evaluationFor(snapshot, current.id);
    if (
      historicalEvaluation.freshness.status !== "stale" ||
      !historicalEvaluation.freshness.invalidatedByChangeIds.includes(
        CORRECTION_CHANGE_ID,
      ) ||
      currentEvaluation.freshness.status !== "fresh" ||
      currentEvaluation.status !== "pass"
    ) {
      throw new Error(
        `CM-01 R12 closeout requires stale R1 and fresh passing R3 evaluation for ${metric}.`,
      );
    }
    return {
      id: `${current.id}:supersedes:${prior.id}`,
      relation: "supersedes",
      from: { kind: "requirement", id: current.id },
      to: { kind: "requirement", id: prior.id },
      rationale:
        "The fresh R3 criterion and passing evaluation close the stale R1 criterion after the explicit 28 mm to 30 mm correction.",
    };
  });
}

function metricKey(requirement: TracedRequirement): string {
  return requirement.criterion.metric;
}

function sameCriterion(
  left: TracedRequirement,
  right: TracedRequirement,
): boolean {
  return left.criterion.metric === right.criterion.metric &&
    left.criterion.operator === right.criterion.operator &&
    left.criterion.limit.value === right.criterion.limit.value &&
    left.criterion.limit.unit === right.criterion.limit.unit;
}

function evaluationFor(
  snapshot: ThreadSnapshot,
  requirementId: string,
): RequirementEvaluation {
  const evaluations = snapshot.evaluations.filter((evaluation) =>
    evaluation.requirementId === requirementId
  );
  if (evaluations.length !== 1) {
    throw new Error(
      `CM-01 R12 closeout requires exactly one evaluation for ${requirementId}.`,
    );
  }
  return evaluations[0]!;
}

function hasSupersessionLineage(
  snapshot: ThreadSnapshot,
  current: TracedRequirement,
  historical: TracedRequirement,
): boolean {
  return current.trace.targetArtifactIds.some((currentArtifact) =>
    historical.trace.targetArtifactIds.some((historicalArtifact) =>
      artifactSupersedes(snapshot, currentArtifact, historicalArtifact)
    )
  );
}

function isTerminalRequirementCandidate(
  snapshot: ThreadSnapshot,
  requirement: TracedRequirement,
  historical: TracedRequirement,
): boolean {
  const targetIds = new Set(requirement.trace.targetArtifactIds);
  const supersededByAnotherArtifact = snapshot.provenance.some((link) =>
    link.relation === "supersedes" && link.from.kind === "artifact" &&
    link.to.kind === "artifact" && targetIds.has(link.to.id)
  );
  if (supersededByAnotherArtifact) return false;
  return snapshot.provenance.some((link) => {
    if (
      link.relation !== "supersedes" || link.from.kind !== "requirement" ||
      link.to.kind !== "requirement" || link.from.id !== requirement.id
    ) return false;
    const intermediate = snapshot.requirements.find((candidate) =>
      candidate.id === link.to.id
    );
    if (!intermediate || !sameCriterion(intermediate, historical)) return false;
    const evaluation = evaluationFor(snapshot, intermediate.id);
    return evaluation.freshness.status === "fresh" && evaluation.status === "pass" &&
      intermediate.trace.targetArtifactIds.some((intermediateArtifact) =>
        historical.trace.targetArtifactIds.some((historicalArtifact) =>
          artifactDirectlySupersedes(
            snapshot,
            intermediateArtifact,
            historicalArtifact,
          )
        )
      );
  });
}

function artifactDirectlySupersedes(
  snapshot: ThreadSnapshot,
  currentArtifactId: string,
  historicalArtifactId: string,
): boolean {
  return snapshot.provenance.some((link) =>
    link.relation === "supersedes" && link.from.kind === "artifact" &&
    link.to.kind === "artifact" && link.from.id === currentArtifactId &&
    link.to.id === historicalArtifactId
  );
}

function artifactSupersedes(
  snapshot: ThreadSnapshot,
  currentArtifactId: string,
  historicalArtifactId: string,
): boolean {
  const frontier = [currentArtifactId];
  const seen = new Set<string>();
  while (frontier.length > 0) {
    const current = frontier.pop()!;
    if (current === historicalArtifactId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const link of snapshot.provenance) {
      if (
        link.relation === "supersedes" && link.from.kind === "artifact" &&
        link.to.kind === "artifact" && link.from.id === current
      ) frontier.push(link.to.id);
    }
  }
  return false;
}
