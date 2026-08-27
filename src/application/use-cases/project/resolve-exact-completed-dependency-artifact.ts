/**
 * Exact completed work artifact, and the current-revision dependsOn wrapper.
 *
 * The wrapper's authority is `dependsOnWorkItemIds` plus
 * `requiresDependsOnOperation`. The lower-level function recrosses one already
 * selected work revision's completed run, evidence, result, and ancestry.
 * Labels, timestamps, recency, and `latest` never select a dependency.
 * A producer tool may only recross evidence already selected that way.
 */

import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringAgentRun,
  EngineeringOperationInputBinding,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import { leafRevisionIdsForActivity } from "../../../domain/project/engineering-activity.ts";
import {
  resolveRequiredDependsOnOperation,
} from "../../../domain/project/required-depends-on-operation.ts";
import { threadSnapshotDescendsFrom } from "../../../domain/thread/thread-snapshot-ancestry.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";

export type ExactCompletedDependencyArtifactIssueCode =
  | "current_run_unavailable"
  | "current_work_unavailable"
  | "current_work_mismatch"
  | "dependency_unavailable"
  | "dependency_ambiguous"
  | "producer_unavailable"
  | "evidence_mismatch"
  | "result_unavailable"
  | "ancestry_unavailable"
  | "artifact_unavailable"
  | "artifact_archived"
  | "artifact_stale"
  | "artifact_mismatch";

export interface ResolvedExactCompletedDependencyArtifact {
  readonly dependencyWork: EngineeringWorkItem;
  readonly producerRun: EngineeringAgentRun;
  readonly resultSnapshot: ThreadSnapshot;
  readonly evidence: EngineeringThreadEntityRef;
  readonly artifact: ThreadArtifact;
}

export type ResolveExactCompletedDependencyArtifactResult =
  | {
    readonly status: "resolved";
    readonly dependencyWork: EngineeringWorkItem;
    readonly producerRun: EngineeringAgentRun;
    readonly resultSnapshot: ThreadSnapshot;
    readonly evidence: EngineeringThreadEntityRef;
    readonly artifact: ThreadArtifact;
  }
  | {
    readonly status: "unavailable" | "unresolved";
    readonly code: ExactCompletedDependencyArtifactIssueCode;
    readonly reason: string;
  };

export interface ResolveExactCompletedWorkArtifactInput {
  readonly project: EngineeringProjectSnapshot;
  readonly dependencyWork: EngineeringWorkItem;
  readonly head: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly expectedDependencyOperation: {
    readonly id: string;
    readonly version: string;
    /**
     * Omit only when the downstream recross must validate a dynamic exact
     * binding against the reopened capture itself. Existing callers retain
     * their full operation equality check.
     */
    readonly bindings?: readonly EngineeringOperationInputBinding[];
  };
  readonly expectedProducer: {
    readonly serverId: string;
    readonly tool: string;
  };
  /**
   * The exact Thread artifact class emitted by the completed dependency.
   * Existing callers remain document-only; factual observer leaves opt into
   * `evidence` explicitly rather than treating a lookalike artifact as proof.
   */
  readonly expectedArtifactKind?: ThreadArtifact["kind"];
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
}

export interface ResolveExactCompletedDependencyArtifactInput
  extends Omit<ResolveExactCompletedWorkArtifactInput, "dependencyWork"> {
  readonly trustedRunId?: string;
  readonly currentWork?: EngineeringWorkItem;
  readonly currentOperation: {
    readonly id: string;
    readonly version: string;
    readonly requiresDependsOnOperation: {
      readonly id: string;
      readonly version: string;
    };
  };
}

export type UniqueCompletedOperationLeafRevision =
  & Pick<
    EngineeringWorkItem,
    "id" | "activityId" | "status"
  >
  & {
    readonly predecessorRevisionId?: string;
    readonly operation?: { readonly id: string; readonly version: string };
  };

export type SelectUniqueCompletedOperationLeafResult<
  T extends UniqueCompletedOperationLeafRevision = EngineeringWorkItem,
> =
  | { readonly status: "resolved"; readonly work: T }
  | {
    readonly status: "unavailable";
    readonly code:
      | "dependency_unavailable"
      | "dependency_ambiguous"
      | "producer_unavailable";
    readonly reason: string;
  };

