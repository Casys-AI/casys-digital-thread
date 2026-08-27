import type {
  EngineeringAgentRun,
  EngineeringAgentRunStatus,
  EngineeringApprovedBriefBasis,
  EngineeringBasisRef,
  EngineeringCommandActor,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotRef,
  EngineeringWorkItem,
} from "../../../../domain/project/engineering-project.ts";
import { fingerprintsEqual } from "../../../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectCommandOrigin } from "../../../ports/in/engineering-project-command-origin.ts";
import { EngineeringProjectCommandError } from "./engineering-project-command-error.ts";
import type { RunCommand } from "./engineering-project-commands.ts";

export type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;

export function actor(
  origin: EngineeringProjectCommandOrigin,
): EngineeringCommandActor {
  return { id: origin.actorId, origin: origin.kind };
}

export function transition(
  command: Pick<RunCommand, "commandId" | "summary">,
  origin: EngineeringProjectCommandOrigin,
  status: EngineeringAgentRunStatus,
  at: string,
) {
  return {
    commandId: command.commandId,
    status,
    at,
    actor: actor(origin),
    summary: command.summary,
  };
}

export function findDecision(
  draft: EngineeringProjectSnapshot,
  id: string,
): Mutable<EngineeringDecision> | undefined {
  return draft.decisions.find((decision) => decision.id === id) as
    | Mutable<EngineeringDecision>
    | undefined;
}

export function findWorkItem(
  draft: EngineeringProjectSnapshot,
  id: string,
): Mutable<EngineeringWorkItem> | undefined {
  return draft.workItems.find((item) => item.id === id) as
    | Mutable<EngineeringWorkItem>
    | undefined;
}

export function findRun(
  draft: EngineeringProjectSnapshot,
  id: string,
): Mutable<EngineeringAgentRun> | undefined {
  return draft.agentRuns.find((run) => run.id === id) as
    | Mutable<EngineeringAgentRun>
    | undefined;
}

export function isActiveRunStatus(status: EngineeringAgentRunStatus): boolean {
  return ["queued", "running", "waiting-for-decision", "publishing"].includes(
    status,
  );
}

export function recomputeWorkReadiness(
  draft: Mutable<EngineeringProjectSnapshot>,
): void {
  for (const workItem of draft.workItems) {
    if (
      workItem.status === "completed" || workItem.status === "cancelled" ||
      workItem.status === "abandoned" ||
      draft.agentRuns.some((run) =>
        run.workItemId === workItem.id && isActiveRunStatus(run.status)
      )
    ) continue;
    workItem.status = nextIdleWorkStatus(draft, workItem);
  }
}

export function nextIdleWorkStatus(
  draft: EngineeringProjectSnapshot,
  workItem: EngineeringWorkItem,
): "planned" | "ready" | "waiting-for-decision" {
  const decisionsApproved = workItem.decisionIds.every((id) =>
    findDecision(draft, id)?.status === "approved"
  );
  const blockersResolved = workItem.blockerIds.every((id) =>
    draft.blockers.find((blocker) => blocker.id === id)?.status === "resolved"
  );
  // A cancelled work item is a satisfied dependency only when it carries a
  // reconciliation record — meaning an independently completed successor has
  // delivered equivalent evidence.  A naked cancellation (no reconciliation)
  // still blocks dependents: the work was abandoned, not superseded.
  // Mirror of deriveEngineeringPhaseStatus in engineering-project.ts:519-523.
  const dependenciesCompleted = workItem.dependsOnWorkItemIds.every((id) => {
    const dep = findWorkItem(draft, id);
    return dep?.status === "completed" ||
      (dep?.status === "cancelled" && dep.reconciliation !== undefined);
  });
  if (decisionsApproved && blockersResolved && dependenciesCompleted) {
    return "ready";
  }
  if (
    workItem.decisionIds.some((id) => {
      const status = findDecision(draft, id)?.status;
      return status === "required" || status === "proposed" ||
        status === "rejected";
    })
  ) return "waiting-for-decision";
  return "planned";
}

export function assertDeclaredSnapshot(
  draft: EngineeringProjectSnapshot,
  reference: EngineeringThreadSnapshotRef,
): void {
  if (reference.snapshotId.toLowerCase() === "latest") {
    invalidInput("Thread snapshot references cannot use latest aliases.");
  }
  if (reference.subjectId !== draft.project.subjectId) {
    invalidInput("Thread snapshot subject does not match the engineering project.");
  }
  if (
    !draft.threadSnapshots.some((candidate) =>
      candidate.snapshotId === reference.snapshotId &&
      candidate.revision === reference.revision &&
      candidate.subjectId === reference.subjectId
    )
  ) {
    invalidInput(
      "Thread snapshot reference is not declared by this project revision.",
    );
  }
}

export function assertThreadSnapshotBasisInput(
  basis: Extract<EngineeringBasisRef, { kind: "thread-snapshot" }>,
): void {
  if (
    typeof basis.snapshotId !== "string" || !basis.snapshotId.trim() ||
    basis.snapshotId.toLowerCase() === "latest" ||
    !Number.isInteger(basis.revision) || basis.revision < 1 ||
    typeof basis.subjectId !== "string" || !basis.subjectId.trim()
  ) {
    invalidInput("A thread-snapshot basis must be an exact non-latest reference.");
  }
}

