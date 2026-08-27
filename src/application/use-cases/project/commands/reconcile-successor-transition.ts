import type { EngineeringProjectSnapshot } from "../../../../domain/project/engineering-project.ts";
import { deterministicJson } from "../../../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectCommandOrigin } from "../../../ports/in/engineering-project-command-origin.ts";
import type {
  EngineeringProjectReconciliationOperationPolicy,
  EngineeringProjectReconciliationSnapshotValidator,
  ReconcileWorkItemWithSuccessorCommand,
} from "./engineering-project-commands.ts";
import {
  actor,
  addThreadSnapshot,
  assertDeclaredSnapshot,
  findRun,
  findWorkItem,
  invalidInput,
  invalidTransition,
  type Mutable,
  nonEmpty,
  notFound,
  recomputeWorkReadiness,
  sameEvidenceReferences,
  sameSnapshotReference,
} from "./engineering-project-transition-values.ts";

export async function applyReconcileWorkItemWithSuccessor(
  draft: Mutable<EngineeringProjectSnapshot>,
  appliedAt: string,
  origin: EngineeringProjectCommandOrigin,
  command: ReconcileWorkItemWithSuccessorCommand,
  reconciliationSnapshotValidator:
    | EngineeringProjectReconciliationSnapshotValidator
    | undefined,
  reconciliationOperationPolicy:
    | EngineeringProjectReconciliationOperationPolicy
    | undefined,
): Promise<void> {
  nonEmpty(command.failedWorkItemId, "failedWorkItemId");
  nonEmpty(command.failedRunId, "failedRunId");
  nonEmpty(command.successorRunId, "successorRunId");
  nonEmpty(command.rationale, "rationale");
  if (command.failedRunId === command.successorRunId) {
    invalidInput("A failed run cannot reconcile itself as its successor.");
  }
  assertDeclaredSnapshot(draft, command.successorRunSnapshot);
  if (command.successorSnapshot !== undefined) {
    // Full closeout path: a separate closeout snapshot was produced and
    // must immediately follow the successor result in the project lineage.
    if (
      command.successorSnapshot.subjectId !== draft.project.subjectId ||
      command.successorSnapshot.snapshotId.toLowerCase() === "latest" ||
      command.successorSnapshot.revision !==
        command.successorRunSnapshot.revision + 1 ||
      !sameSnapshotReference(
        draft.threadSnapshots.at(-1)!,
        command.successorRunSnapshot,
      )
    ) {
      invalidInput(
        "The closeout snapshot must directly follow the current completed successor snapshot.",
      );
    }
    if (!reconciliationSnapshotValidator) {
      invalidInput(
        "Successor reconciliation requires an exact persisted closeout snapshot validator.",
      );
    }
    await reconciliationSnapshotValidator.validate(
      command.successorRunSnapshot,
      command.successorSnapshot,
    );
  } else {
    // Direct reconciliation does not create a synthetic ThreadSnapshot.
    // The successor result may already be an immutable ancestor of the
    // current project head (e.g. a later independently published run).
    // Prove that topology through the injected persistence reader; a
    // familiar subject/revision is never accepted as a substitute.
    const currentHead = draft.threadSnapshots.at(-1)!;
    if (
      currentHead.subjectId !== command.successorRunSnapshot.subjectId ||
      currentHead.revision < command.successorRunSnapshot.revision
    ) {
      invalidInput(
        "Direct reconciliation requires the current project thread head to be at or after the successor run snapshot.",
      );
    }
    if (!reconciliationSnapshotValidator) {
      invalidInput(
        "Direct reconciliation requires an exact persisted thread-lineage validator.",
      );
    }
    await reconciliationSnapshotValidator.validateCurrentHeadDescendsFrom(
      currentHead,
      command.successorRunSnapshot,
    );
  }
  const failedWork = findWorkItem(draft, command.failedWorkItemId);
  if (!failedWork) notFound("work item", command.failedWorkItemId);
  if (failedWork.status !== "ready") {
    invalidTransition(
      `Work item ${failedWork.id} can reconcile only from ready after its failed attempt.`,
    );
  }
  if (failedWork.evidenceRefs.length !== 0) {
    invalidTransition(
      `Work item ${failedWork.id} already owns evidence and cannot be reconciled as failed work.`,
    );
  }
  const failedRun = findRun(draft, command.failedRunId);
  if (!failedRun) notFound("agent run", command.failedRunId);
  // Accept either an evidence-free failed run (explicit failure record) or
  // a run that was cancelled by a human before any agent claim — meaning no
  // provider was ever touched (no claimedAt, no startedAt). A queued run
  // must be cancelled first via human elicitation before reconciliation is
  // valid; reconciliation is not a substitute for cancellation.
  const isEvidenceFreeFailure = failedRun.status === "failed" &&
    !!failedRun.failure &&
    failedRun.evidenceRefs.length === 0;
  const isPreClaimCancellation = failedRun.status === "cancelled" &&
    !failedRun.claimedAt &&
    !failedRun.startedAt && failedRun.evidenceRefs.length === 0;
  if (
    failedRun.workItemId !== failedWork.id ||
    (!isEvidenceFreeFailure && !isPreClaimCancellation)
  ) {
    invalidTransition(
      `Run ${command.failedRunId} must be an evidence-free failed attempt or a pre-claim cancelled run for ${failedWork.id}.`,
    );
  }
  const successor = findRun(draft, command.successorRunId);
  if (!successor) notFound("agent run", command.successorRunId);
  if (
    successor.workItemId === failedWork.id || successor.status !== "completed" ||
    !successor.resultSnapshot || successor.evidenceRefs.length === 0
  ) {
    invalidTransition(
      `Run ${command.successorRunId} is not a completed successor with evidence.`,
    );
  }
  if (
    !sameSnapshotReference(
      successor.resultSnapshot,
      command.successorRunSnapshot,
    ) ||
    !sameEvidenceReferences(
      successor.evidenceRefs,
      command.successorEvidenceRefs,
    )
  ) {
    invalidInput(
      "The declared successor snapshot and evidence must exactly match the completed successor run.",
    );
  }
  const successorWork = findWorkItem(draft, successor.workItemId)!;
  if (successorWork.activityId !== failedWork.activityId) {
    invalidInput(
      `Successor work item ${successorWork.id} is not in the same stable activity as ${failedWork.id}.`,
    );
  }
  if (
    successorWork.status !== "completed" ||
    !sameEvidenceReferences(
      successorWork.evidenceRefs,
      successor.evidenceRefs,
    )
  ) {
    invalidTransition(
      `Completed successor run ${successor.id} has inconsistent work-item evidence.`,
    );
  }
  // Equivalent operations are always safe. A different operation is
  // forbidden on the direct recovery form and requires a code-owned,
  // injected proof on the full closeout form. The mere presence of a
  // direct-child snapshot proves topology, not semantic compatibility.
  if (failedWork.operation !== undefined) {
    const operationsMatch = successorWork.operation?.id === failedWork.operation.id &&
      successorWork.operation?.version === failedWork.operation.version &&
      deterministicJson(successorWork.operation.bindings) ===
        deterministicJson(failedWork.operation.bindings);
    if (!operationsMatch && command.successorSnapshot === undefined) {
      invalidInput(
        `Successor work item ${successorWork.id} does not carry the same operation ` +
          `(id, version, bindings) as the failed work item ${failedWork.id}. ` +
          `Use the exact registered operation the failed work was supposed to execute.`,
      );
    }
    if (!operationsMatch && command.successorSnapshot !== undefined) {
      if (!reconciliationOperationPolicy) {
        invalidInput(
          `Full closeout from operation ${failedWork.operation.id}@${failedWork.operation.version} ` +
            `to ${successorWork.operation?.id ?? "an undeclared operation"}@${
              successorWork.operation?.version ?? "unknown"
            } requires an injected operation-transition policy.`,
        );
      }
      await reconciliationOperationPolicy.authorize({
        failedWorkItemId: failedWork.id,
        failedOperation: structuredClone(failedWork.operation),
        successorWorkItemId: successorWork.id,
        successorOperation: successorWork.operation
          ? structuredClone(successorWork.operation)
          : undefined,
        successorRunSnapshot: structuredClone(command.successorRunSnapshot),
        successorSnapshot: structuredClone(command.successorSnapshot),
      });
    }
  }
  // Lineage guard: the successor run must have been executed against a snapshot
  // that belongs to this project's declared thread lineage. This prevents
  // cross-project runs from being used as reconciliation successors.
  {
    const lineageIds = new Set(draft.threadSnapshots.map((s) => s.snapshotId));
    const successorBaseId = successor.baseSnapshot?.snapshotId ??
      (successor.basis?.kind === "thread-snapshot"
        ? successor.basis.snapshotId
        : successor.basis?.kind === "approved-brief"
        ? successor.basis.projectSnapshotId
        : undefined);
    if (!successorBaseId || !lineageIds.has(successorBaseId)) {
      invalidInput(
        `Successor run ${successor.id} was not executed against this project's ` +
          "declared thread lineage.",
      );
    }
  }
  if (command.successorSnapshot !== undefined) {
    addThreadSnapshot(draft, command.successorSnapshot);
  }
  failedWork.status = "cancelled";
  failedWork.reconciliation = {
    kind: "superseded-by-successor",
    reconciledAt: appliedAt,
    reconciledBy: actor(origin),
    failedRunId: failedRun.id,
    successorRunId: successor.id,
    successorRunSnapshot: structuredClone(command.successorRunSnapshot),
    ...(command.successorSnapshot !== undefined
      ? { successorSnapshot: structuredClone(command.successorSnapshot) }
      : {}),
    successorEvidenceRefs: structuredClone([...command.successorEvidenceRefs]),
    rationale: command.rationale,
  };
  recomputeWorkReadiness(draft);
}