export async function resolveExactCompletedDependencyArtifact(
  input: ResolveExactCompletedDependencyArtifactInput,
): Promise<ResolveExactCompletedDependencyArtifactResult> {
  if (
    input.head.id !== input.basis.snapshotId ||
    input.head.revision !== input.basis.revision ||
    input.head.subject.id !== input.basis.subjectId
  ) {
    return unavailable(
      "ancestry_unavailable",
      "The current Thread head is not the exact named basis.",
    );
  }

  const required = input.currentOperation.requiresDependsOnOperation;
  if (
    required.id !== input.expectedDependencyOperation.id ||
    required.version !== input.expectedDependencyOperation.version
  ) {
    return unavailable(
      "current_work_mismatch",
      "The current operation does not require the expected dependency operation.",
    );
  }

  const current = resolveCurrentWork(input);
  if (!("kind" in current)) return current;
  const currentWork = current.work;
  if (
    currentWork.operation?.id !== input.currentOperation.id ||
    currentWork.operation.version !== input.currentOperation.version
  ) {
    return unavailable(
      "current_work_mismatch",
      "The current work revision does not execute the expected operation.",
    );
  }

  const revisions = input.project.workItems.map((item) => ({
    id: item.id,
    activityId: item.activityId,
    predecessorRevisionId: item.predecessorRevisionId,
    operation: item.operation
      ? { id: item.operation.id, version: item.operation.version }
      : undefined,
  }));
  const selected = resolveRequiredDependsOnOperation(
    currentWork,
    input.currentOperation,
    revisions,
  );
  if (!selected) {
    return unavailable(
      "current_work_mismatch",
      "The current operation does not declare a required dependsOn operation.",
    );
  }
  if (selected.status !== "resolved") {
    return unavailable(
      selected.issue.code === "multiple_selected_matches" ||
        selected.issue.code === "ambiguous_activity"
        ? "dependency_ambiguous"
        : "dependency_unavailable",
      selected.issue.message,
    );
  }

  const dependencyWorks = input.project.workItems.filter((item) =>
    item.id === selected.selected.id
  );
  if (dependencyWorks.length !== 1) {
    return unavailable(
      "dependency_unavailable",
      "The named required dependency work item is not unique in the project.",
    );
  }
  return await resolveExactCompletedWorkArtifact({
    project: input.project,
    dependencyWork: dependencyWorks[0]!,
    head: input.head,
    basis: input.basis,
    expectedDependencyOperation: input.expectedDependencyOperation,
    expectedProducer: input.expectedProducer,
    expectedArtifactKind: input.expectedArtifactKind,
    snapshots: input.snapshots,
  });
}

/**
 * Unique current completed leaf of one registered operation.
 *
 * Selection is exact operation id/version, then the unique stable activity
 * among those matches, then that activity's unique current leaf. Array order,
 * labels, timestamps, recency, and `latest` never choose. A non-completed
 * current leaf, a fork, or a second activity fails closed.
 */
export function selectUniqueCompletedOperationLeaf<
  T extends UniqueCompletedOperationLeafRevision,
>(
  items: readonly T[],
  operation: { readonly id: string; readonly version: string },
): SelectUniqueCompletedOperationLeafResult<T> {
  const matches = items.filter((item) =>
    item.operation?.id === operation.id && item.operation.version === operation.version
  );
  if (matches.length === 0) {
    return unavailableLeaf(
      "dependency_unavailable",
      "No work revision executes the exact registered operation.",
    );
  }
  const activityIds = [...new Set(matches.map((item) => item.activityId))]
    .toSorted((left, right) => left.localeCompare(right));
  if (activityIds.length !== 1) {
    return unavailableLeaf(
      "dependency_ambiguous",
      "The registered operation does not belong to one unique stable activity.",
    );
  }
  const members = items.filter((item) => item.activityId === activityIds[0]);
  const leaves = leafRevisionIdsForActivity(members);
  if (leaves.length === 0) {
    return unavailableLeaf(
      "dependency_unavailable",
      "The unique stable activity has no current leaf revision.",
    );
  }
  if (leaves.length !== 1) {
    return unavailableLeaf(
      "dependency_ambiguous",
      "The unique stable activity has multiple current leaf revisions.",
    );
  }
  const selected = members.filter((item) => item.id === leaves[0]);
  if (selected.length !== 1) {
    return unavailableLeaf(
      "dependency_unavailable",
      "The unique current activity leaf is not unique in the project.",
    );
  }
  const work = selected[0]!;
  if (
    work.operation?.id !== operation.id ||
    work.operation.version !== operation.version
  ) {
    return unavailableLeaf(
      "producer_unavailable",
      "The unique current activity leaf does not execute the expected operation.",
    );
  }
  if (work.status !== "completed") {
    return unavailableLeaf(
      "producer_unavailable",
      "The unique current activity leaf is not completed.",
    );
  }
  return { status: "resolved", work };
}