export function threadSnapshotReference(
  basis: Extract<EngineeringBasisRef, { kind: "thread-snapshot" }>,
): EngineeringThreadSnapshotRef {
  return {
    snapshotId: basis.snapshotId,
    revision: basis.revision,
    subjectId: basis.subjectId,
  };
}

export function sameApprovedBriefBasis(
  left: EngineeringApprovedBriefBasis,
  right: EngineeringApprovedBriefBasis,
): boolean {
  return left.projectId === right.projectId &&
    left.projectSnapshotId === right.projectSnapshotId &&
    left.projectRevision === right.projectRevision &&
    left.briefId === right.briefId &&
    left.briefSnapshotId === right.briefSnapshotId &&
    left.briefRevision === right.briefRevision &&
    fingerprintsEqual(
      left.approvedBriefFingerprint,
      right.approvedBriefFingerprint,
    );
}

export function assertExactResultEvidence(
  draft: EngineeringProjectSnapshot,
  snapshot: EngineeringThreadSnapshotRef,
  evidenceRefs: readonly EngineeringThreadEntityRef[],
): void {
  if (!snapshot.snapshotId.trim() || snapshot.snapshotId.toLowerCase() === "latest") {
    invalidInput("Result snapshot must be an exact non-latest reference.");
  }
  if (!Number.isInteger(snapshot.revision) || snapshot.revision < 1) {
    invalidInput("Result snapshot revision must be a positive integer.");
  }
  if (snapshot.subjectId !== draft.project.subjectId) {
    invalidInput("Result snapshot subject does not match the engineering project.");
  }
  if (evidenceRefs.length === 0) {
    invalidInput("Completion requires exact evidence refs.");
  }
  const seen = new Set<string>();
  for (const reference of evidenceRefs) {
    if (
      reference.snapshotId !== snapshot.snapshotId ||
      reference.snapshotRevision !== snapshot.revision
    ) {
      invalidInput(
        "Every completion evidence ref must belong to the exact result snapshot.",
      );
    }
    const key = `${reference.kind}\u0000${reference.id}`;
    if (seen.has(key)) invalidInput("Completion evidence refs must be unique.");
    seen.add(key);
  }
}

export function assertResultAdvancesBase(
  base: EngineeringThreadSnapshotRef,
  result: EngineeringThreadSnapshotRef,
): void {
  if (
    result.snapshotId === base.snapshotId ||
    result.revision <= base.revision
  ) {
    invalidInput(
      `Result snapshot ${result.snapshotId}@${result.revision} must be newer than run base ${base.snapshotId}@${base.revision}.`,
    );
  }
}

export function addThreadSnapshot(
  draft: Mutable<EngineeringProjectSnapshot>,
  snapshot: EngineeringThreadSnapshotRef,
): void {
  const sameRevision = draft.threadSnapshots.find((candidate) =>
    candidate.subjectId === snapshot.subjectId &&
    candidate.revision === snapshot.revision
  );
  if (sameRevision) {
    if (sameRevision.snapshotId !== snapshot.snapshotId) {
      invalidInput(
        `Thread snapshot revision ${snapshot.revision} is already bound to ${sameRevision.snapshotId}.`,
      );
    }
    return;
  }
  if (
    draft.threadSnapshots.some((candidate) =>
      candidate.snapshotId === snapshot.snapshotId
    )
  ) {
    invalidInput(`Thread snapshot id ${snapshot.snapshotId} is already declared.`);
  }
  draft.threadSnapshots.push(structuredClone(snapshot));
}

export function mergeEvidence(
  existing: readonly EngineeringThreadEntityRef[],
  additions: readonly EngineeringThreadEntityRef[],
): Mutable<EngineeringThreadEntityRef>[] {
  const result = structuredClone(existing) as Mutable<EngineeringThreadEntityRef>[];
  const keys = new Set(result.map(evidenceKey));
  for (const reference of additions) {
    if (!keys.has(evidenceKey(reference))) result.push(structuredClone(reference));
  }
  return result;
}

export function evidenceKey(reference: EngineeringThreadEntityRef): string {
  return `${reference.snapshotId}\u0000${reference.snapshotRevision}\u0000${reference.kind}\u0000${reference.id}`;
}

export function sameSnapshotReference(
  left: EngineeringThreadSnapshotRef,
  right: EngineeringThreadSnapshotRef,
): boolean {
  return left.snapshotId === right.snapshotId &&
    left.revision === right.revision &&
    left.subjectId === right.subjectId;
}

export function sameEvidenceReferences(
  left: readonly EngineeringThreadEntityRef[],
  right: readonly EngineeringThreadEntityRef[],
): boolean {
  return left.length === right.length &&
    left.every((reference) =>
      right.some((candidate) => evidenceKey(reference) === evidenceKey(candidate))
    );
}

export function nonEmpty(value: string, name: string): void {
  if (typeof value !== "string" || !value.trim()) {
    invalidInput(`${name} cannot be empty.`);
  }
}

export function invalidInput(message: string): never {
  throw new EngineeringProjectCommandError("invalid_input", message);
}

export function invalidTransition(message: string): never {
  throw new EngineeringProjectCommandError("invalid_transition", message);
}

export function notFound(kind: string, id: string): never {
  throw new EngineeringProjectCommandError(
    "entity_not_found",
    `Engineering ${kind} ${id} does not exist.`,
  );
}

export function stale(projectId: string, expected: number, actual: number) {
  return new EngineeringProjectCommandError(
    "stale_revision",
    `Engineering project ${projectId} expected revision ${expected}, current revision is ${actual}.`,
  );
}
