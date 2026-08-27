/**
 * Lifecycle recovery for `project_fea_isolated_run_review`.
 *
 * When the compiled root isolated-run identities already exist, a successor
 * revision is derived only from the unique current leaf of that exact activity
 * after one evidence-free `isolated_output_validation_failed` attempt. This is
 * not a second attempt of the failed work item, and it does not change
 * provider, runtime, solver, image, arguments, or lowering.
 */

import {
  attemptIdsForRevision,
  engineeringActivityIdFromRootRevision,
  leafRevisionIdsForActivity,
} from "../../../../domain/project/engineering-activity.ts";
import type {
  EngineeringAgentRun,
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../../../domain/project/engineering-project.ts";
import { deterministicJson } from "../../../../domain/kernel/deterministic-json.ts";
import type { IsolatedCalculixBindingDiagnostic } from "../../../../domain/fea/isolated-v3/isolated-calculix-bindings.ts";
import { TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES } from "../../../../domain/record/reconcile-uncertain-writer-proposal.ts";

export const ISOLATED_FEA_OUTPUT_VALIDATION_FAILED_CODE =
  "isolated_output_validation_failed" as const;

export function isolatedFeaRunWorkItemId(
  proofDigest: string,
  revision: number,
  generation = 1,
): string {
  return isolatedFeaRunIdentity("work", proofDigest, revision, generation);
}

export function isolatedFeaRunDecisionId(
  proofDigest: string,
  revision: number,
  generation = 1,
): string {
  return isolatedFeaRunIdentity("decision", proofDigest, revision, generation);
}

export type FeaIsolatedRunSuccessorResolution =
  | {
    readonly status: "ready";
    readonly workItemId: string;
    readonly decisionId: string;
    readonly phaseId: string;
    readonly predecessorWorkItemId: string;
    readonly failedRunId: string;
    readonly dependsOnWorkItemIds: readonly string[];
  }
  | {
    readonly status: "unresolved";
    readonly diagnostic: IsolatedCalculixBindingDiagnostic;
  };

export function resolveFeaIsolatedRunSuccessor(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly rootWorkItemId: string;
  readonly proofDigest: string;
  readonly threadRevision: number;
  readonly operation: EngineeringOperationRef;
}): FeaIsolatedRunSuccessorResolution {
  const root = input.project.workItems.find((item) => item.id === input.rootWorkItemId);
  const expectedActivityId = engineeringActivityIdFromRootRevision(
    input.rootWorkItemId,
  );
  if (
    !root ||
    root.activityId !== expectedActivityId ||
    root.predecessorRevisionId !== undefined
  ) {
    return successorRefusal(
      "activity-foreign",
      `Compiled isolated-run root ${input.rootWorkItemId} is not the root revision of its expected activity ${expectedActivityId}. The review will not append onto a foreign activity.`,
    );
  }

  const members = input.project.workItems.filter((item) =>
    item.activityId === expectedActivityId
  );
  const leafIds = leafRevisionIdsForActivity(members);
  if (leafIds.length !== 1) {
    return successorRefusal(
      "activity-leaf-ambiguous",
      `Stable isolated-run activity ${expectedActivityId} has ${leafIds.length} current leaves (${
        leafIds.join(", ") || "none"
      }). A successor requires exactly one leaf; forks are refused.`,
    );
  }
  const leaf = members.find((item) => item.id === leafIds[0]);
  if (!leaf) {
    return successorRefusal(
      "activity-leaf-ambiguous",
      `Stable isolated-run activity ${expectedActivityId} has no resolvable current leaf.`,
    );
  }

  const leafRefusal = diagnoseQualifyingFailedLeaf(
    input.project,
    leaf,
    input.operation,
  );
  if (leafRefusal) return leafRefusal;

  const attemptIds = attemptIdsForRevision(input.project.agentRuns, leaf.id);
  const run = input.project.agentRuns.find((item) => item.id === attemptIds[0]);
  if (!run) {
    return successorRefusal(
      "activity-attempt-missing",
      `Isolated-run leaf ${leaf.id} has no agent run. A successor requires exactly one evidence-free isolated_output_validation_failed attempt.`,
    );
  }

  const generation = members.length + 1;
  return {
    status: "ready",
    workItemId: isolatedFeaRunWorkItemId(
      input.proofDigest,
      input.threadRevision,
      generation,
    ),
    decisionId: isolatedFeaRunDecisionId(
      input.proofDigest,
      input.threadRevision,
      generation,
    ),
    phaseId: leaf.phaseId,
    predecessorWorkItemId: leaf.id,
    failedRunId: run.id,
    dependsOnWorkItemIds: [...leaf.dependsOnWorkItemIds],
  };
}

export function isolatedFeaSuccessorProposal(input: {
  readonly proofArtifactId: string;
  readonly stepArtifactId: string;
  readonly predecessorWorkItemId: string;
  readonly failedRunId: string;
}): {
  readonly summary: string;
  readonly parameters: readonly {
    readonly key: string;
    readonly label: string;
    readonly value: string;
  }[];
} {
  return {
    summary:
      `Queue verify.run-fea-static-proof@3 as a successor of ${input.predecessorWorkItemId} ` +
      `after evidence-free isolated_output_validation_failed run ${input.failedRunId} ` +
      `on sealed proof ${input.proofArtifactId} and canonical part STEP ${input.stepArtifactId}. ` +
      "Do not bind a cad-model. The failed work item and run remain immutable.",
    parameters: [
      {
        key: "review.predecessorWorkItemId",
        label: "Failed predecessor work item (immutable leaf)",
        value: input.predecessorWorkItemId,
      },
      {
        key: "review.failedRunId",
        label: "Evidence-free isolated output-validation failure",
        value: input.failedRunId,
      },
    ],
  };
}