export async function resolveExactCompletedWorkArtifact(
  input: ResolveExactCompletedWorkArtifactInput,
): Promise<ResolveExactCompletedDependencyArtifactResult> {
  if (
    input.head.id !== input.basis.snapshotId ||
    input.head.revision !== input.basis.revision ||
    input.head.subject.id !== input.basis.subjectId
  ) {
    return unavailable(
      "ancestry_unavailable",
      "The current Thread head is not the exact named basis.",
    );
  }

  const dependencyWorks = input.project.workItems.filter((item) =>
    item.id === input.dependencyWork.id
  );
  if (dependencyWorks.length !== 1) {
    return unavailable(
      "dependency_unavailable",
      "The named required dependency work item is not unique in the project.",
    );
  }
  const dependencyWork = dependencyWorks[0]!;
  if (
    dependencyWork.status !== "completed" ||
    dependencyWork.operation?.id !== input.expectedDependencyOperation.id ||
    dependencyWork.operation.version !== input.expectedDependencyOperation.version ||
    (input.expectedDependencyOperation.bindings !== undefined &&
      deterministicJson(dependencyWork.operation.bindings) !==
        deterministicJson(input.expectedDependencyOperation.bindings))
  ) {
    return unavailable(
      "producer_unavailable",
      "The named dependency work is not the exact completed required operation.",
    );
  }

  const producerRuns = input.project.agentRuns.filter((candidate) =>
    candidate.workItemId === dependencyWork.id && candidate.status === "completed"
  );
  if (producerRuns.length !== 1) {
    return unavailable(
      "producer_unavailable",
      "The named dependency work does not have a unique completed producer run.",
    );
  }
  const producerRun = producerRuns[0]!;
  const result = producerRun.resultSnapshot;
  if (!result || producerRun.basis?.kind !== "thread-snapshot") {
    return unavailable(
      "result_unavailable",
      "The named dependency producer run does not declare an exact Thread result.",
    );
  }
  const declared = input.project.threadSnapshots.filter((reference) =>
    reference.snapshotId === result.snapshotId &&
    reference.revision === result.revision &&
    reference.subjectId === result.subjectId
  );
  if (declared.length !== 1) {
    return unavailable(
      "result_unavailable",
      "The named dependency result snapshot is not declared exactly once.",
    );
  }

  const evidence = uniqueSharedArtifactEvidence(producerRun, dependencyWork);
  if (
    !evidence ||
    evidence.snapshotId !== result.snapshotId ||
    evidence.snapshotRevision !== result.revision
  ) {
    return unavailable(
      "evidence_mismatch",
      "The named dependency run and work do not share one exact result artifact.",
    );
  }

  let resultSnapshot: ThreadSnapshot | undefined;
  try {
    resultSnapshot = await input.snapshots.get(result.snapshotId);
    if (resultSnapshot) resultSnapshot = validateThreadSnapshot(resultSnapshot);
  } catch {
    return unavailable(
      "result_unavailable",
      "The named dependency result snapshot is unreadable.",
    );
  }
  if (
    !resultSnapshot ||
    resultSnapshot.id !== result.snapshotId ||
    resultSnapshot.revision !== result.revision ||
    resultSnapshot.subject.id !== result.subjectId ||
    !resultSnapshot.previous ||
    producerRun.basis.snapshotId !== resultSnapshot.previous.snapshotId ||
    producerRun.basis.revision !== resultSnapshot.previous.revision ||
    producerRun.basis.subjectId !== resultSnapshot.subject.id
  ) {
    return unavailable(
      "result_unavailable",
      "The named dependency result is not the exact direct successor of its run basis.",
    );
  }

  const produced = uniqueArtifact(resultSnapshot, evidence.id);
  if (
    !produced ||
    produced.kind !== (input.expectedArtifactKind ?? "document") ||
    produced.producer.serverId !== input.expectedProducer.serverId ||
    produced.producer.tool !== input.expectedProducer.tool ||
    produced.producer.runId !== producerRun.id
  ) {
    return unavailable(
      "artifact_unavailable",
      "The named dependency result does not contain the exact producer artifact.",
    );
  }

  if (!await threadSnapshotDescendsFrom(input.head, resultSnapshot, input.snapshots)) {
    return unavailable(
      "ancestry_unavailable",
      "The current Thread head does not descend from the named dependency result.",
    );
  }

  const onHead = uniqueArtifact(input.head, produced.id);
  if (!onHead) {
    return unavailable(
      "artifact_unavailable",
      "The named dependency artifact is not present on the current Thread head.",
    );
  }
  if (deterministicJson(onHead) !== deterministicJson(produced)) {
    return unresolved(
      "artifact_mismatch",
      "The named dependency artifact is not byte-identical on the current Thread head.",
    );
  }
  if (archivedRefKeys(input.head).has(`artifact:${onHead.id}`)) {
    return unresolved(
      "artifact_archived",
      "The named dependency artifact is archived on the current Thread head.",
    );
  }
  if (onHead.freshness.status !== "fresh") {
    return unresolved(
      "artifact_stale",
      "The named dependency artifact is not fresh on the current Thread head.",
    );
  }

  return {
    status: "resolved",
    dependencyWork,
    producerRun,
    resultSnapshot,
    evidence,
    artifact: onHead,
  };
}

