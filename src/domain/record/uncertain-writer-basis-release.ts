import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../kernel/deterministic-json.ts";
import type {
  EngineeringAgentRun,
  EngineeringDecisionProposalParameter,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../project/engineering-project.ts";

const DECISION_PREFIX = "decision:uncertain-write-release:";
const BLOCKER_PREFIX = "blocker:uncertain-write-accepted:";

export const UNCERTAIN_WRITER_BASIS_RELEASE_ACTION =
  "release-thread-write-basis" as const;
export const UNCERTAIN_WRITER_BASIS_RELEASE_OUTCOME =
  "approved-after-provider-state-review" as const;

export interface UncertainWriterBasisReleaseProposal {
  readonly releaseAction: typeof UNCERTAIN_WRITER_BASIS_RELEASE_ACTION;
  readonly releaseOutcome: typeof UNCERTAIN_WRITER_BASIS_RELEASE_OUTCOME;
  readonly failedRunId: string;
  readonly failureCode: string;
  readonly subjectId: string;
  readonly snapshotId: string;
  readonly revision: number;
  readonly blockerId: string;
  readonly reconciliationDecisionId: string;
  readonly reconciliationOutcome: "write-effect-accepted";
  /** Agent-proposed review statement; it becomes authoritative only by human approval. */
  readonly releaseAttestation: string;
}

const RELEASE_KEYS = [
  "releaseAction",
  "releaseOutcome",
  "failedRunId",
  "failureCode",
  "subjectId",
  "snapshotId",
  "revision",
  "blockerId",
  "reconciliationDecisionId",
  "reconciliationOutcome",
  "releaseAttestation",
] as const;

export function uncertainWriterBasisReleaseIds(failedRunId: string) {
  return {
    blockerId: `${BLOCKER_PREFIX}${failedRunId}`,
    decisionId: `${DECISION_PREFIX}${failedRunId}`,
  } as const;
}

export function uncertainWriterBasisReleaseText(failedRunId: string) {
  return {
    blockerTitle: "Uncertain provider write accepted — review before re-run",
    blockerDescription:
      `Run ${failedRunId} was reconciled with outcome "write-effect-accepted": ` +
      "the provider may have produced output that was not captured in the thread.  " +
      "Approve the linked basis-release decision before any new writer uses the " +
      "same ThreadSnapshot basis.",
    decisionTitle: "Release the uncertain Thread write basis",
    decisionQuestion:
      `After reviewing the accepted uncertain provider write from run ${failedRunId}, ` +
      "should this exact ThreadSnapshot basis be released for a new writer?",
  } as const;
}

export function isUncertainWriterBasisReleaseDecision(
  _project: EngineeringProjectSnapshot,
  decisionId: string,
): boolean {
  return isReservedUncertainWriterBasisReleaseDecisionId(decisionId);
}

/** Reserved namespace: only reconcileAnnotationRun may mint these decisions. */
export function isReservedUncertainWriterBasisReleaseDecisionId(
  decisionId: string,
): boolean {
  return decisionId.startsWith(DECISION_PREFIX);
}

/** Server-derived failed basis used to seal the dedicated release decision. */
export function uncertainWriterBasisReleaseBaseSnapshot(
  project: EngineeringProjectSnapshot,
  decisionId: string,
) {
  const { basis } = requireReleaseContext(project, decisionId);
  return {
    snapshotId: basis.snapshotId,
    revision: basis.revision,
    subjectId: basis.subjectId,
  } as const;
}

/** Parse the release proposal without losing duplicates, extra keys or value types. */
export function parseUncertainWriterBasisReleaseProposal(
  parameters: readonly EngineeringDecisionProposalParameter[],
): UncertainWriterBasisReleaseProposal {
  const values = new Map<string, string | number | boolean>();
  for (const parameter of parameters) {
    if (!RELEASE_KEYS.includes(parameter.key as typeof RELEASE_KEYS[number])) {
      throw new Error(`Unknown basis-release parameter "${parameter.key}".`);
    }
    if (values.has(parameter.key)) {
      throw new Error(`Basis-release parameter "${parameter.key}" is duplicated.`);
    }
    if (parameter.unit !== undefined) {
      throw new Error(`Basis-release parameter "${parameter.key}" cannot have a unit.`);
    }
    values.set(parameter.key, parameter.value);
  }
  for (const key of RELEASE_KEYS) {
    if (!values.has(key)) throw new Error(`Missing basis-release parameter "${key}".`);
  }

  const stringValue = (key: typeof RELEASE_KEYS[number]): string => {
    const value = values.get(key);
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Basis-release parameter "${key}" must be a non-empty string.`);
    }
    return value;
  };
  const releaseAction = stringValue("releaseAction");
  if (releaseAction !== UNCERTAIN_WRITER_BASIS_RELEASE_ACTION) {
    throw new Error(
      `releaseAction must be "${UNCERTAIN_WRITER_BASIS_RELEASE_ACTION}".`,
    );
  }
  const releaseOutcome = stringValue("releaseOutcome");
  if (releaseOutcome !== UNCERTAIN_WRITER_BASIS_RELEASE_OUTCOME) {
    throw new Error(
      `releaseOutcome must be "${UNCERTAIN_WRITER_BASIS_RELEASE_OUTCOME}".`,
    );
  }
  const reconciliationOutcome = stringValue("reconciliationOutcome");
  if (reconciliationOutcome !== "write-effect-accepted") {
    throw new Error('reconciliationOutcome must be "write-effect-accepted".');
  }
  const revision = values.get("revision");
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) {
    throw new Error(
      'Basis-release parameter "revision" must be a non-negative integer.',
    );
  }
  return {
    releaseAction,
    releaseOutcome,
    failedRunId: stringValue("failedRunId"),
    failureCode: stringValue("failureCode"),
    subjectId: stringValue("subjectId"),
    snapshotId: stringValue("snapshotId"),
    revision,
    blockerId: stringValue("blockerId"),
    reconciliationDecisionId: stringValue("reconciliationDecisionId"),
    reconciliationOutcome,
    releaseAttestation: stringValue("releaseAttestation"),
  };
}

/** Validate a proposal for the exact server-created decision and persisted basis. */
export function assertUncertainWriterBasisReleaseProposal(
  project: EngineeringProjectSnapshot,
  decisionId: string,
  parameters: readonly EngineeringDecisionProposalParameter[],
): void {
  const context = requireReleaseContext(project, decisionId);
  const proposal = parseUncertainWriterBasisReleaseProposal(parameters);
  const expected: Omit<UncertainWriterBasisReleaseProposal, "releaseAttestation"> = {
    releaseAction: UNCERTAIN_WRITER_BASIS_RELEASE_ACTION,
    releaseOutcome: UNCERTAIN_WRITER_BASIS_RELEASE_OUTCOME,
    failedRunId: context.failedRun.id,
    failureCode: context.failedRun.failure!.code,
    subjectId: context.basis.subjectId,
    snapshotId: context.basis.snapshotId,
    revision: context.basis.revision,
    blockerId: context.blocker.id,
    reconciliationDecisionId:
      context.failedRun.uncertainWriterReconciliation!.decisionId,
    reconciliationOutcome: "write-effect-accepted",
  };
  for (const [key, value] of Object.entries(expected)) {
    if (proposal[key as keyof typeof expected] !== value) {
      throw new Error(
        `Basis-release parameter "${key}" must equal the exact persisted value "${value}".`,
      );
    }
  }
}

/** Recompute the command-service proposal fingerprint before human elicitation. */
export async function assertUncertainWriterBasisReleaseDecisionSeal(
  project: EngineeringProjectSnapshot,
  decisionId: string,
): Promise<void> {
  const context = requireReleaseContext(project, decisionId);
  const decision = context.decision;
  if (!decision.proposal || !decision.inputFingerprint) {
    throw new Error("The canonical basis-release decision has no sealed proposal.");
  }
  if (!sameBasis(decision.baseSnapshot, context.basis)) {
    throw new Error(
      "The basis-release decision is not anchored to the exact failed basis.",
    );
  }
  assertUncertainWriterBasisReleaseProposal(
    project,
    decision.id,
    decision.proposal.parameters,
  );
  const expectedFingerprint = await sha256Fingerprint({
    baseSnapshot: decision.baseSnapshot,
    inputEvidenceRefs: decision.inputEvidenceRefs,
    proposal: {
      summary: decision.proposal.summary,
      parameters: decision.proposal.parameters,
    },
  });
  if (!fingerprintsEqual(expectedFingerprint, decision.inputFingerprint)) {
    throw new Error("The basis-release fingerprint does not seal its exact proposal.");
  }
}

/**
 * Require the entire human ceremony before an accepted uncertain write releases
 * its basis.  Missing legacy fields, homonymous blockers and merely-resolved
 * blockers all fail closed.
 */
export async function assertApprovedUncertainWriterBasisRelease(
  project: EngineeringProjectSnapshot,
  failedRun: EngineeringAgentRun,
): Promise<void> {
  const { decisionId } = uncertainWriterBasisReleaseIds(failedRun.id);
  const context = requireReleaseContext(project, decisionId);
  const decision = context.decision;
  if (context.blocker.status !== "resolved" || decision.status !== "approved") {
    throw new Error(
      "The canonical basis-release blocker and decision are not resolved.",
    );
  }
  if (
    !context.blocker.resolvedAt ||
    context.blocker.resolution !==
      `Resolved by approved decision: ${decision.id}.`
  ) {
    throw new Error(
      "The canonical basis-release blocker has no exact resolution audit.",
    );
  }
  await assertUncertainWriterBasisReleaseDecisionSeal(project, decision.id);
  const approvals = project.approvals.filter((approval) =>
    approval.decisionId === decision.id && approval.status === "approved" &&
    approval.decidedByOrigin === "human" &&
    decision.approvalIds.includes(approval.id) &&
    sameBasis(approval.baseSnapshot, context.basis) &&
    fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint) &&
    deterministicJson(approval.inputEvidenceRefs) ===
      deterministicJson(decision.inputEvidenceRefs)
  );
  if (approvals.length !== 1) {
    throw new Error(
      `The basis release requires exactly one matching human approval; found ${approvals.length}.`,
    );
  }
}

function requireReleaseContext(
  project: EngineeringProjectSnapshot,
  decisionId: string,
) {
  const failedRunId = decisionId.startsWith(DECISION_PREFIX)
    ? decisionId.slice(DECISION_PREFIX.length)
    : "";
  const failedRun = project.agentRuns.find((run) => run.id === failedRunId);
  if (
    !failedRun || failedRun.status !== "failed" || !failedRun.failure ||
    failedRun.basis?.kind !== "thread-snapshot" ||
    failedRun.uncertainWriterReconciliation?.outcome !== "write-effect-accepted"
  ) {
    throw new Error(
      "The basis-release decision does not name one accepted failed writer.",
    );
  }
  const basis = failedRun.basis;
  const ids = uncertainWriterBasisReleaseIds(failedRun.id);
  const text = uncertainWriterBasisReleaseText(failedRun.id);
  const decision = project.decisions.find((item) => item.id === decisionId);
  const failedWorkItem = project.workItems.find((item) =>
    item.id === failedRun.workItemId
  );
  const blocker = project.blockers.find((item) => item.id === ids.blockerId);
  const phase = failedWorkItem
    ? project.phases.find((item) => item.id === failedWorkItem.phaseId)
    : undefined;
  if (
    !decision || !failedWorkItem || !blocker || !phase ||
    decision.id !== ids.decisionId || decision.phaseId !== failedWorkItem.phaseId ||
    decision.title !== text.decisionTitle ||
    decision.question !== text.decisionQuestion ||
    decision.inputEvidenceRefs.length !== 0 ||
    blocker.phaseId !== failedWorkItem.phaseId ||
    blocker.title !== text.blockerTitle ||
    blocker.description !== text.blockerDescription ||
    blocker.kind !== "tool-failure" ||
    blocker.workItemIds.length !== 1 || blocker.workItemIds[0] !== failedWorkItem.id ||
    blocker.decisionIds.length !== 1 || blocker.decisionIds[0] !== decision.id ||
    !failedWorkItem.blockerIds.includes(blocker.id) ||
    failedWorkItem.decisionIds.includes(decision.id) ||
    !phase.workItemIds.includes(failedWorkItem.id) ||
    !phase.requiredDecisionIds.includes(decision.id)
  ) {
    throw new Error(
      "The basis-release blocker and decision are not canonical and reciprocal.",
    );
  }
  return { failedRun, basis, failedWorkItem, blocker, decision };
}

function sameBasis(
  value: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  } | undefined,
  basis: EngineeringThreadSnapshotBasis,
): boolean {
  return value?.snapshotId === basis.snapshotId && value.revision === basis.revision &&
    value.subjectId === basis.subjectId;
}