function diagnoseQualifyingFailedLeaf(
  project: EngineeringProjectSnapshot,
  leaf: EngineeringWorkItem,
  expectedOperation: EngineeringOperationRef,
): FeaIsolatedRunSuccessorResolution | undefined {
  if (leaf.status !== "ready") {
    return successorRefusal(
      "activity-leaf-not-ready",
      `Isolated-run leaf ${leaf.id} has status ${leaf.status}. A successor requires a ready, unreconciled, evidence-free leaf.`,
    );
  }
  if (leaf.owner !== "agent") {
    return successorRefusal(
      "activity-leaf-not-agent-owned",
      `Isolated-run leaf ${leaf.id} is owned by ${leaf.owner}, not agent. The review will not append a successor.`,
    );
  }
  if (leaf.evidenceRefs.length !== 0) {
    return successorRefusal(
      "activity-leaf-has-evidence",
      `Isolated-run leaf ${leaf.id} already names evidence and cannot authorize an evidence-free successor.`,
    );
  }
  if (leaf.reconciliation !== undefined) {
    return successorRefusal(
      "activity-leaf-reconciled",
      `Isolated-run leaf ${leaf.id} is already reconciled. The failed revision stays immutable.`,
    );
  }

  const attemptIds = attemptIdsForRevision(project.agentRuns, leaf.id);
  if (attemptIds.length === 0) {
    return successorRefusal(
      "activity-attempt-missing",
      `Isolated-run leaf ${leaf.id} has no agent run. A successor requires exactly one evidence-free isolated_output_validation_failed attempt.`,
    );
  }
  if (attemptIds.length !== 1) {
    return successorRefusal(
      "activity-attempt-ambiguous",
      `Isolated-run leaf ${leaf.id} has ${attemptIds.length} agent runs (${
        attemptIds.join(", ")
      }). A successor requires exactly one attempt; the failed run is not retried.`,
    );
  }

  const run = project.agentRuns.find((item) => item.id === attemptIds[0]);
  if (!run) {
    return successorRefusal(
      "activity-attempt-missing",
      `Isolated-run leaf ${leaf.id} names attempt ${
        attemptIds[0]
      }, but that run is absent.`,
    );
  }
  const runRefusal = diagnoseQualifyingFailedRun(leaf, run);
  if (runRefusal) return runRefusal;

  if (!sameIsolatedRunOperation(leaf.operation, expectedOperation)) {
    return successorRefusal(
      "activity-operation-mismatch",
      `Isolated-run leaf ${leaf.id} does not carry the exact verify.run-fea-static-proof@3 operation and bindings compiled from the current Thread proof and STEP.`,
    );
  }
  return undefined;
}

function diagnoseQualifyingFailedRun(
  leaf: EngineeringWorkItem,
  run: EngineeringAgentRun,
): FeaIsolatedRunSuccessorResolution | undefined {
  if (run.status !== "failed") {
    return successorRefusal(
      "activity-run-not-failed",
      `Run ${run.id} on isolated-run leaf ${leaf.id} has status ${run.status}. A successor requires a terminal failed evidence-free attempt.`,
    );
  }
  if (
    run.uncertainWriterReconciliation !== undefined ||
    TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES.has(run.failure?.code ?? "")
  ) {
    return successorRefusal(
      "activity-run-uncertain",
      `Run ${run.id} on isolated-run leaf ${leaf.id} is an uncertain writer failure (${
        run.failure?.code ?? "absent"
      }). Uncertain failures cannot authorize an isolated-run successor.`,
    );
  }
  if (run.failure?.code !== ISOLATED_FEA_OUTPUT_VALIDATION_FAILED_CODE) {
    return successorRefusal(
      "activity-failure-code-mismatch",
      `Run ${run.id} on isolated-run leaf ${leaf.id} failed with ${
        run.failure?.code ?? "absent"
      }, not isolated_output_validation_failed.`,
    );
  }
  if (run.resultSnapshot !== undefined || run.evidenceRefs.length !== 0) {
    return successorRefusal(
      "activity-run-has-result",
      `Run ${run.id} on isolated-run leaf ${leaf.id} already names a result snapshot or evidence refs. Only an evidence-free isolated_output_validation_failed attempt can authorize a successor.`,
    );
  }
  return undefined;
}

function sameIsolatedRunOperation(
  actual: EngineeringOperationRef | undefined,
  expected: EngineeringOperationRef,
): boolean {
  return actual?.id === expected.id &&
    actual.version === expected.version &&
    deterministicJson(actual.bindings) === deterministicJson(expected.bindings);
}

function isolatedFeaRunIdentity(
  kind: "work" | "decision",
  proofDigest: string,
  revision: number,
  generation: number,
): string {
  const base = `${kind}-fea-isolated-${proofDigest.slice(0, 16)}-r${revision}`;
  return generation === 1 ? base : `${base}-${generation}`;
}

function successorRefusal(
  code: IsolatedCalculixBindingDiagnostic["code"],
  message: string,
): FeaIsolatedRunSuccessorResolution {
  return {
    status: "unresolved",
    diagnostic: { code, artifactId: null, artifactKind: null, message },
  };
}