function resolveCurrentWork(
  input: ResolveExactCompletedDependencyArtifactInput,
):
  | { readonly kind: "current-work"; readonly work: EngineeringWorkItem }
  | ResolveExactCompletedDependencyArtifactResult {
  if (input.trustedRunId) {
    const runs = input.project.agentRuns.filter((candidate) =>
      candidate.id === input.trustedRunId
    );
    if (runs.length !== 1) {
      return unavailable(
        "current_run_unavailable",
        "The trusted run id does not resolve to one current run.",
      );
    }
    const run = runs[0]!;
    if (run.basis?.kind !== "thread-snapshot") {
      return unavailable(
        "current_run_unavailable",
        "The current run does not declare an exact Thread snapshot basis.",
      );
    }
    if (
      run.basis.snapshotId !== input.basis.snapshotId ||
      run.basis.revision !== input.basis.revision ||
      run.basis.subjectId !== input.basis.subjectId
    ) {
      return unavailable(
        "current_work_mismatch",
        "The current run is not anchored on the exact named Thread basis.",
      );
    }
    const works = input.project.workItems.filter((item) => item.id === run.workItemId);
    if (works.length !== 1) {
      return unavailable(
        "current_work_unavailable",
        "The current run does not resolve to one work revision.",
      );
    }
    const work = works[0]!;
    if (input.currentWork && input.currentWork.id !== work.id) {
      return unavailable(
        "current_work_mismatch",
        "The supplied current work is not the work revision of the trusted run.",
      );
    }
    return { kind: "current-work", work };
  }
  if (!input.currentWork) {
    return unavailable(
      "current_run_unavailable",
      "The current trusted run or work revision is not named.",
    );
  }
  const works = input.project.workItems.filter((item) =>
    item.id === input.currentWork!.id
  );
  if (works.length !== 1) {
    return unavailable(
      "current_work_unavailable",
      "The supplied current work revision is not unique in the project.",
    );
  }
  return { kind: "current-work", work: works[0]! };
}

function uniqueSharedArtifactEvidence(
  run: EngineeringAgentRun,
  work: EngineeringWorkItem,
): EngineeringThreadEntityRef | undefined {
  if (
    run.evidenceRefs.length !== 1 ||
    work.evidenceRefs.length !== 1 ||
    deterministicJson(run.evidenceRefs) !== deterministicJson(work.evidenceRefs)
  ) {
    return undefined;
  }
  const evidence = run.evidenceRefs[0]!;
  return evidence.kind === "artifact" ? evidence : undefined;
}

function uniqueArtifact(
  snapshot: ThreadSnapshot,
  id: string,
): ThreadArtifact | undefined {
  const matches = snapshot.artifacts.filter((artifact) => artifact.id === id);
  return matches.length === 1 ? matches[0] : undefined;
}

function unavailable(
  code: ExactCompletedDependencyArtifactIssueCode,
  reason: string,
): ResolveExactCompletedDependencyArtifactResult {
  return { status: "unavailable", code, reason };
}

function unresolved(
  code: ExactCompletedDependencyArtifactIssueCode,
  reason: string,
): ResolveExactCompletedDependencyArtifactResult {
  return { status: "unresolved", code, reason };
}

function unavailableLeaf(
  code:
    | "dependency_unavailable"
    | "dependency_ambiguous"
    | "producer_unavailable",
  reason: string,
): SelectUniqueCompletedOperationLeafResult<never> {
  return { status: "unavailable", code, reason };
}
